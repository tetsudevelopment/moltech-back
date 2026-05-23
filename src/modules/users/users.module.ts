import { Module } from '@nestjs/common';

import { AuthModule } from '@/modules/auth/auth.module';

import { AdminUsersController } from './controllers/admin-users.controller';
import { UsersController } from './controllers/users.controller';
import { ProfileRepository } from './repositories/profile.repository';
import { AdminUsersService } from './services/admin-users.service';
import { ProfileService } from './services/profile.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController, AdminUsersController],
  providers: [ProfileService, AdminUsersService, ProfileRepository],
  exports: [ProfileService, ProfileRepository],
})
export class UsersModule {}
