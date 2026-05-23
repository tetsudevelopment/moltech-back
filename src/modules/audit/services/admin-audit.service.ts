import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { type AuditAction } from '../events/audit-recorded.event';

export interface AuditLogView {
  id: string;
  action: string;
  actor: string;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  ip: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface AuditAdminFilters {
  action?: AuditAction;
  actor?: string;
  since?: Date;
  until?: Date;
  page?: number;
  pageSize?: number;
}

export interface PaginatedAuditLogs {
  data: AuditLogView[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: AuditAdminFilters): Promise<PaginatedAuditLogs> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50));

    const where: Prisma.audit_logWhereInput = {};
    if (filters.action !== undefined) where.action = filters.action;
    if (filters.actor !== undefined) where.actor = filters.actor;
    if (filters.since !== undefined || filters.until !== undefined) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (filters.since !== undefined) createdAt.gte = filters.since;
      if (filters.until !== undefined) createdAt.lte = filters.until;
      where.created_at = createdAt;
    }

    const [rows, total] = await Promise.all([
      this.prisma.audit_log.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.audit_log.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id,
        action: r.action,
        actor: r.actor,
        targetType: r.target_type,
        targetId: r.target_id,
        requestId: r.request_id,
        ip: r.ip,
        metadata: r.metadata,
        createdAt: r.created_at,
      })),
      total,
      page,
      pageSize,
    };
  }
}
