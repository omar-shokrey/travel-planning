import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { SearchHotelsQueryDto } from './search-hotels-query.dto';

// The same options as the global pipe in main.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: SearchHotelsQueryDto,
};

const STAY = { checkIn: '2026-12-10', checkOut: '2026-12-13', guests: '2' };

const parse = (query: object) =>
  pipe.transform(query, metadata) as Promise<SearchHotelsQueryDto>;

describe('SearchHotelsQueryDto (HTL-11)', () => {
  it('searches a city with one room by default', async () => {
    const query = await parse({ ...STAY, cityId: ' cairo ' });

    expect(query).toMatchObject({
      cityId: 'cairo',
      checkIn: '2026-12-10',
      checkOut: '2026-12-13',
      guests: 2,
      rooms: 1,
      page: 1,
      limit: 10,
    });
    expect(query.countryCode).toBeUndefined();
  });

  it('searches a country in any letter case, with several rooms', async () => {
    const query = await parse({ ...STAY, countryCode: 'eg', rooms: '3' });

    expect(query).toMatchObject({ countryCode: 'EG', rooms: 3 });
    expect(query.cityId).toBeUndefined();
  });

  it('accepts the largest guests and rooms', async () => {
    await expect(
      parse({ ...STAY, cityId: 'cairo', guests: '40', rooms: '10' }),
    ).resolves.toBeDefined();
  });

  it.each([
    ['no destination', { ...STAY }],
    ['a blank city', { ...STAY, cityId: '  ' }],
    ['both destinations', { ...STAY, cityId: 'cairo', countryCode: 'EG' }],
    ['a country code of three letters', { ...STAY, countryCode: 'EGY' }],
    [
      'no guests',
      { cityId: 'cairo', checkIn: '2026-12-10', checkOut: '2026-12-13' },
    ],
    ['0 guests', { ...STAY, cityId: 'cairo', guests: '0' }],
    ['41 guests', { ...STAY, cityId: 'cairo', guests: '41' }],
    ['1.5 guests', { ...STAY, cityId: 'cairo', guests: '1.5' }],
    ['0 rooms', { ...STAY, cityId: 'cairo', rooms: '0' }],
    ['11 rooms', { ...STAY, cityId: 'cairo', rooms: '11' }],
    ['no check-in', { cityId: 'cairo', checkOut: '2026-12-13', guests: '2' }],
    [
      'check-out before check-in',
      { ...STAY, cityId: 'cairo', checkOut: '2026-12-09' },
    ],
    [
      'check-out on check-in',
      { ...STAY, cityId: 'cairo', checkOut: '2026-12-10' },
    ],
    [
      'a date that is not real',
      { ...STAY, cityId: 'cairo', checkIn: '2026-02-30' },
    ],
    ['an unknown parameter', { ...STAY, cityId: 'cairo', sort: 'price' }],
  ])('rejects %s', async (_, query) => {
    await expect(parse(query)).rejects.toThrow(BadRequestException);
  });

  it('says which destination rule was broken', async () => {
    const error = await parse({ ...STAY, cityId: 'cairo', countryCode: 'EG' })
      .then(() => null)
      .catch((caught: BadRequestException) => caught);

    expect(JSON.stringify(error?.getResponse())).toContain(
      'Send exactly one of cityId or countryCode',
    );
  });
});
