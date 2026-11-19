import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Mongoose, Types } from 'mongoose';
import type { HotelSearchResultResponseDto } from '../hotels/dto/hotel-search-result-response.dto';
import { SearchHotelsQueryDto } from '../hotels/dto/search-hotels-query.dto';
import type { HotelSearchService } from '../hotels/hotel-search.service';
import { ItineraryHotelsQueryDto } from './dto/itinerary-hotels-query.dto';
import type { ItinerariesService } from './itineraries.service';
import { ItineraryHotelsService } from './itinerary-hotels.service';
import {
  Itinerary,
  type ItineraryDocument,
  ItinerarySchema,
} from './models/itinerary.schema';

// A real model that is never connected; nothing reads the database.
const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const ItineraryModel = mongoose.model(Itinerary.name, ItinerarySchema);

const ownerId = new Types.ObjectId().toString();
const itineraryId = new Types.ObjectId().toString();
/** Before every date used below, so no group starts in the past. */
const NOW = new Date('2099-01-01T10:00:00.000Z');

/** One day per city given, starting on `startDate`. */
const itinerary = (startDate: string, cities: string[]): ItineraryDocument =>
  new ItineraryModel({
    ownerId: new Types.ObjectId(ownerId),
    title: 'Egypt',
    countries: ['EG'],
    startDate,
    dayCount: cities.length,
    days: cities.map((cityId) => ({ cityId })),
  }) as ItineraryDocument;

const hotel = {
  id: new Types.ObjectId().toString(),
  name: 'Nile View',
  cityId: 'cairo',
  freeRooms: 2,
  lowestPricePerNight: 9000,
  currency: 'USD',
} as HotelSearchResultResponseDto;
const found = {
  items: [hotel],
  meta: { page: 2, limit: 5, total: 7, totalPages: 2 },
};

const query = (fields: Partial<ItineraryHotelsQueryDto> = {}) =>
  Object.assign(new ItineraryHotelsQueryDto(), {
    firstDayNumber: 1,
    guests: 2,
    ...fields,
  });

/** Cairo on days 1-2, Luxor on day 3, Cairo again on day 4. */
const TRIP = ['cairo', 'cairo', 'luxor', 'cairo'];

