import { Injectable } from '@nestjs/common';
import type {
  payment_concept_enum,
  payment_gateway_enum,
  payment_status_enum,
} from '@prisma/client';
import { Prisma, type Prisma as PrismaTypes } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

export interface PaymentView {
  id: string;
  rentalId: string;
  userId: string;
  paymentMethodId: string | null;
  concept: payment_concept_enum;
  amount: string;
  currency: string;
  gateway: payment_gateway_enum;
  transactionId: string;
  merchantId: string | null;
  status: payment_status_enum;
  gatewayMessage: string | null;
  attemptedAt: Date;
  updatedAt: Date;
}

export interface UpdatePaymentInput {
  status?: payment_status_enum;
  transactionId?: string;
  merchantId?: string | null;
  gatewayMessage?: string | null;
}

export interface PaymentAdminFilters {
  userId?: string;
  rentalId?: string;
  status?: payment_status_enum;
  page?: number;
  pageSize?: number;
}

export interface PaginatedPayments {
  data: PaymentView[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<PaymentView | null> {
    const row = await this.prisma.payments.findUnique({ where: { id } });
    return row ? this.toView(row) : null;
  }

  /**
   * Lookup by (gateway, transaction_id) — the unique key the webhook handler
   * uses to find the row that originated from a charge call.
   */
  async findByGatewayTxn(
    gateway: payment_gateway_enum,
    transactionId: string,
  ): Promise<PaymentView | null> {
    const row = await this.prisma.payments.findUnique({
      where: { gateway_transaction_id: { gateway, transaction_id: transactionId } },
    });
    return row ? this.toView(row) : null;
  }

  async listForUser(userId: string, limit = 50): Promise<PaymentView[]> {
    const rows = await this.prisma.payments.findMany({
      where: { user_id: userId },
      orderBy: { attempted_at: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toView(r));
  }

  async listAdmin(filters: PaymentAdminFilters): Promise<PaginatedPayments> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50));
    const where: PrismaTypes.paymentsWhereInput = {};
    if (filters.userId !== undefined) where.user_id = filters.userId;
    if (filters.rentalId !== undefined) where.rental_id = filters.rentalId;
    if (filters.status !== undefined) where.status = filters.status;

    const [rows, total] = await Promise.all([
      this.prisma.payments.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { attempted_at: 'desc' },
      }),
      this.prisma.payments.count({ where }),
    ]);
    return { data: rows.map((r) => this.toView(r)), total, page, pageSize };
  }

  async update(
    id: string,
    input: UpdatePaymentInput,
    tx?: PrismaTypes.TransactionClient,
  ): Promise<PaymentView> {
    const client = tx ?? this.prisma;
    const data: PrismaTypes.paymentsUpdateInput = { updated_at: new Date() };
    if (input.status !== undefined) data.status = input.status;
    if (input.transactionId !== undefined) data.transaction_id = input.transactionId;
    if (input.merchantId !== undefined) data.merchant_id = input.merchantId;
    if (input.gatewayMessage !== undefined) data.gateway_message = input.gatewayMessage;

    const row = await client.payments.update({ where: { id }, data });
    return this.toView(row);
  }

  private toView(row: {
    id: string;
    rental_id: string;
    user_id: string;
    payment_method_id: string | null;
    concept: payment_concept_enum;
    amount: Prisma.Decimal;
    currency: string;
    gateway: payment_gateway_enum;
    transaction_id: string;
    merchant_id: string | null;
    status: payment_status_enum;
    gateway_message: string | null;
    attempted_at: Date;
    updated_at: Date;
  }): PaymentView {
    return {
      id: row.id,
      rentalId: row.rental_id,
      userId: row.user_id,
      paymentMethodId: row.payment_method_id,
      concept: row.concept,
      amount: row.amount.toFixed(2),
      currency: row.currency,
      gateway: row.gateway,
      transactionId: row.transaction_id,
      merchantId: row.merchant_id,
      status: row.status,
      gatewayMessage: row.gateway_message,
      attemptedAt: row.attempted_at,
      updatedAt: row.updated_at,
    };
  }
}
