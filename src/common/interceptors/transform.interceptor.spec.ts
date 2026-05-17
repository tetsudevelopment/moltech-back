import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { of } from 'rxjs';

import { TransformInterceptor } from './transform.interceptor';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function makeContext(requestId: string | undefined, skipEnvelope = false): ExecutionContext {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(skipEnvelope);

  const req: Partial<Request & { id?: string }> = { id: requestId };

  const context: Partial<ExecutionContext> = {
    getHandler: jest.fn().mockReturnValue({}),
    getClass: jest.fn().mockReturnValue({}),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(req),
    }),
  };

  return context as ExecutionContext;
}

function makeHandler<T>(value: T): CallHandler<T> {
  return { handle: () => of(value) };
}

function collectValue<T>(
  interceptor: TransformInterceptor,
  context: ExecutionContext,
  handler: CallHandler,
): Promise<T> {
  return new Promise((resolve, reject) => {
    interceptor
      .intercept(context, handler)
      .subscribe({ next: resolve as (v: unknown) => void, error: reject });
  });
}

describe('TransformInterceptor', () => {
  let reflector: Reflector;
  let interceptor: TransformInterceptor;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new TransformInterceptor(reflector);
  });

  describe('success envelope wrapping', () => {
    it('wraps a plain object into {data, meta, error: null}', async () => {
      const requestId = '550e8400-e29b-41d4-a716-446655440000';
      const context = makeContext(requestId);
      const handler = makeHandler({ foo: 'bar' });

      const result = await collectValue<{
        data: unknown;
        meta: { request_id: string; timestamp: string };
        error: null;
      }>(interceptor, context, handler);

      expect(result.data).toEqual({ foo: 'bar' });
      expect(result.error).toBeNull();
      expect(result.meta.request_id).toBe(requestId);
      expect(result.meta.timestamp).toMatch(ISO_REGEX);
    });

    it('uses req.id from RequestIdMiddleware as meta.request_id', async () => {
      const requestId = 'aaaabbbb-cccc-4ddd-eeee-ffffaaaabbbb';
      const context = makeContext(requestId);
      const handler = makeHandler({ value: 1 });

      const result = await collectValue<{
        meta: { request_id: string; timestamp: string };
      }>(interceptor, context, handler);

      expect(result.meta.request_id).toBe(requestId);
    });

    it('generates a fresh UUID if req.id is missing (defensive)', async () => {
      const context = makeContext(undefined);
      const handler = makeHandler({ value: 1 });

      const result = await collectValue<{
        meta: { request_id: string; timestamp: string };
      }>(interceptor, context, handler);

      expect(result.meta.request_id).toMatch(UUID_REGEX);
    });

    it('meta.timestamp is an ISO 8601 string', async () => {
      const context = makeContext('any-id');
      const handler = makeHandler({});

      const result = await collectValue<{
        meta: { request_id: string; timestamp: string };
      }>(interceptor, context, handler);

      expect(result.meta.timestamp).toMatch(ISO_REGEX);
    });

    it('wraps undefined controller return (204 No Content) as data: null', async () => {
      const context = makeContext('any-id');
      const handler = makeHandler(undefined);

      const result = await collectValue<{ data: unknown }>(interceptor, context, handler);

      expect(result.data).toBeNull();
    });
  });

  describe('SkipEnvelope decorator', () => {
    it('passes through response unchanged when handler has @SkipEnvelope()', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      const rawResponse = { status: 'ok' };
      const context = makeContext('any-id', true);
      const handler = makeHandler(rawResponse);

      const result = await collectValue<unknown>(interceptor, context, handler);

      expect(result).toBe(rawResponse);
    });

    it('calls reflector with SKIP_ENVELOPE_KEY to detect the decorator', () => {
      const reflectorSpy = jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const context = makeContext('any-id');
      const handler = makeHandler({});

      interceptor.intercept(context, handler).subscribe({ next: jest.fn() });

      expect(reflectorSpy).toHaveBeenCalledWith(SKIP_ENVELOPE_KEY, expect.any(Array));
    });
  });

  describe('idempotency — pre-wrapped envelopes', () => {
    it('passes through an already-wrapped envelope unchanged', async () => {
      const alreadyWrapped = {
        data: { id: '1' },
        meta: { request_id: 'existing-id', timestamp: '2026-01-01T00:00:00.000Z' },
        error: null,
      };
      const context = makeContext('any-id');
      const handler = makeHandler(alreadyWrapped);

      const result = await collectValue<unknown>(interceptor, context, handler);

      expect(result).toBe(alreadyWrapped);
    });

    it('wraps a response that has only some envelope keys (not all three)', async () => {
      const partialEnvelope = { data: { id: '1' }, meta: {} };
      const context = makeContext('any-id');
      const handler = makeHandler(partialEnvelope);

      const result = await collectValue<{ data: unknown; error: null }>(
        interceptor,
        context,
        handler,
      );

      expect(result.data).toBe(partialEnvelope);
      expect(result.error).toBeNull();
    });
  });
});
