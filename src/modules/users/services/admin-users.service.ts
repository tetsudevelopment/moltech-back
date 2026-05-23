import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AUDIT_RECORDED_EVENT,
  type AuditAction,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';
import type { User, UserRole } from '@/modules/auth/domain/user.types';
import { UserRepository } from '@/modules/auth/repositories/user.repository';

export type { User, UserRole };

export interface AdminContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

export interface ListUsersInput {
  page: number;
  pageSize: number;
  role?: UserRole;
  status?: User['status'];
  search?: string;
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly users: UserRepository,
    private readonly emitter: EventEmitter2,
  ) {}

  async list(input: ListUsersInput): ReturnType<UserRepository['listAll']> {
    return await this.users.listAll(input);
  }

  async findById(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }
    return user;
  }

  async updateRole(
    id: string,
    actorId: string,
    newRole: UserRole,
    context: AdminContext = {},
  ): Promise<User> {
    if (id === actorId) {
      // Prevent an admin from accidentally demoting themselves and locking
      // everyone out. To change your own role, ask another admin.
      throw new BadRequestException({
        code: 'CANNOT_CHANGE_OWN_ROLE',
        message: 'You cannot change your own role. Ask another admin to do it.',
      });
    }
    const previous = await this.users.findById(id);
    if (!previous) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }
    if (previous.role === newRole) {
      // No-op: still emit audit for traceability of the attempt.
      this.emit('admin.user.role_changed', actorId, context, {
        userId: id,
        previousRole: previous.role,
        newRole,
        noop: true,
      });
      return previous;
    }
    const updated = await this.users.updateRole(id, newRole);
    if (!updated) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }
    this.emit('admin.user.role_changed', actorId, context, {
      userId: id,
      previousRole: previous.role,
      newRole,
    });
    return updated;
  }

  private emit(
    action: AuditAction,
    actor: string,
    context: AdminContext,
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
