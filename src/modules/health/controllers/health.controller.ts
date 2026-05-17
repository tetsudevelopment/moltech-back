import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService, type LiveResult, type ReadyResult } from '../services/health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  liveness(): LiveResult {
    return this.healthService.checkLive();
  }

  @Get('ready')
  async readiness(@Res({ passthrough: true }) res: Response): Promise<ReadyResult> {
    const result = await this.healthService.checkReady();
    if (result.status === 'not_ready') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}
