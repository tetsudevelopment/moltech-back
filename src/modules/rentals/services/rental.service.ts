import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import {
  AUDIT_RECORDED_EVENT,
  type AuditAction,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from '@/modules/payments/domain/payment-gateway.types';

import { type Rental } from '../domain/rental.types';
import { type StartRentalDto } from '../dtos/start-rental.dto';
import { PaymentMethodRepository } from '../repositories/payment-method.repository';
import { PowerBankRepository } from '../repositories/power-bank.repository';
import { RentalRepository } from '../repositories/rental.repository';

export interface RentalContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

const MIN_BILLABLE_HOURS = new Prisma.Decimal('0.25');

// Name of the partial unique index that enforces "max one ACTIVE rental per
// user" at the DB level. A P2002 referencing this index is the race backstop
// for the non-locking pre-check; we map it to the same 409.
const ONE_ACTIVE_RENTAL_INDEX = 'one_active_rental_per_user';

@Injectable()
export class RentalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rentals: RentalRepository,
    private readonly powerBanks: PowerBankRepository,
    private readonly paymentMethods: PaymentMethodRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly emitter: EventEmitter2,
  ) {}

  async startRental(
    userId: string,
    dto: StartRentalDto,
    context: RentalContext = {},
  ): Promise<Rental> {
    // Fail-fast pre-check: a user may hold at most one ACTIVE rental. This runs
    // BEFORE any payment charge so we never move money for a request the DB
    // would reject anyway. It is NOT race-safe on its own (Read Committed: the
    // SELECT takes no lock) — the partial unique index is the real guard, see
    // the backstop around the insert below.
    const active = await this.rentals.findActiveByUser(userId);
    if (active) {
      throw new ConflictException({
        code: 'USER_HAS_ACTIVE_RENTAL',
        message: 'Ya tenés un alquiler activo',
        details: { activeRentalId: active.id },
      });
    }

    const paymentMethod = await this.paymentMethods.findByIdForUser(dto.payment_method_id, userId);
    if (!paymentMethod) {
      throw new NotFoundException({
        code: 'PAYMENT_METHOD_NOT_FOUND',
        message: 'Payment method not found or not owned by user',
      });
    }
    if (paymentMethod.status !== 'active') {
      throw new BadRequestException({
        code: 'PAYMENT_METHOD_INACTIVE',
        message: 'Payment method is not active',
      });
    }

    const powerBank = await this.powerBanks.findById(dto.power_bank_id);
    if (!powerBank) {
      throw new NotFoundException({
        code: 'POWER_BANK_NOT_FOUND',
        message: 'Power bank not found',
      });
    }
    if (powerBank.status !== 'available') {
      throw new ConflictException({
        code: 'POWER_BANK_UNAVAILABLE',
        message: `Power bank is currently ${powerBank.status}`,
      });
    }
    if (powerBank.stationId !== dto.pickup_station_id) {
      throw new BadRequestException({
        code: 'POWER_BANK_STATION_MISMATCH',
        message: 'Power bank is not at the specified pickup station',
      });
    }

    const station = await this.prisma.stations.findUnique({
      where: { id: dto.pickup_station_id },
    });
    if (!station) {
      throw new NotFoundException({
        code: 'STATION_NOT_FOUND',
        message: 'Pickup station not found',
      });
    }
    if (station.status !== 'online') {
      throw new ConflictException({
        code: 'STATION_OFFLINE',
        message: `Station is ${station.status}`,
      });
    }

    const hourlyRate = station.hourly_rate;
    const estimatedCost = hourlyRate.times(dto.estimated_duration_hours);
    const discountApplied = new Prisma.Decimal('0.00');
    const netCost = estimatedCost.minus(discountApplied);

    const chargeResult = await this.gateway.charge({
      amount: netCost.toFixed(2),
      currency: station.currency,
      description: `MOLTECH rental ${powerBank.code}`,
      userId,
      paymentMethodToken: paymentMethod.gatewayToken,
    });

    if (chargeResult.status !== 'approved') {
      this.emitFailure(userId, 'payment_declined', context, {
        gateway: this.gateway.name,
        transactionId: chargeResult.transactionId,
      });
      throw new BadRequestException({
        code: 'PAYMENT_DECLINED',
        message: chargeResult.gatewayMessage ?? 'Payment was declined',
      });
    }

    let rental: Rental;
    try {
      rental = await this.prisma.$transaction(async (tx) => {
        const currentPb = await tx.power_banks.findUnique({
          where: { id: dto.power_bank_id },
        });
        if (currentPb?.status !== 'available') {
          throw new ConflictException({
            code: 'POWER_BANK_UNAVAILABLE',
            message: 'Power bank was reserved by another rental',
          });
        }

        const created = await this.rentals.create(
          {
            userId,
            powerBankId: dto.power_bank_id,
            pickupStationId: dto.pickup_station_id,
            paymentMethodId: dto.payment_method_id,
            couponId: dto.coupon_id ?? null,
            estimatedDurationHours: dto.estimated_duration_hours,
            hourlyRate: hourlyRate.toFixed(2),
            estimatedCost: estimatedCost.toFixed(2),
            currency: station.currency,
            discountApplied: discountApplied.toFixed(2),
          },
          tx,
        );

        await tx.payments.create({
          data: {
            rental_id: created.id,
            user_id: userId,
            payment_method_id: dto.payment_method_id,
            concept: 'rental',
            amount: netCost,
            currency: station.currency,
            gateway: 'other',
            transaction_id: chargeResult.transactionId,
            status: 'approved',
          },
        });

        await this.powerBanks.setStatus(dto.power_bank_id, 'rented', tx);

        return created;
      });
    } catch (error) {
      // Race backstop: a concurrent request slipped past the pre-check and the
      // partial unique index rejected this insert. Map it to the same 409.
      // Only this specific index — never swallow unrelated P2002s.
      if (isOneActiveRentalViolation(error)) {
        throw new ConflictException({
          code: 'USER_HAS_ACTIVE_RENTAL',
          message: 'Ya tenés un alquiler activo',
        });
      }
      throw error;
    }

    this.emitSuccess('rental.started', userId, context, {
      rentalId: rental.id,
      powerBankId: dto.power_bank_id,
      stationId: dto.pickup_station_id,
      gateway: this.gateway.name,
    });

    return rental;
  }

  async finalizeRental(
    rentalId: string,
    userId: string,
    context: RentalContext = {},
  ): Promise<Rental> {
    const existing = await this.rentals.findById(rentalId);
    if (!existing) {
      throw new NotFoundException({
        code: 'RENTAL_NOT_FOUND',
        message: 'Rental not found',
      });
    }
    if (existing.userId !== userId) {
      throw new ForbiddenException({
        code: 'RENTAL_NOT_OWNED',
        message: 'You do not own this rental',
      });
    }
    if (existing.status !== 'active') {
      throw new ConflictException({
        code: 'RENTAL_NOT_ACTIVE',
        message: `Rental is ${existing.status}`,
      });
    }

    const endTime = new Date();
    const elapsedMs = endTime.getTime() - existing.startTime.getTime();
    const actualHoursRaw = new Prisma.Decimal(elapsedMs).dividedBy(3_600_000);
    const billableHours = Prisma.Decimal.max(actualHoursRaw, MIN_BILLABLE_HOURS);
    const hourlyRate = new Prisma.Decimal(existing.hourlyRate);
    const finalCost = billableHours.times(hourlyRate).toDecimalPlaces(2);
    const estimatedCost = new Prisma.Decimal(existing.estimatedCost);
    const penalty = Prisma.Decimal.max(finalCost.minus(estimatedCost), new Prisma.Decimal('0'));

    const finalized = await this.prisma.$transaction(async (tx) => {
      const updated = await this.rentals.finalize(
        rentalId,
        {
          endTime,
          actualDurationHours: actualHoursRaw.toDecimalPlaces(2).toFixed(2),
          finalCost: finalCost.toFixed(2),
          penalty: penalty.toFixed(2),
        },
        tx,
      );
      await this.powerBanks.setStatus(existing.powerBankId, 'available', tx);
      return updated;
    });

    this.emitSuccess('rental.finalized', userId, context, {
      rentalId,
      finalCost: finalized.finalCost,
      penalty: finalized.penalty,
    });

    return finalized;
  }

  private emitSuccess(
    action: AuditAction,
    actor: string,
    context: RentalContext,
    metadata: Record<string, unknown>,
  ): void {
    this.emitEvent(action, actor, context, metadata);
  }

  private emitFailure(
    actor: string,
    reason: string,
    context: RentalContext,
    extra: Record<string, unknown>,
  ): void {
    this.emitEvent('payment.declined', actor, context, { reason, ...extra });
  }

  private emitEvent(
    action: AuditAction,
    actor: string,
    context: RentalContext,
    metadata: Record<string, unknown>,
  ): void {
    const evt: AuditRecordedEvent = {
      action,
      actor,
      timestamp: new Date().toISOString(),
      ...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
      ...(context.ip !== undefined ? { ip: context.ip } : {}),
      metadata,
    };
    this.emitter.emit(AUDIT_RECORDED_EVENT, evt);
  }
}

