import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { RequestTimeoutException } from '@nestjs/common';
import { delay, type Observable, of, throwError } from 'rxjs';

import { TimeoutInterceptor } from './timeout.interceptor';

function makeContext(): ExecutionContext {
  return {} as ExecutionContext;
}

function makeHandler<T>(obs: Observable<T>): CallHandler<T> {
  return { handle: () => obs };
}

function collectValue<T>(interceptor: TimeoutInterceptor, handler: CallHandler): Promise<T> {
  return new Promise((resolve, reject) => {
    interceptor
      .intercept(makeContext(), handler)
      .subscribe({ next: resolve as (v: unknown) => void, error: reject });
  });
}

describe('TimeoutInterceptor', () => {
  describe('with default 10s timeout', () => {
    it('passes through a fast response unchanged', async () => {
      const interceptor = new TimeoutInterceptor(200);
      const handler = makeHandler(of({ ok: true }).pipe(delay(0)));

      const result = await collectValue<{ ok: boolean }>(interceptor, handler);

      expect(result).toEqual({ ok: true });
    });

    it('passes through a string value unchanged', async () => {
      const interceptor = new TimeoutInterceptor(200);
      const handler = makeHandler(of('hello').pipe(delay(0)));

      const result = await collectValue<string>(interceptor, handler);

      expect(result).toBe('hello');
    });

    it('passes through null value unchanged', async () => {
      const interceptor = new TimeoutInterceptor(200);
      const handler = makeHandler(of(null).pipe(delay(0)));

      const result = await collectValue<null>(interceptor, handler);

      expect(result).toBeNull();
    });
  });

  describe('timeout behavior', () => {
    it('throws RequestTimeoutException when handler exceeds the configured timeout', async () => {
      const interceptor = new TimeoutInterceptor(50);
      const handler = makeHandler(of({ ok: true }).pipe(delay(200)));

      await expect(collectValue(interceptor, handler)).rejects.toBeInstanceOf(
        RequestTimeoutException,
      );
    });

    it('thrown RequestTimeoutException has status 408', async () => {
      const interceptor = new TimeoutInterceptor(50);
      const handler = makeHandler(of({}).pipe(delay(200)));

      try {
        await collectValue(interceptor, handler);
        fail('Expected RequestTimeoutException');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(RequestTimeoutException);
        expect((err as RequestTimeoutException).getStatus()).toBe(408);
      }
    });

    it('thrown RequestTimeoutException message is "Request timed out"', async () => {
      const interceptor = new TimeoutInterceptor(50);
      const handler = makeHandler(of({}).pipe(delay(200)));

      try {
        await collectValue(interceptor, handler);
        fail('Expected RequestTimeoutException');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(RequestTimeoutException);
        expect((err as RequestTimeoutException).message).toBe('Request timed out');
      }
    });

    it('completes before timeout does not throw', async () => {
      const interceptor = new TimeoutInterceptor(300);
      const handler = makeHandler(of({ data: 42 }).pipe(delay(50)));

      const result = await collectValue<{ data: number }>(interceptor, handler);

      expect(result).toEqual({ data: 42 });
    });
  });

  describe('non-timeout errors', () => {
    it('re-throws non-timeout errors unchanged', async () => {
      const interceptor = new TimeoutInterceptor(200);
      const domainError = new Error('Some domain error');
      const handler: CallHandler = {
        handle: () => throwError(() => domainError),
      };

      await expect(collectValue(interceptor, handler)).rejects.toBe(domainError);
    });

    it('re-throws HttpException instances unchanged', async () => {
      const interceptor = new TimeoutInterceptor(200);
      const httpError = new RequestTimeoutException('custom 408');
      const handler: CallHandler = {
        handle: () => throwError(() => httpError),
      };

      const caught = await collectValue(interceptor, handler).catch((e: unknown) => e);

      expect(caught).toBe(httpError);
    });
  });

  describe('constructor defaults', () => {
    it('uses 10000ms when no timeout is provided', () => {
      const interceptor = new TimeoutInterceptor();
      expect(interceptor).toBeInstanceOf(TimeoutInterceptor);
    });
  });
});
