import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { importPKCS8, importSPKI, jwtVerify, type KeyLike, SignJWT } from 'jose';

import { AppConfigService } from '@/config/config.service';

const ALG = 'RS256' as const;

export interface AccessTokenClaims {
  sub: string;
  role: 'user' | 'admin';
}

export interface RefreshTokenClaims {
  sub: string;
  familyId: string;
  tokenId: string;
}

export interface VerifiedAccessClaims extends AccessTokenClaims {
  iss: string;
  aud: string;
  exp: number;
  iat: number;
}

export interface VerifiedRefreshClaims extends RefreshTokenClaims {
  iss: string;
  aud: string;
  exp: number;
  iat: number;
}

@Injectable()
export class JwtService implements OnModuleInit {
  private readonly logger = new Logger(JwtService.name);
  private privateKey: KeyLike | undefined;
  private publicKey: KeyLike | undefined;

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    this.privateKey = await importPKCS8(this.config.get('JWT_PRIVATE_KEY'), ALG);
    this.publicKey = await importSPKI(this.config.get('JWT_PUBLIC_KEY'), ALG);
    this.logger.log('JWT keys loaded');
  }

  signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return this.sign(
      claims as unknown as Record<string, unknown>,
      this.config.get('JWT_ACCESS_TTL'),
    );
  }

  signRefreshToken(claims: RefreshTokenClaims): Promise<string> {
    return this.sign(
      claims as unknown as Record<string, unknown>,
      this.config.get('JWT_REFRESH_TTL'),
    );
  }

  async verifyAccessToken(token: string): Promise<VerifiedAccessClaims> {
    const { payload } = await jwtVerify(token, this.requirePublicKey(), {
      algorithms: [ALG],
      issuer: this.config.get('JWT_ISSUER'),
      audience: this.config.get('JWT_AUDIENCE'),
    });
    return payload as unknown as VerifiedAccessClaims;
  }

  async verifyRefreshToken(token: string): Promise<VerifiedRefreshClaims> {
    const { payload } = await jwtVerify(token, this.requirePublicKey(), {
      algorithms: [ALG],
      issuer: this.config.get('JWT_ISSUER'),
      audience: this.config.get('JWT_AUDIENCE'),
    });
    return payload as unknown as VerifiedRefreshClaims;
  }

  private async sign(claims: Record<string, unknown>, ttl: string): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: ALG })
      .setIssuer(this.config.get('JWT_ISSUER'))
      .setAudience(this.config.get('JWT_AUDIENCE'))
      .setIssuedAt()
      .setExpirationTime(ttl)
      .sign(this.requirePrivateKey());
  }

  private requirePrivateKey(): KeyLike {
    if (!this.privateKey) {
      throw new Error('JWT private key not initialized');
    }
    return this.privateKey;
  }

  private requirePublicKey(): KeyLike {
    if (!this.publicKey) {
      throw new Error('JWT public key not initialized');
    }
    return this.publicKey;
  }
}
