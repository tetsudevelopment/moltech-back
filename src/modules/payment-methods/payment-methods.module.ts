import { Module } from '@nestjs/common';

import { AuthModule } from '@/modules/auth/auth.module';
import { RentalsModule } from '@/modules/rentals/rentals.module';

import { PaymentMethodsController } from './controllers/payment-methods.controller';
import { PaymentMethodsService } from './services/payment-methods.service';

@Module({
  imports: [AuthModule, RentalsModule],
  controllers: [PaymentMethodsController],
  providers: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
