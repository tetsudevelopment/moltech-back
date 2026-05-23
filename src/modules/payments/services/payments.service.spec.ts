import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';
import { PaymentMethodRepository } from '@/modules/rentals/repositories/payment-method.repository';

import { PaymentsService } from './payments.service';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../domain/payment-gateway.types';
import { PaymentRepository, type PaymentView } from '../repositories/payment.repository';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-9222-222222222222';
const PAYMENT_ID = '33333333-3333-4333-a333-333333333333';
const PM_ID = '44444444-4444-4444-b444-444444444444';

function paymentFixture(overrides: Partial<PaymentView> = {}): PaymentView {
  return {
    id: PAYMENT_ID,
    rentalId: 'r1',
    userId: USER_ID,
    paymentMethodId: PM_ID,
    concept: 'rental',
    amount: '15000.00',
    currency: 'COP',
    gateway: 'other',
    transactionId: 'mock_txn_1',
    merchantId: null,
    status: 'approved',
    gatewayMessage: null,
    attemptedAt: new Date('2026-05-18T10:00:00Z'),
    updatedAt: new Date('2026-05-18T10:00:00Z'),
    ...overrides,
  };
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let repo: jest.Mocked<PaymentRepository>;
  let methods: jest.Mocked<PaymentMethodRepository>;
  let gateway: jest.Mocked<PaymentGateway>;
  let emitter: { emit: jest.Mock };

  beforeEach(async () => {
    repo = {
      findById: jest.fn(),
      findByGatewayTxn: jest.fn(),
      listForUser: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<PaymentRepository>;
    methods = {
      findByIdForUser: jest.fn(),
      listForUser: jest.fn(),
      create: jest.fn(),
      markDeleted: jest.fn(),
    } as unknown as jest.Mocked<PaymentMethodRepository>;
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
        PaymentsService,
        { provide: PaymentRepository, useValue: repo },
        { provide: PaymentMethodRepository, useValue: methods },
        { provide: PAYMENT_GATEWAY, useValue: gateway },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  describe('findOwned()', () => {
    it('throws PAYMENT_NOT_FOUND when missing', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.findOwned(PAYMENT_ID, USER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
    it('throws PAYMENT_NOT_OWNED when belongs to another user', async () => {
      repo.findById.mockResolvedValue(paymentFixture({ userId: OTHER_USER }));
      await expect(service.findOwned(PAYMENT_ID, USER_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
    it('returns the payment when owned', async () => {
      repo.findById.mockResolvedValue(paymentFixture());
      const result = await service.findOwned(PAYMENT_ID, USER_ID);
      expect(result.id).toBe(PAYMENT_ID);
    });
  });

  describe('refund()', () => {
    it('rejects refund when payment is not approved', async () => {
      repo.findById.mockResolvedValue(paymentFixture({ status: 'pending' }));
      await expect(service.refund(PAYMENT_ID, USER_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('rejects refund when the gateway rejects', async () => {
      repo.findById.mockResolvedValue(paymentFixture());
      gateway.refund.mockResolvedValue({ refundId: 'r1', status: 'rejected' });
      await expect(service.refund(PAYMENT_ID, USER_ID)).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('updates status to refunded and emits payment.refunded on success', async () => {
      repo.findById.mockResolvedValue(paymentFixture());
      gateway.refund.mockResolvedValue({ refundId: 'mock_refund_1', status: 'approved' });
      repo.update.mockResolvedValue(paymentFixture({ status: 'refunded' }));

      const result = await service.refund(PAYMENT_ID, USER_ID, { requestId: 'req-1' });

      expect(gateway.refund).toHaveBeenCalledWith({
        transactionId: 'mock_txn_1',
        amount: '15000.00',
        currency: 'COP',
      });
      expect(repo.update).toHaveBeenCalledWith(PAYMENT_ID, {
        status: 'refunded',
        gatewayMessage: 'Refund mock_refund_1 approved',
      });
      expect(result.status).toBe('refunded');
      expect(emitter.emit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'payment.refunded',
          actor: USER_ID,
          requestId: 'req-1',
        }),
      );
    });
  });

  describe('retry()', () => {
    it('rejects retry when status is not pending/error', async () => {
      repo.findById.mockResolvedValue(paymentFixture({ status: 'approved' }));
      await expect(service.retry(PAYMENT_ID, USER_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(gateway.charge).not.toHaveBeenCalled();
    });

    it('rejects retry when payment_method is missing', async () => {
      repo.findById.mockResolvedValue(paymentFixture({ status: 'error', paymentMethodId: null }));
      await expect(service.retry(PAYMENT_ID, USER_ID)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects retry when payment_method is no longer active', async () => {
      repo.findById.mockResolvedValue(paymentFixture({ status: 'error' }));
      methods.findByIdForUser.mockResolvedValue({
        id: PM_ID,
        userId: USER_ID,
        status: 'deleted',
        gatewayToken: 'tok',
      });
      await expect(service.retry(PAYMENT_ID, USER_ID)).rejects.toBeInstanceOf(ConflictException);
    });

    it('charges via gateway and updates the row to approved on success', async () => {
      repo.findById.mockResolvedValue(paymentFixture({ status: 'error' }));
      methods.findByIdForUser.mockResolvedValue({
        id: PM_ID,
        userId: USER_ID,
        status: 'active',
        gatewayToken: 'tok',
      });
      gateway.charge.mockResolvedValue({
        transactionId: 'mock_txn_2',
        status: 'approved',
        gatewayMessage: 'ok',
      });
      repo.update.mockResolvedValue(
        paymentFixture({ status: 'approved', transactionId: 'mock_txn_2' }),
      );

      const result = await service.retry(PAYMENT_ID, USER_ID);

      expect(gateway.charge).toHaveBeenCalledWith({
        amount: '15000.00',
        currency: 'COP',
        description: `Retry payment ${PAYMENT_ID}`,
        userId: USER_ID,
        paymentMethodToken: 'tok',
      });
      expect(result.status).toBe('approved');
      expect(result.transactionId).toBe('mock_txn_2');
      expect(emitter.emit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining({ action: 'payment.charged' }),
      );
    });

    it('throws PAYMENT_DECLINED and emits payment.declined on rejection', async () => {
      repo.findById.mockResolvedValue(paymentFixture({ status: 'error' }));
      methods.findByIdForUser.mockResolvedValue({
        id: PM_ID,
        userId: USER_ID,
        status: 'active',
        gatewayToken: 'tok',
      });
      gateway.charge.mockResolvedValue({
        transactionId: 'mock_txn_3',
        status: 'rejected',
        gatewayMessage: 'Insufficient funds',
      });
      repo.update.mockResolvedValue(paymentFixture({ status: 'rejected' }));

      await expect(service.retry(PAYMENT_ID, USER_ID)).rejects.toBeInstanceOf(BadRequestException);
      expect(emitter.emit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining({ action: 'payment.declined' }),
      );
    });
  });
});
