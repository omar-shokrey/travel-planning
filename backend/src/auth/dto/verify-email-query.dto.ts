import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ONE_TIME_TOKEN_MAX_LENGTH } from '../auth.constants';

/** ACC-02: the query of `GET /api/auth/verify-email`: the token from the email link. */
export class VerifyEmailQueryDto {
  @ApiProperty({
    description:
      'The token from the link in the verification email (the part after `token=`)',
    maxLength: ONE_TIME_TOKEN_MAX_LENGTH,
    example: 'q3Zf8kV1uX9cLr0bT2mN7pQwYh5sJd4eAiOgKl6zRvE',
  })
  @IsString({ message: 'token must be a text' })
  @IsNotEmpty({ message: 'token is required' })
  @MaxLength(ONE_TIME_TOKEN_MAX_LENGTH, {
    message: `token must have at most ${ONE_TIME_TOKEN_MAX_LENGTH} characters`,
  })
  token: string;
}
