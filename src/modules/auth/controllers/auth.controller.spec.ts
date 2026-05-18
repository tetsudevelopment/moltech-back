import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ZodError } from 'zod';

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { ForgotPasswordSchema } from '@/modules/auth/dtos/forgot-password.dto';
import { LoginSchema } from '@/modules/auth/dtos/login.dto';
import { LogoutSchema } from '@/modules/auth/dtos/logout.dto';
import { RefreshSchema } from '@/modules/auth/dtos/refresh.dto';
import { RegisterSchema } from '@/modules/auth/dtos/register.dto';
import { ResendVerificationSchema } from '@/modules/auth/dtos/resend-verification.dto';
import { ResetPasswordSchema } from '@/modules/auth/dtos/reset-password.dto';
import { SocialLoginSchema } from '@/modules/auth/dtos/social-login.dto';
import { VerifyEmailSchema } from '@/modules/auth/dtos/verify-email.dto';

import { AuthController } from './auth.controller';
import { ForgotPasswordService } from '../services/forgot-password.service';
import { LoginService } from '../services/login.service';
import { LogoutService } from '../services/logout.service';
import { RefreshService } from '../services/refresh.service';
import { EmailAlreadyExistsError, RegisterService } from '../services/register.service';
import { ResendVerificationService } from '../services/resend-verification.service';
import { ResetPasswordService } from '../services/reset-password.service';
import { SocialLoginService } from '../services/social-login.service';
import { VerifyEmailService } from '../services/verify-email.service';

const mockRegister = jest.fn();
const mockLogin = jest.fn();
const mockRefresh = jest.fn();
const mockLogout = jest.fn();
const mockVerifyEmail = jest.fn();
const mockResendVerification = jest.fn();
const mockForgotPassword = jest.fn();
const mockResetPassword = jest.fn();
const mockSocialLogin = jest.fn();

const validBody = {
  email: 'user@example.com',
  password: 'ValidPass1',
  first_name: 'John',
  last_name: 'Doe',
  accepted_policy: true,
};

const validLoginBody = {
  email: 'user@example.com',
  password: 'ValidPass1!',
};

const fakeRequest = { id: 'req-abc', ip: '127.0.0.1' } as never;

