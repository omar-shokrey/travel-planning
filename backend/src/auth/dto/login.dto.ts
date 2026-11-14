import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../auth.constants';
import { trimAndLowercase } from './transforms';

/**
 * What a user sends to log in (ACC-04). The password rule of registration is
 * not checked here: the answer for a wrong password is always the same.
 */
export class LoginDto {
  @ApiProperty({
    example: 'sara@example.com',
    description: 'Letter case and outer spaces are ignored',
  })
  @Transform(trimAndLowercase)
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Passw0rdOK', maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}
