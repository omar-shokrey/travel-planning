import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AvailableRoomResponseDto } from './dto/available-room-response.dto';
import { AvailableRoomsQueryDto } from './dto/available-rooms-query.dto';
import { HotelAvailableRoomsService } from './hotel-available-rooms.service';

/**
 * The rooms that guests and users can book for their dates (HTL-15).
 * Registered before HotelDetailsController, so `GET /hotels/:id/rooms/available`
 * is matched by this route and not by another `:id` route.
 */
@ApiTags('hotels')
@Controller('hotels')
export class HotelAvailableRoomsController {
  constructor(private readonly availableRooms: HotelAvailableRoomsService) {}

  @Get(':id/rooms/available')
  @Public()
  @ApiOperation({
    summary: 'Available rooms for the searched dates (HTL-15)',
    description:
      'HTL-15. For guests and users: every room of the hotel that is free for the whole stay, with its type, beds, maximum occupancy, price per night, the number of nights and the total price of the stay (nights x price per night, in minor units of USD). A room is free when it is active, its availability covers every night from checkIn up to the day before checkOut, and no night is booked, blocked or held by a hold that has not expired; it is the same rule as hotel search (HTL-11), so the two always agree. The `id` of each room is what a reservation (HTL-16) selects. Sorted by room number, 10 per page. Read only: a listed room can still be taken before it is booked. A missing or deactivated hotel answers 404.',
  })
  @ApiParam({
    name: 'id',
    description: 'Hotel id',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @ApiPaginatedResponse(AvailableRoomResponseDto)
  @ApiBadRequestResponse({
    description:
      'The hotel id is not a valid id; a date is missing or is not a real YYYY-MM-DD date; checkOut is not after checkIn; checkIn is in the past; the stay has more than 366 nights; page or limit is out of range; or an unknown parameter was sent',
  })
  @ApiNotFoundResponse({
    description: 'The hotel does not exist or is deactivated',
  })
  findAvailable(
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Query() query: AvailableRoomsQueryDto,
  ): Promise<PaginatedResponse<AvailableRoomResponseDto>> {
    return this.availableRooms.findAvailable(hotelId, query);
  }
}
