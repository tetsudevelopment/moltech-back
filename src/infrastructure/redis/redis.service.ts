import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import Redis, { type Redis as RedisClient } from 'ioredis';
import { AppConfigService } from '@/config/config.service';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClient | undefined;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    this.client = new Redis(this.config.get('REDIS_URL'), {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
    this.client.on('error', (err: Error) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis disconnected');
    }
  }

  getClient(): RedisClient {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }
    return this.client;
  }

  async ping(): Promise<'PONG'> {
    const result = await this.getClient().ping();
    if (result !== 'PONG') {
      throw new Error(`Unexpected ping response: ${result}`);
    }
    return 'PONG';
  }
}
