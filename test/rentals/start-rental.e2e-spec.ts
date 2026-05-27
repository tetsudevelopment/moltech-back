import { randomUUID } from 'crypto';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { importPKCS8, SignJWT } from 'jose';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '@/app.module';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

/**
 * Race-condition e2e for the "max one ACTIVE rental per user" invariant.
 *
 * Harness: reuses the existing e2e bootstrap pattern (real AppModule against
 * the dev Postgres/Redis containers, see test/setup-env.ts for connection
 * details). No Testcontainers — the project's e2e suite connects to the
 * already-running dev infra. The partial unique index migration must be
 * applied to that DB (`pnpm prisma migrate deploy`) for this to pass.
 *
 * The test fires TWO concurrent POST /api/v1/rentals for the SAME user, each
 * with a DIFFERENT Idempotency-Key (so idempotency does not dedupe them) and a
 * DIFFERENT power_bank_id (so the power-bank guard does not reject either). The
 * only thing standing between them and two active rentals is the partial unique
 * index `one_active_rental_per_user`.
 */
describe('Start rental — one active rental per user (e2e race)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Seeded entity ids — captured so afterAll can clean up the shared dev DB.
  let userId: string;
  let stationId: string;
  let paymentMethodId: string;
  const powerBankIds: string[] = [];
  let accessToken: string;

  async function signAccessToken(sub: string): Promise<string> {
    const privateKey = await importPKCS8(process.env.JWT_PRIVATE_KEY!, 'RS256');
    return new SignJWT({ sub, role: 'user' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(process.env.JWT_ISSUER!)
      .setAudience(process.env.JWT_AUDIENCE!)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = app.get(PrismaService);

    // Unique suffix keeps this run isolated on the shared dev DB.
    const suffix = randomUUID().slice(0, 8);

    const user = await prisma.users.create({
      data: {
        first_name: 'Race',
        last_name: 'Tester',
        email: `race-${suffix}@moltech.test`,
        // chk_users_password_email: email-provider users require a password_hash.
        // The rental flow authenticates via the minted JWT, so any non-null value works.
        password_hash: 'argon2id$placeholder$not-used-in-this-flow',
        email_verified: true,
        accepted_policy: true,
      },
    });
    userId = user.id;

    const station = await prisma.stations.create({
      data: {
        name: `Race Station ${suffix}`,
        city: 'Bogotá',
        address: 'Test Address 123',
        latitude: '4.7110000',
        longitude: '-74.0721000',
        hourly_rate: '5000.00',
        currency: 'COP',
        status: 'online',
      },
    });
    stationId = station.id;

    const pbA = await prisma.power_banks.create({
      data: {
        code: `PB-A-${suffix}`,
        station_id: stationId,
        status: 'available',
        battery_level: 100,
        qr_code: `qr-a-${suffix}`,
      },
    });
    const pbB = await prisma.power_banks.create({
      data: {
        code: `PB-B-${suffix}`,
        station_id: stationId,
        status: 'available',
        battery_level: 100,
        qr_code: `qr-b-${suffix}`,
      },
    });
    powerBankIds.push(pbA.id, pbB.id);

    const paymentMethod = await prisma.payment_methods.create({
      data: {
        user_id: userId,
        type: 'visa',
        cardholder_name: 'Race Tester',
        last_four_digits: '4242',
        expiry_month: 12,
        // chk_payment_methods_expiry_year: stored as a 2-digit year (0-99).
        expiry_year: 30,
        gateway_token: 'tok_race_test',
        status: 'active',
      },
    });
    paymentMethodId = paymentMethod.id;

    accessToken = await signAccessToken(userId);
  });

  afterAll(async () => {
    // Clean up in FK-safe order. Guard each delete so a partial seed still tears down.
    if (prisma as PrismaService | undefined) {
      await prisma.payments.deleteMany({ where: { user_id: userId } });
      await prisma.rentals.deleteMany({ where: { user_id: userId } });
      await prisma.payment_methods.deleteMany({ where: { user_id: userId } });
      if (powerBankIds.length > 0) {
        await prisma.power_banks.deleteMany({ where: { id: { in: powerBankIds } } });
      }
      if (stationId) {
        await prisma.stations.deleteMany({ where: { id: stationId } });
      }
      if (userId) {
        await prisma.users.deleteMany({ where: { id: userId } });
      }
    }
    if (app as INestApplication | undefined) {
      await app.close();
    }
  });

  it('allows exactly one of two concurrent rentals; the other gets 409 USER_HAS_ACTIVE_RENTAL', async () => {
    const server = app.getHttpServer() as App;

    const fire = (powerBankId: string) =>
      request(server)
        .post('/api/v1/rentals')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          pickup_station_id: stationId,
          power_bank_id: powerBankId,
          payment_method_id: paymentMethodId,
          estimated_duration_hours: 2,
        });

    const [resA, resB] = await Promise.all([fire(powerBankIds[0]!), fire(powerBankIds[1]!)]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const conflict = [resA, resB].find((r) => r.status === 409);
    expect(conflict).toBeDefined();
    const body = conflict!.body as { error: { code: string } };
    expect(body.error.code).toBe('USER_HAS_ACTIVE_RENTAL');

    const activeCount = await prisma.rentals.count({
      where: { user_id: userId, status: 'active' },
    });
    expect(activeCount).toBe(1);
  });
});
