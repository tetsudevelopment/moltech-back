import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';

import { JwtService } from './jwt.service';
import { VerifyEmailService } from './verify-email.service';
import type { User } from '../domain/user.types';
import { RefreshTokenStore } from '../repositories/refresh-token-store';
import { UserRepository } from '../repositories/user.repository';
import { VerificationTokenRepository } from '../repositories/verification-token.repository';

const mockFindByEmail = jest.fn();
const mockMarkVerified = jest.fn();
const mockFindValid = jest.fn();
const mockMarkUsed = jest.fn();
const mockSignAccess = jest.fn();
const mockSignRefresh = jest.fn();
const mockCreateFamily = jest.fn();
const mockEmit = jest.fn();

const pendingUser: User = {
  id: 'user-uuid-1',
  email: 'user@example.com',
  passwordHash: '$argon2id$hashed',
  firstName: 'John',
  lastName: 'Doe',
  phone: null,
  authProvider: 'email',
  status: 'pending_verification',
  emailVerified: false,
  createdAt: new Date('2026-05-18T00:00:00Z'),
};

const activatedUser: User = {
  ...pendingUser,
  status: 'active',
  emailVerified: true,
};

const validToken = {
  id: 'tok-1',
  userId: 'user-uuid-1',
  type: 'email' as const,
  token: '123456',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  used: false,
  createdAt: new Date(),
};

const ctx = { requestId: 'req-1', ip: '127.0.0.1' };

describe('VerifyEmailService', () => {
  let service: VerifyEmailService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFindByEmail.mockResolvedValue(pendingUser);
    mockFindValid.mockResolvedValue(validToken);
    mockMarkVerified.mockResolvedValue(activatedUser);
    mockMarkUsed.mockResolvedValue(undefined);
    mockSignAccess.mockResolvedValue('access-token-value');
    mockSignRefresh.mockResolvedValue('refresh-token-value');
    mockCreateFamily.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerifyEmailService,
        {
          provide: UserRepository,
          useValue: {
            findByEmail: mockFindByEmail,
            markEmailVerifiedAndActivate: mockMarkVerified,
          },
        },
        {
          provide: VerificationTokenRepository,
          useValue: { findValid: mockFindValid, markUsed: mockMarkUsed },
        },
        {
          provide: JwtService,
          useValue: { signAccessToken: mockSignAccess, signRefreshToken: mockSignRefresh },
        },
        { provide: RefreshTokenStore, useValue: { createFamily: mockCreateFamily } },
        { provide: EventEmitter2, useValue: { emit: mockEmit } },
      ],
    }).compile();

    service = module.get<VerifyEmailService>(VerifyEmailService);
  });

  describe('success path', () => {
    it('looks up the user by email, validates the token, and issues tokens', async () => {
      const result = await service.verify({ email: 'user@example.com', code: '123456' }, ctx);

      expect(mockFindByEmail).toHaveBeenCalledWith('user@example.com');
      expect(mockFindValid).toHaveBeenCalledWith('user-uuid-1', 'email', '123456');
      expect(result.accessToken).toBe('access-token-value');
      expect(result.refreshToken).toBe('refresh-token-value');
    });

    it('marks the token as used before issuing tokens', async () => {
      await service.verify({ email: 'user@example.com', code: '123456' }, ctx);

      expect(mockMarkUsed).toHaveBeenCalledWith('tok-1');
    });

    it('activates the user (status=active, emailVerified=true) when not already verified', async () => {
      await service.verify({ email: 'user@example.com', code: '123456' }, ctx);

      expect(mockMarkVerified).toHaveBeenCalledWith('user-uuid-1');
    });

    it('does NOT re-activate when the user is already verified (idempotent)', async () => {
      mockFindByEmail.mockResolvedValue(activatedUser);

      await service.verify({ email: 'user@example.com', code: '123456' }, ctx);

      expect(mockMarkVerified).not.toHaveBeenCalled();
    });

    it('creates a refresh family for the activated user', async () => {
      await service.verify({ email: 'user@example.com', code: '123456' }, ctx);

      expect(mockCreateFamily).toHaveBeenCalledTimes(1);
      const args = mockCreateFamily.mock.calls[0] as [string, string, string];
      expect(args[1]).toBe('user-uuid-1');
    });

    it('emits auth.email.verified with actor=user.id', async () => {
      await service.verify({ email: 'user@example.com', code: '123456' }, ctx);

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'auth.email.verified',
          actor: 'user-uuid-1',
        }),
      );
    });

    it('returns the activated user (status=active, emailVerified=true) and no password hash', async () => {
      const result = await service.verify({ email: 'user@example.com', code: '123456' }, ctx);

      expect(result.user.id).toBe('user-uuid-1');
      expect(result.user.status).toBe('active');
      expect(result.user.emailVerified).toBe(true);
      expect(result.user).not.toHaveProperty('passwordHash');
    });
  });

  describe('failure paths', () => {
    it('throws BadRequestException with TOKEN_INVALID when user not found', async () => {
      mockFindByEmail.mockResolvedValue(null);

      try {
        await service.verify({ email: 'ghost@example.com', code: '123456' }, ctx);
        fail('expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = (err as BadRequestException).getResponse();
        expect(response).toMatchObject({ code: 'TOKEN_INVALID' });
      }
    });

    it('throws BadRequestException with TOKEN_INVALID when code does not match a valid token', async () => {
      mockFindValid.mockResolvedValue(null);

      try {
        await service.verify({ email: 'user@example.com', code: '000000' }, ctx);
        fail('expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = (err as BadRequestException).getResponse();
        expect(response).toMatchObject({ code: 'TOKEN_INVALID' });
      }
    });

    it('does not issue tokens or mark anything used when the code is invalid', async () => {
      mockFindValid.mockResolvedValue(null);

      await expect(
        service.verify({ email: 'user@example.com', code: '000000' }, ctx),
      ).rejects.toThrow(BadRequestException);

      expect(mockMarkUsed).not.toHaveBeenCalled();
      expect(mockMarkVerified).not.toHaveBeenCalled();
      expect(mockSignAccess).not.toHaveBeenCalled();
      expect(mockSignRefresh).not.toHaveBeenCalled();
      expect(mockCreateFamily).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });
});
