import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { SearchHotelsQueryDto } from './dto/search-hotels-query.dto';
import type { HotelAvailableRoomsService } from './hotel-available-rooms.service';
import { HotelSearchService } from './hotel-search.service';

const storedHotel = (name: string) => ({
  _id: new Types.ObjectId(),
  name,
  addressLine: '12 Nile Street',
  cityId: 'cairo',
  countryCode: 'EG',
  starClass: 4,
  amenities: [],
  photos: [],
  averageRating: 0,
  ratingCount: 0,
});

const freeRoom = (maxOccupancy: number, pricePerNight = 10000) => ({
  _id: new Types.ObjectId(),
  number: '101',
  type: 'Double',
  beds: 2,
  maxOccupancy,
  pricePerNight,
});

const search = (fields: Partial<SearchHotelsQueryDto> = {}) =>
  ({
    cityId: 'cairo',
    checkIn: '2026-12-10',
    checkOut: '2026-12-13',
    guests: 2,
    rooms: 1,
    page: 1,
    limit: 10,
    skip: 0,
    ...fields,
  }) as SearchHotelsQueryDto;

const setup = (
  hotels: ReturnType<typeof storedHotel>[],
  free: Map<string, ReturnType<typeof freeRoom>[]> = new Map(),
) => {
  const chain = {
    select: jest.fn(),
    sort: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(hotels),
  };
  for (const step of ['select', 'sort', 'lean'] as const) {
    chain[step].mockReturnValue(chain);
  }
  const hotelModel = { find: jest.fn().mockReturnValue(chain) };
  const availableRooms = {
    assertStay: jest.fn(),
    findFreeRoomsOfHotels: jest.fn().mockResolvedValue(free),
  };
  const service = new HotelSearchService(
    hotelModel as never,
    availableRooms as unknown as HotelAvailableRoomsService,
  );
  return { service, hotelModel, chain, availableRooms };
};

describe('HotelSearchService (HTL-11)', () => {
  it('searches the active hotels of the city, sorted by name', async () => {
    const { service, hotelModel, chain } = setup([]);

    await service.search(search());

    expect(hotelModel.find).toHaveBeenCalledWith({
      cityId: 'cairo',
      active: true,
    });
    expect(chain.sort).toHaveBeenCalledWith({ name: 1, _id: 1 });
  });

  it('searches the active hotels of the country', async () => {
    const { service, hotelModel } = setup([]);

    await service.search(search({ cityId: undefined, countryCode: 'EG' }));

    expect(hotelModel.find).toHaveBeenCalledWith({
      countryCode: 'EG',
      active: true,
    });
  });

  it('checks the stay before it reads anything', async () => {
    const { service, hotelModel, availableRooms } = setup([]);
    availableRooms.assertStay.mockImplementation(() => {
      throw new BadRequestException('The check-in date cannot be in the past');
    });

    await expect(service.search(search())).rejects.toThrow(BadRequestException);
    expect(hotelModel.find).not.toHaveBeenCalled();
  });

  it('keeps only the hotels whose free rooms can host the guests', async () => {
    const big = storedHotel('A Big Hotel');
    const small = storedHotel('B Small Hotel');
    const full = storedHotel('C Full Hotel');
    const { service, availableRooms } = setup(
      [big, small, full],
      new Map([
        [big._id.toString(), [freeRoom(2, 15000), freeRoom(3, 9000)]],
        [small._id.toString(), [freeRoom(1)]],
      ]),
    );

    const result = await service.search(search({ guests: 3 }));

    expect(availableRooms.findFreeRoomsOfHotels).toHaveBeenCalledWith(
      [big._id, small._id, full._id],
      { from: '2026-12-10', to: '2026-12-13' },
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        id: big._id.toString(),
        freeRooms: 2,
        cheapestPricePerNight: 9000,
      }),
    ]);
    expect(result.meta.total).toBe(1);
  });

  it('needs as many free rooms as asked', async () => {
    const hotel = storedHotel('A Hotel');
    const { service } = setup(
      [hotel],
      new Map([[hotel._id.toString(), [freeRoom(4)]]]),
    );

    const result = await service.search(search({ guests: 2, rooms: 2 }));

    expect(result.items).toEqual([]);
  });

  it('pages through the matching hotels', async () => {
    const hotels = ['A', 'B', 'C'].map((name) => storedHotel(name));
    const { service } = setup(
      hotels,
      new Map(hotels.map((hotel) => [hotel._id.toString(), [freeRoom(2)]])),
    );

    const result = await service.search(search({ page: 2, limit: 2, skip: 2 }));

    expect(result.items.map((hotel) => hotel.name)).toEqual(['C']);
    expect(result.meta).toEqual({
      page: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
  });
});
