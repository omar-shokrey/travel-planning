import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';
import { trimAndLowercase } from './transforms';

/** ACC-07: the email of the account whose password was forgotten. */
export class ForgotPasswordDto {
  @ApiProperty({
    example: 'sara@example.com',
    description: 'Letter case and outer spaces are ignored, as at login',
  })
  @Transform(trimAndLowercase)
  @IsEmail({}, { message: 'email must be an email' })
  email: string;
}
