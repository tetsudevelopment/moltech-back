import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { type User } from '../domain/user.types';

export interface CreateEmailUserInput {
  email: string;
  passwordHash: string;
  nombres: string;
  apellidos: string;
  telefono: string | null;
  aceptaPolitica: boolean;
}

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.usuarios.findUnique({
      where: { email: email.toLowerCase() },
    });
    return row ? this.mapToDomain(row) : null;
  }

  async createWithEmail(input: CreateEmailUserInput): Promise<User> {
    try {
      const row = await this.prisma.usuarios.create({
        data: {
          email: input.email.toLowerCase(),
          password_hash: input.passwordHash,
          nombres: input.nombres,
          apellidos: input.apellidos,
          telefono: input.telefono,
          acepta_politica: input.aceptaPolitica,
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
    nombres: string;
    apellidos: string;
    telefono: string | null;
    auth_provider: string;
    estado: string;
    fecha_registro: Date;
  }): User {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      nombres: row.nombres,
      apellidos: row.apellidos,
      telefono: row.telefono,
      authProvider: row.auth_provider as User['authProvider'],
      estado: row.estado as User['estado'],
      createdAt: row.fecha_registro,
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
