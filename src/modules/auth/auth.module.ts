import { Module } from '@nestjs/common';

import { AuthController } from './controllers/auth.controller';
import { RefreshTokenStore } from './repositories/refresh-token-store';
import { UserRepository } from './repositories/user.repository';
import { JwtService } from './services/jwt.service';
import { LoginService } from './services/login.service';
import { PasswordService } from './services/password.service';
import { RegisterService } from './services/register.service';

@Module({
  controllers: [AuthController],
  providers: [
    PasswordService,
    JwtService,
    UserRepository,
    RefreshTokenStore,
    RegisterService,
    LoginService,
  ],
  exports: [PasswordService, JwtService, UserRepository, RefreshTokenStore],
})
export class AuthModule {}
