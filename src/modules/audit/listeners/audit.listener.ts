import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { AUDIT_RECORDED_EVENT, type AuditRecordedEvent } from '../events/audit-recorded.event';

@Injectable()
export class AuditListener {
  private readonly logger = new Logger('AuditLog');

  // F3 will swap this stub with Prisma writes to the audit_log table.
  @OnEvent(AUDIT_RECORDED_EVENT, { async: true, promisify: true })
  async onAuditRecorded(event: AuditRecordedEvent & { timestamp: string }): Promise<void> {
    try {
      this.logger.log({
        action: event.action,
        actor: event.actor,
        target: event.target,
        requestId: event.requestId,
        ip: event.ip,
        metadata: event.metadata,
        timestamp: event.timestamp,
      });
    } catch {
      // Listener failures must not crash the emitter or business flow.
    }
    return Promise.resolve();
  }
}
