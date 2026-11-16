import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { SessionsService } from '../auth/sessions.service';
import { ProviderType } from '../common/enums/provider-type.enum';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
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
  ACCOUNT_ALREADY_SUSPENDED_MESSAGE,
  ACCOUNT_DEACTIVATED_MESSAGE,
  ACCOUNT_NOT_FOUND_MESSAGE,
  ACCOUNT_NOT_SUSPENDED_MESSAGE,
  ACCOUNT_STATUS_CHANGED_MESSAGE,
  ADMIN_PASSWORD_RESET_FORBIDDEN_MESSAGE,
  ADMIN_STATUS_FORBIDDEN_MESSAGE,
  MODERATOR_SUSPENDED_NOTIFICATION,
  PROVIDER_ALREADY_DEACTIVATED_MESSAGE,
  PROVIDER_NOT_DEACTIVATED_MESSAGE,
  PROVIDER_NOT_FOUND_MESSAGE,
  PROVIDER_STATUS_CHANGED_MESSAGE,
  providerDeactivatedNotification,
} from './admin.constants';
import type { CreateModeratorDto } from './dto/create-moderator.dto';
import type { ListAccountsQueryDto } from './dto/list-accounts-query.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import type { ProviderStatusResponseDto } from './dto/provider-status-response.dto';
import { toProviderStatusResponse } from './mappers/provider-status.mapper';
import { NotificationLinkType } from '../notifications/enums/notification-link-type.enum';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';

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
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Creates a hotel or airline moderator account linked to exactly one
   * provider, with a temporary password chosen by the admin (ACC-13). The
   * provider type follows the role, and the provider must exist; otherwise
   * 400 on `providerId`. An email that is already registered answers 409.
   * The moderator must change the password at the first login (ACC-08).
   */
  async createModerator(dto: CreateModeratorDto): Promise<UserResponseDto> {
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

  /**
   * Suspends a registered user (ACC-16) or a moderator (ACC-15). A suspended
   * account cannot log in or refresh (403 "Your account is suspended"), and
   * every session of the account ends at once, so reactivating later does not
   * bring old logins back. Bookings stay valid and content stays visible:
   * nothing else changes. A moderator also gets a notification (ACC-15).
   */
  async suspend(accountId: string): Promise<UserResponseDto> {
    const account = await this.findUserForStatusChange(accountId);
    if (account.status === UserStatus.Deactivated) {
      throw new ConflictException(ACCOUNT_DEACTIVATED_MESSAGE);
    }
    if (account.status === UserStatus.Suspended) {
      throw new ConflictException(ACCOUNT_ALREADY_SUSPENDED_MESSAGE);
    }

    const updated = await this.usersService.changeStatus(
      account._id,
      UserStatus.Active,
      UserStatus.Suspended,
    );
    if (!updated) {
      throw new ConflictException(ACCOUNT_STATUS_CHANGED_MESSAGE);
    }
    // After the status, so a failure here never leaves the account active.
    await this.sessions.revokeAllOfUser(accountId, new Date());
    await this.notifySuspendedModerator(updated.role, updated._id);
    return toUserResponse(updated);
  }

  /**
   * Reactivates a suspended user (ACC-16) or moderator (ACC-15): the account
   * can log in again.
   */
  async reactivate(accountId: string): Promise<UserResponseDto> {
    const account = await this.findUserForStatusChange(accountId);
    if (account.status === UserStatus.Deactivated) {
      throw new ConflictException(ACCOUNT_DEACTIVATED_MESSAGE);
    }
    if (account.status === UserStatus.Active) {
      throw new ConflictException(ACCOUNT_NOT_SUSPENDED_MESSAGE);
    }

    const updated = await this.usersService.changeStatus(
      account._id,
      UserStatus.Suspended,
      UserStatus.Active,
    );
    if (!updated) {
      throw new ConflictException(ACCOUNT_STATUS_CHANGED_MESSAGE);
    }
    return toUserResponse(updated);
  }

  /**
   * The account whose status an admin changes: a registered user (ACC-16) or
   * a moderator (ACC-15). 404 when it does not exist, 403 for an
   * administrator.
   */
  private async findUserForStatusChange(accountId: string) {
    const account = await this.usersService.findEntityById(accountId);
    if (!account) {
      throw new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE);
    }
    if (account.role === Role.Admin) {
      throw new ForbiddenException(ADMIN_STATUS_FORBIDDEN_MESSAGE);
    }
    return account;
  }

  // ---- Moderator suspension and provider status (ACC-15) ----

  /**
   * A suspended moderator gets an in-app notification, read after a
   * reactivation. A registered user (ACC-16) does not. `notify` never throws.
   */
  private async notifySuspendedModerator(
    role: Role,
    accountId: Types.ObjectId,
  ): Promise<void> {
    if (role === Role.AirlineModerator || role === Role.HotelModerator) {
      await this.notifications.notify(
        accountId,
        NotificationType.AccountSuspended,
        MODERATOR_SUSPENDED_NOTIFICATION,
      );
    }
  }

  /**
   * Deactivates a hotel or airline (ACC-15): it is hidden from search and
   * cannot be booked, while its existing confirmed bookings remain valid. Its
   * moderator accounts keep their status (suspending them is separate), and
   * each of them gets an in-app notification.
   */
  async deactivateProvider(
    type: ProviderType,
    id: string,
  ): Promise<ProviderStatusResponseDto> {
    const updated = await this.changeProviderActive(type, id, false);
    // After the update, so a notification never announces a change that
    // failed. `notifyMany` never throws.
    const moderatorIds = await this.usersService.findModeratorIdsOfProvider(
      type,
      updated._id,
    );
    await this.notifications.notifyMany(
      moderatorIds,
      NotificationType.ProviderDeactivated,
      providerDeactivatedNotification(type, updated.name),
      // The notification links have no airline kind (GEN-01 data model).
      type === ProviderType.Hotel
        ? { type: NotificationLinkType.Hotel, id: updated._id }
        : undefined,
    );
    return toProviderStatusResponse(type, updated);
  }

  /** Makes a deactivated hotel or airline active again (ACC-15). */
  async reactivateProvider(
    type: ProviderType,
    id: string,
  ): Promise<ProviderStatusResponseDto> {
    const updated = await this.changeProviderActive(type, id, true);
    return toProviderStatusResponse(type, updated);
  }

  /**
   * Sets `active` through the module that owns the provider. 404 when it
   * does not exist, 409 when it already has that value or another request
   * changed it between the check and the update.
   */
  private async changeProviderActive(
    type: ProviderType,
    id: string,
    active: boolean,
  ) {
    const owner = type === ProviderType.Airline ? this.airlines : this.hotels;
    const provider = await owner.findEntityOrThrow(id);
    if (provider.active === active) {
      throw new ConflictException(
        active
          ? PROVIDER_NOT_DEACTIVATED_MESSAGE
          : PROVIDER_ALREADY_DEACTIVATED_MESSAGE,
      );
    }
    const updated = await owner.setActive(id, active);
    if (!updated) {
      throw new ConflictException(PROVIDER_STATUS_CHANGED_MESSAGE);
    }
    return updated;
  }
}
