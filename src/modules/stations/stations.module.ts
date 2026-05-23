import { Module } from '@nestjs/common';

import { AuthModule } from '@/modules/auth/auth.module';

import { AdminStationsController } from './controllers/admin-stations.controller';
import { StationsController } from './controllers/stations.controller';
import { StationRepository } from './repositories/station.repository';
import { AdminStationsService } from './services/admin-stations.service';
import { StationService } from './services/station.service';

@Module({
  imports: [AuthModule],
  controllers: [StationsController, AdminStationsController],
  providers: [StationService, AdminStationsService, StationRepository],
  exports: [StationService, StationRepository],
})
export class StationsModule {}
