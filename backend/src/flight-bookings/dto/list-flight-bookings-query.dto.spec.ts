import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FlightBookingGroup } from '../enums/flight-booking-group.enum';
import { ListFlightBookingsQueryDto } from './list-flight-bookings-query.dto';

const parse = (query: Record<string, unknown>) =>
  plainToInstance(ListFlightBookingsQueryDto, query);

async function messagesOf(query: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(parse(query), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('ListFlightBookingsQueryDto (FLT-25)', () => {
  it('lists the upcoming bookings by default, page 1', () => {
    const query = parse({});

    expect(query.group).toBe(FlightBookingGroup.Upcoming);
    expect(query.page).toBe(1);
    expect(query.skip).toBe(0);
  });

  it.each(['upcoming', 'past', 'cancelled'])(
    'accepts group=%s',
    async (group) => {
      await expect(messagesOf({ group })).resolves.toEqual([]);
    },
  );

  it('refuses another group, naming the three', async () => {
    await expect(messagesOf({ group: 'expired' })).resolves.toContain(
      'group must be one of: upcoming, past, cancelled',
    );
  });

  it('refuses a filter it does not have, such as status or userId', async () => {
    await expect(messagesOf({ userId: 'x' })).resolves.toContain(
      'property userId should not exist',
    );
  });
});
