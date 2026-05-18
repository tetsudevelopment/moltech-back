import { Injectable, NotFoundException } from '@nestjs/common';

import { type Station, type StationStatus } from '../domain/station.types';
import { type PaginatedStations, StationRepository } from '../repositories/station.repository';

export interface ListStationsFilters {
  city?: string;
  status?: StationStatus;
  page?: number;
  pageSize?: number;
}

export interface StationDetail extends Station {
  availablePowerBanks: number;
}

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
    const availablePowerBanks = await this.stations.countAvailablePowerBanks(id);
    return { ...station, availablePowerBanks };
  }
}
