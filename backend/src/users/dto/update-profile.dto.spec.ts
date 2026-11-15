import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { USER_NAME_MAX_LENGTH } from '../users.constants';
import { UpdateProfileDto } from './update-profile.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = { type: 'body', metatype: UpdateProfileDto };

const parse = (body: Record<string, unknown>): Promise<UpdateProfileDto> =>
  pipe.transform(body, metadata) as Promise<UpdateProfileDto>;

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

describe('UpdateProfileDto (ACC-09)', () => {
  it('accepts a name, an international phone number and a currency code', async () => {
    const dto = await parse({
      name: 'Sara Ahmed',
      phone: '+20 10 1234 5678',
      preferredCurrency: 'EGP',
    });

    expect(dto).toBeInstanceOf(UpdateProfileDto);
    expect(dto).toEqual({
      name: 'Sara Ahmed',
      phone: '+20 10 1234 5678',
      preferredCurrency: 'EGP',
    });
  });

  it('accepts any one field alone, and an empty body', async () => {
    expect(await invalidFields({ name: 'Sara' })).toEqual([]);
    expect(await invalidFields({ phone: '+44 20 7946 0958' })).toEqual([]);
    expect(await invalidFields({ preferredCurrency: 'USD' })).toEqual([]);
    expect(await invalidFields({})).toEqual([]);
  });

  it('trims the name and the phone, and uppercases the currency', async () => {
    const dto = await parse({
      name: '  Sara Ahmed ',
      phone: ' +20 10 1234 5678 ',
      preferredCurrency: ' eur ',
    });

    expect(dto).toEqual({
      name: 'Sara Ahmed',
      phone: '+20 10 1234 5678',
      preferredCurrency: 'EUR',
    });
  });

  it('accepts null to remove the phone or the preferred currency', async () => {
    const dto = await parse({ phone: null, preferredCurrency: null });

    expect(dto).toEqual({ phone: null, preferredCurrency: null });
  });

  it.each([
    ['an empty name', { name: '   ' }, ['name']],
    ['a null name', { name: null }, ['name']],
    ['a name that is not a text', { name: 42 }, ['name']],
    [
      'a name longer than the limit',
      { name: 'a'.repeat(USER_NAME_MAX_LENGTH + 1) },
      ['name'],
    ],
    ['a phone without the country code', { phone: '01012345678' }, ['phone']],
    ['a phone that is not a number', { phone: '+20 abc' }, ['phone']],
    ['an empty phone', { phone: '' }, ['phone']],
    [
      'a currency that is not 3 letters',
      { preferredCurrency: 'EURO' },
      ['preferredCurrency'],
    ],
    [
      'a currency with digits',
      { preferredCurrency: 'U5D' },
      ['preferredCurrency'],
    ],
    [
      'a currency that is not a text',
      { preferredCurrency: 840 },
      ['preferredCurrency'],
    ],
  ] as [string, Record<string, unknown>, string[]][])(
    'rejects %s',
    async (_name, body, fields) => {
      expect(await invalidFields(body)).toEqual(fields);
    },
  );

  it('rejects every invalid field at once, so nothing is saved', async () => {
    expect(
      await invalidFields({ name: '', phone: '123', preferredCurrency: 'X' }),
    ).toEqual(['name', 'phone', 'preferredCurrency']);
  });

  it.each(['email', 'role', 'status', 'mustChangePassword', 'passwordHash'])(
    'rejects %s, which the profile may not change',
    async (field) => {
      expect(await invalidFields({ name: 'Sara', [field]: 'x' })).toEqual([
        field,
      ]);
    },
  );
});
