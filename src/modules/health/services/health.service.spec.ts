import { Test, type TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { RedisService } from '@/infrastructure/redis/redis.service';

describe('HealthService', () => {
  let service: HealthService;
  let prisma: jest.Mocked<Pick<PrismaService, '$queryRaw'>>;
  let redis: jest.Mocked<Pick<RedisService, 'ping'>>;

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    redis = { ping: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  describe('checkLive', () => {
    it('returns { status: "ok" } always', () => {
      const result = service.checkLive();
      expect(result).toEqual({ status: 'ok' });
    });

    it('does not call any external dependency', () => {
      service.checkLive();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(redis.ping).not.toHaveBeenCalled();
    });
  });

  describe('checkReady', () => {
    it('returns ready with db ok and redis ok when both succeed', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ '?column?': 1 }]);
      (redis.ping as jest.Mock).mockResolvedValueOnce('PONG');

      const result = await service.checkReady();

      expect(result.status).toBe('ready');
      expect(result.checks.db).toBe('ok');
      expect(result.checks.redis).toBe('ok');
    });

    it('returns not_ready with db fail when prisma.$queryRaw throws', async () => {
      (prisma.$queryRaw as jest.Mock).mockRejectedValueOnce(new Error('connection refused'));
      (redis.ping as jest.Mock).mockResolvedValueOnce('PONG');

      const result = await service.checkReady();

      expect(result.status).toBe('not_ready');
      expect(result.checks.db).toBe('fail');
      expect(result.checks.redis).toBe('ok');
    });

    it('returns not_ready with redis fail when redis.ping throws', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ '?column?': 1 }]);
      (redis.ping as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await service.checkReady();

      expect(result.status).toBe('not_ready');
      expect(result.checks.db).toBe('ok');
      expect(result.checks.redis).toBe('fail');
    });

    it('returns not_ready with both fail when both deps throw', async () => {
      (prisma.$queryRaw as jest.Mock).mockRejectedValueOnce(new Error('db down'));
      (redis.ping as jest.Mock).mockRejectedValueOnce(new Error('redis down'));

      const result = await service.checkReady();

      expect(result.status).toBe('not_ready');
      expect(result.checks.db).toBe('fail');
      expect(result.checks.redis).toBe('fail');
    });

    it('never throws — always returns a result even when both deps fail', async () => {
      (prisma.$queryRaw as jest.Mock).mockRejectedValueOnce(new Error('db down'));
      (redis.ping as jest.Mock).mockRejectedValueOnce(new Error('redis down'));

      await expect(service.checkReady()).resolves.toBeDefined();
    });
  });
});
