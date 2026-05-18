import { Module } from '@nestjs/common';

import { AuthModule } from '@/modules/auth/auth.module';

import { UsersController } from './controllers/users.controller';
import { ProfileRepository } from './repositories/profile.repository';
import { ProfileService } from './services/profile.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [ProfileService, ProfileRepository],
  exports: [ProfileService, ProfileRepository],
})
export class UsersModule {}
