import {
  type ArgumentsHost,
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Mongoose, Schema } from 'mongoose';
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

/**
 * A real Mongoose ValidationError, made the way a save makes it: a document
 * that breaks its schema, validated without any database.
 */
async function mongooseValidationError(): Promise<unknown> {
  const mongoose = new Mongoose();
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  const Thing = mongoose.model(
    'Thing',
    new Schema({
      name: { type: String, required: true },
      starClass: { type: Number, min: 1, max: 5 },
      address: { line: { type: String, required: true } },
    }),
  );
  return new Thing({ starClass: 9, address: {} }).validate().then(
    () => {
      throw new Error('The document was expected to be invalid');
    },
    (error: unknown) => error,
  );
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

  it('answers a Mongoose ValidationError with 400 and the usual field errors, not 500', async () => {
    const { statusCode, body } = handle(await mongooseValidationError());

    expect(statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(body.message).toBe('Validation failed');
    expect(body.errors?.map(({ field }) => field)).toEqual([
      'address.line',
      'name',
      'starClass',
    ]);
    for (const fieldError of body.errors ?? []) {
      expect(fieldError.messages).toHaveLength(1);
      expect(fieldError.messages[0]).toEqual(expect.any(String));
    }
    expect(
      body.errors?.find(({ field }) => field === 'name')?.messages,
    ).toEqual(['Path `name` is required.']);
  });

  it('does not log a Mongoose ValidationError as a server error', async () => {
    handle(await mongooseValidationError());

    expect(logError).not.toHaveBeenCalled();
  });

  it('still answers 500 for an error that only looks like a validation error', () => {
    const lookalike = Object.assign(new Error('Validation failed'), {
      name: 'ValidationError',
      errors: { name: { message: 'x' } },
    });

    expect(handle(lookalike).statusCode).toBe(500);
  });
});
