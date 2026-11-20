import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../auth.constants';

/**
 * What a registered user sends to deactivate their own account (ACC-12): the
 * current password, as the confirmation. It names no user, no status and no
 * flag: the account is the one of the access cookie and the server sets the
 * rest.
 */
export class DeactivateAccountDto {
  @ApiProperty({
    example: 'Passw0rdOK',
    description:
      'The password the account has now. It confirms that the owner, and not only someone with the session, closes the account.',
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;
}
