import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Mongoose, Types } from 'mongoose';
import { City } from '../reference/models/city.schema';
import { Country } from '../reference/models/country.schema';
import { UploadsService } from '../uploads/uploads.service';
import { ItinerariesService } from './itineraries.service';
import {
  Itinerary,
  type ItineraryDocument,
  ItinerarySchema,
} from './models/itinerary.schema';
import { TransportCostsService } from './transport-costs.service';

// A real model that is never connected; every database call is replaced.
const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const ItineraryModel = mongoose.model(Itinerary.name, ItinerarySchema);

const ownerId = new Types.ObjectId().toString();
const otherUserId = new Types.ObjectId().toString();
const CITIES = ['cairo', 'luxor', 'aswan'];

const trip = {
  mode: 'train',
  fromCityId: 'cairo',
  toCityId: 'luxor',
  amount: 90000,
  currency: 'EGP',
};

describe('TransportCostsService', () => {
  // UploadsService: only deleteImage is used by these services (ITN-12).
  const uploads = { deleteImage: jest.fn().mockResolvedValue(undefined) };
  let service: TransportCostsService;

  /** Two days, cairo then luxor; day 1 already has the train to luxor. */
  const stored = (owner = ownerId) => {
    const itinerary = new ItineraryModel({
      ownerId: new Types.ObjectId(owner),
      title: 'Egypt',
      countries: ['EG'],
      startDate: '2026-12-20',
      dayCount: 2,
      days: [{ cityId: 'cairo', transportCosts: [trip] }, { cityId: 'luxor' }],
    }) as ItineraryDocument;
    jest.spyOn(itinerary, 'save').mockResolvedValue(itinerary);
    jest
      .spyOn(ItineraryModel, 'findById')
      .mockResolvedValue(itinerary as never);
    jest.spyOn(ItineraryModel, 'findOne').mockResolvedValue(itinerary as never);
    const [first, second] = itinerary.days;
    return {
      itinerary,
      dayIds: [first._id.toString(), second._id.toString()],
      costId: first.transportCosts[0]._id.toString(),
    };
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        TransportCostsService,
        ItinerariesService,
        { provide: UploadsService, useValue: uploads },
        { provide: getModelToken(Itinerary.name), useValue: ItineraryModel },
        {
          provide: getModelToken(Country.name),
          useValue: {
            exists: jest.fn((filter: { currency: string }) =>
              Promise.resolve(filter.currency === 'EGP' ? { _id: 'EG' } : null),
            ),
          },
        },
        {
          provide: getModelToken(City.name),
          useValue: {
            exists: jest.fn((filter: { _id: string }) =>
              Promise.resolve(CITIES.includes(filter._id) ? filter : null),
            ),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(TransportCostsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('add', () => {
    it('adds the transport cost to that day and counts it in the budget', async () => {
      const { itinerary, dayIds } = stored();

      const response = await service.add(
        itinerary.id as string,
        {
          ...trip,
          dayId: dayIds[1],
          fromCityId: 'luxor',
          toCityId: 'aswan',
          amount: 50000,
        },
        ownerId,
      );

      expect(response.days[1].transportCosts).toEqual([
        {
          id: expect.stringMatching(/^[0-9a-f]{24}$/),
          mode: 'train',
          fromCityId: 'luxor',
          toCityId: 'aswan',
          amount: 50000,
          currency: 'EGP',
        },
      ]);
      expect(response.cityGroups[1].budgetSubtotal).toEqual([
        { amount: 50000, currency: 'EGP' },
      ]);
      expect(itinerary.save).toHaveBeenCalledTimes(1);
    });

    it.each([
      [
        'the same city twice',
        { toCityId: 'cairo' },
        'fromCityId and toCityId must be different cities',
      ],
      [
        'a from-city that is not in the city list',
        { fromCityId: 'atlantis' },
        'Unknown city id: atlantis',
      ],
      [
        'a to-city that is not in the city list',
        { toCityId: 'atlantis' },
        'Unknown city id: atlantis',
      ],
      [
        'a currency that is not supported',
        { currency: 'XXX' },
        'Unsupported currency: XXX',
      ],
    ])('rejects %s and saves nothing', async (_label, change, message) => {
      const { itinerary, dayIds } = stored();

      await expect(
        service.add(
          itinerary.id as string,
          { ...trip, ...change, dayId: dayIds[0] },
          ownerId,
        ),
      ).rejects.toThrow(new BadRequestException(message));
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('answers 404 for a day that is not in the itinerary', async () => {
      const { itinerary } = stored();

      await expect(
        service.add(
          itinerary.id as string,
          { ...trip, dayId: new Types.ObjectId().toString() },
          ownerId,
        ),
      ).rejects.toThrow(new NotFoundException('Day not found'));
    });

    it('answers 403 for an itinerary of another user', async () => {
      const { itinerary, dayIds } = stored(otherUserId);

      await expect(
        service.add(
          itinerary.id as string,
          { ...trip, dayId: dayIds[0] },
          ownerId,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(itinerary.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('changes only the fields that are sent', async () => {
      const { costId } = stored();

      const response = await service.update(
        costId,
        { mode: 'night train', amount: 95000 },
        ownerId,
      );

      expect(response.days[0].transportCosts).toEqual([
        { ...trip, id: costId, mode: 'night train', amount: 95000 },
      ]);
    });

    it('moves the transport cost to another day and keeps its id', async () => {
      const { costId, dayIds } = stored();

      const response = await service.update(
        costId,
        { dayId: dayIds[1] },
        ownerId,
      );

      expect(response.days[0].transportCosts).toEqual([]);
      expect(response.days[1].transportCosts).toEqual([
        { ...trip, id: costId },
      ]);
      expect(response.cityGroups.map((group) => group.budgetSubtotal)).toEqual([
        [],
        [{ amount: 90000, currency: 'EGP' }],
      ]);
    });

    it('checks a changed city against the other one that is kept', async () => {
      const { costId } = stored();

      await expect(
        service.update(costId, { toCityId: 'cairo' }, ownerId),
      ).rejects.toThrow(
        new BadRequestException(
          'fromCityId and toCityId must be different cities',
        ),
      );
    });

    it('refuses null with 400', async () => {
      const { costId, itinerary } = stored();

      await expect(
        service.update(costId, { amount: null } as never, ownerId),
      ).rejects.toMatchObject({
        response: {
          errors: [{ field: 'amount', messages: ['amount must not be null'] }],
        },
      });
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('answers 404 for a new day that is not in the itinerary', async () => {
      const { costId } = stored();

      await expect(
        service.update(
          costId,
          { dayId: new Types.ObjectId().toString() },
          ownerId,
        ),
      ).rejects.toThrow(new NotFoundException('Day not found'));
    });

    it('answers 404 for a transport cost that does not exist', async () => {
      stored();
      jest.spyOn(ItineraryModel, 'findOne').mockResolvedValue(null as never);

      await expect(
        service.update(new Types.ObjectId().toString(), { amount: 1 }, ownerId),
      ).rejects.toThrow(new NotFoundException('Transport cost not found'));
    });

    it('answers 403 for a transport cost in the itinerary of another user', async () => {
      const { costId, itinerary } = stored(otherUserId);

      await expect(
        service.update(costId, { amount: 1 }, ownerId),
      ).rejects.toThrow(ForbiddenException);
      expect(itinerary.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('removes the transport cost and its amount from the budget', async () => {
      const { costId } = stored();

      const response = await service.remove(costId, ownerId);

      expect(response.days[0].transportCosts).toEqual([]);
      expect(response.cityGroups[0].budgetSubtotal).toEqual([]);
    });

    it('answers 403 for a transport cost in the itinerary of another user', async () => {
      const { costId } = stored(otherUserId);

      await expect(service.remove(costId, ownerId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
