import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}
