export const AUDIT_ACTIONS = [
  'auth.login.success',
  'auth.login.failure',
  'auth.logout',
  'auth.register',
  'auth.password.reset.requested',
  'auth.password.reset.completed',
  'auth.email.verified',
  'auth.refresh.reused',
  'auth.refresh.rotated',
  'user.profile.updated',
  'user.deleted',
  'rental.started',
  'rental.finalized',
  'rental.canceled',
  'payment.charged',
  'payment.refunded',
  'payment.declined',
  'payment_method.added',
  'payment_method.removed',
  'coupon.applied',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_RECORDED_EVENT = 'audit.recorded';

export interface AuditRecordedEvent {
  /** Stable action identifier from AUDIT_ACTIONS. */
  action: AuditAction;
  /** Actor: user id (UUID) when authenticated, 'anonymous' for unauthenticated, 'system' for background jobs. */
  actor: string;
  /** Target resource: { type, id } when the action operates on a specific entity. */
  target?: { type: string; id: string };
  /** Request id from RequestIdMiddleware (for correlation). */
  requestId?: string;
  /** Source IP (best-effort). */
  ip?: string;
  /** Free-form metadata. MUST NOT contain PII (no email, no token, no password). */
  metadata?: Record<string, unknown>;
  /** ISO 8601 timestamp. Auto-populated by AuditService if omitted. */
  timestamp?: string;
}
