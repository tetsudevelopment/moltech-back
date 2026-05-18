import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

export interface PaymentMethodSummary {
  id: string;
  userId: string;
  status: 'active' | 'expired' | 'deleted';
  gatewayToken: string;
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
}
