import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';

import { PasswordService } from './password.service';
import { VerifyResetCodeService } from './verify-reset-code.service';
import type { ResetPasswordDto } from '../dtos/reset-password.dto';
import { UserRepository } from '../repositories/user.repository';
import { VerificationTokenRepository } from '../repositories/verification-token.repository';

export interface ResetPasswordContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

@Injectable()
export class ResetPasswordService {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: VerificationTokenRepository,
    private readonly passwords: PasswordService,
    private readonly emitter: EventEmitter2,
    private readonly verifyResetCodeService: VerifyResetCodeService,
  ) {}

  async reset(dto: ResetPasswordDto, context: ResetPasswordContext = {}): Promise<void> {
    // Guard: validates the code and enforces the attempt limit (throws on failure).
    // Returns userId from the token row — no second DB lookup needed.
    const { tokenId, userId } = await this.verifyResetCodeService.validateResetAttempt(
      dto.email,
      dto.token,
    );

    const newHash = await this.passwords.hash(dto.new_password);

    await this.users.updatePasswordHash(userId, newHash);
    await this.tokens.markUsed(tokenId);
    await this.tokens.invalidateActive(userId, 'reset_password');

    this.emitCompleted(userId, context);
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
