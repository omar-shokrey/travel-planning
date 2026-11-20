import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import {
  PASSWORD_PATTERN,
  PASSWORD_RULE,
} from '../../common/constants/password';
import {
  PASSWORD_MAX_LENGTH,
  ONE_TIME_TOKEN_MAX_LENGTH,
} from '../auth.constants';

/**
 * ACC-07: the token of the reset link and the new password. The password is
 * checked here, before the service uses the token, so a password that breaks
 * the rule never uses up a valid link. Not to be mixed up with the admin's
 * `ResetPasswordDto` (ACC-07a).
 */
export class ResetForgottenPasswordDto {
  @ApiProperty({
    description:
      'The token from the link in the reset email (the part after `token=`)',
    maxLength: ONE_TIME_TOKEN_MAX_LENGTH,
    example: 'q3Zf8kV1uX9cLr0bT2mN7pQwYh5sJd4eAiOgKl6zRvE',
  })
  @IsString({ message: 'token must be a text' })
  @IsNotEmpty({ message: 'token is required' })
  @MaxLength(ONE_TIME_TOKEN_MAX_LENGTH, {
    message: `token must have at most ${ONE_TIME_TOKEN_MAX_LENGTH} characters`,
  })
  token: string;

  @ApiProperty({
    example: 'N3wPassword',
    description: `The new password. It ${PASSWORD_RULE}, as at registration and in a password change.`,
    minLength: 8,
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsString()
  @Matches(PASSWORD_PATTERN, { message: `newPassword ${PASSWORD_RULE}` })
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}
