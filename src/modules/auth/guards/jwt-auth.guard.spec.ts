import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';

import { JwtAuthGuard } from './jwt-auth.guard';
import type { JwtService } from '../services/jwt.service';

const mockVerifyAccess = jest.fn();
interface RequestShape {
  headers: Record<string, unknown>;
  user?: unknown;
}

function makeCtx(headers: Record<string, unknown>): { ctx: ExecutionContext; req: RequestShape } {
  const req: RequestShape = { headers };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new JwtAuthGuard({ verifyAccessToken: mockVerifyAccess } as unknown as JwtService);
  });

  describe('canActivate', () => {
    it('throws UnauthorizedException when Authorization header is missing', async () => {
      const { ctx } = makeCtx({});

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when Authorization header is not Bearer', async () => {
      const { ctx } = makeCtx({ authorization: 'Basic dXNlcjpwYXNz' });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when token verification fails', async () => {
      mockVerifyAccess.mockRejectedValue(new Error('expired'));
      const { ctx } = makeCtx({ authorization: 'Bearer bad-token' });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('attaches user to request and returns true on valid token', async () => {
      mockVerifyAccess.mockResolvedValue({
        sub: 'user-uuid-1',
        role: 'user',
        jti: 'jti-1',
      });
      const { ctx, req } = makeCtx({ authorization: 'Bearer good-token' });

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(req.user).toEqual({ id: 'user-uuid-1', role: 'user', jti: 'jti-1' });
    });

    it('strips the Bearer prefix case-insensitively', async () => {
      mockVerifyAccess.mockResolvedValue({ sub: 'user-uuid-1', role: 'user' });
      const { ctx } = makeCtx({ authorization: 'bearer abc' });

      await guard.canActivate(ctx);

      expect(mockVerifyAccess).toHaveBeenCalledWith('abc');
    });
  });
});
