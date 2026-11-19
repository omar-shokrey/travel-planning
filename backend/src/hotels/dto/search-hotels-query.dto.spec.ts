import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchHotelsQueryDto } from './search-hotels-query.dto';

const base = {
  cityId: 'cairo',
  checkIn: '2026-12-20',
  checkOut: '2026-12-23',
  guests: '2',
};

/** The fields that fail, as the global ValidationPipe would check them. */
const failing = async (query: Record<string, unknown>) => {
  const dto = plainToInstance(SearchHotelsQueryDto, query);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property).sort();
};

describe('SearchHotelsQueryDto (HTL-11)', () => {
  it('accepts a search and reads the numbers, with one room by default', async () => {
    const dto = plainToInstance(SearchHotelsQueryDto, base);

    expect(await failing(base)).toEqual([]);
    expect(dto.guests).toBe(2);
    expect(dto.rooms).toBe(1);
    expect(dto.page).toBe(1);
  });

  it('accepts a country instead of a city, and a number of rooms', async () => {
    const { cityId: _city, ...rest } = base;
    expect(await failing({ ...rest, countryCode: 'EG', rooms: '3' })).toEqual(
      [],
    );
  });

  it.each([
    ['checkIn', { checkIn: '20-12-2026' }],
    ['checkIn', { checkIn: '2026-02-30', checkOut: '2026-03-02' }],
    ['checkIn', { checkOut: '2026-12-20' }],
    ['checkIn', { checkOut: '2026-12-19' }],
    ['checkOut', { checkOut: 'tomorrow' }],
    ['guests', { guests: '0' }],
    ['guests', { guests: '1.5' }],
    ['guests', { guests: '101' }],
    ['guests', { guests: undefined }],
    ['rooms', { rooms: '0' }],
    ['rooms', { rooms: '21' }],
    ['countryCode', { countryCode: 'eg' }],
    ['countryCode', { countryCode: 'EGY' }],
    ['cityId', { cityId: '' }],
    ['cityId', { cityId: 'x'.repeat(51) }],
    ['sort', { sort: 'price' }],
  ])('refuses a bad %s', async (field, change) => {
    expect(await failing({ ...base, ...change })).toContain(field);
  });
});
