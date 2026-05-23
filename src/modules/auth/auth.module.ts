import { Module } from '@nestjs/common';

import { AuthController } from './controllers/auth.controller';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RefreshTokenStore } from './repositories/refresh-token-store';
import { UserRepository } from './repositories/user.repository';
import { VerificationTokenRepository } from './repositories/verification-token.repository';
import { FacebookOAuthVerifier } from './services/facebook-oauth.verifier';
import { ForgotPasswordService } from './services/forgot-password.service';
import { GoogleOAuthVerifier } from './services/google-oauth.verifier';
import { JwtService } from './services/jwt.service';
import { LoginService } from './services/login.service';
import { LogoutService } from './services/logout.service';
import { PasswordService } from './services/password.service';
import { RefreshService } from './services/refresh.service';
import { RegisterService } from './services/register.service';
import { ResendVerificationService } from './services/resend-verification.service';
import { ResetPasswordService } from './services/reset-password.service';
import { SocialLoginService } from './services/social-login.service';
import { VerifyEmailService } from './services/verify-email.service';

@Module({
  controllers: [AuthController],
  providers: [
    PasswordService,
    JwtService,
    UserRepository,
    RefreshTokenStore,
    VerificationTokenRepository,
    RegisterService,
    LoginService,
    RefreshService,
    LogoutService,
    VerifyEmailService,
    ResendVerificationService,
    ForgotPasswordService,
    ResetPasswordService,
    GoogleOAuthVerifier,
    FacebookOAuthVerifier,
    SocialLoginService,
    JwtAuthGuard,
    AdminAuthGuard,
  ],
  exports: [
    PasswordService,
    JwtService,
    UserRepository,
    RefreshTokenStore,
    VerificationTokenRepository,
    JwtAuthGuard,
    AdminAuthGuard,
  ],
})
export class AuthModule {}
