import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { HotelReservationsQueryDto } from './hotel-reservations-query.dto';

// The same options as the global pipe in main.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: HotelReservationsQueryDto,
};

const parse = (query: object) =>
  pipe.transform(query, metadata) as Promise<HotelReservationsQueryDto>;

describe('HotelReservationsQueryDto (HTL-22)', () => {
  it('has no status and the first page by default', async () => {
    const query = await parse({});

    expect(query.status).toBeUndefined();
    expect(query).toMatchObject({ page: 1, limit: 10 });
  });

  it.each([
    'pending_payment',
    'confirmed',
    'completed',
    'expired',
    'cancelled',
  ])('accepts the status %s', async (status) => {
    expect((await parse({ status })).status).toBe(status);
  });

  it.each(['paid', 'CONFIRMED', ''])(
    'refuses the status "%s"',
    async (status) => {
      await expect(parse({ status })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );
});
