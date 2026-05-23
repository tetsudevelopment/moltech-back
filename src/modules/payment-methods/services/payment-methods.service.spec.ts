import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from '@/modules/payments/domain/payment-gateway.types';
import {
  PaymentMethodRepository,
  type PaymentMethodView,
} from '@/modules/rentals/repositories/payment-method.repository';

import { PaymentMethodsService } from './payment-methods.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const METHOD_ID = '22222222-2222-4222-9222-222222222222';

const baseDto = {
  temporary_token: 'tmp_xyz_123',
  cardholder_name: 'JANE DOE',
  last_four_digits: '4242',
  expiry_month: 12,
  expiry_year: 2099,
  type: 'visa' as const,
  is_default: true,
};

function viewFixture(overrides: Partial<PaymentMethodView> = {}): PaymentMethodView {
  return {
    id: METHOD_ID,
    userId: USER_ID,
    type: 'visa',
    cardholderName: 'JANE DOE',
    lastFourDigits: '4242',
    expiryMonth: 12,
    expiryYear: 2099,
    isDefault: true,
    status: 'active',
    createdAt: new Date('2026-05-18T10:00:00Z'),
    ...overrides,
  };
}

describe('PaymentMethodsService', () => {
  let service: PaymentMethodsService;
  let repo: jest.Mocked<PaymentMethodRepository>;
  let gateway: jest.Mocked<PaymentGateway>;
  let emitter: { emit: jest.Mock };

  beforeEach(async () => {
    repo = {
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
        PaymentMethodsService,
        { provide: PaymentMethodRepository, useValue: repo },
        { provide: PAYMENT_GATEWAY, useValue: gateway },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();

    service = module.get(PaymentMethodsService);
  });

  describe('tokenizeAndStore()', () => {
    it('calls gateway.tokenize, stores the durable token, and emits payment_method.added', async () => {
      gateway.tokenize.mockResolvedValue({ gatewayToken: 'mock_pm_abc', brand: 'visa' });
      repo.create.mockResolvedValue(viewFixture());

      const result = await service.tokenizeAndStore(USER_ID, baseDto, {
        requestId: 'req-1',
        ip: '127.0.0.1',
      });

      expect(gateway.tokenize).toHaveBeenCalledWith({
        temporaryToken: 'tmp_xyz_123',
        userId: USER_ID,
        cardholderName: 'JANE DOE',
        lastFour: '4242',
        brand: 'visa',
        expMonth: 12,
        expYear: 2099,
      });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          gatewayToken: 'mock_pm_abc',
          type: 'visa',
          lastFourDigits: '4242',
          isDefault: true,
        }),
      );
      expect(result.id).toBe(METHOD_ID);

      expect(emitter.emit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'payment_method.added',
          actor: USER_ID,
          requestId: 'req-1',
          ip: '127.0.0.1',
        }),
      );
    });

    it('uses the gateway-returned brand when it overrides the input', async () => {
      gateway.tokenize.mockResolvedValue({ gatewayToken: 'mock_pm_xyz', brand: 'mastercard' });
      repo.create.mockResolvedValue(viewFixture({ type: 'mastercard' }));

      await service.tokenizeAndStore(USER_ID, baseDto);

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'mastercard' }));
    });

    it('rejects an expiry that is in the past with PAYMENT_METHOD_EXPIRED', async () => {
      await expect(
        service.tokenizeAndStore(USER_ID, {
          ...baseDto,
          expiry_year: 2026,
          expiry_month: 1,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(gateway.tokenize).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('list()', () => {
    it('forwards to repo.listForUser', async () => {
      repo.listForUser.mockResolvedValue([viewFixture()]);
      const result = await service.list(USER_ID);
      expect(result).toHaveLength(1);
      expect(repo.listForUser).toHaveBeenCalledWith(USER_ID);
    });
  });

  describe('remove()', () => {
    it('throws PAYMENT_METHOD_NOT_FOUND when the method is missing or not owned', async () => {
      repo.markDeleted.mockResolvedValue(null);
      await expect(service.remove(METHOD_ID, USER_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('emits payment_method.removed on success', async () => {
      repo.markDeleted.mockResolvedValue(viewFixture({ status: 'deleted', isDefault: false }));
      await service.remove(METHOD_ID, USER_ID, { requestId: 'req-2' });
      expect(emitter.emit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'payment_method.removed',
          actor: USER_ID,
          requestId: 'req-2',
        }),
      );
    });
  });
});
