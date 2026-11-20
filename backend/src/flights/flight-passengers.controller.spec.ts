import { StreamableFile } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { FlightPassengersController } from './flight-passengers.controller';
import type { FlightPassengersService } from './flight-passengers.service';

describe('FlightPassengersController (FLT-29)', () => {
  function setup() {
    const csv = Buffer.from('\uFEFFReference\r\n', 'utf8');
    const passengers = {
      bookingsOf: jest.fn().mockResolvedValue({ bookings: [] }),
      passengerCsv: jest.fn().mockResolvedValue({
        filename: 'passengers-MS777-2027-01-10.csv',
        csv,
      }),
    };
    const controller = new FlightPassengersController(
      passengers as unknown as FlightPassengersService,
    );
    return { controller, passengers, csv };
  }

  it('passes the flight id and the moderator to the list', async () => {
    const { controller, passengers } = setup();

    await expect(
      controller.bookings('flight-1', 'moderator-1'),
    ).resolves.toEqual({ bookings: [] });
    expect(passengers.bookingsOf).toHaveBeenCalledWith(
      'flight-1',
      'moderator-1',
    );
  });

  it('sends the CSV as a UTF-8 download named after the flight', async () => {
    const { controller, passengers, csv } = setup();

    const file = await controller.export('flight-1', 'moderator-1');

    expect(passengers.passengerCsv).toHaveBeenCalledWith(
      'flight-1',
      'moderator-1',
    );
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders()).toEqual({
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="passengers-MS777-2027-01-10.csv"',
      length: csv.length,
    });
  });

  it.each([
    ['bookings', ':id/bookings'],
    ['export', ':id/passengers/export'],
  ] as const)(
    '%s is GET %s for airline moderators only, and needs a login',
    (name, path) => {
      const reflector = new Reflector();
      const handler = FlightPassengersController.prototype[name];

      expect(reflector.get(ROLES_KEY, handler)).toEqual([
        Role.AirlineModerator,
      ]);
      expect(
        reflector.getAllAndOverride(IS_PUBLIC_KEY, [
          handler,
          FlightPassengersController,
        ]),
      ).toBeUndefined();
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    },
  );
});
