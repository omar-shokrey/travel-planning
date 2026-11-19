import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ItineraryHotelResponseDto } from './dto/itinerary-hotel-response.dto';
import { ItineraryHotelsQueryDto } from './dto/itinerary-hotels-query.dto';
import { ItineraryHotelsService } from './itinerary-hotels.service';

/**
 * ITN-25: the hotels of one city group of an itinerary, under
 * `/api/itineraries/:id/hotels`. Registered after the public itinerary
 * controller in the module, so the routes under `/api/itineraries/public/`
 * are matched first, as before.
 */
@ApiTags('Itineraries')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in' })
@ApiForbiddenResponse({
  description:
    'Not a registered user: administrators and moderators cannot use itineraries',
})
@Roles(Role.User)
@Controller('itineraries')
export class ItineraryHotelsController {
  constructor(private readonly itineraryHotels: ItineraryHotelsService) {}

  @Get(':id/hotels')
  @ApiOperation({
    summary: 'Hotels available for a city group',
    description:
      "ITN-25. Pick a city group of your own itinerary by its `firstDayNumber` (see `cityGroups` in `GET /api/itineraries/:id`) and give the guests and the number of rooms (default 1). Lists the active hotels in the group's city with enough rooms free for every night from the group's first day (check-in) to the day after its last day (check-out), by the same rule as hotel search (HTL-11): sorted by hotel name, 10 per page, each with the free rooms, the lowest price per night and the `checkIn` and `checkOut` that were searched. The dates come from the itinerary and cannot be changed here. A hotel that is listed can still be taken before it is booked.",
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiPaginatedResponse(ItineraryHotelResponseDto)
  @ApiBadRequestResponse({
    description:
      'The id or a query value is invalid or unknown (firstDayNumber, guests or rooms missing or not a whole number in range), or the city group starts in the past (a stay must start today or later, UTC)',
  })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({
    description:
      'No itinerary has this id, or no city group starts on that day',
  })
  search(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ItineraryHotelsQueryDto,
    @CurrentUser('id') userId: string,
  ): Promise<PaginatedResponse<ItineraryHotelResponseDto>> {
    return this.itineraryHotels.search(id, query, userId);
  }
}
