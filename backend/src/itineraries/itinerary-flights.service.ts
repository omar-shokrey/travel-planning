import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { FieldError } from '../common/interfaces/error-response.interface';
import {
  crossFieldErrors,
  FlightSearchService,
} from '../flights/flight-search.service';
import { Airport } from '../reference/models/airport.schema';
import type { ItineraryFlightsQueryDto } from './dto/itinerary-flights-query.dto';
import type { ItineraryFlightsResponseDto } from './dto/itinerary-flights-response.dto';
import { ItineraryTripType } from './enums/itinerary-trip-type.enum';
import {
  NO_AIRPORT_IN_FIRST_CITY_MESSAGE,
  NO_DAYS_FOR_FLIGHTS_MESSAGE,
  ORIGIN_IN_FIRST_CITY_MESSAGE,
  RETURN_DATE_ONE_WAY_MESSAGE,
  unknownOriginMessage,
} from './itineraries.constants';
import { ItinerariesService } from './itineraries.service';
import { dayDate } from './mappers/itinerary.mapper';

/**
 * ITN-26: one-way or round-trip flights from an origin the user chooses to any
 * airport in the city of the itinerary's first day. The outbound date
 * defaults to the start date and the return date to the last day's date.
 * Flight search (FLT-11, FLT-12, FLT-15) answers, so the flights, filters and
 * order are the ones of `GET /api/flights/search`. Reads only.
 */
@Injectable()
export class ItineraryFlightsService {
  constructor(
    private readonly itinerariesService: ItinerariesService,
    private readonly flightSearch: FlightSearchService,
    // The airports list (FLT-02), read only: the airports of a city and the origin.
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
  ) {}

  /**
   * 404 when the itinerary does not exist, has no day yet, or its first city
   * has no airport; 403 when it is not the caller's; 400 for an unknown
   * origin, an origin in the first city, a return date one way, a return
   * before the outbound date or a wrong price range (all in one answer).
   * `now` is for tests.
   */
  async search(
    itineraryId: string,
    query: ItineraryFlightsQueryDto,
    userId: string,
    now: Date = new Date(),
  ): Promise<ItineraryFlightsResponseDto> {
    const itinerary = await this.itinerariesService.findOwnedOrThrow(
      itineraryId,
      userId,
      'You can only search flights for your own itineraries',
    );
    const firstDay = itinerary.days[0];
    if (!firstDay) {
      throw new NotFoundException(NO_DAYS_FOR_FLIGHTS_MESSAGE);
    }
    const [cityAirports, origin] = await Promise.all([
      this.airports
        .find({ cityId: firstDay.cityId })
        .select('_id')
        .sort({ _id: 1 })
        .lean()
        .exec(),
      this.airports
        .findById(query.originAirport)
        .select('cityId')
        .lean()
        .exec(),
    ]);
    const destinationAirports = cityAirports.map(({ _id }) => _id);
    if (destinationAirports.length === 0) {
      throw new NotFoundException(NO_AIRPORT_IN_FIRST_CITY_MESSAGE);
    }

    const roundTrip = query.tripType !== ItineraryTripType.OneWay;
    // The defaults of ITN-26: the start date, and the date of the last day.
    const departureDate = query.departureDate ?? itinerary.startDate;
    const returnDate = roundTrip
      ? (query.returnDate ??
        dayDate(itinerary.startDate, itinerary.days.length - 1))
      : undefined;

    const errors: FieldError[] = [];
    if (!origin) {
      errors.push({
        field: 'originAirport',
        messages: [unknownOriginMessage(query.originAirport)],
      });
    } else if (origin.cityId === firstDay.cityId) {
      errors.push({
        field: 'originAirport',
        messages: [ORIGIN_IN_FIRST_CITY_MESSAGE],
      });
    }
    if (!roundTrip && query.returnDate !== undefined) {
      errors.push({
        field: 'returnDate',
        messages: [RETURN_DATE_ONE_WAY_MESSAGE],
      });
    }
    errors.push(...crossFieldErrors(query, departureDate, returnDate));
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Validation failed', errors });
    }

    const pages = await this.flightSearch.searchBetween(
      query,
      {
        from: [query.originAirport],
        to: destinationAirports,
        departureDate,
        returnDate,
      },
      now,
    );
    return {
      search: {
        originAirport: query.originAirport,
        cityId: firstDay.cityId,
        destinationAirports,
        tripType: roundTrip
          ? ItineraryTripType.RoundTrip
          : ItineraryTripType.OneWay,
        departureDate,
        returnDate: returnDate ?? null,
      },
      outbound: pages.outbound,
      return: pages.return,
    };
  }
}
