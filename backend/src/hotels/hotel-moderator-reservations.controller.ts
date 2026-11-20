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
import { ModeratorReservationResponseDto } from './dto/moderator-reservation-response.dto';
import { ModeratorReservationsQueryDto } from './dto/moderator-reservations-query.dto';
import { HotelModeratorReservationsService } from './hotel-moderator-reservations.service';

/** HTL-22: the reservations of a hotel, for its moderator. */
@ApiTags('hotels')
@ApiCookieAuth()
@Controller('hotels')
export class HotelModeratorReservationsController {
  constructor(
    private readonly reservations: HotelModeratorReservationsService,
  ) {}

  @Get(':id/reservations')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'The reservations of my hotel (HTL-22)',
    description:
      "HTL-22. The hotel moderator assigned to this hotel sees its reservations: the guest's name, the dates, the rooms with their guests, the status and the reference. No email, price or payment data. Confirmed, completed and cancelled reservations are listed (filter with `status`); a reservation waiting for payment or whose hold ran out is not. Most recent check-in first, paginated, 10 per page.",
  })
  @ApiParam({
    name: 'id',
    description: 'Hotel id',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @ApiPaginatedResponse(ModeratorReservationResponseDto)
  @ApiBadRequestResponse({
    description:
      'The hotel id is not a valid id, `status` is not confirmed, completed or cancelled, the page parameters are wrong, or the query has a parameter the list does not have',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'The account is not a hotel moderator, or the moderator is not assigned to this hotel',
  })
  @ApiNotFoundResponse({ description: 'The hotel does not exist' })
  list(
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Query() query: ModeratorReservationsQueryDto,
    @CurrentUser('id') userId: string,
  ): Promise<PaginatedResponse<ModeratorReservationResponseDto>> {
    return this.reservations.list(hotelId, query, userId);
  }
}
