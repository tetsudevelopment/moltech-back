import { UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';

import { JwtService } from './jwt.service';
import { RefreshService } from './refresh.service';
import { RefreshTokenStore } from '../repositories/refresh-token-store';

// ------------------------------------------------------------------ mocks ---

const mockVerifyRefreshToken = jest.fn();
const mockSignAccessToken = jest.fn();
const mockSignRefreshToken = jest.fn();
const mockGetCurrentTokenId = jest.fn();
const mockSetCurrentTokenId = jest.fn();
const mockRevokeFamily = jest.fn();
const mockEmit = jest.fn();

const FAMILY_ID = 'family-uuid-001';
const TOKEN_ID = 'token-uuid-001';
const USER_ID = 'user-uuid-001';

const fakeClaims = {
  sub: USER_ID,
  familyId: FAMILY_ID,
  tokenId: TOKEN_ID,
  iss: 'moltech',
  aud: 'moltech-app',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
};

const fakeContext = { requestId: 'req-123', ip: '127.0.0.1' };

// ------------------------------------------------------------------ setup ---

describe('RefreshService', () => {
  let service: RefreshService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockVerifyRefreshToken.mockResolvedValue(fakeClaims);
    mockSignAccessToken.mockResolvedValue('new-access-token');
    mockSignRefreshToken.mockResolvedValue('new-refresh-token');
    mockGetCurrentTokenId.mockResolvedValue(TOKEN_ID);
    mockSetCurrentTokenId.mockResolvedValue(undefined);
    mockRevokeFamily.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshService,
        {
          provide: JwtService,
          useValue: {
            verifyRefreshToken: mockVerifyRefreshToken,
            signAccessToken: mockSignAccessToken,
            signRefreshToken: mockSignRefreshToken,
          },
        },
        {
          provide: RefreshTokenStore,
          useValue: {
            getCurrentTokenId: mockGetCurrentTokenId,
            setCurrentTokenId: mockSetCurrentTokenId,
            revokeFamily: mockRevokeFamily,
          },
        },
        { provide: EventEmitter2, useValue: { emit: mockEmit } },
      ],
    }).compile();

    service = module.get<RefreshService>(RefreshService);
  });

  // --------------------------------------------------- success path --------

  describe('valid token rotation', () => {
    it('returns new accessToken and new refreshToken', async () => {
      const result = await service.refresh('valid-refresh-token', fakeContext);

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
    });

    it('new refreshToken is signed with same familyId and a NEW tokenId (not the old one)', async () => {
      await service.refresh('valid-refresh-token', fakeContext);

      expect(mockSignRefreshToken).toHaveBeenCalledTimes(1);
      const claims = (mockSignRefreshToken.mock.calls[0] as unknown[])[0] as {
        sub: string;
        familyId: string;
        tokenId: string;
      };
      expect(claims.sub).toBe(USER_ID);
      expect(claims.familyId).toBe(FAMILY_ID);
      expect(claims.tokenId).not.toBe(TOKEN_ID);
      expect(claims.tokenId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('updates the store with the new tokenId', async () => {
      await service.refresh('valid-refresh-token', fakeContext);

      const newTokenId = (mockSignRefreshToken.mock.calls[0] as unknown[])[0] as {
        tokenId: string;
      };
      expect(mockSetCurrentTokenId).toHaveBeenCalledWith(FAMILY_ID, newTokenId.tokenId);
    });

    it('does NOT revoke the family on a valid rotation', async () => {
      await service.refresh('valid-refresh-token', fakeContext);

      expect(mockRevokeFamily).not.toHaveBeenCalled();
    });

    it('emits auth.refresh.rotated audit with actor=sub', async () => {
      await service.refresh('valid-refresh-token', fakeContext);

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'auth.refresh.rotated',
          actor: USER_ID,
        }),
      );
    });

    it('includes requestId and ip in audit when provided', async () => {
      await service.refresh('valid-refresh-token', fakeContext);

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          requestId: 'req-123',
          ip: '127.0.0.1',
        }),
      );
    });
  });

  // --------------------------------------------------- reuse detection -----

  describe('reuse detection: tokenId mismatch', () => {
    beforeEach(() => {
      mockGetCurrentTokenId.mockResolvedValue('different-token-id');
    });

    it('throws UnauthorizedException', async () => {
      await expect(service.refresh('reused-token', fakeContext)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('revokes the family', async () => {
      await expect(service.refresh('reused-token', fakeContext)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockRevokeFamily).toHaveBeenCalledWith(FAMILY_ID);
    });

    it('emits auth.refresh.reused audit with actor=sub', async () => {
      await expect(service.refresh('reused-token', fakeContext)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'auth.refresh.reused',
          actor: USER_ID,
        }),
      );
    });

    it('does NOT issue new tokens', async () => {
      await expect(service.refresh('reused-token', fakeContext)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockSignAccessToken).not.toHaveBeenCalled();
      expect(mockSignRefreshToken).not.toHaveBeenCalled();
    });
  });

  describe('reuse detection: family does not exist in store', () => {
    beforeEach(() => {
      mockGetCurrentTokenId.mockResolvedValue(null);
    });

    it('throws UnauthorizedException', async () => {
      await expect(service.refresh('orphan-token', fakeContext)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('revokes the family (idempotent — del on non-existent key is safe)', async () => {
      await expect(service.refresh('orphan-token', fakeContext)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockRevokeFamily).toHaveBeenCalledWith(FAMILY_ID);
    });

    it('emits auth.refresh.reused audit', async () => {
      await expect(service.refresh('orphan-token', fakeContext)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'auth.refresh.reused',
          actor: USER_ID,
        }),
      );
    });
  });

  // --------------------------------------------------- invalid token -------

  describe('invalid token signature', () => {
    beforeEach(() => {
      mockVerifyRefreshToken.mockRejectedValue(new Error('JWTVerificationFailed'));
    });

    it('throws UnauthorizedException', async () => {
      await expect(service.refresh('tampered-token', fakeContext)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('does NOT look up the family in the store', async () => {
      await expect(service.refresh('tampered-token', fakeContext)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockGetCurrentTokenId).not.toHaveBeenCalled();
    });

    it('does NOT emit any audit event', async () => {
      await expect(service.refresh('tampered-token', fakeContext)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('expired token', () => {
    beforeEach(() => {
      mockVerifyRefreshToken.mockRejectedValue(new Error('JWTExpired'));
    });

    it('throws UnauthorizedException', async () => {
      await expect(service.refresh('expired-token', fakeContext)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('does NOT look up the family in the store', async () => {
      await expect(service.refresh('expired-token', fakeContext)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockGetCurrentTokenId).not.toHaveBeenCalled();
    });
  });
});
