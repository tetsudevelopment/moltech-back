import { Injectable, NotFoundException } from '@nestjs/common';

import { type UpdateProfileDto } from '../dtos/update-profile.dto';
import {
  ProfileRepository,
  type UpdateProfileInput,
  type UserProfile,
} from '../repositories/profile.repository';

@Injectable()
export class ProfileService {
  constructor(private readonly profiles: ProfileRepository) {}

  async getMe(userId: string): Promise<UserProfile> {
    const profile = await this.profiles.findProfileById(userId);
    if (!profile) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }
    return profile;
  }

  async updateMe(userId: string, dto: UpdateProfileDto): Promise<UserProfile> {
    const existing = await this.profiles.findProfileById(userId);
    if (!existing) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    const input: UpdateProfileInput = {};
    if (dto.first_name !== undefined) input.firstName = dto.first_name;
    if (dto.last_name !== undefined) input.lastName = dto.last_name;
    if (dto.phone !== undefined) input.phone = dto.phone;
    if (dto.country !== undefined) input.country = dto.country;
    if (dto.city !== undefined) input.city = dto.city;
    if (dto.address !== undefined) input.address = dto.address;
    if (dto.photo_url !== undefined) input.photoUrl = dto.photo_url;

    return this.profiles.updateProfile(userId, input);
  }
}
