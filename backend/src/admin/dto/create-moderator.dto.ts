import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../auth/auth.constants';
import {
  PASSWORD_PATTERN,
  PASSWORD_RULE,
} from '../../common/constants/password';
import { Role } from '../../common/enums/role.enum';
import { USER_NAME_MAX_LENGTH } from '../../users/users.constants';

/** The two roles an admin can create here (ACC-13). */
export const MODERATOR_ROLES = [
  Role.AirlineModerator,
  Role.HotelModerator,
] as const;
export type ModeratorRole = (typeof MODERATOR_ROLES)[number];

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimAndLowercase = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * What an admin sends to create a moderator account (ACC-13). Every field is
 * required, so `null` is refused like a missing field. The status, the
 * password-change flag and the assignment are set by the server.
 */
export class CreateModeratorDto {
  @ApiProperty({ example: 'Mona Hotel', maxLength: USER_NAME_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(USER_NAME_MAX_LENGTH)
  name: string;

  @ApiProperty({
    example: 'mona@example.com',
    description:
      'Must not belong to another account. Letter case and outer spaces are ignored.',
  })
  @Transform(trimAndLowercase)
  @IsEmail()
  email: string;

  @ApiProperty({
    enum: MODERATOR_ROLES,
    example: Role.HotelModerator,
    description:
      '`airline_moderator` links the account to an airline, `hotel_moderator` to a hotel.',
  })
  @IsIn(MODERATOR_ROLES, {
    message: `role must be one of: ${MODERATOR_ROLES.join(', ')}`,
  })
  role: ModeratorRole;

  @ApiProperty({
    example: '6740f1c2a4b5c6d7e8f90abc',
    description:
      'The id of the airline (for an airline moderator) or of the hotel (for a hotel moderator) the account manages.',
  })
  @IsMongoId({ message: 'providerId must be a valid id' })
  providerId: string;

  @ApiProperty({
    example: 'Temp0rary1',
    description: `The temporary password the admin gives the moderator. It ${PASSWORD_RULE}. The moderator must change it on first login.`,
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
