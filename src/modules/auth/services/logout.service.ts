import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';

import { JwtService } from './jwt.service';
import { RefreshTokenStore } from '../repositories/refresh-token-store';

export interface LogoutContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

@Injectable()
export class LogoutService {
  private readonly logger = new Logger(LogoutService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly refreshStore: RefreshTokenStore,
    private readonly emitter: EventEmitter2,
  ) {}

  async logout(refreshToken: string, context: LogoutContext = {}): Promise<void> {
    try {
      const claims = await this.jwt.verifyRefreshToken(refreshToken);
      await this.refreshStore.revokeFamily(claims.familyId);
      const evt: AuditRecordedEvent = {
        action: 'auth.logout',
        actor: claims.sub,
        timestamp: new Date().toISOString(),
        ...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
        ...(context.ip !== undefined ? { ip: context.ip } : {}),
      };
      this.emitter.emit(AUDIT_RECORDED_EVENT, evt);
    } catch (err) {
      // Logout is permissive — if token is invalid/expired, we don't fail the client request.
      // The token is effectively useless anyway; nothing to revoke.
      this.logger.debug({ err: (err as Error).message }, 'Logout called with invalid token');
    }
  }
}
