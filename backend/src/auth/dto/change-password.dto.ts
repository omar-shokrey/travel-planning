import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import {
  PASSWORD_PATTERN,
  PASSWORD_RULE,
} from '../../common/constants/password';
import { PASSWORD_MAX_LENGTH } from '../auth.constants';

/**
 * What a logged-in user sends to change their password (ACC-08). It names no
 * user: the account is the one of the access cookie.
 */
export class ChangePasswordDto {
  @ApiProperty({
    example: 'Passw0rdOK',
    description:
      'The password the account has now, or the temporary password an admin set. The password rule is not checked on it.',
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @ApiProperty({
    example: 'N3wPassword',
    description: `The new password. It ${PASSWORD_RULE}, and must differ from the current one.`,
    minLength: 8,
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsString()
  @Matches(PASSWORD_PATTERN, { message: `newPassword ${PASSWORD_RULE}` })
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}
