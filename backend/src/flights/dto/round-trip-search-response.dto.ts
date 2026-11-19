import { ApiProperty } from '@nestjs/swagger';
import { PaginationMeta } from '../../common/dto/paginated-response.dto';
import { FlightSearchResultResponseDto } from './flight-search-result-response.dto';

/** One page of flight search results, the shape of every list (GEN-05). */
export class FlightSearchPageDto {
  @ApiProperty({ type: [FlightSearchResultResponseDto] })
  items: FlightSearchResultResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  meta: PaginationMeta;
}

/**
 * FLT-12(a): the answer of a round-trip search (a search with `returnDate`):
 * the outbound and the return options, each a page of the same shape as a
 * one-way search, with the same filters, order, page and limit.
 */
export class RoundTripSearchResponseDto {
  @ApiProperty({
    type: FlightSearchPageDto,
    description:
      'Flights from departureAirport to arrivalAirport on departureDate (local date at departureAirport)',
  })
  outbound: FlightSearchPageDto;

  @ApiProperty({
    type: FlightSearchPageDto,
    description:
      'Flights from arrivalAirport back to departureAirport on returnDate (local date at arrivalAirport)',
  })
  return: FlightSearchPageDto;
}
