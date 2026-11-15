import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Mongoose, Types } from 'mongoose';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { City } from '../reference/models/city.schema';
import { Country } from '../reference/models/country.schema';
import { ItineraryVisibility } from './enums/itinerary-visibility.enum';
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

    it('leaves a field that is sent as null unchanged', async () => {
      const itinerary = stored();
      const dto = { title: null, countries: null, startDate: null };

      const response = await service.update(
        itinerary.id as string,
        dto as never,
        ownerId,
      );

      expect(response).toMatchObject(createDto);
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
        { $push: { days: { cityId: 'cairo' } }, $inc: { dayCount: 1 } },
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
