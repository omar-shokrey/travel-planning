import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../auth/auth.constants';
import {
  PASSWORD_PATTERN,
  PASSWORD_RULE,
} from '../../common/constants/password';

/**
 * What an admin sends to reset the password of an account (ACC-07a). The
 * admin chooses the temporary password and gives it to the user; the account
 * must replace it at its next login.
 */
export class ResetPasswordDto {
  @ApiProperty({
    example: 'Temp0rary1',
    description: `The temporary password. It ${PASSWORD_RULE}.`,
    minLength: 8,
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsString()
  @Matches(PASSWORD_PATTERN, {
    message: `temporaryPassword ${PASSWORD_RULE}`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  temporaryPassword: string;
}
