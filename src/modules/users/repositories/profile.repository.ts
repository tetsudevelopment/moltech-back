import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

export interface UserProfile {
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
  authProvider: 'email' | 'google' | 'facebook';
  status: 'active' | 'suspended' | 'inactive' | 'pending_verification';
  createdAt: Date;
}

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  phone?: string;
  country?: string;
  city?: string;
  address?: string;
  photoUrl?: string;
}

@Injectable()
export class ProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProfileById(userId: string): Promise<UserProfile | null> {
    const row = await this.prisma.users.findUnique({ where: { id: userId } });
    return row ? mapToProfile(row) : null;
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<UserProfile> {
    const data: Record<string, unknown> = {};
    if (input.firstName !== undefined) data.first_name = input.firstName;
    if (input.lastName !== undefined) data.last_name = input.lastName;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.country !== undefined) data.country = input.country;
    if (input.city !== undefined) data.city = input.city;
    if (input.address !== undefined) data.address = input.address;
    if (input.photoUrl !== undefined) data.photo_url = input.photoUrl;

    const row = await this.prisma.users.update({
      where: { id: userId },
      data,
    });
    return mapToProfile(row);
  }
}

function mapToProfile(row: {
  id: string;
  email: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  photo_url: string | null;
  email_verified: boolean;
  phone_verified: boolean;
  auth_provider: string;
  status: string;
  created_at: Date;
}): UserProfile {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    country: row.country,
    city: row.city,
    address: row.address,
    photoUrl: row.photo_url,
    emailVerified: row.email_verified,
    phoneVerified: row.phone_verified,
    authProvider: row.auth_provider as UserProfile['authProvider'],
    status: row.status as UserProfile['status'],
    createdAt: row.created_at,
  };
}
