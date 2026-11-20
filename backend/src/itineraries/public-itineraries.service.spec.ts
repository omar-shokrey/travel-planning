import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Mongoose, Types } from 'mongoose';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { City } from '../reference/models/city.schema';
import { Country } from '../reference/models/country.schema';
import { User } from '../users/models/user.schema';
import { SearchPublicItinerariesQueryDto } from './dto/search-public-itineraries-query.dto';
import { BudgetCategory } from './enums/budget-category.enum';
import { ItineraryModeration } from './enums/itinerary-moderation.enum';
import { ItineraryVisibility } from './enums/itinerary-visibility.enum';
import {
  Itinerary,
  type ItineraryDocument,
  ItinerarySchema,
} from './models/itinerary.schema';
import {
  escapeRegExp,
  PUBLICLY_VISIBLE,
  PublicItinerariesService,
  UNKNOWN_AUTHOR,
} from './public-itineraries.service';

// A real model that is never connected; every database call is replaced.
const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const ItineraryModel = mongoose.model(Itinerary.name, ItinerarySchema);

const authorId = new Types.ObjectId();
/** A stored activity image (ITN-12). */
const IMAGE = 'c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg';
const readerId = new Types.ObjectId().toString();

/** Replaces find().select().lean() on a small collection. */
const leanList = (rows: unknown[]) => ({
  find: jest.fn(() => ({
    select: () => ({ lean: () => Promise.resolve(rows) }),
  })),
});

