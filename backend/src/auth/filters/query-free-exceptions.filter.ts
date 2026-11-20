import { type ArgumentsHost, Catch } from '@nestjs/common';
import type { Request } from 'express';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';

/**
 * ACC-02: the global `AllExceptionsFilter` logs the method and the URL of
 * every 5xx, query string included. On a route whose query holds a one-time
 * token (`GET /api/auth/verify-email?token=…`) that would write a working
 * link to the log. This filter, set on such a route only, drops the query
 * from the request URL and then answers exactly like the global filter: the
 * same error body, the same log line without the token.
 */
@Catch()
export class QueryFreeExceptionsFilter extends AllExceptionsFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    request.originalUrl = request.originalUrl.split('?')[0];
    super.catch(exception, host);
  }
}
