import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { FlightDetailsResponseDto } from './dto/flight-details-response.dto';
import { FlightDetailsService } from './flight-details.service';
import { FLIGHT_NOT_FOUND_MESSAGE } from './flights.constants';

/**
 * FLT-17: the flight details page. Registered after `FlightSearchController`,
 * so GET /flights/search is never read as an id (flights.module.spec.ts).
 */
@ApiTags('Flights')
@Controller('flights')
export class FlightDetailsController {
  constructor(private readonly details: FlightDetailsService) {}

  @Get(':id')
  @Public()
  @ApiParam({
    name: 'id',
    description: 'Flight id, from a search result',
    example: '6740f1c2a4b5c6d7e8f90456',
  })
  @ApiOperation({
    summary: 'Flight details (FLT-17)',
    description: [
      "Open to guests. The airline, the flight number, both airports, the departure and arrival times in UTC and in each airport's local time (GEN-06), the duration, the status, every cabin category with its price, the seats remaining and the baggage allowance, the airline's extra-bag rule (FLT-08) and its cancellation policy (FLT-09).",
      'A flight of a deactivated airline answers 404, like an unknown flight (ACC-15). A cancelled or departed flight is shown, with its status.',
    ].join('\n\n'),
  })
  @ApiOkResponse({
    type: FlightDetailsResponseDto,
    description: 'The flight details',
  })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiNotFoundResponse({
    description: `"${FLIGHT_NOT_FOUND_MESSAGE}": no flight has this id, or its airline is deactivated`,
  })
  findOne(
    @Param('id', ParseObjectIdPipe) flightId: string,
  ): Promise<FlightDetailsResponseDto> {
    return this.details.findDetails(flightId);
  }
}
