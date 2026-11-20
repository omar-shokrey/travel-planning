import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types, type Model } from 'mongoose';
import type { HotelsService } from '../hotels/hotels.service';
import type { PublicItinerariesService } from '../itineraries/public-itineraries.service';
import { FavouriteTargetType } from './enums/favourite-target-type.enum';
import {
  FAVOURITE_HOTEL_NOT_FOUND_MESSAGE,
  FAVOURITE_ITINERARY_NOT_FOUND_MESSAGE,
  FAVOURITE_NOT_FOUND_MESSAGE,
  FAVOURITES_LIMIT_MESSAGE,
  FAVOURITES_MAX_PER_USER,
} from './favourites.constants';
import { FavouritesService } from './favourites.service';
import type { Favourite } from './models/favourite.schema';

const USER_ID = '6740f1c2a4b5c6d7e8f9a001';
const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';
const ITINERARY_ID = '6741c0ffee0ddba11ad0c0de';
const FAVOURITE_ID = new Types.ObjectId('6741c0ffee0ddba11ad0f00d');
const ADDED = new Date('2026-11-20T18:00:00.000Z');

const hotelCard = {
  id: HOTEL_ID,
  name: 'Cairo Garden Hotel',
  cityId: 'EG-CAI',
  countryCode: 'EG',
  starClass: 4,
  averageRating: 4.5,
  ratingCount: 12,
  firstPhoto: null,
};
const itineraryCard = {
  id: ITINERARY_ID,
  title: 'Ten days in Egypt',
  countries: ['EG'],
  startDate: '2026-12-20',
  dayCount: 10,
  authorName: 'Sara Ahmed',
};

const stored = (
  targetType: FavouriteTargetType = FavouriteTargetType.Hotel,
  targetId = HOTEL_ID,
  id = FAVOURITE_ID,
) => ({
  _id: id,
  targetType,
  targetId: new Types.ObjectId(targetId),
  createdAt: ADDED,
});

interface Chain {
  select: jest.Mock<Chain, []>;
  sort: jest.Mock<Chain, []>;
  skip: jest.Mock<Chain, []>;
  limit: jest.Mock<Chain, []>;
  lean: jest.Mock<Chain, []>;
  exec: jest.Mock<Promise<unknown>, []>;
}

const chain = (result: () => unknown): Chain => {
  const query: Chain = {
    select: jest.fn(() => query),
    sort: jest.fn(() => query),
    skip: jest.fn(() => query),
    limit: jest.fn(() => query),
    lean: jest.fn(() => query),
    exec: jest.fn(() => {
      const value = result();
      return value instanceof Error
        ? Promise.reject(value)
        : Promise.resolve(value);
    }),
  };
  return query;
};

const duplicateKey = () =>
  Object.assign(new Error('E11000 duplicate key'), { code: 11000 });

function setup(
  options: {
    /** What each findOne by key returns, in order (null: none). */
    found?: unknown[];
    count?: number;
    /** What the upsert does: true, it found the favourite already; an Error, it threw. */
    upsert?: { updatedExisting: boolean } | Error;
    page?: unknown[];
    total?: number;
    deleted?: unknown;
    hotels?: Map<string, typeof hotelCard>;
    itineraries?: Map<string, typeof itineraryCard>;
  } = {},
) {
  const found = [...(options.found ?? [null])];
  const model = {
    findOne: jest.fn((..._args: unknown[]) =>
      chain(() => (found.length > 0 ? found.shift() : null)),
    ),
    countDocuments: jest.fn((..._args: unknown[]) => ({
      exec: jest.fn().mockResolvedValue(options.count ?? options.total ?? 0),
    })),
    findOneAndUpdate: jest.fn((...args: unknown[]) => ({
      exec: jest.fn(() => {
        // The stored favourite is the key the upsert was given.
        const saved = args[0] as {
          targetType: FavouriteTargetType;
          targetId: Types.ObjectId;
        };
        return options.upsert instanceof Error
          ? Promise.reject(options.upsert)
          : Promise.resolve({
              value: stored(saved.targetType, saved.targetId.toString()),
              lastErrorObject: {
                updatedExisting: options.upsert?.updatedExisting ?? false,
              },
            });
      }),
    })),
    find: jest.fn((..._args: unknown[]) => chain(() => options.page ?? [])),
    findOneAndDelete: jest.fn((..._args: unknown[]) =>
      chain(() =>
        options.deleted === undefined ? { _id: FAVOURITE_ID } : options.deleted,
      ),
    ),
  };
  const hotels = {
    findPublicSummaries: jest
      .fn()
      .mockResolvedValue(options.hotels ?? new Map([[HOTEL_ID, hotelCard]])),
  };
  const itineraries = {
    findPublicCards: jest
      .fn()
      .mockResolvedValue(
        options.itineraries ?? new Map([[ITINERARY_ID, itineraryCard]]),
      ),
  };
  const service = new FavouritesService(
    model as unknown as Model<Favourite>,
    hotels as unknown as HotelsService,
    itineraries as unknown as PublicItinerariesService,
  );
  return { service, model, hotels, itineraries };
}

