import { Body, Controller, Param, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { RoomResponseDto } from './dto/room-response.dto';
import { SetRoomAvailabilityDto } from './dto/set-room-availability.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { HotelRoomsService } from './hotel-rooms.service';

/** Editing the rooms of a hotel by its moderator (HTL-05). */
@ApiTags('hotels')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  description: 'Not logged in, or the access token is invalid or expired',
})
@ApiForbiddenResponse({
  description:
    'The account is not a hotel moderator, or the moderator is not assigned to this hotel',
})
@ApiNotFoundResponse({
  description: 'The hotel does not exist, or it has no room with this id',
})
@Controller('hotels')
export class HotelRoomsController {
  constructor(private readonly rooms: HotelRoomsService) {}

  @Patch(':id/rooms/:roomId')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'Edit a room (HTL-05)',
    description:
      'HTL-05. The moderator assigned to this hotel changes the beds, the maximum occupancy or the price per night of a room. Send only the fields to change. A new price applies to new reservations only: an existing reservation keeps the price it was made at.',
  })
  @ApiParam({
    name: 'id',
    description: 'Hotel id',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @ApiParam({
    name: 'roomId',
    description: 'Room id',
    example: '6740f1c2a4b5c6d7e8f90124',
  })
  @ApiOkResponse({ type: RoomResponseDto })
  @ApiBadRequestResponse({
    description:
      'An id is not a valid id, a value is not a whole number of 1 or more, no field was sent, or the body has a field that is not allowed (the room number and type cannot be changed here)',
  })
  update(
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: UpdateRoomDto,
    @CurrentUser('id') userId: string,
  ): Promise<RoomResponseDto> {
    return this.rooms.update(hotelId, roomId, dto, userId);
  }

  @Patch(':id/rooms/:roomId/availability')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'Edit the availability of a room (HTL-05)',
    description:
      'HTL-05. The moderator assigned to this hotel sends the complete new list of date ranges in which the room is bookable; it replaces the old list. `from` is the first night and `to` the checkout boundary, which is not included. Ranges must not overlap. A night that a reservation has booked, or holds while it waits for payment, cannot be left out of the new list.',
  })
  @ApiParam({
    name: 'id',
    description: 'Hotel id',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @ApiParam({
    name: 'roomId',
    description: 'Room id',
    example: '6740f1c2a4b5c6d7e8f90124',
  })
  @ApiOkResponse({ type: RoomResponseDto })
  @ApiBadRequestResponse({
    description:
      'An id is not a valid id, a date is not a real YYYY-MM-DD date, `from` is not before `to`, two ranges overlap, or the body has a field that is not allowed',
  })
  @ApiConflictResponse({
    description:
      'The new list leaves out a night that a reservation has booked or holds',
  })
  setAvailability(
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: SetRoomAvailabilityDto,
    @CurrentUser('id') userId: string,
  ): Promise<RoomResponseDto> {
    return this.rooms.setAvailability(hotelId, roomId, dto, userId);
  }
}
