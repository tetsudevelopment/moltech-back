import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { Idempotent } from '@/common/idempotency';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { UuidSchema } from '@/common/validation/common.schema';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';

import { PaymentsService, type PaymentView } from '../services/payments.service';

interface PublicPayment {
  id: string;
  rental_id: string;
  user_id: string;
  payment_method_id: string | null;
  concept: PaymentView['concept'];
  amount: string;
  currency: string;
  gateway: PaymentView['gateway'];
  transaction_id: string;
  merchant_id: string | null;
  status: PaymentView['status'];
  gateway_message: string | null;
  attempted_at: string;
  updated_at: string;
}

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Get()
  async list(@CurrentUser() current: { id: string }): Promise<{ payments: PublicPayment[] }> {
    const rows = await this.service.listForUser(current.id);
    return { payments: rows.map(serialize) };
  }

  @Get(':id')
  async get(
    @CurrentUser() current: { id: string },
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
  ): Promise<{ payment: PublicPayment }> {
    const payment = await this.service.findOwned(id, current.id);
    return { payment: serialize(payment) };
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  async refund(
    @CurrentUser() current: { id: string },
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
    @Req() req: Request & { id?: string },
  ): Promise<{ payment: PublicPayment }> {
    const payment = await this.service.refund(id, current.id, {
      requestId: req.id,
      ip: req.ip,
    });
    return { payment: serialize(payment) };
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  async retry(
    @CurrentUser() current: { id: string },
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
    @Req() req: Request & { id?: string },
  ): Promise<{ payment: PublicPayment }> {
    const payment = await this.service.retry(id, current.id, {
      requestId: req.id,
      ip: req.ip,
    });
    return { payment: serialize(payment) };
  }
}

function serialize(view: PaymentView): PublicPayment {
  return {
    id: view.id,
    rental_id: view.rentalId,
    user_id: view.userId,
    payment_method_id: view.paymentMethodId,
    concept: view.concept,
    amount: view.amount,
    currency: view.currency,
    gateway: view.gateway,
    transaction_id: view.transactionId,
    merchant_id: view.merchantId,
    status: view.status,
    gateway_message: view.gatewayMessage,
    attempted_at: view.attemptedAt.toISOString(),
    updated_at: view.updatedAt.toISOString(),
  };
}
