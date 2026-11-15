import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthCookiesService } from './auth-cookies.service';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookies: AuthCookiesService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Register a new account (ACC-01)',
    description:
      'Open to guests. Creates an active account with the `user` role. It does not log the user in: call POST /api/auth/login next.',
  })
  @ApiCreatedResponse({
    description: 'The account was created',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'A field is invalid: the email is not an email, the password breaks the rule, the consent is not given, or the body has a field that is not allowed. `errors` lists the messages of each field.',
  })
  @ApiConflictResponse({ description: 'The email is already registered' })
  register(@Body() dto: RegisterDto): Promise<UserResponseDto> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in with email and password (ACC-04)',
    description:
      'Open to guests. On success the response sets two httpOnly cookies, `access_token` and `refresh_token`, and returns the account; the `role` tells the frontend which home page to open. The browser sends the cookies on every later request, so Swagger UI needs no further step. An unknown email, a wrong password and a deactivated account all get the same 401 message. After 5 wrong passwords in a row the account is locked for 15 minutes (ACC-05): the 5th wrong password and every login during the lock get 429 with the time left, even with the right password. When the lock ends the count starts again, and a successful login resets it.',
  })
  @ApiOkResponse({
    description: 'Logged in. The authentication cookies are set.',
    type: UserResponseDto,
    headers: {
      'Set-Cookie': {
        description: 'The `access_token` and `refresh_token` cookies',
        schema: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'The email is not an email, or the password is missing.',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiForbiddenResponse({ description: 'Your account is suspended' })
  @ApiTooManyRequestsResponse({
    description:
      'The account is locked for 15 minutes after 5 failed logins in a row (ACC-05). The message says how many minutes are left. The right password is refused too until the lock ends.',
  })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserResponseDto> {
    const { user, tokens } = await this.authService.login(dto);
    this.authCookies.setAuthCookies(response, tokens);
    return user;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Log out (ACC-06)',
    description:
      'Revokes the session on the server, so the access token and the refresh token stop working at once, and clears both cookies. It is open to everyone and always answers 204: logging out with no cookie, with an expired or broken one, or a second time is harmless. It does not need a valid access token, so a user whose access token has expired can still log out. Other sessions of the same user (another browser) stay logged in.',
  })
  @ApiNoContentResponse({
    description: 'Logged out. Both cookies are cleared.',
    headers: {
      'Set-Cookie': {
        description: 'The `access_token` and `refresh_token` cookies, cleared',
        schema: { type: 'string' },
      },
    },
  })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout({
      refreshToken: this.authCookies.readRefreshToken(request),
      accessToken: this.authCookies.readAccessToken(request),
    });
    this.authCookies.clearAuthCookies(response);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Get new tokens with the refresh cookie (ACC-06)',
    description:
      'Call it when a request answers 401 because the access token has expired (it lasts ACCESS_TOKEN_MINUTES). It needs no access token: the `refresh_token` cookie is enough, and the browser sends it to this route. On success both cookies are replaced and the account is returned. The refresh token works once: the new one replaces it, and the old one gets 401. A session with no authenticated request for 30 minutes has expired, and so has one that was logged out: both get 401 and need a new login. A refresh counts as activity, so call it because a user action got a 401, not on a timer.',
  })
  @ApiOkResponse({
    description: 'New tokens issued. Both cookies are replaced.',
    type: UserResponseDto,
    headers: {
      'Set-Cookie': {
        description: 'The new `access_token` and `refresh_token` cookies',
        schema: { type: 'string' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description:
      'No refresh cookie, or it is not valid, was already used, was logged out, or the session has been idle for 30 minutes. Log in again.',
  })
  @ApiForbiddenResponse({ description: 'Your account is suspended' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserResponseDto> {
    const { user, tokens } = await this.authService.refresh(
      this.authCookies.readRefreshToken(request),
    );
    this.authCookies.setAuthCookies(response, tokens);
    return user;
  }

  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'The logged-in user (ACC-04)',
    description:
      'Returns the account the access cookie belongs to. The frontend calls it to learn who is logged in, because it cannot read the httpOnly cookie.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({
    description:
      'Not logged in, or the access token is invalid or expired (it lasts ACCESS_TOKEN_MINUTES)',
  })
  @ApiForbiddenResponse({ description: 'Your account is suspended' })
  me(@CurrentUser('id') userId: string): Promise<UserResponseDto> {
    return this.authService.me(userId);
  }
}
