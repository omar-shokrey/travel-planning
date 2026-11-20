import { type ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { ModeratorReservationStatus } from '../hotel-booking-lookup.service';
import { ModeratorReservationsQueryDto } from './moderator-reservations-query.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: ModeratorReservationsQueryDto,
};
const parse = (query: Record<string, string>) =>
  pipe.transform(query, metadata) as Promise<ModeratorReservationsQueryDto>;

describe('ModeratorReservationsQueryDto (HTL-22)', () => {
  it('reads no status and the default page', async () => {
    const dto = await parse({});

    expect(dto.status).toBeUndefined();
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(10);
  });

  it.each(Object.values(ModeratorReservationStatus))(
    'accepts status=%s',
    async (status) => {
      expect((await parse({ status })).status).toBe(status);
    },
  );

  it.each(['pending_payment', 'expired', 'Confirmed', ''])(
    'refuses status=%p',
    async (status) => {
      await expect(parse({ status })).rejects.toMatchObject({
        response: {
          message: ['status must be one of: confirmed, completed, cancelled'],
        },
      });
    },
  );

  it('refuses a parameter the list does not have', async () => {
    await expect(parse({ email: 'x' })).rejects.toBeDefined();
  });
});
