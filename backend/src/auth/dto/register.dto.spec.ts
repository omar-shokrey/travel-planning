import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { PASSWORD_RULE } from '../../common/constants/password';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { USER_NAME_MAX_LENGTH } from '../../users/users.constants';
import { CONSENT_REQUIRED_MESSAGE } from '../auth.constants';
import { RegisterDto } from './register.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = { type: 'body', metatype: RegisterDto };

const valid = {
  name: 'Sara Ahmed',
  email: 'sara@example.com',
  password: 'Passw0rdOK',
  acceptedTerms: true,
};

const parse = (body: Record<string, unknown>): Promise<RegisterDto> =>
  pipe.transform(body, metadata) as Promise<RegisterDto>;

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

describe('RegisterDto (ACC-01)', () => {
  it('accepts a name, an email, a valid password and the consent', async () => {
    const dto = await parse(valid);

    expect(dto).toBeInstanceOf(RegisterDto);
    expect(dto).toEqual(valid);
  });

  it('trims the name, and trims and lowercases the email', async () => {
    const dto = await parse({
      ...valid,
      name: '  Sara Ahmed ',
      email: '  Sara@Example.COM ',
    });

    expect(dto.name).toBe('Sara Ahmed');
    expect(dto.email).toBe('sara@example.com');
  });

  it('accepts a password whose letters are not Latin', async () => {
    // Six Arabic letters and three digits.
    const password = 'كلمةسر123';

    expect(await invalidFields({ ...valid, password })).toEqual([]);
  });

  it.each([
    ['is shorter than 8 characters', 'Passw0r'],
    ['has no digit', 'PasswordOnly'],
    ['has no letter', '1234567890'],
    ['is longer than 72 characters', 'Passw0rd'.repeat(10)],
    ['is not a string', 12345678],
    ['is missing', undefined],
  ])('rejects a password that %s', async (_case, password) => {
    expect(await invalidFields({ ...valid, password })).toEqual(['password']);
  });

  it('explains the password rule in the error message (GEN-02)', async () => {
    expect(await errorsOf({ ...valid, password: 'weakpass' })).toEqual([
      { field: 'password', messages: [`password ${PASSWORD_RULE}`] },
    ]);
  });

  it.each(['not-an-email', 'sara@', '@example.com', '', undefined])(
    'rejects the email %j',
    async (email) => {
      expect(await invalidFields({ ...valid, email })).toEqual(['email']);
    },
  );

  it.each([
    ['is empty', ''],
    ['is only spaces', '   '],
    ['is longer than 100 characters', 'x'.repeat(USER_NAME_MAX_LENGTH + 1)],
    ['is not a string', 42],
    ['is missing', undefined],
  ])('rejects a name that %s', async (_case, name) => {
    expect(await invalidFields({ ...valid, name })).toEqual(['name']);
  });

  it.each([false, undefined, null, 'true', 1])(
    'rejects the consent %j with one clear message',
    async (acceptedTerms) => {
      expect(await errorsOf({ ...valid, acceptedTerms })).toEqual([
        { field: 'acceptedTerms', messages: [CONSENT_REQUIRED_MESSAGE] },
      ]);
    },
  );

  it.each(['role', 'status', 'passwordHash', 'consentAcceptedAt'])(
    'rejects the server-controlled field %s',
    async (field) => {
      expect(await invalidFields({ ...valid, [field]: 'admin' })).toEqual([
        field,
      ]);
    },
  );

  it('reports every invalid field at once', async () => {
    expect(await invalidFields({})).toEqual([
      'acceptedTerms',
      'email',
      'name',
      'password',
    ]);
  });
});
