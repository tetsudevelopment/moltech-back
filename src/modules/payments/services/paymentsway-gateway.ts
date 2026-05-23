import { createHmac, timingSafeEqual } from 'crypto';

import { Injectable, Logger, NotImplementedException } from '@nestjs/common';

import { AppConfigService } from '@/config/config.service';

import {
  type ChargeInput,
  type ChargeResult,
  type NormalizedWebhookEvent,
  type NormalizedWebhookEventType,
  type PaymentGateway,
  type RefundInput,
  type RefundResult,
  type TokenizeInput,
  type TokenizeResult,
} from '../domain/payment-gateway.types';

/**
 * Stub adapter for PaymentsWay. The official gateway docs haven't landed yet;
 * once they do, fill in `tokenize`, `charge`, and `refund` with real HTTP calls.
 *
 * What IS implemented today:
 *   - HMAC-SHA256 signature verification using PAYMENTSWAY_WEBHOOK_SECRET
 *     (so the dashboard's webhook simulator can sign payloads against a real env-driven secret).
 *   - JSON parsing into the normalized event shape.
 *
 * What is NOT yet implemented (throws NotImplementedException):
 *   - tokenize, charge, refund — the synchronous gateway calls.
 */
@Injectable()
export class PaymentsWayGateway implements PaymentGateway {
  readonly name = 'paymentsway';
  private readonly logger = new Logger(PaymentsWayGateway.name);

  constructor(private readonly config: AppConfigService) {}

  tokenize(input: TokenizeInput): Promise<TokenizeResult> {
    this.logger.warn(
      { userId: input.userId, lastFour: input.lastFour },
      'PaymentsWay.tokenize called but not implemented yet',
    );
    return Promise.reject(
      new NotImplementedException({
        code: 'GATEWAY_NOT_IMPLEMENTED',
        message: 'PaymentsWay tokenize is not yet implemented — awaiting official SDK docs',
      }),
    );
  }

  charge(input: ChargeInput): Promise<ChargeResult> {
    this.logger.warn(
      { userId: input.userId, amount: input.amount },
      'PaymentsWay.charge called but not implemented yet',
    );
    return Promise.reject(
      new NotImplementedException({
        code: 'GATEWAY_NOT_IMPLEMENTED',
        message: 'PaymentsWay charge is not yet implemented — awaiting official SDK docs',
      }),
    );
  }

  refund(input: RefundInput): Promise<RefundResult> {
    this.logger.warn(
      { transactionId: input.transactionId, amount: input.amount },
      'PaymentsWay.refund called but not implemented yet',
    );
    return Promise.reject(
      new NotImplementedException({
        code: 'GATEWAY_NOT_IMPLEMENTED',
        message: 'PaymentsWay refund is not yet implemented — awaiting official SDK docs',
      }),
    );
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean {
    if (!signatureHeader || typeof signatureHeader !== 'string') return false;
    const secret = this.config.get('PAYMENTSWAY_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error('PAYMENTSWAY_WEBHOOK_SECRET is missing — cannot verify signature');
      return false;
    }

    const prefix = 'sha256=';
    const provided = signatureHeader.startsWith(prefix)
      ? signatureHeader.slice(prefix.length)
      : signatureHeader;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

    let pb: Buffer;
    let eb: Buffer;
    try {
      pb = Buffer.from(provided, 'hex');
      eb = Buffer.from(expected, 'hex');
    } catch {
      return false;
    }
    if (pb.length !== eb.length) return false;
    return timingSafeEqual(pb, eb);
  }

  parseWebhookEvent(rawBody: Buffer): NormalizedWebhookEvent {
    let payload: { type?: string; transactionId?: string; refundId?: string; message?: string };
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as typeof payload;
    } catch {
      return { type: 'unknown', transactionId: '', message: 'Malformed JSON', raw: null };
    }
    const allowed: NormalizedWebhookEventType[] = [
      'payment.approved',
      'payment.declined',
      'payment.refunded',
      'payment.error',
    ];
    const type: NormalizedWebhookEventType = allowed.includes(
      payload.type as NormalizedWebhookEventType,
    )
      ? (payload.type as NormalizedWebhookEventType)
      : 'unknown';
    return {
      type,
      transactionId: payload.transactionId ?? '',
      ...(payload.refundId !== undefined ? { refundId: payload.refundId } : {}),
      ...(payload.message !== undefined ? { message: payload.message } : {}),
      raw: payload,
    };
  }
}
