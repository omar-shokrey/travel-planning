import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { PASSWORD_MAX_LENGTH } from '../auth.constants';
import { DeactivateAccountDto } from './deactivate-account.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: DeactivateAccountDto,
};

const valid = { currentPassword: 'Passw0rdOK' };

const parse = (body: Record<string, unknown>): Promise<DeactivateAccountDto> =>
  pipe.transform(body, metadata) as Promise<DeactivateAccountDto>;

/** The fields the pipe names in `errors`. Empty when the body is valid. */
async function invalidFields(body: Record<string, unknown>): Promise<string[]> {
  try {
    await parse(body);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) {
      throw error;
    }
    return (error.getResponse() as { errors: FieldError[] }).errors
      .map(({ field }) => field)
      .sort();
  }
}

describe('DeactivateAccountDto (ACC-12)', () => {
  it('accepts the current password, exactly as it was typed', async () => {
    const dto = await parse({ currentPassword: ' old p4ss ' });

    expect(dto).toBeInstanceOf(DeactivateAccountDto);
    expect(dto).toEqual({ currentPassword: ' old p4ss ' });
  });

  it('does not apply the password rule to the current password', async () => {
    expect(await invalidFields({ currentPassword: 'abc' })).toEqual([]);
  });

  it.each([
    ['no body', {}],
    ['an empty current password', { currentPassword: '' }],
    ['a current password that is not a text', { currentPassword: 12345678 }],
    [
      'a current password longer than the limit',
      { currentPassword: 'a1'.repeat(PASSWORD_MAX_LENGTH) },
    ],
  ] as [string, Record<string, unknown>][])(
    'rejects %s',
    async (_name, body) => {
      expect(await invalidFields(body)).toEqual(['currentPassword']);
    },
  );

  it.each([
    ['a status', { status: 'active' }, 'status'],
    ['a deactivation flag', { authorDeactivated: false }, 'authorDeactivated'],
    ['a user id', { userId: 'someone' }, 'userId'],
  ])(
    'rejects %s: the client never sets a status or a flag',
    async (_name, extra, field) => {
      expect(await invalidFields({ ...valid, ...extra })).toEqual([field]);
    },
  );
});
