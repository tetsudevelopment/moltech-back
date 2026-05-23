import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { type Rental, type RentalStatus } from '../domain/rental.types';

export interface CreateRentalInput {
  userId: string;
  powerBankId: string;
  pickupStationId: string;
  paymentMethodId: string;
  couponId?: string | null;
  estimatedDurationHours: number;
  hourlyRate: string;
  estimatedCost: string;
  currency: string;
  discountApplied: string;
}

export interface FinalizeRentalInput {
  endTime: Date;
  actualDurationHours: string;
  finalCost: string;
  penalty: string;
}

export interface RentalAdminFilters {
  userId?: string;
  status?: RentalStatus;
  stationId?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedRentals {
  data: Rental[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class RentalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Rental | null> {
    const row = await this.prisma.rentals.findUnique({ where: { id } });
    return row ? mapToDomain(row) : null;
  }

  async listAdmin(filters: RentalAdminFilters): Promise<PaginatedRentals> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50));
    const where: Prisma.rentalsWhereInput = {};
    if (filters.userId !== undefined) where.user_id = filters.userId;
    if (filters.status !== undefined) where.status = filters.status;
    if (filters.stationId !== undefined) where.pickup_station_id = filters.stationId;

    const [rows, total] = await Promise.all([
      this.prisma.rentals.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { start_time: 'desc' },
      }),
      this.prisma.rentals.count({ where }),
    ]);
    return { data: rows.map(mapToDomain), total, page, pageSize };
  }

  async create(input: CreateRentalInput, tx?: Prisma.TransactionClient): Promise<Rental> {
    const client = tx ?? this.prisma;
    const row = await client.rentals.create({
      data: {
        user_id: input.userId,
        power_bank_id: input.powerBankId,
        pickup_station_id: input.pickupStationId,
        coupon_id: input.couponId ?? null,
        payment_method_id: input.paymentMethodId,
        estimated_duration_hours: input.estimatedDurationHours,
        hourly_rate: new Prisma.Decimal(input.hourlyRate),
        estimated_cost: new Prisma.Decimal(input.estimatedCost),
        currency: input.currency,
        discount_applied: new Prisma.Decimal(input.discountApplied),
        status: 'active',
      },
    });
    return mapToDomain(row);
  }

  async finalize(
    id: string,
    input: FinalizeRentalInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Rental> {
    const client = tx ?? this.prisma;
    const row = await client.rentals.update({
      where: { id },
      data: {
        end_time: input.endTime,
        actual_duration_hours: new Prisma.Decimal(input.actualDurationHours),
        final_cost: new Prisma.Decimal(input.finalCost),
        penalty: new Prisma.Decimal(input.penalty),
        status: 'completed',
      },
    });
    return mapToDomain(row);
  }
}

function mapToDomain(row: {
  id: string;
  user_id: string;
  power_bank_id: string;
  pickup_station_id: string;
  coupon_id: string | null;
  payment_method_id: string;
  start_time: Date;
  end_time: Date | null;
  estimated_duration_hours: number;
  actual_duration_hours: Prisma.Decimal | null;
  hourly_rate: Prisma.Decimal;
  estimated_cost: Prisma.Decimal;
  final_cost: Prisma.Decimal | null;
  currency: string;
  discount_applied: Prisma.Decimal;
  penalty: Prisma.Decimal;
  status: string;
  created_at: Date;
}): Rental {
  return {
    id: row.id,
    userId: row.user_id,
    powerBankId: row.power_bank_id,
    pickupStationId: row.pickup_station_id,
    couponId: row.coupon_id,
    paymentMethodId: row.payment_method_id,
    startTime: row.start_time,
    endTime: row.end_time,
    estimatedDurationHours: row.estimated_duration_hours,
    actualDurationHours: row.actual_duration_hours?.toFixed(2) ?? null,
    hourlyRate: row.hourly_rate.toFixed(2),
    estimatedCost: row.estimated_cost.toFixed(2),
    finalCost: row.final_cost?.toFixed(2) ?? null,
    currency: row.currency,
    discountApplied: row.discount_applied.toFixed(2),
    penalty: row.penalty.toFixed(2),
    status: row.status as RentalStatus,
    createdAt: row.created_at,
  };
}
