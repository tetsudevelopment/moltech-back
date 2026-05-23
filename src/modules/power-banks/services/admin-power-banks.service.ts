import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AUDIT_RECORDED_EVENT,
  type AuditAction,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';
import {
  PaginatedPowerBanks,
  PowerBankCodeOrQrConflictError,
  PowerBankRepository,
  PowerBankStationNotFoundError,
  type PowerBankFilters,
  type PowerBankView,
} from '@/modules/rentals/repositories/power-bank.repository';

import {
  type CreatePowerBankDto,
  type MovePowerBankDto,
  type UpdatePowerBankDto,
} from '../dtos/power-bank.dto';

export type { PaginatedPowerBanks, PowerBankView };

/**
 * Hard cap on power banks per station. Each physical gabinete has a fixed
 * number of slots — we enforce it server-side so the operator can't accidentally
 * register more batteries than the device can hold.
 *
 * Note: this is a point-in-time check, not a DB constraint. A concurrent burst
 * could race past it. For a single-operator admin tool that's acceptable;
 * if/when this becomes a problem, the right fix is a Postgres trigger or a
 * SERIALIZABLE transaction wrapping the count + insert.
 */
export const MAX_POWER_BANKS_PER_STATION = 10;

export interface AdminContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

@Injectable()
export class AdminPowerBanksService {
  constructor(
    private readonly repo: PowerBankRepository,
    private readonly emitter: EventEmitter2,
  ) {}

  async list(filters: PowerBankFilters): Promise<PaginatedPowerBanks> {
    return await this.repo.listAdmin(filters);
  }

  async findById(id: string): Promise<PowerBankView> {
    const pb = await this.repo.findByIdAdmin(id);
    if (!pb) {
      throw new NotFoundException({
        code: 'POWER_BANK_NOT_FOUND',
        message: 'Power bank not found',
      });
    }
    return pb;
  }

  async create(
    actorId: string,
    dto: CreatePowerBankDto,
    context: AdminContext = {},
  ): Promise<PowerBankView> {
    await this.assertStationHasRoom(dto.station_id);
    try {
      const created = await this.repo.create({
        code: dto.code,
        stationId: dto.station_id,
        qrCode: dto.qr_code,
        model: dto.model ?? null,
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.battery_level !== undefined ? { batteryLevel: dto.battery_level } : {}),
      });

      this.emit('admin.power_bank.created', actorId, context, {
        powerBankId: created.id,
        code: created.code,
        stationId: created.stationId,
      });

      return created;
    } catch (err) {
      this.translateRepoError(err);
    }
  }

  private async assertStationHasRoom(stationId: string): Promise<void> {
    const count = await this.repo.countAtStation(stationId);
    if (count >= MAX_POWER_BANKS_PER_STATION) {
      throw new ConflictException({
        code: 'STATION_FULL',
        message: `Station already has the maximum of ${String(MAX_POWER_BANKS_PER_STATION)} power banks. Move or retire one before adding another.`,
        details: { stationId, current: count, max: MAX_POWER_BANKS_PER_STATION },
      });
    }
  }

  async update(
    id: string,
    actorId: string,
    dto: UpdatePowerBankDto,
    context: AdminContext = {},
  ): Promise<PowerBankView> {
    try {
      const updated = await this.repo.update(id, {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.station_id !== undefined ? { stationId: dto.station_id } : {}),
        ...(dto.model !== undefined ? { model: dto.model } : {}),
        ...(dto.qr_code !== undefined ? { qrCode: dto.qr_code } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.battery_level !== undefined ? { batteryLevel: dto.battery_level } : {}),
      });
      if (!updated) {
        throw new NotFoundException({
          code: 'POWER_BANK_NOT_FOUND',
          message: 'Power bank not found',
        });
      }
      this.emit('admin.power_bank.updated', actorId, context, {
        powerBankId: id,
        changedFields: Object.keys(dto),
      });
      return updated;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.translateRepoError(err);
    }
  }

  async move(
    id: string,
    actorId: string,
    dto: MovePowerBankDto,
    context: AdminContext = {},
  ): Promise<PowerBankView> {
    const existing = await this.repo.findByIdAdmin(id);
    if (!existing) {
      throw new NotFoundException({
        code: 'POWER_BANK_NOT_FOUND',
        message: 'Power bank not found',
      });
    }
    if (existing.status === 'rented') {
      throw new ConflictException({
        code: 'POWER_BANK_RENTED',
        message: 'Cannot move a power bank that is currently rented',
      });
    }
    if (existing.stationId !== dto.station_id) {
      // Only enforce capacity check when actually changing station — moving to
      // the same station is a no-op that shouldn't trip the cap.
      await this.assertStationHasRoom(dto.station_id);
    }
    try {
      const updated = await this.repo.update(id, { stationId: dto.station_id });
      if (!updated) {
        throw new NotFoundException({
          code: 'POWER_BANK_NOT_FOUND',
          message: 'Power bank not found',
        });
      }
      this.emit('admin.power_bank.moved', actorId, context, {
        powerBankId: id,
        fromStationId: existing.stationId,
        toStationId: dto.station_id,
      });
      return updated;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.translateRepoError(err);
    }
  }

  async delete(id: string, actorId: string, context: AdminContext = {}): Promise<void> {
    const outcome = await this.repo.delete(id);
    if (outcome === 'not_found') {
      throw new NotFoundException({
        code: 'POWER_BANK_NOT_FOUND',
        message: 'Power bank not found',
      });
    }
    if (outcome === 'has_rentals') {
      throw new ConflictException({
        code: 'POWER_BANK_HAS_RENTALS',
        message: 'Cannot delete a power bank with rental history. Mark it as retired instead.',
      });
    }
    this.emit('admin.power_bank.deleted', actorId, context, { powerBankId: id });
  }

  private translateRepoError(err: unknown): never {
    if (err instanceof PowerBankCodeOrQrConflictError) {
      throw new ConflictException({
        code: 'POWER_BANK_DUPLICATE',
        message: `Conflict on unique field(s): ${err.fields.join(', ')}`,
        details: { fields: err.fields },
      });
    }
    if (err instanceof PowerBankStationNotFoundError) {
      throw new BadRequestException({
        code: 'STATION_NOT_FOUND',
        message: `Station ${err.stationId} does not exist`,
      });
    }
    throw err;
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