const fakePublicUser = {
  id: 'user-uuid-001',
  email: 'user@example.com',
  firstName: 'John',
  lastName: 'Doe',
  phone: null,
  authProvider: 'email' as const,
  status: 'active' as const,
  emailVerified: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const fakeRegisteredUser = {
  id: 'new-user-uuid',
  email: 'user@example.com',
  firstName: 'John',
  lastName: 'Doe',
  phone: null,
  authProvider: 'email' as const,
  status: 'pending_verification' as const,
  emailVerified: false,
  createdAt: new Date('2026-05-18T00:00:00Z'),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRegister.mockResolvedValue({
      user: fakeRegisteredUser,
      verificationRequired: true,
    });
    mockLogin.mockResolvedValue({
      accessToken: 'access-token-value',
      refreshToken: 'refresh-token-value',
      user: fakePublicUser,
    });
    mockRefresh.mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });
    mockLogout.mockResolvedValue(undefined);
    mockVerifyEmail.mockResolvedValue({
      accessToken: 'verify-access-token',
      refreshToken: 'verify-refresh-token',
      user: { ...fakePublicUser, emailVerified: true, status: 'active' as const },
    });
    mockResendVerification.mockResolvedValue(undefined);
    mockForgotPassword.mockResolvedValue(undefined);
    mockResetPassword.mockResolvedValue(undefined);
    mockSocialLogin.mockResolvedValue({
      accessToken: 'social-access',
      refreshToken: 'social-refresh',
      user: {
        ...fakePublicUser,
        authProvider: 'google' as const,
        authProviderId: 'google-sub-001',
      },
      isNewUser: false,
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: RegisterService, useValue: { register: mockRegister } },
        { provide: LoginService, useValue: { login: mockLogin } },
        { provide: RefreshService, useValue: { refresh: mockRefresh } },
        { provide: LogoutService, useValue: { logout: mockLogout } },
        { provide: VerifyEmailService, useValue: { verify: mockVerifyEmail } },
        {
          provide: ResendVerificationService,
          useValue: { resend: mockResendVerification },
        },
        {
          provide: ForgotPasswordService,
          useValue: { request: mockForgotPassword },
        },
        {
          provide: ResetPasswordService,
          useValue: { reset: mockResetPassword },
        },
        {
          provide: SocialLoginService,
          useValue: { login: mockSocialLogin },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('POST /auth/register', () => {
    it('calls RegisterService.register with parsed DTO and request context', async () => {
      const dto = RegisterSchema.parse(validBody);

      await controller.register(dto, fakeRequest);

      expect(mockRegister).toHaveBeenCalledWith(dto, { requestId: 'req-abc', ip: '127.0.0.1' });
    });

    it('returns 201 with { user, verification_required: true } using snake_case fields', async () => {
      const dto = RegisterSchema.parse(validBody);

      const result = await controller.register(dto, fakeRequest);

      expect(result).toEqual({
        user: {
          id: 'new-user-uuid',
          email: 'user@example.com',
          first_name: 'John',
          last_name: 'Doe',
          phone: null,
          email_verified: false,
          auth_provider: 'email',
          status: 'pending_verification',
          created_at: '2026-05-18T00:00:00.000Z',
        },
        verification_required: true,
      });
    });

    it('throws ConflictException when EmailAlreadyExistsError is raised', async () => {
      mockRegister.mockRejectedValue(new EmailAlreadyExistsError('user@example.com'));
      const dto = RegisterSchema.parse(validBody);

      await expect(controller.register(dto, fakeRequest)).rejects.toThrow(ConflictException);
    });

    it('DTO validation fails → ZodValidationPipe throws ZodError', () => {
      const pipe = new ZodValidationPipe(RegisterSchema);

      expect(() =>
        pipe.transform({ email: 'not-an-email', password: 'short', first_name: '', last_name: '' }),
      ).toThrow(ZodError);
    });

    it('rethrows unexpected errors that are not EmailAlreadyExistsError', async () => {
      const unexpectedError = new Error('Unexpected DB failure');
      mockRegister.mockRejectedValue(unexpectedError);
      const dto = RegisterSchema.parse(validBody);

      await expect(controller.register(dto, fakeRequest)).rejects.toThrow('Unexpected DB failure');
    });
  });

  describe('POST /auth/login', () => {
    it('calls LoginService.login with parsed DTO and request context', async () => {
      const dto = LoginSchema.parse(validLoginBody);

      await controller.login(dto, fakeRequest);

      expect(mockLogin).toHaveBeenCalledWith(dto, { requestId: 'req-abc', ip: '127.0.0.1' });
    });

    it('returns 200 with snake_case envelope containing access_token, refresh_token, expires_in, and user', async () => {
      const dto = LoginSchema.parse(validLoginBody);

      const result = await controller.login(dto, fakeRequest);

      expect(result).toMatchObject({
        access_token: 'access-token-value',
        refresh_token: 'refresh-token-value',
        expires_in: 900,
        user: {
          id: fakePublicUser.id,
          email: fakePublicUser.email,
          first_name: fakePublicUser.firstName,
          last_name: fakePublicUser.lastName,
          status: fakePublicUser.status,
        },
      });
    });

    it('propagates UnauthorizedException from LoginService (filter handles envelope)', async () => {
      mockLogin.mockRejectedValue(new UnauthorizedException('Credenciales inválidas'));
      const dto = LoginSchema.parse(validLoginBody);

      await expect(controller.login(dto, fakeRequest)).rejects.toThrow(UnauthorizedException);
    });

    it('login DTO validation fails → ZodValidationPipe throws ZodError', () => {
      const pipe = new ZodValidationPipe(LoginSchema);

      expect(() => pipe.transform({ email: 'not-an-email', password: '' })).toThrow(ZodError);
    });
  });

  describe('POST /auth/refresh', () => {
    it('calls RefreshService.refresh with parsed DTO and request context', async () => {
      const dto = RefreshSchema.parse({ refresh_token: 'some-refresh-token' });

      await controller.refresh(dto, fakeRequest);

      expect(mockRefresh).toHaveBeenCalledWith('some-refresh-token', {
        requestId: 'req-abc',
        ip: '127.0.0.1',
      });
    });

    it('returns 200 with access_token, refresh_token, and expires_in', async () => {
      const dto = RefreshSchema.parse({ refresh_token: 'some-refresh-token' });

      const result = await controller.refresh(dto, fakeRequest);

      expect(result).toMatchObject({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 900,
      });
    });

    it('propagates UnauthorizedException from RefreshService (filter envelopes it as 401)', async () => {
      mockRefresh.mockRejectedValue(new UnauthorizedException('Refresh token reuse detected'));
      const dto = RefreshSchema.parse({ refresh_token: 'reused-token' });

      await expect(controller.refresh(dto, fakeRequest)).rejects.toThrow(UnauthorizedException);
    });

    it('refresh DTO validation fails → ZodValidationPipe throws ZodError', () => {
      const pipe = new ZodValidationPipe(RefreshSchema);

      expect(() => pipe.transform({ refresh_token: '' })).toThrow(ZodError);
    });
  });

  describe('POST /auth/verify-email', () => {
    const validVerifyBody = { email: 'user@example.com', code: '123456' };

    it('calls VerifyEmailService.verify with parsed DTO and request context', async () => {
      const dto = VerifyEmailSchema.parse(validVerifyBody);

      await controller.verifyEmail(dto, fakeRequest);

      expect(mockVerifyEmail).toHaveBeenCalledWith(dto, {
        requestId: 'req-abc',
        ip: '127.0.0.1',
      });
    });

    it('returns 200 with access_token, refresh_token, expires_in, and snake_case user', async () => {
      const dto = VerifyEmailSchema.parse(validVerifyBody);

      const result = await controller.verifyEmail(dto, fakeRequest);

      expect(result).toMatchObject({
        access_token: 'verify-access-token',
        refresh_token: 'verify-refresh-token',
        expires_in: 900,
        user: {
          id: fakePublicUser.id,
          email: fakePublicUser.email,
          first_name: fakePublicUser.firstName,
          last_name: fakePublicUser.lastName,
          status: 'active',
          email_verified: true,
        },
      });
    });

    it('propagates BadRequestException from VerifyEmailService (TOKEN_INVALID)', async () => {
      mockVerifyEmail.mockRejectedValue(
        new BadRequestException({ code: 'TOKEN_INVALID', message: 'Invalid code' }),
      );
      const dto = VerifyEmailSchema.parse(validVerifyBody);

      await expect(controller.verifyEmail(dto, fakeRequest)).rejects.toThrow(BadRequestException);
    });

    it('verify-email DTO validation rejects non-6-digit codes', () => {
      const pipe = new ZodValidationPipe(VerifyEmailSchema);

      expect(() => pipe.transform({ email: 'user@example.com', code: 'abc' })).toThrow(ZodError);
      expect(() => pipe.transform({ email: 'user@example.com', code: '12345' })).toThrow(ZodError);
      expect(() => pipe.transform({ email: 'user@example.com', code: '1234567' })).toThrow(
        ZodError,
      );
    });

    it('verify-email DTO validation rejects invalid email', () => {
      const pipe = new ZodValidationPipe(VerifyEmailSchema);

      expect(() => pipe.transform({ email: 'not-email', code: '123456' })).toThrow(ZodError);
    });
  });

  describe('POST /auth/resend-verification', () => {
    it('calls ResendVerificationService.resend with parsed DTO', async () => {
      const dto = ResendVerificationSchema.parse({ email: 'user@example.com' });

      await controller.resendVerification(dto);

      expect(mockResendVerification).toHaveBeenCalledWith(dto);
    });

    it('returns null so the transform interceptor envelopes it as { data: null, ... }', async () => {
      const dto = ResendVerificationSchema.parse({ email: 'user@example.com' });

      const result = await controller.resendVerification(dto);

      expect(result).toBeNull();
    });

    it('resend DTO validation rejects invalid emails', () => {
      const pipe = new ZodValidationPipe(ResendVerificationSchema);

      expect(() => pipe.transform({ email: 'not-an-email' })).toThrow(ZodError);
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('calls ForgotPasswordService.request with parsed DTO and context', async () => {
      const dto = ForgotPasswordSchema.parse({ email: 'user@example.com' });

      await controller.forgotPassword(dto, fakeRequest);

      expect(mockForgotPassword).toHaveBeenCalledWith(dto, {
        requestId: 'req-abc',
        ip: '127.0.0.1',
      });
    });

    it('returns null so the response envelope is { data: null, ... } for every email', async () => {
      const dto = ForgotPasswordSchema.parse({ email: 'user@example.com' });

      const result = await controller.forgotPassword(dto, fakeRequest);

      expect(result).toBeNull();
    });

    it('forgot-password DTO validation rejects invalid emails', () => {
      const pipe = new ZodValidationPipe(ForgotPasswordSchema);

      expect(() => pipe.transform({ email: 'not-email' })).toThrow(ZodError);
    });
  });

  describe('POST /auth/reset-password', () => {
    const validResetBody = {
      email: 'user@example.com',
      token: '987654',
      new_password: 'NewSecure1',
    };

    it('calls ResetPasswordService.reset with parsed DTO and context', async () => {
      const dto = ResetPasswordSchema.parse(validResetBody);

      await controller.resetPassword(dto, fakeRequest);

      expect(mockResetPassword).toHaveBeenCalledWith(dto, {
        requestId: 'req-abc',
        ip: '127.0.0.1',
      });
    });

    it('returns null so the envelope is { data: null, ... }', async () => {
      const dto = ResetPasswordSchema.parse(validResetBody);

      const result = await controller.resetPassword(dto, fakeRequest);

      expect(result).toBeNull();
    });

    it('reset DTO rejects non-6-digit tokens', () => {
      const pipe = new ZodValidationPipe(ResetPasswordSchema);

      expect(() =>
        pipe.transform({ email: 'user@example.com', token: 'abc', new_password: 'NewSecure1' }),
      ).toThrow(ZodError);
    });

    it('reset DTO rejects weak passwords (no uppercase / number)', () => {
      const pipe = new ZodValidationPipe(ResetPasswordSchema);

      expect(() =>
        pipe.transform({
          email: 'user@example.com',
          token: '987654',
          new_password: 'allowercase',
        }),
      ).toThrow(ZodError);
    });
  });

  describe('POST /auth/social-login', () => {
    const validSocialBody = { provider: 'google', id_token: 'google-id-token-value' };

    it('calls SocialLoginService.login with parsed DTO and context', async () => {
      const dto = SocialLoginSchema.parse(validSocialBody);

      await controller.socialLogin(dto, fakeRequest);

      expect(mockSocialLogin).toHaveBeenCalledWith(dto, {
        requestId: 'req-abc',
        ip: '127.0.0.1',
      });
    });

    it('returns 200 with access_token, refresh_token, is_new_user and snake_case user', async () => {
      const dto = SocialLoginSchema.parse(validSocialBody);

      const result = await controller.socialLogin(dto, fakeRequest);

      expect(result).toMatchObject({
        access_token: 'social-access',
        refresh_token: 'social-refresh',
        expires_in: 900,
        is_new_user: false,
        user: {
          id: fakePublicUser.id,
          email: fakePublicUser.email,
          first_name: fakePublicUser.firstName,
          last_name: fakePublicUser.lastName,
          auth_provider: 'google',
          email_verified: true,
          status: 'active',
        },
      });
    });

    it('passes is_new_user=true through when SocialLoginService reports a new signup', async () => {
      mockSocialLogin.mockResolvedValue({
        accessToken: 'a',
        refreshToken: 'b',
        user: { ...fakePublicUser, authProvider: 'google' as const, authProviderId: 'sub' },
        isNewUser: true,
      });
      const dto = SocialLoginSchema.parse(validSocialBody);

      const result = await controller.socialLogin(dto, fakeRequest);

      expect(result.is_new_user).toBe(true);
    });

    it('rejects unsupported provider values via DTO validation', () => {
      const pipe = new ZodValidationPipe(SocialLoginSchema);

      expect(() => pipe.transform({ provider: 'apple', id_token: 'x' })).toThrow(ZodError);
    });

    it('rejects empty id_token via DTO validation', () => {
      const pipe = new ZodValidationPipe(SocialLoginSchema);

      expect(() => pipe.transform({ provider: 'google', id_token: '' })).toThrow(ZodError);
    });
  });

  describe('POST /auth/logout', () => {
    it('calls LogoutService.logout with parsed DTO and request context', async () => {
      const dto = LogoutSchema.parse({ refresh_token: 'some-refresh-token' });

      await controller.logout(dto, fakeRequest);

      expect(mockLogout).toHaveBeenCalledWith('some-refresh-token', {
        requestId: 'req-abc',
        ip: '127.0.0.1',
      });
    });

    it('returns void (204 No Content)', async () => {
      const dto = LogoutSchema.parse({ refresh_token: 'some-refresh-token' });

      await controller.logout(dto, fakeRequest);

      expect(mockLogout).toHaveBeenCalledTimes(1);
    });

    it('does NOT throw even if LogoutService.logout would fail (service is permissive)', async () => {
      // LogoutService handles its own errors internally; controller trusts it
      mockLogout.mockResolvedValue(undefined);
      const dto = LogoutSchema.parse({ refresh_token: 'bad-token' });

      await expect(controller.logout(dto, fakeRequest)).resolves.toBeUndefined();
    });

    it('logout DTO validation fails → ZodValidationPipe throws ZodError', () => {
      const pipe = new ZodValidationPipe(LogoutSchema);

      expect(() => pipe.transform({ refresh_token: '' })).toThrow(ZodError);
    });
  });
});
