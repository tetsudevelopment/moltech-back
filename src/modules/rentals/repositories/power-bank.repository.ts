import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

export type PowerBankStatus = 'available' | 'rented' | 'charging' | 'damaged' | 'retired';

export interface PowerBank {
  id: string;
  code: string;
  stationId: string;
  status: PowerBankStatus;
  batteryLevel: number;
}

export interface PowerBankView {
  id: string;
  code: string;
  stationId: string;
  model: string | null;
  status: PowerBankStatus;
  batteryLevel: number;
  qrCode: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PowerBankFilters {
  stationId?: string;
  status?: PowerBankStatus;
  page?: number;
  pageSize?: number;
}

export interface PaginatedPowerBanks {
  data: PowerBankView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreatePowerBankInput {
  code: string;
  stationId: string;
  model?: string | null;
  qrCode: string;
  status?: PowerBankStatus;
  batteryLevel?: number;
}

export interface UpdatePowerBankInput {
  code?: string;
  stationId?: string;
  model?: string | null;
  qrCode?: string;
  status?: PowerBankStatus;
  batteryLevel?: number;
}

@Injectable()
export class PowerBankRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, tx?: Prisma.TransactionClient): Promise<PowerBank | null> {
    const client = tx ?? this.prisma;
    const row = await client.power_banks.findUnique({ where: { id } });
    return row ? this.mapToDomain(row) : null;
  }

  async findByIdAdmin(id: string): Promise<PowerBankView | null> {
    const row = await this.prisma.power_banks.findUnique({ where: { id } });
    return row ? this.mapToView(row) : null;
  }

  /**
   * Counts how many power banks are currently assigned to a station.
   * Used by AdminPowerBanksService to enforce the per-station cap.
   * Note: this is a point-in-time read — concurrent inserts could race
   * past a stale count. For single-admin operations it's safe enough.
   */
  async countAtStation(stationId: string): Promise<number> {
    return await this.prisma.power_banks.count({ where: { station_id: stationId } });
  }

  async setStatus(
    id: string,
    status: PowerBankStatus,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.power_banks.update({
      where: { id },
      data: { status, updated_at: new Date() },
    });
  }

  async listAdmin(filters: PowerBankFilters): Promise<PaginatedPowerBanks> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50));
    const where: Prisma.power_banksWhereInput = {};
    if (filters.stationId !== undefined) where.station_id = filters.stationId;
    if (filters.status !== undefined) where.status = filters.status;

    const [rows, total] = await Promise.all([
      this.prisma.power_banks.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { code: 'asc' },
      }),
      this.prisma.power_banks.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.mapToView(r)),
      total,
      page,
      pageSize,
    };
  }

  async create(input: CreatePowerBankInput): Promise<PowerBankView> {
    try {
      const row = await this.prisma.power_banks.create({
        data: {
          code: input.code,
          station_id: input.stationId,
          qr_code: input.qrCode,
          status: input.status ?? 'available',
          battery_level: input.batteryLevel ?? 100,
          ...(input.model !== undefined ? { model: input.model } : {}),
        },
      });
      return this.mapToView(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new PowerBankCodeOrQrConflictError(extractTargetFields(err.meta?.target));
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new PowerBankStationNotFoundError(input.stationId);
      }
      throw err;
    }
  }

  async update(id: string, input: UpdatePowerBankInput): Promise<PowerBankView | null> {
    const data: Prisma.power_banksUpdateInput = { updated_at: new Date() };
    if (input.code !== undefined) data.code = input.code;
    if (input.stationId !== undefined) {
      data.stations = { connect: { id: input.stationId } };
    }
    if (input.model !== undefined) data.model = input.model;
    if (input.qrCode !== undefined) data.qr_code = input.qrCode;
    if (input.status !== undefined) data.status = input.status;
    if (input.batteryLevel !== undefined) data.battery_level = input.batteryLevel;

    try {
      const row = await this.prisma.power_banks.update({ where: { id }, data });
      return this.mapToView(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return null;
        if (err.code === 'P2002') {
          throw new PowerBankCodeOrQrConflictError(extractTargetFields(err.meta?.target));
        }
        if (err.code === 'P2003' && input.stationId !== undefined) {
          throw new PowerBankStationNotFoundError(input.stationId);
        }
      }
      throw err;
    }
  }

  async delete(id: string): Promise<'ok' | 'not_found' | 'has_rentals'> {
    try {
      await this.prisma.power_banks.delete({ where: { id } });
      return 'ok';
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return 'not_found';
        if (err.code === 'P2003') return 'has_rentals';
      }
      throw err;
    }
  }

  private mapToDomain(row: {
    id: string;
    code: string;
    station_id: string;
    status: string;
    battery_level: number;
  }): PowerBank {
    return {
      id: row.id,
      code: row.code,
      stationId: row.station_id,
      status: row.status as PowerBankStatus,
      batteryLevel: row.battery_level,
    };
  }

  private mapToView(row: {
    id: string;
    code: string;
    station_id: string;
    model: string | null;
    status: string;
    battery_level: number;
    qr_code: string;
    created_at: Date;
    updated_at: Date;
  }): PowerBankView {
    return {
      id: row.id,
      code: row.code,
      stationId: row.station_id,
      model: row.model,
      status: row.status as PowerBankStatus,
      batteryLevel: row.battery_level,
      qrCode: row.qr_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export class PowerBankCodeOrQrConflictError extends Error {
  readonly fields: string[];
  constructor(fields: string[]) {
    super(`Conflict on unique field(s): ${fields.join(', ')}`);
    this.name = 'PowerBankCodeOrQrConflictError';
    this.fields = fields;
  }
}

export class PowerBankStationNotFoundError extends Error {
  readonly stationId: string;
  constructor(stationId: string) {
    super(`Station ${stationId} not found`);
    this.name = 'PowerBankStationNotFoundError';
    this.stationId = stationId;
  }
}

function extractTargetFields(target: unknown): string[] {
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === 'string') return [target];
  return [];
}
