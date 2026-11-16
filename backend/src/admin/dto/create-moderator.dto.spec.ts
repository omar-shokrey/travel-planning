import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { PASSWORD_MAX_LENGTH } from '../../auth/auth.constants';
import { Role } from '../../common/enums/role.enum';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { USER_NAME_MAX_LENGTH } from '../../users/users.constants';
import { CreateModeratorDto } from './create-moderator.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: CreateModeratorDto,
};

const valid = {
  name: 'Mona Hotel',
  email: 'mona@example.com',
  role: Role.HotelModerator,
  providerId: '6740f1c2a4b5c6d7e8f90123',
  temporaryPassword: 'Temp0rary1',
};

const parse = (body: Record<string, unknown>): Promise<CreateModeratorDto> =>
  pipe.transform(body, metadata) as Promise<CreateModeratorDto>;

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

describe('CreateModeratorDto (ACC-13)', () => {
  it.each([Role.AirlineModerator, Role.HotelModerator])(
    'accepts a %s with a provider and a temporary password',
    async (role) => {
      expect(await invalidFields({ ...valid, role })).toEqual([]);
    },
  );

  it('trims the name, trims and lowercases the email, and keeps the password as typed', async () => {
    const dto = await parse({
      ...valid,
      name: '  Mona Hotel ',
      email: ' Mona@Example.COM ',
      temporaryPassword: ' Temp0rary 1 ',
    });

    expect(dto).toMatchObject({
      name: 'Mona Hotel',
      email: 'mona@example.com',
      temporaryPassword: ' Temp0rary 1 ',
    });
  });

  it.each([Role.User, Role.Admin, 'guest'])(
    'refuses the role %s: only moderator accounts are made here',
    async (role) => {
      expect(await invalidFields({ ...valid, role })).toEqual(['role']);
    },
  );

  it('refuses a temporary password that breaks the rule, and names it', async () => {
    expect(await errorsOf({ ...valid, temporaryPassword: 'short' })).toEqual([
      {
        field: 'temporaryPassword',
        messages: [
          'temporaryPassword must be at least 8 characters and include a letter and a digit',
        ],
      },
    ]);
  });

  it.each([
    ['an empty name', { name: '  ' }, ['name']],
    [
      'a name over the limit',
      { name: 'a'.repeat(USER_NAME_MAX_LENGTH + 1) },
      ['name'],
    ],
    ['an email that is not an email', { email: 'nope' }, ['email']],
    [
      'a provider id that is not an id',
      { providerId: 'airline-1' },
      ['providerId'],
    ],
    [
      'a password over the limit',
      { temporaryPassword: 'a1'.repeat(PASSWORD_MAX_LENGTH) },
      ['temporaryPassword'],
    ],
  ] as [string, Record<string, unknown>, string[]][])(
    'refuses %s',
    async (_name, change, fields) => {
      expect(await invalidFields({ ...valid, ...change })).toEqual(fields);
    },
  );

  it.each(['name', 'email', 'role', 'providerId', 'temporaryPassword'])(
    'requires %s, and refuses it as null',
    async (field) => {
      expect(await invalidFields({ ...valid, [field]: undefined })).toEqual([
        field,
      ]);
      expect(await invalidFields({ ...valid, [field]: null })).toEqual([field]);
    },
  );

  it.each(['status', 'mustChangePassword', 'providerType', 'assignment'])(
    'refuses %s, which the server sets',
    async (field) => {
      expect(await invalidFields({ ...valid, [field]: 'x' })).toEqual([field]);
    },
  );
});
