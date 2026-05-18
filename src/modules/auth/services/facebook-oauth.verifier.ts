import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '@/config/config.service';

const GRAPH_API_BASE = 'https://graph.facebook.com';

export interface FacebookVerifiedClaims {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
}

interface DebugTokenResponse {
  data?: {
    is_valid?: boolean;
    app_id?: string;
    user_id?: string;
    expires_at?: number;
  };
}

interface MeResponse {
  id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
}

const INVALID_TOKEN_RESPONSE = {
  code: 'TOKEN_INVALID',
  message: 'Invalid Facebook access token',
} as const;

@Injectable()
export class FacebookOAuthVerifier {
  private readonly logger = new Logger(FacebookOAuthVerifier.name);

  constructor(private readonly config: AppConfigService) {}

  async verify(userToken: string): Promise<FacebookVerifiedClaims> {
    const appId = this.config.get('FACEBOOK_APP_ID');
    const appSecret = this.config.get('FACEBOOK_APP_SECRET');
    const appAccessToken = `${appId}|${appSecret}`;

    let debugBody: DebugTokenResponse;
    try {
      const debugUrl = `${GRAPH_API_BASE}/debug_token?input_token=${encodeURIComponent(userToken)}&access_token=${encodeURIComponent(appAccessToken)}`;
      const debugResp = await fetch(debugUrl);
      if (!debugResp.ok) {
        throw new Error(`debug_token returned HTTP ${String(debugResp.status)}`);
      }
      debugBody = (await debugResp.json()) as DebugTokenResponse;
    } catch (err) {
      this.logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'Facebook debug_token call failed',
      );
      throw new BadRequestException(INVALID_TOKEN_RESPONSE);
    }

    if (!debugBody.data?.is_valid) {
      this.logger.warn({ reason: 'token_not_valid' }, 'Facebook token rejected');
      throw new BadRequestException(INVALID_TOKEN_RESPONSE);
    }
    if (debugBody.data.app_id !== appId) {
      this.logger.warn({ reason: 'wrong_app_id' }, 'Facebook token rejected');
      throw new BadRequestException(INVALID_TOKEN_RESPONSE);
    }
    const sub = debugBody.data.user_id;
    if (typeof sub !== 'string' || sub.length === 0) {
      this.logger.warn({ reason: 'missing_user_id' }, 'Facebook token rejected');
      throw new BadRequestException(INVALID_TOKEN_RESPONSE);
    }

    let me: MeResponse;
    try {
      const meUrl = `${GRAPH_API_BASE}/me?fields=id,email,first_name,last_name&access_token=${encodeURIComponent(userToken)}`;
      const meResp = await fetch(meUrl);
      if (!meResp.ok) {
        throw new Error(`me endpoint returned HTTP ${String(meResp.status)}`);
      }
      me = (await meResp.json()) as MeResponse;
    } catch (err) {
      this.logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'Facebook /me call failed',
      );
      throw new BadRequestException(INVALID_TOKEN_RESPONSE);
    }

    if (typeof me.email !== 'string' || me.email.length === 0) {
      this.logger.warn({ reason: 'missing_email' }, 'Facebook profile missing email');
      throw new BadRequestException({
        code: 'TOKEN_INVALID',
        message: 'Facebook account has no email permission granted',
      });
    }

    return {
      sub,
      email: me.email,
      firstName:
        typeof me.first_name === 'string' && me.first_name.trim().length > 0
          ? me.first_name
          : 'Facebook',
      lastName:
        typeof me.last_name === 'string' && me.last_name.trim().length > 0 ? me.last_name : 'User',
    };
  }
}
