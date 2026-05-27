import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { type AuthProvider, type User, type UserRole, type UserStatus } from '../domain/user.types';

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
        throw uniqueViolationToError(err, {
          email: input.email,
          ...(input.phone !== null ? { phone: input.phone } : {}),
        });
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
        throw uniqueViolationToError(err, { email: input.email });
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

  async listAll(input: {
    page: number;
    pageSize: number;
    role?: UserRole;
    status?: UserStatus;
    search?: string;
  }): Promise<{ data: User[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, input.page);
    const pageSize = Math.min(100, Math.max(1, input.pageSize));
    const where: Prisma.usersWhereInput = {};
    if (input.role !== undefined) where.role = input.role;
    if (input.status !== undefined) where.status = input.status;
    if (input.search !== undefined && input.search.trim().length > 0) {
      const term = input.search.trim();
      where.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        { first_name: { contains: term, mode: 'insensitive' } },
        { last_name: { contains: term, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.users.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.users.count({ where }),
    ]);
    return { data: rows.map((r) => this.mapToDomain(r)), total, page, pageSize };
  }

  async updateRole(userId: string, role: UserRole): Promise<User | null> {
    try {
      const row = await this.prisma.users.update({
        where: { id: userId },
        data: { role },
      });
      return this.mapToDomain(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return null;
      }
      throw err;
    }
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<User> {
    const row = await this.prisma.users.update({
      where: { id: userId },
      data: { password_hash: passwordHash },
    });
    return this.mapToDomain(row);
  }

  async deleteById(userId: string): Promise<boolean> {
    try {
      await this.prisma.$transaction([
        this.prisma.verification_tokens.deleteMany({ where: { user_id: userId } }),
        this.prisma.notifications.deleteMany({ where: { user_id: userId } }),
        this.prisma.payment_methods.deleteMany({ where: { user_id: userId } }),
        this.prisma.users.delete({ where: { id: userId } }),
      ]);
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return false;
      }
      throw err;
    }
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
    role: string;
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
      role: row.role as UserRole,
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

export class PhoneAlreadyExistsError extends Error {
  readonly phone: string;

  constructor(phone: string) {
    super('Phone already registered');
    this.name = 'PhoneAlreadyExistsError';
    this.phone = phone;
  }
}

function uniqueViolationToError(
  err: Prisma.PrismaClientKnownRequestError,
  values: { email: string; phone?: string },
): EmailAlreadyExistsError | PhoneAlreadyExistsError {
  const fields = extractTargetFields(err.meta?.target);
  if (fields.includes('phone') && values.phone) {
    return new PhoneAlreadyExistsError(values.phone);
  }
  if (fields.includes('email')) {
    return new EmailAlreadyExistsError(values.email);
  }
  return new EmailAlreadyExistsError(values.email);
}

function extractTargetFields(target: unknown): string[] {
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === 'string') return [target];
  return [];
}
