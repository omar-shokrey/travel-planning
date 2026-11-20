import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
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
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthCookiesService } from './auth-cookies.service';
import {
  EMAIL_ALREADY_VERIFIED_MESSAGE,
  EMAIL_NOT_VERIFIED_MESSAGE,
  EMAIL_SWITCHED_OFF_MESSAGE,
  EMAIL_VERIFICATION_TOKEN_HOURS,
  INVALID_RESET_LINK_MESSAGE,
  INVALID_VERIFICATION_LINK_MESSAGE,
  PASSWORD_CHANGE_REQUIRED_MESSAGE,
  PASSWORD_RESET_DONE_MESSAGE,
  PASSWORD_RESET_TOKEN_MINUTES,
  VERIFICATION_RESEND_TOO_SOON_MESSAGE,
} from './auth.constants';
import { AuthService } from './auth.service';
import { AllowTemporaryPassword } from './decorators/allow-temporary-password.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  EmailVerifiedResponseDto,
  VerificationEmailSentResponseDto,
} from './dto/email-verification-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import {
  PasswordResetDoneResponseDto,
  PasswordResetRequestedResponseDto,
} from './dto/password-reset-response.dto';
import { ResetForgottenPasswordDto } from './dto/reset-forgotten-password.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailQueryDto } from './dto/verify-email-query.dto';
import { QueryFreeExceptionsFilter } from './filters/query-free-exceptions.filter';

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
    summary: 'Register a new account (ACC-01, ACC-02)',
    description: [
      'Open to guests. Creates an active account with the `user` role. It does not log the user in: call POST /api/auth/login next.',
      `ACC-02: when the server sends email (SMTP_HOST is set), the account is created with \`emailVerified: false\` and a verification link, valid for ${EMAIL_VERIFICATION_TOKEN_HOURS} hours, is emailed after the answer. The account can log in and browse, but booking answers 403 "${EMAIL_NOT_VERIFIED_MESSAGE}" until the link is opened (GET /api/auth/verify-email). **When email is switched off (SMTP_HOST empty), the account is created verified** (\`emailVerified: true\`) and nothing is sent, because nobody could verify without a mail server.`,
    ].join('\n\n'),
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
  @Get('verify-email')
  // The token is in the query: keep it out of the log of an error.
  @UseFilters(QueryFreeExceptionsFilter)
  @ApiOperation({
    summary: 'Verify my email address with the link from the email (ACC-02)',
    description: `Open to guests: the link in the verification email works without a login. Send the \`token\` of the link. It works once, for ${EMAIL_VERIFICATION_TOKEN_HOURS} hours, and only the newest link of the account works. After it, the account can book. Until the frontend page \`/verify-email\` exists (Milestone 2), copy the token from the link in the email and paste it here.`,
  })
  @ApiOkResponse({
    description: 'The email address is verified',
    type: EmailVerifiedResponseDto,
  })
  @ApiBadRequestResponse({
    description: `"${INVALID_VERIFICATION_LINK_MESSAGE}": the token is unknown, has expired, was already used or was replaced by a newer link. Also when \`token\` is missing, empty, too long, or the query has another parameter (\`errors\` lists it).`,
  })
  verifyEmail(
    @Query() query: VerifyEmailQueryDto,
  ): Promise<EmailVerifiedResponseDto> {
    return this.authService.verifyEmail(query.token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(Role.User)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Send me a new verification link (ACC-02)',
    description: `Registered users (role \`user\`) whose email is not verified yet. Not in section 8 of the project description: added, with the team leader's approval, so that a lost email does not block booking for good. A new link, valid for ${EMAIL_VERIFICATION_TOKEN_HOURS} hours, replaces the old one at once (the old link answers 400) and is emailed after the answer. At most one link a minute (the link sent at registration counts).`,
  })
  @ApiAcceptedResponse({
    description: 'The new link is on its way',
    type: VerificationEmailSentResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description: `Not a registered user (moderators and administrators are always verified), the account is suspended, or "${PASSWORD_CHANGE_REQUIRED_MESSAGE}"`,
  })
  @ApiConflictResponse({
    description: `"${EMAIL_ALREADY_VERIFIED_MESSAGE}", or "${EMAIL_SWITCHED_OFF_MESSAGE}" (SMTP_HOST is empty)`,
  })
  @ApiTooManyRequestsResponse({
    description: `"${VERIFICATION_RESEND_TOO_SOON_MESSAGE}": the last link of the account is less than a minute old. Nothing is sent.`,
  })
  resendVerification(
    @CurrentUser('id') userId: string,
  ): Promise<VerificationEmailSentResponseDto> {
    return this.authService.resendVerification(userId);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ask for a password reset link by email (ACC-07)',
    description: `Open to guests. **The answer is the same 202 and the same body for every email**: an unknown one, a deactivated, suspended, moderator or administrator account, or a registered user, so it never tells whether an account exists. The work runs after the answer: only an active account with the role \`user\` gets an email with a link that works once, for ${PASSWORD_RESET_TOKEN_MINUTES} minutes; a newer request replaces the older link, which stops working. Moderators and administrators use the admin reset (ACC-07a, POST /api/admin/users/:id/reset-password). When the server sends no email (SMTP_HOST empty), nothing is sent.`,
  })
  @ApiAcceptedResponse({
    description: 'The same answer for every email',
    type: PasswordResetRequestedResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      '`email` is missing or is not an email, or the body has another field',
  })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): PasswordResetRequestedResponseDto {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set a new password with the link from the email (ACC-07)',
    description: `Open to guests. Send the \`token\` of the reset link and the new password (8 or more characters with a letter and a digit, as at registration). The password is checked first, so a password that breaks the rule does not use up the link. The link works once, for ${PASSWORD_RESET_TOKEN_MINUTES} minutes, and only the newest link of the account works. On success the password is replaced, a login lockout (ACC-05) and a temporary password (ACC-07a) are cleared, and **every session of the account ends**. Nobody is logged in: log in with the new password next. If the server fails (500) after the password was stored, the link is used up: ask for a new one, whose reset ends the old sessions.`,
  })
  @ApiOkResponse({
    description: `"${PASSWORD_RESET_DONE_MESSAGE}"`,
    type: PasswordResetDoneResponseDto,
  })
  @ApiBadRequestResponse({
    description: `"${INVALID_RESET_LINK_MESSAGE}": the token is unknown, has expired, was already used or replaced by a newer link, or the account is no longer active. Also when \`newPassword\` breaks the password rule, \`token\` is missing, empty or too long, or the body has another field (\`errors\` lists it).`,
  })
  resetPassword(
    @Body() dto: ResetForgottenPasswordDto,
  ): Promise<PasswordResetDoneResponseDto> {
    return this.authService.resetPassword(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in with email and password (ACC-04)',
    description:
      'Open to guests. On success the response sets two httpOnly cookies, `access_token` and `refresh_token`, and returns the account; the `role` tells the frontend which home page to open. The browser sends the cookies on every later request, so Swagger UI needs no further step. An unknown email, a wrong password and a deactivated account all get the same 401 message. After 5 wrong passwords in a row the account is locked for 15 minutes (ACC-05): the 5th wrong password and every login during the lock get 429 with the time left, even with the right password. When the lock ends the count starts again, and a successful login resets it. An account with a temporary password set by an admin (ACC-13, ACC-07a) logs in normally and gets `mustChangePassword: true`: until the password is changed, every route except GET /api/auth/me and PATCH /api/auth/change-password answers 403 "You must change your temporary password first".',
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
  // ACC-13, ACC-07a: the frontend must learn who is logged in, also before
  // a temporary password is changed.
  @AllowTemporaryPassword()
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'The logged-in user (ACC-04)',
    description:
      'Returns the account the access cookie belongs to. The frontend calls it to learn who is logged in, because it cannot read the httpOnly cookie. It also works for an account with a temporary password (`mustChangePassword: true`, ACC-13, ACC-07a): until the password is changed, every route except GET /api/auth/me and PATCH /api/auth/change-password answers 403 "You must change your temporary password first".',
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

  @Patch('change-password')
  // ACC-13, ACC-07a: the way out of a temporary password.
  @AllowTemporaryPassword()
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Change my password (ACC-08)',
    description:
      'Any logged-in user. Send the current password and a new one that meets the password rule (8 or more characters with a letter and a digit) and differs from the current one. It also ends a temporary password set by an admin (ACC-13, ACC-07a): the account is returned with `mustChangePassword: false`, and the same session can use every route at once. Until then, every route except GET /api/auth/me and PATCH /api/auth/change-password answers 403 "You must change your temporary password first". This session stays logged in; every other session of the account (another browser or device) ends at once, so its access and refresh cookies get 401.',
  })
  @ApiOkResponse({
    description: 'The password was changed',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'The current password is incorrect, the new password breaks the rule or is the same as the current one, or the body has a field that is not allowed. A broken rule lists its field in `errors`.',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({ description: 'Your account is suspended' })
  changePassword(
    @CurrentUser('id') userId: string,
    @Req() request: Request,
    @Body() dto: ChangePasswordDto,
  ): Promise<UserResponseDto> {
    return this.authService.changePassword(
      userId,
      this.authCookies.readAccessToken(request),
      dto,
    );
  }
}
