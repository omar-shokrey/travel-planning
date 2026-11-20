import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Mongoose, Types } from 'mongoose';
import type { BudgetsService } from './budgets.service';
import { BudgetCategory } from './enums/budget-category.enum';
import type { ItinerariesService } from './itineraries.service';
import { ItineraryPdfService } from './itinerary-pdf.service';
import type { SummaryConversion } from './mappers/budget-summary.mapper';
import {
  Itinerary,
  type ItineraryDocument,
  ItinerarySchema,
} from './models/itinerary.schema';

// A real model that is never connected: only documents are built.
const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const ItineraryModel = mongoose.model(Itinerary.name, ItinerarySchema);

const userId = new Types.ObjectId().toString();
const NO_RATES: SummaryConversion = { currency: 'USD', rates: null };

const stored = (title = 'Ten days in Egypt'): ItineraryDocument =>
  new ItineraryModel({
    ownerId: new Types.ObjectId(userId),
    title,
    countries: ['EG'],
    startDate: '2026-12-20',
    dayCount: 1,
    days: [
      {
        cityId: 'cairo',
        budgetEntries: [
          { category: BudgetCategory.Food, amount: 1500, currency: 'USD' },
        ],
        transportCosts: [
          {
            mode: 'train',
            fromCityId: 'cairo',
            toCityId: 'luxor',
            amount: 900,
            currency: 'USD',
          },
        ],
      },
    ],
  }) as ItineraryDocument;

/** Replaces find().select().lean().exec() of a reference collection. */
const reference = (rows: { _id: string; name: string }[]) => {
  const chain = {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(rows),
  };
  return { find: jest.fn().mockReturnValue(chain), chain };
};

function setup(itinerary: ItineraryDocument | Error = stored()) {
  const itinerariesService = {
    findOwnedOrThrow:
      itinerary instanceof Error
        ? jest.fn().mockRejectedValue(itinerary)
        : jest.fn().mockResolvedValue(itinerary),
  };
  const budgets = {
    conversionFor: jest.fn().mockResolvedValue(NO_RATES),
  };
  const countries = reference([{ _id: 'EG', name: 'Egypt' }]);
  const cities = reference([
    { _id: 'cairo', name: 'Cairo' },
    { _id: 'luxor', name: 'Luxor' },
  ]);
  const service = new ItineraryPdfService(
    itinerariesService as unknown as ItinerariesService,
    budgets as unknown as BudgetsService,
    countries as never,
    cities as never,
  );
  return { service, itinerariesService, budgets, countries, cities };
}

describe('ItineraryPdfService.export (ITN-28)', () => {
  it("returns a PDF of the owner's itinerary, named after its title", async () => {
    const { service } = setup();

    const { filename, pdf } = await service.export('it-1', userId);

    expect(filename).toBe('ten-days-in-egypt.pdf');
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('checks the owner as GET /api/itineraries/:id does', async () => {
    const { service, itinerariesService } = setup();

    await service.export('it-1', userId);

    expect(itinerariesService.findOwnedOrThrow).toHaveBeenCalledWith(
      'it-1',
      userId,
      'You can only open your own itineraries',
    );
  });

  it.each([
    ['missing', new NotFoundException('Itinerary not found')],
    [
      "another user's",
      new ForbiddenException('You can only open your own itineraries'),
    ],
  ])(
    'passes on the answer for a %s itinerary and reads nothing else',
    async (_name, error) => {
      const { service, budgets, countries } = setup(error);

      await expect(service.export('it-1', userId)).rejects.toBe(error);
      expect(budgets.conversionFor).not.toHaveBeenCalled();
      expect(countries.find).not.toHaveBeenCalled();
    },
  );

  it('converts with the same rule as the budget summary: the conversion of the owner', async () => {
    const { service, budgets } = setup();

    await service.export('it-1', userId);

    expect(budgets.conversionFor).toHaveBeenCalledWith(userId);
  });

  it('reads the names of the countries and of every city of the days and transport costs, one query each', async () => {
    const { service, countries, cities } = setup();

    await service.export('it-1', userId);

    expect(countries.find).toHaveBeenCalledTimes(1);
    expect(countries.find).toHaveBeenCalledWith({ _id: { $in: ['EG'] } });
    expect(countries.chain.select).toHaveBeenCalledWith('name');
    expect(cities.find).toHaveBeenCalledTimes(1);
    expect(cities.find).toHaveBeenCalledWith({
      _id: { $in: ['cairo', 'luxor'] },
    });
  });

  it('writes nothing to the itinerary', async () => {
    const itinerary = stored();
    const save = jest.spyOn(itinerary, 'save');
    const before = JSON.stringify(itinerary.toObject());
    const { service } = setup(itinerary);

    await service.export('it-1', userId);

    expect(save).not.toHaveBeenCalled();
    expect(JSON.stringify(itinerary.toObject())).toBe(before);
  });

  it('gives a safe file name for a title in another script', async () => {
    const { service } = setup(stored('رحلة "Trip" 😀'));

    const { filename } = await service.export('it-1', userId);

    expect(filename).toBe('trip.pdf');
  });
});
