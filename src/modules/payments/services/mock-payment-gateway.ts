import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';

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
 * Stable HMAC secret used by the mock so the dashboard's webhook simulator
 * can sign payloads with a known value. Not a real secret — never use in prod.
 */
const MOCK_WEBHOOK_SECRET = 'mock_webhook_secret_do_not_use_in_prod';

@Injectable()
export class MockPaymentGateway implements PaymentGateway {
  readonly name = 'mock';
  private readonly logger = new Logger(MockPaymentGateway.name);

  constructor(private readonly config: AppConfigService) {}

  async tokenize(input: TokenizeInput): Promise<TokenizeResult> {
    this.logger.log(
      { userId: input.userId, lastFour: input.lastFour, brand: input.brand },
      'MockPaymentGateway.tokenize',
    );
    return await Promise.resolve({
      gatewayToken: `mock_pm_${randomUUID()}`,
      brand: input.brand,
    });
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const behavior = this.config.get('MOCK_GATEWAY_BEHAVIOR');
    const transactionId = `mock_txn_${randomUUID()}`;

    this.logger.log(
      { userId: input.userId, amount: input.amount, currency: input.currency, behavior },
      'MockPaymentGateway.charge',
    );

    if (behavior === 'always_decline') {
      return await Promise.resolve({
        transactionId,
        status: 'rejected',
        gatewayMessage: 'Mock gateway configured to decline',
      });
    }

    if (behavior === 'random' && Math.random() < 0.2) {
      return await Promise.resolve({
        transactionId,
        status: 'rejected',
        gatewayMessage: 'Mock gateway random decline',
      });
    }

    return await Promise.resolve({
      transactionId,
      status: 'approved',
      gatewayMessage: 'Mock gateway approved',
    });
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    this.logger.log(
      { transactionId: input.transactionId, amount: input.amount },
      'MockPaymentGateway.refund',
    );
    return await Promise.resolve({
      refundId: `mock_refund_${randomUUID()}`,
      status: 'approved',
    });
  }

  /**
   * Verifies a SHA-256 HMAC signature on the raw webhook body. The signature
   * header is expected as `sha256=<hex>`. Uses timingSafeEqual to defend
   * against timing attacks (CLAUDE.md §2.7).
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean {
    if (!signatureHeader || typeof signatureHeader !== 'string') return false;
    const prefix = 'sha256=';
    const provided = signatureHeader.startsWith(prefix)
      ? signatureHeader.slice(prefix.length)
      : signatureHeader;

    const expected = createHmac('sha256', MOCK_WEBHOOK_SECRET).update(rawBody).digest('hex');

    let providedBuf: Buffer;
    let expectedBuf: Buffer;
    try {
      providedBuf = Buffer.from(provided, 'hex');
      expectedBuf = Buffer.from(expected, 'hex');
    } catch {
      return false;
    }
    if (providedBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(providedBuf, expectedBuf);
  }

  parseWebhookEvent(rawBody: Buffer): NormalizedWebhookEvent {
    let payload: { type?: string; transactionId?: string; refundId?: string; message?: string };
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as typeof payload;
    } catch {
      return {
        type: 'unknown',
        transactionId: '',
        message: 'Malformed JSON',
        raw: null,
      };
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

export const MOCK_WEBHOOK_SECRET_FOR_TESTS = MOCK_WEBHOOK_SECRET;
