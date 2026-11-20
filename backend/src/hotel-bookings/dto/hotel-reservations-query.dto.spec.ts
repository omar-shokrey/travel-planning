import { type ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { ReservationGroup } from '../enums/reservation-group.enum';
import { HotelReservationsQueryDto } from './hotel-reservations-query.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: HotelReservationsQueryDto,
};
const parse = (query: Record<string, string>) =>
  pipe.transform(query, metadata) as Promise<HotelReservationsQueryDto>;

describe('HotelReservationsQueryDto (HTL-20)', () => {
  it('reads no group and the default page', async () => {
    const dto = await parse({});

    expect(dto.group).toBeUndefined();
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(10);
  });

  it.each(Object.values(ReservationGroup))(
    'accepts group=%s',
    async (group) => {
      expect((await parse({ group })).group).toBe(group);
    },
  );

  it.each(['Upcoming', 'pending_payment', 'all', ''])(
    'refuses group=%p',
    async (group) => {
      await expect(parse({ group })).rejects.toMatchObject({
        response: {
          message: ['group must be one of: upcoming, past, cancelled'],
        },
      });
    },
  );

  it('refuses a parameter the list does not have', async () => {
    await expect(parse({ userId: 'someone' })).rejects.toBeDefined();
  });
});
