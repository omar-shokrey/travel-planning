import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
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
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import { HotelBookingResponseDto } from './dto/hotel-booking-response.dto';
import { ListHotelBookingsQueryDto } from './dto/list-hotel-bookings-query.dto';
import { HotelBookingsService } from './hotel-bookings.service';

@ApiTags('hotel-bookings')
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(private readonly hotelBookings: HotelBookingsService) {}

  @Post()
  @Roles(Role.User)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Reserve rooms and hold them for payment (HTL-16, HTL-18)',
    description:
      "HTL-16. A registered user reserves one or more rooms of one hotel for the same dates, with the adults and the children's ages (0 to 17) of each room. The reservation needs at least one adult, and no room may have more guests than its maximum occupancy. The total is the sum over the rooms of nights x the room's price now. HTL-18: all the rooms are held together for 10 minutes as one `pending_payment` reservation. If any room is not free for the whole stay (booked, held by someone else, blocked, deactivated or outside its availability), the whole request is refused with 409 and nothing is held. When the hold runs out without payment, the reservation becomes `expired` and the rooms are free again. PAY-02: `acceptPolicies` must be `true`; the moment is stored.",
  })
  @ApiCreatedResponse({ type: HotelBookingResponseDto })
  @ApiBadRequestResponse({
    description:
      'A field is missing or invalid, check-out is not after check-in, check-in is in the past, the stay has more than 366 nights, a room is chosen twice, there is no adult, a room has no guest or more guests than its maximum occupancy, or the policies were not accepted',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description: 'Only a registered user (role `user`) can reserve rooms',
  })
  @ApiNotFoundResponse({
    description:
      'The hotel does not exist or is deactivated, or a room is not a room of this hotel',
  })
  @ApiConflictResponse({
    description:
      'A room is not free for the whole stay, or was taken by someone else at the same moment. Nothing was held.',
  })
  create(
    @Body() dto: CreateHotelBookingDto,
    @CurrentUser('id') userId: string,
  ): Promise<HotelBookingResponseDto> {
    return this.hotelBookings.create(userId, dto);
  }

  @Get()
  @Roles(Role.User)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'My hotel reservations (HTL-20)',
    description:
      "HTL-20. The logged-in user's own reservations, never anyone else's, with the reference, hotel, rooms, dates, guests, total and status. `group` gives the tabs of the page: `upcoming` (confirmed and check-out not passed, or waiting for payment with a live hold; soonest first), `past` (completed, or confirmed with check-out passed; latest first) and `cancelled` (latest first). Without `group`, every reservation, expired ones included, newest first. Paginated.",
  })
  @ApiPaginatedResponse(HotelBookingResponseDto)
  @ApiBadRequestResponse({
    description: 'group is unknown, or the page parameters are wrong',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description: 'Only a registered user (role `user`) has reservations',
  })
  findMine(
    @Query() query: ListHotelBookingsQueryDto,
    @CurrentUser('id') userId: string,
  ): Promise<PaginatedResponse<HotelBookingResponseDto>> {
    return this.hotelBookings.findMine(userId, query);
  }

  @Get(':id')
  @Roles(Role.User)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'The full details of one of my reservations (HTL-20)',
    description:
      'HTL-20. Every room with its price, label and guests, the copied check-in and check-out times and cancellation tiers, the hold and the status. Only the user who made the reservation can open it (ACC-11).',
  })
  @ApiParam({
    name: 'id',
    description: 'Reservation id',
    example: '6740f1c2a4b5c6d7e8f90789',
  })
  @ApiOkResponse({ type: HotelBookingResponseDto })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'The account is not a registered user, or the reservation belongs to someone else',
  })
  @ApiNotFoundResponse({ description: 'The reservation does not exist' })
  findMineById(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<HotelBookingResponseDto> {
    return this.hotelBookings.findMineById(id, userId);
  }
}
