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
import { randomUUID } from 'crypto';

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
      code = 'UNAUTHORIZED';
      message = exception.message || 'Unauthorized';
      this.logger.warn({ requestId, code }, 'Unauthorized request');
    } else if (exception instanceof ForbiddenException) {
      statusCode = HttpStatus.FORBIDDEN;
      code = 'FORBIDDEN';
      message = exception.message || 'Forbidden';
      this.logger.warn({ requestId, code }, 'Forbidden request');
    } else if (exception instanceof NotFoundException) {
      statusCode = HttpStatus.NOT_FOUND;
      code = 'NOT_FOUND';
      message = exception.message || 'Resource not found';
      this.logger.warn({ requestId, code }, 'Not found');
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      code = HTTP_STATUS_TO_CODE[statusCode] ?? `HTTP_${statusCode}`;
      message = exception.message;
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