/**
 * True only when the error is a Prisma P2002 unique-violation raised by the
 * `one_active_rental_per_user` partial index. Other P2002s (e.g. the payments
 * gateway+transaction unique on the `payments` model) must propagate untouched.
 *
 * Prisma's `meta.target` shape is version-dependent: on Prisma 6 it reports the
 * column list (`['user_id']`) plus `meta.modelName`, while other versions/drivers
 * surface the raw index name. We match either:
 *   1. modelName=`rentals` AND target=`['user_id']` — the ONLY unique index on
 *      `rentals` keyed solely by `user_id` is our partial index, so this is
 *      unambiguous; OR
 *   2. the index name appearing in `meta.target` or the message (defensive).
 */
function isOneActiveRentalViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const meta = error.meta as { target?: unknown; modelName?: unknown } | undefined;
  const target = meta?.target;

  if (
    meta?.modelName === 'rentals' &&
    Array.isArray(target) &&
    target.length === 1 &&
    target[0] === 'user_id'
  ) {
    return true;
  }
  if (typeof target === 'string' && target.includes(ONE_ACTIVE_RENTAL_INDEX)) {
    return true;
  }
  if (Array.isArray(target) && target.some((t) => t === ONE_ACTIVE_RENTAL_INDEX)) {
    return true;
  }
  return error.message.includes(ONE_ACTIVE_RENTAL_INDEX);
}
