import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { AvailableRoomsQueryDto } from './available-rooms-query.dto';

// The same options as the global pipe in main.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const asQuery: ArgumentMetadata = {
  type: 'query',
  metatype: AvailableRoomsQueryDto,
};

const STAY = { checkIn: '2026-12-10', checkOut: '2026-12-13' };

/** The fields named by the 400 for `query`. */
const fieldsOf = async (query: object): Promise<string[]> => {
  const error = await pipe
    .transform(query, asQuery)
    .catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BadRequestException);
  const body = (error as BadRequestException).getResponse() as {
    errors: { field: string }[];
  };
  return body.errors.map((entry) => entry.field);
};

describe('AvailableRoomsQueryDto (HTL-15)', () => {
  it('accepts a stay with the default page', async () => {
    const query = (await pipe.transform(
      { ...STAY },
      asQuery,
    )) as AvailableRoomsQueryDto;

    expect(query).toBeInstanceOf(AvailableRoomsQueryDto);
    expect(query).toMatchObject({ ...STAY, page: 1, limit: 10 });
    expect(query.skip).toBe(0);
  });

  it('turns page and limit into numbers', async () => {
    const query = (await pipe.transform(
      { ...STAY, page: '3', limit: '50' },
      asQuery,
    )) as AvailableRoomsQueryDto;

    expect(query).toMatchObject({ page: 3, limit: 50 });
    expect(query.skip).toBe(100);
  });

  it.each([
    ['no dates', {}, ['checkIn', 'checkOut']],
    ['no check-in', { checkOut: STAY.checkOut }, ['checkIn']],
    ['no check-out', { checkIn: STAY.checkIn }, ['checkIn', 'checkOut']],
    ['an empty check-in', { ...STAY, checkIn: '' }, ['checkIn']],
    [
      'a date that does not exist',
      { ...STAY, checkIn: '2026-02-30' },
      ['checkIn'],
    ],
    ['day 32', { checkIn: '2026-12-32', checkOut: '2027-01-02' }, ['checkIn']],
    ['month 13', { ...STAY, checkOut: '2026-13-01' }, ['checkOut']],
    [
      'a date in another format',
      { checkIn: '10/12/2026', checkOut: '13/12/2026' },
      ['checkIn', 'checkOut'],
    ],
    [
      'a date with a time',
      { ...STAY, checkIn: '2026-12-10T00:00:00Z' },
      ['checkIn'],
    ],
    ['text', { ...STAY, checkIn: 'soon' }, ['checkIn']],
    [
      'check-out on the check-in day',
      { ...STAY, checkOut: STAY.checkIn },
      ['checkIn'],
    ],
    [
      'check-out before check-in',
      { ...STAY, checkOut: '2026-12-09' },
      ['checkIn'],
    ],
    ['an unknown parameter', { ...STAY, guests: '2' }, ['guests']],
    ['page 0', { ...STAY, page: '0' }, ['page']],
    ['page 1.5', { ...STAY, page: '1.5' }, ['page']],
    ['page as text', { ...STAY, page: 'two' }, ['page']],
    ['limit 0', { ...STAY, limit: '0' }, ['limit']],
    ['limit 51', { ...STAY, limit: '51' }, ['limit']],
  ])('rejects %s, naming the field', async (_label, query, fields) => {
    expect(await fieldsOf(query)).toEqual(fields);
  });
});
