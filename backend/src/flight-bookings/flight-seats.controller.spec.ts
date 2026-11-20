import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { SelectSeatsDto } from './dto/select-seats.dto';
import type { FlightSeatSelectionService } from './flight-seat-selection.service';
import { FlightSeatsController } from './flight-seats.controller';

function setup() {
  const selection = {
    select: jest.fn((..._args: unknown[]) => Promise.resolve({ id: 'b1' })),
    seatMap: jest.fn((..._args: unknown[]) =>
      Promise.resolve({ bookingId: 'b1' }),
    ),
  };
  const controller = new FlightSeatsController(
    selection as unknown as FlightSeatSelectionService,
  );
  return { controller, selection };
}

describe('FlightSeatsController (FLT-28)', () => {
  it('passes the booking, the body and the logged-in user to the selection and returns its answer', async () => {
    const { controller, selection } = setup();
    const body = { seats: [{ passengerIndex: 0, seatNumber: '1A' }] };

    await expect(
      controller.select('b1', body as SelectSeatsDto, 'u1'),
    ).resolves.toEqual({ id: 'b1' });
    expect(selection.select).toHaveBeenCalledWith('b1', 'u1', body);
  });

  it('passes the booking and the logged-in user to the seat map', async () => {
    const { controller, selection } = setup();

    await expect(controller.seatMap('b1', 'u1')).resolves.toEqual({
      bookingId: 'b1',
    });
    expect(selection.seatMap).toHaveBeenCalledWith('b1', 'u1');
  });

  it.each([
    ['select', ':id/seat'],
    ['seatMap', ':id/seat-map'],
  ] as const)(
    '%s is %s, for registered users only, and needs a login',
    (name, path) => {
      const handler = FlightSeatsController.prototype[name];
      const reflector = new Reflector();

      expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.User]);
      expect(
        reflector.getAllAndOverride(IS_PUBLIC_KEY, [
          handler,
          FlightSeatsController,
        ]),
      ).toBeUndefined();
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    },
  );

  it('is mounted on flight-bookings', () => {
    expect(Reflect.getMetadata(PATH_METADATA, FlightSeatsController)).toBe(
      'flight-bookings',
    );
  });
});
