import {
  type ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { EXCEPTION_FILTERS_METADATA } from '@nestjs/common/constants';
import { AuthController } from '../auth.controller';
import { QueryFreeExceptionsFilter } from './query-free-exceptions.filter';

const TOKEN = 'q3Zf8kV1uX9cLr0bT2mN7pQwYh5sJd4eAiOgKl6zRvE';

function hostFor(url: string) {
  const request = { method: 'GET', originalUrl: url };
  const json = jest.fn();
  const response = { status: jest.fn(() => ({ json })) };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, response, json };
}

describe('QueryFreeExceptionsFilter (ACC-02)', () => {
  let logged: jest.SpyInstance;
  beforeEach(() => {
    logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => logged.mockRestore());

  it('logs an unexpected error with the path only, never the token of the query', () => {
    const { host, response, json } = hostFor(
      `/api/auth/verify-email?token=${TOKEN}`,
    );

    new QueryFreeExceptionsFilter().catch(new Error('database down'), host);

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][0]).toBe('GET /api/auth/verify-email');
    expect(JSON.stringify(logged.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(json.mock.calls)).not.toContain(TOKEN);
  });

  it('answers a 400 with the same body as the global filter, and logs nothing', () => {
    const { host, json } = hostFor(`/api/auth/verify-email?token=${TOKEN}`);

    new QueryFreeExceptionsFilter().catch(
      new BadRequestException(
        'The verification link is invalid or has expired',
      ),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      error: 'Bad Request',
      message: 'The verification link is invalid or has expired',
      path: '/api/auth/verify-email',
      timestamp: expect.any(String),
    });
    expect(logged).not.toHaveBeenCalled();
  });

  it('is set on GET /api/auth/verify-email', () => {
    expect(
      Reflect.getMetadata(
        EXCEPTION_FILTERS_METADATA,
        AuthController.prototype.verifyEmail,
      ),
    ).toEqual([QueryFreeExceptionsFilter]);
  });
});
