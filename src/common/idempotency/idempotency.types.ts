import { z } from 'zod';

/**
 * 24 hours, per CLAUDE.md §2.6.
 */
export const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24;

/**
 * Maximum time a request may take before its 'pending' reservation is considered
 * stale and other concurrent requests may retry. Set well below the request
 * timeout interceptor so we never race the handler.
 */
export const IDEMPOTENCY_PENDING_TIMEOUT_MS = 15_000;

/**
 * Cached record stored under each idempotency key. Two phases:
 *   - 'pending':  a request is currently executing; concurrent requests with
 *                 the same key MUST be rejected with 409 IDEMPOTENCY_IN_PROGRESS
 *                 to avoid duplicate side effects.
 *   - 'complete': the request finished; subsequent calls return statusCode+body
 *                 without invoking the handler again.
 */
export const PendingRecordSchema = z.object({
  status: z.literal('pending'),
  payloadHash: z.string(),
  reservedAt: z.number().int(),
  requestId: z.string().optional(),
});

export const CompleteRecordSchema = z.object({
  status: z.literal('complete'),
  payloadHash: z.string(),
  statusCode: z.number().int().min(100).max(599),
  body: z.unknown(),
  completedAt: z.number().int(),
  requestId: z.string().optional(),
});

export const IdempotencyRecordSchema = z.discriminatedUnion('status', [
  PendingRecordSchema,
  CompleteRecordSchema,
]);

export type PendingRecord = z.infer<typeof PendingRecordSchema>;
export type CompleteRecord = z.infer<typeof CompleteRecordSchema>;
export type IdempotencyRecord = z.infer<typeof IdempotencyRecordSchema>;

/**
 * The result of trying to reserve a slot for an incoming request.
 */
export type ReserveOutcome =
  | { kind: 'reserved' }
  | { kind: 'replay'; record: CompleteRecord }
  | { kind: 'in_progress'; record: PendingRecord }
  | { kind: 'conflict'; record: IdempotencyRecord };