const key = (targetType: FavouriteTargetType, targetId: string) => ({
  userId: new Types.ObjectId(USER_ID),
  targetType,
  targetId: new Types.ObjectId(targetId),
});

describe('FavouritesService.add (BON-02)', () => {
  it('saves an active hotel once, with one atomic upsert on the user and the target, and answers created', async () => {
    const { service, model, hotels } = setup();

    const result = await service.add(USER_ID, {
      targetType: FavouriteTargetType.Hotel,
      targetId: HOTEL_ID,
    });

    expect(hotels.findPublicSummaries).toHaveBeenCalledWith([HOTEL_ID]);
    const hotelKey = key(FavouriteTargetType.Hotel, HOTEL_ID);
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      hotelKey,
      { $setOnInsert: hotelKey },
      {
        upsert: true,
        returnDocument: 'after',
        includeResultMetadata: true,
        lean: true,
      },
    );
    // No second read after the upsert.
    expect(model.findOne).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(true);
    expect(result.favourite).toMatchObject({
      id: FAVOURITE_ID.toString(),
      targetType: 'hotel',
      targetId: HOTEL_ID,
      available: true,
      hotel: { name: 'Cairo Garden Hotel' },
    });
  });

  it('accepts an id written in upper case: it is the same target', async () => {
    const { service, hotels, model } = setup();

    const result = await service.add(USER_ID, {
      targetType: FavouriteTargetType.Hotel,
      targetId: HOTEL_ID.toUpperCase(),
    });

    expect(result.created).toBe(true);
    expect(hotels.findPublicSummaries).toHaveBeenCalledWith([HOTEL_ID]);
    expect(model.findOneAndUpdate.mock.calls[0][0]).toEqual(
      key(FavouriteTargetType.Hotel, HOTEL_ID),
    );
  });

  it('saves a public itinerary, checked with the itinerary cards', async () => {
    const { service, itineraries, hotels } = setup();

    const result = await service.add(USER_ID, {
      targetType: FavouriteTargetType.Itinerary,
      targetId: ITINERARY_ID,
    });

    expect(itineraries.findPublicCards).toHaveBeenCalledWith([ITINERARY_ID]);
    expect(hotels.findPublicSummaries).not.toHaveBeenCalled();
    expect(result.favourite.itinerary?.title).toBe('Ten days in Egypt');
  });

  it('answers 404 "Hotel not found" for a missing or deactivated hotel, and saves nothing', async () => {
    const { service, model } = setup({ hotels: new Map() });

    await expect(
      service.add(USER_ID, {
        targetType: FavouriteTargetType.Hotel,
        targetId: HOTEL_ID,
      }),
    ).rejects.toEqual(new NotFoundException(FAVOURITE_HOTEL_NOT_FOUND_MESSAGE));
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('answers 404 "Itinerary not found" for an itinerary that is not public now, and saves nothing', async () => {
    const { service, model } = setup({ itineraries: new Map() });

    await expect(
      service.add(USER_ID, {
        targetType: FavouriteTargetType.Itinerary,
        targetId: ITINERARY_ID,
      }),
    ).rejects.toEqual(
      new NotFoundException(FAVOURITE_ITINERARY_NOT_FOUND_MESSAGE),
    );
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns the existing favourite, not created, when the target is saved already, and counts nothing', async () => {
    const { service, model } = setup({ found: [stored()] });

    const result = await service.add(USER_ID, {
      targetType: FavouriteTargetType.Hotel,
      targetId: HOTEL_ID,
    });

    expect(result.created).toBe(false);
    expect(result.favourite.id).toBe(FAVOURITE_ID.toString());
    expect(model.countDocuments).not.toHaveBeenCalled();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it(`answers 409 when the user already has ${FAVOURITES_MAX_PER_USER} favourites, and saves nothing`, async () => {
    const { service, model } = setup({
      count: FAVOURITES_MAX_PER_USER,
      found: [null, null],
    });

    await expect(
      service.add(USER_ID, {
        targetType: FavouriteTargetType.Hotel,
        targetId: HOTEL_ID,
      }),
    ).rejects.toEqual(new ConflictException(FAVOURITES_LIMIT_MESSAGE));
    expect(model.countDocuments).toHaveBeenCalledWith({
      userId: new Types.ObjectId(USER_ID),
    });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('answers 200 with the favourite, not 409, when the same add at the same moment saved it as the last one before the limit', async () => {
    const { service, model } = setup({
      count: FAVOURITES_MAX_PER_USER,
      found: [null, stored()],
    });

    await expect(
      service.add(USER_ID, {
        targetType: FavouriteTargetType.Hotel,
        targetId: HOTEL_ID,
      }),
    ).resolves.toMatchObject({
      created: false,
      favourite: { id: FAVOURITE_ID.toString() },
    });
    expect(model.findOne).toHaveBeenCalledTimes(2);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it(`still saves the ${FAVOURITES_MAX_PER_USER}th favourite`, async () => {
    const { service } = setup({ count: FAVOURITES_MAX_PER_USER - 1 });

    await expect(
      service.add(USER_ID, {
        targetType: FavouriteTargetType.Hotel,
        targetId: HOTEL_ID,
      }),
    ).resolves.toMatchObject({ created: true });
  });

  it('answers with the winner, not created, when an add at the same moment won the unique index', async () => {
    const { service, model } = setup({
      upsert: duplicateKey(),
      found: [null, stored()],
    });

    await expect(
      service.add(USER_ID, {
        targetType: FavouriteTargetType.Hotel,
        targetId: HOTEL_ID,
      }),
    ).resolves.toMatchObject({
      created: false,
      favourite: { id: FAVOURITE_ID.toString() },
    });
    // The upsert ran and lost: the winner is read after it.
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(model.findOne).toHaveBeenCalledTimes(2);
  });

  it('answers not created when the upsert found a favourite saved in between', async () => {
    const { service } = setup({ upsert: { updatedExisting: true } });

    await expect(
      service.add(USER_ID, {
        targetType: FavouriteTargetType.Hotel,
        targetId: HOTEL_ID,
      }),
    ).resolves.toMatchObject({ created: false });
  });

  it('passes on another database error', async () => {
    const failure = new Error('database down');
    const { service } = setup({ upsert: failure });

    await expect(
      service.add(USER_ID, {
        targetType: FavouriteTargetType.Hotel,
        targetId: HOTEL_ID,
      }),
    ).rejects.toBe(failure);
  });

  it('answers 404 "Favourite not found" when the winner of a race was removed before it could be read', async () => {
    const { service } = setup({ upsert: duplicateKey(), found: [null, null] });

    await expect(
      service.add(USER_ID, {
        targetType: FavouriteTargetType.Hotel,
        targetId: HOTEL_ID,
      }),
    ).rejects.toEqual(new NotFoundException(FAVOURITE_NOT_FOUND_MESSAGE));
  });
});

describe('FavouritesService.list (BON-02)', () => {
  const query = { page: 2, limit: 5, skip: 5 } as never;

  it("reads one page of the user's favourites, newest first, and counts with the same filter", async () => {
    const { service, model } = setup({ page: [], total: 7 });

    const result = await service.list(USER_ID, query);

    const filter = { userId: new Types.ObjectId(USER_ID) };
    expect(model.find).toHaveBeenCalledWith(filter);
    expect(model.countDocuments).toHaveBeenCalledWith(filter);
    const cursor = model.find.mock.results[0].value as Chain;
    expect(cursor.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(cursor.skip).toHaveBeenCalledWith(5);
    expect(cursor.limit).toHaveBeenCalledWith(5);
    expect(result.meta).toEqual({
      page: 2,
      limit: 5,
      total: 7,
      totalPages: 2,
    });
  });

  it('filters by target type when asked', async () => {
    const { service, model } = setup();

    await service.list(USER_ID, {
      page: 1,
      limit: 10,
      skip: 0,
      targetType: FavouriteTargetType.Itinerary,
    } as never);

    expect(model.find).toHaveBeenCalledWith({
      userId: new Types.ObjectId(USER_ID),
      targetType: FavouriteTargetType.Itinerary,
    });
  });

  it('reads the cards of the whole page with one query per type, and none for a type with no favourite', async () => {
    const otherHotel = '6740f1c2a4b5c6d7e8f90999';
    const { service, hotels, itineraries } = setup({
      page: [
        stored(FavouriteTargetType.Hotel, HOTEL_ID),
        stored(FavouriteTargetType.Hotel, otherHotel),
      ],
      total: 2,
    });

    await service.list(USER_ID, query);

    expect(hotels.findPublicSummaries).toHaveBeenCalledTimes(1);
    expect(hotels.findPublicSummaries).toHaveBeenCalledWith([
      HOTEL_ID,
      otherHotel,
    ]);
    expect(itineraries.findPublicCards).not.toHaveBeenCalled();
  });

  it('keeps a target that is no longer public in the list, as not available', async () => {
    const { service } = setup({
      page: [
        stored(FavouriteTargetType.Hotel, HOTEL_ID),
        stored(FavouriteTargetType.Itinerary, ITINERARY_ID),
      ],
      total: 2,
      itineraries: new Map(),
    });

    const result = await service.list(USER_ID, query);

    expect(result.items.map((item) => item.available)).toEqual([true, false]);
    expect(result.items[1]).toMatchObject({ itinerary: null, hotel: null });
  });
});

describe('FavouritesService.remove (BON-02)', () => {
  it("deletes the user's own favourite, by its id and the user in one query", async () => {
    const { service, model } = setup();

    await service.remove(FAVOURITE_ID.toString(), USER_ID);

    expect(model.findOneAndDelete).toHaveBeenCalledWith({
      _id: FAVOURITE_ID.toString(),
      userId: new Types.ObjectId(USER_ID),
    });
  });

  it("answers the same 404 for another user's favourite or a missing one", async () => {
    const { service } = setup({ deleted: null });

    await expect(
      service.remove(FAVOURITE_ID.toString(), USER_ID),
    ).rejects.toEqual(new NotFoundException(FAVOURITE_NOT_FOUND_MESSAGE));
  });
});
