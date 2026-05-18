import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import { AppConfigService } from '@/config/config.service';
import { AUDIT_RECORDED_EVENT } from '@/modules/audit/events/audit-recorded.event';
import { EmailDeliveryError, EmailService } from '@/modules/email/email.service';

import { PasswordService } from './password.service';
import { RegisterService } from './register.service';
import type { User } from '../domain/user.types';
import { type RegisterDto } from '../dtos/register.dto';
import { EmailAlreadyExistsError, UserRepository } from '../repositories/user.repository';
import { VerificationTokenRepository } from '../repositories/verification-token.repository';

const mockHash = jest.fn();
const mockCreateWithEmail = jest.fn();
const mockTokenCreate = jest.fn();
const mockSendVerificationCode = jest.fn();
const mockEmit = jest.fn();

const validDto: RegisterDto = {
  email: 'user@example.com',
  password: 'ValidPass1',
  first_name: 'John',
  last_name: 'Doe',
  phone: undefined,
  accepted_policy: true,
};

const fakeUser: User = {
  id: 'user-uuid-1',
  email: 'user@example.com',
  passwordHash: '$argon2id$hashed',
  firstName: 'John',
  lastName: 'Doe',
  phone: null,
  authProvider: 'email',
  status: 'pending_verification',
  emailVerified: false,
  createdAt: new Date('2026-05-18T00:00:00Z'),
};

const fakeConfig = { EMAIL_VERIFICATION_CODE_TTL_MIN: 15 } as const;
type FakeConfigKey = keyof typeof fakeConfig;

describe('RegisterService', () => {
  let service: RegisterService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockHash.mockResolvedValue('$argon2id$hashed');
    mockCreateWithEmail.mockResolvedValue(fakeUser);
    mockTokenCreate.mockResolvedValue({
      id: 'tok-1',
      userId: 'user-uuid-1',
      type: 'email',
      token: '000000',
      expiresAt: new Date(),
      used: false,
      createdAt: new Date(),
    });
    mockSendVerificationCode.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegisterService,
        { provide: PasswordService, useValue: { hash: mockHash } },
        { provide: UserRepository, useValue: { createWithEmail: mockCreateWithEmail } },
        {
          provide: VerificationTokenRepository,
          useValue: { create: mockTokenCreate },
        },
        {
          provide: EmailService,
          useValue: { sendVerificationCode: mockSendVerificationCode },
        },
        {
          provide: AppConfigService,
          useValue: {
            get: jest.fn((key: FakeConfigKey) => fakeConfig[key]),
          },
        },
        { provide: EventEmitter2, useValue: { emit: mockEmit } },
      ],
    }).compile();

    service = module.get<RegisterService>(RegisterService);
  });

  describe('user creation', () => {
    it('hashes the password with PasswordService before storing', async () => {
      await service.register(validDto);

      expect(mockHash).toHaveBeenCalledWith('ValidPass1');
      expect(mockCreateWithEmail).toHaveBeenCalledWith(
        expect.objectContaining({ passwordHash: '$argon2id$hashed' }) as Record<string, unknown>,
      );
    });

    it('never passes the raw password to createWithEmail', async () => {
      await service.register(validDto);

      const calls = mockCreateWithEmail.mock.calls as Record<string, unknown>[][];
      expect(calls[0]?.[0]).not.toHaveProperty('password');
    });

    it('passes camelCase fields and accepted_policy to repository', async () => {
      await service.register(validDto);

      expect(mockCreateWithEmail).toHaveBeenCalledWith({
        email: 'user@example.com',
        passwordHash: '$argon2id$hashed',
        firstName: 'John',
        lastName: 'Doe',
        phone: null,
        acceptedPolicy: true,
      });
    });

    it('returns { user, verificationRequired: true } with the created user', async () => {
      const result = await service.register(validDto);

      expect(result.verificationRequired).toBe(true);
      expect(result.user.id).toBe('user-uuid-1');
      expect(result.user.email).toBe('user@example.com');
      expect(result.user.status).toBe('pending_verification');
      expect(result.user.emailVerified).toBe(false);
    });

    it('omits passwordHash from the returned user', async () => {
      const result = await service.register(validDto);

      expect(result.user).not.toHaveProperty('passwordHash');
    });
  });

  describe('verification token issuance', () => {
    it('creates a 6-digit verification token for the user with type=email', async () => {
      await service.register(validDto);

      const calls = mockTokenCreate.mock.calls as Record<string, unknown>[][];
      const input = calls[0]?.[0] as { userId: string; type: string; token: string };
      expect(input.userId).toBe('user-uuid-1');
      expect(input.type).toBe('email');
      expect(input.token).toMatch(/^\d{6}$/);
    });

    it('sets expiresAt to now + EMAIL_VERIFICATION_CODE_TTL_MIN minutes', async () => {
      const before = Date.now();
      await service.register(validDto);
      const after = Date.now();

      const tokenInput = (mockTokenCreate.mock.calls[0] as unknown[])[0] as { expiresAt: Date };
      const expiresMs = tokenInput.expiresAt.getTime();
      const ttlMs = 15 * 60 * 1000;
      expect(expiresMs).toBeGreaterThanOrEqual(before + ttlMs);
      expect(expiresMs).toBeLessThanOrEqual(after + ttlMs);
    });
  });

  describe('email dispatch', () => {
    it('sends the verification code to the registered email address', async () => {
      await service.register(validDto);

      const tokenInput = (mockTokenCreate.mock.calls[0] as unknown[])[0] as { token: string };
      expect(mockSendVerificationCode).toHaveBeenCalledWith({
        to: 'user@example.com',
        code: tokenInput.token,
        firstName: 'John',
      });
    });

    it('does NOT propagate EmailDeliveryError — registration must succeed even if email transport fails', async () => {
      mockSendVerificationCode.mockRejectedValue(
        new EmailDeliveryError('user@example.com', { msg: 'transport down' }),
      );

      await expect(service.register(validDto)).resolves.toMatchObject({
        verificationRequired: true,
      });
    });
  });

  describe('audit event', () => {
    it('emits auth.register with user_id as actor and no PII metadata', async () => {
      const context = { requestId: 'req-123', ip: '192.168.1.1' };

      await service.register(validDto, context);

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining({
          action: 'auth.register',
          actor: 'user-uuid-1',
          target: { type: 'user', id: 'user-uuid-1' },
          requestId: 'req-123',
          ip: '192.168.1.1',
        }),
      );

      const calls = mockEmit.mock.calls as [string, Record<string, unknown>][];
      expect(calls[0]?.[1]).not.toHaveProperty('metadata');
    });

    it('still emits audit event when no context is provided', async () => {
      await service.register(validDto);

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining({
          action: 'auth.register',
          actor: 'user-uuid-1',
        }),
      );
    });
  });

  describe('error propagation', () => {
    it('propagates EmailAlreadyExistsError from repository unchanged', async () => {
      mockCreateWithEmail.mockRejectedValue(new EmailAlreadyExistsError('user@example.com'));

      await expect(service.register(validDto)).rejects.toThrow(EmailAlreadyExistsError);
    });

    it('does not send verification email when user creation fails', async () => {
      mockCreateWithEmail.mockRejectedValue(new EmailAlreadyExistsError('user@example.com'));

      await expect(service.register(validDto)).rejects.toThrow(EmailAlreadyExistsError);
      expect(mockSendVerificationCode).not.toHaveBeenCalled();
      expect(mockTokenCreate).not.toHaveBeenCalled();
    });
  });
});
