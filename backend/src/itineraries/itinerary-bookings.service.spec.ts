import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Mongoose, Types } from 'mongoose';
import type { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import type { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import { LinkedBookingType } from './enums/linked-booking-type.enum';
import {
  BOOKING_ALREADY_LINKED_MESSAGE,
  BOOKING_NOT_LINKABLE_MESSAGE,
  ITINERARY_CHANGED_MESSAGE,
  LINKED_BOOKINGS_PER_DAY_MAX,
  LINKED_BOOKINGS_PER_DAY_MESSAGE,
} from './itineraries.constants';
import type { ItinerariesService } from './itineraries.service';
import { ItineraryBookingsService } from './itinerary-bookings.service';
import {
  Itinerary,
  type ItineraryDocument,
  ItinerarySchema,
} from './models/itinerary.schema';

// A real model that is never connected; every database call is replaced.
const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const ItineraryModel = mongoose.model(Itinerary.name, ItinerarySchema);

const userId = new Types.ObjectId().toString();
const flightBookingId = new Types.ObjectId();
const hotelBookingId = new Types.ObjectId();

/** An owned itinerary with two days in cairo, at version 3. */
const stored = (): ItineraryDocument => {
  const itinerary = new ItineraryModel({
    ownerId: new Types.ObjectId(userId),
    title: 'Egypt',
    countries: ['EG'],
    startDate: '2026-12-20',
    dayCount: 2,
    days: [{ cityId: 'cairo' }, { cityId: 'cairo' }],
  }) as ItineraryDocument;
  itinerary.__v = 3;
  return itinerary;
};

const flightBooking = (status = 'confirmed') => ({
  _id: flightBookingId,
  status,
  reference: status === 'pending_payment' ? undefined : 'FB-7KQ2MX',
  total: 52000,
  currency: 'USD',
  passengers: [{ fullName: 'Sara Ahmed', passportNumber: 'A1234567' }],
});

const hotelBooking = (status = 'completed') => ({
  _id: hotelBookingId,
  status,
  reference: 'HB-3PRT9W',
  total: 37500,
  currency: 'USD',
});

function setup(itinerary = stored()) {
  const itinerariesService = {
    findOwnedOrThrow: jest.fn().mockResolvedValue(itinerary),
    findDayOrThrow: jest.fn((found: ItineraryDocument, dayId: string) => {
      const day = found.days.find((d) => d._id.toString() === dayId);
      if (!day) throw new NotFoundException('Day not found');
      return day;
    }),
  };
  const flightBookings = {
    findOwnedEntityOrThrow: jest.fn().mockResolvedValue(flightBooking()),
  };
  const hotelBookings = {
    findOwnedEntityOrThrow: jest.fn().mockResolvedValue(hotelBooking()),
  };
  // The conditional update: it pushes the link as the database would.
  const findOneAndUpdate = jest
    .spyOn(ItineraryModel, 'findOneAndUpdate')
    .mockImplementation(((
      _filter: unknown,
      update: { $push: Record<string, Record<string, unknown>> },
    ) => {
      const [path, link] = Object.entries(update.$push)[0];
      const position = Number(path.split('.')[1]);
      itinerary.days[position].linkedBookings.push(link as never);
      return Promise.resolve(itinerary);
    }) as never);
  const service = new ItineraryBookingsService(
    ItineraryModel as never,
    itinerariesService as unknown as ItinerariesService,
    flightBookings as unknown as FlightBookingsService,
    hotelBookings as unknown as HotelBookingsService,
  );
  return {
    itinerary,
    dayId: itinerary.days[1]._id.toString(),
    itinerariesService,
    flightBookings,
    hotelBookings,
    findOneAndUpdate,
    service,
  };
}

const flightDto = (dayId: string) => ({
  dayId,
  bookingType: LinkedBookingType.Flight,
  bookingId: flightBookingId.toString(),
});

const hotelDto = (dayId: string) => ({
  dayId,
  bookingType: LinkedBookingType.Hotel,
  bookingId: hotelBookingId.toString(),
});

const conflictMessage = async (promise: Promise<unknown>) => {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ConflictException);
  return (error as Error).message;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ItineraryBookingsService.link (ITN-27)', () => {
  it("copies a confirmed flight's reference, total and currency into the day, in one conditional update", async () => {
    const { itinerary, dayId, flightBookings, findOneAndUpdate, service } =
      setup();

    const response = await service.link(itinerary.id, flightDto(dayId), userId);

    expect(flightBookings.findOwnedEntityOrThrow).toHaveBeenCalledWith(
      flightBookingId.toString(),
      userId,
    );
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: itinerary._id, __v: 3 },
      {
        $push: {
          'days.1.linkedBookings': {
            bookingType: 'flight',
            bookingId: flightBookingId,
            reference: 'FB-7KQ2MX',
            amount: 52000,
            currency: 'USD',
          },
        },
        $inc: { __v: 1 },
      },
      { returnDocument: 'after', runValidators: true },
    );
    expect(response.days[1].linkedBookings).toEqual([
      {
        id: expect.any(String),
        bookingType: 'flight',
        bookingId: flightBookingId.toString(),
        reference: 'FB-7KQ2MX',
        amount: 52000,
        currency: 'USD',
      },
    ]);
    // Never the booking's other fields.
    expect(JSON.stringify(response)).not.toContain('A1234567');
  });

  it('links a completed hotel reservation through the hotel module, and counts it as accommodation', async () => {
    const { itinerary, dayId, flightBookings, hotelBookings, service } =
      setup();

    const response = await service.link(itinerary.id, hotelDto(dayId), userId);

    expect(hotelBookings.findOwnedEntityOrThrow).toHaveBeenCalledWith(
      hotelBookingId.toString(),
      userId,
    );
    expect(flightBookings.findOwnedEntityOrThrow).not.toHaveBeenCalled();
    expect(response.days[1].linkedBookings[0]).toMatchObject({
      bookingType: 'hotel',
      reference: 'HB-3PRT9W',
      amount: 37500,
    });
    expect(response.cityGroups[0].budgetSubtotal).toEqual([
      { amount: 37500, currency: 'USD' },
    ]);
  });

  it("answers the 403 of another user's itinerary before reading any booking", async () => {
    const { itinerary, dayId, itinerariesService, flightBookings, service } =
      setup();
    itinerariesService.findOwnedOrThrow.mockRejectedValue(
      new ForbiddenException('This itinerary belongs to another user'),
    );

    await expect(
      service.link(itinerary.id, flightDto(dayId), userId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(flightBookings.findOwnedEntityOrThrow).not.toHaveBeenCalled();
  });

  it('answers 404 "Day not found" before reading any booking', async () => {
    const { itinerary, flightBookings, service } = setup();

    await expect(
      service.link(
        itinerary.id,
        flightDto(new Types.ObjectId().toString()),
        userId,
      ),
    ).rejects.toThrow(new NotFoundException('Day not found'));
    expect(flightBookings.findOwnedEntityOrThrow).not.toHaveBeenCalled();
  });

  it("passes on the 404 of a missing booking or someone else's, and writes nothing", async () => {
    const { itinerary, dayId, flightBookings, findOneAndUpdate, service } =
      setup();
    flightBookings.findOwnedEntityOrThrow.mockRejectedValue(
      new NotFoundException('Booking not found'),
    );

    await expect(
      service.link(itinerary.id, flightDto(dayId), userId),
    ).rejects.toThrow(new NotFoundException('Booking not found'));
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each(['pending_payment', 'expired', 'cancelled'])(
    'answers 409 for a %s booking, and writes nothing',
    async (status) => {
      const { itinerary, dayId, flightBookings, findOneAndUpdate, service } =
        setup();
      flightBookings.findOwnedEntityOrThrow.mockResolvedValue(
        flightBooking(status),
      );

      expect(
        await conflictMessage(
          service.link(itinerary.id, flightDto(dayId), userId),
        ),
      ).toBe(BOOKING_NOT_LINKABLE_MESSAGE);
      expect(findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('answers 409 for a hotel reservation that is not confirmed or completed', async () => {
    const { itinerary, dayId, hotelBookings, service } = setup();
    hotelBookings.findOwnedEntityOrThrow.mockResolvedValue(
      hotelBooking('cancelled'),
    );

    expect(
      await conflictMessage(
        service.link(itinerary.id, hotelDto(dayId), userId),
      ),
    ).toBe(BOOKING_NOT_LINKABLE_MESSAGE);
  });

  it('answers 409 when the booking is already linked to any day of this itinerary', async () => {
    const { itinerary, findOneAndUpdate, service } = setup();
    itinerary.days[0].linkedBookings.push({
      bookingType: LinkedBookingType.Flight,
      bookingId: flightBookingId,
      reference: 'FB-7KQ2MX',
      amount: 52000,
      currency: 'USD',
    } as never);

    expect(
      await conflictMessage(
        service.link(
          itinerary.id,
          flightDto(itinerary.days[1]._id.toString()),
          userId,
        ),
      ),
    ).toBe(BOOKING_ALREADY_LINKED_MESSAGE);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('links a hotel with the same id as a linked flight: the type is part of the match', async () => {
    const { itinerary, dayId, hotelBookings, service } = setup();
    itinerary.days[0].linkedBookings.push({
      bookingType: LinkedBookingType.Flight,
      bookingId: hotelBookingId,
      reference: 'FB-7KQ2MX',
      amount: 1,
      currency: 'USD',
    } as never);
    hotelBookings.findOwnedEntityOrThrow.mockResolvedValue(hotelBooking());

    const response = await service.link(itinerary.id, hotelDto(dayId), userId);

    expect(response.days[1].linkedBookings).toHaveLength(1);
  });

  it(`answers 409 when the day already has ${LINKED_BOOKINGS_PER_DAY_MAX} linked bookings`, async () => {
    const { itinerary, dayId, findOneAndUpdate, service } = setup();
    for (let index = 0; index < LINKED_BOOKINGS_PER_DAY_MAX; index += 1) {
      itinerary.days[1].linkedBookings.push({
        bookingType: LinkedBookingType.Hotel,
        bookingId: new Types.ObjectId(),
        reference: `HB-${index}`,
        amount: 100,
        currency: 'USD',
      } as never);
    }

    expect(
      await conflictMessage(
        service.link(itinerary.id, flightDto(dayId), userId),
      ),
    ).toBe(LINKED_BOOKINGS_PER_DAY_MESSAGE);
    expect(LINKED_BOOKINGS_PER_DAY_MESSAGE).toBe(
      'A day has at most 10 linked bookings',
    );
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('reads the itinerary again after losing a race, but the booking only once', async () => {
    const {
      itinerary,
      dayId,
      itinerariesService,
      flightBookings,
      findOneAndUpdate,
      service,
    } = setup();
    findOneAndUpdate.mockResolvedValueOnce(null as never);

    const response = await service.link(itinerary.id, flightDto(dayId), userId);

    expect(itinerariesService.findOwnedOrThrow).toHaveBeenCalledTimes(2);
    expect(flightBookings.findOwnedEntityOrThrow).toHaveBeenCalledTimes(1);
    expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(response.days[1].linkedBookings).toHaveLength(1);
  });

  it('answers 409 "changed by another request" after losing 5 races', async () => {
    const { itinerary, dayId, flightBookings, findOneAndUpdate, service } =
      setup();
    findOneAndUpdate.mockResolvedValue(null as never);

    expect(
      await conflictMessage(
        service.link(itinerary.id, flightDto(dayId), userId),
      ),
    ).toBe(ITINERARY_CHANGED_MESSAGE);
    expect(findOneAndUpdate).toHaveBeenCalledTimes(5);
    expect(flightBookings.findOwnedEntityOrThrow).toHaveBeenCalledTimes(1);
  });

  it('checks the duplicate again after losing a race to a request that linked the same booking', async () => {
    const { itinerary, dayId, findOneAndUpdate, service } = setup();
    findOneAndUpdate.mockImplementationOnce((() => {
      // The other request linked the same booking first.
      itinerary.days[0].linkedBookings.push({
        bookingType: LinkedBookingType.Flight,
        bookingId: flightBookingId,
        reference: 'FB-7KQ2MX',
        amount: 52000,
        currency: 'USD',
      } as never);
      return Promise.resolve(null);
    }) as never);

    expect(
      await conflictMessage(
        service.link(itinerary.id, flightDto(dayId), userId),
      ),
    ).toBe(BOOKING_ALREADY_LINKED_MESSAGE);
  });
});
