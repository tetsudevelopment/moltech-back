import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { RESET_CODE_MAX_ATTEMPTS } from '../auth.constants';
import { UserRepository } from '../repositories/user.repository';
import { VerificationTokenRepository } from '../repositories/verification-token.repository';

export interface ValidateResetAttemptResult {
  tokenId: string;
  userId: string;
  attemptsRemaining: number;
}

@Injectable()
export class VerifyResetCodeService {
  private readonly logger = new Logger(VerifyResetCodeService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly tokens: VerificationTokenRepository,
  ) {}

  /**
   * Validates a reset OTP without consuming it.
   * Enforces a 3-attempt limit per code.
   * Shared guard used by both the verify-reset-code endpoint and reset-password.
   *
   * Throws:
   *  - BadRequestException(TOKEN_INVALID) on wrong code or unknown identity (anti-enumeration)
   *  - BadRequestException(ATTEMPTS_EXHAUSTED) when the limit is reached
   *
   * On success returns { tokenId, attemptsRemaining } without incrementing or consuming.
   */
  async validateResetAttempt(email: string, token: string): Promise<ValidateResetAttemptResult> {
    const user = await this.users.findByEmail(email);
    if (!user) {
      this.logger.warn({ reason: 'user_not_found' }, 'verify-reset-code rejected');
      // Anti-enumeration: mimic first real failed attempt
      throw new BadRequestException({
        code: 'TOKEN_INVALID',
        message: 'Invalid or expired reset code',
        details: { attemptsRemaining: RESET_CODE_MAX_ATTEMPTS - 1 },
      });
    }

    const activeToken = await this.tokens.findActiveResetToken(user.id);
    if (!activeToken) {
      this.logger.warn(
        { userId: user.id, reason: 'no_active_reset_token' },
        'verify-reset-code rejected',
      );
      // Anti-enumeration: mimic first real failed attempt
      throw new BadRequestException({
        code: 'TOKEN_INVALID',
        message: 'Invalid or expired reset code',
        details: { attemptsRemaining: RESET_CODE_MAX_ATTEMPTS - 1 },
      });
    }

    // Pre-check: already at the limit before even attempting
    if (activeToken.attemptsUsed >= RESET_CODE_MAX_ATTEMPTS) {
      this.logger.warn(
        { userId: user.id, tokenId: activeToken.id, reason: 'attempts_exhausted_on_entry' },
        'verify-reset-code rejected',
      );
      await this.tokens.invalidateActive(user.id, 'reset_password');
      throw new BadRequestException({
        code: 'ATTEMPTS_EXHAUSTED',
        message: 'Maximum verification attempts reached. Please request a new reset code.',
      });
    }

    // Code matches — success (do not increment, do not consume)
    if (activeToken.token === token) {
      return {
        tokenId: activeToken.id,
        userId: activeToken.userId,
        attemptsRemaining: RESET_CODE_MAX_ATTEMPTS - activeToken.attemptsUsed,
      };
    }

    // Code mismatch — atomically increment
    const newCount = await this.tokens.incrementAttempts(activeToken.id);

    if (newCount === null || newCount >= RESET_CODE_MAX_ATTEMPTS) {
      this.logger.warn(
        { userId: user.id, tokenId: activeToken.id, reason: 'attempts_exhausted' },
        'verify-reset-code rejected — limit reached',
      );
      await this.tokens.invalidateActive(user.id, 'reset_password');
      throw new BadRequestException({
        code: 'ATTEMPTS_EXHAUSTED',
        message: 'Maximum verification attempts reached. Please request a new reset code.',
      });
    }

    this.logger.warn(
      { userId: user.id, tokenId: activeToken.id, newCount, reason: 'wrong_code' },
      'verify-reset-code rejected — wrong code',
    );
    throw new BadRequestException({
      code: 'TOKEN_INVALID',
      message: 'Invalid or expired reset code',
      details: { attemptsRemaining: RESET_CODE_MAX_ATTEMPTS - newCount },
    });
  }
}
