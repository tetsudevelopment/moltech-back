import { Test, type TestingModule } from '@nestjs/testing';

import { AppConfigService } from '@/config/config.service';

import { MockPaymentGateway } from './mock-payment-gateway';

describe('MockPaymentGateway', () => {
  const mockGet = jest.fn();

  async function buildGateway(): Promise<MockPaymentGateway> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MockPaymentGateway, { provide: AppConfigService, useValue: { get: mockGet } }],
    }).compile();
    return module.get<MockPaymentGateway>(MockPaymentGateway);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('charge()', () => {
    it('returns approved when MOCK_GATEWAY_BEHAVIOR=always_success', async () => {
      mockGet.mockReturnValue('always_success');
      const gateway = await buildGateway();

      const result = await gateway.charge({
        amount: '15000.00',
        currency: 'COP',
        description: 'Rental power bank 1h',
        userId: 'user-uuid-1',
        paymentMethodToken: 'tok_visa',
      });

      expect(result.status).toBe('approved');
      expect(result.transactionId).toMatch(/^mock_txn_/);
    });

    it('returns rejected when MOCK_GATEWAY_BEHAVIOR=always_decline', async () => {
      mockGet.mockReturnValue('always_decline');
      const gateway = await buildGateway();

      const result = await gateway.charge({
        amount: '15000.00',
        currency: 'COP',
        description: 'Test',
        userId: 'u',
        paymentMethodToken: 't',
      });

      expect(result.status).toBe('rejected');
    });
  });

  describe('refund()', () => {
    it('returns approved with a mock refund id', async () => {
      mockGet.mockReturnValue('always_success');
      const gateway = await buildGateway();

      const result = await gateway.refund({
        transactionId: 'mock_txn_abc',
        amount: '5000.00',
        currency: 'COP',
      });

      expect(result.status).toBe('approved');
      expect(result.refundId).toMatch(/^mock_refund_/);
    });
  });
});
