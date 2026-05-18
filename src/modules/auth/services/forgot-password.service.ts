import { randomInt } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AppConfigService } from '@/config/config.service';
import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';
import { EmailService } from '@/modules/email/email.service';

import type { ForgotPasswordDto } from '../dtos/forgot-password.dto';
import { UserRepository } from '../repositories/user.repository';
import { VerificationTokenRepository } from '../repositories/verification-token.repository';

export interface ForgotPasswordContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

const RESEND_COOLDOWN_MS = 60_000;

@Injectable()
export class ForgotPasswordService {
  private readonly logger = new Logger(ForgotPasswordService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly tokens: VerificationTokenRepository,
    private readonly emailer: EmailService,
    private readonly config: AppConfigService,
    private readonly emitter: EventEmitter2,
  ) {}

  async request(dto: ForgotPasswordDto, context: ForgotPasswordContext = {}): Promise<void> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) {
      return;
    }

    if (user.status === 'suspended' || user.status === 'inactive') {
      this.logger.warn(
        { userId: user.id, status: user.status, requestId: context.requestId },
        'Password reset requested for non-active user; suppressed',
      );
      return;
    }

    const latest = await this.tokens.findLatestUnused(user.id, 'reset_password');
    if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      return;
    }

    await this.tokens.invalidateActive(user.id, 'reset_password');

    const code = generateResetCode();
    const ttlMinutes = this.config.get('EMAIL_VERIFICATION_CODE_TTL_MIN');
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await this.tokens.create({
      userId: user.id,
      type: 'reset_password',
      token: code,
      expiresAt,
    });

    this.emitRequested(user.id, context);

    if (user.email === null) {
      this.logger.warn(
        { userId: user.id },
        'Password reset requested for user without an email; skipping send',
      );
      return;
    }

    try {
      await this.emailer.sendPasswordResetCode({
        to: user.email,
        code,
        firstName: user.firstName,
      });
    } catch (err) {
      this.logger.error(
        { userId: user.id, error: err instanceof Error ? err.message : String(err) },
        'Password reset email failed to send',
      );
    }
  }

  private emitRequested(actor: string, context: ForgotPasswordContext): void {
    const evt: AuditRecordedEvent = {
      action: 'auth.password.reset.requested',
      actor,
      target: { type: 'user', id: actor },
      timestamp: new Date().toISOString(),
      ...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
      ...(context.ip !== undefined ? { ip: context.ip } : {}),
    };
    this.emitter.emit(AUDIT_RECORDED_EVENT, evt);
  }
}

function generateResetCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
