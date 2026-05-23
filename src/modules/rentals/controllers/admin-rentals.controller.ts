import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { UuidSchema } from '@/common/validation/common.schema';
import { AdminAuthGuard } from '@/modules/auth/guards/admin-auth.guard';

import { type Rental, type RentalStatus } from '../domain/rental.types';
import { AdminRentalsService } from '../services/admin-rentals.service';

const RentalStatusSchema = z.enum([
  'active',
  'completed',
  'cancelled',
  'penalized',
]) satisfies z.ZodType<RentalStatus>;

const ListRentalsQuerySchema = z.object({
  user_id: UuidSchema.optional(),
  station_id: UuidSchema.optional(),
  status: RentalStatusSchema.optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});
type ListRentalsQuery = z.infer<typeof ListRentalsQuerySchema>;

interface PublicRental {
  id: string;
  user_id: string;
  power_bank_id: string;
  pickup_station_id: string;
  payment_method_id: string;
  coupon_id: string | null;
  start_time: string;
  end_time: string | null;
  estimated_duration_hours: number;
  actual_duration_hours: string | null;
  hourly_rate: string;
  estimated_cost: string;
  final_cost: string | null;
  currency: string;
  discount_applied: string;
  penalty: string;
  status: RentalStatus;
  created_at: string;
}

@Controller('admin/rentals')
@UseGuards(AdminAuthGuard)
export class AdminRentalsController {
  constructor(private readonly service: AdminRentalsService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListRentalsQuerySchema)) query: ListRentalsQuery,
  ): Promise<{ rentals: PublicRental[]; total: number; page: number; pageSize: number }> {
    const result = await this.service.list({
      ...(query.user_id !== undefined ? { userId: query.user_id } : {}),
      ...(query.station_id !== undefined ? { stationId: query.station_id } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.page !== undefined ? { page: query.page } : {}),
      ...(query.page_size !== undefined ? { pageSize: query.page_size } : {}),
    });
    return {
      rentals: result.data.map(serialize),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  @Get(':id')
  async get(
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
  ): Promise<{ rental: PublicRental }> {
    const rental = await this.service.findById(id);
    return { rental: serialize(rental) };
  }
}

function serialize(rental: Rental): PublicRental {
  return {
    id: rental.id,
    user_id: rental.userId,
    power_bank_id: rental.powerBankId,
    pickup_station_id: rental.pickupStationId,
    payment_method_id: rental.paymentMethodId,
    coupon_id: rental.couponId,
    start_time: rental.startTime.toISOString(),
    end_time: rental.endTime?.toISOString() ?? null,
    estimated_duration_hours: rental.estimatedDurationHours,
    actual_duration_hours: rental.actualDurationHours,
    hourly_rate: rental.hourlyRate,
    estimated_cost: rental.estimatedCost,
    final_cost: rental.finalCost,
    currency: rental.currency,
    discount_applied: rental.discountApplied,
    penalty: rental.penalty,
    status: rental.status,
    created_at: rental.createdAt.toISOString(),
  };
}
