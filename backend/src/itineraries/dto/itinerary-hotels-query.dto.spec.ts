import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { ItineraryHotelsQueryDto } from './itinerary-hotels-query.dto';

// The same options as the global pipe in main.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const asQuery: ArgumentMetadata = {
  type: 'query',
  metatype: ItineraryHotelsQueryDto,
};

const VALID = { firstDayNumber: '1', guests: '2' };

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

describe('ItineraryHotelsQueryDto (ITN-25)', () => {
  it('turns the numbers into numbers and defaults to one room on the first page', async () => {
    const query = (await pipe.transform(
      VALID,
      asQuery,
    )) as ItineraryHotelsQueryDto;

    expect(query).toBeInstanceOf(ItineraryHotelsQueryDto);
    expect(query).toMatchObject({
      firstDayNumber: 1,
      guests: 2,
      rooms: 1,
      page: 1,
      limit: 10,
    });
    expect(query.skip).toBe(0);
  });

  it('accepts the largest values', async () => {
    const query = (await pipe.transform(
      {
        firstDayNumber: '60',
        guests: '100',
        rooms: '20',
        page: '3',
        limit: '50',
      },
      asQuery,
    )) as ItineraryHotelsQueryDto;

    expect(query).toMatchObject({
      firstDayNumber: 60,
      guests: 100,
      rooms: 20,
      page: 3,
      limit: 50,
    });
    expect(query.skip).toBe(100);
  });

  it.each([
    ['no city group', { guests: '2' }, 'firstDayNumber'],
    ['day 0', { ...VALID, firstDayNumber: '0' }, 'firstDayNumber'],
    ['day 61', { ...VALID, firstDayNumber: '61' }, 'firstDayNumber'],
    [
      'a fraction as the day',
      { ...VALID, firstDayNumber: '1.5' },
      'firstDayNumber',
    ],
    [
      'text as the day',
      { ...VALID, firstDayNumber: 'first' },
      'firstDayNumber',
    ],
    ['no guests', { firstDayNumber: '1' }, 'guests'],
    ['0 guests', { ...VALID, guests: '0' }, 'guests'],
    ['101 guests', { ...VALID, guests: '101' }, 'guests'],
    ['a fraction of a guest', { ...VALID, guests: '2.5' }, 'guests'],
    ['0 rooms', { ...VALID, rooms: '0' }, 'rooms'],
    ['21 rooms', { ...VALID, rooms: '21' }, 'rooms'],
    ['page 0', { ...VALID, page: '0' }, 'page'],
    ['a limit above 50', { ...VALID, limit: '51' }, 'limit'],
  ])('rejects %s', async (_label, query, field) => {
    expect(await fieldsOf(query)).toEqual([field]);
  });

  it.each(['checkIn', 'checkOut', 'cityId', 'countryCode'])(
    'rejects %s: the dates and the city come from the city group',
    async (field) => {
      expect(await fieldsOf({ ...VALID, [field]: 'EG' })).toEqual([field]);
    },
  );
});
