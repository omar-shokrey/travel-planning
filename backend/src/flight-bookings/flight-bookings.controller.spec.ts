import { HttpStatus, StreamableFile } from '@nestjs/common';
import { HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CabinClass } from '../flights/models/cabin-class.enum';
import { FlightBookingsController } from './flight-bookings.controller';
import type { FlightBookingETicketService } from './flight-booking-e-ticket.service';
import type { FlightBookingsService } from './flight-bookings.service';

describe('FlightBookingsController (FLT-22, FLT-19)', () => {
  it('passes the logged-in user and the body to hold and returns its answer', async () => {
    const answer = { id: 'booking-1' };
    const service = { hold: jest.fn().mockResolvedValue(answer) };
    const controller = new FlightBookingsController(
      service as unknown as FlightBookingsService,
      {} as FlightBookingETicketService,
    );
    const dto = {
      flightId: '6740f1c2a4b5c6d7e8f90456',
      cabin: CabinClass.Economy,
      passengers: [
        {
          fullName: 'Sara Ahmed',
          dateOfBirth: '1990-05-14',
          passportNumber: 'A12345678',
        },
      ],
    };

    await expect(controller.hold(dto, 'user-1')).resolves.toBe(answer);
    expect(service.hold).toHaveBeenCalledWith('user-1', dto);
  });

  it('is for registered users only, and needs a login', () => {
    const reflector = new Reflector();
    const handler = FlightBookingsController.prototype.hold;

    expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.User]);
    expect(
      reflector.getAllAndOverride(IS_PUBLIC_KEY, [
        handler,
        FlightBookingsController,
      ]),
    ).toBeUndefined();
  });
});

describe('FlightBookingsController.summarise (FLT-21)', () => {
  const dto = {
    flightId: '6740f1c2a4b5c6d7e8f90456',
    cabin: CabinClass.Economy,
    passengers: [
      {
        fullName: 'Sara Ahmed',
        dateOfBirth: '1990-05-14',
        passportNumber: 'A12345678',
      },
    ],
  };

  it('passes the body to summarise and returns its answer', async () => {
    const answer = { total: 25000 };
    const service = { summarise: jest.fn().mockResolvedValue(answer) };
    const controller = new FlightBookingsController(
      service as unknown as FlightBookingsService,
      {} as FlightBookingETicketService,
    );

    await expect(controller.summarise(dto)).resolves.toBe(answer);
    expect(service.summarise).toHaveBeenCalledWith(dto);
  });

  it('is for registered users only, needs a login, and answers 200', () => {
    const reflector = new Reflector();
    const handler = FlightBookingsController.prototype.summarise;

    expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.User]);
    expect(
      reflector.getAllAndOverride(IS_PUBLIC_KEY, [
        handler,
        FlightBookingsController,
      ]),
    ).toBeUndefined();
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(
      HttpStatus.OK,
    );
    // POST /api/flight-bookings: the controller path with no route of its own.
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('/');
  });
});

describe('FlightBookingsController.eTicket (FLT-23)', () => {
  it('sends the PDF as a download named after the reference', async () => {
    const pdf = Buffer.from('%PDF-1.3 test');
    const eTickets = {
      eTicket: jest
        .fn()
        .mockResolvedValue({ filename: 'e-ticket-FB-7KQ2MX.pdf', pdf }),
    };
    const controller = new FlightBookingsController(
      {} as FlightBookingsService,
      eTickets as unknown as FlightBookingETicketService,
    );

    const file = await controller.eTicket('booking-1', 'user-1');

    expect(eTickets.eTicket).toHaveBeenCalledWith('booking-1', 'user-1');
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders()).toEqual({
      type: 'application/pdf',
      disposition: 'attachment; filename="e-ticket-FB-7KQ2MX.pdf"',
      length: pdf.length,
    });
  });

  it('is GET :id/e-ticket for registered users only, and needs a login', () => {
    const reflector = new Reflector();
    const handler = FlightBookingsController.prototype.eTicket;

    expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.User]);
    expect(
      reflector.getAllAndOverride(IS_PUBLIC_KEY, [
        handler,
        FlightBookingsController,
      ]),
    ).toBeUndefined();
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id/e-ticket');
  });
});
