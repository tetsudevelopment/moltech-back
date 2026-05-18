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
    const row = await this.prisma.stations.findUnique({ where: { id } });
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
  };
}
