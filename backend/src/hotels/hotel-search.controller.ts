import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { HotelSearchResultResponseDto } from './dto/hotel-search-result-response.dto';
import { SearchHotelsQueryDto } from './dto/search-hotels-query.dto';
import { HotelSearchService } from './hotel-search.service';

/**
 * Hotel search (HTL-11). Registered before HotelDetailsController, so `GET
 * /hotels/search` is not read as `GET /hotels/:id`.
 */
@ApiTags('hotels')
@Controller('hotels')
export class HotelSearchController {
  constructor(private readonly hotelSearch: HotelSearchService) {}

  @Get('search')
  @Public()
  @ApiOperation({
    summary: 'Search hotels (HTL-11)',
    description:
      'HTL-11. For guests and users. Give cityId or countryCode (not both), checkIn, checkOut, guests and rooms (default 1). Lists active hotels with at least that many active rooms free for every night of the stay (inside the room availability, not blocked, booked or held), whose largest free rooms together hold the guests. Each result shows how many rooms are free and the lowest price per night among them. Sorted by hotel name, 10 per page.',
  })
  @ApiPaginatedResponse(HotelSearchResultResponseDto)
  @ApiBadRequestResponse({
    description:
      'Neither or both of cityId and countryCode; a date that is not YYYY-MM-DD; checkOut not after checkIn; checkIn in the past; a stay longer than 366 nights; guests or rooms not a whole number in range',
  })
  search(
    @Query() query: SearchHotelsQueryDto,
  ): Promise<PaginatedResponse<HotelSearchResultResponseDto>> {
    return this.hotelSearch.search(query);
  }
}
