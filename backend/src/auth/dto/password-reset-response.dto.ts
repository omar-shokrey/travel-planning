import { ApiProperty } from '@nestjs/swagger';
import {
  PASSWORD_RESET_DONE_MESSAGE,
  PASSWORD_RESET_REQUESTED_MESSAGE,
} from '../auth.constants';

/** ACC-07: the one answer of `POST /api/auth/forgot-password`, whatever the email. */
export class PasswordResetRequestedResponseDto {
  @ApiProperty({ example: PASSWORD_RESET_REQUESTED_MESSAGE })
  message: string;
}

/** ACC-07: the answer of a successful `POST /api/auth/reset-password`. */
export class PasswordResetDoneResponseDto {
  @ApiProperty({ example: PASSWORD_RESET_DONE_MESSAGE })
  message: string;
}