describe('ItineraryHotelsService (ITN-25)', () => {
  function setup(stored: ItineraryDocument = itinerary('2099-03-10', TRIP)) {
    const itineraries = {
      findOwnedOrThrow: jest.fn().mockResolvedValue(stored),
    };
    const hotelSearch = { search: jest.fn().mockResolvedValue(found) };
    const service = new ItineraryHotelsService(
      itineraries as unknown as ItinerariesService,
      hotelSearch as unknown as HotelSearchService,
    );
    return { itineraries, hotelSearch, service };
  }

  /** The query that hotel search was given. */
  const searched = (hotelSearch: { search: jest.Mock }) => {
    const [hotelQuery, now] = hotelSearch.search.mock.calls[0] as [
      SearchHotelsQueryDto,
      Date,
    ];
    return { hotelQuery, now };
  };

  it('searches the city of the group for check-in on its first day and check-out the day after its last', async () => {
    const { hotelSearch, service } = setup();

    await service.search(itineraryId, query(), ownerId, NOW);

    expect(hotelSearch.search).toHaveBeenCalledTimes(1);
    const { hotelQuery, now } = searched(hotelSearch);
    expect(hotelQuery).toBeInstanceOf(SearchHotelsQueryDto);
    expect(hotelQuery).toMatchObject({
      cityId: 'cairo',
      checkIn: '2099-03-10',
      checkOut: '2099-03-12',
      guests: 2,
      rooms: 1,
      page: 1,
      limit: 10,
    });
    expect(hotelQuery.skip).toBe(0);
    expect(now).toBe(NOW);
  });

  it.each([
    ['the first group', 1, 'cairo', '2099-03-10', '2099-03-12'],
    ['a group of one day', 3, 'luxor', '2099-03-12', '2099-03-13'],
    ['a city visited again', 4, 'cairo', '2099-03-13', '2099-03-14'],
  ])(
    'uses the group picked: %s',
    async (_label, day, cityId, checkIn, checkOut) => {
      const { hotelSearch, service } = setup();

      await service.search(
        itineraryId,
        query({ firstDayNumber: day }),
        ownerId,
        NOW,
      );

      expect(searched(hotelSearch).hotelQuery).toMatchObject({
        cityId,
        checkIn,
        checkOut,
      });
    },
  );

  it.each([
    ['a month end', '2099-02-27', 2, '2099-03-01'],
    ['a year end', '2099-12-30', 3, '2100-01-02'],
  ])(
    'adds the day after the last day across %s',
    async (_label, start, days, checkOut) => {
      const { hotelSearch, service } = setup(
        itinerary(start, Array<string>(days).fill('cairo')),
      );

      await service.search(itineraryId, query(), ownerId, NOW);

      expect(searched(hotelSearch).hotelQuery).toMatchObject({
        checkIn: start,
        checkOut,
      });
    },
  );

  it('passes the guests, the rooms and the page that the user chose', async () => {
    const { hotelSearch, service } = setup();

    await service.search(
      itineraryId,
      query({ guests: 5, rooms: 3, page: 3, limit: 5 }),
      ownerId,
      NOW,
    );

    const { hotelQuery } = searched(hotelSearch);
    expect(hotelQuery).toMatchObject({
      guests: 5,
      rooms: 3,
      page: 3,
      limit: 5,
    });
    expect(hotelQuery.skip).toBe(10);
  });

  it('returns the hotels with the searched stay, and the page information of the search', async () => {
    const { service } = setup();

    expect(await service.search(itineraryId, query(), ownerId, NOW)).toEqual({
      items: [{ ...hotel, checkIn: '2099-03-10', checkOut: '2099-03-12' }],
      meta: found.meta,
    });
  });

  it('answers an empty page when no hotel can take the search', async () => {
    const { hotelSearch, service } = setup();
    const empty = {
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    };
    hotelSearch.search.mockResolvedValue(empty);

    expect(await service.search(itineraryId, query(), ownerId, NOW)).toEqual(
      empty,
    );
  });

  it('loads the itinerary as its owner and says what is forbidden otherwise', async () => {
    const { itineraries, service } = setup();

    await service.search(itineraryId, query(), ownerId, NOW);

    expect(itineraries.findOwnedOrThrow).toHaveBeenCalledWith(
      itineraryId,
      ownerId,
      'You can only search hotels for your own itineraries',
    );
  });

  it.each([
    ['a missing itinerary (404)', new NotFoundException('Itinerary not found')],
    ['another user (403)', new ForbiddenException('Not yours')],
  ])('answers %s before any search', async (_label, error) => {
    const { itineraries, hotelSearch, service } = setup();
    itineraries.findOwnedOrThrow.mockRejectedValue(error);

    await expect(
      service.search(itineraryId, query(), ownerId, NOW),
    ).rejects.toBe(error);
    expect(hotelSearch.search).not.toHaveBeenCalled();
  });

  it.each([
    ['a day inside a group', 2],
    ['a day after the last day', 5],
  ])('answers 404 for %s: no group starts there', async (_label, day) => {
    const { hotelSearch, service } = setup();

    const error: unknown = await service
      .search(itineraryId, query({ firstDayNumber: day }), ownerId, NOW)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).message).toBe('City group not found');
    expect(hotelSearch.search).not.toHaveBeenCalled();
  });

  it('answers 404 for an itinerary without days', async () => {
    const { hotelSearch, service } = setup(itinerary('2099-03-10', []));

    await expect(
      service.search(itineraryId, query(), ownerId, NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(hotelSearch.search).not.toHaveBeenCalled();
  });

  describe('a group that starts in the past', () => {
    it('answers 400 on firstDayNumber and does not search', async () => {
      const { hotelSearch, service } = setup();

      const error: unknown = await service
        .search(
          itineraryId,
          query(),
          ownerId,
          new Date('2099-03-11T00:00:00.000Z'),
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        message: 'Validation failed',
        errors: [{ field: 'firstDayNumber' }],
      });
      expect(hotelSearch.search).not.toHaveBeenCalled();
    });

    it('still searches a group that starts today in UTC, whatever the local time', async () => {
      const { hotelSearch, service } = setup();

      // 00:30 of 11 March in Cairo, but still 10 March in UTC.
      await service.search(
        itineraryId,
        query(),
        ownerId,
        new Date('2099-03-10T22:30:00.000Z'),
      );

      expect(hotelSearch.search).toHaveBeenCalledTimes(1);
    });

    it('lets a later group be searched when an earlier one has started', async () => {
      const { hotelSearch, service } = setup();

      await service.search(
        itineraryId,
        query({ firstDayNumber: 3 }),
        ownerId,
        new Date('2099-03-11T00:00:00.000Z'),
      );

      expect(searched(hotelSearch).hotelQuery.checkIn).toBe('2099-03-12');
    });
  });
});
