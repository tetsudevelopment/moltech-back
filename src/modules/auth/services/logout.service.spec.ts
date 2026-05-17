import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';

import { JwtService } from './jwt.service';
import { LogoutService } from './logout.service';
import { RefreshTokenStore } from '../repositories/refresh-token-store';

// ------------------------------------------------------------------ mocks ---

const mockVerifyRefreshToken = jest.fn();
const mockRevokeFamily = jest.fn();
const mockEmit = jest.fn();

const FAMILY_ID = 'family-uuid-001';
const USER_ID = 'user-uuid-001';

const fakeClaims = {
  sub: USER_ID,
  familyId: FAMILY_ID,
  tokenId: 'token-uuid-001',
  iss: 'moltech',
  aud: 'moltech-app',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
};

const fakeContext = { requestId: 'req-456', ip: '10.0.0.1' };

// ------------------------------------------------------------------ setup ---

describe('LogoutService', () => {
  let service: LogoutService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockVerifyRefreshToken.mockResolvedValue(fakeClaims);
    mockRevokeFamily.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LogoutService,
        {
          provide: JwtService,
          useValue: { verifyRefreshToken: mockVerifyRefreshToken },
        },
        {
          provide: RefreshTokenStore,
          useValue: { revokeFamily: mockRevokeFamily },
        },
        { provide: EventEmitter2, useValue: { emit: mockEmit } },
      ],
    }).compile();

    service = module.get<LogoutService>(LogoutService);
  });

  // --------------------------------------------------- valid token path ----

  describe('valid refresh token', () => {
    it('resolves without throwing', async () => {
      await expect(service.logout('valid-token', fakeContext)).resolves.toBeUndefined();
    });

    it('revokes the token family', async () => {
      await service.logout('valid-token', fakeContext);

      expect(mockRevokeFamily).toHaveBeenCalledWith(FAMILY_ID);
    });

    it('emits auth.logout audit with actor equal to sub from token claims', async () => {
      await service.logout('valid-token', fakeContext);

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'auth.logout',
          actor: USER_ID,
        }),
      );
    });

    it('includes requestId and ip in audit when provided', async () => {
      await service.logout('valid-token', fakeContext);

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          requestId: 'req-456',
          ip: '10.0.0.1',
        }),
      );
    });

    it('does NOT include token value in audit metadata', async () => {
      await service.logout('valid-token', fakeContext);

      const evts = mockEmit.mock.calls
        .filter((c: unknown[]) => c[0] === AUDIT_RECORDED_EVENT)
        .map((c: unknown[]) => c[1] as AuditRecordedEvent);

      for (const evt of evts) {
        expect(JSON.stringify(evt.metadata ?? {})).not.toContain('valid-token');
      }
    });
  });

  // --------------------------------------------------- invalid token path --

  describe('invalid or expired refresh token', () => {
    beforeEach(() => {
      mockVerifyRefreshToken.mockRejectedValue(new Error('JWTVerificationFailed'));
    });

    it('does NOT throw — logout is permissive', async () => {
      await expect(service.logout('invalid-token', fakeContext)).resolves.toBeUndefined();
    });

    it('does NOT revoke any family', async () => {
      await service.logout('invalid-token', fakeContext);

      expect(mockRevokeFamily).not.toHaveBeenCalled();
    });

    it('does NOT emit any audit event', async () => {
      await service.logout('invalid-token', fakeContext);

      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('expired refresh token', () => {
    beforeEach(() => {
      mockVerifyRefreshToken.mockRejectedValue(new Error('JWTExpired'));
    });

    it('does NOT throw — logout is permissive', async () => {
      await expect(service.logout('expired-token', fakeContext)).resolves.toBeUndefined();
    });

    it('does NOT emit any audit event', async () => {
      await service.logout('expired-token', fakeContext);

      expect(mockEmit).not.toHaveBeenCalled();
    });
  });
});
