import { Global, Module } from '@nestjs/common';

import { PAYMENT_GATEWAY } from './domain/payment-gateway.types';
import { MockPaymentGateway } from './services/mock-payment-gateway';

@Global()
@Module({
  providers: [
    MockPaymentGateway,
    {
      provide: PAYMENT_GATEWAY,
      useExisting: MockPaymentGateway,
    },
  ],
  exports: [PAYMENT_GATEWAY],
})
export class PaymentsModule {}