describe('PublicItinerariesService', () => {
  let service: PublicItinerariesService;
  let users: ReturnType<typeof leanList>;
  let countries: ReturnType<typeof leanList>;
  let cities: ReturnType<typeof leanList>;

  /** A public itinerary by the author, with one day full of content. */
  const publicItinerary = (): ItineraryDocument =>
    new ItineraryModel({
      ownerId: authorId,
      title: 'Ten days in Egypt',
      countries: ['EG'],
      startDate: '2026-12-20',
      visibility: ItineraryVisibility.Public,
      dayCount: 1,
      days: [
        {
          cityId: 'cairo',
          notes: 'Arrive late',
          activities: [
            {
              name: 'Museum',
              cost: 2000,
              currency: 'EGP',
              images: [IMAGE],
            },
          ],
          budgetEntries: [
            { category: BudgetCategory.Food, amount: 500, currency: 'EGP' },
          ],
          transportCosts: [
            {
              mode: 'train',
              fromCityId: 'cairo',
              toCityId: 'luxor',
              amount: 9000,
              currency: 'EGP',
            },
          ],
        },
      ],
    }) as ItineraryDocument;

  /** The same public itinerary with the author's flight linked to its day (ITN-27). */
  const withLinkedBooking = (): ItineraryDocument => {
    const itinerary = publicItinerary();
    itinerary.days[0].linkedBookings.push({
      bookingType: 'flight',
      bookingId: new Types.ObjectId(),
      reference: 'FB-7KQ2MX',
      amount: 52000,
      currency: 'USD',
    } as never);
    return itinerary;
  };

  /** Replaces find().select().sort().skip().limit() and countDocuments(). */
  const withSearchResults = (
    found: ItineraryDocument[],
    total = found.length,
  ) => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue(found),
    };
    const find = jest
      .spyOn(ItineraryModel, 'find')
      .mockReturnValue(chain as never);
    jest
      .spyOn(ItineraryModel, 'countDocuments')
      .mockResolvedValue(total as never);
    return { chain, find };
  };
  const query = (fields: Partial<SearchPublicItinerariesQueryDto> = {}) =>
    Object.assign(new SearchPublicItinerariesQueryDto(), fields);

  beforeEach(async () => {
    users = leanList([{ _id: authorId, name: 'Sara Ahmed' }]);
    countries = leanList([]);
    cities = leanList([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        PublicItinerariesService,
        { provide: getModelToken(Itinerary.name), useValue: ItineraryModel },
        { provide: getModelToken(User.name), useValue: users },
        { provide: getModelToken(Country.name), useValue: countries },
        { provide: getModelToken(City.name), useValue: cities },
      ],
    }).compile();
    service = moduleRef.get(PublicItinerariesService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('search', () => {
    it('returns only publicly visible itineraries, newest first, with their author', async () => {
      const itinerary = publicItinerary();
      const { chain, find } = withSearchResults([itinerary]);

      const response = await service.search(query());

      expect(find).toHaveBeenCalledWith({ ...PUBLICLY_VISIBLE });
      expect(chain.select).toHaveBeenCalledWith('-days');
      expect(chain.sort).toHaveBeenCalledWith({ updatedAt: -1, _id: -1 });
      expect(response.items).toEqual([
        expect.objectContaining({
          id: itinerary.id as string,
          title: 'Ten days in Egypt',
          visibility: ItineraryVisibility.Public,
          author: { id: authorId.toString(), name: 'Sara Ahmed' },
          moderation: ItineraryModeration.Visible,
        }),
      ]);
    });

    it('filters by duration, country and city', async () => {
      const { find } = withSearchResults([]);

      await service.search(
        query({ minDays: 3, maxDays: 10, country: 'EG', city: 'cairo' }),
      );

      expect(find).toHaveBeenCalledWith({
        ...PUBLICLY_VISIBLE,
        dayCount: { $gte: 3, $lte: 10 },
        countries: 'EG',
        'days.cityId': 'cairo',
      });
    });

    it('matches the keyword in the title, the countries and the city names', async () => {
      countries.find.mockReturnValue({
        select: () => ({ lean: () => Promise.resolve([{ _id: 'EG' }]) }),
      });
      cities.find.mockReturnValue({
        select: () => ({ lean: () => Promise.resolve([{ _id: 'cairo' }]) }),
      });
      const { find } = withSearchResults([]);

      await service.search(query({ q: 'Cai' }));

      // The string form, not a RegExp object: in local runs against the
      // Atlas test database, a RegExp with the `i` flag inside `$or` never
      // got an answer (the same as in ACC-14).
      const pattern = { $regex: 'Cai', $options: 'i' };
      expect(find).toHaveBeenCalledWith({
        ...PUBLICLY_VISIBLE,
        $or: [
          { title: pattern },
          { countries: { $in: ['EG'] } },
          { 'days.cityId': { $in: ['cairo'] } },
        ],
      });
      expect(countries.find).toHaveBeenCalledWith({
        $or: [{ _id: 'CAI' }, { name: pattern }],
      });
    });

    it('matches the keyword as plain text, never as a pattern', async () => {
      const { find } = withSearchResults([]);

      await service.search(query({ q: '.*(' }));

      const filter = find.mock.calls[0][0] as unknown as {
        $or: { title: { $regex: string; $options: string } }[];
      };
      expect(filter.$or[0].title).toEqual({
        $regex: '\\.\\*\\(',
        $options: 'i',
      });
    });

    it('rejects a minimum duration above the maximum', async () => {
      const { find } = withSearchResults([]);

      await expect(
        service.search(query({ minDays: 5, maxDays: 2 })),
      ).rejects.toThrow(
        new BadRequestException('minDays must not be greater than maxDays'),
      );
      expect(find).not.toHaveBeenCalled();
    });

    it('names an author it cannot find "Unknown author"', async () => {
      users.find.mockReturnValue({
        select: () => ({ lean: () => Promise.resolve([]) }),
      });
      withSearchResults([publicItinerary()]);

      const response = await service.search(query());

      expect(response.items[0].author.name).toBe(UNKNOWN_AUTHOR);
    });
  });

  describe('listByAuthor (BLG-12)', () => {
    const page = (fields: Partial<PaginationQueryDto> = {}) =>
      Object.assign(new PaginationQueryDto(), fields);

    it('lists only the publicly visible itineraries of that author, newest first, without days', async () => {
      const itinerary = publicItinerary();
      const { chain, find } = withSearchResults([itinerary]);

      const response = await service.listByAuthor(authorId.toString(), page());

      expect(find).toHaveBeenCalledWith({
        ...PUBLICLY_VISIBLE,
        ownerId: authorId,
      });
      const filter = find.mock.calls[0][0] as unknown as { ownerId: unknown };
      expect(filter.ownerId).toBeInstanceOf(Types.ObjectId);
      expect(ItineraryModel.countDocuments).toHaveBeenCalledWith({
        ...PUBLICLY_VISIBLE,
        ownerId: authorId,
      });
      expect(chain.select).toHaveBeenCalledWith('-days');
      expect(chain.sort).toHaveBeenCalledWith({ updatedAt: -1, _id: -1 });
      expect(response.items).toEqual([
        expect.objectContaining({
          id: itinerary.id as string,
          title: 'Ten days in Egypt',
          visibility: ItineraryVisibility.Public,
          author: { id: authorId.toString(), name: 'Sara Ahmed' },
        }),
      ]);
      expect(response.items[0]).not.toHaveProperty('days');
    });

    it('reads the page asked for and counts every match', async () => {
      const { chain } = withSearchResults([publicItinerary()], 7);

      const response = await service.listByAuthor(
        authorId.toString(),
        page({ page: 3, limit: 2 }),
      );

      expect(chain.skip).toHaveBeenCalledWith(4);
      expect(chain.limit).toHaveBeenCalledWith(2);
      expect(response.meta).toEqual({
        page: 3,
        limit: 2,
        total: 7,
        totalPages: 4,
      });
    });

    it('answers an empty page without reading any author', async () => {
      withSearchResults([]);

      const response = await service.listByAuthor(authorId.toString(), page());

      expect(response).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
      expect(users.find).not.toHaveBeenCalled();
    });

    it('names an author it cannot find "Unknown author"', async () => {
      users.find.mockReturnValue({
        select: () => ({ lean: () => Promise.resolve([]) }),
      });
      withSearchResults([publicItinerary()]);

      const response = await service.listByAuthor(authorId.toString(), page());

      expect(response.items[0].author).toEqual({
        id: authorId.toString(),
        name: UNKNOWN_AUTHOR,
      });
    });
  });

  describe('findPublic', () => {
    it('returns the itinerary read-only with its author, days and activities', async () => {
      const itinerary = publicItinerary();
      const findOne = jest
        .spyOn(ItineraryModel, 'findOne')
        .mockResolvedValue(itinerary as never);

      const response = await service.findPublic(itinerary.id as string);

      expect(findOne).toHaveBeenCalledWith({
        _id: itinerary.id,
        ...PUBLICLY_VISIBLE,
      });
      expect(response.author).toEqual({
        id: authorId.toString(),
        name: 'Sara Ahmed',
      });
      expect(response.moderation).toBe(ItineraryModeration.Visible);
      expect(response.days[0].activities[0].name).toBe('Museum');
      expect(response.days[0].activities[0].images).toEqual([
        { filename: IMAGE, url: `/api/uploads/${IMAGE}` },
      ]);
      expect(response.cityGroups[0].budgetSubtotal).toEqual([
        { amount: 11500, currency: 'EGP' },
      ]);
    });

    it('answers 404 for an itinerary that is not publicly visible', async () => {
      jest.spyOn(ItineraryModel, 'findOne').mockResolvedValue(null as never);

      await expect(
        service.findPublic(new Types.ObjectId().toString()),
      ).rejects.toThrow(new NotFoundException('Itinerary not found'));
    });

    it("never shows the author's linked bookings, nor counts them in the subtotals (ITN-27)", async () => {
      const itinerary = withLinkedBooking();
      jest
        .spyOn(ItineraryModel, 'findOne')
        .mockResolvedValue(itinerary as never);

      const response = await service.findPublic(itinerary.id as string);

      expect(response.days[0].linkedBookings).toEqual([]);
      expect(response.cityGroups[0].budgetSubtotal).toEqual([
        { amount: 11500, currency: 'EGP' },
      ]);
      expect(JSON.stringify(response)).not.toContain('FB-7KQ2MX');
      expect(JSON.stringify(response)).not.toContain(
        itinerary.days[0].linkedBookings[0].bookingId.toString(),
      );
      // The stored itinerary is not changed by the public view.
      expect(itinerary.days[0].linkedBookings).toHaveLength(1);
    });
  });

  describe('clone', () => {
    it('makes a private copy for the caller that credits the original author', async () => {
      const source = publicItinerary();
      jest.spyOn(ItineraryModel, 'findOne').mockResolvedValue(source as never);
      const create = jest
        .spyOn(ItineraryModel, 'create')
        .mockImplementation(((data: Record<string, unknown>) =>
          Promise.resolve(new ItineraryModel(data))) as never);

      const response = await service.clone(source.id as string, readerId);

      expect(response.ownerId).toBe(readerId);
      expect(response.visibility).toBe(ItineraryVisibility.Private);
      expect(response.id).not.toBe(source.id);
      expect(response.clonedFrom).toEqual({
        itineraryId: source.id as string,
        authorId: authorId.toString(),
        authorName: 'Sara Ahmed',
      });
      expect(create).toHaveBeenCalledTimes(1);
    });

    it('copies every day, activity, budget entry and transport cost with new ids', async () => {
      const source = publicItinerary();
      jest.spyOn(ItineraryModel, 'findOne').mockResolvedValue(source as never);
      jest
        .spyOn(ItineraryModel, 'create')
        .mockImplementation(((data: Record<string, unknown>) =>
          Promise.resolve(new ItineraryModel(data))) as never);

      const response = await service.clone(source.id as string, readerId);
      const [day] = response.days;
      const [sourceDay] = source.days;

      expect(response.dayCount).toBe(1);
      expect(day).toMatchObject({ cityId: 'cairo', notes: 'Arrive late' });
      expect(day.id).not.toBe(sourceDay._id.toString());
      expect(day.activities).toEqual([
        {
          id: expect.any(String),
          name: 'Museum',
          cost: 2000,
          currency: 'EGP',
          // ITN-12: the clone lists the same file (see the README).
          images: [{ filename: IMAGE, url: `/api/uploads/${IMAGE}` }],
        },
      ]);
      expect(day.activities[0].id).not.toBe(
        sourceDay.activities[0]._id.toString(),
      );
      expect(day.transportCosts[0].id).not.toBe(
        sourceDay.transportCosts[0]._id.toString(),
      );
      expect(response.cityGroups[0].budgetSubtotal).toEqual([
        { amount: 11500, currency: 'EGP' },
      ]);
    });

    it("never copies the author's linked bookings (ITN-27)", async () => {
      const source = withLinkedBooking();
      jest.spyOn(ItineraryModel, 'findOne').mockResolvedValue(source as never);
      const create = jest
        .spyOn(ItineraryModel, 'create')
        .mockImplementation(((data: Record<string, unknown>) =>
          Promise.resolve(new ItineraryModel(data))) as never);

      const response = await service.clone(source.id as string, readerId);

      const [data] = create.mock.calls[0] as unknown as [
        { days: { linkedBookings: unknown[] }[] },
      ];
      expect(data.days[0].linkedBookings).toEqual([]);
      expect(response.days[0].linkedBookings).toEqual([]);
      expect(response.cityGroups[0].budgetSubtotal).toEqual([
        { amount: 11500, currency: 'EGP' },
      ]);
    });

    it('answers 404 and creates nothing for an itinerary that is not public', async () => {
      jest.spyOn(ItineraryModel, 'findOne').mockResolvedValue(null as never);
      const create = jest.spyOn(ItineraryModel, 'create');

      await expect(
        service.clone(new Types.ObjectId().toString(), readerId),
      ).rejects.toThrow(NotFoundException);
      expect(create).not.toHaveBeenCalled();
    });
  });

  it('escapes every character that has a meaning in a pattern', () => {
    expect(escapeRegExp('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe(
      'a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o',
    );
  });

  describe('findPublicSummary (BLG-13)', () => {
    const withFound = (found: unknown) => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(found),
      };
      const findOne = jest
        .spyOn(ItineraryModel, 'findOne')
        .mockReturnValue(chain as never);
      return { chain, findOne };
    };

    it('reads with the same filter as search and the public view: public, not hidden, owner active', async () => {
      const id = new Types.ObjectId();
      const { chain, findOne } = withFound(null);

      await service.findPublicSummary(id.toString());

      expect(findOne).toHaveBeenCalledWith({
        _id: id.toString(),
        ...PUBLICLY_VISIBLE,
      });
      expect(PUBLICLY_VISIBLE).toEqual({
        visibility: ItineraryVisibility.Public,
        moderation: ItineraryModeration.Visible,
        authorDeactivated: false,
      });
      expect(chain.select).toHaveBeenCalledWith(
        'title countries startDate dayCount',
      );
    });

    it('gives the summary, with exactly these fields, of a publicly visible itinerary', async () => {
      const id = new Types.ObjectId();
      withFound({
        _id: id,
        title: 'Ten days in Egypt',
        countries: ['EG'],
        startDate: '2026-12-20',
        dayCount: 10,
      });

      expect(await service.findPublicSummary(id.toString())).toEqual({
        id: id.toString(),
        title: 'Ten days in Egypt',
        countries: ['EG'],
        startDate: '2026-12-20',
        dayCount: 10,
      });
    });

    it('gives null when the filter finds nothing: missing, private, hidden or owner deactivated', async () => {
      withFound(null);

      expect(
        await service.findPublicSummary(new Types.ObjectId().toString()),
      ).toBeNull();
    });
  });

  describe('findPublicCards (BON-02)', () => {
    const withRows = (rows: unknown[]) => {
      Object.assign(users, { collection: { collectionName: 'users' } });
      const exec = jest.fn().mockResolvedValue(rows);
      const aggregate = jest
        .spyOn(ItineraryModel, 'aggregate')
        .mockReturnValue({ exec } as never);
      return { aggregate };
    };

    it('reads the cards of every id in one aggregation, with the same filter as search, and joins only the author name', async () => {
      const a = new Types.ObjectId();
      const b = new Types.ObjectId();
      const { aggregate } = withRows([]);

      await service.findPublicCards([a, b.toString(), a.toString()]);

      expect(aggregate).toHaveBeenCalledTimes(1);
      const [pipeline] = aggregate.mock.calls[0] as unknown as [
        Record<string, unknown>[],
      ];
      expect(pipeline[0]).toEqual({
        $match: { _id: { $in: [a, b] }, ...PUBLICLY_VISIBLE },
      });
      expect(pipeline[1]).toEqual({
        $project: {
          title: 1,
          countries: 1,
          startDate: 1,
          dayCount: 1,
          ownerId: 1,
        },
      });
      expect(pipeline[2]).toEqual({
        $lookup: {
          from: 'users',
          localField: 'ownerId',
          foreignField: '_id',
          pipeline: [{ $project: { _id: 0, name: 1 } }],
          as: 'author',
        },
      });
      expect(pipeline[3]).toEqual({ $project: { ownerId: 0 } });
    });

    it('gives each card the header fields and the author name, never the owner id, keyed by id', async () => {
      const id = new Types.ObjectId();
      withRows([
        {
          _id: id,
          title: 'Ten days in Egypt',
          countries: ['EG'],
          startDate: '2026-12-20',
          dayCount: 10,
          author: [{ name: 'Sara Ahmed' }],
        },
      ]);

      const cards = await service.findPublicCards([id]);

      expect([...cards.entries()]).toEqual([
        [
          id.toString(),
          {
            id: id.toString(),
            title: 'Ten days in Egypt',
            countries: ['EG'],
            startDate: '2026-12-20',
            dayCount: 10,
            authorName: 'Sara Ahmed',
          },
        ],
      ]);
    });

    it(`names a missing author "${UNKNOWN_AUTHOR}"`, async () => {
      const id = new Types.ObjectId();
      withRows([
        {
          _id: id,
          title: 'Ten days in Egypt',
          countries: ['EG'],
          startDate: '2026-12-20',
          dayCount: 10,
          author: [],
        },
      ]);

      expect(
        (await service.findPublicCards([id])).get(id.toString())?.authorName,
      ).toBe(UNKNOWN_AUTHOR);
    });

    it('reads nothing for no ids or ids that are not valid', async () => {
      const { aggregate } = withRows([]);

      expect((await service.findPublicCards([])).size).toBe(0);
      expect((await service.findPublicCards(['not-an-id'])).size).toBe(0);
      expect(aggregate).not.toHaveBeenCalled();
    });
  });
});
