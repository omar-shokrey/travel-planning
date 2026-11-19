import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { BookingPoliciesService } from './booking-policies.service';
import { AcceptPoliciesDto } from './dto/accept-policies.dto';
import { BookingPathDto } from './dto/booking-path.dto';
import { BookingPoliciesResponseDto } from './dto/booking-policies-response.dto';
import {
  HOLD_EXPIRED_MESSAGE,
  NOT_WAITING_FOR_PAYMENT_MESSAGE,
  POLICIES_MUST_BE_ACCEPTED_MESSAGE,
} from './payments.constants';

const NOT_FOUND =
  '"Booking not found": no such booking, or it belongs to another user (a user never learns that someone else\'s booking exists)';

/** PAY-02: the provider's policies before payment, and their acceptance. */
@ApiTags('Payments')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  description: 'Not logged in, or the access token is invalid or expired',
})
@ApiForbiddenResponse({
  description:
    'Only a registered user (role `user`) has bookings; administrators and moderators cannot',
})
@ApiNotFoundResponse({ description: NOT_FOUND })
@Controller('bookings')
export class BookingPoliciesController {
  constructor(private readonly policies: BookingPoliciesService) {}

  @Get(':type/:id/policies')
  @Roles(Role.User)
  @ApiOperation({
    summary: "Show the provider's policies before payment (PAY-02)",
    description: [
      'Registered users only, for their own booking. `type` is `flight` or `hotel`.',
      "A flight booking shows, for each flight, the airline's cancellation tiers and the baggage rule: free bags and their maximum weight in the cabin, and the price and number of extra bags (`extraBagPrice` `null` when the airline sells none). A hotel reservation shows the check-in and check-out times (`null` if the hotel set none) and the hotel's cancellation tiers. Tiers are highest `daysBefore` first; an empty list means no refund.",
      'These are the policies copied into the booking when it was made, so they are exactly what a later refund uses, whatever the provider changes afterwards. `policyAcceptedAt` tells whether the user accepted them. Any status can be read.',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: BookingPoliciesResponseDto })
  @ApiBadRequestResponse({
    description:
      '`type` is not `flight` or `hotel`, or `id` is not a valid id. `errors` lists each field.',
  })
  findPolicies(
    @Param() path: BookingPathDto,
    @CurrentUser('id') userId: string,
  ): Promise<BookingPoliciesResponseDto> {
    return this.policies.findPolicies(path.type, path.id, userId);
  }

  @Post(':type/:id/accept-policies')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.User)
  @ApiOperation({
    summary: "Accept the provider's policies (PAY-02)",
    description: [
      'Registered users only, for their own booking. The acceptance checkbox: the body must be `{ "accepted": true }`. Payment (PAY-01) is blocked until the policies are accepted.',
      'Only while the booking waits for payment and its hold has not ended. The moment of the acceptance is stored (`policyAcceptedAt`, UTC). Accepting again is harmless: it answers 200 with the first timestamp, which never changes.',
    ].join('\n\n'),
  })
  @ApiOkResponse({
    type: BookingPoliciesResponseDto,
    description:
      'Accepted (or already accepted): the policies with `policyAcceptedAt`',
  })
  @ApiBadRequestResponse({
    description: `\`type\` or \`id\` is invalid, \`accepted\` is missing or not \`true\` ("${POLICIES_MUST_BE_ACCEPTED_MESSAGE}"), or the body has another field. \`errors\` lists each field.`,
  })
  @ApiConflictResponse({
    description: `"${NOT_WAITING_FOR_PAYMENT_MESSAGE}" (confirmed, expired, completed or cancelled), or "${HOLD_EXPIRED_MESSAGE}". Nothing is stored.`,
  })
  acceptPolicies(
    @Param() path: BookingPathDto,
    // The checkbox: validated to be `true`; nothing else is read from it.
    @Body() _body: AcceptPoliciesDto,
    @CurrentUser('id') userId: string,
  ): Promise<BookingPoliciesResponseDto> {
    return this.policies.acceptPolicies(path.type, path.id, userId);
  }
}
