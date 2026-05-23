import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_METADATA = 'idempotent';

/**
 * Marks a route handler as idempotent. The IdempotencyInterceptor will:
 *   1. Require the Idempotency-Key request header (UUID v4).
 *   2. Dedupe identical (userId, method, path, key) tuples for 24h in Redis.
 *   3. Reject with 409 IDEMPOTENCY_KEY_CONFLICT when the same key is reused
 *      with a different payload.
 *   4. Return the cached response for repeated identical requests.
 *
 * MUST be combined with a guard that authenticates the user (e.g. JwtAuthGuard);
 * the interceptor scopes the cache key under req.user.id.
 */
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT_METADATA, true);
