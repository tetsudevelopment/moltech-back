import { Module } from '@nestjs/common';

import { AuthController } from './controllers/auth.controller';
import { RefreshTokenStore } from './repositories/refresh-token-store';
import { UserRepository } from './repositories/user.repository';
import { VerificationTokenRepository } from './repositories/verification-token.repository';
import { JwtService } from './services/jwt.service';
import { LoginService } from './services/login.service';
import { LogoutService } from './services/logout.service';
import { PasswordService } from './services/password.service';
import { RefreshService } from './services/refresh.service';
import { RegisterService } from './services/register.service';
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
  ],
  exports: [
    PasswordService,
    JwtService,
    UserRepository,
    RefreshTokenStore,
    VerificationTokenRepository,
  ],
})
export class AuthModule {}
