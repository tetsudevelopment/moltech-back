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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { UuidSchema } from '@/common/validation/common.schema';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import { AdminAuthGuard } from '@/modules/auth/guards/admin-auth.guard';

import {
  CreatePowerBankSchema,
  MovePowerBankSchema,
  UpdatePowerBankSchema,
  type CreatePowerBankDto,
  type MovePowerBankDto,
  type UpdatePowerBankDto,
} from '../dtos/power-bank.dto';
import { AdminPowerBanksService, type PowerBankView } from '../services/admin-power-banks.service';

const ListPowerBanksQuerySchema = z.object({
  station_id: UuidSchema.optional(),
  status: z.enum(['available', 'rented', 'charging', 'damaged', 'retired']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});
type ListPowerBanksQuery = z.infer<typeof ListPowerBanksQuerySchema>;

interface PublicPowerBank {
  id: string;
  code: string;
  station_id: string;
  model: string | null;
  status: PowerBankView['status'];
  battery_level: number;
  qr_code: string;
  created_at: string;
  updated_at: string;
}

@Controller('admin/power-banks')
@UseGuards(AdminAuthGuard)
export class AdminPowerBanksController {
  constructor(private readonly service: AdminPowerBanksService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListPowerBanksQuerySchema)) query: ListPowerBanksQuery,
  ): Promise<{ powerBanks: PublicPowerBank[]; total: number; page: number; pageSize: number }> {
    const result = await this.service.list({
      ...(query.station_id !== undefined ? { stationId: query.station_id } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.page !== undefined ? { page: query.page } : {}),
      ...(query.page_size !== undefined ? { pageSize: query.page_size } : {}),
    });
    return {
      powerBanks: result.data.map(serialize),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  @Get(':id')
  async get(
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
  ): Promise<{ powerBank: PublicPowerBank }> {
    const pb = await this.service.findById(id);
    return { powerBank: serialize(pb) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() current: { id: string },
    @Body(new ZodValidationPipe(CreatePowerBankSchema)) dto: CreatePowerBankDto,
    @Req() req: Request & { id?: string },
  ): Promise<{ powerBank: PublicPowerBank }> {
    const created = await this.service.create(current.id, dto, {
      requestId: req.id,
      ip: req.ip,
    });
    return { powerBank: serialize(created) };
  }

  @Patch(':id')
  async update(
    @CurrentUser() current: { id: string },
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
    @Body(new ZodValidationPipe(UpdatePowerBankSchema)) dto: UpdatePowerBankDto,
    @Req() req: Request & { id?: string },
  ): Promise<{ powerBank: PublicPowerBank }> {
    const updated = await this.service.update(id, current.id, dto, {
      requestId: req.id,
      ip: req.ip,
    });
    return { powerBank: serialize(updated) };
  }

  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  async move(
    @CurrentUser() current: { id: string },
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
    @Body(new ZodValidationPipe(MovePowerBankSchema)) dto: MovePowerBankDto,
    @Req() req: Request & { id?: string },
  ): Promise<{ powerBank: PublicPowerBank }> {
    const moved = await this.service.move(id, current.id, dto, {
      requestId: req.id,
      ip: req.ip,
    });
    return { powerBank: serialize(moved) };
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
}

function serialize(pb: PowerBankView): PublicPowerBank {
  return {
    id: pb.id,
    code: pb.code,
    station_id: pb.stationId,
    model: pb.model,
    status: pb.status,
    battery_level: pb.batteryLevel,
    qr_code: pb.qrCode,
    created_at: pb.createdAt.toISOString(),
    updated_at: pb.updatedAt.toISOString(),
  };
}
