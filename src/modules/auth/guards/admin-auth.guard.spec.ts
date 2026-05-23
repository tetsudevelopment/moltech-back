import { ForbiddenException, type ExecutionContext } from '@nestjs/common';

import { AdminAuthGuard } from './admin-auth.guard';
import { type JwtAuthGuard, type AuthenticatedUser } from './jwt-auth.guard';

function buildContext(user?: AuthenticatedUser): ExecutionContext {
  const req: { user?: AuthenticatedUser } = {};
  if (user) req.user = user;
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe('AdminAuthGuard', () => {
  let guard: AdminAuthGuard;
  let jwtCanActivate: jest.Mock;

  beforeEach(() => {
    jwtCanActivate = jest.fn().mockResolvedValue(true);
    const jwtGuardStub = { canActivate: jwtCanActivate } as unknown as JwtAuthGuard;
    guard = new AdminAuthGuard(jwtGuardStub);
  });

  it('delegates to JwtAuthGuard first (throws if JWT invalid)', async () => {
    const jwtError = new Error('jwt invalid');
    jwtCanActivate.mockRejectedValueOnce(jwtError);
    await expect(guard.canActivate(buildContext())).rejects.toBe(jwtError);
  });

  it('throws 403 ADMIN_ONLY when role is user', async () => {
    const ctx = buildContext({ id: 'u1', role: 'user', jti: 'j' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows admin role', async () => {
    const ctx = buildContext({ id: 'u1', role: 'admin', jti: 'j' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows superadmin role', async () => {
    const ctx = buildContext({ id: 'u1', role: 'superadmin', jti: 'j' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws 403 when req.user is missing (JWT passed but somehow no user attached)', async () => {
    const ctx = buildContext(undefined);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
