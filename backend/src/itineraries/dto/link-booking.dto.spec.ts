import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LinkBookingDto } from './link-booking.dto';

/** The fields that fail, with the options of the global ValidationPipe. */
const invalidFields = async (body: Record<string, unknown>) =>
  (
    await validate(plainToInstance(LinkBookingDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  )
    .map((error) => error.property)
    .sort();

const valid = {
  dayId: '6741c0ffee0ddba11ad0d0d0',
  bookingType: 'flight',
  bookingId: '6741c0ffee0ddba11ad0f0f0',
};

describe('LinkBookingDto (ITN-27)', () => {
  it('accepts a flight or a hotel with a day id and a booking id', async () => {
    expect(await invalidFields(valid)).toEqual([]);
    expect(await invalidFields({ ...valid, bookingType: 'hotel' })).toEqual([]);
  });

  it('requires every field, and names them all together', async () => {
    expect(await invalidFields({})).toEqual([
      'bookingId',
      'bookingType',
      'dayId',
    ]);
  });

  it('refuses ids that are not ids and a type that is not flight or hotel', async () => {
    expect(
      await invalidFields({
        dayId: 'day-1',
        bookingType: 'car',
        bookingId: 12,
      }),
    ).toEqual(['bookingId', 'bookingType', 'dayId']);
  });

  it('refuses a field the client must not send, such as an amount or a reference', async () => {
    expect(
      await invalidFields({ ...valid, amount: 1, reference: 'FB-7KQ2MX' }),
    ).toEqual(['amount', 'reference']);
  });
});
