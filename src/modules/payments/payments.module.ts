import { Global, Logger, Module } from '@nestjs/common';

import { AppConfigService } from '@/config/config.service';
import { AuthModule } from '@/modules/auth/auth.module';
import { RentalsModule } from '@/modules/rentals/rentals.module';

import { AdminPaymentsController } from './controllers/admin-payments.controller';
import { PaymentsController } from './controllers/payments.controller';
import { PAYMENT_GATEWAY, type PaymentGateway } from './domain/payment-gateway.types';
import { PaymentRepository } from './repositories/payment.repository';
import { AdminPaymentsService } from './services/admin-payments.service';
import { MockPaymentGateway } from './services/mock-payment-gateway';
import { PaymentsService } from './services/payments.service';
import { PaymentsWayGateway } from './services/paymentsway-gateway';

@Global()
@Module({
  imports: [AuthModule, RentalsModule],
  controllers: [PaymentsController, AdminPaymentsController],
  providers: [
    MockPaymentGateway,
    PaymentsWayGateway,
    AdminPaymentsService,
    {
      // Factory selects the active gateway from env at boot.
      // PAYMENT_GATEWAY=mock → MockPaymentGateway (dev + tests)
      // PAYMENT_GATEWAY=paymentsway → PaymentsWayGateway (real, when SDK docs land)
      provide: PAYMENT_GATEWAY,
      inject: [AppConfigService, MockPaymentGateway, PaymentsWayGateway],
      useFactory: (
        config: AppConfigService,
        mock: MockPaymentGateway,
        paymentsway: PaymentsWayGateway,
      ): PaymentGateway => {
        const choice = config.get('PAYMENT_GATEWAY');
        const logger = new Logger('PaymentGatewayFactory');
        logger.log(`Active payment gateway: ${choice}`);
        return choice === 'paymentsway' ? paymentsway : mock;
      },
    },
    PaymentRepository,
    PaymentsService,
  ],
  exports: [PAYMENT_GATEWAY, PaymentRepository, PaymentsService],
})
export class PaymentsModule {}
