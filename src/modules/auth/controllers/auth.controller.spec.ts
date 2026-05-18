import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ZodError } from 'zod';

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { LoginSchema } from '@/modules/auth/dtos/login.dto';
import { LogoutSchema } from '@/modules/auth/dtos/logout.dto';
import { RefreshSchema } from '@/modules/auth/dtos/refresh.dto';
import { RegisterSchema } from '@/modules/auth/dtos/register.dto';

import { AuthController } from './auth.controller';
import { LoginService } from '../services/login.service';
import { LogoutService } from '../services/logout.service';
import { RefreshService } from '../services/refresh.service';
import { EmailAlreadyExistsError, RegisterService } from '../services/register.service';

const mockRegister = jest.fn();
const mockLogin = jest.fn();
const mockRefresh = jest.fn();
const mockLogout = jest.fn();

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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: RegisterService, useValue: { register: mockRegister } },
        { provide: LoginService, useValue: { login: mockLogin } },
        { provide: RefreshService, useValue: { refresh: mockRefresh } },
        { provide: LogoutService, useValue: { logout: mockLogout } },
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
