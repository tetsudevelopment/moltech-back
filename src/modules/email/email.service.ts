import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Resend } from 'resend';

import { AppConfigService } from '@/config/config.service';

export interface SendVerificationCodeParams {
  to: string;
  code: string;
  firstName: string;
}

export interface SendPasswordResetCodeParams {
  to: string;
  code: string;
  firstName: string;
}

export class EmailDeliveryError extends Error {
  readonly to: string;
  override readonly cause: unknown;

  constructor(to: string, cause: unknown) {
    super(`Failed to deliver email to ${to}`);
    this.name = 'EmailDeliveryError';
    this.to = to;
    this.cause = cause;
  }
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private client: Resend | undefined;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    this.client = new Resend(this.config.get('RESEND_API_KEY'));
    this.logger.log('Resend client initialized');
  }

  async sendVerificationCode(params: SendVerificationCodeParams): Promise<void> {
    const from = this.config.get('RESEND_FROM_EMAIL');
    const ttlMinutes = this.config.get('EMAIL_VERIFICATION_CODE_TTL_MIN');
    const firstName = escapeHtml(params.firstName);
    const code = escapeHtml(params.code);

    const result = await this.requireClient().emails.send({
      from,
      to: params.to,
      subject: 'Your MOLTECH verification code',
      text: buildVerificationPlainBody(params.firstName, params.code, ttlMinutes),
      html: buildVerificationHtmlBody(firstName, code, ttlMinutes),
    });

    if (result.error) {
      this.logger.error(
        { recipient: params.to, error: result.error },
        'Verification email delivery failed',
      );
      throw new EmailDeliveryError(params.to, result.error);
    }
  }

  async sendPasswordResetCode(params: SendPasswordResetCodeParams): Promise<void> {
    const from = this.config.get('RESEND_FROM_EMAIL');
    const ttlMinutes = this.config.get('EMAIL_VERIFICATION_CODE_TTL_MIN');
    const firstName = escapeHtml(params.firstName);
    const code = escapeHtml(params.code);

    const result = await this.requireClient().emails.send({
      from,
      to: params.to,
      subject: 'Your MOLTECH password reset code',
      text: buildPasswordResetPlainBody(params.firstName, params.code, ttlMinutes),
      html: buildPasswordResetHtmlBody(firstName, code, ttlMinutes),
    });

    if (result.error) {
      this.logger.error(
        { recipient: params.to, error: result.error },
        'Password reset email delivery failed',
      );
      throw new EmailDeliveryError(params.to, result.error);
    }
  }

  private requireClient(): Resend {
    if (!this.client) {
      throw new Error('Email service not initialized');
    }
    return this.client;
  }
}

function buildVerificationPlainBody(firstName: string, code: string, ttlMinutes: number): string {
  return [
    `Hi ${firstName},`,
    '',
    `Your verification code is: ${code}`,
    '',
    `This code expires in ${String(ttlMinutes)} minutes.`,
    '',
    `If you didn't request this, you can safely ignore this email.`,
    '',
    'The MOLTECH team',
  ].join('\n');
}

function buildVerificationHtmlBody(firstName: string, code: string, ttlMinutes: number): string {
  return [
    `<p>Hi ${firstName},</p>`,
    `<p>Your verification code is: <strong>${code}</strong></p>`,
    `<p>This code expires in <strong>${String(ttlMinutes)} minutes</strong>.</p>`,
    `<p>If you didn't request this, you can safely ignore this email.</p>`,
    `<p>The MOLTECH team</p>`,
  ].join('');
}

function buildPasswordResetPlainBody(firstName: string, code: string, ttlMinutes: number): string {
  return [
    `Hi ${firstName},`,
    '',
    `Use this code to reset your MOLTECH password: ${code}`,
    '',
    `This code expires in ${String(ttlMinutes)} minutes.`,
    '',
    `If you didn't request a password reset, you can ignore this email — your password will not change.`,
    '',
    'The MOLTECH team',
  ].join('\n');
}

function buildPasswordResetHtmlBody(firstName: string, code: string, ttlMinutes: number): string {
  return [
    `<p>Hi ${firstName},</p>`,
    `<p>Use this code to reset your MOLTECH password: <strong>${code}</strong></p>`,
    `<p>This code expires in <strong>${String(ttlMinutes)} minutes</strong>.</p>`,
    `<p>If you didn't request a password reset, you can ignore this email — your password will not change.</p>`,
    `<p>The MOLTECH team</p>`,
  ].join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
