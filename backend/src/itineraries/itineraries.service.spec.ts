import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Mongoose, Types } from 'mongoose';
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

    const moduleRef = await Test.createTestingModule({
      providers: [
        ItinerariesService,
        { provide: getModelToken(Itinerary.name), useValue: ItineraryModel },
        {
          provide: getModelToken(Country.name),
          useValue: { find: countryFind },
        },
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
