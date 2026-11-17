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
import { RoomStatusQueryDto } from './dto/room-status-query.dto';
import { RoomStatusResponseDto } from './dto/room-status-response.dto';
import { HotelRoomStatusService } from './hotel-room-status.service';

/** The moderator's room status view (HTL-08). */
@ApiTags('hotels')
@Controller('hotels')
export class HotelRoomStatusController {
  constructor(private readonly roomStatus: HotelRoomStatusService) {}

  @Get(':id/availability')
  @Roles(Role.HotelModerator)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Room status for a date range (HTL-08)',
    description:
      'HTL-08. The moderator assigned to this hotel sees every room, deactivated ones included, with the status of each night from `from` up to `to` (not included): `available`, `booked` (with the reservation), `blocked` or `unavailable` (outside the availability ranges). Consecutive nights with the same status are joined into one segment. The rooms are paginated and sorted by room number.',
  })
  @ApiParam({
    name: 'id',
    description: 'Hotel id',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @ApiPaginatedResponse(RoomStatusResponseDto)
  @ApiBadRequestResponse({
    description:
      'The hotel id is not a valid id, a date is missing or is not a real YYYY-MM-DD date, `from` is not before `to`, the range has more than 366 nights, or the page parameters are wrong',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'The account is not a hotel moderator, or the moderator is not assigned to this hotel',
  })
  @ApiNotFoundResponse({ description: 'The hotel does not exist' })
  findStatus(
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Query() query: RoomStatusQueryDto,
    @CurrentUser('id') userId: string,
  ): Promise<PaginatedResponse<RoomStatusResponseDto>> {
    return this.roomStatus.findStatus(hotelId, query, userId);
  }
}
