import { randomUUID } from 'crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';

import { JwtService } from './jwt.service';
import type { PublicUser } from '../domain/user.types';
import type { VerifyEmailDto } from '../dtos/verify-email.dto';
import { RefreshTokenStore } from '../repositories/refresh-token-store';
import { UserRepository } from '../repositories/user.repository';
import { VerificationTokenRepository } from '../repositories/verification-token.repository';

export interface VerifyEmailContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

export interface VerifyEmailResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

const INVALID_CODE_RESPONSE = {
  code: 'TOKEN_INVALID',
  message: 'Invalid or expired verification code',
} as const;

@Injectable()
export class VerifyEmailService {
  private readonly logger = new Logger(VerifyEmailService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly tokens: VerificationTokenRepository,
    private readonly jwt: JwtService,
    private readonly refreshStore: RefreshTokenStore,
    private readonly emitter: EventEmitter2,
  ) {}

  async verify(dto: VerifyEmailDto, context: VerifyEmailContext = {}): Promise<VerifyEmailResult> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) {
      this.logger.warn(
        { requestId: context.requestId, reason: 'user_not_found' },
        'Verify-email rejected',
      );
      throw new BadRequestException(INVALID_CODE_RESPONSE);
    }

    const token = await this.tokens.findValid(user.id, 'email', dto.code);
    if (!token) {
      this.logger.warn(
        { userId: user.id, requestId: context.requestId, reason: 'invalid_or_expired' },
        'Verify-email rejected',
      );
      throw new BadRequestException(INVALID_CODE_RESPONSE);
    }

    await this.tokens.markUsed(token.id);

    const activatedUser = user.emailVerified
      ? user
      : await this.users.markEmailVerifiedAndActivate(user.id);

    const familyId = randomUUID();
    const tokenId = randomUUID();
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAccessToken({ sub: activatedUser.id, role: activatedUser.role }),
      this.jwt.signRefreshToken({ sub: activatedUser.id, familyId, tokenId }),
    ]);
    await this.refreshStore.createFamily(familyId, activatedUser.id, tokenId);

    this.emitSuccess(activatedUser.id, context);

    const publicUser: PublicUser = {
      id: activatedUser.id,
      email: activatedUser.email,
      firstName: activatedUser.firstName,
      lastName: activatedUser.lastName,
      phone: activatedUser.phone,
      authProvider: activatedUser.authProvider,
      authProviderId: activatedUser.authProviderId,
      status: activatedUser.status,
      emailVerified: activatedUser.emailVerified,
      role: activatedUser.role,
      createdAt: activatedUser.createdAt,
    };
    return { accessToken, refreshToken, user: publicUser };
  }

  private emitSuccess(actor: string, context: VerifyEmailContext): void {
    const evt: AuditRecordedEvent = {
      action: 'auth.email.verified',
      actor,
      target: { type: 'user', id: actor },
      timestamp: new Date().toISOString(),
      ...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
      ...(context.ip !== undefined ? { ip: context.ip } : {}),
    };
    this.emitter.emit(AUDIT_RECORDED_EVENT, evt);
  }
}
