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
import { HotelResponseDto } from './dto/hotel-response.dto';
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
      'HTL-02. The hotel page for guests and users: profile, photos, amenities, average rating and number of ratings. A deactivated hotel answers 404.',
  })
  @ApiParam({
    name: 'id',
    description: 'Hotel id',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @ApiOkResponse({ type: HotelResponseDto })
  @ApiBadRequestResponse({ description: 'The hotel id is not a valid id' })
  @ApiNotFoundResponse({
    description: 'The hotel does not exist or is deactivated',
  })
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<HotelResponseDto> {
    return this.hotelDetails.findActiveById(id);
  }
}
