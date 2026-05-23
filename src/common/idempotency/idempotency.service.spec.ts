import { Test, type TestingModule } from '@nestjs/testing';

import { RedisService } from '@/infrastructure/redis/redis.service';

import { IdempotencyService } from './idempotency.service';

interface FakeRedis {
  set: jest.Mock;
  get: jest.Mock;
  del: jest.Mock;
}

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let redis: FakeRedis;

  const userId = 'user-123';
  const baseParts = {
    userId,
    method: 'POST',
    path: '/api/v1/rentals',
    key: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  };
  const payload = { foo: 'bar', n: 1 };
  const expectedRedisKey =
    'idem:user-123:POST:/api/v1/rentals:9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

  beforeEach(async () => {
    redis = { set: jest.fn(), get: jest.fn(), del: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        { provide: RedisService, useValue: { getClient: (): FakeRedis => redis } },
      ],
    }).compile();
    service = module.get(IdempotencyService);
  });

  describe('buildRedisKey()', () => {
    it('builds the documented key format idem:<userId>:<METHOD>:<path>:<key>', () => {
      expect(service.buildRedisKey(baseParts)).toBe(expectedRedisKey);
    });

    it('uppercases the HTTP method', () => {
      expect(service.buildRedisKey({ ...baseParts, method: 'post' })).toBe(expectedRedisKey);
    });
  });

  describe('hashPayload()', () => {
    it('produces the same hash for semantically-equal payloads with different key orders', () => {
      const a = service.hashPayload({ a: 1, b: 2 });
      const b = service.hashPayload({ b: 2, a: 1 });
      expect(a).toBe(b);
    });

    it('produces different hashes for different payloads', () => {
      expect(service.hashPayload({ a: 1 })).not.toBe(service.hashPayload({ a: 2 }));
    });
  });

  describe('reserve()', () => {
    it('returns reserved when SET NX succeeds (new key)', async () => {
      redis.set.mockResolvedValue('OK');

      const outcome = await service.reserve(baseParts, service.hashPayload(payload), 'req-1');

      expect(outcome.kind).toBe('reserved');
      expect(redis.set).toHaveBeenCalledWith(
        expectedRedisKey,
        expect.stringContaining('"status":"pending"'),
        'EX',
        86400,
        'NX',
      );
    });

    it('returns replay when an identical complete record already exists', async () => {
      const hash = service.hashPayload(payload);
      redis.set.mockResolvedValue(null); // NX failed
      redis.get.mockResolvedValue(
        JSON.stringify({
          status: 'complete',
          payloadHash: hash,
          statusCode: 201,
          body: { rental: { id: 'r1' } },
          completedAt: Date.now(),
        }),
      );

      const outcome = await service.reserve(baseParts, hash);

      expect(outcome.kind).toBe('replay');
      if (outcome.kind === 'replay') {
        expect(outcome.record.statusCode).toBe(201);
        expect(outcome.record.body).toEqual({ rental: { id: 'r1' } });
      }
    });

    it('returns conflict when the same key was used with a different payload', async () => {
      redis.set.mockResolvedValue(null);
      redis.get.mockResolvedValue(
        JSON.stringify({
          status: 'complete',
          payloadHash: 'a-different-hash',
          statusCode: 201,
          body: { rental: { id: 'r1' } },
          completedAt: Date.now(),
        }),
      );

      const outcome = await service.reserve(baseParts, service.hashPayload(payload));

      expect(outcome.kind).toBe('conflict');
    });

    it('returns in_progress when a pending reservation is fresh', async () => {
      const hash = service.hashPayload(payload);
      redis.set.mockResolvedValue(null);
      redis.get.mockResolvedValue(
        JSON.stringify({
          status: 'pending',
          payloadHash: hash,
          reservedAt: Date.now(), // fresh
        }),
      );

      const outcome = await service.reserve(baseParts, hash);

      expect(outcome.kind).toBe('in_progress');
    });

    it('treats stale pending reservations as orphan and re-reserves', async () => {
      const hash = service.hashPayload(payload);
      redis.set.mockResolvedValue(null);
      redis.get.mockResolvedValue(
        JSON.stringify({
          status: 'pending',
          payloadHash: hash,
          reservedAt: Date.now() - 60_000, // 60s old, well past the 15s window
        }),
      );

      const outcome = await service.reserve(baseParts, hash);

      expect(outcome.kind).toBe('reserved');
    });

    it('drops corrupt records and continues', async () => {
      redis.set.mockResolvedValueOnce(null).mockResolvedValueOnce('OK');
      redis.get.mockResolvedValueOnce('{not-json');
      redis.del.mockResolvedValue(1);

      const outcome = await service.reserve(baseParts, service.hashPayload(payload));

      expect(outcome.kind).toBe('reserved');
      expect(redis.del).toHaveBeenCalledWith(expectedRedisKey);
    });
  });

  describe('complete()', () => {
    it('stores a complete record with TTL', async () => {
      redis.set.mockResolvedValue('OK');
      await service.complete(baseParts, service.hashPayload(payload), 201, {
        rental: { id: 'r1' },
      });

      expect(redis.set).toHaveBeenCalledWith(
        expectedRedisKey,
        expect.stringContaining('"status":"complete"'),
        'EX',
        86400,
      );
      const calls = redis.set.mock.calls as unknown as unknown[][];
      const written = calls[0]?.[1] as string;
      const parsed = JSON.parse(written) as {
        status: string;
        statusCode: number;
        body: { rental: { id: string } };
      };
      expect(parsed.status).toBe('complete');
      expect(parsed.statusCode).toBe(201);
      expect(parsed.body.rental.id).toBe('r1');
    });
  });

  describe('release()', () => {
    it('deletes the redis key', async () => {
      redis.del.mockResolvedValue(1);
      await service.release(baseParts);
      expect(redis.del).toHaveBeenCalledWith(expectedRedisKey);
    });

    it('swallows redis errors', async () => {
      redis.del.mockRejectedValue(new Error('redis down'));
      await expect(service.release(baseParts)).resolves.toBeUndefined();
    });
  });
});
