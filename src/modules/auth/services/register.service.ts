import { randomInt } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AppConfigService } from '@/config/config.service';
import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';
import { EmailService } from '@/modules/email/email.service';

import { PasswordService } from './password.service';
import type { PublicUser } from '../domain/user.types';
import { type RegisterDto } from '../dtos/register.dto';
import {
  type CreateEmailUserInput,
  EmailAlreadyExistsError,
  PhoneAlreadyExistsError,
  UserRepository,
} from '../repositories/user.repository';
import { VerificationTokenRepository } from '../repositories/verification-token.repository';

export { EmailAlreadyExistsError, PhoneAlreadyExistsError };

export interface RegisterContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

export interface RegisterResult {
  user: PublicUser;
  verificationRequired: true;
}

@Injectable()
export class RegisterService {
  private readonly logger = new Logger(RegisterService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: VerificationTokenRepository,
    private readonly emailer: EmailService,
    private readonly config: AppConfigService,
    private readonly emitter: EventEmitter2,
  ) {}

  async register(dto: RegisterDto, context: RegisterContext = {}): Promise<RegisterResult> {
    const passwordHash = await this.passwords.hash(dto.password);

    const input: CreateEmailUserInput = {
      email: dto.email,
      passwordHash,
      firstName: dto.first_name,
      lastName: dto.last_name,
      phone: dto.phone ?? null,
      acceptedPolicy: dto.accepted_policy,
    };

    const user = await this.users.createWithEmail(input);

    const ttlMinutes = this.config.get('EMAIL_VERIFICATION_CODE_TTL_MIN');
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await this.tokens.create({
      userId: user.id,
      type: 'email',
      token: code,
      expiresAt,
    });

    try {
      await this.emailer.sendVerificationCode({
        to: user.email ?? dto.email,
        code,
        firstName: user.firstName,
      });
    } catch (err) {
      this.logger.error(
        { userId: user.id, error: err instanceof Error ? err.message : String(err) },
        'Verification email failed to send during registration',
      );
    }

    const auditEvent: AuditRecordedEvent = {
      action: 'auth.register',
      actor: user.id,
      target: { type: 'user', id: user.id },
      timestamp: new Date().toISOString(),
      ...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
      ...(context.ip !== undefined ? { ip: context.ip } : {}),
    };
    this.emitter.emit(AUDIT_RECORDED_EVENT, auditEvent);

    const publicUser: PublicUser = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      authProvider: user.authProvider,
      authProviderId: user.authProviderId,
      status: user.status,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    };

    return { user: publicUser, verificationRequired: true };
  }
}

function generateVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
