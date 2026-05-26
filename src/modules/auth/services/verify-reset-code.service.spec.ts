import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { VerifyResetCodeService } from './verify-reset-code.service';
import { RESET_CODE_MAX_ATTEMPTS } from '../auth.constants';
import type { User } from '../domain/user.types';
import { UserRepository } from '../repositories/user.repository';
import type { VerificationToken } from '../repositories/verification-token.repository';
import { VerificationTokenRepository } from '../repositories/verification-token.repository';

const mockFindByEmail = jest.fn();
const mockFindActiveResetToken = jest.fn();
const mockIncrementAttempts = jest.fn();
const mockInvalidateActive = jest.fn();

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

function makeToken(overrides: Partial<VerificationToken> = {}): VerificationToken {
  return {
    id: 'tok-reset-1',
    userId: 'user-uuid-1',
    type: 'reset_password',
    token: '987654',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    used: false,
    attemptsUsed: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('VerifyResetCodeService', () => {
  let service: VerifyResetCodeService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFindByEmail.mockResolvedValue(user);
    mockFindActiveResetToken.mockResolvedValue(makeToken());
    mockIncrementAttempts.mockResolvedValue(1);
    mockInvalidateActive.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerifyResetCodeService,
        {
          provide: UserRepository,
          useValue: { findByEmail: mockFindByEmail },
        },
        {
          provide: VerificationTokenRepository,
          useValue: {
            findActiveResetToken: mockFindActiveResetToken,
            incrementAttempts: mockIncrementAttempts,
            invalidateActive: mockInvalidateActive,
          },
        },
      ],
    }).compile();

    service = module.get<VerifyResetCodeService>(VerifyResetCodeService);
  });

  describe('validateResetAttempt()', () => {
    describe('success path', () => {
      it('returns { tokenId, userId, attemptsRemaining: MAX } on first valid attempt (attemptsUsed=0)', async () => {
        mockFindActiveResetToken.mockResolvedValue(makeToken({ attemptsUsed: 0 }));

        const result = await service.validateResetAttempt('user@example.com', '987654');

        expect(result.tokenId).toBe('tok-reset-1');
        expect(result.userId).toBe('user-uuid-1');
        expect(result.attemptsRemaining).toBe(RESET_CODE_MAX_ATTEMPTS);
      });

      it('does NOT call incrementAttempts on success (no consume)', async () => {
        await service.validateResetAttempt('user@example.com', '987654');

        expect(mockIncrementAttempts).not.toHaveBeenCalled();
      });

      it('does NOT call invalidateActive on success', async () => {
        await service.validateResetAttempt('user@example.com', '987654');

        expect(mockInvalidateActive).not.toHaveBeenCalled();
      });

      it('returns userId and attemptsRemaining = MAX - attemptsUsed when token already has prior attempts', async () => {
        mockFindActiveResetToken.mockResolvedValue(makeToken({ attemptsUsed: 1 }));

        const result = await service.validateResetAttempt('user@example.com', '987654');

        expect(result.userId).toBe('user-uuid-1');
        expect(result.attemptsRemaining).toBe(RESET_CODE_MAX_ATTEMPTS - 1);
      });
    });

    describe('unknown email (anti-enumeration mimic)', () => {
      it('throws TOKEN_INVALID with attemptsRemaining=MAX-1 when email is not found', async () => {
        mockFindByEmail.mockResolvedValue(null);

        try {
          await service.validateResetAttempt('ghost@example.com', '123456');
          fail('expected BadRequestException');
        } catch (err) {
          expect(err).toBeInstanceOf(BadRequestException);
          const response = (err as BadRequestException).getResponse() as Record<string, unknown>;
          expect(response.code).toBe('TOKEN_INVALID');
          expect((response.details as Record<string, unknown>).attemptsRemaining).toBe(
            RESET_CODE_MAX_ATTEMPTS - 1,
          );
        }
      });
    });

    describe('no active reset token (anti-enumeration mimic)', () => {
      it('throws TOKEN_INVALID with attemptsRemaining=MAX-1 when no active token exists', async () => {
        mockFindActiveResetToken.mockResolvedValue(null);

        try {
          await service.validateResetAttempt('user@example.com', '123456');
          fail('expected BadRequestException');
        } catch (err) {
          expect(err).toBeInstanceOf(BadRequestException);
          const response = (err as BadRequestException).getResponse() as Record<string, unknown>;
          expect(response.code).toBe('TOKEN_INVALID');
          expect((response.details as Record<string, unknown>).attemptsRemaining).toBe(
            RESET_CODE_MAX_ATTEMPTS - 1,
          );
        }
      });
    });

    describe('token already at MAX attempts on entry', () => {
      it('calls invalidateActive and throws ATTEMPTS_EXHAUSTED when attemptsUsed >= MAX', async () => {
        mockFindActiveResetToken.mockResolvedValue(
          makeToken({ attemptsUsed: RESET_CODE_MAX_ATTEMPTS }),
        );

        try {
          await service.validateResetAttempt('user@example.com', '987654');
          fail('expected BadRequestException');
        } catch (err) {
          expect(err).toBeInstanceOf(BadRequestException);
          const response = (err as BadRequestException).getResponse() as Record<string, unknown>;
          expect(response.code).toBe('ATTEMPTS_EXHAUSTED');
          expect(mockInvalidateActive).toHaveBeenCalledWith('user-uuid-1', 'reset_password');
        }
      });
    });

    describe('wrong code path', () => {
      it('increments attempts and throws TOKEN_INVALID with attemptsRemaining when attempts remain', async () => {
        // attemptsUsed=0, increment returns 1 → 2 remaining
        mockIncrementAttempts.mockResolvedValue(1);

        try {
          await service.validateResetAttempt('user@example.com', 'WRONG1');
          fail('expected BadRequestException');
        } catch (err) {
          expect(err).toBeInstanceOf(BadRequestException);
          const response = (err as BadRequestException).getResponse() as Record<string, unknown>;
          expect(response.code).toBe('TOKEN_INVALID');
          expect((response.details as Record<string, unknown>).attemptsRemaining).toBe(
            RESET_CODE_MAX_ATTEMPTS - 1,
          );
          expect(mockIncrementAttempts).toHaveBeenCalledWith('tok-reset-1');
        }
      });

      it('second wrong attempt → attemptsRemaining=1', async () => {
        mockFindActiveResetToken.mockResolvedValue(makeToken({ attemptsUsed: 1 }));
        mockIncrementAttempts.mockResolvedValue(2);

        try {
          await service.validateResetAttempt('user@example.com', 'WRONG2');
          fail('expected BadRequestException');
        } catch (err) {
          expect(err).toBeInstanceOf(BadRequestException);
          const response = (err as BadRequestException).getResponse() as Record<string, unknown>;
          expect((response.details as Record<string, unknown>).attemptsRemaining).toBe(1);
        }
      });

      it('third wrong attempt → ATTEMPTS_EXHAUSTED + invalidateActive called', async () => {
        mockFindActiveResetToken.mockResolvedValue(makeToken({ attemptsUsed: 2 }));
        mockIncrementAttempts.mockResolvedValue(RESET_CODE_MAX_ATTEMPTS);

        try {
          await service.validateResetAttempt('user@example.com', 'WRONG3');
          fail('expected BadRequestException');
        } catch (err) {
          expect(err).toBeInstanceOf(BadRequestException);
          const response = (err as BadRequestException).getResponse() as Record<string, unknown>;
          expect(response.code).toBe('ATTEMPTS_EXHAUSTED');
          expect(mockInvalidateActive).toHaveBeenCalledWith('user-uuid-1', 'reset_password');
        }
      });

      it('incrementAttempts returns null (race/at-limit) → ATTEMPTS_EXHAUSTED + invalidateActive', async () => {
        mockIncrementAttempts.mockResolvedValue(null);

        try {
          await service.validateResetAttempt('user@example.com', 'WRONG4');
          fail('expected BadRequestException');
        } catch (err) {
          expect(err).toBeInstanceOf(BadRequestException);
          const response = (err as BadRequestException).getResponse() as Record<string, unknown>;
          expect(response.code).toBe('ATTEMPTS_EXHAUSTED');
          expect(mockInvalidateActive).toHaveBeenCalledWith('user-uuid-1', 'reset_password');
        }
      });
    });
  });
});
