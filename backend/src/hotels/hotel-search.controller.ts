import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { HotelSearchResultResponseDto } from './dto/hotel-search-result-response.dto';
import { SearchHotelsQueryDto } from './dto/search-hotels-query.dto';
import { HotelSearchService } from './hotel-search.service';

/**
 * Hotel search (HTL-11). Registered in HotelsModule before
 * HotelDetailsController, so `GET /hotels/search` is not read as a hotel id.
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
      'HTL-11. For guests and users: the active hotels of a city (`cityId`) or a country (`countryCode`) that have at least `rooms` rooms (default 1) free for the whole stay, whose combined maximum occupancy covers `guests`. A room is free when it is active, its availability covers every night and no night is booked, blocked or held. Each result shows how many rooms are free and the price per night of the cheapest one. Sorted by hotel name and paginated. Check-out must be after check-in, and check-in cannot be in the past (UTC).',
  })
  @ApiPaginatedResponse(HotelSearchResultResponseDto)
  @ApiBadRequestResponse({
    description:
      'Neither or both of cityId and countryCode were sent, a date is missing or is not a real YYYY-MM-DD date, check-out is not after check-in, check-in is in the past, the stay has more than 366 nights, guests is not 1 to 40, rooms is not 1 to 10, or the page parameters are wrong',
  })
  search(
    @Query() query: SearchHotelsQueryDto,
  ): Promise<PaginatedResponse<HotelSearchResultResponseDto>> {
    return this.hotelSearch.search(query);
  }
}
