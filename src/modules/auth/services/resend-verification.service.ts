import { randomInt } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '@/config/config.service';
import { EmailService } from '@/modules/email/email.service';

import type { ResendVerificationDto } from '../dtos/resend-verification.dto';
import { UserRepository } from '../repositories/user.repository';
import { VerificationTokenRepository } from '../repositories/verification-token.repository';

const RESEND_COOLDOWN_MS = 60_000;

@Injectable()
export class ResendVerificationService {
  private readonly logger = new Logger(ResendVerificationService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly tokens: VerificationTokenRepository,
    private readonly emailer: EmailService,
    private readonly config: AppConfigService,
  ) {}

  async resend(dto: ResendVerificationDto): Promise<void> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) {
      // Silent: do not leak which emails are registered.
      return;
    }

    if (user.emailVerified) {
      // Already verified — silent.
      return;
    }

    const latest = await this.tokens.findLatestUnused(user.id, 'email');
    if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      // Rate-limited per email — silent.
      return;
    }

    await this.tokens.invalidateActive(user.id, 'email');

    const code = generateVerificationCode();
    const ttlMinutes = this.config.get('EMAIL_VERIFICATION_CODE_TTL_MIN');
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await this.tokens.create({
      userId: user.id,
      type: 'email',
      token: code,
      expiresAt,
    });

    if (user.email === null) {
      this.logger.warn(
        { userId: user.id },
        'Resend requested for user without an email address; skipping send',
      );
      return;
    }

    try {
      await this.emailer.sendVerificationCode({
        to: user.email,
        code,
        firstName: user.firstName,
      });
    } catch (err) {
      this.logger.error(
        { userId: user.id, error: err instanceof Error ? err.message : String(err) },
        'Resend verification email failed',
      );
    }
  }
}

function generateVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
