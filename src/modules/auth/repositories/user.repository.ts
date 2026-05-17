import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { type User } from '../domain/user.types';

export interface CreateEmailUserInput {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  acceptedPolicy: boolean;
}

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.users.findUnique({
      where: { email: email.toLowerCase() },
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

  private mapToDomain(row: {
    id: string;
    email: string | null;
    password_hash: string | null;
    first_name: string;
    last_name: string;
    phone: string | null;
    auth_provider: string;
    status: string;
    created_at: Date;
  }): User {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: row.phone,
      authProvider: row.auth_provider as User['authProvider'],
      status: row.status as User['status'],
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
