import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/enums/audit-action.enum';
import { AuditTargetType } from '../audit/enums/audit-target-type.enum';
import type { AuditLogResponseDto } from '../audit/dto/audit-log-response.dto';
import { toAuditLogResponse } from '../audit/mappers/audit-log.mapper';
import { SessionsService } from '../auth/sessions.service';
import { ProviderType } from '../common/enums/provider-type.enum';
import { Role } from '../common/enums/role.enum';
import { AirlinesService } from '../flights/airlines.service';
import { HotelsService } from '../hotels/hotels.service';
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
  PROVIDER_NOT_FOUND_MESSAGE,
} from './admin.constants';
import type { CreateModeratorDto } from './dto/create-moderator.dto';
import type { ListAccountsQueryDto } from './dto/list-accounts-query.dto';
import type { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';
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
    private readonly airlines: AirlinesService,
    private readonly hotels: HotelsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates a hotel or airline moderator account linked to exactly one
   * provider, with a temporary password chosen by the admin (ACC-13). The
   * provider type follows the role, and the provider must exist; otherwise
   * 400 on `providerId`. An email that is already registered answers 409.
   * The moderator must change the password at the first login (ACC-08).
   * The creation is recorded in the audit log (GEN-07).
   */
  async createModerator(
    dto: CreateModeratorDto,
    adminId: string,
  ): Promise<UserResponseDto> {
    const providerType =
      dto.role === Role.AirlineModerator
        ? ProviderType.Airline
        : ProviderType.Hotel;
    await this.assertProviderExists(providerType, dto.providerId);

    const moderator = await this.usersService.createModerator({
      name: dto.name,
      email: dto.email,
      password: dto.temporaryPassword,
      role: dto.role,
      providerType,
      providerId: new Types.ObjectId(dto.providerId),
    });
    await this.audit.record({
      adminId,
      action: AuditAction.CreateModerator,
      targetType: AuditTargetType.User,
      targetId: moderator._id,
      details: `${dto.role} of ${providerType} ${dto.providerId}`,
    });
    return toUserResponse(moderator);
  }

  /** 400 on `providerId` when no airline or hotel has this id. */
  private async assertProviderExists(
    providerType: ProviderType,
    providerId: string,
  ): Promise<void> {
    try {
      await (providerType === ProviderType.Airline
        ? this.airlines.findEntityOrThrow(providerId)
        : this.hotels.findEntityOrThrow(providerId));
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
      throw new BadRequestException({
        message: 'Validation failed',
        errors: [
          {
            field: 'providerId',
            messages: [PROVIDER_NOT_FOUND_MESSAGE[providerType]],
          },
        ],
      });
    }
  }

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
   * The audit log of admin actions (GEN-07), newest first, one page at a
   * time, filtered by action, admin or target.
   */
  async listAuditLogs(
    query: ListAuditLogsQueryDto,
  ): Promise<PaginatedResponse<AuditLogResponseDto>> {
    const { items, total } = await this.audit.list(
      {
        action: query.action,
        adminId: query.adminId,
        targetType: query.targetType,
        targetId: query.targetId,
      },
      { skip: query.skip, limit: query.limit },
    );
    return paginate(items.map(toAuditLogResponse), total, query);
  }

  /**
   * Gives a user or a moderator a temporary password chosen by the admin
   * (ACC-07a). The account must set a new password at its next login, and a
   * login lockout (ACC-05) is cleared so the temporary password works at once.
   * Every session of the account ends, so whoever holds one (the owner, or
   * someone who stole it) must log in with the temporary password. An
   * administrator's password cannot be reset this way, so the admin's own
   * session is never touched. The reset is recorded in the audit log
   * (GEN-07), without the password.
   */
  async resetPassword(
    accountId: string,
    dto: ResetPasswordDto,
    adminId: string,
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
    await this.audit.record({
      adminId,
      action: AuditAction.ResetPassword,
      targetType: AuditTargetType.User,
      targetId: updated._id,
    });
    return toUserResponse(updated);
  }
}
