import { Module } from '@nestjs/common';

import { AuthModule } from '@/modules/auth/auth.module';
import { RentalsModule } from '@/modules/rentals/rentals.module';

import { AdminPowerBanksController } from './controllers/admin-power-banks.controller';
import { AdminPowerBanksService } from './services/admin-power-banks.service';

@Module({
  imports: [AuthModule, RentalsModule],
  controllers: [AdminPowerBanksController],
  providers: [AdminPowerBanksService],
})
export class PowerBanksModule {}
