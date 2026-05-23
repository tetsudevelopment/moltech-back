import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { UuidSchema } from '@/common/validation/common.schema';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import { AdminAuthGuard } from '@/modules/auth/guards/admin-auth.guard';

import {
  CreateStationSchema,
  type CreateStationDto,
  UpdateStationSchema,
  type UpdateStationDto,
} from '../dtos/create-station.dto';
import {
  AdminStationsService,
  type PowerBankAtStation,
  type Station,
  type StationState,
  type StationStateSummary,
} from '../services/admin-stations.service';

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
  status: Station['status'];
  description: string | null;
  opening_time: string | null;
  closing_time: string | null;
  created_at: string;
  power_banks_count: number;
}

interface PublicStationState {
  station: PublicStation;
  power_banks: {
    id: string;
    code: string;
    model: string | null;
    status: PowerBankAtStation['status'];
    battery_level: number;
    qr_code: string;
    created_at: string;
    updated_at: string;
  }[];
  summary: StationStateSummary;
}

@Controller('admin/stations')
@UseGuards(AdminAuthGuard)
export class AdminStationsController {
  constructor(private readonly service: AdminStationsService) {}

  @Get()
  async list(): Promise<{ stations: PublicStation[]; total: number }> {
    const result = await this.service.list();
    return { stations: result.data.map(serialize), total: result.total };
  }

  @Get(':id')
  async get(
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
  ): Promise<{ station: PublicStation }> {
    const station = await this.service.findById(id);
    return { station: serialize(station) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() current: { id: string },
    @Body(new ZodValidationPipe(CreateStationSchema)) dto: CreateStationDto,
    @Req() req: Request & { id?: string },
  ): Promise<{ station: PublicStation }> {
    const created = await this.service.create(current.id, dto, {
      requestId: req.id,
      ip: req.ip,
    });
    return { station: serialize(created) };
  }

  @Patch(':id')
  async update(
    @CurrentUser() current: { id: string },
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateStationSchema)) dto: UpdateStationDto,
    @Req() req: Request & { id?: string },
  ): Promise<{ station: PublicStation }> {
    const updated = await this.service.update(id, current.id, dto, {
      requestId: req.id,
      ip: req.ip,
    });
    return { station: serialize(updated) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() current: { id: string },
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
    @Req() req: Request & { id?: string },
  ): Promise<void> {
    await this.service.delete(id, current.id, { requestId: req.id, ip: req.ip });
  }

  @Get(':id/state')
  async getState(
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
  ): Promise<PublicStationState> {
    const state = await this.service.getState(id);
    return serializeState(state);
  }
}

function serialize(station: Station): PublicStation {
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
    opening_time: station.openingTime ? station.openingTime.toISOString() : null,
    closing_time: station.closingTime ? station.closingTime.toISOString() : null,
    created_at: station.createdAt.toISOString(),
    power_banks_count: station.powerBanksCount,
  };
}

function serializeState(state: StationState): PublicStationState {
  return {
    station: serialize(state.station),
    power_banks: state.powerBanks.map((pb) => ({
      id: pb.id,
      code: pb.code,
      model: pb.model,
      status: pb.status,
      battery_level: pb.batteryLevel,
      qr_code: pb.qrCode,
      created_at: pb.createdAt.toISOString(),
      updated_at: pb.updatedAt.toISOString(),
    })),
    summary: state.summary,
  };
}
