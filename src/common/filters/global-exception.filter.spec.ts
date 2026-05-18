import {
  type ArgumentsHost,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { type z, ZodError } from 'zod';

import { GlobalExceptionFilter } from './global-exception.filter';

interface ResponseEnvelope {
  data: null;
  meta: { request_id: string; timestamp: string };
  error: { code: string; message: string; details?: unknown };
}

interface MockHost {
  host: ArgumentsHost;
  status: jest.Mock;
  json: jest.Mock;
}

function makeHost(requestHeaders: Record<string, string> = {}): MockHost {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const req = { headers: requestHeaders, ip: '127.0.0.1' };
  const res = { status };
  const host = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

function envelopeFrom(json: jest.Mock): ResponseEnvelope {
  const calls = json.mock.calls as unknown[][];
  return calls[0]?.[0] as ResponseEnvelope;
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
  });

  describe('custom payload preservation', () => {
    it('preserves custom code from ConflictException payload', () => {
      const { host, status, json } = makeHost();

      filter.catch(
        new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'Email already registered',
        }),
        host,
      );

      expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(envelopeFrom(json).error.code).toBe('EMAIL_ALREADY_REGISTERED');
      expect(envelopeFrom(json).error.message).toBe('Email already registered');
    });

    it('preserves custom code from UnauthorizedException payload', () => {
      const { host, status, json } = makeHost();

      filter.catch(
        new UnauthorizedException({
          code: 'USER_NOT_VERIFIED',
          message: 'Verify your email first',
        }),
        host,
      );

      expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(envelopeFrom(json).error.code).toBe('USER_NOT_VERIFIED');
    });

    it('preserves custom code from ForbiddenException payload', () => {
      const { host, json } = makeHost();

      filter.catch(
        new ForbiddenException({ code: 'OWNERSHIP_REQUIRED', message: 'Not yours' }),
        host,
      );

      expect(envelopeFrom(json).error.code).toBe('OWNERSHIP_REQUIRED');
    });

    it('preserves custom code from NotFoundException payload', () => {
      const { host, json } = makeHost();

      filter.catch(
        new NotFoundException({ code: 'STATION_NOT_FOUND', message: 'Station missing' }),
        host,
      );

      expect(envelopeFrom(json).error.code).toBe('STATION_NOT_FOUND');
    });

    it('preserves custom code from generic HttpException payload', () => {
      const { host, json } = makeHost();

      filter.catch(
        new HttpException(
          { code: 'TOKEN_INVALID', message: 'Code expired' },
          HttpStatus.BAD_REQUEST,
        ),
        host,
      );

      expect(envelopeFrom(json).error.code).toBe('TOKEN_INVALID');
      expect(envelopeFrom(json).error.message).toBe('Code expired');
    });

    it('preserves custom details from payload when provided', () => {
      const { host, json } = makeHost();

      filter.catch(
        new ConflictException({
          code: 'EMAIL_ALREADY_EXISTS',
          message: 'Already exists',
          details: { requiresMerge: true },
        }),
        host,
      );

      expect(envelopeFrom(json).error.details).toEqual({ requiresMerge: true });
    });
  });

  describe('default code mapping (no custom payload)', () => {
    it('UnauthorizedException without payload → 401 UNAUTHORIZED', () => {
      const { host, status, json } = makeHost();

      filter.catch(new UnauthorizedException('Bad creds'), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(envelopeFrom(json).error.code).toBe('UNAUTHORIZED');
    });

    it('ForbiddenException without payload → 403 FORBIDDEN', () => {
      const { host, status, json } = makeHost();

      filter.catch(new ForbiddenException('Nope'), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      expect(envelopeFrom(json).error.code).toBe('FORBIDDEN');
    });

    it('NotFoundException without payload → 404 NOT_FOUND', () => {
      const { host, status, json } = makeHost();

      filter.catch(new NotFoundException('Missing'), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(envelopeFrom(json).error.code).toBe('NOT_FOUND');
    });

    it('generic HttpException without payload → status-mapped code', () => {
      const { host, status, json } = makeHost();

      filter.catch(new HttpException('Too many', HttpStatus.TOO_MANY_REQUESTS), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
      expect(envelopeFrom(json).error.code).toBe('TOO_MANY_REQUESTS');
    });
  });

  describe('ZodError', () => {
    it('returns 400 VALIDATION_ERROR with formatted details', () => {
      const { host, status, json } = makeHost();
      const issues: z.core.$ZodIssue[] = [
        {
          code: 'invalid_type',
          path: ['email'],
          message: 'Required',
          expected: 'string',
        } as unknown as z.core.$ZodIssue,
      ];

      filter.catch(new ZodError(issues), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(envelopeFrom(json).error.code).toBe('VALIDATION_ERROR');
      expect(envelopeFrom(json).error.details).toBeDefined();
    });
  });

  describe('unknown exception', () => {
    it('returns 500 INTERNAL_ERROR for unrecognized errors', () => {
      const { host, status, json } = makeHost();

      filter.catch(new Error('boom'), host);

      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(envelopeFrom(json).error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('envelope structure', () => {
    it('returns { data: null, meta: { request_id, timestamp }, error } for all errors', () => {
      const { host, json } = makeHost();

      filter.catch(new UnauthorizedException(), host);

      const envelope = envelopeFrom(json);
      expect(envelope.data).toBeNull();
      expect(envelope.meta.request_id).toBeDefined();
      expect(envelope.meta.timestamp).toBeDefined();
      expect(envelope.error).toBeDefined();
    });

    it('uses x-request-id header when present in request', () => {
      const { host, json } = makeHost({ 'x-request-id': 'req-abc-123' });

      filter.catch(new UnauthorizedException(), host);

      expect(envelopeFrom(json).meta.request_id).toBe('req-abc-123');
    });
  });
});
