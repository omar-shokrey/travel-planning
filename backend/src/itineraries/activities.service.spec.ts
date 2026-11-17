import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Error as MongooseError, Mongoose, Types } from 'mongoose';
import { City } from '../reference/models/city.schema';
import { Country } from '../reference/models/country.schema';
import { ActivitiesService } from './activities.service';
import { ITINERARY_CHANGED_MESSAGE } from './itineraries.constants';
import { ItinerariesService } from './itineraries.service';
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

const ownerId = new Types.ObjectId().toString();
const otherUserId = new Types.ObjectId().toString();
const SUPPORTED = ['EGP', 'USD'];

describe('ActivitiesService', () => {
  let service: ActivitiesService;

  /**
   * An itinerary "in the database" with two days in cairo; the second day has
   * one activity with a cost. findById and findOne return it, save works.
   */
  const stored = (owner = ownerId) => {
    const itinerary = new ItineraryModel({
      ownerId: new Types.ObjectId(owner),
      title: 'Egypt',
      countries: ['EG'],
      startDate: '2026-12-20',
      dayCount: 2,
      days: [
        { cityId: 'cairo' },
        {
          cityId: 'cairo',
          activities: [
            {
              name: 'Museum',
              description: 'Two hours',
              time: '09:30',
              cost: 20000,
              currency: 'EGP',
            },
          ],
        },
      ],
    }) as ItineraryDocument;
    jest.spyOn(itinerary, 'save').mockResolvedValue(itinerary);
    jest
      .spyOn(ItineraryModel, 'findById')
      .mockResolvedValue(itinerary as never);
    jest.spyOn(ItineraryModel, 'findOne').mockResolvedValue(itinerary as never);
    const [firstDay, secondDay] = itinerary.days;
    return {
      itinerary,
      firstDayId: firstDay._id.toString(),
      activityId: secondDay.activities[0]._id.toString(),
    };
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        ItinerariesService,
        { provide: getModelToken(Itinerary.name), useValue: ItineraryModel },
        {
          provide: getModelToken(Country.name),
          useValue: {
            exists: jest.fn((filter: { currency: string }) =>
              Promise.resolve(
                SUPPORTED.includes(filter.currency) ? { _id: 'EG' } : null,
              ),
            ),
          },
        },
        { provide: getModelToken(City.name), useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(ActivitiesService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('add', () => {
    it('adds the activity at the end of that day and returns the itinerary', async () => {
      const { itinerary, firstDayId } = stored();

      const response = await service.add(
        itinerary.id as string,
        firstDayId,
        { name: 'Pyramids', time: '08:00', cost: 30000, currency: 'EGP' },
        ownerId,
      );

      expect(response.days[0].activities).toEqual([
        {
          id: expect.stringMatching(/^[0-9a-f]{24}$/),
          name: 'Pyramids',
          time: '08:00',
          cost: 30000,
          currency: 'EGP',
        },
      ]);
      expect(response.days[1].activities).toHaveLength(1);
      expect(itinerary.save).toHaveBeenCalledTimes(1);
    });

    it('adds an activity with only a name', async () => {
      const { itinerary, firstDayId } = stored();

      const response = await service.add(
        itinerary.id as string,
        firstDayId,
        { name: 'Walk', description: '', time: '' },
        ownerId,
      );

      expect(response.days[0].activities).toEqual([
        { id: expect.any(String), name: 'Walk' },
      ]);
    });

    it('counts the cost in the city group subtotal (ITN-09)', async () => {
      const { itinerary, firstDayId } = stored();

      const response = await service.add(
        itinerary.id as string,
        firstDayId,
        { name: 'Pyramids', cost: 30000, currency: 'EGP' },
        ownerId,
      );

      expect(response.cityGroups[0].budgetSubtotal).toEqual([
        { amount: 50000, currency: 'EGP' },
      ]);
    });

    it('rejects a currency that is not supported and saves nothing', async () => {
      const { itinerary, firstDayId } = stored();

      await expect(
        service.add(
          itinerary.id as string,
          firstDayId,
          { name: 'Pyramids', cost: 100, currency: 'XXX' },
          ownerId,
        ),
      ).rejects.toThrow(new BadRequestException('Unsupported currency: XXX'));
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('answers 404 for a day that is not in the itinerary', async () => {
      const { itinerary } = stored();

      await expect(
        service.add(
          itinerary.id as string,
          new Types.ObjectId().toString(),
          { name: 'Walk' },
          ownerId,
        ),
      ).rejects.toThrow(new NotFoundException('Day not found'));
    });

    it('answers 403 for an itinerary of another user and saves nothing', async () => {
      const { itinerary, firstDayId } = stored(otherUserId);

      await expect(
        service.add(
          itinerary.id as string,
          firstDayId,
          { name: 'Walk' },
          ownerId,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('answers 409 when the itinerary changed in the meantime', async () => {
      const { itinerary, firstDayId } = stored();
      jest
        .spyOn(itinerary, 'save')
        .mockRejectedValue(
          new MongooseError.VersionError(itinerary, 0, ['days']),
        );

      await expect(
        service.add(
          itinerary.id as string,
          firstDayId,
          { name: 'Walk' },
          ownerId,
        ),
      ).rejects.toThrow(new ConflictException(ITINERARY_CHANGED_MESSAGE));
    });
  });

  describe('update', () => {
    it('changes only the fields that are sent', async () => {
      const { activityId } = stored();

      const response = await service.update(
        activityId,
        { name: 'Egyptian Museum' },
        ownerId,
      );

      expect(response.days[1].activities[0]).toEqual({
        id: activityId,
        name: 'Egyptian Museum',
        description: 'Two hours',
        time: '09:30',
        cost: 20000,
        currency: 'EGP',
      });
    });

    it('removes the description and the time when they are sent empty', async () => {
      const { activityId } = stored();

      const response = await service.update(
        activityId,
        { description: '', time: '' },
        ownerId,
      );

      expect(response.days[1].activities[0]).not.toHaveProperty('description');
      expect(response.days[1].activities[0]).not.toHaveProperty('time');
    });

    it('changes the cost and the currency, together or one at a time', async () => {
      const { activityId } = stored();

      await service.update(activityId, { cost: 15000 }, ownerId);
      const response = await service.update(
        activityId,
        { currency: 'USD' },
        ownerId,
      );

      expect(response.days[1].activities[0]).toMatchObject({
        cost: 15000,
        currency: 'USD',
      });
    });

    it('refuses a currency without a cost on an activity that has none', async () => {
      const { itinerary, firstDayId } = stored();
      const added = await service.add(
        itinerary.id as string,
        firstDayId,
        { name: 'Walk' },
        ownerId,
      );
      const walkId = added.days[0].activities[0].id;

      await expect(
        service.update(walkId, { currency: 'EGP' }, ownerId),
      ).rejects.toThrow(
        new BadRequestException(
          'cost and currency go together: send both, or neither',
        ),
      );
    });

    it('refuses null with 400 and names the field', async () => {
      const { activityId, itinerary } = stored();

      await expect(
        service.update(
          activityId,
          { name: null, cost: null } as never,
          ownerId,
        ),
      ).rejects.toMatchObject({
        response: {
          message: 'Validation failed',
          errors: [
            { field: 'cost', messages: ['cost must not be null'] },
            { field: 'name', messages: ['name must not be null'] },
          ],
        },
      });
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('rejects a currency that is not supported', async () => {
      const { activityId } = stored();

      await expect(
        service.update(activityId, { currency: 'XXX' }, ownerId),
      ).rejects.toThrow(new BadRequestException('Unsupported currency: XXX'));
    });

    it('answers 404 for an activity that does not exist', async () => {
      stored();
      jest.spyOn(ItineraryModel, 'findOne').mockResolvedValue(null as never);

      await expect(
        service.update(new Types.ObjectId().toString(), { name: 'x' }, ownerId),
      ).rejects.toThrow(new NotFoundException('Activity not found'));
    });

    it('looks the activity up by its id inside the days', async () => {
      const { activityId } = stored();
      const findOne = jest.spyOn(ItineraryModel, 'findOne');

      await service.update(activityId, { name: 'x' }, ownerId);

      expect(findOne).toHaveBeenCalledWith({
        'days.activities._id': new Types.ObjectId(activityId),
      });
    });

    it('answers 403 for an activity in the itinerary of another user', async () => {
      const { activityId, itinerary } = stored(otherUserId);

      await expect(
        service.update(activityId, { name: 'Mine now' }, ownerId),
      ).rejects.toThrow(ForbiddenException);
      expect(itinerary.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('removes only that activity', async () => {
      const { itinerary, firstDayId, activityId } = stored();
      await service.add(
        itinerary.id as string,
        firstDayId,
        { name: 'Walk' },
        ownerId,
      );

      const response = await service.remove(activityId, ownerId);

      expect(response.days[1].activities).toEqual([]);
      expect(response.days[0].activities.map((a) => a.name)).toEqual(['Walk']);
      expect(response.cityGroups[0].budgetSubtotal).toEqual([]);
    });

    it('answers 403 for an activity in the itinerary of another user', async () => {
      const { activityId, itinerary } = stored(otherUserId);

      await expect(service.remove(activityId, ownerId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(itinerary.save).not.toHaveBeenCalled();
    });
  });
});
