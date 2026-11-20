import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { AccountDeactivationService } from './account-deactivation.service';
import { AuthCookiesService } from './auth-cookies.service';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';

/**
 * ACC-12: `DELETE /api/users/me`. It lives in the auth module and not in the
 * users module because it reads bookings, hides posts and itineraries and
 * ends sessions: the users module cannot import those modules without a
 * circular import. The `users` tag shows it with the other `/users/me` routes.
 */
@ApiTags('users')
@Controller('users')
export class AccountDeactivationController {
  constructor(
    private readonly deactivation: AccountDeactivationService,
    private readonly authCookies: AuthCookiesService,
  ) {}

  @Delete('me')
  @Roles(Role.User)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Deactivate my account (ACC-12)',
    description:
      'Registered users only. Send your current password to confirm. It is refused with 409 while you have an upcoming confirmed flight booking or hotel reservation (cancel it, or wait until the trip is over), or a booking waiting for payment whose hold has not ended (pay it, or wait until the hold ends); an ended hold does not block it. On success your posts and public itineraries are hidden from everyone, your comments stay and show "Deleted user", every session of the account ends, both authentication cookies are cleared, and you can no longer log in. You cannot undo it yourself and an administrator cannot reactivate it. Your email stays taken: it cannot be used to register again. Nothing is cancelled, refunded or notified.',
  })
  @ApiNoContentResponse({
    description:
      'The account is deactivated. Both cookies are cleared; there is no body.',
    headers: {
      'Set-Cookie': {
        description: 'The `access_token` and `refresh_token` cookies, cleared',
        schema: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'The current password is incorrect, or the body is invalid (no current password, or a field that is not allowed)',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'Not a registered user (administrators and moderators cannot use it), your account is suspended, or you must change your temporary password first',
  })
  @ApiConflictResponse({
    description:
      'You have an upcoming confirmed booking, or a booking waiting for payment whose hold has not ended, or your account was changed by another request at the same moment. Nothing was changed.',
  })
  async deactivateMyAccount(
    @CurrentUser('id') userId: string,
    @Body() dto: DeactivateAccountDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.deactivation.deactivate(userId, dto);
    this.authCookies.clearAuthCookies(response);
  }
}
