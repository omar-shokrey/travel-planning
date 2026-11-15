import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { PASSWORD_MAX_LENGTH } from '../auth.constants';
import { ChangePasswordDto } from './change-password.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: ChangePasswordDto,
};

const valid = { currentPassword: 'Passw0rdOK', newPassword: 'N3wPassword' };

const parse = (body: Record<string, unknown>): Promise<ChangePasswordDto> =>
  pipe.transform(body, metadata) as Promise<ChangePasswordDto>;

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

describe('ChangePasswordDto (ACC-08)', () => {
  it('accepts the current password and a new one that meets the rule', async () => {
    const dto = await parse(valid);

    expect(dto).toBeInstanceOf(ChangePasswordDto);
    expect(dto).toEqual(valid);
  });

  it('keeps both passwords exactly as they were typed', async () => {
    const body = { currentPassword: ' old p4ss ', newPassword: ' N3w pass ' };

    expect(await parse(body)).toEqual(body);
  });

  it('does not apply the password rule to the current password', async () => {
    // A temporary password set before the rule existed must still be accepted here.
    expect(await invalidFields({ ...valid, currentPassword: 'abc' })).toEqual(
      [],
    );
  });

  it.each([
    ['a new password with no digit', 'NoDigitsHere'],
    ['a new password with no letter', '1234567890'],
    ['a new password shorter than 8 characters', 'Ab1cdef'],
  ])('rejects %s and names the rule', async (_name, newPassword) => {
    const errors = await errorsOf({ ...valid, newPassword });

    expect(errors).toEqual([
      {
        field: 'newPassword',
        messages: [
          'newPassword must be at least 8 characters and include a letter and a digit',
        ],
      },
    ]);
  });

  it.each([
    [
      'no current password',
      { newPassword: valid.newPassword },
      ['currentPassword'],
    ],
    [
      'an empty current password',
      { ...valid, currentPassword: '' },
      ['currentPassword'],
    ],
    [
      'a current password that is not a text',
      { ...valid, currentPassword: 12345678 },
      ['currentPassword'],
    ],
    [
      'a current password longer than the limit',
      { ...valid, currentPassword: 'a1'.repeat(PASSWORD_MAX_LENGTH) },
      ['currentPassword'],
    ],
    [
      'no new password',
      { currentPassword: valid.currentPassword },
      ['newPassword'],
    ],
    [
      'a new password that is not a text',
      { ...valid, newPassword: 12345678 },
      ['newPassword'],
    ],
    [
      'a new password longer than the limit',
      { ...valid, newPassword: 'a1'.repeat(PASSWORD_MAX_LENGTH) },
      ['newPassword'],
    ],
    ['no body', {}, ['currentPassword', 'newPassword']],
  ] as [string, Record<string, unknown>, string[]][])(
    'rejects %s',
    async (_name, body, fields) => {
      expect(await invalidFields(body)).toEqual(fields);
    },
  );

  it('rejects a field the client may not send', async () => {
    expect(
      await invalidFields({ ...valid, mustChangePassword: false }),
    ).toEqual(['mustChangePassword']);
    expect(await invalidFields({ ...valid, userId: 'someone' })).toEqual([
      'userId',
    ]);
  });
});
