import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { HotelDetailsQueryDto } from './hotel-details-query.dto';

// The same options as the global pipe in main.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const asQuery: ArgumentMetadata = {
  type: 'query',
  metatype: HotelDetailsQueryDto,
};

describe('HotelDetailsQueryDto (HTL-02, HTL-15)', () => {
  it.each([
    ['no dates', {}],
    ['both dates', { checkIn: '2026-12-10', checkOut: '2026-12-13' }],
  ])('accepts %s', async (_label, query) => {
    await expect(pipe.transform(query, asQuery)).resolves.toMatchObject(query);
  });

  it.each([
    ['only check-in', { checkIn: '2026-12-10' }, 'checkOut'],
    ['only check-out', { checkOut: '2026-12-13' }, 'checkIn'],
    ['an empty check-in', { checkIn: '', checkOut: '2026-12-13' }, 'checkIn'],
    [
      'check-out before check-in',
      { checkIn: '2026-12-13', checkOut: '2026-12-10' },
      'checkIn',
    ],
    [
      'check-out on the check-in day',
      { checkIn: '2026-12-10', checkOut: '2026-12-10' },
      'checkIn',
    ],
    [
      'a date that does not exist',
      { checkIn: '2026-02-30', checkOut: '2026-03-02' },
      'checkIn',
    ],
    ['text', { checkIn: 'soon', checkOut: '2026-12-13' }, 'checkIn'],
    ['a page parameter (the page is not paginated)', { page: '1' }, 'page'],
  ])('rejects %s, naming %s', async (_label, query, field) => {
    const error = await pipe
      .transform(query, asQuery)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    const body = (error as BadRequestException).getResponse() as {
      errors: { field: string }[];
    };
    expect(body.errors.map((entry) => entry.field)).toContain(field);
  });
});
