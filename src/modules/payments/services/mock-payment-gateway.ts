import { randomUUID } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '@/config/config.service';

import {
  type ChargeInput,
  type ChargeResult,
  type PaymentGateway,
  type RefundInput,
  type RefundResult,
} from '../domain/payment-gateway.types';

@Injectable()
export class MockPaymentGateway implements PaymentGateway {
  readonly name = 'mock';
  private readonly logger = new Logger(MockPaymentGateway.name);

  constructor(private readonly config: AppConfigService) {}

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
}
