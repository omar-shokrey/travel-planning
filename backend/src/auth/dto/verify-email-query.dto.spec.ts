import { ValidationPipe } from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { VerifyEmailQueryDto } from './verify-email-query.dto';

// The same options as the global pipe in app.setup.ts, its error shape too.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});

const run = async (query: unknown) => {
  try {
    await pipe.transform(query, {
      type: 'query',
      metatype: VerifyEmailQueryDto,
    });
    return [] as string[];
  } catch (error) {
    const { errors } = (error as { response: { errors: FieldError[] } })
      .response;
    return errors.flatMap((fieldError) => fieldError.messages);
  }
};

describe('VerifyEmailQueryDto (ACC-02)', () => {
  it.each([
    [
      'a real token of 43 characters',
      'q3Zf8kV1uX9cLr0bT2mN7pQwYh5sJd4eAiOgKl6zRvE',
    ],
    ['a token of 128 characters', 'a'.repeat(128)],
  ])('accepts %s', async (_label, token) => {
    expect(await run({ token })).toEqual([]);
  });

  it.each([
    ['no token', {}, 'token is required'],
    ['an empty token', { token: '' }, 'token is required'],
    [
      'a token of 129 characters',
      { token: 'a'.repeat(129) },
      'token must have at most 128 characters',
    ],
    ['a token sent twice', { token: ['a', 'b'] }, 'token must be a text'],
    [
      'another query parameter',
      { token: 'abc', email: 'sara@example.com' },
      'property email should not exist',
    ],
  ])('refuses %s', async (_label, query, message) => {
    expect(await run(query)).toContain(message);
  });
});
