import { UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';
import {
  PAYMENT_GATEWAY,
  type NormalizedWebhookEvent,
  type PaymentGateway,
} from '@/modules/payments/domain/payment-gateway.types';
import {
  PaymentRepository,
  type PaymentView,
} from '@/modules/payments/repositories/payment.repository';

import { WebhooksService } from './webhooks.service';

const TXN = 'mock_txn_1';
const USER = 'user-1';
const PAYMENT_ID = 'pay-1';

function paymentFixture(overrides: Partial<PaymentView> = {}): PaymentView {
  return {
    id: PAYMENT_ID,
    rentalId: 'r1',
    userId: USER,
    paymentMethodId: 'pm-1',
    concept: 'rental',
    amount: '15000.00',
    currency: 'COP',
    gateway: 'other',
    transactionId: TXN,
    merchantId: null,
    status: 'pending',
    gatewayMessage: null,
    attemptedAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('WebhooksService', () => {
  let service: WebhooksService;
  let repo: jest.Mocked<PaymentRepository>;
  let gateway: jest.Mocked<PaymentGateway>;
  let emitter: { emit: jest.Mock };

  const SIG = 'sha256=valid';

  beforeEach(async () => {
    repo = {
      findById: jest.fn(),
      findByGatewayTxn: jest.fn(),
      listForUser: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<PaymentRepository>;
    gateway = {
      name: 'mock',
      tokenize: jest.fn(),
      charge: jest.fn(),
      refund: jest.fn(),
      verifyWebhookSignature: jest.fn(),
      parseWebhookEvent: jest.fn(),
    };
    emitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PaymentRepository, useValue: repo },
        { provide: PAYMENT_GATEWAY, useValue: gateway },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();

    service = module.get(WebhooksService);
  });

  it('rejects with WEBHOOK_SIGNATURE_INVALID when no signature header', async () => {
    await expect(service.handle(Buffer.from('{}'), undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(gateway.parseWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects with WEBHOOK_SIGNATURE_INVALID when HMAC verification fails', async () => {
    gateway.verifyWebhookSignature.mockReturnValue(false);
    await expect(service.handle(Buffer.from('{}'), 'bad-sig')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(gateway.parseWebhookEvent).not.toHaveBeenCalled();
  });

  it('returns 200 ignored for unknown event types', async () => {
    gateway.verifyWebhookSignature.mockReturnValue(true);
    gateway.parseWebhookEvent.mockReturnValue({
      type: 'unknown',
      transactionId: TXN,
      raw: {},
    });
    const result = await service.handle(Buffer.from('{}'), SIG);
    expect(result).toEqual({ received: true, outcome: 'ignored', eventType: 'unknown' });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('returns 200 ignored for events with missing transactionId', async () => {
    gateway.verifyWebhookSignature.mockReturnValue(true);
    gateway.parseWebhookEvent.mockReturnValue({
      type: 'payment.approved',
      transactionId: '',
      raw: {},
    });
    const result = await service.handle(Buffer.from('{}'), SIG);
    expect(result.outcome).toBe('ignored');
  });

  it('returns 200 ignored when the transaction does not match any payment', async () => {
    gateway.verifyWebhookSignature.mockReturnValue(true);
    gateway.parseWebhookEvent.mockReturnValue({
      type: 'payment.approved',
      transactionId: 'nonexistent',
      raw: {},
    });
    repo.findByGatewayTxn.mockResolvedValue(null);

    const result = await service.handle(Buffer.from('{}'), SIG);

    expect(result.outcome).toBe('ignored');
  });

  it('applies payment.approved → status=approved and emits payment.charged', async () => {
    gateway.verifyWebhookSignature.mockReturnValue(true);
    const event: NormalizedWebhookEvent = {
      type: 'payment.approved',
      transactionId: TXN,
      raw: {},
    };
    gateway.parseWebhookEvent.mockReturnValue(event);
    repo.findByGatewayTxn.mockResolvedValue(paymentFixture({ status: 'pending' }));
    repo.update.mockResolvedValue(paymentFixture({ status: 'approved' }));

    const result = await service.handle(Buffer.from('{}'), SIG, 'req-1');

    expect(repo.update).toHaveBeenCalledWith(PAYMENT_ID, {
      status: 'approved',
      gatewayMessage: null,
    });
    expect(result.outcome).toBe('applied');
    expect(emitter.emit).toHaveBeenCalledWith(
      AUDIT_RECORDED_EVENT,
      expect.objectContaining<Partial<AuditRecordedEvent>>({
        action: 'payment.charged',
        actor: USER,
      }),
    );
  });

  it('applies payment.declined → status=rejected', async () => {
    gateway.verifyWebhookSignature.mockReturnValue(true);
    gateway.parseWebhookEvent.mockReturnValue({
      type: 'payment.declined',
      transactionId: TXN,
      message: 'Insufficient funds',
      raw: {},
    });
    repo.findByGatewayTxn.mockResolvedValue(paymentFixture({ status: 'pending' }));
    repo.update.mockResolvedValue(paymentFixture({ status: 'rejected' }));

    const result = await service.handle(Buffer.from('{}'), SIG);

    expect(repo.update).toHaveBeenCalledWith(PAYMENT_ID, {
      status: 'rejected',
      gatewayMessage: 'Insufficient funds',
    });
    expect(result.outcome).toBe('applied');
  });

  it('applies payment.refunded → status=refunded with refundId in metadata', async () => {
    gateway.verifyWebhookSignature.mockReturnValue(true);
    gateway.parseWebhookEvent.mockReturnValue({
      type: 'payment.refunded',
      transactionId: TXN,
      refundId: 'mock_refund_1',
      raw: {},
    });
    repo.findByGatewayTxn.mockResolvedValue(paymentFixture({ status: 'approved' }));
    repo.update.mockResolvedValue(paymentFixture({ status: 'refunded' }));

    const result = await service.handle(Buffer.from('{}'), SIG);

    expect(repo.update).toHaveBeenCalledWith(PAYMENT_ID, {
      status: 'refunded',
      gatewayMessage: null,
    });
    expect(result.outcome).toBe('applied');
    const metadataMatcher = expect.objectContaining({ refundId: 'mock_refund_1' }) as unknown;
    expect(emitter.emit).toHaveBeenCalledWith(
      AUDIT_RECORDED_EVENT,
      expect.objectContaining({
        action: 'payment.refunded',
        metadata: metadataMatcher,
      }),
    );
  });

  it('is idempotent: returns outcome=noop on a replay where status already matches', async () => {
    gateway.verifyWebhookSignature.mockReturnValue(true);
    gateway.parseWebhookEvent.mockReturnValue({
      type: 'payment.approved',
      transactionId: TXN,
      raw: {},
    });
    repo.findByGatewayTxn.mockResolvedValue(paymentFixture({ status: 'approved' }));

    const result = await service.handle(Buffer.from('{}'), SIG);

    expect(result.outcome).toBe('noop');
    expect(repo.update).not.toHaveBeenCalled();
    // Audit is still emitted on replays for traceability (CLAUDE.md §2.7).
    expect(emitter.emit).toHaveBeenCalled();
  });
});
