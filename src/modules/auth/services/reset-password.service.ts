import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';

import { PasswordService } from './password.service';
import type { ResetPasswordDto } from '../dtos/reset-password.dto';
import { UserRepository } from '../repositories/user.repository';
import { VerificationTokenRepository } from '../repositories/verification-token.repository';

export interface ResetPasswordContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

const INVALID_TOKEN_RESPONSE = {
  code: 'TOKEN_INVALID',
  message: 'Invalid or expired reset code',
} as const;

@Injectable()
export class ResetPasswordService {
  private readonly logger = new Logger(ResetPasswordService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly tokens: VerificationTokenRepository,
    private readonly passwords: PasswordService,
    private readonly emitter: EventEmitter2,
  ) {}

  async reset(dto: ResetPasswordDto, context: ResetPasswordContext = {}): Promise<void> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) {
      this.logger.warn(
        { requestId: context.requestId, reason: 'user_not_found' },
        'Reset-password rejected',
      );
      throw new BadRequestException(INVALID_TOKEN_RESPONSE);
    }

    const token = await this.tokens.findValid(user.id, 'reset_password', dto.token);
    if (!token) {
      this.logger.warn(
        { userId: user.id, requestId: context.requestId, reason: 'invalid_or_expired' },
        'Reset-password rejected',
      );
      throw new BadRequestException(INVALID_TOKEN_RESPONSE);
    }

    const newHash = await this.passwords.hash(dto.new_password);

    await this.users.updatePasswordHash(user.id, newHash);
    await this.tokens.markUsed(token.id);
    await this.tokens.invalidateActive(user.id, 'reset_password');

    this.emitCompleted(user.id, context);
  }

  private emitCompleted(actor: string, context: ResetPasswordContext): void {
    const evt: AuditRecordedEvent = {
      action: 'auth.password.reset.completed',
      actor,
      target: { type: 'user', id: actor },
      timestamp: new Date().toISOString(),
      ...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
      ...(context.ip !== undefined ? { ip: context.ip } : {}),
    };
    this.emitter.emit(AUDIT_RECORDED_EVENT, evt);
  }
}
