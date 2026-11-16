import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  CURRENCY_CODE_PATTERN,
  USER_NAME_MAX_LENGTH,
} from '../users.constants';

/** Removes the spaces around a text. Anything else is left for the validators. */
const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** "eur" and " EUR " are the same currency code. */
const trimAndUppercase = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * What a logged-in user may change in their own profile (ACC-09). Every field
 * is optional; a field that is left out keeps its value. The email, the role,
 * the status and the password are not here, so the global ValidationPipe
 * rejects them. Every field is validated before anything is saved.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'Sara Ahmed',
    maxLength: USER_NAME_MAX_LENGTH,
    description: 'Outer spaces are removed. It cannot be empty or null.',
  })
  // Not @IsOptional(): that would let `null` through, and a name is required.
  @ValidateIf((_dto, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(USER_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    example: '+20 10 1234 5678',
    nullable: true,
    type: String,
    description:
      'An international phone number that starts with + and the country code. `null` removes it.',
  })
  @IsOptional()
  @Transform(trim)
  @IsPhoneNumber(undefined, {
    message:
      'phone must be an international phone number that starts with + and the country code',
  })
  phone?: string | null;

  @ApiPropertyOptional({
    example: 'EGP',
    nullable: true,
    type: String,
    description:
      'A currency code of the countries list (GEN-12), used only to show prices. Prices and payments stay in USD (PAY-04). Letter case is ignored. `null` removes it.',
  })
  @IsOptional()
  @Transform(trimAndUppercase)
  @IsString()
  @Matches(CURRENCY_CODE_PATTERN, {
    message: 'preferredCurrency must be a currency code of 3 letters',
  })
  preferredCurrency?: string | null;
}
