import { Test, type TestingModule } from '@nestjs/testing';
import { Resend } from 'resend';

import { AppConfigService } from '@/config/config.service';

import { EmailDeliveryError, EmailService } from './email.service';

jest.mock('resend');

const ResendMock = Resend as unknown as jest.Mock;
const mockSend = jest.fn();

const fakeConfig = {
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM_EMAIL: 'no-reply@moltech.app',
  EMAIL_VERIFICATION_CODE_TTL_MIN: 15,
} as const;

type FakeConfigKey = keyof typeof fakeConfig;

interface SentEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

function buildConfigService() {
  return {
    get: jest.fn((key: FakeConfigKey) => fakeConfig[key]),
  };
}

function firstSentEmail(): SentEmail {
  const calls = mockSend.mock.calls as unknown[][];
  return calls[0]?.[0] as SentEmail;
}

describe('EmailService', () => {
  let service: EmailService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ data: { id: 'resend-msg-id' }, error: null });
    ResendMock.mockImplementation(() => ({
      emails: { send: mockSend },
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [EmailService, { provide: AppConfigService, useValue: buildConfigService() }],
    }).compile();

    service = module.get<EmailService>(EmailService);
    await module.init();
  });

  describe('onModuleInit', () => {
    it('creates a Resend client with the configured API key', () => {
      expect(ResendMock).toHaveBeenCalledWith('re_test_key');
    });
  });

  describe('sendVerificationCode', () => {
    it('sends an email via Resend with the configured from address and recipient', async () => {
      await service.sendVerificationCode({
        to: 'user@example.com',
        code: '123456',
        firstName: 'John',
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'no-reply@moltech.app',
          to: 'user@example.com',
        }),
      );
    });

    it('includes the verification code in both text and html bodies', async () => {
      await service.sendVerificationCode({
        to: 'user@example.com',
        code: '987654',
        firstName: 'John',
      });

      const payload = firstSentEmail();
      expect(payload.text).toContain('987654');
      expect(payload.html).toContain('987654');
    });

    it('mentions the TTL in minutes in the body', async () => {
      await service.sendVerificationCode({
        to: 'user@example.com',
        code: '123456',
        firstName: 'John',
      });

      const payload = firstSentEmail();
      expect(payload.text).toContain('15');
      expect(payload.html).toContain('15');
    });

    it('addresses the user by first name in the body', async () => {
      await service.sendVerificationCode({
        to: 'user@example.com',
        code: '123456',
        firstName: 'Jane',
      });

      const payload = firstSentEmail();
      expect(payload.text).toContain('Jane');
    });

    it('escapes HTML in firstName to prevent injection in the html body', async () => {
      await service.sendVerificationCode({
        to: 'user@example.com',
        code: '123456',
        firstName: '<script>alert(1)</script>',
      });

      const payload = firstSentEmail();
      expect(payload.html).not.toContain('<script>');
      expect(payload.html).toContain('&lt;script&gt;');
    });

    it('throws EmailDeliveryError when Resend returns an error', async () => {
      mockSend.mockResolvedValue({
        data: null,
        error: { message: 'API unavailable', name: 'application_error' },
      });

      await expect(
        service.sendVerificationCode({
          to: 'user@example.com',
          code: '123456',
          firstName: 'John',
        }),
      ).rejects.toThrow(EmailDeliveryError);
    });

    it('does not log the verification code at error level when delivery fails', async () => {
      mockSend.mockResolvedValue({
        data: null,
        error: { message: 'API unavailable', name: 'application_error' },
      });

      await expect(
        service.sendVerificationCode({
          to: 'user@example.com',
          code: 'SECRET',
          firstName: 'John',
        }),
      ).rejects.toThrow(EmailDeliveryError);
    });
  });

  describe('sendPasswordResetCode', () => {
    it('sends a password reset email with the configured from and recipient', async () => {
      await service.sendPasswordResetCode({
        to: 'user@example.com',
        code: '654321',
        firstName: 'John',
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'no-reply@moltech.app',
          to: 'user@example.com',
        }),
      );
    });

    it('uses a distinct subject from the verification email', async () => {
      await service.sendPasswordResetCode({
        to: 'user@example.com',
        code: '654321',
        firstName: 'John',
      });

      const payload = firstSentEmail();
      expect(payload.subject).toContain('password reset');
    });

    it('includes the reset code and TTL in both text and html bodies', async () => {
      await service.sendPasswordResetCode({
        to: 'user@example.com',
        code: '654321',
        firstName: 'John',
      });

      const payload = firstSentEmail();
      expect(payload.text).toContain('654321');
      expect(payload.html).toContain('654321');
      expect(payload.text).toContain('15');
      expect(payload.html).toContain('15');
    });

    it('escapes HTML in firstName for the reset email too', async () => {
      await service.sendPasswordResetCode({
        to: 'user@example.com',
        code: '654321',
        firstName: '<img src=x onerror=1>',
      });

      const payload = firstSentEmail();
      expect(payload.html).not.toContain('<img');
      expect(payload.html).toContain('&lt;img');
    });

    it('throws EmailDeliveryError when Resend returns an error', async () => {
      mockSend.mockResolvedValue({
        data: null,
        error: { message: 'API down', name: 'application_error' },
      });

      await expect(
        service.sendPasswordResetCode({
          to: 'user@example.com',
          code: '654321',
          firstName: 'John',
        }),
      ).rejects.toThrow(EmailDeliveryError);
    });
  });
});
