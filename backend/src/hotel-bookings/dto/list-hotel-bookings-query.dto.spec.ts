import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { ListHotelBookingsQueryDto } from './list-hotel-bookings-query.dto';

// The same options as the global pipe in main.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: ListHotelBookingsQueryDto,
};

const parse = (query: object) =>
  pipe.transform(query, metadata) as Promise<ListHotelBookingsQueryDto>;

describe('ListHotelBookingsQueryDto (HTL-20)', () => {
  it('lists every reservation, first page, by default', async () => {
    const query = await parse({});

    expect(query.group).toBeUndefined();
    expect(query).toMatchObject({ page: 1, limit: 10 });
  });

  it.each(['upcoming', 'past', 'cancelled'])(
    'accepts the group %s',
    async (group) => {
      expect((await parse({ group, page: '2' })).group).toBe(group);
    },
  );

  it.each(['expired', 'all', ''])('refuses the group "%s"', async (group) => {
    await expect(parse({ group })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a filter on another user', async () => {
    await expect(
      parse({ userId: '6740f1c2a4b5c6d7e8f90123' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
