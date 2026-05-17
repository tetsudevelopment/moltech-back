import { HttpException, HttpStatus } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { HealthController } from './health.controller';
import { HealthService } from '../services/health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let service: jest.Mocked<HealthService>;

  beforeEach(async () => {
    const mockHealthService: jest.Mocked<HealthService> = {
      checkLive: jest.fn(),
      checkReady: jest.fn(),
    } as unknown as jest.Mocked<HealthService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: mockHealthService }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    service = module.get(HealthService);
  });

  describe('liveness', () => {
    it('returns { status: "ok" } with HTTP 200', () => {
      service.checkLive.mockReturnValueOnce({ status: 'ok' });

      const result = controller.liveness();

      expect(result).toEqual({ status: 'ok' });
      expect(service.checkLive).toHaveBeenCalledTimes(1);
    });
  });

  describe('readiness', () => {
    it('returns the ready payload with HTTP 200 when status is ready', async () => {
      const readyPayload = {
        status: 'ready' as const,
        checks: { db: 'ok' as const, redis: 'ok' as const },
      };
      service.checkReady.mockResolvedValueOnce(readyPayload);

      const mockRes = { status: jest.fn().mockReturnThis() };
      const result = await controller.readiness(mockRes as never);

      expect(result).toEqual(readyPayload);
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('sets HTTP 503 and returns body when status is not_ready', async () => {
      const notReadyPayload = {
        status: 'not_ready' as const,
        checks: { db: 'fail' as const, redis: 'ok' as const },
      };
      service.checkReady.mockResolvedValueOnce(notReadyPayload);

      const mockRes = { status: jest.fn().mockReturnThis() };
      const result = await controller.readiness(mockRes as never);

      expect(result).toEqual(notReadyPayload);
      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('propagates the check details when both deps fail', async () => {
      const notReadyPayload = {
        status: 'not_ready' as const,
        checks: { db: 'fail' as const, redis: 'fail' as const },
      };
      service.checkReady.mockResolvedValueOnce(notReadyPayload);

      const mockRes = { status: jest.fn().mockReturnThis() };
      const result = await controller.readiness(mockRes as never);

      expect(result.checks.db).toBe('fail');
      expect(result.checks.redis).toBe('fail');
      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  void HttpException;
});
