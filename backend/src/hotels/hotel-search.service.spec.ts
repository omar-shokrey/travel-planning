import { BadRequestException } from '@nestjs/common';
import { Types, type Model } from 'mongoose';
import type { SearchHotelsQueryDto } from './dto/search-hotels-query.dto';
import { HotelSearchService } from './hotel-search.service';
import { HOTEL_PRICE_RANGE_MESSAGE } from './hotels.constants';
import type { Hotel } from './models/hotel.schema';
import { RoomNightState } from './models/room-night-state.enum';
import type { RoomNight } from './models/room-night.schema';
import type { Room } from './models/room.schema';
import { todayUtc } from './room-dates';

/** A Mongoose query that resolves to `value`, with the chain the service uses. */
const chain = <T>(value: T) => {
  const query = {
    select: jest.fn(),
    collation: jest.fn(),
    sort: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  for (const step of ['select', 'collation', 'sort', 'lean'] as const) {
    query[step].mockReturnValue(query);
  }
  return query;
};

const NOW = new Date('2026-12-01T10:00:00.000Z');
const CHECK_IN = '2099-12-20';
const CHECK_OUT = '2099-12-23';
const OPEN = [{ from: '2099-12-01', to: '2100-01-01' }];

const hotel = (name: string) => ({
  _id: new Types.ObjectId(),
  name,
  addressLine: '1 Street',
  cityId: 'cairo',
  countryCode: 'EG',
  description: '',
  photos: [],
  starClass: 3,
  amenities: [],
  active: true,
  ratingCount: 0,
  averageRating: 0,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
});

const room = (
  hotelId: Types.ObjectId,
  maxOccupancy: number,
  pricePerNight = 10000,
  availability = OPEN,
) => ({
  _id: new Types.ObjectId(),
  hotelId,
  maxOccupancy,
  pricePerNight,
  availability,
});

const search = (change: Partial<SearchHotelsQueryDto> = {}) =>
  ({
    cityId: 'cairo',
    checkIn: CHECK_IN,
    checkOut: CHECK_OUT,
    guests: 2,
    rooms: 1,
    page: 1,
    limit: 10,
    skip: 0,
    sortBy: 'name',
    ...change,
  }) as SearchHotelsQueryDto;

const setUp = (
  hotels: ReturnType<typeof hotel>[],
  rooms: ReturnType<typeof room>[] = [],
  nights: Partial<RoomNight>[] = [],
) => {
  const hotelModel = { find: jest.fn(() => chain(hotels)) };
  const roomModel = { find: jest.fn(() => chain(rooms)) };
  const nightModel = { find: jest.fn(() => chain(nights)) };
  const service = new HotelSearchService(
    hotelModel as unknown as Model<Hotel>,
    roomModel as unknown as Model<Room>,
    nightModel as unknown as Model<RoomNight>,
  );
  return { service, hotelModel, roomModel, nightModel };
};

const validationError = (field: string, message: string) =>
  new BadRequestException({
    message: 'Validation failed',
    errors: [{ field, messages: [message] }],
  });

describe('HotelSearchService (HTL-11)', () => {
  it('lists active hotels of the city with a free room for every night', async () => {
    const garden = hotel('Garden');
    const { service, hotelModel, roomModel, nightModel } = setUp(
      [garden],
      [room(garden._id, 2, 12000), room(garden._id, 3, 9000)],
    );

    const page = await service.search(search(), NOW);

    expect(hotelModel.find).toHaveBeenCalledWith({
      cityId: 'cairo',
      active: true,
    });
    expect(roomModel.find).toHaveBeenCalledWith({
      hotelId: { $in: [garden._id] },
      active: true,
      availability: {
        $elemMatch: { from: { $lte: CHECK_IN }, to: { $gt: CHECK_IN } },
      },
    });
    expect(nightModel.find).toHaveBeenCalledWith({
      roomId: { $in: expect.any(Array) },
      date: { $gte: CHECK_IN, $lt: CHECK_OUT },
    });
    expect(page.meta).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
    expect(page.items[0]).toMatchObject({
      id: garden._id.toString(),
      name: 'Garden',
      freeRooms: 2,
      lowestPricePerNight: 9000,
      currency: 'USD',
    });
  });

  it('searches by country', async () => {
    const { service, hotelModel } = setUp([]);

    await service.search(search({ cityId: undefined, countryCode: 'EG' }), NOW);

    expect(hotelModel.find).toHaveBeenCalledWith({
      countryCode: 'EG',
      active: true,
    });
  });

  it('answers an empty page without reading rooms when no hotel is there', async () => {
    const { service, roomModel } = setUp([]);

    const page = await service.search(search(), NOW);

    expect(page).toEqual({
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
    expect(roomModel.find).not.toHaveBeenCalled();
  });

  it('leaves out a hotel whose free rooms cannot hold the guests', async () => {
    const small = hotel('Small');
    const big = hotel('Big');
    const { service } = setUp(
      [big, small],
      [room(small._id, 2), room(small._id, 2), room(big._id, 4)],
    );

    const page = await service.search(search({ guests: 4 }), NOW);

    expect(page.items.map((item) => item.name)).toEqual(['Big']);

    const twoRooms = await service.search(search({ guests: 4, rooms: 2 }), NOW);
    expect(twoRooms.items.map((item) => item.name)).toEqual(['Small']);
  });

  it('leaves out rooms that are taken or not available for every night', async () => {
    const garden = hotel('Garden');
    const blocked = room(garden._id, 4);
    const booked = room(garden._id, 4);
    const held = room(garden._id, 4);
    const expiredHold = room(garden._id, 2, 7000);
    const gap = room(garden._id, 4, 5000, [
      { from: '2099-12-01', to: '2099-12-21' },
      { from: '2099-12-22', to: '2100-01-01' },
    ]);
    const { service } = setUp(
      [garden],
      [blocked, booked, held, expiredHold, gap],
      [
        {
          roomId: blocked._id,
          date: '2099-12-20',
          state: RoomNightState.Blocked,
        },
        {
          roomId: booked._id,
          date: '2099-12-22',
          state: RoomNightState.Booked,
        },
        {
          roomId: held._id,
          date: '2099-12-21',
          state: RoomNightState.Held,
          holdExpiresAt: new Date(NOW.getTime() + 60_000),
        },
        {
          roomId: expiredHold._id,
          date: '2099-12-21',
          state: RoomNightState.Held,
          holdExpiresAt: new Date(NOW.getTime() - 60_000),
        },
      ],
    );

    const page = await service.search(search(), NOW);

    expect(page.items[0]).toMatchObject({
      freeRooms: 1,
      lowestPricePerNight: 7000,
    });
    const tooMany = await service.search(search({ guests: 3 }), NOW);
    expect(tooMany.items).toEqual([]);
  });

  it('gives the requested page and the total of all matches', async () => {
    const hotels = ['A', 'B', 'C'].map(hotel);
    const { service } = setUp(
      hotels,
      hotels.map((each) => room(each._id, 2)),
    );

    const page = await service.search(
      search({ page: 2, limit: 2, skip: 2 }),
      NOW,
    );

    expect(page.items.map((item) => item.name)).toEqual(['C']);
    expect(page.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  it.each([
    [
      'neither a city nor a country',
      { cityId: undefined },
      validationError('cityId', 'Give cityId or countryCode'),
    ],
    [
      'both a city and a country',
      { countryCode: 'EG' },
      validationError('cityId', 'Give cityId or countryCode, not both'),
    ],
    [
      'a check-in in the past',
      { checkIn: '2020-01-01', checkOut: '2020-01-03' },
      validationError('checkIn', 'checkIn cannot be in the past'),
    ],
    [
      'a stay of 367 nights',
      { checkIn: '2099-01-01', checkOut: '2100-01-03' },
      validationError('checkOut', 'A stay can have at most 366 nights'),
    ],
  ])('refuses %s with 400 and reads nothing', async (_label, change, error) => {
    const { service, hotelModel } = setUp([]);

    await expect(service.search(search(change), NOW)).rejects.toThrow(error);
    await expect(service.search(search(change), NOW)).rejects.toMatchObject({
      response: error.getResponse(),
    });
    expect(hotelModel.find).not.toHaveBeenCalled();
  });

  it('accepts a check-in today (UTC) and a stay of 366 nights', async () => {
    const { service } = setUp([]);
    const today = todayUtc();
    const year = Number(today.slice(0, 4));

    await expect(
      service.search(
        search({ checkIn: today, checkOut: `${year + 1}${today.slice(4)}` }),
        NOW,
      ),
    ).resolves.toMatchObject({ items: [] });
  });
});

describe('HotelSearchService: filters and order (HTL-12)', () => {
  const rated = (name: string, averageRating: number, ratingCount = 2) => ({
    ...hotel(name),
    averageRating,
    ratingCount,
  });

  /** Five hotels in the name order, each with one free room at its price. */
  const fiveHotels = () => {
    const hotels = [
      rated('Alpha', 4.5),
      hotel('Bravo'),
      rated('Charlie', 3),
      rated('Delta', 5),
      rated('Echo', 4),
    ];
    const prices = [20000, 5000, 10000, 30000, 10000];
    return setUp(
      hotels,
      hotels.map((each, i) => room(each._id, 2, prices[i])),
    );
  };

  const namesOf = (page: { items: { name: string }[] }) =>
    page.items.map((item) => item.name);

  it('refuses a minPrice above maxPrice with 400 and reads nothing', async () => {
    const { service, hotelModel } = setUp([]);
    const query = search({ minPrice: 20000, maxPrice: 10000 });
    const error = validationError('minPrice', HOTEL_PRICE_RANGE_MESSAGE);

    await expect(service.search(query, NOW)).rejects.toThrow(error);
    await expect(service.search(query, NOW)).rejects.toMatchObject({
      response: error.getResponse(),
    });
    expect(hotelModel.find).not.toHaveBeenCalled();
  });

  it('accepts a minPrice equal to maxPrice and keeps that exact price', async () => {
    const { service } = fiveHotels();

    const page = await service.search(
      search({ minPrice: 10000, maxPrice: 10000 }),
      NOW,
    );

    expect(namesOf(page)).toEqual(['Charlie', 'Echo']);
  });

  it('filters in memory: the hotel query is the same as without filters', async () => {
    const { service, hotelModel } = fiveHotels();

    await service.search(
      search({ minPrice: 1, maxPrice: 2, minRating: 5 }),
      NOW,
    );

    expect(hotelModel.find).toHaveBeenCalledWith({
      cityId: 'cairo',
      active: true,
    });
  });

  it('leaves out a hotel whose cheapest free room is below minPrice, even with a dearer room inside', async () => {
    const garden = hotel('Garden');
    const { service } = setUp(
      [garden],
      [room(garden._id, 2, 8000), room(garden._id, 2, 15000)],
    );

    const below = await service.search(search({ minPrice: 9000 }), NOW);
    const inside = await service.search(search({ maxPrice: 8000 }), NOW);

    expect(below).toMatchObject({ items: [], meta: { total: 0 } });
    expect(inside.items).toEqual([
      expect.objectContaining({ name: 'Garden', lowestPricePerNight: 8000 }),
    ]);
  });

  it('keeps hotels rated at least minRating and leaves out unrated ones', async () => {
    const { service } = fiveHotels();

    const page = await service.search(search({ minRating: 4.5 }), NOW);

    expect(namesOf(page)).toEqual(['Alpha', 'Delta']);
  });

  it('sorts by price cheapest first when no order is sent, ties in the name order', async () => {
    const { service } = fiveHotels();

    const page = await service.search(search({ sortBy: 'price' }), NOW);

    expect(namesOf(page)).toEqual([
      'Bravo',
      'Charlie',
      'Echo',
      'Alpha',
      'Delta',
    ]);
  });

  it('sorts by rating best first when no order is sent, unrated hotels last', async () => {
    const { service } = fiveHotels();

    const page = await service.search(search({ sortBy: 'rating' }), NOW);

    expect(namesOf(page)).toEqual([
      'Delta',
      'Alpha',
      'Echo',
      'Charlie',
      'Bravo',
    ]);
  });

  it('lets a sent order win over the default: rating asc, unrated still last', async () => {
    const { service } = fiveHotels();

    const page = await service.search(
      search({ sortBy: 'rating', sortOrder: 'asc' }),
      NOW,
    );

    expect(namesOf(page)).toEqual([
      'Charlie',
      'Echo',
      'Alpha',
      'Delta',
      'Bravo',
    ]);
  });

  it('filters and sorts before the page is cut, and counts the matches in total', async () => {
    const { service } = fiveHotels();
    // Matches, dearest first: Alpha 20000, Charlie 10000, Echo 10000.
    const query = { maxPrice: 20000, minRating: 1, sortBy: 'price' as const };

    const first = await service.search(
      search({ ...query, sortOrder: 'desc', page: 1, limit: 2, skip: 0 }),
      NOW,
    );
    const second = await service.search(
      search({ ...query, sortOrder: 'desc', page: 2, limit: 2, skip: 2 }),
      NOW,
    );

    expect(namesOf(first)).toEqual(['Alpha', 'Charlie']);
    expect(namesOf(second)).toEqual(['Echo']);
    expect(first.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(second.meta).toEqual({
      page: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
  });

  it('leaves out a hotel that cannot host the guests, even when it passes the filters', async () => {
    const small = rated('Small', 5);
    const { service } = setUp([small], [room(small._id, 1, 5000)]);

    const page = await service.search(search({ minRating: 1 }), NOW);

    expect(page).toMatchObject({ items: [], meta: { total: 0 } });
  });
});
