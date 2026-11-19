import { Controller, Get, Param, Query } from '@nestjs/common';
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
import { HotelDetailsQueryDto } from './dto/hotel-details-query.dto';
import { HotelDetailsResponseDto } from './dto/hotel-details-response.dto';
import { HotelDetailsService } from './hotel-details.service';

/**
 * The public hotel page (HTL-02).
 *
 * This controller is registered last in HotelsModule on purpose: `GET
 * /hotels/:id` would otherwise catch fixed paths such as `GET /hotels/search`
 * and answer 400, because "search" is not an id.
 */
@ApiTags('hotels')
@Controller('hotels')
export class HotelDetailsController {
  constructor(private readonly hotelDetails: HotelDetailsService) {}

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'Hotel details (HTL-02)',
    description:
      'HTL-02. The hotel page for guests and users: profile, photos, amenities, check-in and check-out times (HTL-09), cancellation policy (HTL-10), average rating and number of ratings. Send `checkIn` and `checkOut` to also see `availableRooms`: every room that is free for the whole stay, with the total price (HTL-15). Without dates `availableRooms` is null. A deactivated hotel answers 404.',
  })
  @ApiParam({
    name: 'id',
    description: 'Hotel id',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @ApiOkResponse({ type: HotelDetailsResponseDto })
  @ApiBadRequestResponse({
    description:
      'The hotel id is not a valid id, only one date was sent, a date is not a real YYYY-MM-DD date, check-out is not after check-in, check-in is in the past, or the stay has more than 366 nights',
  })
  @ApiNotFoundResponse({
    description: 'The hotel does not exist or is deactivated',
  })
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: HotelDetailsQueryDto,
  ): Promise<HotelDetailsResponseDto> {
    return this.hotelDetails.findActiveById(id, query);
  }
}
