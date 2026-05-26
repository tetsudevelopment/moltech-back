import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';

import { PasswordService } from './password.service';
import { ResetPasswordService } from './reset-password.service';
import { VerifyResetCodeService } from './verify-reset-code.service';
import { UserRepository } from '../repositories/user.repository';
import { VerificationTokenRepository } from '../repositories/verification-token.repository';

const mockUpdatePasswordHash = jest.fn();
const mockMarkUsed = jest.fn();
const mockInvalidateActive = jest.fn();
const mockHash = jest.fn();
const mockEmit = jest.fn();
const mockValidateResetAttempt = jest.fn();

const ctx = { requestId: 'req-1', ip: '127.0.0.1' };

describe('ResetPasswordService', () => {
  let service: ResetPasswordService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: guard passes — valid code, userId and 3 attempts remaining
    mockValidateResetAttempt.mockResolvedValue({
      tokenId: 'tok-reset-1',
      userId: 'user-uuid-1',
      attemptsRemaining: 3,
    });
    mockHash.mockResolvedValue('$argon2id$new$hash');
    mockUpdatePasswordHash.mockResolvedValue(undefined);
    mockMarkUsed.mockResolvedValue(undefined);
    mockInvalidateActive.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResetPasswordService,
        {
          provide: UserRepository,
          useValue: {
            updatePasswordHash: mockUpdatePasswordHash,
          },
        },
        {
          provide: VerificationTokenRepository,
          useValue: {
            markUsed: mockMarkUsed,
            invalidateActive: mockInvalidateActive,
          },
        },
        { provide: PasswordService, useValue: { hash: mockHash } },
        { provide: EventEmitter2, useValue: { emit: mockEmit } },
        {
          provide: VerifyResetCodeService,
          useValue: { validateResetAttempt: mockValidateResetAttempt },
        },
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

    it('calls validateResetAttempt guard with email and token before mutating', async () => {
      await service.reset(validDto, ctx);

      expect(mockValidateResetAttempt).toHaveBeenCalledWith('user@example.com', '987654');
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

  describe('bypass-guard: guard throws → NO password mutation', () => {
    const dto = {
      email: 'user@example.com',
      token: '000000',
      new_password: 'NewSecure1',
    };

    it('propagates TOKEN_INVALID from validateResetAttempt without mutating password', async () => {
      mockValidateResetAttempt.mockRejectedValue(
        new BadRequestException({
          code: 'TOKEN_INVALID',
          message: 'Invalid or expired reset code',
          details: { attemptsRemaining: 2 },
        }),
      );

      await expect(service.reset(dto, ctx)).rejects.toMatchObject({
        response: { code: 'TOKEN_INVALID' },
      });

      expect(mockHash).not.toHaveBeenCalled();
      expect(mockUpdatePasswordHash).not.toHaveBeenCalled();
      expect(mockMarkUsed).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('propagates ATTEMPTS_EXHAUSTED from validateResetAttempt without mutating password', async () => {
      mockValidateResetAttempt.mockRejectedValue(
        new BadRequestException({
          code: 'ATTEMPTS_EXHAUSTED',
          message: 'Maximum verification attempts reached',
        }),
      );

      await expect(service.reset(dto, ctx)).rejects.toMatchObject({
        response: { code: 'ATTEMPTS_EXHAUSTED' },
      });

      expect(mockHash).not.toHaveBeenCalled();
      expect(mockUpdatePasswordHash).not.toHaveBeenCalled();
      expect(mockMarkUsed).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });
});
