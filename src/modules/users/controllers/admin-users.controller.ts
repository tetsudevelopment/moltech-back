import { Body, Controller, Delete, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { UuidSchema } from '@/common/validation/common.schema';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import { AdminAuthGuard } from '@/modules/auth/guards/admin-auth.guard';

import {
  ListUsersQuerySchema,
  UpdateUserRoleSchema,
  type ListUsersQuery,
  type UpdateUserRoleDto,
} from '../dtos/admin-user.dto';
import { AdminUsersService, type User } from '../services/admin-users.service';

interface PublicAdminUser {
  id: string;
  email: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
  auth_provider: User['authProvider'];
  role: User['role'];
  status: User['status'];
  email_verified: boolean;
  created_at: string;
}

@Controller('admin/users')
@UseGuards(AdminAuthGuard)
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListUsersQuerySchema)) query: ListUsersQuery,
  ): Promise<{ users: PublicAdminUser[]; total: number; page: number; pageSize: number }> {
    const result = await this.service.list({
      page: query.page ?? 1,
      pageSize: query.page_size ?? 50,
      ...(query.role !== undefined ? { role: query.role } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.search !== undefined ? { search: query.search } : {}),
    });
    return {
      users: result.data.map(serialize),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  @Get(':id')
  async get(
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
  ): Promise<{ user: PublicAdminUser }> {
    const user = await this.service.findById(id);
    return { user: serialize(user) };
  }

  @Patch(':id/role')
  async updateRole(
    @CurrentUser() current: { id: string },
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateUserRoleSchema)) dto: UpdateUserRoleDto,
    @Req() req: Request & { id?: string },
  ): Promise<{ user: PublicAdminUser }> {
    const updated = await this.service.updateRole(id, current.id, dto.role, {
      requestId: req.id,
      ip: req.ip,
    });
    return { user: serialize(updated) };
  }

  @Delete(':id')
  async delete(
    @CurrentUser() current: { id: string },
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
    @Req() req: Request & { id?: string },
  ): Promise<{ id: string }> {
    return await this.service.deleteUser(id, current.id, {
      requestId: req.id,
      ip: req.ip,
    });
  }
}

function serialize(user: User): PublicAdminUser {
  return {
    id: user.id,
    email: user.email,
    first_name: user.firstName,
    last_name: user.lastName,
    phone: user.phone,
    auth_provider: user.authProvider,
    role: user.role,
    status: user.status,
    email_verified: user.emailVerified,
    created_at: user.createdAt.toISOString(),
  };
}
