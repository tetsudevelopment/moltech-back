import { randomUUID } from 'crypto';

import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';

import { isPaginatedResponse, type Pagination } from './pagination.types';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator';

interface SuccessEnvelopeMeta {
  request_id: string;
  timestamp: string;
  pagination?: Pagination;
}

interface SuccessEnvelope<T> {
  data: T;
  meta: SuccessEnvelopeMeta;
  error: null;
}

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<Request & { id?: string | undefined }>();
    const requestId: string =
      typeof req.id === 'string' && req.id.length > 0 ? req.id : randomUUID();

    return next.handle().pipe(
      map((value: unknown): unknown => {
        if (isAlreadyWrapped(value)) {
          return value;
        }
        const meta: SuccessEnvelopeMeta = {
          request_id: requestId,
          timestamp: new Date().toISOString(),
        };
        let data: unknown = value ?? null;
        if (isPaginatedResponse(value)) {
          data = value.data;
          meta.pagination = value.pagination;
        }
        const envelope: SuccessEnvelope<unknown> = { data, meta, error: null };
        return envelope;
      }),
    );
  }
}

function isAlreadyWrapped(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'meta' in value &&
    'error' in value
  );
}
