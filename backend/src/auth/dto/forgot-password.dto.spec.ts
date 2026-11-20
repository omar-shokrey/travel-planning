import { ValidationPipe } from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { ForgotPasswordDto } from './forgot-password.dto';

// The same options as the global pipe in app.setup.ts, its error shape too.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});

const run = async (body: unknown) => {
  try {
    const value = (await pipe.transform(body, {
      type: 'body',
      metatype: ForgotPasswordDto,
    })) as ForgotPasswordDto;
    return { value, messages: [] as string[] };
  } catch (error) {
    const { errors } = (error as { response: { errors: FieldError[] } })
      .response;
    return {
      value: undefined,
      messages: errors.flatMap((fieldError) => fieldError.messages),
    };
  }
};

describe('ForgotPasswordDto (ACC-07)', () => {
  it('trims and lowercases the email, as login does', async () => {
    expect((await run({ email: '  Sara@Example.COM ' })).value?.email).toBe(
      'sara@example.com',
    );
  });

  it.each([
    ['no email', {}],
    ['an email that is not an email', { email: 'not-an-email' }],
    ['an email that is not a text', { email: 42 }],
  ])('refuses %s', async (_label, body) => {
    expect((await run(body)).messages).toContain('email must be an email');
  });

  it('refuses another field', async () => {
    expect(
      (await run({ email: 'sara@example.com', role: 'admin' })).messages,
    ).toContain('property role should not exist');
  });
});
