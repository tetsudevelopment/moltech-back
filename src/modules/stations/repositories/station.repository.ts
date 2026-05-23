import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { type Station, type StationStatus } from '../domain/station.types';

export type { Station, StationStatus };

export interface StationFilters {
  city?: string;
  status?: StationStatus;
  page?: number;
  pageSize?: number;
}

export interface PaginatedStations {
  data: Station[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class StationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Station | null> {
    const row = await this.prisma.stations.findUnique({
      where: { id },
      include: { _count: { select: { power_banks: true } } },
    });
    return row ? mapToDomain(row) : null;
  }

  async list(filters: StationFilters): Promise<PaginatedStations> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));

    const where: Prisma.stationsWhereInput = {};
    if (filters.city !== undefined) where.city = filters.city;
    if (filters.status !== undefined) where.status = filters.status;

    const [rows, total] = await Promise.all([
      this.prisma.stations.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { name: 'asc' },
        include: { _count: { select: { power_banks: true } } },
      }),
      this.prisma.stations.count({ where }),
    ]);

    return {
      data: rows.map(mapToDomain),
      total,
      page,
      pageSize,
    };
  }

  async countAvailablePowerBanks(stationId: string): Promise<number> {
    return this.prisma.power_banks.count({
      where: { station_id: stationId, status: 'available' },
    });
  }

  async create(input: CreateStationInput): Promise<Station> {
    const row = await this.prisma.stations.create({
      data: toPrismaCreateData(input),
      include: { _count: { select: { power_banks: true } } },
    });
    return mapToDomain(row);
  }

  async update(id: string, input: UpdateStationInput): Promise<Station | null> {
    try {
      const row = await this.prisma.stations.update({
        where: { id },
        data: toPrismaUpdateData(input),
        include: { _count: { select: { power_banks: true } } },
      });
      return mapToDomain(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Hard-deletes the station. Returns:
   *   - 'ok'             on success
   *   - 'not_found'      if no station with that id
   *   - 'has_power_banks' if power_banks still reference this station (FK violation)
   *
   * Power banks must be moved or retired before the station can be deleted.
   */
  async delete(id: string): Promise<'ok' | 'not_found' | 'has_power_banks'> {
    try {
      await this.prisma.stations.delete({ where: { id } });
      return 'ok';
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return 'not_found';
        if (err.code === 'P2003') return 'has_power_banks';
      }
      throw err;
    }
  }

  /**
   * Returns the operational state of a station: the station itself, every
   * power_bank currently located at it, and a summary count by status.
   */
  async getStateById(id: string): Promise<StationState | null> {
    const [station, powerBanks] = await Promise.all([
      this.prisma.stations.findUnique({
        where: { id },
        include: { _count: { select: { power_banks: true } } },
      }),
      this.prisma.power_banks.findMany({
        where: { station_id: id },
        orderBy: { code: 'asc' },
      }),
    ]);
    if (!station) return null;

    const summary: StationStateSummary = {
      total: powerBanks.length,
      available: 0,
      rented: 0,
      charging: 0,
      damaged: 0,
      retired: 0,
    };
    for (const pb of powerBanks) {
      summary[pb.status] += 1;
    }

    return {
      station: mapToDomain(station),
      powerBanks: powerBanks.map((pb) => ({
        id: pb.id,
        code: pb.code,
        model: pb.model,
        status: pb.status,
        batteryLevel: pb.battery_level,
        qrCode: pb.qr_code,
        createdAt: pb.created_at,
        updatedAt: pb.updated_at,
      })),
      summary,
    };
  }
}

export type PowerBankStatus = 'available' | 'rented' | 'charging' | 'damaged' | 'retired';

export interface PowerBankAtStation {
  id: string;
  code: string;
  model: string | null;
  status: PowerBankStatus;
  batteryLevel: number;
  qrCode: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StationStateSummary {
  total: number;
  available: number;
  rented: number;
  charging: number;
  damaged: number;
  retired: number;
}

export interface StationState {
  station: Station;
  powerBanks: PowerBankAtStation[];
  summary: StationStateSummary;
}

export interface CreateStationInput {
  name: string;
  city: string;
  zone?: string | null;
  address: string;
  latitude: number;
  longitude: number;
  hourlyRate: number;
  currency: string;
  totalCapacity: number;
  status: StationStatus;
  description?: string | null;
  openingTime?: string | null;
  closingTime?: string | null;
}

export type UpdateStationInput = Partial<CreateStationInput>;

function toPrismaCreateData(input: CreateStationInput): Prisma.stationsCreateInput {
  const data: Prisma.stationsCreateInput = {
    name: input.name,
    city: input.city,
    address: input.address,
    latitude: new Prisma.Decimal(input.latitude),
    longitude: new Prisma.Decimal(input.longitude),
    hourly_rate: new Prisma.Decimal(input.hourlyRate),
    currency: input.currency,
    total_capacity: input.totalCapacity,
    status: input.status,
  };
  if (input.zone !== undefined) data.zone = input.zone;
  if (input.description !== undefined) data.description = input.description;
  if (input.openingTime !== undefined) data.opening_time = parseTime(input.openingTime);
  if (input.closingTime !== undefined) data.closing_time = parseTime(input.closingTime);
  return data;
}

function toPrismaUpdateData(input: UpdateStationInput): Prisma.stationsUpdateInput {
  const data: Prisma.stationsUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.city !== undefined) data.city = input.city;
  if (input.zone !== undefined) data.zone = input.zone;
  if (input.address !== undefined) data.address = input.address;
  if (input.latitude !== undefined) data.latitude = new Prisma.Decimal(input.latitude);
  if (input.longitude !== undefined) data.longitude = new Prisma.Decimal(input.longitude);
  if (input.hourlyRate !== undefined) data.hourly_rate = new Prisma.Decimal(input.hourlyRate);
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.totalCapacity !== undefined) data.total_capacity = input.totalCapacity;
  if (input.status !== undefined) data.status = input.status;
  if (input.description !== undefined) data.description = input.description;
  if (input.openingTime !== undefined) data.opening_time = parseTime(input.openingTime);
  if (input.closingTime !== undefined) data.closing_time = parseTime(input.closingTime);
  return data;
}

function parseTime(value: string | null): Date | null {
  if (value === null) return null;
  // Prisma maps @db.Time to JS Date with the time-of-day in UTC. We accept
  // "HH:MM" or "HH:MM:SS" and produce a Date on 1970-01-01 with that time.
  const parts = value.split(':').map((p) => Number.parseInt(p, 10));
  const hh = parts[0] ?? 0;
  const mm = parts[1] ?? 0;
  const ss = parts[2] ?? 0;
  return new Date(Date.UTC(1970, 0, 1, hh, mm, ss));
}

function mapToDomain(row: {
  id: string;
  name: string;
  city: string;
  zone: string | null;
  address: string;
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
  hourly_rate: Prisma.Decimal;
  currency: string;
  total_capacity: number;
  status: string;
  description: string | null;
  opening_time: Date | null;
  closing_time: Date | null;
  created_at: Date;
  _count?: { power_banks: number };
}): Station {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    zone: row.zone,
    address: row.address,
    latitude: row.latitude.toFixed(7),
    longitude: row.longitude.toFixed(7),
    hourlyRate: row.hourly_rate.toFixed(2),
    currency: row.currency,
    totalCapacity: row.total_capacity,
    status: row.status as StationStatus,
    description: row.description,
    openingTime: row.opening_time,
    closingTime: row.closing_time,
    createdAt: row.created_at,
    powerBanksCount: row._count?.power_banks ?? 0,
  };
}
