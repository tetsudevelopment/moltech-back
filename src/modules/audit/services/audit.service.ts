import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { AUDIT_RECORDED_EVENT, type AuditRecordedEvent } from '../events/audit-recorded.event';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly emitter: EventEmitter2,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Emit an audit event. Audit MUST NOT break business flows — any internal error here is logged but never thrown.
   */
  record(event: Omit<AuditRecordedEvent, 'timestamp'> & { timestamp?: string }): void {
    const payload: AuditRecordedEvent & { timestamp: string } = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
    try {
      this.emitter.emit(AUDIT_RECORDED_EVENT, payload);
    } catch (err) {
      this.logger.error({ err, action: event.action }, 'Failed to emit audit event');
    }
  }

  /**
   * Persist an audit event to the audit_log table. Called by AuditListener.
   * Failures are logged at error level but never thrown — audit persistence
   * MUST NOT crash the emitter or the business flow.
   */
  async persist(event: AuditRecordedEvent & { timestamp: string }): Promise<void> {
    try {
      await this.prisma.audit_log.create({
        data: {
          action: event.action,
          actor: event.actor,
          target_type: event.target?.type ?? null,
          target_id: event.target?.id ?? null,
          request_id: event.requestId ?? null,
          ip: event.ip !== undefined ? anonymizeIp(event.ip) : null,
          ...(event.metadata !== undefined
            ? { metadata: event.metadata as Prisma.InputJsonValue }
            : {}),
        },
      });
    } catch (err) {
      this.logger.error(
        {
          action: event.action,
          actor: event.actor,
          error: err instanceof Error ? err.message : String(err),
        },
        'Failed to persist audit log entry',
      );
    }
  }
}

export function anonymizeIp(ip: string): string {
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length > 1) {
      parts[parts.length - 1] = '0';
      return parts.join(':');
    }
    return ip;
  }
  const parts = ip.split('.');
  if (parts.length === 4) {
    parts[3] = '0';
    return parts.join('.');
  }
  return ip;
}
