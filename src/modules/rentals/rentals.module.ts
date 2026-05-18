import { Module } from '@nestjs/common';

import { AuthModule } from '@/modules/auth/auth.module';

import { RentalsController } from './controllers/rentals.controller';
import { PaymentMethodRepository } from './repositories/payment-method.repository';
import { PowerBankRepository } from './repositories/power-bank.repository';
import { RentalRepository } from './repositories/rental.repository';
import { RentalService } from './services/rental.service';

@Module({
  imports: [AuthModule],
  controllers: [RentalsController],
  providers: [RentalService, RentalRepository, PowerBankRepository, PaymentMethodRepository],
  exports: [RentalService, RentalRepository],
})
export class RentalsModule {}
