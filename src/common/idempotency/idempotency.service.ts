import { createHash } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '@/infrastructure/redis/redis.service';

import {
  CompleteRecordSchema,
  IDEMPOTENCY_PENDING_TIMEOUT_MS,
  IDEMPOTENCY_TTL_SECONDS,
  type IdempotencyRecord,
  IdempotencyRecordSchema,
  type ReserveOutcome,
} from './idempotency.types';

export interface IdempotencyKeyParts {
  userId: string;
  method: string;
  path: string;
  key: string;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Computes the deterministic Redis key used to store the idempotency record.
   * Format: `idem:<userId>:<METHOD>:<path>:<key>` per CLAUDE.md §2.6.
   */
  buildRedisKey(parts: IdempotencyKeyParts): string {
    return `idem:${parts.userId}:${parts.method.toUpperCase()}:${parts.path}:${parts.key}`;
  }

  /**
   * Stable SHA-256 hash over an arbitrary request body. Object keys are sorted
   * recursively so semantically-equivalent payloads with different key orders
   * hash to the same value.
   */
  hashPayload(payload: unknown): string {
    return createHash('sha256').update(stableStringify(payload)).digest('hex');
  }

  /**
   * Attempts to reserve an idempotency slot for the incoming request.
   *
   *   - 'reserved'    → caller may proceed; must call `complete()` afterwards.
   *   - 'replay'      → return the stored complete record's status+body verbatim.
   *   - 'in_progress' → another request with the same key is currently executing.
   *   - 'conflict'    → same key was previously used with a different payload.
   */
  async reserve(
    parts: IdempotencyKeyParts,
    payloadHash: string,
    requestId?: string,
  ): Promise<ReserveOutcome> {
    const redisKey = this.buildRedisKey(parts);
    const client = this.redis.getClient();
    const now = Date.now();

    const pendingPayload = JSON.stringify({
      status: 'pending',
      payloadHash,
      reservedAt: now,
      ...(requestId !== undefined ? { requestId } : {}),
    });

    const set = await client.set(redisKey, pendingPayload, 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
    if (set === 'OK') {
      return { kind: 'reserved' };
    }

    const existing = await this.readRecord(redisKey);
    if (!existing) {
      // Race: another request released the key between SET NX and GET. Retry once.
      const retry = await client.set(redisKey, pendingPayload, 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
      if (retry === 'OK') {
        return { kind: 'reserved' };
      }
      const afterRace = await this.readRecord(redisKey);
      if (!afterRace) {
        // Still racing — treat as in_progress to be safe.
        return {
          kind: 'in_progress',
          record: {
            status: 'pending',
            payloadHash,
            reservedAt: now,
            ...(requestId !== undefined ? { requestId } : {}),
          },
        };
      }
      return this.classify(afterRace, payloadHash, now);
    }

    return this.classify(existing, payloadHash, now);
  }

  /**
   * Stores the final response under the idempotency key so future identical
   * requests get an instant replay. Overwrites the 'pending' record.
   */
  async complete(
    parts: IdempotencyKeyParts,
    payloadHash: string,
    statusCode: number,
    body: unknown,
    requestId?: string,
  ): Promise<void> {
    const redisKey = this.buildRedisKey(parts);
    const record = CompleteRecordSchema.parse({
      status: 'complete',
      payloadHash,
      statusCode,
      body,
      completedAt: Date.now(),
      ...(requestId !== undefined ? { requestId } : {}),
    });
    await this.redis
      .getClient()
      .set(redisKey, JSON.stringify(record), 'EX', IDEMPOTENCY_TTL_SECONDS);
  }

  /**
   * Removes a pending reservation. Called when the handler throws so the next
   * retry from the client is not blocked by an orphan 'pending' record.
   */
  async release(parts: IdempotencyKeyParts): Promise<void> {
    const redisKey = this.buildRedisKey(parts);
    try {
      await this.redis.getClient().del(redisKey);
    } catch (err) {
      this.logger.warn(`Failed to release idempotency key ${redisKey}: ${String(err)}`);
    }
  }

  private async readRecord(redisKey: string): Promise<IdempotencyRecord | null> {
    const raw = await this.redis.getClient().get(redisKey);
    if (!raw) return null;
    try {
      const parsed = IdempotencyRecordSchema.parse(JSON.parse(raw));
      return parsed;
    } catch (err) {
      this.logger.warn(`Corrupt idempotency record at ${redisKey}, dropping: ${String(err)}`);
      await this.redis.getClient().del(redisKey);
      return null;
    }
  }

  private classify(record: IdempotencyRecord, payloadHash: string, now: number): ReserveOutcome {
    if (record.payloadHash !== payloadHash) {
      return { kind: 'conflict', record };
    }
    if (record.status === 'complete') {
      return { kind: 'replay', record };
    }
    const isStale = now - record.reservedAt > IDEMPOTENCY_PENDING_TIMEOUT_MS;
    if (isStale) {
      // Pending reservation is older than the handler timeout: treat as orphan
      // and let the caller retry by reserving fresh.
      return { kind: 'reserved' };
    }
    return { kind: 'in_progress', record };
  }
}

/**
 * Recursively sorts object keys to produce a canonical JSON representation.
 * Used to hash payloads so `{a:1,b:2}` and `{b:2,a:1}` yield identical hashes.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const inner = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',');
  return `{${inner}}`;
}
