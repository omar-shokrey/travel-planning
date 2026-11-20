import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import {
  HotelReservationDetailsDto,
  HotelReservationListItemDto,
} from './dto/hotel-reservation-response.dto';
import { HotelReservationsQueryDto } from './dto/hotel-reservations-query.dto';
import { BOOKING_NOT_FOUND_MESSAGE } from './hotel-bookings.service';
import { HotelReservationsService } from './hotel-reservations.service';

/** HTL-20: "My hotel reservations". */
@ApiTags('hotel-bookings')
@ApiCookieAuth()
@Controller('hotel-bookings')
export class HotelReservationsController {
  constructor(private readonly reservations: HotelReservationsService) {}

  @Get()
  @Roles(Role.User)
  @ApiOperation({
    summary: 'My hotel reservations, by group (HTL-20)',
    description:
      'Registered users only, their own reservations only. Each item shows the reference, the hotel, the rooms, the dates, the guests, the total and the status, and its group: **Upcoming** (confirmed, check-out today or later), **Past** (completed, or confirmed with a check-out before today) or **Cancelled**. "Today" is the UTC date. Filter with `group`; without it the three groups are listed together, most recent check-in first. Upcoming is soonest check-in first, Past most recent check-out first, Cancelled most recent check-in first. A reservation that waits for payment or whose hold ran out is not listed. Paginated, 10 per page.',
  })
  @ApiPaginatedResponse(HotelReservationListItemDto)
  @ApiBadRequestResponse({
    description:
      '`group` is not upcoming, past or cancelled, `page` or `limit` is not valid, or the query has a parameter the list does not have',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description: 'Only a registered user (role `user`) has reservations',
  })
  list(
    @CurrentUser('id') userId: string,
    @Query() query: HotelReservationsQueryDto,
  ): Promise<PaginatedResponse<HotelReservationListItemDto>> {
    return this.reservations.list(userId, query);
  }

  @Get(':id')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'The full details of one of my hotel reservations (HTL-20)',
    description:
      'Registered users only, their own reservation only. Everything the confirmation page and the details need: reference, hotel, status and group, dates and the hotel times, each room with its price and guests, the guests, the total, the cancellation tiers copied when it was booked (HTL-10), and the refund with its status when there is one (PAY-03). It also opens a reservation that waits for payment (its `group` is then `null`).',
  })
  @ApiOkResponse({ type: HotelReservationDetailsDto })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description: 'Only a registered user (role `user`) has reservations',
  })
  @ApiNotFoundResponse({
    description: `"${BOOKING_NOT_FOUND_MESSAGE}": no such reservation, or it belongs to another user`,
  })
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<HotelReservationDetailsDto> {
    return this.reservations.findOne(id, userId);
  }
}
