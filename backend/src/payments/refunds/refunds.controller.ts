import { Controller, Get, Param } from '@nestjs/common';
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { RefundResponseDto } from './dto/refund-response.dto';
import { REFUND_NOT_FOUND_MESSAGE } from './refunds.constants';
import { RefundsService } from './refunds.service';

/**
 * PAY-03: a user reads one of their refunds. There is no route that creates
 * a refund: a refund only comes from a cancellation (FLT-26, HTL-21, FLT-06)
 * or a late payment, so a client never sends an amount or a status.
 */
@ApiTags('Payments')
@ApiCookieAuth()
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get(':id')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Show one of my refunds (PAY-03)',
    description: [
      'Registered users only, for their own refund. A refund is made when a confirmed booking is cancelled with a positive refund (at the provider tiers, or 100% when the provider cancels), or when a payment arrives after the booking hold ended (100%, `late_payment`).',
      'The status is `pending` until Stripe confirms the refund, then `refunded`, or `failed` when Stripe could not refund the card. Amounts are whole minor units of `currency`. The booking details show the same status.',
    ].join('\n\n'),
  })
  @ApiParam({
    name: 'id',
    description: 'Refund id',
    example: '6740f1c2a4b5c6d7e8f90aaa',
  })
  @ApiOkResponse({ type: RefundResponseDto })
  @ApiBadRequestResponse({ description: '`id` is not a valid id' })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'Only a registered user (role `user`) has refunds; administrators and moderators cannot',
  })
  @ApiNotFoundResponse({
    description: `"${REFUND_NOT_FOUND_MESSAGE}": no such refund, or it belongs to another user`,
  })
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<RefundResponseDto> {
    return this.refunds.findOwned(id, userId);
  }
}
