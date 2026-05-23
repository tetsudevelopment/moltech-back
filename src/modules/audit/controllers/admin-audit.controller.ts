import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { AdminAuthGuard } from '@/modules/auth/guards/admin-auth.guard';

import { AdminAuditService, type AuditLogView } from '../services/admin-audit.service';

const ListAuditQuerySchema = z.object({
  action: z.string().min(1).max(100).optional(),
  actor: z.string().min(1).max(50).optional(),
  since: z.iso.datetime({ offset: true }).optional(),
  until: z.iso.datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});
type ListAuditQuery = z.infer<typeof ListAuditQuerySchema>;

interface PublicAuditLog {
  id: string;
  action: string;
  actor: string;
  target_type: string | null;
  target_id: string | null;
  request_id: string | null;
  ip: string | null;
  metadata: unknown;
  created_at: string;
}

@Controller('admin/audit-log')
@UseGuards(AdminAuthGuard)
export class AdminAuditController {
  constructor(private readonly service: AdminAuditService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListAuditQuerySchema)) query: ListAuditQuery,
  ): Promise<{ entries: PublicAuditLog[]; total: number; page: number; pageSize: number }> {
    const result = await this.service.list({
      ...(query.action !== undefined ? { action: query.action as never } : {}),
      ...(query.actor !== undefined ? { actor: query.actor } : {}),
      ...(query.since !== undefined ? { since: new Date(query.since) } : {}),
      ...(query.until !== undefined ? { until: new Date(query.until) } : {}),
      ...(query.page !== undefined ? { page: query.page } : {}),
      ...(query.page_size !== undefined ? { pageSize: query.page_size } : {}),
    });
    return {
      entries: result.data.map(serialize),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }
}

function serialize(entry: AuditLogView): PublicAuditLog {
  return {
    id: entry.id,
    action: entry.action,
    actor: entry.actor,
    target_type: entry.targetType,
    target_id: entry.targetId,
    request_id: entry.requestId,
    ip: entry.ip,
    metadata: entry.metadata,
    created_at: entry.createdAt.toISOString(),
  };
}
