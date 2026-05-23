import { Injectable, NotFoundException } from '@nestjs/common';

import {
  PaginatedPayments,
  PaymentAdminFilters,
  PaymentRepository,
  type PaymentView,
} from '../repositories/payment.repository';

export type { PaginatedPayments, PaymentView };

@Injectable()
export class AdminPaymentsService {
  constructor(private readonly repo: PaymentRepository) {}

  async list(filters: PaymentAdminFilters): Promise<PaginatedPayments> {
    return await this.repo.listAdmin(filters);
  }

  async findById(id: string): Promise<PaymentView> {
    const p = await this.repo.findById(id);
    if (!p) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found',
      });
    }
    return p;
  }
}
