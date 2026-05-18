import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';

import { PasswordService } from './password.service';
import { ResetPasswordService } from './reset-password.service';
import type { User } from '../domain/user.types';
import { UserRepository } from '../repositories/user.repository';
import { VerificationTokenRepository } from '../repositories/verification-token.repository';

const mockFindByEmail = jest.fn();
const mockUpdatePasswordHash = jest.fn();
const mockFindValid = jest.fn();
const mockMarkUsed = jest.fn();
const mockInvalidateActive = jest.fn();
const mockHash = jest.fn();
const mockEmit = jest.fn();

const user: User = {
  id: 'user-uuid-1',
  email: 'user@example.com',
  passwordHash: '$argon2id$old$hash',
  firstName: 'John',
  lastName: 'Doe',
  phone: null,
  authProvider: 'email',
  status: 'active',
  emailVerified: true,
  createdAt: new Date(),
};

const validToken = {
  id: 'tok-reset-1',
  userId: 'user-uuid-1',
  type: 'reset_password' as const,
  token: '987654',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  used: false,
  createdAt: new Date(),
};

const ctx = { requestId: 'req-1', ip: '127.0.0.1' };

describe('ResetPasswordService', () => {
  let service: ResetPasswordService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFindByEmail.mockResolvedValue(user);
    mockFindValid.mockResolvedValue(validToken);
    mockHash.mockResolvedValue('$argon2id$new$hash');
    mockUpdatePasswordHash.mockResolvedValue({ ...user, passwordHash: '$argon2id$new$hash' });
    mockMarkUsed.mockResolvedValue(undefined);
    mockInvalidateActive.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResetPasswordService,
        {
          provide: UserRepository,
          useValue: {
            findByEmail: mockFindByEmail,
            updatePasswordHash: mockUpdatePasswordHash,
          },
        },
        {
          provide: VerificationTokenRepository,
          useValue: {
            findValid: mockFindValid,
            markUsed: mockMarkUsed,
            invalidateActive: mockInvalidateActive,
          },
        },
        { provide: PasswordService, useValue: { hash: mockHash } },
        { provide: EventEmitter2, useValue: { emit: mockEmit } },
      ],
    }).compile();

    service = module.get<ResetPasswordService>(ResetPasswordService);
  });

  describe('success path', () => {
    const validDto = {
      email: 'user@example.com',
      token: '987654',
      new_password: 'NewSecure1',
    };

    it('looks up user by email and validates the reset_password token', async () => {
      await service.reset(validDto, ctx);

      expect(mockFindByEmail).toHaveBeenCalledWith('user@example.com');
      expect(mockFindValid).toHaveBeenCalledWith('user-uuid-1', 'reset_password', '987654');
    });

    it('hashes the new password with PasswordService before storing', async () => {
      await service.reset(validDto, ctx);

      expect(mockHash).toHaveBeenCalledWith('NewSecure1');
      expect(mockUpdatePasswordHash).toHaveBeenCalledWith('user-uuid-1', '$argon2id$new$hash');
    });

    it('marks the used token as consumed and invalidates remaining reset tokens', async () => {
      await service.reset(validDto, ctx);

      expect(mockMarkUsed).toHaveBeenCalledWith('tok-reset-1');
      expect(mockInvalidateActive).toHaveBeenCalledWith('user-uuid-1', 'reset_password');
    });

    it('emits auth.password.reset.completed with actor=user.id', async () => {
      await service.reset(validDto, ctx);

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'auth.password.reset.completed',
          actor: 'user-uuid-1',
        }),
      );
    });

    it('returns void on success', async () => {
      await expect(service.reset(validDto, ctx)).resolves.toBeUndefined();
    });
  });

  describe('failure paths', () => {
    it('throws BadRequestException(TOKEN_INVALID) when user is not found', async () => {
      mockFindByEmail.mockResolvedValue(null);

      try {
        await service.reset(
          { email: 'ghost@example.com', token: '000000', new_password: 'NewSecure1' },
          ctx,
        );
        fail('expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = (err as BadRequestException).getResponse();
        expect(response).toMatchObject({ code: 'TOKEN_INVALID' });
      }
    });

    it('throws BadRequestException(TOKEN_INVALID) when the code does not match', async () => {
      mockFindValid.mockResolvedValue(null);

      try {
        await service.reset(
          { email: 'user@example.com', token: '000000', new_password: 'NewSecure1' },
          ctx,
        );
        fail('expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
      }
    });

    it('does not mutate the password or emit audit when the code is invalid', async () => {
      mockFindValid.mockResolvedValue(null);

      await expect(
        service.reset(
          { email: 'user@example.com', token: '000000', new_password: 'NewSecure1' },
          ctx,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockHash).not.toHaveBeenCalled();
      expect(mockUpdatePasswordHash).not.toHaveBeenCalled();
      expect(mockMarkUsed).not.toHaveBeenCalled();
      expect(mockInvalidateActive).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });
});
