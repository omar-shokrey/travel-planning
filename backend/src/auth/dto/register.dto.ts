import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  PASSWORD_PATTERN,
  PASSWORD_RULE,
} from '../../common/constants/password';
import { USER_NAME_MAX_LENGTH } from '../../users/users.constants';
import {
  CONSENT_REQUIRED_MESSAGE,
  PASSWORD_MAX_LENGTH,
} from '../auth.constants';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimAndLowercase = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * What a guest sends to create an account (ACC-01). It has no role and no
 * status: the server sets them.
 */
export class RegisterDto {
  @ApiProperty({ example: 'Sara Ahmed', maxLength: USER_NAME_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(USER_NAME_MAX_LENGTH)
  name: string;

  @ApiProperty({
    example: 'sara@example.com',
    description:
      'Must not belong to another account. Letter case and outer spaces are ignored.',
  })
  @Transform(trimAndLowercase)
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'Passw0rdOK',
    description: `The password ${PASSWORD_RULE}`,
    minLength: 8,
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsString()
  @Matches(PASSWORD_PATTERN, { message: `password ${PASSWORD_RULE}` })
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;

  @ApiProperty({
    example: true,
    description:
      'Consent to the terms and the privacy policy. Only `true` is accepted.',
  })
  @Equals(true, { message: CONSENT_REQUIRED_MESSAGE })
  acceptedTerms: boolean;
}
