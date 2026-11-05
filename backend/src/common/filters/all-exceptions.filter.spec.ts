import {
  type ArgumentsHost,
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ErrorResponse } from '../interfaces/error-response.interface';
import { validationExceptionFactory } from '../pipes/validation-exception.factory';
import { AllExceptionsFilter } from './all-exceptions.filter';

function handle(exception: unknown, url = '/api/flights?page=2') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', originalUrl: url }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);

  return {
    statusCode: status.mock.calls[0][0] as number,
    body: json.mock.calls[0][0] as ErrorResponse,
  };
}

describe('AllExceptionsFilter', () => {
  let logError: jest.SpyInstance;

  beforeEach(() => {
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('formats an HTTP exception and drops the query string from the path', () => {
    const { statusCode, body } = handle(
      new NotFoundException('No such flight'),
    );

    expect(statusCode).toBe(404);
    expect(body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      message: 'No such flight',
      path: '/api/flights',
    });
    expect(body).not.toHaveProperty('errors');
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    expect(logError).not.toHaveBeenCalled();
  });

  it('keeps the field errors of a validation failure', () => {
    const exception = validationExceptionFactory([
      { property: 'email', constraints: { isEmail: 'email must be an email' } },
    ]);

    const { statusCode, body } = handle(exception);

    expect(statusCode).toBe(400);
    expect(body.message).toBe('Validation failed');
    expect(body.errors).toEqual([
      { field: 'email', messages: ['email must be an email'] },
    ]);
  });

  it('joins a list of messages into one', () => {
    const { body } = handle(new BadRequestException(['first', 'second']));
    expect(body.message).toBe('first; second');
  });

  it('accepts an exception that carries a plain string', () => {
    const { statusCode, body } = handle(new HttpException('Slow down', 429));
    expect(statusCode).toBe(429);
    expect(body.error).toBe('Too Many Requests');
    expect(body.message).toBe('Slow down');
  });

  it('turns a MongoDB duplicate key error into 409 without leaking details', () => {
    const duplicate = Object.assign(
      new Error('E11000 duplicate key error ... { email: "a@b.com" }'),
      { code: 11000, keyPattern: { email: 1 } },
    );

    const { statusCode, body } = handle(duplicate);

    expect(statusCode).toBe(409);
    expect(body.error).toBe('Conflict');
    expect(body.message).toBe('A record with this email already exists');
    expect(logError).not.toHaveBeenCalled();
  });

  it.each([new Error('connection string mongodb://user:secret@host'), 'boom'])(
    'hides the details of an unexpected error and logs it',
    (unexpected) => {
      const { statusCode, body } = handle(unexpected);

      expect(statusCode).toBe(500);
      expect(body.error).toBe('Internal Server Error');
      expect(body.message).toBe('Internal server error');
      expect(logError).toHaveBeenCalledTimes(1);
    },
  );
});
