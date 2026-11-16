import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { CreateHotelDto } from './create-hotel.dto';
import { UpdateHotelDto } from './update-hotel.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});

const valid = {
  name: 'Cairo Garden Hotel',
  addressLine: '12 Nile Street',
  cityId: 'city_001',
  description: 'A quiet hotel close to the city centre.',
  starClass: 4,
  amenities: ['wifi', 'pool'],
};

const parse = <T>(body: Record<string, unknown>, metatype: new () => T) =>
  pipe.transform(body, {
    type: 'body',
    metatype,
  } as ArgumentMetadata) as Promise<T>;

async function errorsOf(
  body: Record<string, unknown>,
  metatype: new () => object = CreateHotelDto,
): Promise<FieldError[]> {
  try {
    await parse(body, metatype);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return (error.getResponse() as { errors: FieldError[] }).errors;
  }
}

const invalidFields = async (
  body: Record<string, unknown>,
  metatype?: new () => object,
): Promise<string[]> =>
  (await errorsOf(body, metatype)).map(({ field }) => field).sort();

describe('CreateHotelDto (HTL-01)', () => {
  it('accepts a complete hotel profile and trims its text fields', async () => {
    const dto = await parse(
      {
        ...valid,
        name: '  Cairo Garden Hotel ',
        amenities: [' wifi ', 'pool '],
      },
      CreateHotelDto,
    );

    expect(dto).toBeInstanceOf(CreateHotelDto);
    expect(dto).toMatchObject({
      name: 'Cairo Garden Hotel',
      amenities: ['wifi', 'pool'],
    });
  });

  it('rejects a missing profile field and a blank name', async () => {
    expect(await invalidFields({})).toEqual([
      'addressLine',
      'amenities',
      'cityId',
      'description',
      'name',
      'starClass',
    ]);
    expect(await invalidFields({ ...valid, name: '   ' })).toContain('name');
  });

  it.each([0, 6, 3.5, '4'])('rejects star class %j', async (starClass) => {
    expect(await invalidFields({ ...valid, starClass })).toContain('starClass');
  });

  it('rejects more than 30 amenities and an empty amenity', async () => {
    expect(
      await invalidFields({
        ...valid,
        amenities: Array.from({ length: 31 }, (_, i) => `amenity ${i}`),
      }),
    ).toContain('amenities');
    expect(
      await invalidFields({ ...valid, amenities: ['wifi', ' '] }),
    ).toContain('amenities');
  });

  it('rejects amenities longer than 50 characters', async () => {
    expect(
      await invalidFields({ ...valid, amenities: ['a'.repeat(51)] }),
    ).toContain('amenities');
  });

  it.each(['countryCode', 'active', 'photos', 'ratingCount', 'averageRating'])(
    'does not accept server-controlled field %s',
    async (field) => {
      expect(await invalidFields({ ...valid, [field]: 'value' })).toEqual([
        field,
      ]);
    },
  );

  it('allows a partial profile update', async () => {
    const dto = await parse({ name: '  Updated name  ' }, UpdateHotelDto);

    expect(dto).toBeInstanceOf(UpdateHotelDto);
    expect(dto).toMatchObject({ name: 'Updated name' });
    expect(await invalidFields({}, UpdateHotelDto)).toEqual([]);
  });

  it('removes duplicate amenities after trimming, keeping the first', async () => {
    const dto = (await pipe.transform(
      { ...valid, amenities: ['wifi', ' pool', 'wifi ', 'pool', 'gym'] },
      { type: 'body', metatype: CreateHotelDto },
    )) as CreateHotelDto;

    expect(dto.amenities).toEqual(['wifi', 'pool', 'gym']);
  });

  it('counts the 30-amenity limit after removing duplicates', async () => {
    expect(
      await invalidFields({ ...valid, amenities: Array(31).fill('wifi') }),
    ).toEqual([]);
  });
});
