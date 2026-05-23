import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { UuidSchema } from '@/common/validation/common.schema';
import { AdminAuthGuard } from '@/modules/auth/guards/admin-auth.guard';

import { AdminPaymentsService, type PaymentView } from '../services/admin-payments.service';

const PaymentStatusSchema = z.enum(['pending', 'approved', 'rejected', 'refunded', 'error']);

const ListPaymentsQuerySchema = z.object({
  user_id: UuidSchema.optional(),
  rental_id: UuidSchema.optional(),
  status: PaymentStatusSchema.optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});
type ListPaymentsQuery = z.infer<typeof ListPaymentsQuerySchema>;

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

@Controller('admin/payments')
@UseGuards(AdminAuthGuard)
export class AdminPaymentsController {
  constructor(private readonly service: AdminPaymentsService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListPaymentsQuerySchema)) query: ListPaymentsQuery,
  ): Promise<{ payments: PublicPayment[]; total: number; page: number; pageSize: number }> {
    const result = await this.service.list({
      ...(query.user_id !== undefined ? { userId: query.user_id } : {}),
      ...(query.rental_id !== undefined ? { rentalId: query.rental_id } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.page !== undefined ? { page: query.page } : {}),
      ...(query.page_size !== undefined ? { pageSize: query.page_size } : {}),
    });
    return {
      payments: result.data.map(serialize),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  @Get(':id')
  async get(
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
  ): Promise<{ payment: PublicPayment }> {
    const p = await this.service.findById(id);
    return { payment: serialize(p) };
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
