import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import { AppConfigService } from '@/config/config.service';
import { AUDIT_RECORDED_EVENT } from '@/modules/audit/events/audit-recorded.event';
import { EmailDeliveryError, EmailService } from '@/modules/email/email.service';

import { ForgotPasswordService } from './forgot-password.service';
import type { User } from '../domain/user.types';
import { UserRepository } from '../repositories/user.repository';
import { VerificationTokenRepository } from '../repositories/verification-token.repository';

const mockFindByEmail = jest.fn();
const mockFindLatestUnused = jest.fn();
const mockInvalidateActive = jest.fn();
const mockCreate = jest.fn();
const mockSend = jest.fn();
const mockEmit = jest.fn();

const activeUser: User = {
  id: 'user-uuid-1',
  email: 'user@example.com',
  passwordHash: '$argon2id$hashed',
  firstName: 'John',
  lastName: 'Doe',
  phone: null,
  authProvider: 'email',
  status: 'active',
  emailVerified: true,
  createdAt: new Date(),
};

describe('ForgotPasswordService', () => {
  let service: ForgotPasswordService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFindByEmail.mockResolvedValue(activeUser);
    mockFindLatestUnused.mockResolvedValue(null);
    mockInvalidateActive.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue({});
    mockSend.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ForgotPasswordService,
        { provide: UserRepository, useValue: { findByEmail: mockFindByEmail } },
        {
          provide: VerificationTokenRepository,
          useValue: {
            findLatestUnused: mockFindLatestUnused,
            invalidateActive: mockInvalidateActive,
            create: mockCreate,
          },
        },
        { provide: EmailService, useValue: { sendPasswordResetCode: mockSend } },
        { provide: AppConfigService, useValue: { get: jest.fn().mockReturnValue(15) } },
        { provide: EventEmitter2, useValue: { emit: mockEmit } },
      ],
    }).compile();

    service = module.get<ForgotPasswordService>(ForgotPasswordService);
  });

  describe('silent no-ops (anti-enumeration)', () => {
    it('returns silently when no user is registered with that email', async () => {
      mockFindByEmail.mockResolvedValue(null);

      await service.request({ email: 'ghost@example.com' });

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('returns silently when the user is suspended (no enum leak via timing)', async () => {
      mockFindByEmail.mockResolvedValue({ ...activeUser, status: 'suspended' });

      await service.request({ email: 'user@example.com' });

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns silently when the user is inactive', async () => {
      mockFindByEmail.mockResolvedValue({ ...activeUser, status: 'inactive' });

      await service.request({ email: 'user@example.com' });

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns silently when latest reset token is younger than 60 seconds', async () => {
      mockFindLatestUnused.mockResolvedValue({
        id: 'tok-1',
        userId: 'user-uuid-1',
        type: 'reset_password' as const,
        token: '111111',
        expiresAt: new Date(Date.now() + 60_000),
        used: false,
        createdAt: new Date(Date.now() - 30_000),
      });

      await service.request({ email: 'user@example.com' });

      expect(mockInvalidateActive).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('successful request', () => {
    it('also accepts pending_verification users (forgot-password during signup flow)', async () => {
      mockFindByEmail.mockResolvedValue({
        ...activeUser,
        status: 'pending_verification',
        emailVerified: false,
      });

      await service.request({ email: 'user@example.com' });

      expect(mockCreate).toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalled();
    });

    it('invalidates active reset tokens before creating a new one', async () => {
      await service.request({ email: 'user@example.com' });

      expect(mockInvalidateActive).toHaveBeenCalledWith('user-uuid-1', 'reset_password');
    });

    it('creates a 6-digit token with type=reset_password', async () => {
      await service.request({ email: 'user@example.com' });

      const calls = mockCreate.mock.calls as Record<string, unknown>[][];
      const input = calls[0]?.[0] as { userId: string; type: string; token: string };
      expect(input.userId).toBe('user-uuid-1');
      expect(input.type).toBe('reset_password');
      expect(input.token).toMatch(/^\d{6}$/);
    });

    it('sends the password-reset email with the generated code and firstName', async () => {
      await service.request({ email: 'user@example.com' });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@example.com', firstName: 'John' }),
      );
    });

    it('emits auth.password.reset.requested with actor=user.id', async () => {
      await service.request({ email: 'user@example.com' }, { requestId: 'req-1', ip: '1.2.3.4' });

      expect(mockEmit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining({
          action: 'auth.password.reset.requested',
          actor: 'user-uuid-1',
        }),
      );
    });

    it('swallows EmailDeliveryError so caller still receives 200', async () => {
      mockSend.mockRejectedValue(
        new EmailDeliveryError('user@example.com', { msg: 'transport down' }),
      );

      await expect(service.request({ email: 'user@example.com' })).resolves.toBeUndefined();
    });
  });
});
