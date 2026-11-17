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
import { HotelReservationResponseDto } from './dto/hotel-reservation-response.dto';
import { HotelReservationsQueryDto } from './dto/hotel-reservations-query.dto';
import { HotelReservationsService } from './hotel-reservations.service';

/**
 * HTL-22. The route is under `/hotels` as in the endpoint table, but the
 * reservations belong to this module, so the controller lives here.
 */
@ApiTags('hotels')
@Controller('hotels')
export class HotelReservationsController {
  constructor(private readonly reservations: HotelReservationsService) {}

  @Get(':id/reservations')
  @Roles(Role.HotelModerator)
  @ApiCookieAuth()
  @ApiOperation({
    summary: "The hotel's reservations, for its moderator (HTL-22)",
    description:
      'HTL-22. The moderator assigned to this hotel sees its reservations: the guest, the dates, the rooms with their guests, the total and the status. Latest check-in first, paginated. `status` keeps one status; without it, every reservation except `expired` ones (holds that were never paid).',
  })
  @ApiParam({
    name: 'id',
    description: 'Hotel id',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @ApiPaginatedResponse(HotelReservationResponseDto)
  @ApiBadRequestResponse({
    description:
      'The hotel id is not a valid id, the status is unknown, or the page parameters are wrong',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'The account is not a hotel moderator, or the moderator is not assigned to this hotel',
  })
  @ApiNotFoundResponse({ description: 'The hotel does not exist' })
  findForHotel(
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Query() query: HotelReservationsQueryDto,
    @CurrentUser('id') userId: string,
  ): Promise<PaginatedResponse<HotelReservationResponseDto>> {
    return this.reservations.findForHotel(hotelId, query, userId);
  }
}
