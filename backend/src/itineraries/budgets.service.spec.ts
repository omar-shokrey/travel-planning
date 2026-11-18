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
import { UploadsService } from '../uploads/uploads.service';
import { Country } from '../reference/models/country.schema';
import { BudgetsService, DAY_BUDGET_FULL_MESSAGE } from './budgets.service';
import { BudgetCategory } from './enums/budget-category.enum';
import { BudgetSummaryCategory } from './enums/budget-summary-category.enum';
import {
  BUDGET_ENTRIES_PER_DAY_MAX,
  ITINERARY_CHANGED_MESSAGE,
} from './itineraries.constants';
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
const food = { category: BudgetCategory.Food, amount: 45000, currency: 'EGP' };

describe('BudgetsService (ITN-14)', () => {
  let service: BudgetsService;

  /**
   * An itinerary "in the database" with two days in cairo; the second day has
   * one food entry. findById and findOne return it, save works.
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
          budgetEntries: [
            { category: BudgetCategory.Food, amount: 2000, currency: 'EGP' },
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
      entryId: secondDay.budgetEntries[0]._id.toString(),
    };
  };

  /** Replaces the conditional update: it pushes the entry as the database would. */
  const withUpdate = (itinerary: ItineraryDocument | null, dayIndex = 0) =>
    jest.spyOn(ItineraryModel, 'findOneAndUpdate').mockImplementation(((
      _filter: unknown,
      update: { $push: Record<string, unknown> },
    ) => {
      if (itinerary) {
        itinerary.days[dayIndex].budgetEntries.push(
          update.$push[`days.${dayIndex}.budgetEntries`] as never,
        );
      }
      return Promise.resolve(itinerary);
    }) as never);

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BudgetsService,
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
        // Budget entries never touch image files (ITN-12).
        { provide: UploadsService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(BudgetsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('add', () => {
    it('adds the entry to that day and returns the itinerary with its entries', async () => {
      const { itinerary, firstDayId } = stored();
      withUpdate(itinerary);

      const response = await service.add(
        itinerary.id as string,
        firstDayId,
        food,
        ownerId,
      );

      expect(response.days[0].budgetEntries).toEqual([
        { id: expect.stringMatching(/^[0-9a-f]{24}$/), ...food },
      ]);
      expect(response.days[1].budgetEntries).toHaveLength(1);
    });

    it('adds in one update that only matches the version it read, at the position of the day, and bumps the version', async () => {
      const { itinerary, firstDayId } = stored();
      const updateSpy = withUpdate(itinerary);

      await service.add(itinerary.id as string, firstDayId, food, ownerId);

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith(
        { _id: itinerary._id, __v: itinerary.__v },
        {
          $push: { 'days.0.budgetEntries': food },
          $inc: { __v: 1 },
        },
        { returnDocument: 'after', runValidators: true },
      );
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('pushes at the position of a later day', async () => {
      const { itinerary } = stored();
      const updateSpy = withUpdate(itinerary, 1);
      const secondDayId = itinerary.days[1]._id.toString();

      const response = await service.add(
        itinerary.id as string,
        secondDayId,
        food,
        ownerId,
      );

      expect(updateSpy.mock.calls[0][1]).toEqual({
        $push: { 'days.1.budgetEntries': food },
        $inc: { __v: 1 },
      });
      expect(response.days[1].budgetEntries).toHaveLength(2);
      expect(response.days[0].budgetEntries).toEqual([]);
    });

    it('answers 409 for a day that is already full, and writes nothing', async () => {
      const { itinerary, firstDayId } = stored();
      for (let i = 0; i < BUDGET_ENTRIES_PER_DAY_MAX; i += 1) {
        itinerary.days[0].budgetEntries.push({ ...food } as never);
      }
      const updateSpy = withUpdate(itinerary);

      await expect(
        service.add(itinerary.id as string, firstDayId, food, ownerId),
      ).rejects.toThrow(new ConflictException(DAY_BUDGET_FULL_MESSAGE));
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('reads again and adds when another change won the race', async () => {
      const { itinerary, firstDayId } = stored();
      const findSpy = jest.spyOn(ItineraryModel, 'findById');
      const updateSpy = withUpdate(itinerary);
      updateSpy.mockResolvedValueOnce(null);

      const response = await service.add(
        itinerary.id as string,
        firstDayId,
        food,
        ownerId,
      );

      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect(findSpy).toHaveBeenCalledTimes(2);
      expect(response.days[0].budgetEntries).toHaveLength(1);
    });

    it('answers 409 when the day filled up while it lost the race', async () => {
      const { itinerary, firstDayId } = stored();
      const full = ItineraryModel.hydrate(
        itinerary.toObject(),
      ) as never as ItineraryDocument;
      for (let i = 0; i < BUDGET_ENTRIES_PER_DAY_MAX; i += 1) {
        full.days[0].budgetEntries.push({ ...food } as never);
      }
      jest
        .spyOn(ItineraryModel, 'findById')
        .mockResolvedValueOnce(itinerary as never)
        .mockResolvedValueOnce(full as never);
      const updateSpy = withUpdate(null);

      await expect(
        service.add(itinerary.id as string, firstDayId, food, ownerId),
      ).rejects.toThrow(new ConflictException(DAY_BUDGET_FULL_MESSAGE));
      expect(updateSpy).toHaveBeenCalledTimes(1);
    });

    it('answers 404 when the day was deleted while it lost the race', async () => {
      const { itinerary, firstDayId } = stored();
      const withoutDay = ItineraryModel.hydrate(
        itinerary.toObject(),
      ) as never as ItineraryDocument;
      withoutDay.days.shift();
      jest
        .spyOn(ItineraryModel, 'findById')
        .mockResolvedValueOnce(itinerary as never)
        .mockResolvedValueOnce(withoutDay as never);
      withUpdate(null);

      await expect(
        service.add(itinerary.id as string, firstDayId, food, ownerId),
      ).rejects.toThrow(new NotFoundException('Day not found'));
    });

    it('answers 409 after it lost the race five times, and adds nothing', async () => {
      const { itinerary, firstDayId } = stored();
      const updateSpy = withUpdate(null);

      await expect(
        service.add(itinerary.id as string, firstDayId, food, ownerId),
      ).rejects.toThrow(new ConflictException(ITINERARY_CHANGED_MESSAGE));
      expect(updateSpy).toHaveBeenCalledTimes(5);
      expect(itinerary.days[0].budgetEntries).toHaveLength(0);
    });

    it('rejects a currency that is not supported and writes nothing', async () => {
      const { itinerary, firstDayId } = stored();
      const updateSpy = withUpdate(itinerary);

      await expect(
        service.add(
          itinerary.id as string,
          firstDayId,
          { ...food, currency: 'ABC' },
          ownerId,
        ),
      ).rejects.toThrow(new BadRequestException('Unsupported currency: ABC'));
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('answers 404 for a day that is not in the itinerary', async () => {
      const { itinerary } = stored();

      await expect(
        service.add(
          itinerary.id as string,
          new Types.ObjectId().toString(),
          food,
          ownerId,
        ),
      ).rejects.toThrow(new NotFoundException('Day not found'));
    });

    it('answers 403 for an itinerary of another user and writes nothing', async () => {
      const { itinerary, firstDayId } = stored(otherUserId);
      const updateSpy = withUpdate(itinerary);

      await expect(
        service.add(itinerary.id as string, firstDayId, food, ownerId),
      ).rejects.toThrow(ForbiddenException);
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('changes only the fields that are sent', async () => {
      const { entryId } = stored();

      const response = await service.update(entryId, { amount: 2500 }, ownerId);

      expect(response.days[1].budgetEntries).toEqual([
        {
          id: entryId,
          category: BudgetCategory.Food,
          amount: 2500,
          currency: 'EGP',
        },
      ]);
    });

    it('changes the category and the currency', async () => {
      const { entryId } = stored();

      const response = await service.update(
        entryId,
        { category: BudgetCategory.Accommodation, currency: 'USD' },
        ownerId,
      );

      expect(response.days[1].budgetEntries[0]).toMatchObject({
        category: BudgetCategory.Accommodation,
        amount: 2000,
        currency: 'USD',
      });
    });

    it('changes nothing for an empty body', async () => {
      const { entryId } = stored();

      const response = await service.update(entryId, {}, ownerId);

      expect(response.days[1].budgetEntries[0]).toMatchObject({
        category: BudgetCategory.Food,
        amount: 2000,
        currency: 'EGP',
      });
    });

    it('refuses null with 400, names the field and saves nothing', async () => {
      const { entryId, itinerary } = stored();

      const error = (await service
        .update(entryId, { amount: null } as never, ownerId)
        .catch((caught: unknown) => caught)) as BadRequestException;

      expect(error.getResponse()).toEqual({
        message: 'Validation failed',
        errors: [{ field: 'amount', messages: ['amount must not be null'] }],
      });
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('rejects a currency that is not supported', async () => {
      const { entryId, itinerary } = stored();

      await expect(
        service.update(entryId, { currency: 'ABC' }, ownerId),
      ).rejects.toThrow(new BadRequestException('Unsupported currency: ABC'));
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('answers 404 for an entry that does not exist', async () => {
      jest.spyOn(ItineraryModel, 'findOne').mockResolvedValue(null as never);

      await expect(
        service.update(new Types.ObjectId().toString(), {}, ownerId),
      ).rejects.toThrow(new NotFoundException('Budget entry not found'));
    });

    it('answers 403 for an entry in the itinerary of another user', async () => {
      const { entryId, itinerary } = stored(otherUserId);

      await expect(
        service.update(entryId, { amount: 1 }, ownerId),
      ).rejects.toThrow(ForbiddenException);
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('answers 409 when the itinerary changed in the meantime', async () => {
      const { entryId, itinerary } = stored();
      jest
        .spyOn(itinerary, 'save')
        .mockRejectedValue(
          new MongooseError.VersionError(itinerary, 0, ['days']),
        );

      await expect(
        service.update(entryId, { amount: 1 }, ownerId),
      ).rejects.toThrow(new ConflictException(ITINERARY_CHANGED_MESSAGE));
    });
  });

  describe('remove', () => {
    it('removes only that entry', async () => {
      const { entryId, itinerary } = stored();

      const response = await service.remove(entryId, ownerId);

      expect(response.days[1].budgetEntries).toEqual([]);
      expect(itinerary.save).toHaveBeenCalledTimes(1);
    });

    it('answers 403 for an entry in the itinerary of another user', async () => {
      const { entryId, itinerary } = stored(otherUserId);

      await expect(service.remove(entryId, ownerId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(itinerary.save).not.toHaveBeenCalled();
    });

    it('answers 404 for an entry that does not exist', async () => {
      jest.spyOn(ItineraryModel, 'findOne').mockResolvedValue(null as never);

      await expect(
        service.remove(new Types.ObjectId().toString(), ownerId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('summary', () => {
    it('returns the totals of your own itinerary', async () => {
      const { itinerary } = stored();

      const summary = await service.summary(itinerary.id as string, ownerId);

      expect(summary.itineraryId).toBe(itinerary.id);
      expect(summary.total).toEqual([{ amount: 2000, currency: 'EGP' }]);
      expect(
        summary.byCategory.find(
          (line) => line.category === BudgetSummaryCategory.Food,
        )?.total,
      ).toEqual([{ amount: 2000, currency: 'EGP' }]);
    });

    it('answers 403 for the itinerary of another user', async () => {
      const { itinerary } = stored(otherUserId);

      await expect(
        service.summary(itinerary.id as string, ownerId),
      ).rejects.toThrow(
        new ForbiddenException(
          'You can only see the budget of your own itineraries',
        ),
      );
    });

    it('answers 404 for an itinerary that does not exist', async () => {
      jest.spyOn(ItineraryModel, 'findById').mockResolvedValue(null as never);

      await expect(
        service.summary(new Types.ObjectId().toString(), ownerId),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
