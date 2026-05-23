import { randomUUID } from 'crypto';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AUDIT_RECORDED_EVENT,
  type AuditAction,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';

import { JwtService } from './jwt.service';
import { RefreshTokenStore } from '../repositories/refresh-token-store';
import { UserRepository } from '../repositories/user.repository';

export interface RefreshContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class RefreshService {
  private readonly logger = new Logger(RefreshService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly refreshStore: RefreshTokenStore,
    private readonly users: UserRepository,
    private readonly emitter: EventEmitter2,
  ) {}

  async refresh(refreshToken: string, context: RefreshContext = {}): Promise<RefreshResult> {
    let claims: Awaited<ReturnType<JwtService['verifyRefreshToken']>>;

    try {
      claims = await this.jwt.verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const { sub: userId, familyId, tokenId } = claims;

    const currentTokenId = await this.refreshStore.getCurrentTokenId(familyId);

    if (currentTokenId === null || currentTokenId !== tokenId) {
      // REUSE DETECTED — revoke the entire family
      await this.refreshStore.revokeFamily(familyId);
      this.logger.warn({ userId, familyId }, 'Refresh token reuse detected — family revoked');
      this.emit('auth.refresh.reused', userId, context, { familyId });
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    // Valid rotation — generate new tokenId and rotate. We re-read the user
    // so role changes (e.g. promotion to admin) propagate on the next refresh
    // without forcing a full re-login.
    const newTokenId = randomUUID();
    await this.refreshStore.setCurrentTokenId(familyId, newTokenId);

    const user = await this.users.findById(userId);
    if (!user) {
      await this.refreshStore.revokeFamily(familyId);
      throw new UnauthorizedException('User no longer exists');
    }

    const [accessToken, newRefreshToken] = await Promise.all([
      this.jwt.signAccessToken({ sub: userId, role: user.role }),
      this.jwt.signRefreshToken({ sub: userId, familyId, tokenId: newTokenId }),
    ]);

    this.emit('auth.refresh.rotated', userId, context);

    return { accessToken, refreshToken: newRefreshToken };
  }

  private emit(
    action: AuditAction,
    actor: string,
    context: RefreshContext,
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
