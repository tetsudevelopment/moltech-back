import { createHmac } from 'crypto';

import { Test, type TestingModule } from '@nestjs/testing';

import { AppConfigService } from '@/config/config.service';

import { MOCK_WEBHOOK_SECRET_FOR_TESTS, MockPaymentGateway } from './mock-payment-gateway';

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

  describe('tokenize()', () => {
    it('returns a durable mock_pm_ token and echoes the brand', async () => {
      const gateway = await buildGateway();

      const result = await gateway.tokenize({
        temporaryToken: 'tmp_abc',
        userId: 'user-1',
        cardholderName: 'JANE DOE',
        lastFour: '4242',
        brand: 'visa',
        expMonth: 12,
        expYear: 28,
      });

      expect(result.gatewayToken).toMatch(/^mock_pm_/);
      expect(result.brand).toBe('visa');
    });
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

  describe('verifyWebhookSignature()', () => {
    function sign(body: Buffer): string {
      return `sha256=${createHmac('sha256', MOCK_WEBHOOK_SECRET_FOR_TESTS).update(body).digest('hex')}`;
    }

    it('accepts a correctly-signed body', async () => {
      const gateway = await buildGateway();
      const body = Buffer.from(JSON.stringify({ type: 'payment.approved', transactionId: 't' }));
      expect(gateway.verifyWebhookSignature(body, sign(body))).toBe(true);
    });

    it('accepts the hex form without the sha256= prefix', async () => {
      const gateway = await buildGateway();
      const body = Buffer.from('hello');
      const hex = createHmac('sha256', MOCK_WEBHOOK_SECRET_FOR_TESTS).update(body).digest('hex');
      expect(gateway.verifyWebhookSignature(body, hex)).toBe(true);
    });

    it('rejects a tampered body', async () => {
      const gateway = await buildGateway();
      const original = Buffer.from('original');
      const tampered = Buffer.from('tampered');
      expect(gateway.verifyWebhookSignature(tampered, sign(original))).toBe(false);
    });

    it('rejects an invalid header', async () => {
      const gateway = await buildGateway();
      const body = Buffer.from('x');
      expect(gateway.verifyWebhookSignature(body, 'not-a-signature')).toBe(false);
      expect(gateway.verifyWebhookSignature(body, '')).toBe(false);
    });
  });

  describe('parseWebhookEvent()', () => {
    it('parses approved/declined/refunded/error types', async () => {
      const gateway = await buildGateway();
      for (const t of [
        'payment.approved',
        'payment.declined',
        'payment.refunded',
        'payment.error',
      ] as const) {
        const evt = gateway.parseWebhookEvent(
          Buffer.from(JSON.stringify({ type: t, transactionId: 'tx-1' })),
        );
        expect(evt.type).toBe(t);
        expect(evt.transactionId).toBe('tx-1');
      }
    });

    it('returns unknown for unrecognized event types (does NOT throw)', async () => {
      const gateway = await buildGateway();
      const evt = gateway.parseWebhookEvent(
        Buffer.from(JSON.stringify({ type: 'novel.event', transactionId: 'tx-2' })),
      );
      expect(evt.type).toBe('unknown');
    });

    it('returns unknown with empty txn for malformed JSON', async () => {
      const gateway = await buildGateway();
      const evt = gateway.parseWebhookEvent(Buffer.from('{not-json'));
      expect(evt.type).toBe('unknown');
      expect(evt.transactionId).toBe('');
    });
  });
});
