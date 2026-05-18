import { randomUUID } from 'crypto';

import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AUDIT_RECORDED_EVENT,
  type AuditAction,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';

import { FacebookOAuthVerifier } from './facebook-oauth.verifier';
import { GoogleOAuthVerifier } from './google-oauth.verifier';
import { JwtService } from './jwt.service';
import type { AuthProvider, PublicUser, User } from '../domain/user.types';
import type { SocialLoginDto } from '../dtos/social-login.dto';
import { RefreshTokenStore } from '../repositories/refresh-token-store';
import { UserRepository } from '../repositories/user.repository';

export interface SocialLoginContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

export interface SocialLoginResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
  isNewUser: boolean;
}

@Injectable()
export class SocialLoginService {
  private readonly logger = new Logger(SocialLoginService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly google: GoogleOAuthVerifier,
    private readonly facebook: FacebookOAuthVerifier,
    private readonly jwt: JwtService,
    private readonly refreshStore: RefreshTokenStore,
    private readonly emitter: EventEmitter2,
  ) {}

  async login(dto: SocialLoginDto, context: SocialLoginContext = {}): Promise<SocialLoginResult> {
    const claims =
      dto.provider === 'google'
        ? await this.google.verify(dto.id_token)
        : await this.facebook.verify(dto.id_token);

    const existingByProvider = await this.users.findByProvider(dto.provider, claims.sub);
    if (existingByProvider) {
      return this.issueTokens(existingByProvider, false, dto.provider, context);
    }

    const existingByEmail = await this.users.findByEmail(claims.email);
    if (existingByEmail) {
      this.logger.warn(
        {
          userId: existingByEmail.id,
          existingProvider: existingByEmail.authProvider,
          attemptedProvider: dto.provider,
        },
        'Social login blocked — email already linked to a different provider',
      );
      throw new ConflictException({
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'An account with this email already exists with a different sign-in method',
        details: {
          requiresMerge: true,
          currentProvider: existingByEmail.authProvider,
        },
      });
    }

    const created = await this.users.createSocialUser({
      email: claims.email,
      firstName: claims.firstName,
      lastName: claims.lastName,
      authProvider: dto.provider,
      authProviderId: claims.sub,
    });

    return this.issueTokens(created, true, dto.provider, context);
  }

  private async issueTokens(
    user: User,
    isNewUser: boolean,
    provider: AuthProvider,
    context: SocialLoginContext,
  ): Promise<SocialLoginResult> {
    const familyId = randomUUID();
    const tokenId = randomUUID();

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAccessToken({ sub: user.id, role: 'user' }),
      this.jwt.signRefreshToken({ sub: user.id, familyId, tokenId }),
    ]);

    await this.refreshStore.createFamily(familyId, user.id, tokenId);

    this.emitEvent('auth.login.success', user.id, context, { provider, isNewUser });

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

    return { accessToken, refreshToken, user: publicUser, isNewUser };
  }

  private emitEvent(
    action: AuditAction,
    actor: string,
    context: SocialLoginContext,
    metadata: Record<string, unknown>,
  ): void {
    const evt: AuditRecordedEvent = {
      action,
      actor,
      timestamp: new Date().toISOString(),
      ...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
      ...(context.ip !== undefined ? { ip: context.ip } : {}),
      metadata,
    };
    this.emitter.emit(AUDIT_RECORDED_EVENT, evt);
  }
}
