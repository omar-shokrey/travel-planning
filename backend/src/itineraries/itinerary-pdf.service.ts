import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { City } from '../reference/models/city.schema';
import { Country } from '../reference/models/country.schema';
import { BudgetsService } from './budgets.service';
import { ItinerariesService } from './itineraries.service';
import {
  buildItineraryPdfModel,
  pdfFilename,
  renderItineraryPdf,
} from './itinerary-pdf';
import { toBudgetSummaryResponse } from './mappers/budget-summary.mapper';
import { withConvertedAmounts } from './mappers/itinerary-conversion.mapper';
import { toItineraryDetailResponse } from './mappers/itinerary.mapper';

/** The PDF of an itinerary and the name it is downloaded under. */
export interface ItineraryPdf {
  filename: string;
  pdf: Buffer;
}

/** ITN-28 (bonus): export your own itinerary as a PDF. */
@Injectable()
export class ItineraryPdfService {
  constructor(
    private readonly itinerariesService: ItinerariesService,
    private readonly budgets: BudgetsService,
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(City.name) private readonly cities: Model<City>,
  ) {}

  /**
   * The owner's itinerary as a PDF, with the same checks and answers as
   * `GET /api/itineraries/:id` (404, then 403 for someone else's), for a
   * private, public or admin-hidden itinerary alike. It is built from the
   * same responses the owner gets: the detail with its linked bookings
   * (ITN-27) and the budget summary converted to their currency exactly as
   * `GET /api/itineraries/:id/budget-summary` (ITN-14, ITN-18). It reads
   * only; nothing is written.
   */
  async export(itineraryId: string, userId: string): Promise<ItineraryPdf> {
    const itinerary = await this.itinerariesService.findOwnedOrThrow(
      itineraryId,
      userId,
      'You can only open your own itineraries',
    );
    const conversion = await this.budgets.conversionFor(userId);
    const detail = withConvertedAmounts(
      toItineraryDetailResponse(itinerary),
      conversion,
    );
    const summary = toBudgetSummaryResponse(itinerary, conversion);

    const cityIds = new Set<string>();
    for (const day of itinerary.days) {
      cityIds.add(day.cityId);
      for (const cost of day.transportCosts) {
        cityIds.add(cost.fromCityId);
        cityIds.add(cost.toCityId);
      }
    }
    // The names of the countries and cities, one query each.
    const [countries, cities] = await Promise.all([
      this.countries
        .find({ _id: { $in: itinerary.countries } })
        .select('name')
        .lean<{ _id: string; name: string }[]>()
        .exec(),
      this.cities
        .find({ _id: { $in: [...cityIds] } })
        .select('name')
        .lean<{ _id: string; name: string }[]>()
        .exec(),
    ]);

    const pdf = await renderItineraryPdf(
      buildItineraryPdfModel(detail, summary, {
        countries: namesById(countries),
        cities: namesById(cities),
      }),
    );
    return { filename: pdfFilename(itinerary.title), pdf };
  }
}

/** The name of each reference record by its id; a missing one shows its code. */
function namesById(
  records: readonly { _id: string; name: string }[],
): Map<string, string> {
  return new Map(records.map((record) => [record._id, record.name]));
}
