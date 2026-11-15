import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '../common/enums/role.enum';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import type { UserResponseDto } from '../users/dto/user-response.dto';
import { toUserResponse } from '../users/mappers/user.mapper';
import { UsersService } from '../users/users.service';
import {
  ACCOUNT_NOT_FOUND_MESSAGE,
  ADMIN_PASSWORD_RESET_FORBIDDEN_MESSAGE,
} from './admin.constants';
import type { ListAccountsQueryDto } from './dto/list-accounts-query.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';

/**
 * Account management by an administrator. It never writes to the `users`
 * collection itself: `UsersService` owns it.
 */
@Injectable()
export class AdminService {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Every account, one page at a time (ACC-14): name, email, role, status and
   * registration date, newest first. The admin can search the name or the
   * email and filter by role and status.
   */
  async listAccounts(
    query: ListAccountsQueryDto,
  ): Promise<PaginatedResponse<UserResponseDto>> {
    const { items, total } = await this.usersService.listAccounts(
      { search: query.search, role: query.role, status: query.status },
      { skip: query.skip, limit: query.limit },
    );
    return paginate(items.map(toUserResponse), total, query);
  }

  /**
   * Gives a user or a moderator a temporary password chosen by the admin
   * (ACC-07a). The account must set a new password at its next login, and a
   * login lockout (ACC-05) is cleared so the temporary password works at once.
   * An administrator's password cannot be reset this way.
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
    return toUserResponse(updated);
  }
}
