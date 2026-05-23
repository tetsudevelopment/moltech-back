import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AUDIT_RECORDED_EVENT,
  type AuditAction,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';
import { PaymentMethodRepository } from '@/modules/rentals/repositories/payment-method.repository';

import { PAYMENT_GATEWAY, type PaymentGateway } from '../domain/payment-gateway.types';
import { PaymentRepository, type PaymentView } from '../repositories/payment.repository';

export type { PaymentView };

export interface PaymentsContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly repo: PaymentRepository,
    private readonly paymentMethods: PaymentMethodRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly emitter: EventEmitter2,
  ) {}

  async findOwned(id: string, userId: string): Promise<PaymentView> {
    const p = await this.repo.findById(id);
    if (!p) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found',
      });
    }
    if (p.userId !== userId) {
      throw new ForbiddenException({
        code: 'PAYMENT_NOT_OWNED',
        message: 'You do not own this payment',
      });
    }
    return p;
  }

  async listForUser(userId: string): Promise<PaymentView[]> {
    return await this.repo.listForUser(userId);
  }

  async refund(id: string, userId: string, context: PaymentsContext = {}): Promise<PaymentView> {
    const payment = await this.findOwned(id, userId);
    if (payment.status !== 'approved') {
      throw new ConflictException({
        code: 'PAYMENT_NOT_REFUNDABLE',
        message: `Cannot refund a payment in status '${payment.status}' (must be 'approved')`,
      });
    }

    const refund = await this.gateway.refund({
      transactionId: payment.transactionId,
      amount: payment.amount,
      currency: payment.currency,
    });

    if (refund.status !== 'approved') {
      throw new BadRequestException({
        code: 'REFUND_REJECTED',
        message: 'Gateway rejected the refund',
      });
    }

    const updated = await this.repo.update(id, {
      status: 'refunded',
      gatewayMessage: `Refund ${refund.refundId} approved`,
    });

    this.emit('payment.refunded', userId, context, {
      paymentId: id,
      transactionId: payment.transactionId,
      refundId: refund.refundId,
      amount: payment.amount,
      currency: payment.currency,
    });

    return updated;
  }

  async retry(id: string, userId: string, context: PaymentsContext = {}): Promise<PaymentView> {
    const payment = await this.findOwned(id, userId);
    if (payment.status !== 'pending' && payment.status !== 'error') {
      throw new ConflictException({
        code: 'PAYMENT_NOT_RETRYABLE',
        message: `Cannot retry a payment in status '${payment.status}' (must be 'pending' or 'error')`,
      });
    }
    if (!payment.paymentMethodId) {
      throw new ConflictException({
        code: 'PAYMENT_METHOD_UNAVAILABLE',
        message: 'Cannot retry: original payment method is no longer linked',
      });
    }

    const pm = await this.paymentMethods.findByIdForUser(payment.paymentMethodId, userId);
    if (pm?.status !== 'active') {
      throw new ConflictException({
        code: 'PAYMENT_METHOD_UNAVAILABLE',
        message: 'Cannot retry: payment method is no longer active',
      });
    }

    const charge = await this.gateway.charge({
      amount: payment.amount,
      currency: payment.currency,
      description: `Retry payment ${id}`,
      userId,
      paymentMethodToken: pm.gatewayToken,
    });

    const newStatus =
      charge.status === 'approved'
        ? 'approved'
        : charge.status === 'pending'
          ? 'pending'
          : 'rejected';

    const updated = await this.repo.update(id, {
      status: newStatus,
      transactionId: charge.transactionId,
      gatewayMessage: charge.gatewayMessage ?? null,
    });

    const action: AuditAction =
      charge.status === 'approved' ? 'payment.charged' : 'payment.declined';
    this.emit(action, userId, context, {
      paymentId: id,
      transactionId: charge.transactionId,
      gateway: this.gateway.name,
      status: newStatus,
    });

    if (charge.status !== 'approved' && charge.status !== 'pending') {
      throw new BadRequestException({
        code: 'PAYMENT_DECLINED',
        message: charge.gatewayMessage ?? 'Payment was declined on retry',
      });
    }

    return updated;
  }

  private emit(
    action: AuditAction,
    actor: string,
    context: PaymentsContext,
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
