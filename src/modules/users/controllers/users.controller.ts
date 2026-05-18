import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';

import { type UpdateProfileDto, UpdateProfileSchema } from '../dtos/update-profile.dto';
import { ProfileService } from '../services/profile.service';

interface PublicProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  photo_url: string | null;
  email_verified: boolean;
  phone_verified: boolean;
  auth_provider: string;
  status: string;
  created_at: string;
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('me')
  async getMe(@CurrentUser() current: { id: string }): Promise<PublicProfile> {
    const profile = await this.profileService.getMe(current.id);
    return serialize(profile);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() current: { id: string },
    @Body(new ZodValidationPipe(UpdateProfileSchema)) dto: UpdateProfileDto,
  ): Promise<PublicProfile> {
    const profile = await this.profileService.updateMe(current.id, dto);
    return serialize(profile);
  }
}

function serialize(profile: {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  photoUrl: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  authProvider: string;
  status: string;
  createdAt: Date;
}): PublicProfile {
  return {
    id: profile.id,
    first_name: profile.firstName,
    last_name: profile.lastName,
    email: profile.email,
    phone: profile.phone,
    country: profile.country,
    city: profile.city,
    address: profile.address,
    photo_url: profile.photoUrl,
    email_verified: profile.emailVerified,
    phone_verified: profile.phoneVerified,
    auth_provider: profile.authProvider,
    status: profile.status,
    created_at: profile.createdAt.toISOString(),
  };
}
