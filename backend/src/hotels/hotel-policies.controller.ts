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

/** The policies of a hotel, set by its moderator (HTL-09). */
@ApiTags('hotels')
@ApiCookieAuth()
@Controller('hotels')
export class HotelPoliciesController {
  constructor(private readonly policies: HotelPoliciesService) {}

  @Put(':id/policies')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'Set the hotel policies (HTL-09)',
    description:
      'HTL-09. A hotel moderator sets the standard check-in and check-out times of their assigned hotel, as HH:mm on the 24-hour clock. The request replaces the policies as a whole. The times are shown on the hotel page (`GET /api/hotels/{id}`) and the booking summary.',
  })
  @ApiParam({
    name: 'id',
    description: 'Hotel id',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @ApiOkResponse({ type: HotelPolicyResponseDto })
  @ApiBadRequestResponse({
    description:
      'The hotel id is not a valid id, a time is missing or is not HH:mm, or the body has a field that is not allowed',
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
