import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { AUDIT_RECORDED_EVENT, type AuditRecordedEvent } from '../events/audit-recorded.event';
import { AuditService } from '../services/audit.service';

@Injectable()
export class AuditListener {
  constructor(private readonly auditService: AuditService) {}

  @OnEvent(AUDIT_RECORDED_EVENT, { async: true, promisify: true })
  async onAuditRecorded(event: AuditRecordedEvent & { timestamp: string }): Promise<void> {
    await this.auditService.persist(event);
  }
}
