import { UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';

import { JwtService } from './jwt.service';
import { LoginService } from './login.service';
import { PasswordService } from './password.service';
import type { User } from '../domain/user.types';
import { RefreshTokenStore } from '../repositories/refresh-token-store';
import { UserRepository } from '../repositories/user.repository';

// ------------------------------------------------------------------ mocks ---

const mockFindByEmail = jest.fn();
const mockVerify = jest.fn();
const mockSignAccessToken = jest.fn();
const mockSignRefreshToken = jest.fn();
const mockCreateFamily = jest.fn();
const mockEmit = jest.fn();

const activeUser: User = {
  id: 'user-uuid-001',
  email: 'user@example.com',
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$hash',
  firstName: 'John',
  lastName: 'Doe',
  phone: null,
  authProvider: 'email',
  status: 'active',
  emailVerified: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const fakeContext = { requestId: 'req-123', ip: '127.0.0.1' };

// ------------------------------------------------------------------ setup ---

describe('LoginService', () => {
  let service: LoginService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFindByEmail.mockResolvedValue(activeUser);
    mockVerify.mockResolvedValue(true);
    mockSignAccessToken.mockResolvedValue('access-token-value');
    mockSignRefreshToken.mockResolvedValue('refresh-token-value');
    mockCreateFamily.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoginService,
        { provide: UserRepository, useValue: { findByEmail: mockFindByEmail } },
        { provide: PasswordService, useValue: { verify: mockVerify } },
        {
          provide: JwtService,
          useValue: {
            signAccessToken: mockSignAccessToken,
            signRefreshToken: mockSignRefreshToken,
          },
        },
        { provide: RefreshTokenStore, useValue: { createFamily: mockCreateFamily } },
        { provide: EventEmitter2, useValue: { emit: mockEmit } },
      ],
    }).compile();

    service = module.get<LoginService>(LoginService);
  });

  // ----------------------------------------------------- success path ------

  describe('successful login', () => {
    it('returns accessToken, refreshToken, and public user without passwordHash', async () => {
      const result = await service.login(
        { email: 'user@example.com', password: 'ValidPass1!' },
        fakeContext,
      );

      expect(result.accessToken).toBe('access-token-value');
      expect(result.refreshToken).toBe('refresh-token-value');
      expect(result.user.id).toBe(activeUser.id);
      expect(result.user.email).toBe(activeUser.email);
      expect('passwordHash' in result.user).toBe(false);
    });

    it('calls signAccessToken with sub and role=user', async () => {
      await service.login({ email: 'user@example.com', password: 'ValidPass1!' }, fakeContext);

      expect(mockSignAccessToken).toHaveBeenCalledWith({ sub: activeUser.id, role: 'user' });
    });

    it('calls signRefreshToken with sub, familyId (UUID), and tokenId (UUID)', async () => {
      await service.login({ email: 'user@example.com', password: 'ValidPass1!' }, fakeContext);

      expect(mockSignRefreshToken).toHaveBeenCalledTimes(1);
      const claims = (mockSignRefreshToken.mock.calls[0] as unknown[])[0] as {
        sub: string;
        familyId: string;
        tokenId: string;
      };
      expect(claims.sub).toBe(activeUser.id);
      expect(claims.familyId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(claims.tokenId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('calls refreshTokenStore.createFamily with the same familyId and tokenId used for signing', async () => {
      await service.login({ email: 'user@example.com', password: 'ValidPass1!' }, fakeContext);

      const refreshClaims = (mockSignRefreshToken.mock.calls[0] as unknown[])[0] as {
        familyId: string;
        tokenId: string;
      };
      expect(mockCreateFamily).toHaveBeenCalledWith(
        refreshClaims.familyId,
        activeUser.id,
        refreshClaims.tokenId,
      );
    });

    it('emits auth.login.success audit event with actor=user.id', async () => {
      await service.login({ email: 'user@example.com', password: 'ValidPass1!' }, fakeContext);

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'auth.login.success',
          actor: activeUser.id,
        }),
      );
    });

    it('does not include email in audit metadata', async () => {
      await service.login({ email: 'user@example.com', password: 'ValidPass1!' }, fakeContext);

      const evts = mockEmit.mock.calls
        .filter((c: unknown[]) => c[0] === AUDIT_RECORDED_EVENT)
        .map((c: unknown[]) => c[1] as AuditRecordedEvent);

      for (const evt of evts) {
        const metaStr = JSON.stringify(evt.metadata ?? {});
        expect(metaStr).not.toContain('user@example.com');
      }
    });
  });

  // ----------------------------------------------------- failure: user not found ---

  describe('user not found', () => {
    beforeEach(() => {
      mockFindByEmail.mockResolvedValue(null);
    });

    it('throws UnauthorizedException', async () => {
      await expect(
        service.login({ email: 'ghost@example.com', password: 'pass' }, fakeContext),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('emits auth.login.failure with actor=anonymous and reason=user_not_found', async () => {
      await expect(
        service.login({ email: 'ghost@example.com', password: 'pass' }, fakeContext),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'auth.login.failure',
          actor: 'anonymous',
          metadata: expect.objectContaining({ reason: 'user_not_found' }) as Record<
            string,
            unknown
          >,
        }),
      );
    });

    it('does not include email in failure audit metadata for user_not_found', async () => {
      await expect(
        service.login({ email: 'ghost@example.com', password: 'pass' }, fakeContext),
      ).rejects.toThrow(UnauthorizedException);

      const matchingCall = mockEmit.mock.calls.find(
        (c: unknown[]) => c[0] === AUDIT_RECORDED_EVENT,
      ) as unknown[] | undefined;
      const evt = matchingCall?.[1] as AuditRecordedEvent | undefined;
      expect(JSON.stringify(evt?.metadata ?? {})).not.toContain('ghost@example.com');
    });
  });

  // ----------------------------------------------------- failure: wrong password ---

  describe('wrong password', () => {
    beforeEach(() => {
      mockVerify.mockResolvedValue(false);
    });

    it('throws UnauthorizedException', async () => {
      await expect(
        service.login({ email: 'user@example.com', password: 'WrongPass!' }, fakeContext),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('emits auth.login.failure with actor=user.id and reason=invalid_password', async () => {
      await expect(
        service.login({ email: 'user@example.com', password: 'WrongPass!' }, fakeContext),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'auth.login.failure',
          actor: activeUser.id,
          metadata: expect.objectContaining({ reason: 'invalid_password' }) as Record<
            string,
            unknown
          >,
        }),
      );
    });
  });

  // ----------------------------------------------------- failure: suspended ---

  describe('account suspended', () => {
    beforeEach(() => {
      mockFindByEmail.mockResolvedValue({
        ...activeUser,
        status: 'suspended',
        emailVerified: true,
      });
    });

    it('throws UnauthorizedException', async () => {
      await expect(
        service.login({ email: 'user@example.com', password: 'ValidPass1!' }, fakeContext),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('emits auth.login.failure with reason=account_suspended', async () => {
      await expect(
        service.login({ email: 'user@example.com', password: 'ValidPass1!' }, fakeContext),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'auth.login.failure',
          actor: activeUser.id,
          metadata: expect.objectContaining({ reason: 'account_suspended' }) as Record<
            string,
            unknown
          >,
        }),
      );
    });
  });

  // ----------------------------------------------------- failure: not verified ---

  describe('email not verified', () => {
    beforeEach(() => {
      mockFindByEmail.mockResolvedValue({
        ...activeUser,
        emailVerified: false,
        status: 'pending_verification',
      });
    });

    it('throws UnauthorizedException with USER_NOT_VERIFIED payload', async () => {
      try {
        await service.login({ email: 'user@example.com', password: 'ValidPass1!' }, fakeContext);
        fail('expected UnauthorizedException');
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedException);
        const response = (err as UnauthorizedException).getResponse();
        expect(response).toMatchObject({ code: 'USER_NOT_VERIFIED' });
      }
    });

    it('does NOT issue tokens or create a refresh family when email is unverified', async () => {
      await expect(
        service.login({ email: 'user@example.com', password: 'ValidPass1!' }, fakeContext),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockSignAccessToken).not.toHaveBeenCalled();
      expect(mockSignRefreshToken).not.toHaveBeenCalled();
      expect(mockCreateFamily).not.toHaveBeenCalled();
    });

    it('emits auth.login.failure with reason=user_not_verified', async () => {
      await expect(
        service.login({ email: 'user@example.com', password: 'ValidPass1!' }, fakeContext),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'auth.login.failure',
          actor: activeUser.id,
          metadata: expect.objectContaining({ reason: 'user_not_verified' }) as Record<
            string,
            unknown
          >,
        }),
      );
    });
  });

  // ----------------------------------------------------- failure: inactive ---

  describe('account inactive', () => {
    beforeEach(() => {
      mockFindByEmail.mockResolvedValue({ ...activeUser, status: 'inactive', emailVerified: true });
    });

    it('throws UnauthorizedException', async () => {
      await expect(
        service.login({ email: 'user@example.com', password: 'ValidPass1!' }, fakeContext),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('emits auth.login.failure with reason=account_inactive', async () => {
      await expect(
        service.login({ email: 'user@example.com', password: 'ValidPass1!' }, fakeContext),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'auth.login.failure',
          actor: activeUser.id,
          metadata: expect.objectContaining({ reason: 'account_inactive' }) as Record<
            string,
            unknown
          >,
        }),
      );
    });
  });
});
