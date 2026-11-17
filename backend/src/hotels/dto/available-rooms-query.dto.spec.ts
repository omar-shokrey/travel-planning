import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import {
  AvailableRoomsQueryDto,
  HotelDetailsQueryDto,
} from './available-rooms-query.dto';

// The same options as the global pipe in main.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const as = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({
  type: 'query',
  metatype,
});

describe('AvailableRoomsQueryDto (HTL-15)', () => {
  it('accepts a stay and pages through the rooms', async () => {
    const query = (await pipe.transform(
      { checkIn: '2026-12-10', checkOut: '2026-12-13', limit: '20' },
      as(AvailableRoomsQueryDto),
    )) as AvailableRoomsQueryDto;

    expect(query).toMatchObject({
      checkIn: '2026-12-10',
      checkOut: '2026-12-13',
      page: 1,
      limit: 20,
    });
  });

  it.each([
    {},
    { checkIn: '2026-12-10' },
    { checkOut: '2026-12-13' },
    { checkIn: '2026-12-13', checkOut: '2026-12-10' },
    { checkIn: '2026-12-10', checkOut: '2026-12-10' },
    { checkIn: '2026-12-32', checkOut: '2027-01-02' },
    { checkIn: '10/12/2026', checkOut: '13/12/2026' },
    { checkIn: '2026-12-10', checkOut: '2026-12-13', guests: '2' },
  ])('rejects %j', async (query) => {
    await expect(
      pipe.transform(query, as(AvailableRoomsQueryDto)),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('HotelDetailsQueryDto (HTL-02, HTL-15)', () => {
  it.each([{}, { checkIn: '2026-12-10', checkOut: '2026-12-13' }])(
    'accepts %j',
    async (query) => {
      await expect(
        pipe.transform(query, as(HotelDetailsQueryDto)),
      ).resolves.toEqual(query);
    },
  );

  it.each([
    { checkIn: '2026-12-10' },
    { checkOut: '2026-12-13' },
    { checkIn: '2026-12-13', checkOut: '2026-12-10' },
    { checkIn: 'soon', checkOut: '2026-12-13' },
    { page: '1' },
  ])('rejects %j', async (query) => {
    await expect(
      pipe.transform(query, as(HotelDetailsQueryDto)),
    ).rejects.toThrow(BadRequestException);
  });
});
