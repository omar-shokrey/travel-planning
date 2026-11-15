import { Body, Controller, Param, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import { HotelPolicyResponseDto } from './dto/hotel-policy-response.dto';
import { SetHotelPoliciesDto } from './dto/set-hotel-policies.dto';
import { HotelPoliciesService } from './hotel-policies.service';

/** The policies of a hotel, set by its moderator (HTL-09, HTL-10). */
@ApiTags('hotels')
@ApiCookieAuth()
@Controller('hotels')
export class HotelPoliciesController {
  constructor(private readonly policies: HotelPoliciesService) {}

  @Put(':id/policies')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'Set the hotel policies (HTL-09, HTL-10)',
    description:
      'HTL-09, HTL-10. A hotel moderator sets the policies of their assigned hotel: the standard check-in and check-out times (HH:mm, 24-hour clock) and the cancellation tiers. Each tier has a different `daysBefore` (whole days before check-in, 0 or more) and a `refundPercent` (0 to 100). A cancellation is refunded by the tier with the highest `daysBefore` that does not exceed the days remaining; if no tier applies, the refund is 0%. The request replaces the policies as a whole. They are shown on the hotel page (`GET /api/hotels/{id}`) and the booking summary.',
  })
  @ApiParam({
    name: 'id',
    description: 'Hotel id',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @ApiOkResponse({ type: HotelPolicyResponseDto })
  @ApiBadRequestResponse({
    description:
      'The hotel id is not a valid id, a time is missing or is not HH:mm, a tier is invalid, two tiers have the same `daysBefore`, or the body has a field that is not allowed',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'The account is not a hotel moderator, or the moderator is not assigned to this hotel',
  })
  @ApiNotFoundResponse({ description: 'The hotel does not exist' })
  set(
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Body() dto: SetHotelPoliciesDto,
    @CurrentUser('id') userId: string,
  ): Promise<HotelPolicyResponseDto> {
    return this.policies.set(hotelId, dto, userId);
  }
}
