import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

import { AppConfigService } from '@/config/config.service';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export interface GoogleVerifiedClaims {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
}

const INVALID_TOKEN_RESPONSE = {
  code: 'TOKEN_INVALID',
  message: 'Invalid Google ID token',
} as const;

@Injectable()
export class GoogleOAuthVerifier {
  private readonly logger = new Logger(GoogleOAuthVerifier.name);
  private readonly jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

  constructor(private readonly config: AppConfigService) {}

  async verify(idToken: string): Promise<GoogleVerifiedClaims> {
    // Three audiences are accepted because the id_token's `aud` claim varies
    // by platform when using @react-native-google-signin/google-signin:
    //   - iOS    → aud = iOS Client ID
    //   - Android → aud = Web Client ID (yes, really; that's how the lib works)
    //   - Web    → aud = Web Client ID
    // The Android Client ID is kept to support raw native flows that don't go
    // through the JS lib (just in case). The WEB id is optional in env: filter
    // empty/undefined to avoid jose treating "" as a valid audience.
    const webClientId = this.config.get('GOOGLE_OAUTH_CLIENT_ID_WEB');
    const audiences = [
      this.config.get('GOOGLE_OAUTH_CLIENT_ID_ANDROID'),
      this.config.get('GOOGLE_OAUTH_CLIENT_ID_IOS'),
      ...(webClientId !== undefined && webClientId.length > 0 ? [webClientId] : []),
    ];

    let payload: JWTPayload;
    try {
      const result = await jwtVerify(idToken, this.jwks, {
        issuer: GOOGLE_ISSUERS,
        audience: audiences,
      });
      payload = result.payload;
    } catch (err) {
      this.logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'Google ID token verification failed',
      );
      throw new BadRequestException(INVALID_TOKEN_RESPONSE);
    }

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      this.logger.warn({ reason: 'missing_sub' }, 'Google ID token rejected');
      throw new BadRequestException(INVALID_TOKEN_RESPONSE);
    }
    if (typeof payload.email !== 'string' || payload.email.length === 0) {
      this.logger.warn({ reason: 'missing_email' }, 'Google ID token rejected');
      throw new BadRequestException(INVALID_TOKEN_RESPONSE);
    }
    if (payload.email_verified !== true) {
      this.logger.warn({ reason: 'email_unverified_by_google' }, 'Google ID token rejected');
      throw new BadRequestException(INVALID_TOKEN_RESPONSE);
    }

    const givenName = typeof payload.given_name === 'string' ? payload.given_name : '';
    const familyName = typeof payload.family_name === 'string' ? payload.family_name : '';

    return {
      sub: payload.sub,
      email: payload.email,
      firstName: givenName.trim().length > 0 ? givenName : 'Google',
      lastName: familyName.trim().length > 0 ? familyName : 'User',
    };
  }
}
