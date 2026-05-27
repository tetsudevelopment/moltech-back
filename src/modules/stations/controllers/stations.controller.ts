import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { type PaginatedResponse } from '@/common/interceptors/pagination.types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { UuidSchema } from '@/common/validation/common.schema';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';

import { type Station, type StationStatus } from '../domain/station.types';
import { type ListStationsQueryDto, ListStationsQuerySchema } from '../dtos/list-stations.dto';
import { type AvailablePowerBank, StationService } from '../services/station.service';

interface PublicPowerBank {
  id: string;
  code: string;
  battery_level: number;
}

interface PublicStation {
  id: string;
  name: string;
  city: string;
  zone: string | null;
  address: string;
  latitude: string;
  longitude: string;
  hourly_rate: string;
  currency: string;
  total_capacity: number;
  status: StationStatus;
  description: string | null;
  opening_time: string | null;
  closing_time: string | null;
  created_at: string;
  available_power_banks: number;
}

type PublicStationDetail = PublicStation;

@Controller('stations')
@UseGuards(JwtAuthGuard)
export class StationsController {
  constructor(private readonly stationService: StationService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListStationsQuerySchema)) query: ListStationsQueryDto,
  ): Promise<PaginatedResponse<PublicStation>> {
    const result = await this.stationService.list({
      ...(query.city !== undefined ? { city: query.city } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.page !== undefined ? { page: query.page } : {}),
      ...(query.page_size !== undefined ? { pageSize: query.page_size } : {}),
    });
    const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
    return {
      data: result.data.map(serializeStation),
      pagination: {
        page: result.page,
        page_size: result.pageSize,
        total: result.total,
        total_pages: totalPages,
        has_next: result.page < totalPages,
        has_previous: result.page > 1,
      },
    };
  }

  @Get(':id')
  async getById(
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
  ): Promise<PublicStationDetail> {
    const station = await this.stationService.getById(id);
    return serializeStation(station);
  }

  @Get(':id/power-banks')
  async getAvailablePowerBanks(
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
  ): Promise<PublicPowerBank[]> {
    const powerBanks = await this.stationService.getAvailablePowerBanks(id);
    return powerBanks.map(serializePowerBank);
  }
}

function serializePowerBank(pb: AvailablePowerBank): PublicPowerBank {
  return {
    id: pb.id,
    code: pb.code,
    battery_level: pb.batteryLevel,
  };
}

function serializeStation(station: Station): PublicStation {
  return {
    id: station.id,
    name: station.name,
    city: station.city,
    zone: station.zone,
    address: station.address,
    latitude: station.latitude,
    longitude: station.longitude,
    hourly_rate: station.hourlyRate,
    currency: station.currency,
    total_capacity: station.totalCapacity,
    status: station.status,
    description: station.description,
    opening_time: station.openingTime?.toISOString() ?? null,
    closing_time: station.closingTime?.toISOString() ?? null,
    created_at: station.createdAt.toISOString(),
    available_power_banks: station.availablePowerBanks,
  };
}
