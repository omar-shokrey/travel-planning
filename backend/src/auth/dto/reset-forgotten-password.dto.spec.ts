import { ValidationPipe } from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { ResetForgottenPasswordDto } from './reset-forgotten-password.dto';

// The same options as the global pipe in app.setup.ts, its error shape too.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});

const TOKEN = 'q3Zf8kV1uX9cLr0bT2mN7pQwYh5sJd4eAiOgKl6zRvE';
const RULE =
  'newPassword must be at least 8 characters and include a letter and a digit';

const run = async (body: unknown) => {
  try {
    await pipe.transform(body, {
      type: 'body',
      metatype: ResetForgottenPasswordDto,
    });
    return [] as string[];
  } catch (error) {
    const { errors } = (error as { response: { errors: FieldError[] } })
      .response;
    return errors.flatMap((fieldError) => fieldError.messages);
  }
};

describe('ResetForgottenPasswordDto (ACC-07)', () => {
  it.each([
    ['8 characters with a letter and a digit', 'Passw0rd'],
    ['72 characters', `a1${'b'.repeat(70)}`],
    ['letters of another alphabet', 'كلمةسر123'],
  ])('accepts a new password of %s', async (_label, newPassword) => {
    expect(await run({ token: TOKEN, newPassword })).toEqual([]);
  });

  it.each([
    ['7 characters', 'Passw0r', RULE],
    ['no digit', 'Password', RULE],
    ['no letter', '12345678', RULE],
    [
      '73 characters',
      `a1${'b'.repeat(71)}`,
      'newPassword must be shorter than or equal to 72 characters',
    ],
    ['no new password', undefined, RULE],
    [
      'a new password that is not a text',
      12345678,
      'newPassword must be a string',
    ],
  ])('refuses a new password with %s', async (_label, newPassword, message) => {
    expect(await run({ token: TOKEN, newPassword })).toContain(message);
  });

  it.each([
    ['no token', {}, 'token is required'],
    ['an empty token', { token: '' }, 'token is required'],
    [
      'a token of 129 characters',
      { token: 'a'.repeat(129) },
      'token must have at most 128 characters',
    ],
    ['a token that is not a text', { token: 7 }, 'token must be a text'],
  ])('refuses %s', async (_label, fields, message) => {
    expect(await run({ newPassword: 'Passw0rdOK', ...fields })).toContain(
      message,
    );
  });

  it('refuses another field', async () => {
    expect(
      await run({ token: TOKEN, newPassword: 'Passw0rdOK', userId: 'x' }),
    ).toContain('property userId should not exist');
  });
});
