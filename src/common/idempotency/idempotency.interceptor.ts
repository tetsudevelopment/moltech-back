import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable, from, of } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';
import { z } from 'zod';

import { IdempotencyService, type IdempotencyKeyParts } from './idempotency.service';
import type { CompleteRecord } from './idempotency.types';
import { IDEMPOTENT_METADATA } from './idempotent.decorator';

const IDEMPOTENCY_HEADER = 'idempotency-key';
const IdempotencyKeySchema = z.uuid({ version: 'v4' });

// `user` comes from the global Express Request augmentation set by JwtAuthGuard.
// We narrow the optional `id` so pino-http's ReqId widening doesn't leak strings|numbers
// into our IdempotencyService API.
interface AuthedRequest extends Omit<Request, 'id'> {
  id?: string | number;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotency: IdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isIdempotent = this.reflector.get<boolean>(IDEMPOTENT_METADATA, context.getHandler());
    if (!isIdempotent) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<AuthedRequest>();
    const res = http.getResponse<Response>();

    const rawKey = req.headers[IDEMPOTENCY_HEADER];
    const headerValue = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!headerValue) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: `Header ${IDEMPOTENCY_HEADER} is required for this endpoint`,
      });
    }
    const parsed = IdempotencyKeySchema.safeParse(headerValue);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_INVALID',
        message: `Header ${IDEMPOTENCY_HEADER} must be a UUID v4`,
      });
    }
    if (!req.user) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_REQUIRES_AUTH',
        message: 'Idempotent endpoints must be protected by JwtAuthGuard',
      });
    }

    const parts: IdempotencyKeyParts = {
      userId: req.user.id,
      method: req.method,
      path: req.originalUrl.split('?')[0] ?? req.originalUrl,
      key: parsed.data,
    };
    const payloadHash = this.idempotency.hashPayload(req.body ?? null);

    return from(this.idempotency.reserve(parts, payloadHash, stringifyReqId(req.id))).pipe(
      switchMap((outcome) => {
        switch (outcome.kind) {
          case 'replay':
            return this.replay(res, outcome.record);
          case 'conflict':
            throw new ConflictException({
              code: 'IDEMPOTENCY_KEY_CONFLICT',
              message: 'This Idempotency-Key was previously used with a different request payload',
            });
          case 'in_progress':
            throw new ConflictException({
              code: 'IDEMPOTENCY_IN_PROGRESS',
              message: 'A previous request with this Idempotency-Key is still being processed',
            });
          case 'reserved':
            return next.handle().pipe(
              tap((body) => {
                void this.idempotency.complete(
                  parts,
                  payloadHash,
                  res.statusCode,
                  body,
                  stringifyReqId(req.id),
                );
              }),
              catchError((err: unknown) => {
                void this.idempotency.release(parts);
                throw err;
              }),
            );
        }
      }),
    );
  }

  private replay(res: Response, record: CompleteRecord): Observable<unknown> {
    res.status(record.statusCode);
    res.setHeader('X-Idempotent-Replay', 'true');
    return of(record.body);
  }
}

function stringifyReqId(id: string | number | undefined): string | undefined {
  if (id === undefined) return undefined;
  if (typeof id === 'string') return id;
  return String(id);
}
