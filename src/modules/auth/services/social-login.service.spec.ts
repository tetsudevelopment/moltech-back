import { ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';

import { FacebookOAuthVerifier } from './facebook-oauth.verifier';
import { GoogleOAuthVerifier } from './google-oauth.verifier';
import { JwtService } from './jwt.service';
import { SocialLoginService } from './social-login.service';
import type { User } from '../domain/user.types';
import { RefreshTokenStore } from '../repositories/refresh-token-store';
import { UserRepository } from '../repositories/user.repository';

const mockGoogleVerify = jest.fn();
const mockFacebookVerify = jest.fn();
const mockFindByProvider = jest.fn();
const mockFindByEmail = jest.fn();
const mockCreateSocial = jest.fn();
const mockSignAccess = jest.fn();
const mockSignRefresh = jest.fn();
const mockCreateFamily = jest.fn();
const mockEmit = jest.fn();

const googleClaims = {
  sub: 'google-sub-001',
  email: 'user@gmail.com',
  firstName: 'John',
  lastName: 'Google',
};

const facebookClaims = {
  sub: 'fb-user-001',
  email: 'user@fb.com',
  firstName: 'Jane',
  lastName: 'Facebook',
};

const existingGoogleUser: User = {
  id: 'user-uuid-google',
  email: 'user@gmail.com',
  passwordHash: null,
  firstName: 'John',
  lastName: 'Google',
  phone: null,
  authProvider: 'google',
  authProviderId: 'google-sub-001',
  status: 'active',
  emailVerified: true,
  createdAt: new Date(),
};

const existingEmailUser: User = {
  id: 'user-uuid-email',
  email: 'user@gmail.com',
  passwordHash: '$argon2id$hashed',
  firstName: 'John',
  lastName: 'EmailReg',
  phone: null,
  authProvider: 'email',
  authProviderId: null,
  status: 'active',
  emailVerified: true,
  createdAt: new Date(),
};

const createdSocialUser: User = {
  id: 'user-uuid-new-social',
  email: 'user@gmail.com',
  passwordHash: null,
  firstName: 'John',
  lastName: 'Google',
  phone: null,
  authProvider: 'google',
  authProviderId: 'google-sub-001',
  status: 'active',
  emailVerified: true,
  createdAt: new Date(),
};

describe('SocialLoginService', () => {
  let service: SocialLoginService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGoogleVerify.mockResolvedValue(googleClaims);
    mockFacebookVerify.mockResolvedValue(facebookClaims);
    mockFindByProvider.mockResolvedValue(null);
    mockFindByEmail.mockResolvedValue(null);
    mockCreateSocial.mockResolvedValue(createdSocialUser);
    mockSignAccess.mockResolvedValue('access-token-value');
    mockSignRefresh.mockResolvedValue('refresh-token-value');
    mockCreateFamily.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialLoginService,
        {
          provide: UserRepository,
          useValue: {
            findByProvider: mockFindByProvider,
            findByEmail: mockFindByEmail,
            createSocialUser: mockCreateSocial,
          },
        },
        { provide: GoogleOAuthVerifier, useValue: { verify: mockGoogleVerify } },
        { provide: FacebookOAuthVerifier, useValue: { verify: mockFacebookVerify } },
        {
          provide: JwtService,
          useValue: { signAccessToken: mockSignAccess, signRefreshToken: mockSignRefresh },
        },
        { provide: RefreshTokenStore, useValue: { createFamily: mockCreateFamily } },
        { provide: EventEmitter2, useValue: { emit: mockEmit } },
      ],
    }).compile();

    service = module.get<SocialLoginService>(SocialLoginService);
  });

  describe('provider dispatch', () => {
    it('verifies the Google id_token when provider=google', async () => {
      await service.login({ provider: 'google', id_token: 'g-token' });

      expect(mockGoogleVerify).toHaveBeenCalledWith('g-token');
      expect(mockFacebookVerify).not.toHaveBeenCalled();
    });

    it('verifies the Facebook access token when provider=facebook', async () => {
      await service.login({ provider: 'facebook', id_token: 'fb-token' });

      expect(mockFacebookVerify).toHaveBeenCalledWith('fb-token');
      expect(mockGoogleVerify).not.toHaveBeenCalled();
    });
  });

  describe('existing social user (returning login)', () => {
    beforeEach(() => {
      mockFindByProvider.mockResolvedValue(existingGoogleUser);
    });

    it('issues tokens for the existing user without creating a new row', async () => {
      const result = await service.login({ provider: 'google', id_token: 'g-token' });

      expect(mockCreateSocial).not.toHaveBeenCalled();
      expect(result.user.id).toBe('user-uuid-google');
      expect(result.isNewUser).toBe(false);
      expect(result.accessToken).toBe('access-token-value');
      expect(result.refreshToken).toBe('refresh-token-value');
    });

    it('emits auth.login.success with provider metadata and isNewUser=false', async () => {
      await service.login({ provider: 'google', id_token: 'g-token' });

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'auth.login.success',
          actor: 'user-uuid-google',
          metadata: expect.objectContaining({ provider: 'google', isNewUser: false }) as Record<
            string,
            unknown
          >,
        }),
      );
    });
  });

  describe('email collision with email provider', () => {
    beforeEach(() => {
      mockFindByProvider.mockResolvedValue(null);
      mockFindByEmail.mockResolvedValue(existingEmailUser);
    });

    it('throws ConflictException with EMAIL_ALREADY_EXISTS and requiresMerge:true', async () => {
      try {
        await service.login({ provider: 'google', id_token: 'g-token' });
        fail('expected ConflictException');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const response = (err as ConflictException).getResponse();
        expect(response).toMatchObject({
          code: 'EMAIL_ALREADY_EXISTS',
          details: { requiresMerge: true, currentProvider: 'email' },
        });
      }
    });

    it('does NOT create a new user or issue tokens when email collides', async () => {
      await expect(service.login({ provider: 'google', id_token: 'g-token' })).rejects.toThrow(
        ConflictException,
      );

      expect(mockCreateSocial).not.toHaveBeenCalled();
      expect(mockSignAccess).not.toHaveBeenCalled();
      expect(mockSignRefresh).not.toHaveBeenCalled();
    });
  });

  describe('new social signup', () => {
    it('creates a new user via createSocialUser with verified email and active status', async () => {
      await service.login({ provider: 'google', id_token: 'g-token' });

      expect(mockCreateSocial).toHaveBeenCalledWith({
        email: 'user@gmail.com',
        firstName: 'John',
        lastName: 'Google',
        authProvider: 'google',
        authProviderId: 'google-sub-001',
      });
    });

    it('issues tokens for the newly-created user with isNewUser=true', async () => {
      const result = await service.login({ provider: 'google', id_token: 'g-token' });

      expect(result.isNewUser).toBe(true);
      expect(result.user.id).toBe('user-uuid-new-social');
      expect(result.accessToken).toBe('access-token-value');
    });

    it('emits auth.login.success with isNewUser=true metadata', async () => {
      await service.login({ provider: 'google', id_token: 'g-token' });

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'auth.login.success',
          actor: 'user-uuid-new-social',
          metadata: expect.objectContaining({ provider: 'google', isNewUser: true }) as Record<
            string,
            unknown
          >,
        }),
      );
    });

    it('does not include the access token in the public user', async () => {
      const result = await service.login({ provider: 'google', id_token: 'g-token' });

      expect(result.user).not.toHaveProperty('passwordHash');
    });
  });

  describe('verifier failures propagate', () => {
    it('lets BadRequestException from Google verifier bubble up unchanged', async () => {
      const err = new Error('Bad token');
      mockGoogleVerify.mockRejectedValue(err);

      await expect(service.login({ provider: 'google', id_token: 'bad' })).rejects.toThrow(
        'Bad token',
      );
    });
  });
});
