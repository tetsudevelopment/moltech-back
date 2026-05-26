import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { RESET_CODE_MAX_ATTEMPTS } from '../auth.constants';

export type VerificationTokenType = 'email' | 'reset_password' | 'whatsapp';

export interface VerificationToken {
  id: string;
  userId: string;
  type: VerificationTokenType;
  token: string;
  expiresAt: Date;
  used: boolean;
  attemptsUsed: number;
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

  async findActiveResetToken(
    userId: string,
    now: Date = new Date(),
  ): Promise<VerificationToken | null> {
    const row = await this.prisma.verification_tokens.findFirst({
      where: {
        user_id: userId,
        type: 'reset_password',
        used: false,
        expires_at: { gt: now },
      },
      orderBy: { created_at: 'desc' },
    });
    return row ? this.mapToDomain(row) : null;
  }

  /**
   * Atomically increments attempts_used, gated on (used=false AND attempts_used < MAX).
   * Returns the new attempts_used count, or null if the row couldn't be incremented
   * (already at/over limit or doesn't exist — caller treats this as ATTEMPTS_EXHAUSTED).
   */
  async incrementAttempts(id: string): Promise<number | null> {
    const { count } = await this.prisma.verification_tokens.updateMany({
      where: {
        id,
        used: false,
        attempts_used: { lt: RESET_CODE_MAX_ATTEMPTS },
      },
      data: { attempts_used: { increment: 1 } },
    });

    if (count === 0) {
      return null;
    }

    // Re-read the row to get the updated value
    const row = await this.prisma.verification_tokens.findFirst({
      where: { id },
    });

    return row?.attempts_used ?? null;
  }

  private mapToDomain(row: {
    id: string;
    user_id: string;
    type: string;
    token: string;
    expires_at: Date;
    used: boolean;
    attempts_used: number;
    created_at: Date;
  }): VerificationToken {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type as VerificationTokenType,
      token: row.token,
      expiresAt: row.expires_at,
      used: row.used,
      attemptsUsed: row.attempts_used,
      createdAt: row.created_at,
    };
  }
}
