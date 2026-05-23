import {
  Body,
  Controller,
  Delete,
  Get,
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

import { TokenizeCardSchema, type TokenizeCardDto } from '../dtos/tokenize-card.dto';
import { PaymentMethodsService, type PaymentMethodView } from '../services/payment-methods.service';

interface PublicPaymentMethod {
  id: string;
  user_id: string;
  type: PaymentMethodView['type'];
  cardholder_name: string;
  last_four_digits: string;
  expiry_month: number;
  expiry_year: number;
  is_default: boolean;
  status: PaymentMethodView['status'];
  created_at: string;
}

@Controller('payment-methods')
@UseGuards(JwtAuthGuard)
export class PaymentMethodsController {
  constructor(private readonly service: PaymentMethodsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  async tokenize(
    @CurrentUser() current: { id: string },
    @Body(new ZodValidationPipe(TokenizeCardSchema)) dto: TokenizeCardDto,
    @Req() req: Request & { id?: string },
  ): Promise<{ paymentMethod: PublicPaymentMethod }> {
    const created = await this.service.tokenizeAndStore(current.id, dto, {
      requestId: req.id,
      ip: req.ip,
    });
    return { paymentMethod: serialize(created) };
  }

  @Get()
  async list(
    @CurrentUser() current: { id: string },
  ): Promise<{ paymentMethods: PublicPaymentMethod[] }> {
    const rows = await this.service.list(current.id);
    return { paymentMethods: rows.map(serialize) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() current: { id: string },
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
    @Req() req: Request & { id?: string },
  ): Promise<void> {
    await this.service.remove(id, current.id, { requestId: req.id, ip: req.ip });
  }
}

function serialize(view: PaymentMethodView): PublicPaymentMethod {
  return {
    id: view.id,
    user_id: view.userId,
    type: view.type,
    cardholder_name: view.cardholderName,
    last_four_digits: view.lastFourDigits,
    expiry_month: view.expiryMonth,
    expiry_year: view.expiryYear,
    is_default: view.isDefault,
    status: view.status,
    created_at: view.createdAt.toISOString(),
  };
}
