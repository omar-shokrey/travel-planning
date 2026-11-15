import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SessionsService } from '../auth/sessions.service';
import { Role } from '../common/enums/role.enum';
import type { UserResponseDto } from '../users/dto/user-response.dto';
import { toUserResponse } from '../users/mappers/user.mapper';
import { UsersService } from '../users/users.service';
import {
  ACCOUNT_NOT_FOUND_MESSAGE,
  ADMIN_PASSWORD_RESET_FORBIDDEN_MESSAGE,
} from './admin.constants';
import type { ResetPasswordDto } from './dto/reset-password.dto';

/**
 * Account management by an administrator. It never writes to the `users`
 * collection itself: `UsersService` owns it.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly usersService: UsersService,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * Gives a user or a moderator a temporary password chosen by the admin
   * (ACC-07a). The account must set a new password at its next login, and a
   * login lockout (ACC-05) is cleared so the temporary password works at once.
   * Every session of the account ends, so whoever holds one (the owner, or
   * someone who stole it) must log in with the temporary password. An
   * administrator's password cannot be reset this way, so the admin's own
   * session is never touched.
   */
  async resetPassword(
    accountId: string,
    dto: ResetPasswordDto,
  ): Promise<UserResponseDto> {
    const account = await this.usersService.findEntityById(accountId);
    if (!account) {
      throw new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE);
    }
    if (account.role === Role.Admin) {
      throw new ForbiddenException(ADMIN_PASSWORD_RESET_FORBIDDEN_MESSAGE);
    }

    const updated = await this.usersService.setTemporaryPassword(
      account._id,
      dto.temporaryPassword,
    );
    if (!updated) {
      throw new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE);
    }
    // After the password, so a failure here never leaves the old password in
    // place.
    await this.sessions.revokeAllOfUser(accountId, new Date());
    return toUserResponse(updated);
  }
}
