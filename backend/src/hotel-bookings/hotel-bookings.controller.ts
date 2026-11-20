import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { EMAIL_NOT_VERIFIED_MESSAGE } from '../auth/auth.constants';
import { RequireVerifiedEmail } from '../auth/decorators/require-verified-email.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import { HotelBookingResponseDto } from './dto/hotel-booking-response.dto';
import { HotelBookingsService } from './hotel-bookings.service';

@ApiTags('hotel-bookings')
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(private readonly hotelBookings: HotelBookingsService) {}

  @Post()
  @Roles(Role.User)
  // ACC-02: an account whose email is not verified cannot book.
  @RequireVerifiedEmail()
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Reserve rooms and hold them for payment (HTL-16, HTL-18)',
    description:
      "HTL-16. A registered user reserves one or more rooms of one hotel for the same dates, with the adults and the children's ages (0 to 17) of each room. The reservation needs at least one adult, and no room may have more guests than its maximum occupancy. The total is the sum over the rooms of nights x the room's price now. HTL-18: all the rooms are held together for 10 minutes as one `pending_payment` reservation. If any room is not free for the whole stay (booked, held by someone else, blocked, deactivated or outside its availability), the whole request is refused with 409 and nothing is held. A hold that runs out without payment stops counting, so the rooms are free again for everyone. The payment (HTL-17) and the acceptance of the policies (PAY-02) are separate steps.",
  })
  @ApiCreatedResponse({ type: HotelBookingResponseDto })
  @ApiBadRequestResponse({
    description:
      'A field is missing or invalid, check-out is not after check-in, check-in is in the past, the stay has more than 366 nights, a room is chosen twice, there is no adult, a room has no guest or more guests than its maximum occupancy',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description: `Only a registered user (role \`user\`) can reserve rooms. ACC-02: also "${EMAIL_NOT_VERIFIED_MESSAGE}" while the email of the account is not verified.`,
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
}
