import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { type AuthProvider, type User, type UserStatus } from '../domain/user.types';

export interface CreateEmailUserInput {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  acceptedPolicy: boolean;
  initialStatus?: UserStatus;
}

export interface CreateSocialUserInput {
  email: string;
  firstName: string;
  lastName: string;
  authProvider: 'google' | 'facebook';
  authProviderId: string;
}

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.prisma.users.findUnique({ where: { id } });
    return row ? this.mapToDomain(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.users.findUnique({
      where: { email: email.toLowerCase() },
    });
    return row ? this.mapToDomain(row) : null;
  }

  async findByProvider(provider: AuthProvider, providerId: string): Promise<User | null> {
    const row = await this.prisma.users.findFirst({
      where: { auth_provider: provider, auth_provider_id: providerId },
    });
    return row ? this.mapToDomain(row) : null;
  }

  async createWithEmail(input: CreateEmailUserInput): Promise<User> {
    try {
      const row = await this.prisma.users.create({
        data: {
          email: input.email.toLowerCase(),
          password_hash: input.passwordHash,
          first_name: input.firstName,
          last_name: input.lastName,
          phone: input.phone,
          accepted_policy: input.acceptedPolicy,
          auth_provider: 'email',
          status: input.initialStatus ?? 'pending_verification',
        },
      });
      return this.mapToDomain(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new EmailAlreadyExistsError(input.email);
      }
      throw err;
    }
  }

  async createSocialUser(input: CreateSocialUserInput): Promise<User> {
    try {
      const row = await this.prisma.users.create({
        data: {
          email: input.email.toLowerCase(),
          first_name: input.firstName,
          last_name: input.lastName,
          auth_provider: input.authProvider,
          auth_provider_id: input.authProviderId,
          accepted_policy: true,
          email_verified: true,
          status: 'active',
        },
      });
      return this.mapToDomain(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new EmailAlreadyExistsError(input.email);
      }
      throw err;
    }
  }

  async markEmailVerifiedAndActivate(userId: string): Promise<User> {
    const row = await this.prisma.users.update({
      where: { id: userId },
      data: {
        email_verified: true,
        status: 'active',
      },
    });
    return this.mapToDomain(row);
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<User> {
    const row = await this.prisma.users.update({
      where: { id: userId },
      data: { password_hash: passwordHash },
    });
    return this.mapToDomain(row);
  }

  private mapToDomain(row: {
    id: string;
    email: string | null;
    password_hash: string | null;
    first_name: string;
    last_name: string;
    phone: string | null;
    auth_provider: string;
    auth_provider_id: string | null;
    status: string;
    email_verified: boolean;
    created_at: Date;
  }): User {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: row.phone,
      authProvider: row.auth_provider as AuthProvider,
      authProviderId: row.auth_provider_id,
      status: row.status as User['status'],
      emailVerified: row.email_verified,
      createdAt: row.created_at,
    };
  }
}

export class EmailAlreadyExistsError extends Error {
  readonly email: string;

  constructor(email: string) {
    super('Email already registered');
    this.name = 'EmailAlreadyExistsError';
    this.email = email;
  }
}
