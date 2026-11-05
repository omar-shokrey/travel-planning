import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import type {
  ErrorResponse,
  FieldError,
} from '../interfaces/error-response.interface';

const MONGO_DUPLICATE_KEY = 11000;

interface ErrorDetails {
  statusCode: number;
  message: string;
  errors?: FieldError[];
}

/**
 * Turns every exception into the same JSON body (see ErrorResponse), so the
 * frontend handles one error shape. Details of unexpected errors are logged
 * but never sent to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const { statusCode, message, errors } = this.describe(exception);

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.originalUrl}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponse = {
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Error',
      message,
      ...(errors ? { errors } : {}),
      path: request.originalUrl.split('?')[0],
      timestamp: new Date().toISOString(),
    };
    response.status(statusCode).json(body);
  }

  private describe(exception: unknown): ErrorDetails {
    if (exception instanceof HttpException) {
      return this.describeHttpException(exception);
    }
    if (this.isDuplicateKeyError(exception)) {
      const fields = Object.keys(exception.keyPattern ?? {});
      return {
        statusCode: HttpStatus.CONFLICT,
        message:
          fields.length > 0
            ? `A record with this ${fields.join(', ')} already exists`
            : 'A record with this value already exists',
      };
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }

  private describeHttpException(exception: HttpException): ErrorDetails {
    const statusCode = exception.getStatus();
    const payload = exception.getResponse();
    if (typeof payload === 'string') {
      return { statusCode, message: payload };
    }

    const { message, errors } = payload as {
      message?: string | string[];
      errors?: FieldError[];
    };
    return {
      statusCode,
      message: Array.isArray(message)
        ? message.join('; ')
        : (message ?? exception.message),
      ...(errors ? { errors } : {}),
    };
  }

  /** MongoDB error E11000: a unique index (such as the account email) was violated. */
  private isDuplicateKeyError(
    exception: unknown,
  ): exception is { code: number; keyPattern?: Record<string, unknown> } {
    return (
      typeof exception === 'object' &&
      exception !== null &&
      (exception as { code?: unknown }).code === MONGO_DUPLICATE_KEY
    );
  }
}
