import { Module } from '@nestjs/common';

import { JwtService } from './services/jwt.service';
import { PasswordService } from './services/password.service';

@Module({
  providers: [PasswordService, JwtService],
  exports: [PasswordService, JwtService],
})
export class AuthModule {}
