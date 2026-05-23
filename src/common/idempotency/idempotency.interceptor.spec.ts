import { BadRequestException, ConflictException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';

import { IdempotencyInterceptor } from './idempotency.interceptor';
import { type IdempotencyService } from './idempotency.service';
import type { CompleteRecord, PendingRecord } from './idempotency.types';
import { IDEMPOTENT_METADATA } from './idempotent.decorator';

interface FakeRes {
  statusCode: number;
  status: jest.Mock;
  setHeader: jest.Mock;
}

function buildContext(opts: {
  decorated: boolean;
  headers?: Record<string, string>;
  user?: { id: string };
  body?: unknown;
  method?: string;
  originalUrl?: string;
}): { ctx: ExecutionContext; reflector: Reflector; res: FakeRes } {
  const res: FakeRes = {
    statusCode: 201,
    status: jest.fn().mockImplementation(function (this: FakeRes, code: number) {
      this.statusCode = code;
      return this;
    }),
    setHeader: jest.fn(),
  };
  const req = {
    headers: opts.headers ?? {},
    user: opts.user,
    body: opts.body ?? {},
    method: opts.method ?? 'POST',
    originalUrl: opts.originalUrl ?? '/api/v1/rentals',
    id: 'req-1',
  };
  const handler = (): void => undefined;
  const ctx = {
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
  const reflector = new Reflector();
  jest.spyOn(reflector, 'get').mockImplementation((meta) => {
    if (meta === IDEMPOTENT_METADATA) return opts.decorated;
    return undefined;
  });
  return { ctx, reflector, res };
}

describe('IdempotencyInterceptor', () => {
  let svc: jest.Mocked<IdempotencyService>;
  const validKey = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

  beforeEach(() => {
    svc = {
      buildRedisKey: jest.fn(),
      hashPayload: jest.fn(() => 'hash-1'),
      reserve: jest.fn(),
      complete: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IdempotencyService>;
  });

  it('passes through when handler lacks @Idempotent()', async () => {
    const { ctx, reflector } = buildContext({ decorated: false });
    const interceptor = new IdempotencyInterceptor(reflector, svc);
    const next = { handle: () => of('handler-result') };

    const result = await firstValueFrom(interceptor.intercept(ctx, next));
    expect(result).toBe('handler-result');
    expect(svc.reserve).not.toHaveBeenCalled();
  });

  it('rejects with IDEMPOTENCY_KEY_REQUIRED when header is missing', () => {
    const { ctx, reflector } = buildContext({
      decorated: true,
      user: { id: 'u1' },
      headers: {},
    });
    const interceptor = new IdempotencyInterceptor(reflector, svc);
    const next = { handle: () => of('x') };

    expect(() => interceptor.intercept(ctx, next)).toThrow(BadRequestException);
  });

  it('rejects with IDEMPOTENCY_KEY_INVALID when header is not a UUID v4', () => {
    const { ctx, reflector } = buildContext({
      decorated: true,
      user: { id: 'u1' },
      headers: { 'idempotency-key': 'not-a-uuid' },
    });
    const interceptor = new IdempotencyInterceptor(reflector, svc);
    const next = { handle: () => of('x') };

    expect(() => interceptor.intercept(ctx, next)).toThrow(BadRequestException);
  });

  it('rejects with IDEMPOTENCY_REQUIRES_AUTH when req.user is missing', () => {
    const { ctx, reflector } = buildContext({
      decorated: true,
      headers: { 'idempotency-key': validKey },
    });
    const interceptor = new IdempotencyInterceptor(reflector, svc);
    const next = { handle: () => of('x') };

    expect(() => interceptor.intercept(ctx, next)).toThrow(BadRequestException);
  });

  it('executes the handler and caches its response when reserved', async () => {
    svc.reserve.mockResolvedValue({ kind: 'reserved' });
    const { ctx, reflector } = buildContext({
      decorated: true,
      user: { id: 'u1' },
      headers: { 'idempotency-key': validKey },
      body: { foo: 'bar' },
    });
    const interceptor = new IdempotencyInterceptor(reflector, svc);
    const next = { handle: () => of({ rental: { id: 'r1' } }) };

    const result = await firstValueFrom(interceptor.intercept(ctx, next));

    expect(result).toEqual({ rental: { id: 'r1' } });
    expect(svc.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        method: 'POST',
        path: '/api/v1/rentals',
        key: validKey,
      }),
      'hash-1',
      201,
      { rental: { id: 'r1' } },
      'req-1',
    );
  });

  it('releases the reservation when the handler throws', async () => {
    svc.reserve.mockResolvedValue({ kind: 'reserved' });
    const { ctx, reflector } = buildContext({
      decorated: true,
      user: { id: 'u1' },
      headers: { 'idempotency-key': validKey },
    });
    const interceptor = new IdempotencyInterceptor(reflector, svc);
    const boom = new Error('handler exploded');
    const next = { handle: () => throwError(() => boom) };

    await expect(firstValueFrom(interceptor.intercept(ctx, next))).rejects.toBe(boom);
    expect(svc.release).toHaveBeenCalled();
    expect(svc.complete).not.toHaveBeenCalled();
  });

  it('replays the cached response on a repeat with identical payload', async () => {
    const cached: CompleteRecord = {
      status: 'complete',
      payloadHash: 'hash-1',
      statusCode: 201,
      body: { rental: { id: 'r1' } },
      completedAt: 0,
    };
    svc.reserve.mockResolvedValue({ kind: 'replay', record: cached });
    const { ctx, reflector, res } = buildContext({
      decorated: true,
      user: { id: 'u1' },
      headers: { 'idempotency-key': validKey },
    });
    const interceptor = new IdempotencyInterceptor(reflector, svc);
    const next = { handle: jest.fn(() => of('should-not-be-called')) };

    const result = await firstValueFrom(interceptor.intercept(ctx, next));

    expect(result).toEqual({ rental: { id: 'r1' } });
    expect(next.handle).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith('X-Idempotent-Replay', 'true');
  });

  it('throws IDEMPOTENCY_KEY_CONFLICT on payload mismatch', async () => {
    svc.reserve.mockResolvedValue({
      kind: 'conflict',
      record: {
        status: 'complete',
        payloadHash: 'other',
        statusCode: 201,
        body: {},
        completedAt: 0,
      },
    });
    const { ctx, reflector } = buildContext({
      decorated: true,
      user: { id: 'u1' },
      headers: { 'idempotency-key': validKey },
    });
    const interceptor = new IdempotencyInterceptor(reflector, svc);
    const next = { handle: () => of('x') };

    await expect(firstValueFrom(interceptor.intercept(ctx, next))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('throws IDEMPOTENCY_IN_PROGRESS when a concurrent request is in flight', async () => {
    const pending: PendingRecord = {
      status: 'pending',
      payloadHash: 'hash-1',
      reservedAt: Date.now(),
    };
    svc.reserve.mockResolvedValue({ kind: 'in_progress', record: pending });
    const { ctx, reflector } = buildContext({
      decorated: true,
      user: { id: 'u1' },
      headers: { 'idempotency-key': validKey },
    });
    const interceptor = new IdempotencyInterceptor(reflector, svc);
    const next = { handle: () => of('x') };

    await expect(firstValueFrom(interceptor.intercept(ctx, next))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
