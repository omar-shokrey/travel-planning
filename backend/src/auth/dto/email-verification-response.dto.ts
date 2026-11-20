import { ApiProperty } from '@nestjs/swagger';
import { VERIFICATION_EMAIL_SENT_MESSAGE } from '../auth.constants';

/** ACC-02: the answer of a verification link that worked. */
export class EmailVerifiedResponseDto {
  @ApiProperty({ example: true })
  verified: true;
}

/** ACC-02: the answer of a request for a new verification link. */
export class VerificationEmailSentResponseDto {
  @ApiProperty({ example: VERIFICATION_EMAIL_SENT_MESSAGE })
  message: string;
}
