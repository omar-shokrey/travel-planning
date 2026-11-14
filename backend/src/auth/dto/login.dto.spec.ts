import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { PASSWORD_MAX_LENGTH } from '../auth.constants';
import { LoginDto } from './login.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = { type: 'body', metatype: LoginDto };

const valid = { email: 'sara@example.com', password: 'Passw0rdOK' };

const parse = (body: Record<string, unknown>): Promise<LoginDto> =>
  pipe.transform(body, metadata) as Promise<LoginDto>;

/** The field errors the pipe answers with. Empty when the body is valid. */
async function errorsOf(body: Record<string, unknown>): Promise<FieldError[]> {
  try {
    await parse(body);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) {
      throw error;
    }
    return (error.getResponse() as { errors: FieldError[] }).errors;
  }
}

const invalidFields = async (
  body: Record<string, unknown>,
): Promise<string[]> => (await errorsOf(body)).map(({ field }) => field).sort();

describe('LoginDto (ACC-04)', () => {
  it('accepts an email and a password', async () => {
    const dto = await parse(valid);

    expect(dto).toBeInstanceOf(LoginDto);
    expect(dto).toEqual(valid);
  });

  it('trims and lowercases the email', async () => {
    const dto = await parse({ ...valid, email: '  Sara@Example.COM ' });

    expect(dto.email).toBe('sara@example.com');
  });

  it('keeps the password exactly as it was typed', async () => {
    const dto = await parse({ ...valid, password: '  Pass w0rd  ' });

    expect(dto.password).toBe('  Pass w0rd  ');
  });

  it('does not apply the password rule of registration', async () => {
    // A wrong password gets the generic message at login, never a hint about the rule.
    expect(await invalidFields({ ...valid, password: 'abc' })).toEqual([]);
  });

  it.each([
    ['an email that is not an email', { ...valid, email: 'nope' }, ['email']],
    ['no email', { password: valid.password }, ['email']],
    ['an email that is not a text', { ...valid, email: 42 }, ['email']],
    ['no password', { email: valid.email }, ['password']],
    ['an empty password', { ...valid, password: '' }, ['password']],
    [
      'a password that is not a text',
      { ...valid, password: 12345678 },
      ['password'],
    ],
    [
      'a password longer than the limit',
      { ...valid, password: 'a1'.repeat(PASSWORD_MAX_LENGTH) },
      ['password'],
    ],
    ['no body', {}, ['email', 'password']],
  ] as [string, Record<string, unknown>, string[]][])(
    'rejects %s',
    async (_name, body, fields) => {
      expect(await invalidFields(body)).toEqual(fields);
    },
  );

  it('rejects a field the client may not send', async () => {
    expect(await invalidFields({ ...valid, role: 'admin' })).toEqual(['role']);
    expect(await invalidFields({ ...valid, status: 'active' })).toEqual([
      'status',
    ]);
  });
});
