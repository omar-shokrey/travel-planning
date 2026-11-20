import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import { LinkBookingDto } from './dto/link-booking.dto';
import { ItineraryBookingsService } from './itinerary-bookings.service';

/**
 * ITN-27 (bonus): bookings linked to the days of an itinerary, under
 * `/api/itineraries/:id/bookings`. Registered after the public itinerary
 * controller in the module, so the routes under `/api/itineraries/public/`
 * are matched first, as before.
 */
@ApiTags('Itineraries')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in' })
@ApiForbiddenResponse({
  description:
    'Not a registered user: administrators and moderators cannot use itineraries',
})
@Roles(Role.User)
@Controller('itineraries')
export class ItineraryBookingsController {
  constructor(private readonly itineraryBookings: ItineraryBookingsService) {}

  @Post(':id/bookings')
  @ApiOperation({
    summary: 'Link a booked flight or hotel to a day (bonus)',
    description:
      "ITN-27. Link one of your own flight bookings or hotel reservations to a day of your own itinerary. Only a `confirmed` or `completed` booking can be linked (not `pending_payment`, `expired` or `cancelled`). The booking's reference, total and currency are copied into the day's `linkedBookings` when it is linked and are not read again: the booking is never changed, and a later cancellation does not change the link. The amount counts in the day's total, the city-group subtotal and the budget summary: a flight under `intercity_transport`, a hotel under `accommodation`; when you open the itinerary or the summary it is also converted to your currency (ITN-18). A booking can be linked once per itinerary, and a day has at most 10 linked bookings. The day is your choice: its date is not compared with the booking's. Linked bookings are only for you: the public view, the admin view and a clone never show them. Checks, in order: 400 for an invalid id, field or unknown field; 404 for the itinerary, then 403 if it is someone else's; 404 for the day; 404 for the booking (missing or not yours); 409 for its status; 409 if it is already linked; 409 if the day is full. Returns the itinerary with its days.",
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiCreatedResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({
    description:
      'The itinerary id, `dayId` or `bookingId` is not an id, `bookingType` is not flight or hotel, a field is missing, or an unknown field was sent',
  })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({
    description:
      'No itinerary has this id, it has no day with this id, or you have no booking of this type with this id ("Booking not found", also for a booking of another user)',
  })
  @ApiConflictResponse({
    description:
      'The booking is not confirmed or completed, it is already linked to this itinerary, the day already has 10 linked bookings, or the itinerary kept being changed by other requests at the same time',
  })
  link(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: LinkBookingDto,
    @CurrentUser('id') userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    return this.itineraryBookings.link(id, dto, userId);
  }
}
