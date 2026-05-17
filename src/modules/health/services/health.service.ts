import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { RedisService } from '@/infrastructure/redis/redis.service';

type CheckStatus = 'ok' | 'fail';
type OverallStatus = 'ready' | 'not_ready';

export interface LiveResult {
  status: 'ok';
}

export interface ReadyResult {
  status: OverallStatus;
  checks: {
    db: CheckStatus;
    redis: CheckStatus;
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  checkLive(): LiveResult {
    return { status: 'ok' };
  }

  async checkReady(): Promise<ReadyResult> {
    const [dbResult, redisResult] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
    ]);

    const db: CheckStatus = dbResult.status === 'fulfilled' ? 'ok' : 'fail';
    const redis: CheckStatus = redisResult.status === 'fulfilled' ? 'ok' : 'fail';

    if (dbResult.status === 'rejected') {
      this.logger.warn(`DB health check failed: ${String(dbResult.reason)}`);
    }
    if (redisResult.status === 'rejected') {
      this.logger.warn(`Redis health check failed: ${String(redisResult.reason)}`);
    }

    const status: OverallStatus = db === 'ok' && redis === 'ok' ? 'ready' : 'not_ready';

    return { status, checks: { db, redis } };
  }
}
