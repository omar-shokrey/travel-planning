import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { DECORATORS } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { ROOM_PRICE_MAX } from '../hotels.constants';
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

// The same options as the global pipe in app.setup.ts.
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

const parse = (query: unknown): Promise<SearchHotelsQueryDto> =>
  pipe.transform(query, metadata) as Promise<SearchHotelsQueryDto>;

/** The field errors of the 400, in the project error shape, or [] when valid. */
async function errorsOf(query: unknown): Promise<FieldError[]> {
  try {
    await parse(query);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) {
      throw error;
    }
    return (error.getResponse() as { errors: FieldError[] }).errors;
  }
}

describe('SearchHotelsQueryDto: price, rating and order (HTL-12)', () => {
  it('leaves the filters out and sorts by name when none is sent', async () => {
    const dto = await parse(base);

    expect(dto.minPrice).toBeUndefined();
    expect(dto.maxPrice).toBeUndefined();
    expect(dto.minRating).toBeUndefined();
    expect(dto.sortBy).toBe('name');
    expect(dto.sortOrder).toBeUndefined();
  });

  it('reads the prices as whole numbers of cents and the rating as a decimal', async () => {
    const dto = await parse({
      ...base,
      minPrice: '10000',
      maxPrice: '50000',
      minRating: '4.5',
      sortBy: 'price',
      sortOrder: 'desc',
    });

    expect(dto.minPrice).toBe(10000);
    expect(dto.maxPrice).toBe(50000);
    expect(dto.minRating).toBe(4.5);
    expect(dto.sortBy).toBe('price');
    expect(dto.sortOrder).toBe('desc');
  });

  it('accepts 0, the highest price and equal bounds (the service compares the two bounds)', async () => {
    expect(
      await errorsOf({ ...base, minPrice: '0', maxPrice: `${ROOM_PRICE_MAX}` }),
    ).toEqual([]);
    expect(
      await errorsOf({ ...base, minPrice: '25000', maxPrice: '25000' }),
    ).toEqual([]);
  });

  it('leaves a minimum above the maximum to the service: each bound is valid alone', async () => {
    expect(
      await errorsOf({ ...base, minPrice: '50000', maxPrice: '10000' }),
    ).toEqual([]);
  });

  describe.each(['minPrice', 'maxPrice'])('%s', (field) => {
    it.each(['', ' ', '12.5', '1e3', 'abc', '25000USD'])(
      'refuses %p: a price is a whole number of cents',
      async (value) => {
        expect(await errorsOf({ ...base, [field]: value })).toEqual([
          {
            field,
            messages: expect.arrayContaining([
              `${field} must be a whole number of minor units (cents)`,
            ]),
          },
        ]);
      },
    );

    it('refuses a negative price', async () => {
      expect(await errorsOf({ ...base, [field]: '-1' })).toEqual([
        { field, messages: [`${field} must be 0 or more`] },
      ]);
    });

    it('refuses a price above the highest price a room can have', async () => {
      expect(
        await errorsOf({ ...base, [field]: `${ROOM_PRICE_MAX + 1}` }),
      ).toEqual([
        { field, messages: [`${field} must be at most ${ROOM_PRICE_MAX}`] },
      ]);
    });

    it('refuses the parameter sent twice', async () => {
      const errors = await errorsOf({ ...base, [field]: ['100', '200'] });

      expect(errors.map((error) => error.field)).toEqual([field]);
    });
  });

  it.each([
    ['1', 1],
    ['3.75', 3.75],
    ['5', 5],
  ])('accepts minRating=%p, inside 1 to 5', async (value, expected) => {
    expect((await parse({ ...base, minRating: value })).minRating).toBe(
      expected,
    );
  });

  it.each([
    ['0.9', 'minRating must be at least 1'],
    ['-1', 'minRating must be at least 1'],
    ['5.1', 'minRating must be at most 5'],
  ])('refuses minRating=%p with %p', async (value, message) => {
    expect(await errorsOf({ ...base, minRating: value })).toEqual([
      { field: 'minRating', messages: [message] },
    ]);
  });

  it.each(['abc', '', '4.', '1e0'])(
    'refuses minRating=%p: a rating is a plain number',
    async (value) => {
      expect(await errorsOf({ ...base, minRating: value })).toEqual([
        {
          field: 'minRating',
          messages: expect.arrayContaining([
            'minRating must be a number from 1 to 5',
          ]),
        },
      ]);
    },
  );

  it.each(['name', 'price', 'rating'])('accepts sortBy=%s', async (sortBy) => {
    expect((await parse({ ...base, sortBy })).sortBy).toBe(sortBy);
  });

  it.each(['asc', 'desc'])('accepts sortOrder=%s', async (sortOrder) => {
    expect((await parse({ ...base, sortOrder })).sortOrder).toBe(sortOrder);
  });

  it.each(['', 'Price', 'stars', 'cheapest'])(
    'refuses sortBy=%p',
    async (sortBy) => {
      expect(await errorsOf({ ...base, sortBy })).toEqual([
        {
          field: 'sortBy',
          messages: ['sortBy must be one of: name, price, rating'],
        },
      ]);
    },
  );

  it.each(['', 'ASC', 'up', '1'])('refuses sortOrder=%p', async (sortOrder) => {
    expect(await errorsOf({ ...base, sortOrder })).toEqual([
      { field: 'sortOrder', messages: ['sortOrder must be one of: asc, desc'] },
    ]);
  });

  it.each(['sort', 'maxRating', 'stars', 'order'])(
    'still refuses the parameter %s, which this search does not have',
    async (field) => {
      expect(await errorsOf({ ...base, [field]: 'x' })).toEqual([
        { field, messages: [`property ${field} should not exist`] },
      ]);
    },
  );

  describe('Swagger: "Try it out" sends every example, so no filter may narrow a plain search', () => {
    /** The options @ApiPropertyOptional() stored for a field. */
    const swaggerOf = (field: string): Record<string, unknown> =>
      Reflect.getMetadata(
        DECORATORS.API_MODEL_PROPERTIES,
        SearchHotelsQueryDto.prototype,
        field,
      ) as Record<string, unknown>;

    it.each(['minPrice', 'maxPrice', 'minRating', 'sortOrder'])(
      '%s is documented with no example',
      (field) => {
        expect(swaggerOf(field)).toBeDefined();
        expect(swaggerOf(field)).not.toHaveProperty('example');
      },
    );

    it('sortBy has the default name as its example', () => {
      expect(swaggerOf('sortBy')).toMatchObject({
        default: 'name',
        example: 'name',
      });
      expect(new SearchHotelsQueryDto().sortBy).toBe('name');
    });
  });
});
