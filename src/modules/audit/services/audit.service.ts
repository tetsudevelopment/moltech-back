import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AUDIT_RECORDED_EVENT, type AuditRecordedEvent } from '../events/audit-recorded.event';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly emitter: EventEmitter2) {}

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
}
