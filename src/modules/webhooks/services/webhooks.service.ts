import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { payment_status_enum } from '@prisma/client';

import {
  AUDIT_RECORDED_EVENT,
  type AuditAction,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';
import {
  PAYMENT_GATEWAY,
  type NormalizedWebhookEvent,
  type NormalizedWebhookEventType,
  type PaymentGateway,
} from '@/modules/payments/domain/payment-gateway.types';
import { PaymentRepository } from '@/modules/payments/repositories/payment.repository';

export interface WebhookHandleResult {
  received: boolean;
  /** 'applied' = state changed; 'noop' = idempotent replay; 'ignored' = unknown event. */
  outcome: 'applied' | 'noop' | 'ignored';
  eventType: NormalizedWebhookEventType;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly repo: PaymentRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly emitter: EventEmitter2,
  ) {}

  async handle(
    rawBody: Buffer,
    signatureHeader: string | undefined,
    requestId?: string,
  ): Promise<WebhookHandleResult> {
    if (!signatureHeader || !this.gateway.verifyWebhookSignature(rawBody, signatureHeader)) {
      this.logger.warn(
        { signaturePresent: Boolean(signatureHeader), requestId },
        'Webhook signature invalid',
      );
      throw new UnauthorizedException({
        code: 'WEBHOOK_SIGNATURE_INVALID',
        message: 'Webhook signature could not be verified',
      });
    }

    const event = this.gateway.parseWebhookEvent(rawBody);

    if (event.type === 'unknown') {
      this.logger.warn({ event, requestId }, 'Webhook event type unknown — returning 200');
      return { received: true, outcome: 'ignored', eventType: 'unknown' };
    }
    if (!event.transactionId) {
      this.logger.warn({ event, requestId }, 'Webhook missing transactionId — returning 200');
      return { received: true, outcome: 'ignored', eventType: event.type };
    }

    const payment = await this.repo.findByGatewayTxn(this.gatewayEnumValue(), event.transactionId);

    if (!payment) {
      this.logger.warn(
        { transactionId: event.transactionId, requestId },
        'Webhook references unknown transaction — returning 200',
      );
      return { received: true, outcome: 'ignored', eventType: event.type };
    }

    const targetStatus = this.eventToStatus(event.type);
    if (payment.status === targetStatus) {
      // Already in target state — idempotent replay, do not duplicate side effects.
      this.emitAudit(this.actionFor(event), payment.userId, requestId, {
        paymentId: payment.id,
        transactionId: event.transactionId,
        replay: true,
      });
      return { received: true, outcome: 'noop', eventType: event.type };
    }

    await this.repo.update(payment.id, {
      status: targetStatus,
      gatewayMessage: event.message ?? null,
    });

    this.emitAudit(this.actionFor(event), payment.userId, requestId, {
      paymentId: payment.id,
      transactionId: event.transactionId,
      refundId: event.refundId,
      status: targetStatus,
    });

    return { received: true, outcome: 'applied', eventType: event.type };
  }

  private gatewayEnumValue(): 'other' {
    // Mock and PaymentsWay both share the 'other' enum slot in the current
    // schema (paymentsway is not yet in payment_gateway_enum). When the schema
    // is migrated to include 'paymentsway', update this mapping.
    return 'other';
  }

  private eventToStatus(type: NormalizedWebhookEventType): payment_status_enum {
    switch (type) {
      case 'payment.approved':
        return 'approved';
      case 'payment.declined':
        return 'rejected';
      case 'payment.refunded':
        return 'refunded';
      case 'payment.error':
        return 'error';
      case 'unknown':
        return 'error';
    }
  }

  private actionFor(event: NormalizedWebhookEvent): AuditAction {
    switch (event.type) {
      case 'payment.approved':
        return 'payment.charged';
      case 'payment.declined':
        return 'payment.declined';
      case 'payment.refunded':
        return 'payment.refunded';
      case 'payment.error':
      case 'unknown':
        return 'payment.declined';
    }
  }

  private emitAudit(
    action: AuditAction,
    actor: string,
    requestId: string | undefined,
    metadata: Record<string, unknown>,
  ): void {
    const evt: AuditRecordedEvent = {
      action,
      actor,
      timestamp: new Date().toISOString(),
      ...(requestId !== undefined ? { requestId } : {}),
      metadata,
    };
    this.emitter.emit(AUDIT_RECORDED_EVENT, evt);
  }
}
