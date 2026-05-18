import { randomUUID } from 'crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AUDIT_RECORDED_EVENT,
  type AuditAction,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';

import { JwtService } from './jwt.service';
import { PasswordService } from './password.service';
import type { PublicUser } from '../domain/user.types';
import type { LoginDto } from '../dtos/login.dto';
import { RefreshTokenStore } from '../repositories/refresh-token-store';
import { UserRepository } from '../repositories/user.repository';

export interface LoginContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

@Injectable()
export class LoginService {
  constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly refreshStore: RefreshTokenStore,
    private readonly emitter: EventEmitter2,
  ) {}

  async login(dto: LoginDto, context: LoginContext = {}): Promise<LoginResult> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) {
      this.emitFailure('anonymous', 'user_not_found', context);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (user.passwordHash === null) {
      this.emitFailure(user.id, 'no_password_set', context);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const valid = await this.passwords.verify(dto.password, user.passwordHash);
    if (!valid) {
      this.emitFailure(user.id, 'invalid_password', context);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (user.status === 'suspended') {
      this.emitFailure(user.id, 'account_suspended', context);
      throw new UnauthorizedException('Cuenta suspendida');
    }

    if (user.status === 'inactive') {
      this.emitFailure(user.id, 'account_inactive', context);
      throw new UnauthorizedException('Cuenta inactiva');
    }

    if (!user.emailVerified) {
      this.emitFailure(user.id, 'user_not_verified', context);
      throw new UnauthorizedException({
        code: 'USER_NOT_VERIFIED',
        message: 'Email verification required',
      });
    }

    const familyId = randomUUID();
    const tokenId = randomUUID();

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAccessToken({ sub: user.id, role: 'user' }),
      this.jwt.signRefreshToken({ sub: user.id, familyId, tokenId }),
    ]);

    await this.refreshStore.createFamily(familyId, user.id, tokenId);

    this.emitSuccess(user.id, context);

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
    return { accessToken, refreshToken, user: publicUser };
  }

  private emitSuccess(actor: string, context: LoginContext): void {
    this.emitEvent('auth.login.success', actor, context);
  }

  private emitFailure(actor: string, reason: string, context: LoginContext): void {
    this.emitEvent('auth.login.failure', actor, context, { reason });
  }

  private emitEvent(
    action: AuditAction,
    actor: string,
    context: LoginContext,
    metadata?: Record<string, unknown>,
  ): void {
    const evt: AuditRecordedEvent = {
      action,
      actor,
      timestamp: new Date().toISOString(),
      ...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
      ...(context.ip !== undefined ? { ip: context.ip } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    };
    this.emitter.emit(AUDIT_RECORDED_EVENT, evt);
  }
}
