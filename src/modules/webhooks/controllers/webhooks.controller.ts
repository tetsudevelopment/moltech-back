import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { SkipThrottle } from '@/common/decorators/skip-throttle.decorator';

import { WebhooksService } from '../services/webhooks.service';

interface WebhookResponse {
  received: boolean;
  outcome: 'applied' | 'noop' | 'ignored';
  event_type: string;
}

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  /**
   * Inbound webhook from PaymentsWay (or any compatible gateway via the
   * abstraction). Verified by HMAC-SHA256 on the raw body using
   * timingSafeEqual (CLAUDE.md §2.7). The route is intentionally NOT behind
   * JwtAuthGuard or IdempotencyInterceptor — auth is via signature, dedupe
   * is by transactionId inside the service.
   */
  @SkipThrottle()
  @Post('payments-way')
  @HttpCode(HttpStatus.OK)
  async paymentsWay(
    @Req() req: RawBodyRequest<Request> & { id?: string },
    @Headers('x-signature') signature: string | undefined,
  ): Promise<WebhookResponse> {
    const rawBody = req.rawBody ?? Buffer.alloc(0);
    const result = await this.service.handle(rawBody, signature, req.id);
    return {
      received: result.received,
      outcome: result.outcome,
      event_type: result.eventType,
    };
  }
}
