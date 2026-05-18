import { randomUUID } from 'crypto';

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

const HTTP_STATUS_TO_CODE: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  410: 'GONE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
};

interface CustomPayload {
  code?: string;
  message?: string;
  details?: unknown;
}

function readCustomPayload(exception: HttpException): CustomPayload {
  const response = exception.getResponse();
  if (typeof response !== 'object') {
    return {};
  }
  const record = response as Record<string, unknown>;
  const payload: CustomPayload = {};
  if (typeof record.code === 'string') {
    payload.code = record.code;
  }
  if (typeof record.message === 'string') {
    payload.message = record.message;
  }
  if ('details' in record) {
    payload.details = record.details;
  }
  return payload;
}

@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();

    let statusCode: number;
    let code: string;
    let message: string;
    let details: unknown = undefined;

    if (exception instanceof ZodError) {
      statusCode = HttpStatus.BAD_REQUEST;
      code = 'VALIDATION_ERROR';
      message = 'Validation failed';
      details = exception.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
      this.logger.warn({ requestId, code, details }, 'Validation error');
    } else if (exception instanceof UnauthorizedException) {
      statusCode = HttpStatus.UNAUTHORIZED;
      const custom = readCustomPayload(exception);
      code = custom.code ?? 'UNAUTHORIZED';
      message = custom.message ?? (exception.message || 'Unauthorized');
      details = custom.details;
      this.logger.warn({ requestId, code }, 'Unauthorized request');
    } else if (exception instanceof ForbiddenException) {
      statusCode = HttpStatus.FORBIDDEN;
      const custom = readCustomPayload(exception);
      code = custom.code ?? 'FORBIDDEN';
      message = custom.message ?? (exception.message || 'Forbidden');
      details = custom.details;
      this.logger.warn({ requestId, code }, 'Forbidden request');
    } else if (exception instanceof NotFoundException) {
      statusCode = HttpStatus.NOT_FOUND;
      const custom = readCustomPayload(exception);
      code = custom.code ?? 'NOT_FOUND';
      message = custom.message ?? (exception.message || 'Resource not found');
      details = custom.details;
      this.logger.warn({ requestId, code }, 'Not found');
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const custom = readCustomPayload(exception);
      code = custom.code ?? HTTP_STATUS_TO_CODE[statusCode] ?? `HTTP_${String(statusCode)}`;
      message = custom.message ?? exception.message;
      details = custom.details;
      this.logger.warn({ requestId, code, statusCode }, 'HTTP exception');
    } else {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      code = 'INTERNAL_ERROR';
      message = 'An unexpected error occurred';
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error({ requestId, code, stack }, 'Unhandled exception');
    }

    const envelope = {
      data: null,
      meta: {
        request_id: requestId,
        timestamp: new Date().toISOString(),
      },
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    };

    res.status(statusCode).json(envelope);
  }
}
