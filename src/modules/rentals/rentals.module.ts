import { Module } from '@nestjs/common';

import { AuthModule } from '@/modules/auth/auth.module';

import { AdminRentalsController } from './controllers/admin-rentals.controller';
import { RentalsController } from './controllers/rentals.controller';
import { PaymentMethodRepository } from './repositories/payment-method.repository';
import { PowerBankRepository } from './repositories/power-bank.repository';
import { RentalRepository } from './repositories/rental.repository';
import { AdminRentalsService } from './services/admin-rentals.service';
import { RentalService } from './services/rental.service';

@Module({
  imports: [AuthModule],
  controllers: [RentalsController, AdminRentalsController],
  providers: [
    RentalService,
    AdminRentalsService,
    RentalRepository,
    PowerBankRepository,
    PaymentMethodRepository,
  ],
  exports: [RentalService, RentalRepository, PaymentMethodRepository, PowerBankRepository],
})
export class RentalsModule {}
