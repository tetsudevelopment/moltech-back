import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';

import { SkipEnvelope } from '@/common/decorators/skip-envelope.decorator';
import { SkipThrottle } from '@/common/decorators/skip-throttle.decorator';

import { HealthService, type LiveResult, type ReadyResult } from '../services/health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @SkipThrottle()
  @SkipEnvelope()
  @Get('live')
  liveness(): LiveResult {
    return this.healthService.checkLive();
  }

  @SkipThrottle()
  @SkipEnvelope()
  @Get('ready')
  async readiness(@Res({ passthrough: true }) res: Response): Promise<ReadyResult> {
    const result = await this.healthService.checkReady();
    if (result.status === 'not_ready') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}
