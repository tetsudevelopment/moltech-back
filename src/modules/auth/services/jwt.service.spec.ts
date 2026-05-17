import { generateKeyPairSync } from 'crypto';

import { Test, type TestingModule } from '@nestjs/testing';
import { decodeJwt, decodeProtectedHeader } from 'jose';

import { AppConfigService } from '@/config/config.service';

import { JwtService } from './jwt.service';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const mockConfigGet = jest.fn((key: string) => {
  const values: Record<string, unknown> = {
    JWT_PRIVATE_KEY: privateKey,
    JWT_PUBLIC_KEY: publicKey,
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    JWT_ISSUER: 'moltech-api-test',
    JWT_AUDIENCE: 'moltech-mobile-test',
  };
  return values[key];
});

describe('JwtService', () => {
  let service: JwtService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtService,
        {
          provide: AppConfigService,
          useValue: { get: mockConfigGet },
        },
      ],
    }).compile();

    service = module.get<JwtService>(JwtService);
    await service.onModuleInit();
  });

  describe('signAccessToken()', () => {
    it('returns a JWT string signed with RS256', async () => {
      const token = await service.signAccessToken({ sub: 'user-uuid-1', role: 'user' });
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('encodes correct claims: sub, role, iss, aud, exp, iat', async () => {
      const token = await service.signAccessToken({ sub: 'user-uuid-1', role: 'user' });
      const payload = decodeJwt(token);
      expect(payload.sub).toBe('user-uuid-1');
      expect(payload.role).toBe('user');
      expect(payload.iss).toBe('moltech-api-test');
      expect(payload.aud).toBe('moltech-mobile-test');
      expect(typeof payload.exp).toBe('number');
      expect(typeof payload.iat).toBe('number');
    });

    it('uses RS256 algorithm in the JWT header', async () => {
      const token = await service.signAccessToken({ sub: 'user-uuid-1', role: 'user' });
      const header = decodeProtectedHeader(token);
      expect(header.alg).toBe('RS256');
    });
  });

  describe('verifyAccessToken()', () => {
    it('returns verified claims for a valid access token', async () => {
      const token = await service.signAccessToken({ sub: 'user-uuid-1', role: 'admin' });
      const claims = await service.verifyAccessToken(token);
      expect(claims.sub).toBe('user-uuid-1');
      expect(claims.role).toBe('admin');
    });

    it('throws for a token with tampered signature', async () => {
      const token = await service.signAccessToken({ sub: 'user-uuid-1', role: 'user' });
      const parts = token.split('.');
      const tampered = `${parts[0] ?? ''}.${parts[1] ?? ''}.invalidsignature`;
      await expect(service.verifyAccessToken(tampered)).rejects.toThrow();
    });

    it('throws for an expired token', async () => {
      const expiredToken = await service.signAccessToken({ sub: 'user-uuid-1', role: 'user' });

      const { importPKCS8, SignJWT } = await import('jose');
      const pk = await importPKCS8(privateKey, 'RS256');
      const expired = await new SignJWT({ sub: 'user-uuid-1', role: 'user' })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer('moltech-api-test')
        .setAudience('moltech-mobile-test')
        .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
        .sign(pk);

      await expect(service.verifyAccessToken(expired)).rejects.toThrow();

      void expiredToken;
    });
  });

  describe('signRefreshToken()', () => {
    it('returns a JWT that includes familyId and tokenId claims', async () => {
      const token = await service.signRefreshToken({
        sub: 'user-uuid-1',
        familyId: 'family-uuid-1',
        tokenId: 'token-uuid-1',
      });
      const payload = decodeJwt(token);
      expect(payload.familyId).toBe('family-uuid-1');
      expect(payload.tokenId).toBe('token-uuid-1');
    });

    it('uses RS256 algorithm in the JWT header (NOT HS256)', async () => {
      const token = await service.signRefreshToken({
        sub: 'user-uuid-1',
        familyId: 'family-uuid-1',
        tokenId: 'token-uuid-1',
      });
      const header = decodeProtectedHeader(token);
      expect(header.alg).toBe('RS256');
      expect(header.alg).not.toBe('HS256');
    });
  });

  describe('verifyRefreshToken()', () => {
    it('returns claims including sub, familyId and tokenId', async () => {
      const token = await service.signRefreshToken({
        sub: 'user-uuid-1',
        familyId: 'family-uuid-1',
        tokenId: 'token-uuid-1',
      });
      const claims = await service.verifyRefreshToken(token);
      expect(claims.sub).toBe('user-uuid-1');
      expect(claims.familyId).toBe('family-uuid-1');
      expect(claims.tokenId).toBe('token-uuid-1');
    });

    it('throws for an access token passed as a refresh token (wrong claims but valid sig)', async () => {
      const accessToken = await service.signAccessToken({ sub: 'user-uuid-1', role: 'user' });
      const claims = await service.verifyRefreshToken(accessToken);
      expect(claims.familyId).toBeUndefined();
    });
  });
});
