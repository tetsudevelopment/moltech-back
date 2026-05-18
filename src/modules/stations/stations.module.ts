import { Module } from '@nestjs/common';

import { AuthModule } from '@/modules/auth/auth.module';

import { StationsController } from './controllers/stations.controller';
import { StationRepository } from './repositories/station.repository';
import { StationService } from './services/station.service';

@Module({
  imports: [AuthModule],
  controllers: [StationsController],
  providers: [StationService, StationRepository],
  exports: [StationService, StationRepository],
})
export class StationsModule {}
