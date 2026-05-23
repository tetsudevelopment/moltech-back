import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AUDIT_RECORDED_EVENT,
  type AuditAction,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';

import { type CreateStationDto, type UpdateStationDto } from '../dtos/create-station.dto';
import {
  StationRepository,
  type PaginatedStations,
  type PowerBankAtStation,
  type Station,
  type StationState,
  type StationStateSummary,
} from '../repositories/station.repository';

export type { PowerBankAtStation, Station, StationState, StationStateSummary };

export interface AdminContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

@Injectable()
export class AdminStationsService {
  constructor(
    private readonly repo: StationRepository,
    private readonly emitter: EventEmitter2,
  ) {}

  async create(
    actorId: string,
    dto: CreateStationDto,
    context: AdminContext = {},
  ): Promise<Station> {
    const created = await this.repo.create({
      name: dto.name,
      city: dto.city,
      zone: dto.zone ?? null,
      address: dto.address,
      latitude: dto.latitude,
      longitude: dto.longitude,
      hourlyRate: dto.hourly_rate,
      currency: dto.currency,
      totalCapacity: dto.total_capacity,
      status: dto.status,
      description: dto.description ?? null,
      openingTime: dto.opening_time ?? null,
      closingTime: dto.closing_time ?? null,
    });

    this.emit('admin.station.created', actorId, context, {
      stationId: created.id,
      name: created.name,
      city: created.city,
    });

    return created;
  }

  async update(
    id: string,
    actorId: string,
    dto: UpdateStationDto,
    context: AdminContext = {},
  ): Promise<Station> {
    const updated = await this.repo.update(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.city !== undefined ? { city: dto.city } : {}),
      ...(dto.zone !== undefined ? { zone: dto.zone } : {}),
      ...(dto.address !== undefined ? { address: dto.address } : {}),
      ...(dto.latitude !== undefined ? { latitude: dto.latitude } : {}),
      ...(dto.longitude !== undefined ? { longitude: dto.longitude } : {}),
      ...(dto.hourly_rate !== undefined ? { hourlyRate: dto.hourly_rate } : {}),
      ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      ...(dto.total_capacity !== undefined ? { totalCapacity: dto.total_capacity } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.opening_time !== undefined ? { openingTime: dto.opening_time } : {}),
      ...(dto.closing_time !== undefined ? { closingTime: dto.closing_time } : {}),
    });

    if (!updated) {
      throw new NotFoundException({
        code: 'STATION_NOT_FOUND',
        message: 'Station not found',
      });
    }

    this.emit('admin.station.updated', actorId, context, {
      stationId: id,
      changedFields: Object.keys(dto),
    });

    return updated;
  }

  async delete(id: string, actorId: string, context: AdminContext = {}): Promise<void> {
    const outcome = await this.repo.delete(id);
    if (outcome === 'not_found') {
      throw new NotFoundException({
        code: 'STATION_NOT_FOUND',
        message: 'Station not found',
      });
    }
    if (outcome === 'has_power_banks') {
      throw new ConflictException({
        code: 'STATION_HAS_POWER_BANKS',
        message: 'Cannot delete a station that still has power banks. Move or retire them first.',
      });
    }
    this.emit('admin.station.deleted', actorId, context, { stationId: id });
  }

  async list(): Promise<PaginatedStations> {
    return await this.repo.list({ pageSize: 100 });
  }

  async findById(id: string): Promise<Station> {
    const station = await this.repo.findById(id);
    if (!station) {
      throw new NotFoundException({
        code: 'STATION_NOT_FOUND',
        message: 'Station not found',
      });
    }
    return station;
  }

  async getState(id: string): Promise<StationState> {
    const state = await this.repo.getStateById(id);
    if (!state) {
      throw new NotFoundException({
        code: 'STATION_NOT_FOUND',
        message: 'Station not found',
      });
    }
    return state;
  }

  private emit(
    action: AuditAction,
    actor: string,
    context: AdminContext,
    metadata: Record<string, unknown>,
  ): void {
    const evt: AuditRecordedEvent = {
      action,
      actor,
      timestamp: new Date().toISOString(),
      ...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
      ...(context.ip !== undefined ? { ip: context.ip } : {}),
      metadata,
    };
    this.emitter.emit(AUDIT_RECORDED_EVENT, evt);
  }
}
