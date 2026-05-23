import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AUDIT_RECORDED_EVENT,
  type AuditAction,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from '@/modules/payments/domain/payment-gateway.types';
import { PaymentMethodRepository } from '@/modules/rentals/repositories/payment-method.repository';
import type { PaymentMethodView } from '@/modules/rentals/repositories/payment-method.repository';

import { type TokenizeCardDto } from '../dtos/tokenize-card.dto';

export type { PaymentMethodView };

export interface PaymentMethodContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly repo: PaymentMethodRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly emitter: EventEmitter2,
  ) {}

  async tokenizeAndStore(
    userId: string,
    dto: TokenizeCardDto,
    context: PaymentMethodContext = {},
  ): Promise<PaymentMethodView> {
    this.assertExpiryNotPast(dto.expiry_year, dto.expiry_month);

    const tokenized = await this.gateway.tokenize({
      temporaryToken: dto.temporary_token,
      userId,
      cardholderName: dto.cardholder_name,
      lastFour: dto.last_four_digits,
      brand: dto.type,
      expMonth: dto.expiry_month,
      expYear: dto.expiry_year,
    });

    const created = await this.repo.create({
      userId,
      type: tokenized.brand ?? dto.type,
      cardholderName: dto.cardholder_name,
      lastFourDigits: dto.last_four_digits,
      expiryMonth: dto.expiry_month,
      expiryYear: dto.expiry_year,
      gatewayToken: tokenized.gatewayToken,
      isDefault: dto.is_default,
    });

    this.emit('payment_method.added', userId, context, {
      paymentMethodId: created.id,
      gateway: this.gateway.name,
      lastFour: created.lastFourDigits,
      brand: created.type,
    });

    return created;
  }

  async list(userId: string): Promise<PaymentMethodView[]> {
    return await this.repo.listForUser(userId);
  }

  async remove(
    methodId: string,
    userId: string,
    context: PaymentMethodContext = {},
  ): Promise<void> {
    const result = await this.repo.markDeleted(methodId, userId);
    if (!result) {
      throw new NotFoundException({
        code: 'PAYMENT_METHOD_NOT_FOUND',
        message: 'Payment method not found or not owned by user',
      });
    }
    this.emit('payment_method.removed', userId, context, {
      paymentMethodId: methodId,
    });
  }

  private assertExpiryNotPast(year: number, month: number): void {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;
    if (year < currentYear || (year === currentYear && month < currentMonth)) {
      throw new BadRequestException({
        code: 'PAYMENT_METHOD_EXPIRED',
        message: 'Card expiry date is in the past',
      });
    }
  }

  private emit(
    action: AuditAction,
    actor: string,
    context: PaymentMethodContext,
    metadata: Record<string, unknown>,
  ): void {
    const evt: AuditRecordedEvent = {
      action,
      actor,
      timestamp: new Date().toISOString(),
      ...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
      ...(context.ip !== undefined ? { ip: context.ip } : {}),
      metadata,
    };
    this.emitter.emit(AUDIT_RECORDED_EVENT, evt);
  }
}
