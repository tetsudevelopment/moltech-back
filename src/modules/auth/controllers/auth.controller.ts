import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

import { type ForgotPasswordDto, ForgotPasswordSchema } from '../dtos/forgot-password.dto';
import { type LoginDto, LoginSchema } from '../dtos/login.dto';
import { type LogoutDto, LogoutSchema } from '../dtos/logout.dto';
import { type RefreshDto, RefreshSchema } from '../dtos/refresh.dto';
import { type RegisterDto, RegisterSchema } from '../dtos/register.dto';
import {
  type ResendVerificationDto,
  ResendVerificationSchema,
} from '../dtos/resend-verification.dto';
import { type ResetPasswordDto, ResetPasswordSchema } from '../dtos/reset-password.dto';
import { type SocialLoginDto, SocialLoginSchema } from '../dtos/social-login.dto';
import { type VerifyEmailDto, VerifyEmailSchema } from '../dtos/verify-email.dto';
import { ForgotPasswordService } from '../services/forgot-password.service';
import { LoginService } from '../services/login.service';
import { LogoutService } from '../services/logout.service';
import { RefreshService } from '../services/refresh.service';
import { EmailAlreadyExistsError, RegisterService } from '../services/register.service';
import { ResendVerificationService } from '../services/resend-verification.service';
import { ResetPasswordService } from '../services/reset-password.service';
import { SocialLoginService } from '../services/social-login.service';
import { VerifyEmailService } from '../services/verify-email.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerService: RegisterService,
    private readonly loginService: LoginService,
    private readonly refreshService: RefreshService,
    private readonly logoutService: LogoutService,
    private readonly verifyEmailService: VerifyEmailService,
    private readonly resendVerificationService: ResendVerificationService,
    private readonly forgotPasswordService: ForgotPasswordService,
    private readonly resetPasswordService: ResetPasswordService,
    private readonly socialLoginService: SocialLoginService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) dto: RegisterDto,
    @Req() req: Request & { id?: string },
  ): Promise<{
    user: {
      id: string;
      email: string | null;
      first_name: string;
      last_name: string;
      phone: string | null;
      email_verified: boolean;
      auth_provider: string;
      status: string;
      created_at: string;
    };
    verification_required: true;
  }> {
    try {
      const result = await this.registerService.register(dto, {
        requestId: req.id,
        ip: req.ip,
      });
      return {
        user: {
          id: result.user.id,
          email: result.user.email,
          first_name: result.user.firstName,
          last_name: result.user.lastName,
          phone: result.user.phone,
          email_verified: result.user.emailVerified,
          auth_provider: result.user.authProvider,
          status: result.user.status,
          created_at: result.user.createdAt.toISOString(),
        },
        verification_required: true,
      };
    } catch (err) {
      if (err instanceof EmailAlreadyExistsError) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'Este email ya está registrado',
        });
      }
      throw err;
    }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto,
    @Req() req: Request & { id?: string },
  ): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user: {
      id: string;
      email: string | null;
      first_name: string;
      last_name: string;
      status: string;
    };
  }> {
    const result = await this.loginService.login(dto, {
      requestId: req.id,
      ip: req.ip,
    });
    return {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      expires_in: 900,
      user: {
        id: result.user.id,
        email: result.user.email,
        first_name: result.user.firstName,
        last_name: result.user.lastName,
        status: result.user.status,
      },
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(new ZodValidationPipe(RefreshSchema)) dto: RefreshDto,
    @Req() req: Request & { id?: string },
  ): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    const result = await this.refreshService.refresh(dto.refresh_token, {
      requestId: req.id,
      ip: req.ip,
    });
    return {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      expires_in: 900, // F3 follow-up: derive from JWT_ACCESS_TTL
    };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body(new ZodValidationPipe(VerifyEmailSchema)) dto: VerifyEmailDto,
    @Req() req: Request & { id?: string },
  ): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user: {
      id: string;
      email: string | null;
      first_name: string;
      last_name: string;
      status: string;
      email_verified: boolean;
    };
  }> {
    const result = await this.verifyEmailService.verify(dto, {
      requestId: req.id,
      ip: req.ip,
    });
    return {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      expires_in: 900,
      user: {
        id: result.user.id,
        email: result.user.email,
        first_name: result.user.firstName,
        last_name: result.user.lastName,
        status: result.user.status,
        email_verified: result.user.emailVerified,
      },
    };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(
    @Body(new ZodValidationPipe(ResendVerificationSchema)) dto: ResendVerificationDto,
  ): Promise<null> {
    await this.resendVerificationService.resend(dto);
    return null;
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordSchema)) dto: ForgotPasswordDto,
    @Req() req: Request & { id?: string },
  ): Promise<null> {
    await this.forgotPasswordService.request(dto, {
      requestId: req.id,
      ip: req.ip,
    });
    return null;
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body(new ZodValidationPipe(ResetPasswordSchema)) dto: ResetPasswordDto,
    @Req() req: Request & { id?: string },
  ): Promise<null> {
    await this.resetPasswordService.reset(dto, {
      requestId: req.id,
      ip: req.ip,
    });
    return null;
  }

  @Post('social-login')
  @HttpCode(HttpStatus.OK)
  async socialLogin(
    @Body(new ZodValidationPipe(SocialLoginSchema)) dto: SocialLoginDto,
    @Req() req: Request & { id?: string },
  ): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    is_new_user: boolean;
    user: {
      id: string;
      email: string | null;
      first_name: string;
      last_name: string;
      auth_provider: string;
      email_verified: boolean;
      status: string;
    };
  }> {
    const result = await this.socialLoginService.login(dto, {
      requestId: req.id,
      ip: req.ip,
    });
    return {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      expires_in: 900,
      is_new_user: result.isNewUser,
      user: {
        id: result.user.id,
        email: result.user.email,
        first_name: result.user.firstName,
        last_name: result.user.lastName,
        auth_provider: result.user.authProvider,
        email_verified: result.user.emailVerified,
        status: result.user.status,
      },
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body(new ZodValidationPipe(LogoutSchema)) dto: LogoutDto,
    @Req() req: Request & { id?: string },
  ): Promise<void> {
    await this.logoutService.logout(dto.refresh_token, {
      requestId: req.id,
      ip: req.ip,
    });
  }
}
