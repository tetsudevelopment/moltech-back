import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

export type VerificationTokenType = 'email' | 'reset_password' | 'whatsapp';

export interface VerificationToken {
  id: string;
  userId: string;
  type: VerificationTokenType;
  token: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

export interface CreateVerificationTokenInput {
  userId: string;
  type: VerificationTokenType;
  token: string;
  expiresAt: Date;
}

@Injectable()
export class VerificationTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateVerificationTokenInput): Promise<VerificationToken> {
    const row = await this.prisma.verification_tokens.create({
      data: {
        user_id: input.userId,
        type: input.type,
        token: input.token,
        expires_at: input.expiresAt,
      },
    });
    return this.mapToDomain(row);
  }

  async findValid(
    userId: string,
    type: VerificationTokenType,
    token: string,
    now: Date = new Date(),
  ): Promise<VerificationToken | null> {
    const row = await this.prisma.verification_tokens.findFirst({
      where: {
        user_id: userId,
        type,
        token,
        used: false,
        expires_at: { gt: now },
      },
    });
    return row ? this.mapToDomain(row) : null;
  }

  async findLatestUnused(
    userId: string,
    type: VerificationTokenType,
  ): Promise<VerificationToken | null> {
    const row = await this.prisma.verification_tokens.findFirst({
      where: {
        user_id: userId,
        type,
        used: false,
      },
      orderBy: { created_at: 'desc' },
    });
    return row ? this.mapToDomain(row) : null;
  }

  async markUsed(id: string): Promise<void> {
    await this.prisma.verification_tokens.update({
      where: { id },
      data: { used: true },
    });
  }

  async invalidateActive(userId: string, type: VerificationTokenType): Promise<void> {
    await this.prisma.verification_tokens.updateMany({
      where: {
        user_id: userId,
        type,
        used: false,
      },
      data: { used: true },
    });
  }

  private mapToDomain(row: {
    id: string;
    user_id: string;
    type: string;
    token: string;
    expires_at: Date;
    used: boolean;
    created_at: Date;
  }): VerificationToken {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type as VerificationTokenType,
      token: row.token,
      expiresAt: row.expires_at,
      used: row.used,
      createdAt: row.created_at,
    };
  }
}
