import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
import { ManagedRoomResponseDto } from './dto/managed-room-response.dto';
import { SetRoomAvailabilityDto } from './dto/set-room-availability.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { HotelRoomsService } from './hotel-rooms.service';

const HOTEL_ID_PARAM = {
  name: 'id',
  description: 'Hotel id',
  example: '6740f1c2a4b5c6d7e8f90123',
};
const ROOM_ID_PARAM = {
  name: 'roomId',
  description: 'Room id',
  example: '6740f1c2a4b5c6d7e8f90124',
};

/**
 * The rooms of a hotel, managed by its moderator: edit (HTL-05), block dates,
 * deactivate, reactivate and delete (HTL-06).
 */
@ApiTags('hotels')
@ApiCookieAuth()
@ApiParam(HOTEL_ID_PARAM)
@ApiParam(ROOM_ID_PARAM)
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
  @ApiOkResponse({ type: ManagedRoomResponseDto })
  @ApiBadRequestResponse({
    description:
      'An id is not a valid id, a value is not a whole number of 1 or more, no field was sent, or the body has a field that is not allowed (the room number and type cannot be changed here)',
  })
  update(
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: UpdateRoomDto,
    @CurrentUser('id') userId: string,
  ): Promise<ManagedRoomResponseDto> {
    return this.rooms.update(hotelId, roomId, dto, userId);
  }

  @Patch(':id/rooms/:roomId/availability')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary:
      'Edit the availability and the blocked dates of a room (HTL-05, HTL-06)',
    description:
      'HTL-05 and HTL-06. The moderator assigned to this hotel sends `availability` (the date ranges in which the room is bookable), `blocked` (the date ranges in which it is blocked), or both. Each list that is sent replaces the old one; a list that is left out stays as it is. `from` is the first night and `to` the checkout boundary, which is not included. The ranges of one list must not overlap. A night that a reservation has booked, or holds while it waits for payment, must stay bookable and cannot be blocked.',
  })
  @ApiOkResponse({ type: ManagedRoomResponseDto })
  @ApiBadRequestResponse({
    description:
      'An id is not a valid id, neither list was sent, a date is not a real YYYY-MM-DD date, `from` is not before `to`, two ranges of one list overlap, more than 366 nights are blocked, or the body has a field that is not allowed',
  })
  @ApiConflictResponse({
    description:
      'The new availability leaves out a night with a reservation, or a blocked range covers a night with a reservation',
  })
  setAvailability(
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: SetRoomAvailabilityDto,
    @CurrentUser('id') userId: string,
  ): Promise<ManagedRoomResponseDto> {
    return this.rooms.setAvailability(hotelId, roomId, dto, userId);
  }

  @Patch(':id/rooms/:roomId/deactivate')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'Deactivate a room (HTL-06)',
    description:
      'HTL-06. The moderator assigned to this hotel deactivates a room. A deactivated room is excluded from search and cannot be booked. A room with an upcoming reservation (Confirmed, or Pending Payment) cannot be deactivated.',
  })
  @ApiOkResponse({ type: ManagedRoomResponseDto })
  @ApiBadRequestResponse({ description: 'An id is not a valid id' })
  @ApiConflictResponse({
    description:
      'The room is already deactivated, or it has an upcoming reservation',
  })
  deactivate(
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ManagedRoomResponseDto> {
    return this.rooms.deactivate(hotelId, roomId, userId);
  }

  @Patch(':id/rooms/:roomId/reactivate')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'Reactivate a room (HTL-06)',
    description:
      'HTL-06. The moderator assigned to this hotel makes a deactivated room bookable again.',
  })
  @ApiOkResponse({ type: ManagedRoomResponseDto })
  @ApiBadRequestResponse({ description: 'An id is not a valid id' })
  @ApiConflictResponse({ description: 'The room is already active' })
  reactivate(
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ManagedRoomResponseDto> {
    return this.rooms.reactivate(hotelId, roomId, userId);
  }

  @Delete(':id/rooms/:roomId')
  @Roles(Role.HotelModerator)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a room (HTL-06)',
    description:
      'HTL-06. The moderator assigned to this hotel deletes a room that has never been reserved, together with its blocked dates. A room that has been reserved can only be deactivated.',
  })
  @ApiNoContentResponse({ description: 'The room was deleted' })
  @ApiBadRequestResponse({ description: 'An id is not a valid id' })
  @ApiConflictResponse({
    description: 'The room has been reserved, so it cannot be deleted',
  })
  remove(
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.rooms.remove(hotelId, roomId, userId);
  }
}
