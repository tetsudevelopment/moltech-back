import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard, type AuthenticatedUser } from './jwt-auth.guard';

const ADMIN_ROLES: readonly AuthenticatedUser['role'][] = ['admin', 'superadmin'];

/**
 * Guard for endpoints under `/api/v1/admin/...`. Extends JwtAuthGuard to first
 * verify the JWT and populate `req.user`, then enforces that the authenticated
 * user has role `admin` or `superadmin`. Any other role → 403 ADMIN_ONLY.
 *
 * Usage: `@UseGuards(AdminAuthGuard)` on a controller class or method.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtAuthGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Delegate JWT verification + req.user population to the parent guard.
    await this.jwt.canActivate(context);

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user || !ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException({
        code: 'ADMIN_ONLY',
        message: 'This endpoint requires admin privileges',
      });
    }
    return true;
  }
}
