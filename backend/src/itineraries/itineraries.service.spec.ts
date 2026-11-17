import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Error as MongooseError, Mongoose, Types } from 'mongoose';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { City } from '../reference/models/city.schema';
import { Country } from '../reference/models/country.schema';
import { ItineraryModeration } from './enums/itinerary-moderation.enum';
import { ItineraryVisibility } from './enums/itinerary-visibility.enum';
import { ITINERARY_CHANGED_MESSAGE } from './itineraries.constants';
import { ItinerariesService } from './itineraries.service';
import {
  Itinerary,
  type ItineraryDocument,
  ItinerarySchema,
} from './models/itinerary.schema';

// A real model that is never connected: documents validate and behave as in
// the app, and every database call is replaced below.
const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const ItineraryModel = mongoose.model(Itinerary.name, ItinerarySchema);

const ownerId = new Types.ObjectId().toString();
const otherUserId = new Types.ObjectId().toString();
const KNOWN_COUNTRIES = ['EG', 'AE', 'GB'];
const KNOWN_CITIES = ['cairo', 'dubai'];

const createDto = {
  title: 'Ten days in Egypt',
  countries: ['EG'],
  startDate: '2026-12-20',
};

describe('ItinerariesService', () => {
  let service: ItinerariesService;
  let createSpy: jest.SpiedFunction<typeof ItineraryModel.create>;
  let findByIdSpy: jest.SpiedFunction<typeof ItineraryModel.findById>;
  let countryFind: jest.Mock;
  let cityExists: jest.Mock;

  /** An itinerary that is "in the database": findById returns it. */
  const stored = (owner = ownerId): ItineraryDocument => {
    const itinerary = new ItineraryModel({
      ...createDto,
      ownerId: new Types.ObjectId(owner),
    }) as ItineraryDocument;
    jest.spyOn(itinerary, 'save').mockResolvedValue(itinerary);
    jest.spyOn(itinerary, 'deleteOne').mockResolvedValue({} as never);
    findByIdSpy.mockResolvedValue(itinerary as never);
    return itinerary;
  };

  beforeEach(async () => {
    createSpy = jest
      .spyOn(ItineraryModel, 'create')
      .mockImplementation(
        (async (data: Record<string, unknown>) =>
          new ItineraryModel(data)) as never,
      );
    findByIdSpy = jest
      .spyOn(ItineraryModel, 'findById')
      .mockResolvedValue(null as never);

    // countries.find({ _id: { $in: codes } }).select('_id').lean()
    countryFind = jest.fn((filter: { _id: { $in: string[] } }) => ({
      select: () => ({
        lean: () =>
          Promise.resolve(
            filter._id.$in
              .filter((code) => KNOWN_COUNTRIES.includes(code))
              .map((code) => ({ _id: code })),
          ),
      }),
    }));

    // cities.exists({ _id: cityId })
    cityExists = jest.fn((filter: { _id: string }) =>
      Promise.resolve(
        KNOWN_CITIES.includes(filter._id) ? { _id: filter._id } : null,
      ),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ItinerariesService,
        { provide: getModelToken(Itinerary.name), useValue: ItineraryModel },
        {
          provide: getModelToken(Country.name),
          useValue: { find: countryFind },
        },
        { provide: getModelToken(City.name), useValue: { exists: cityExists } },
      ],
    }).compile();
    service = moduleRef.get(ItinerariesService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('admin moderation (GEN-10)', () => {
    /** A query whose chain (select, lean) ends in `result`. */
    const query = (result: unknown) => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(result),
      };
      return chain;
    };
    const id = new Types.ObjectId().toString();

    it.each([
      [1, true],
      [0, false],
    ])('existsById: a count of %p is %p', async (count, expected) => {
      const spy = jest
        .spyOn(ItineraryModel, 'countDocuments')
        .mockReturnValue(query(count) as never);

      expect(await service.existsById(id)).toBe(expected);
      expect(spy).toHaveBeenCalledWith({ _id: id });
    });

    it('hides an itinerary that is not hidden yet, in one conditional update', async () => {
      const spy = jest
        .spyOn(ItineraryModel, 'findOneAndUpdate')
        .mockReturnValue(query({ _id: id }) as never);

      expect(await service.setHidden(id, true)).toBe(true);
      expect(spy).toHaveBeenCalledWith(
        { _id: id, moderation: { $ne: ItineraryModeration.Hidden } },
        { $set: { moderation: ItineraryModeration.Hidden } },
        { timestamps: false },
      );
    });

    it('shows a hidden itinerary again, only if it is hidden', async () => {
      const spy = jest
        .spyOn(ItineraryModel, 'findOneAndUpdate')
        .mockReturnValue(query({ _id: id }) as never);

      expect(await service.setHidden(id, false)).toBe(true);
      expect(spy).toHaveBeenCalledWith(
        { _id: id, moderation: ItineraryModeration.Hidden },
        { $set: { moderation: ItineraryModeration.Visible } },
        { timestamps: false },
      );
    });

    it('returns false when nothing matched (missing or already in that state)', async () => {
      jest
        .spyOn(ItineraryModel, 'findOneAndUpdate')
        .mockReturnValue(query(null) as never);

      expect(await service.setHidden(id, true)).toBe(false);
    });

    it('returns null when deleting an itinerary that does not exist', async () => {
      jest
        .spyOn(ItineraryModel, 'findByIdAndDelete')
        .mockReturnValue(query(null) as never);

      expect(await service.removeByAdmin(id)).toBeNull();
    });

    it('deletes an itinerary without images and returns no file', async () => {
      const deleteSpy = jest
        .spyOn(ItineraryModel, 'findByIdAndDelete')
        .mockReturnValue(query({ days: [{ activities: [] }] }) as never);
      const findSpy = jest.spyOn(ItineraryModel, 'find');

      expect(await service.removeByAdmin(id)).toEqual([]);
      expect(deleteSpy).toHaveBeenCalledWith(id);
      expect(findSpy).not.toHaveBeenCalled();
    });

    it('returns the activity images that no other itinerary (a clone) still uses', async () => {
      jest.spyOn(ItineraryModel, 'findByIdAndDelete').mockReturnValue(
        query({
          days: [
            { activities: [{ images: ['a.jpg', 'b.jpg'] }] },
            { activities: [{ images: ['c.png', 'a.jpg'] }, {}] },
          ],
        }) as never,
      );
      const findSpy = jest
        .spyOn(ItineraryModel, 'find')
        .mockReturnValue(
          query([{ days: [{ activities: [{ images: ['b.jpg'] }] }] }]) as never,
        );

      expect(await service.removeByAdmin(id)).toEqual(['a.jpg', 'c.png']);
      expect(findSpy).toHaveBeenCalledWith({
        'days.activities.images': { $in: ['a.jpg', 'b.jpg', 'c.png'] },
      });
    });
  });

  describe('create', () => {
    it('saves the itinerary for the logged-in user and returns it', async () => {
      const response = await service.create(createDto, ownerId);

      expect(response).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        ownerId,
        title: 'Ten days in Egypt',
        countries: ['EG'],
        startDate: '2026-12-20',
        visibility: ItineraryVisibility.Private,
        moderation: ItineraryModeration.Visible,
        dayCount: 0,
      });
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    it('is private by default', async () => {
      const response = await service.create(createDto, ownerId);

      expect(response.visibility).toBe(ItineraryVisibility.Private);
    });

    it('takes the owner from the login, never from the body', async () => {
      const body = { ...createDto, ownerId: otherUserId, visibility: 'public' };

      const response = await service.create(body, ownerId);

      expect(response.ownerId).toBe(ownerId);
      expect(response.visibility).toBe(ItineraryVisibility.Private);
    });

    it('rejects a country that is not in the country list and saves nothing', async () => {
      const dto = { ...createDto, countries: ['EG', 'ZZ', 'QQ'] };

      await expect(service.create(dto, ownerId)).rejects.toThrow(
        new BadRequestException('Unknown country code: ZZ, QQ'),
      );
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('accepts several countries from the list', async () => {
      const dto = { ...createDto, countries: ['EG', 'AE', 'GB'] };

      const response = await service.create(dto, ownerId);

      expect(response.countries).toEqual(['EG', 'AE', 'GB']);
    });
  });

  describe('findMine', () => {
    /** Replaces find().sort().skip().limit() and countDocuments(). */
    const withItineraries = (found: ItineraryDocument[], total: number) => {
      const chain = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(found),
      };
      const findSpy = jest
        .spyOn(ItineraryModel, 'find')
        .mockReturnValue(chain as never);
      const countSpy = jest
        .spyOn(ItineraryModel, 'countDocuments')
        .mockResolvedValue(total as never);
      return { chain, findSpy, countSpy };
    };
    const page = (page: number, limit: number) =>
      Object.assign(new PaginationQueryDto(), { page, limit });

    it('returns only the itineraries of the logged-in user', async () => {
      const { findSpy, countSpy } = withItineraries([stored()], 1);

      await service.findMine(page(1, 10), ownerId);

      const filter = { ownerId: new Types.ObjectId(ownerId) };
      expect(findSpy).toHaveBeenCalledWith(filter);
      expect(countSpy).toHaveBeenCalledWith(filter);
    });

    it('sorts by the most recently updated first', async () => {
      const { chain } = withItineraries([], 0);

      await service.findMine(page(1, 10), ownerId);

      expect(chain.sort).toHaveBeenCalledWith({ updatedAt: -1, _id: -1 });
    });

    it('reads the requested page', async () => {
      const { chain } = withItineraries([], 25);

      const response = await service.findMine(page(3, 10), ownerId);

      expect(chain.skip).toHaveBeenCalledWith(20);
      expect(chain.limit).toHaveBeenCalledWith(10);
      expect(response.meta).toEqual({
        page: 3,
        limit: 10,
        total: 25,
        totalPages: 3,
      });
    });

    it('returns the list fields of each itinerary', async () => {
      const itinerary = stored();
      withItineraries([itinerary], 1);

      const response = await service.findMine(page(1, 10), ownerId);

      expect(response.items).toEqual([
        {
          id: itinerary.id as string,
          ownerId,
          title: 'Ten days in Egypt',
          countries: ['EG'],
          startDate: '2026-12-20',
          visibility: ItineraryVisibility.Private,
          moderation: ItineraryModeration.Visible,
          dayCount: 0,
        },
      ]);
    });

    it('returns an empty list when the user has no itineraries', async () => {
      withItineraries([], 0);

      const response = await service.findMine(page(1, 10), ownerId);

      expect(response).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });
  });

  describe('findOne', () => {
    it('returns the itinerary of the logged-in user with its days', async () => {
      const itinerary = stored();
      itinerary.days.push({ cityId: 'cairo' } as never);

      const response = await service.findOne(itinerary.id as string, ownerId);

      expect(response).toMatchObject({
        id: itinerary.id as string,
        title: 'Ten days in Egypt',
        days: [{ dayNumber: 1, date: '2026-12-20', cityId: 'cairo' }],
      });
    });

    it('answers 404 when the itinerary does not exist', async () => {
      await expect(
        service.findOne(new Types.ObjectId().toString(), ownerId),
      ).rejects.toThrow(new NotFoundException('Itinerary not found'));
    });

    it('answers 403 for an itinerary of another user', async () => {
      const itinerary = stored(otherUserId);

      await expect(
        service.findOne(itinerary.id as string, ownerId),
      ).rejects.toThrow(
        new ForbiddenException('You can only open your own itineraries'),
      );
    });
  });

  describe('update', () => {
    it('changes the title, the countries and the start date', async () => {
      const itinerary = stored();

      const response = await service.update(
        itinerary.id as string,
        { title: 'Gulf trip', countries: ['AE'], startDate: '2027-01-05' },
        ownerId,
      );

      expect(response).toMatchObject({
        id: itinerary.id as string,
        title: 'Gulf trip',
        countries: ['AE'],
        startDate: '2027-01-05',
      });
      expect(itinerary.save).toHaveBeenCalledTimes(1);
    });

    it('changes only the fields that are sent', async () => {
      const itinerary = stored();

      const response = await service.update(
        itinerary.id as string,
        { title: 'New title' },
        ownerId,
      );

      expect(response).toMatchObject({
        title: 'New title',
        countries: ['EG'],
        startDate: '2026-12-20',
      });
      expect(countryFind).not.toHaveBeenCalled();
    });

    it('makes the itinerary public, and private again (ITN-20)', async () => {
      const itinerary = stored();

      const published = await service.update(
        itinerary.id as string,
        { visibility: ItineraryVisibility.Public },
        ownerId,
      );
      const hidden = await service.update(
        itinerary.id as string,
        { visibility: ItineraryVisibility.Private },
        ownerId,
      );

      expect(published.visibility).toBe(ItineraryVisibility.Public);
      expect(hidden.visibility).toBe(ItineraryVisibility.Private);
      expect(itinerary.save).toHaveBeenCalledTimes(2);
    });

    it('keeps the visibility when only other fields are sent (ITN-20)', async () => {
      const itinerary = stored();
      itinerary.visibility = ItineraryVisibility.Public;

      const response = await service.update(
        itinerary.id as string,
        { title: 'Renamed' },
        ownerId,
      );

      expect(response.visibility).toBe(ItineraryVisibility.Public);
    });

    it('does not let another user change the visibility (ITN-20)', async () => {
      const itinerary = stored(otherUserId);

      await expect(
        service.update(
          itinerary.id as string,
          { visibility: ItineraryVisibility.Public },
          ownerId,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(itinerary.visibility).toBe(ItineraryVisibility.Private);
    });

    it('answers 400 for a field sent as null and changes nothing', async () => {
      const itinerary = stored();
      const dto = { title: null, visibility: null };

      await expect(
        service.update(itinerary.id as string, dto as never, ownerId),
      ).rejects.toThrow(BadRequestException);
      expect(itinerary.save).not.toHaveBeenCalled();
      expect(itinerary.title).toBe(createDto.title);
    });

    it('names every null field in the 400 answer', async () => {
      const itinerary = stored();

      const error = (await service
        .update(
          itinerary.id as string,
          { title: null, startDate: null } as never,
          ownerId,
        )
        .catch((caught: unknown) => caught)) as BadRequestException;

      expect(error.getResponse()).toEqual({
        message: 'Validation failed',
        errors: [
          { field: 'startDate', messages: ['startDate must not be null'] },
          { field: 'title', messages: ['title must not be null'] },
        ],
      });
    });

    it('answers 409 when the itinerary was changed at the same moment', async () => {
      const itinerary = stored();
      jest
        .spyOn(itinerary, 'save')
        .mockRejectedValue(
          new MongooseError.VersionError(itinerary, 0, ['countries']),
        );

      await expect(
        service.update(itinerary.id as string, { countries: ['AE'] }, ownerId),
      ).rejects.toThrow(new ConflictException(ITINERARY_CHANGED_MESSAGE));
    });

    it('answers 404 when the itinerary does not exist', async () => {
      await expect(
        service.update(new Types.ObjectId().toString(), {}, ownerId),
      ).rejects.toThrow(new NotFoundException('Itinerary not found'));
    });

    it('answers 403 for an itinerary of another user and changes nothing', async () => {
      const itinerary = stored(otherUserId);

      await expect(
        service.update(itinerary.id as string, { title: 'Mine now' }, ownerId),
      ).rejects.toThrow(ForbiddenException);
      expect(itinerary.title).toBe('Ten days in Egypt');
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('rejects an unknown country and changes nothing', async () => {
      const itinerary = stored();

      await expect(
        service.update(itinerary.id as string, { countries: ['ZZ'] }, ownerId),
      ).rejects.toThrow(new BadRequestException('Unknown country code: ZZ'));
      expect(itinerary.countries).toEqual(['EG']);
      expect(itinerary.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the itinerary of the logged-in user', async () => {
      const itinerary = stored();

      await service.remove(itinerary.id as string, ownerId);

      expect(findByIdSpy).toHaveBeenCalledWith(itinerary.id);
      expect(itinerary.deleteOne).toHaveBeenCalledTimes(1);
    });

    it('answers 404 when the itinerary does not exist', async () => {
      await expect(
        service.remove(new Types.ObjectId().toString(), ownerId),
      ).rejects.toThrow(NotFoundException);
    });

    it('answers 403 for an itinerary of another user and deletes nothing', async () => {
      const itinerary = stored(otherUserId);

      await expect(
        service.remove(itinerary.id as string, ownerId),
      ).rejects.toThrow(ForbiddenException);
      expect(itinerary.deleteOne).not.toHaveBeenCalled();
    });
  });

  describe('addDay', () => {
    /** Replaces the conditional update: it adds the day as the database would. */
    const withUpdate = (itinerary: ItineraryDocument | null) =>
      jest.spyOn(ItineraryModel, 'findOneAndUpdate').mockImplementation(((
        _filter: unknown,
        update: { $push: { days: Record<string, unknown> } },
      ) => {
        if (itinerary) {
          itinerary.days.push(update.$push.days as never);
          itinerary.dayCount += 1;
        }
        return Promise.resolve(itinerary);
      }) as never);

    it('adds the day at the end and returns the itinerary with its days', async () => {
      const itinerary = stored();
      itinerary.days.push({ cityId: 'cairo' } as never);
      itinerary.dayCount = 1;
      withUpdate(itinerary);

      const response = await service.addDay(
        itinerary.id as string,
        { cityId: 'dubai', notes: 'Fly in the morning' },
        ownerId,
      );

      expect(response.dayCount).toBe(2);
      expect(response.days).toEqual([
        expect.objectContaining({
          dayNumber: 1,
          date: '2026-12-20',
          cityId: 'cairo',
        }),
        {
          id: expect.stringMatching(/^[0-9a-f]{24}$/),
          dayNumber: 2,
          date: '2026-12-21',
          cityId: 'dubai',
          notes: 'Fly in the morning',
          activities: [],
          transportCosts: [],
        },
      ]);
    });

    it('adds and counts the day in one update that only passes below 60 days', async () => {
      const itinerary = stored();
      const updateSpy = withUpdate(itinerary);

      await service.addDay(
        itinerary.id as string,
        { cityId: 'cairo' },
        ownerId,
      );

      expect(updateSpy).toHaveBeenCalledWith(
        { _id: itinerary.id, dayCount: { $lt: 60 } },
        {
          $push: { days: { cityId: 'cairo' } },
          $inc: { dayCount: 1, __v: 1 },
        },
        { returnDocument: 'after', runValidators: true },
      );
    });

    it('answers 409 when the itinerary already has 60 days', async () => {
      const itinerary = stored();
      const updateSpy = withUpdate(null);

      await expect(
        service.addDay(itinerary.id as string, { cityId: 'cairo' }, ownerId),
      ).rejects.toThrow(
        new ConflictException('An itinerary has at most 60 days'),
      );
      expect(updateSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects a city that is not in the city list and adds nothing', async () => {
      const itinerary = stored();
      const updateSpy = withUpdate(itinerary);

      await expect(
        service.addDay(itinerary.id as string, { cityId: 'atlantis' }, ownerId),
      ).rejects.toThrow(new BadRequestException('Unknown city id: atlantis'));
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('answers 404 when the itinerary does not exist', async () => {
      const updateSpy = withUpdate(null);

      await expect(
        service.addDay(
          new Types.ObjectId().toString(),
          { cityId: 'cairo' },
          ownerId,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('answers 403 for an itinerary of another user and adds nothing', async () => {
      const itinerary = stored(otherUserId);
      const updateSpy = withUpdate(itinerary);

      await expect(
        service.addDay(itinerary.id as string, { cityId: 'cairo' }, ownerId),
      ).rejects.toThrow(ForbiddenException);
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe('updateDay', () => {
    /** An itinerary with two days in Cairo. Returns it with the id of day 2. */
    const withDays = (owner = ownerId) => {
      const itinerary = stored(owner);
      itinerary.days.push(
        { cityId: 'cairo', notes: 'Pyramids' } as never,
        { cityId: 'cairo', notes: 'Museum' } as never,
      );
      itinerary.dayCount = 2;
      return { itinerary, dayId: itinerary.days[1]._id.toString() };
    };

    it('changes the city and the notes of that day only', async () => {
      const { itinerary, dayId } = withDays();

      const response = await service.updateDay(
        itinerary.id as string,
        dayId,
        { cityId: 'dubai', notes: 'Old town' },
        ownerId,
      );

      expect(response.days).toEqual([
        expect.objectContaining({
          dayNumber: 1,
          cityId: 'cairo',
          notes: 'Pyramids',
        }),
        expect.objectContaining({
          id: dayId,
          dayNumber: 2,
          date: '2026-12-21',
          cityId: 'dubai',
          notes: 'Old town',
        }),
      ]);
      expect(itinerary.save).toHaveBeenCalledTimes(1);
    });

    it('changes only the field that is sent', async () => {
      const { itinerary, dayId } = withDays();

      const response = await service.updateDay(
        itinerary.id as string,
        dayId,
        { notes: 'Citadel' },
        ownerId,
      );

      expect(response.days[1]).toMatchObject({
        cityId: 'cairo',
        notes: 'Citadel',
      });
      expect(cityExists).not.toHaveBeenCalled();
    });

    it('clears the notes when an empty text is sent', async () => {
      const { itinerary, dayId } = withDays();

      const response = await service.updateDay(
        itinerary.id as string,
        dayId,
        { notes: '' },
        ownerId,
      );

      expect(response.days[1]).not.toHaveProperty('notes');
    });

    it('answers 400 for a field sent as null and changes nothing', async () => {
      const { itinerary, dayId } = withDays();

      await expect(
        service.updateDay(
          itinerary.id as string,
          dayId,
          { cityId: null, notes: 'x' } as never,
          ownerId,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(itinerary.save).not.toHaveBeenCalled();
      expect(itinerary.days[1].notes).toBe('Museum');
    });

    it('answers 404 when the day is not in the itinerary', async () => {
      const { itinerary } = withDays();

      await expect(
        service.updateDay(
          itinerary.id as string,
          new Types.ObjectId().toString(),
          { notes: 'x' },
          ownerId,
        ),
      ).rejects.toThrow(new NotFoundException('Day not found'));
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('rejects a city that is not in the city list and changes nothing', async () => {
      const { itinerary, dayId } = withDays();

      await expect(
        service.updateDay(
          itinerary.id as string,
          dayId,
          { cityId: 'atlantis' },
          ownerId,
        ),
      ).rejects.toThrow(new BadRequestException('Unknown city id: atlantis'));
      expect(itinerary.days[1].cityId).toBe('cairo');
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('answers 403 for an itinerary of another user and changes nothing', async () => {
      const { itinerary, dayId } = withDays(otherUserId);

      await expect(
        service.updateDay(
          itinerary.id as string,
          dayId,
          { notes: 'Mine now' },
          ownerId,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(itinerary.days[1].notes).toBe('Museum');
      expect(itinerary.save).not.toHaveBeenCalled();
    });
  });

  describe('removeDay', () => {
    /** An itinerary with three days. Returns it with the ids of its days. */
    const withThreeDays = (owner = ownerId) => {
      const itinerary = stored(owner);
      itinerary.days.push(
        { cityId: 'cairo' } as never,
        { cityId: 'cairo' } as never,
        { cityId: 'dubai' } as never,
      );
      itinerary.dayCount = 3;
      return {
        itinerary,
        dayIds: itinerary.days.map((day) => day._id.toString()),
      };
    };

    /** Replaces the versioned update: it writes the days it is given. */
    const withUpdate = (itinerary: ItineraryDocument | null) =>
      jest.spyOn(ItineraryModel, 'findOneAndUpdate').mockImplementation(((
        _filter: unknown,
        update: { $set: { days: unknown[]; dayCount: number } },
      ) => {
        if (itinerary) {
          itinerary.set('days', update.$set.days);
          itinerary.dayCount = update.$set.dayCount;
        }
        return Promise.resolve(itinerary);
      }) as never);

    it('removes the day and renumbers and redates the days after it', async () => {
      const { itinerary, dayIds } = withThreeDays();
      withUpdate(itinerary);

      const response = await service.removeDay(
        itinerary.id as string,
        dayIds[0],
        ownerId,
      );

      expect(response.dayCount).toBe(2);
      expect(response.days).toEqual([
        expect.objectContaining({
          id: dayIds[1],
          dayNumber: 1,
          date: '2026-12-20',
        }),
        expect.objectContaining({
          id: dayIds[2],
          dayNumber: 2,
          date: '2026-12-21',
        }),
      ]);
    });

    it('writes the other days and their count only at the version it read, and bumps it', async () => {
      const { itinerary, dayIds } = withThreeDays();
      itinerary.__v = 4;
      const updateSpy = withUpdate(itinerary);

      await service.removeDay(itinerary.id as string, dayIds[1], ownerId);

      const [filter, update] = updateSpy.mock.calls[0] as unknown as [
        Record<string, unknown>,
        { $set: { days: { _id: Types.ObjectId }[]; dayCount: number } } & {
          $inc: Record<string, number>;
        },
      ];
      expect(filter).toEqual({ _id: itinerary._id, __v: 4 });
      expect(update.$set.days.map((day) => day._id.toString())).toEqual([
        dayIds[0],
        dayIds[2],
      ]);
      expect(update.$set.dayCount).toBe(2);
      expect(update.$inc).toEqual({ __v: 1 });
    });

    it('answers 404 for a day that is not in the itinerary and changes nothing', async () => {
      const { itinerary } = withThreeDays();
      const updateSpy = withUpdate(itinerary);

      await expect(
        service.removeDay(
          itinerary.id as string,
          new Types.ObjectId().toString(),
          ownerId,
        ),
      ).rejects.toThrow(new NotFoundException('Day not found'));
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('answers 409 when the itinerary changed between the read and the update', async () => {
      const { itinerary, dayIds } = withThreeDays();
      withUpdate(null);

      await expect(
        service.removeDay(itinerary.id as string, dayIds[0], ownerId),
      ).rejects.toThrow(new ConflictException(ITINERARY_CHANGED_MESSAGE));
    });

    it('answers 403 for an itinerary of another user and changes nothing', async () => {
      const { itinerary, dayIds } = withThreeDays(otherUserId);
      const updateSpy = withUpdate(itinerary);

      await expect(
        service.removeDay(itinerary.id as string, dayIds[0], ownerId),
      ).rejects.toThrow(ForbiddenException);
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe('moveDay', () => {
    /** An itinerary with days in cairo, dubai and london, in that order. */
    const withThreeDays = (owner = ownerId) => {
      const itinerary = stored(owner);
      itinerary.days.push(
        { cityId: 'cairo' } as never,
        { cityId: 'dubai' } as never,
        { cityId: 'london' } as never,
      );
      itinerary.dayCount = 3;
      return {
        itinerary,
        dayIds: itinerary.days.map((day) => day._id.toString()),
      };
    };
    const withUpdate = (itinerary: ItineraryDocument | null) =>
      jest.spyOn(ItineraryModel, 'findOneAndUpdate').mockImplementation(((
        _filter: unknown,
        update: { $set: { days: unknown[] } },
      ) => {
        if (itinerary) itinerary.set('days', update.$set.days);
        return Promise.resolve(itinerary);
      }) as never);
    const cities = (response: { days: { cityId: string }[] }) =>
      response.days.map((day) => day.cityId);

    it('moves the last day to the front and renumbers and redates every day', async () => {
      const { itinerary, dayIds } = withThreeDays();
      withUpdate(itinerary);

      const response = await service.moveDay(
        itinerary.id as string,
        { dayId: dayIds[2], position: 1 },
        ownerId,
      );

      expect(cities(response)).toEqual(['london', 'cairo', 'dubai']);
      expect(response.days.map((day) => [day.dayNumber, day.date])).toEqual([
        [1, '2026-12-20'],
        [2, '2026-12-21'],
        [3, '2026-12-22'],
      ]);
      expect(response.days[0].id).toBe(dayIds[2]);
    });

    it('moves the first day to the end', async () => {
      const { itinerary, dayIds } = withThreeDays();
      withUpdate(itinerary);

      const response = await service.moveDay(
        itinerary.id as string,
        { dayId: dayIds[0], position: 3 },
        ownerId,
      );

      expect(cities(response)).toEqual(['dubai', 'london', 'cairo']);
    });

    it('writes the new order at the version it read and keeps the day count', async () => {
      const { itinerary, dayIds } = withThreeDays();
      itinerary.__v = 7;
      const updateSpy = withUpdate(itinerary);

      await service.moveDay(
        itinerary.id as string,
        { dayId: dayIds[1], position: 3 },
        ownerId,
      );

      const [filter, update] = updateSpy.mock.calls[0] as unknown as [
        unknown,
        { $set: { dayCount: number }; $inc: unknown },
      ];
      expect(filter).toEqual({ _id: itinerary._id, __v: 7 });
      expect(update.$set.dayCount).toBe(3);
      expect(update.$inc).toEqual({ __v: 1 });
    });

    it('writes nothing when the day is already at that position', async () => {
      const { itinerary, dayIds } = withThreeDays();
      const updateSpy = withUpdate(itinerary);

      const response = await service.moveDay(
        itinerary.id as string,
        { dayId: dayIds[1], position: 2 },
        ownerId,
      );

      expect(cities(response)).toEqual(['cairo', 'dubai', 'london']);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('answers 400 for a position after the last day', async () => {
      const { itinerary, dayIds } = withThreeDays();
      const updateSpy = withUpdate(itinerary);

      await expect(
        service.moveDay(
          itinerary.id as string,
          { dayId: dayIds[0], position: 4 },
          ownerId,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'position must be between 1 and 3, the number of days',
        ),
      );
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('answers 404 for a day that is not in the itinerary', async () => {
      const { itinerary } = withThreeDays();

      await expect(
        service.moveDay(
          itinerary.id as string,
          { dayId: new Types.ObjectId().toString(), position: 1 },
          ownerId,
        ),
      ).rejects.toThrow(new NotFoundException('Day not found'));
    });

    it('answers 409 when the itinerary changed in the meantime', async () => {
      const { itinerary, dayIds } = withThreeDays();
      withUpdate(null);

      await expect(
        service.moveDay(
          itinerary.id as string,
          { dayId: dayIds[2], position: 1 },
          ownerId,
        ),
      ).rejects.toThrow(new ConflictException(ITINERARY_CHANGED_MESSAGE));
    });

    it('answers 403 for an itinerary of another user', async () => {
      const { itinerary, dayIds } = withThreeDays(otherUserId);
      const updateSpy = withUpdate(itinerary);

      await expect(
        service.moveDay(
          itinerary.id as string,
          { dayId: dayIds[2], position: 1 },
          ownerId,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe('saveOrConflict', () => {
    it('answers 409 when the itinerary was changed by another request', async () => {
      const itinerary = stored();
      jest
        .spyOn(itinerary, 'save')
        .mockRejectedValue(
          new MongooseError.VersionError(itinerary, 0, ['days']),
        );

      await expect(service.saveOrConflict(itinerary)).rejects.toThrow(
        new ConflictException(ITINERARY_CHANGED_MESSAGE),
      );
    });

    it('passes any other error on unchanged', async () => {
      const itinerary = stored();
      const failure = new Error('connection lost');
      jest.spyOn(itinerary, 'save').mockRejectedValue(failure);

      await expect(service.saveOrConflict(itinerary)).rejects.toBe(failure);
    });
  });

  describe('findOwnerAndVisibilityOrThrow (GEN-09, ITN-21 rule)', () => {
    /** findById(id).select(fields).lean().exec() resolves to `doc`. */
    const lookup = (doc: Record<string, unknown> | null) => {
      const select = jest.fn(() => ({
        lean: () => ({ exec: () => Promise.resolve(doc) }),
      }));
      findByIdSpy.mockReturnValue({ select } as never);
      return select;
    };
    const visible = {
      ownerId: new Types.ObjectId(ownerId),
      visibility: 'public',
      moderation: 'visible',
      authorDeactivated: false,
    };

    it('reads only the four fields and says a public, visible itinerary is publicly visible', async () => {
      const select = lookup(visible);

      await expect(
        service.findOwnerAndVisibilityOrThrow('some-id'),
      ).resolves.toEqual({ ownerId, publiclyVisible: true });
      expect(findByIdSpy).toHaveBeenCalledWith('some-id');
      expect(select).toHaveBeenCalledWith(
        'ownerId visibility moderation authorDeactivated',
      );
    });

    it.each([
      ['private', { visibility: 'private' }],
      ['hidden by an admin', { moderation: 'hidden' }],
      ['by a deactivated author', { authorDeactivated: true }],
      ['stored without a moderation value', { moderation: undefined }],
    ])('is not publicly visible when %s', async (_case, change) => {
      lookup({ ...visible, ...change });

      await expect(
        service.findOwnerAndVisibilityOrThrow('some-id'),
      ).resolves.toEqual({ ownerId, publiclyVisible: false });
    });

    it('answers 404 when the itinerary does not exist', async () => {
      lookup(null);

      await expect(
        service.findOwnerAndVisibilityOrThrow('some-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findEntityOrThrow', () => {
    it('returns the stored itinerary for other services', async () => {
      const itinerary = stored();

      await expect(
        service.findEntityOrThrow(itinerary.id as string),
      ).resolves.toBe(itinerary);
    });

    it('answers 404 when the itinerary does not exist', async () => {
      await expect(
        service.findEntityOrThrow(new Types.ObjectId().toString()),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
