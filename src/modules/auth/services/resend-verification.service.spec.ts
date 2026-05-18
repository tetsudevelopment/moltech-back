import { Test, type TestingModule } from '@nestjs/testing';

import { AppConfigService } from '@/config/config.service';
import { EmailDeliveryError, EmailService } from '@/modules/email/email.service';

import { ResendVerificationService } from './resend-verification.service';
import type { User } from '../domain/user.types';
import { UserRepository } from '../repositories/user.repository';
import { VerificationTokenRepository } from '../repositories/verification-token.repository';

const mockFindByEmail = jest.fn();
const mockFindLatestUnused = jest.fn();
const mockInvalidateActive = jest.fn();
const mockCreate = jest.fn();
const mockSend = jest.fn();

const pendingUser: User = {
  id: 'user-uuid-1',
  email: 'user@example.com',
  passwordHash: '$argon2id$hashed',
  firstName: 'John',
  lastName: 'Doe',
  phone: null,
  authProvider: 'email',
  status: 'pending_verification',
  emailVerified: false,
  createdAt: new Date(),
};

const verifiedUser: User = {
  ...pendingUser,
  status: 'active',
  emailVerified: true,
};

describe('ResendVerificationService', () => {
  let service: ResendVerificationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFindByEmail.mockResolvedValue(pendingUser);
    mockFindLatestUnused.mockResolvedValue(null);
    mockInvalidateActive.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue({
      id: 'tok-1',
      userId: 'user-uuid-1',
      type: 'email',
      token: '000000',
      expiresAt: new Date(),
      used: false,
      createdAt: new Date(),
    });
    mockSend.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResendVerificationService,
        {
          provide: UserRepository,
          useValue: { findByEmail: mockFindByEmail },
        },
        {
          provide: VerificationTokenRepository,
          useValue: {
            findLatestUnused: mockFindLatestUnused,
            invalidateActive: mockInvalidateActive,
            create: mockCreate,
          },
        },
        {
          provide: EmailService,
          useValue: { sendVerificationCode: mockSend },
        },
        {
          provide: AppConfigService,
          useValue: { get: jest.fn().mockReturnValue(15) },
        },
      ],
    }).compile();

    service = module.get<ResendVerificationService>(ResendVerificationService);
  });

  describe('silent no-ops (no enum leak, no rate-limit leak)', () => {
    it('returns silently when no user is registered with that email', async () => {
      mockFindByEmail.mockResolvedValue(null);

      await service.resend({ email: 'ghost@example.com' });

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns silently when the user is already verified', async () => {
      mockFindByEmail.mockResolvedValue(verifiedUser);

      await service.resend({ email: 'user@example.com' });

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns silently when the latest unused token is younger than 60 seconds (per-email rate limit)', async () => {
      const recentToken = {
        id: 'tok-recent',
        userId: 'user-uuid-1',
        type: 'email' as const,
        token: '111111',
        expiresAt: new Date(Date.now() + 60_000),
        used: false,
        createdAt: new Date(Date.now() - 30_000),
      };
      mockFindLatestUnused.mockResolvedValue(recentToken);

      await service.resend({ email: 'user@example.com' });

      expect(mockInvalidateActive).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('proceeds with resend when latest unused token is older than 60 seconds', async () => {
      const oldToken = {
        id: 'tok-old',
        userId: 'user-uuid-1',
        type: 'email' as const,
        token: '222222',
        expiresAt: new Date(Date.now() + 60_000),
        used: false,
        createdAt: new Date(Date.now() - 120_000),
      };
      mockFindLatestUnused.mockResolvedValue(oldToken);

      await service.resend({ email: 'user@example.com' });

      expect(mockInvalidateActive).toHaveBeenCalledWith('user-uuid-1', 'email');
      expect(mockCreate).toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalled();
    });
  });

  describe('successful resend', () => {
    it('invalidates any active tokens before issuing a new one', async () => {
      await service.resend({ email: 'user@example.com' });

      expect(mockInvalidateActive).toHaveBeenCalledWith('user-uuid-1', 'email');
      const invalidateOrder = mockInvalidateActive.mock.invocationCallOrder[0]!;
      const createOrder = mockCreate.mock.invocationCallOrder[0]!;
      expect(invalidateOrder).toBeLessThan(createOrder);
    });

    it('creates a fresh 6-digit token with type=email', async () => {
      await service.resend({ email: 'user@example.com' });

      const calls = mockCreate.mock.calls as Record<string, unknown>[][];
      const input = calls[0]?.[0] as { userId: string; type: string; token: string };
      expect(input.userId).toBe('user-uuid-1');
      expect(input.type).toBe('email');
      expect(input.token).toMatch(/^\d{6}$/);
    });

    it('sends the new code to the user via EmailService', async () => {
      await service.resend({ email: 'user@example.com' });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          firstName: 'John',
        }),
      );
    });

    it('does NOT propagate EmailDeliveryError (caller already received 200)', async () => {
      mockSend.mockRejectedValue(new EmailDeliveryError('user@example.com', { msg: 'down' }));

      await expect(service.resend({ email: 'user@example.com' })).resolves.toBeUndefined();
    });
  });
});
