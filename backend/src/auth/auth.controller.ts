import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
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
      'Open to guests. On success the response sets two httpOnly cookies, `access_token` and `refresh_token`, and returns the account; the `role` tells the frontend which home page to open. The browser sends the cookies on every later request, so Swagger UI needs no further step. An unknown email, a wrong password and a deactivated account all get the same 401 message.',
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
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserResponseDto> {
    const { user, tokens } = await this.authService.login(dto);
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
