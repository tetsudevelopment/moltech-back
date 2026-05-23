import { Injectable } from '@nestjs/common';
import type { payment_method_status_enum, payment_method_type_enum } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

export interface PaymentMethodSummary {
  id: string;
  userId: string;
  status: payment_method_status_enum;
  gatewayToken: string;
}

export interface PaymentMethodView {
  id: string;
  userId: string;
  type: payment_method_type_enum;
  cardholderName: string;
  lastFourDigits: string;
  expiryMonth: number;
  expiryYear: number;
  isDefault: boolean;
  status: payment_method_status_enum;
  createdAt: Date;
}

export interface CreatePaymentMethodInput {
  userId: string;
  type: payment_method_type_enum;
  cardholderName: string;
  lastFourDigits: string;
  expiryMonth: number;
  expiryYear: number;
  gatewayToken: string;
  isDefault: boolean;
}

@Injectable()
export class PaymentMethodRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByIdForUser(methodId: string, userId: string): Promise<PaymentMethodSummary | null> {
    const row = await this.prisma.payment_methods.findUnique({ where: { id: methodId } });
    if (row?.user_id !== userId) return null;
    return {
      id: row.id,
      userId: row.user_id,
      status: row.status,
      gatewayToken: row.gateway_token,
    };
  }

  /**
   * Returns all non-deleted payment methods owned by the user, default first.
   */
  async listForUser(userId: string): Promise<PaymentMethodView[]> {
    const rows = await this.prisma.payment_methods.findMany({
      where: { user_id: userId, status: { not: 'deleted' } },
      orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
    });
    return rows.map((row) => this.toView(row));
  }

  /**
   * Creates a new payment method row. If `isDefault` is true, atomically
   * clears the default flag on all other methods owned by the same user.
   */
  async create(input: CreatePaymentMethodInput): Promise<PaymentMethodView> {
    return await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.payment_methods.updateMany({
          where: { user_id: input.userId, is_default: true },
          data: { is_default: false },
        });
      }
      const row = await tx.payment_methods.create({
        data: {
          user_id: input.userId,
          type: input.type,
          cardholder_name: input.cardholderName,
          last_four_digits: input.lastFourDigits,
          expiry_month: input.expiryMonth,
          expiry_year: input.expiryYear,
          gateway_token: input.gatewayToken,
          is_default: input.isDefault,
          status: 'active',
        },
      });
      return this.toView(row);
    });
  }

  /**
   * Soft-deletes the method by setting status='deleted'. Returns null if the
   * row does not exist or is not owned by the user (caller maps to 404).
   */
  async markDeleted(methodId: string, userId: string): Promise<PaymentMethodView | null> {
    const existing = await this.prisma.payment_methods.findUnique({ where: { id: methodId } });
    if (existing?.user_id !== userId) return null;
    if (existing.status === 'deleted') return this.toView(existing);
    const row = await this.prisma.payment_methods.update({
      where: { id: methodId },
      data: { status: 'deleted', is_default: false },
    });
    return this.toView(row);
  }

  private toView(row: {
    id: string;
    user_id: string;
    type: payment_method_type_enum;
    cardholder_name: string;
    last_four_digits: string;
    expiry_month: number;
    expiry_year: number;
    is_default: boolean;
    status: payment_method_status_enum;
    created_at: Date;
  }): PaymentMethodView {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      cardholderName: row.cardholder_name,
      lastFourDigits: row.last_four_digits,
      expiryMonth: row.expiry_month,
      expiryYear: row.expiry_year,
      isDefault: row.is_default,
      status: row.status,
      createdAt: row.created_at,
    };
  }
}
