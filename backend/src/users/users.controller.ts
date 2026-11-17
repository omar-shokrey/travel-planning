import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { ProfileService } from './profile.service';

/** The own account of the logged-in user (`/api/users/me`). Every role has one. */
@ApiTags('users')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  description: 'Not logged in, or the access token is invalid or expired',
})
@ApiForbiddenResponse({ description: 'Your account is suspended' })
@Controller('users')
export class UsersController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('me')
  @ApiOperation({
    summary: 'My account (ACC-11)',
    description:
      'Any logged-in user. Returns your own account: the one the login cookie belongs to. The route has no id, so nobody can ask for another account this way. The same account is returned by `GET /api/auth/me`. The password hash and the login counters are never returned.',
  })
  @ApiOkResponse({ description: 'Your account', type: UserResponseDto })
  getMyProfile(@CurrentUser('id') userId: string): Promise<UserResponseDto> {
    return this.profileService.getMyProfile(userId);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Edit my profile (ACC-09)',
    description:
      'Any logged-in user. Changes the name, the phone number and the preferred currency. Send only the fields to change; `null` removes the phone or the currency. Nothing is saved unless every field is valid. The email, the role, the status and the password cannot be changed here. The preferred currency only changes how prices are shown: prices and payments stay in USD (PAY-04).',
  })
  @ApiOkResponse({ description: 'The saved profile', type: UserResponseDto })
  @ApiBadRequestResponse({
    description:
      'A field is invalid: an empty name, a phone number without + and the country code, a currency that is not supported, or a field that may not be changed. `errors` lists each field.',
  })
  updateMyProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    return this.profileService.updateMyProfile(userId, dto);
  }
}
