import { Injectable } from '@nestjs/common';

import { AppConfigService } from '@/config/config.service';
import { RedisService } from '@/infrastructure/redis/redis.service';

const FAMILY_KEY_PREFIX = 'auth:refresh:family:';

interface RefreshFamilyRecord {
  userId: string;
  currentTokenId: string;
  createdAt: string;
}

@Injectable()
export class RefreshTokenStore {
  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {}

  async createFamily(familyId: string, userId: string, initialTokenId: string): Promise<void> {
    const record: RefreshFamilyRecord = {
      userId,
      currentTokenId: initialTokenId,
      createdAt: new Date().toISOString(),
    };
    const ttlSeconds = this.parseTtl(this.config.get('JWT_REFRESH_TTL'));
    await this.redis.getClient().set(this.key(familyId), JSON.stringify(record), 'EX', ttlSeconds);
  }

  async getCurrentTokenId(familyId: string): Promise<string | null> {
    const raw = await this.redis.getClient().get(this.key(familyId));
    if (raw === null) return null;
    const record = JSON.parse(raw) as RefreshFamilyRecord;
    return record.currentTokenId;
  }

  async setCurrentTokenId(familyId: string, newTokenId: string): Promise<void> {
    const raw = await this.redis.getClient().get(this.key(familyId));
    if (raw === null) {
      throw new Error(`Family ${familyId} not found`);
    }
    const record = JSON.parse(raw) as RefreshFamilyRecord;
    record.currentTokenId = newTokenId;
    const ttlSeconds = this.parseTtl(this.config.get('JWT_REFRESH_TTL'));
    await this.redis.getClient().set(this.key(familyId), JSON.stringify(record), 'EX', ttlSeconds);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.redis.getClient().del(this.key(familyId));
  }

  async familyExists(familyId: string): Promise<boolean> {
    const exists = await this.redis.getClient().exists(this.key(familyId));
    return exists === 1;
  }

  private key(familyId: string): string {
    return `${FAMILY_KEY_PREFIX}${familyId}`;
  }

  private parseTtl(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match?.[1] || !match[2]) {
      throw new Error(`Invalid TTL format: ${ttl}`);
    }
    const value = Number.parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    const mult = multipliers[unit];
    if (mult === undefined) {
      throw new Error(`Invalid TTL unit: ${unit}`);
    }
    return value * mult;
  }
}
