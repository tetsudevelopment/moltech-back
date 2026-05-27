import { Injectable, NotFoundException } from '@nestjs/common';

import { type Station, type StationStatus } from '../domain/station.types';
import {
  type AvailablePowerBank,
  type PaginatedStations,
  StationRepository,
} from '../repositories/station.repository';

export type { AvailablePowerBank };

export interface ListStationsFilters {
  city?: string;
  status?: StationStatus;
  page?: number;
  pageSize?: number;
}

// Station already carries availablePowerBanks from the domain; keep the alias for
// consumers that reference StationDetail explicitly.
export type StationDetail = Station;

@Injectable()
export class StationService {
  constructor(private readonly stations: StationRepository) {}

  list(filters: ListStationsFilters): Promise<PaginatedStations> {
    return this.stations.list(filters);
  }

  async getById(id: string): Promise<StationDetail> {
    const station = await this.stations.findById(id);
    if (!station) {
      throw new NotFoundException({
        code: 'STATION_NOT_FOUND',
        message: 'Station not found',
      });
    }
    return station;
  }

  async getAvailablePowerBanks(id: string): Promise<AvailablePowerBank[]> {
    const station = await this.stations.findById(id);
    if (!station) {
      throw new NotFoundException({
        code: 'STATION_NOT_FOUND',
        message: 'Station not found',
      });
    }
    return this.stations.findAvailablePowerBanks(id);
  }
}
