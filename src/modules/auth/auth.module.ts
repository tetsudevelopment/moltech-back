import { Module } from '@nestjs/common';

import { AuthController } from './controllers/auth.controller';
import { UserRepository } from './repositories/user.repository';
import { JwtService } from './services/jwt.service';
import { PasswordService } from './services/password.service';
import { RegisterService } from './services/register.service';

@Module({
  controllers: [AuthController],
  providers: [PasswordService, JwtService, UserRepository, RegisterService],
  exports: [PasswordService, JwtService, UserRepository],
})
export class AuthModule {}
