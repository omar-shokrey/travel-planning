import { ApiProperty } from '@nestjs/swagger';
import { FlightSearchPageDto } from '../../flights/dto/round-trip-search-response.dto';
import { ItineraryTripType } from '../enums/itinerary-trip-type.enum';

/** ITN-26: what was searched, with the defaults the itinerary gave. */
export class ItineraryFlightSearchDto {
  @ApiProperty({ example: 'CAI' })
  originAirport: string;

  @ApiProperty({
    description: "The city of the itinerary's first day",
    example: 'paris',
  })
  cityId: string;

  @ApiProperty({
    type: [String],
    description:
      'Every airport in that city (from the airports list): the outbound flights arrive at one of them and the return flights leave from one of them',
    example: ['CDG', 'ORY'],
  })
  destinationAirports: string[];

  @ApiProperty({
    enum: ItineraryTripType,
    enumName: 'ItineraryTripType',
    example: ItineraryTripType.RoundTrip,
  })
  tripType: ItineraryTripType;

  @ApiProperty({
    description:
      "The outbound date that was searched: the one sent, or the itinerary's start date",
    example: '2027-06-15',
  })
  departureDate: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The return date that was searched: the one sent, or the date of the itinerary's last day; `null` one way",
    example: '2027-06-22',
  })
  returnDate: string | null;
}

/**
 * ITN-26: the flights from an itinerary. The pages are those of flight search
 * (FLT-11, FLT-12): the same items, filters, order and page shape.
 */
export class ItineraryFlightsResponseDto {
  @ApiProperty({ type: ItineraryFlightSearchDto })
  search: ItineraryFlightSearchDto;

  @ApiProperty({
    type: FlightSearchPageDto,
    description:
      "Flights from the origin to any airport of the first day's city on departureDate (local date at the origin)",
  })
  outbound: FlightSearchPageDto;

  @ApiProperty({
    type: FlightSearchPageDto,
    nullable: true,
    description:
      "Round trip: flights from any airport of the first day's city back to the origin on returnDate (local date there); `null` one way",
  })
  return: FlightSearchPageDto | null;
}
