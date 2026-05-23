import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { Idempotent } from '@/common/idempotency';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { UuidSchema } from '@/common/validation/common.schema';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';

import { type Rental, type RentalStatus } from '../domain/rental.types';
import { type StartRentalDto, StartRentalSchema } from '../dtos/start-rental.dto';
import { RentalService } from '../services/rental.service';

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
  qr_return?: string;
}

@Controller('rentals')
@UseGuards(JwtAuthGuard)
export class RentalsController {
  constructor(private readonly rentalService: RentalService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  async startRental(
    @CurrentUser() current: { id: string },
    @Body(new ZodValidationPipe(StartRentalSchema)) dto: StartRentalDto,
    @Req() req: Request & { id?: string },
  ): Promise<{ rental: PublicRental }> {
    const rental = await this.rentalService.startRental(current.id, dto, {
      requestId: req.id,
      ip: req.ip,
    });
    return {
      rental: {
        ...serialize(rental),
        qr_return: `moltech://rental/return?code=${rental.id}`,
      },
    };
  }

  @Post(':id/finalize')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  async finalizeRental(
    @CurrentUser() current: { id: string },
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
    @Req() req: Request & { id?: string },
  ): Promise<{ rental: PublicRental }> {
    const rental = await this.rentalService.finalizeRental(id, current.id, {
      requestId: req.id,
      ip: req.ip,
    });
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
