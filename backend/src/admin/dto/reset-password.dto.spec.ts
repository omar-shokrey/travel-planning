import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { PASSWORD_MAX_LENGTH } from '../../auth/auth.constants';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { ResetPasswordDto } from './reset-password.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = { type: 'body', metatype: ResetPasswordDto };

const valid = { temporaryPassword: 'Temp0rary1' };

const parse = (body: Record<string, unknown>): Promise<ResetPasswordDto> =>
  pipe.transform(body, metadata) as Promise<ResetPasswordDto>;

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

describe('ResetPasswordDto (ACC-07a)', () => {
  it('accepts a temporary password that meets the rule, exactly as typed', async () => {
    const dto = await parse({ temporaryPassword: ' Temp0rary 1 ' });

    expect(dto).toBeInstanceOf(ResetPasswordDto);
    expect(dto.temporaryPassword).toBe(' Temp0rary 1 ');
  });

  it.each([
    ['no digit', 'NoDigitsHere'],
    ['no letter', '1234567890'],
    ['fewer than 8 characters', 'Ab1cdef'],
  ])(
    'rejects a temporary password with %s and names the rule',
    async (_name, temporaryPassword) => {
      expect(await errorsOf({ temporaryPassword })).toEqual([
        {
          field: 'temporaryPassword',
          messages: [
            'temporaryPassword must be at least 8 characters and include a letter and a digit',
          ],
        },
      ]);
    },
  );

  it.each([
    ['no body', {}],
    ['a password that is not a text', { temporaryPassword: 12345678 }],
    [
      'a password longer than the limit',
      { temporaryPassword: 'a1'.repeat(PASSWORD_MAX_LENGTH) },
    ],
  ] as [string, Record<string, unknown>][])(
    'rejects %s',
    async (_name, body) => {
      expect(await invalidFields(body)).toEqual(['temporaryPassword']);
    },
  );

  it('rejects a field the admin may not send', async () => {
    expect(
      await invalidFields({ ...valid, mustChangePassword: false }),
    ).toEqual(['mustChangePassword']);
    expect(await invalidFields({ ...valid, role: 'admin' })).toEqual(['role']);
  });
});
