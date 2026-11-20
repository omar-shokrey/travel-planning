import {
  BadRequestException,
  Logger,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import type { SessionsService } from '../auth/sessions.service';
import type { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/enums/audit-action.enum';
import { AuditTargetType } from '../audit/enums/audit-target-type.enum';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';
import type { UsersService } from '../users/users.service';
import {
  ACCOUNT_ALREADY_SUSPENDED_MESSAGE,
  ACCOUNT_DEACTIVATED_MESSAGE,
  ACCOUNT_NOT_FOUND_MESSAGE,
  ACCOUNT_NOT_SUSPENDED_MESSAGE,
  ACCOUNT_SUSPENDED_NOTIFICATION,
  ADMIN_PASSWORD_RESET_FORBIDDEN_MESSAGE,
  ADMIN_STATUS_FORBIDDEN_MESSAGE,
  PROVIDER_ALREADY_DEACTIVATED_MESSAGE,
  PROVIDER_NOT_DEACTIVATED_MESSAGE,
  PROVIDER_NOT_FOUND_MESSAGE,
  PROVIDER_STATUS_CHANGED_MESSAGE,
  providerDeactivatedNotification,
  providerDeactivatedTravellerNotification,
} from './admin.constants';
import { AdminService } from './admin.service';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';
import type { AirlinesService } from '../flights/airlines.service';
import type { HotelsService } from '../hotels/hotels.service';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import type { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_MESSAGE_MAX_LENGTH } from '../notifications/notifications.constants';
import type { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import type { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import { HOTEL_NAME_MAX_LENGTH } from '../hotels/hotels.constants';
import { ProviderType } from '../common/enums/provider-type.enum';

const accountId = '6740f1c2a4b5c6d7e8f90123';
const adminId = '6740f1c2a4b5c6d7e8f90001';
const accountObjectId = new Types.ObjectId(accountId);
const temporaryPassword = 'Temp0rary1';
const providerId = '6740f1c2a4b5c6d7e8f90abc';
const providerObjectId = new Types.ObjectId(providerId);

function setup(role: Role = Role.User, status: UserStatus = UserStatus.Active) {
  const stored = {
    _id: accountObjectId,
    name: 'Sara Ahmed',
    email: 'sara@example.com',
    role,
    status,
    mustChangePassword: false,
    createdAt: new Date('2026-11-14T10:00:00.000Z'),
  };
  const usersService = {
    findEntityById: jest.fn().mockResolvedValue(stored),
    setTemporaryPassword: jest
      .fn()
      .mockResolvedValue({ ...stored, mustChangePassword: true }),
    listAccounts: jest.fn().mockResolvedValue({ items: [stored], total: 21 }),
    changeStatus: jest
      .fn()
      .mockImplementation((_id: unknown, _from: UserStatus, to: UserStatus) =>
        Promise.resolve({ ...stored, status: to }),
      ),
    createModerator: jest.fn().mockResolvedValue({
      ...stored,
      role: Role.HotelModerator,
      mustChangePassword: true,
      assignment: {
        providerType: ProviderType.Hotel,
        providerId: providerObjectId,
      },
    }),
  };
  const sessions = { revokeAllOfUser: jest.fn().mockResolvedValue(undefined) };
  // ACC-15: who is told about a suspension or a deactivated provider.
  const notifications = {
    notify: jest.fn().mockResolvedValue(undefined),
    notifyMany: jest.fn().mockResolvedValue(undefined),
  };
  // The providers of ACC-13: by default both exist.
  const airlines = {
    findEntityOrThrow: jest.fn().mockResolvedValue({ _id: providerObjectId }),
  };
  const hotels = {
    findEntityOrThrow: jest.fn().mockResolvedValue({ _id: providerObjectId }),
  };
  // The audit log (GEN-07): record never throws; list returns one page.
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  };
  // ACC-15: the travellers of a deactivated provider; by default nobody.
  const flightBookings = {
    findTravellerIdsOfAirline: jest.fn().mockResolvedValue([]),
  };
  const hotelBookings = {
    findTravellerIdsOfHotel: jest.fn().mockResolvedValue([]),
  };
  const service = new AdminService(
    usersService as unknown as UsersService,
    sessions as unknown as SessionsService,
    airlines as unknown as AirlinesService,
    hotels as unknown as HotelsService,
    notifications as unknown as NotificationsService,
    audit as unknown as AuditService,
    flightBookings as unknown as FlightBookingsService,
    hotelBookings as unknown as HotelBookingsService,
  );
  return {
    usersService,
    sessions,
    airlines,
    hotels,
    notifications,
    audit,
    flightBookings,
    hotelBookings,
    service,
  };
}

describe('AdminService', () => {
  describe('resetPassword (ACC-07a)', () => {
    it.each([Role.User, Role.AirlineModerator, Role.HotelModerator])(
      'sets the temporary password of a %s account',
      async (role) => {
        const { usersService, service } = setup(role);

        await service.resetPassword(accountId, { temporaryPassword }, adminId);

        expect(usersService.findEntityById).toHaveBeenCalledWith(accountId);
        expect(usersService.setTemporaryPassword).toHaveBeenCalledWith(
          accountObjectId,
          temporaryPassword,
        );
      },
    );

    it('returns the public account, without the password hash', async () => {
      const { service } = setup();

      const account = await service.resetPassword(
        accountId,
        { temporaryPassword },
        adminId,
      );

      expect(account).toMatchObject({
        id: accountId,
        email: 'sara@example.com',
      });
      expect(account).not.toHaveProperty('passwordHash');
    });

    it('answers 404 for an account that does not exist', async () => {
      const { usersService, service } = setup();
      usersService.findEntityById.mockResolvedValue(null);

      const attempt = service.resetPassword(
        accountId,
        { temporaryPassword },
        adminId,
      );

      await expect(attempt).rejects.toBeInstanceOf(NotFoundException);
      await expect(attempt).rejects.toThrow(ACCOUNT_NOT_FOUND_MESSAGE);
      expect(usersService.setTemporaryPassword).not.toHaveBeenCalled();
    });

    it('refuses to reset the password of an administrator', async () => {
      const { usersService, service } = setup(Role.Admin);

      const attempt = service.resetPassword(
        accountId,
        { temporaryPassword },
        adminId,
      );

      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      await expect(attempt).rejects.toThrow(
        ADMIN_PASSWORD_RESET_FORBIDDEN_MESSAGE,
      );
      expect(usersService.setTemporaryPassword).not.toHaveBeenCalled();
    });

    it('ends every session of the account, after the password is saved', async () => {
      const { usersService, sessions, service } = setup();

      await service.resetPassword(accountId, { temporaryPassword }, adminId);

      expect(sessions.revokeAllOfUser).toHaveBeenCalledTimes(1);
      expect(sessions.revokeAllOfUser).toHaveBeenCalledWith(
        accountId,
        expect.any(Date),
      );
      const saved =
        usersService.setTemporaryPassword.mock.invocationCallOrder[0];
      const ended = sessions.revokeAllOfUser.mock.invocationCallOrder[0];
      expect(saved).toBeLessThan(ended);
    });

    it.each([
      ['the account does not exist', 'missing'],
      ['the account is an administrator', 'admin'],
      ['the account is deleted before the password is saved', 'gone'],
    ])('ends no session when %s', async (_name, scenario) => {
      const { usersService, sessions, service } = setup(
        scenario === 'admin' ? Role.Admin : Role.User,
      );
      if (scenario === 'missing') {
        usersService.findEntityById.mockResolvedValue(null);
      }
      if (scenario === 'gone') {
        usersService.setTemporaryPassword.mockResolvedValue(null);
      }

      await service
        .resetPassword(accountId, { temporaryPassword }, adminId)
        .catch(() => undefined);

      expect(sessions.revokeAllOfUser).not.toHaveBeenCalled();
    });

    it('records the reset in the audit log, with the admin and the account, without the password', async () => {
      const { audit, sessions, usersService, service } = setup();

      await service.resetPassword(accountId, { temporaryPassword }, adminId);

      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith({
        adminId,
        action: AuditAction.ResetPassword,
        targetType: AuditTargetType.User,
        targetId: accountObjectId,
      });
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
        temporaryPassword,
      );
      // As soon as the password is saved, before the sessions end.
      expect(
        usersService.setTemporaryPassword.mock.invocationCallOrder[0],
      ).toBeLessThan(audit.record.mock.invocationCallOrder[0]);
      expect(audit.record.mock.invocationCallOrder[0]).toBeLessThan(
        sessions.revokeAllOfUser.mock.invocationCallOrder[0],
      );
    });

    it('still records the reset when ending the sessions fails afterwards', async () => {
      const { audit, sessions, service } = setup();
      const failure = new Error('database down');
      sessions.revokeAllOfUser.mockRejectedValue(failure);

      await expect(
        service.resetPassword(accountId, { temporaryPassword }, adminId),
      ).rejects.toBe(failure);
      // The password did change, so the log must say so.
      expect(audit.record).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['the account does not exist', 'missing'],
      ['the account is an administrator', 'admin'],
      ['the account is deleted before the password is saved', 'gone'],
    ])('records nothing when %s', async (_name, scenario) => {
      const { usersService, audit, service } = setup(
        scenario === 'admin' ? Role.Admin : Role.User,
      );
      if (scenario === 'missing') {
        usersService.findEntityById.mockResolvedValue(null);
      }
      if (scenario === 'gone') {
        usersService.setTemporaryPassword.mockResolvedValue(null);
      }

      await service
        .resetPassword(accountId, { temporaryPassword }, adminId)
        .catch(() => undefined);

      expect(audit.record).not.toHaveBeenCalled();
    });

    it('answers 404 when the account is deleted before the password is saved', async () => {
      const { usersService, service } = setup();
      usersService.setTemporaryPassword.mockResolvedValue(null);

      await expect(
        service.resetPassword(accountId, { temporaryPassword }, adminId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listAccounts (ACC-14)', () => {
    const queryOf = (fields: Partial<ListAccountsQueryDto>) =>
      Object.assign(new ListAccountsQueryDto(), fields);

    it('passes the search and the filters to the users service, with the page', async () => {
      const { usersService, service } = setup();
      const query = queryOf({
        page: 3,
        limit: 10,
        search: 'sara',
        role: Role.HotelModerator,
        status: UserStatus.Active,
      });

      await service.listAccounts(query);

      expect(usersService.listAccounts).toHaveBeenCalledWith(
        {
          search: 'sara',
          role: Role.HotelModerator,
          status: UserStatus.Active,
        },
        { skip: 20, limit: 10 },
      );
    });

    it('returns the public accounts with the page information', async () => {
      const { service } = setup();

      const result = await service.listAccounts(
        queryOf({ page: 3, limit: 10 }),
      );

      expect(result.meta).toEqual({
        page: 3,
        limit: 10,
        total: 21,
        totalPages: 3,
      });
      expect(result.items).toEqual([
        {
          id: accountId,
          name: 'Sara Ahmed',
          email: 'sara@example.com',
          role: 'user',
          status: 'active',
          mustChangePassword: false,
          createdAt: '2026-11-14T10:00:00.000Z',
        },
      ]);
    });

    it('returns an empty page when nothing matches', async () => {
      const { usersService, service } = setup();
      usersService.listAccounts.mockResolvedValue({ items: [], total: 0 });

      const result = await service.listAccounts(queryOf({}));

      expect(result).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });
  });

  describe('createModerator (ACC-13)', () => {
    const body = {
      name: 'Mona Hotel',
      email: 'mona@example.com',
      role: Role.HotelModerator as Role.HotelModerator,
      providerId,
      temporaryPassword,
    };

    it.each([
      [Role.HotelModerator, ProviderType.Hotel, 'hotels', 'airlines'],
      [Role.AirlineModerator, ProviderType.Airline, 'airlines', 'hotels'],
    ] as const)(
      'checks that the %s provider exists, then creates the account linked to it',
      async (role, providerType, checked, notChecked) => {
        const mocks = setup();

        await mocks.service.createModerator({ ...body, role }, adminId);

        expect(mocks[checked].findEntityOrThrow).toHaveBeenCalledWith(
          providerId,
        );
        expect(mocks[notChecked].findEntityOrThrow).not.toHaveBeenCalled();
        expect(mocks.usersService.createModerator).toHaveBeenCalledWith({
          name: 'Mona Hotel',
          email: 'mona@example.com',
          password: temporaryPassword,
          role,
          providerType,
          providerId: providerObjectId,
        });
      },
    );

    it('returns the public account with its assignment, never the password', async () => {
      const { service } = setup();

      const account = await service.createModerator(body, adminId);

      expect(account).toMatchObject({
        role: 'hotel_moderator',
        mustChangePassword: true,
        assignment: { providerType: 'hotel', providerId },
      });
      expect(JSON.stringify(account)).not.toContain(temporaryPassword);
    });

    it('records the creation in the audit log, with the admin, the new account and its provider', async () => {
      const { audit, service } = setup();

      await service.createModerator(body, adminId);

      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith({
        adminId,
        action: AuditAction.CreateModerator,
        targetType: AuditTargetType.User,
        targetId: accountObjectId,
        details: `hotel_moderator of hotel ${providerId}`,
      });
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
        temporaryPassword,
      );
    });

    it('records nothing when the moderator is not created', async () => {
      const { usersService, audit, service } = setup();
      usersService.createModerator.mockRejectedValue(new Error('conflict'));

      await service.createModerator(body, adminId).catch(() => undefined);

      expect(audit.record).not.toHaveBeenCalled();
    });

    it('refuses a provider that does not exist with 400 on providerId, and creates nothing', async () => {
      const { hotels, usersService, service } = setup();
      hotels.findEntityOrThrow.mockRejectedValue(
        new NotFoundException('Hotel not found'),
      );

      const attempt = service.createModerator(body, adminId);

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      const error = (await attempt.catch(
        (e: unknown) => e,
      )) as BadRequestException;
      expect(error.getResponse()).toEqual({
        message: 'Validation failed',
        errors: [
          { field: 'providerId', messages: [PROVIDER_NOT_FOUND_MESSAGE.hotel] },
        ],
      });
      expect(usersService.createModerator).not.toHaveBeenCalled();
    });

    it('passes on any other error of the provider lookup', async () => {
      const { airlines, service } = setup();
      const failure = new Error('database down');
      airlines.findEntityOrThrow.mockRejectedValue(failure);

      await expect(
        service.createModerator(
          { ...body, role: Role.AirlineModerator },
          adminId,
        ),
      ).rejects.toBe(failure);
    });

    it('passes on the 409 of an email that is already registered', async () => {
      const { usersService, service } = setup();
      const conflict = new Error('This email is already registered');
      usersService.createModerator.mockRejectedValue(conflict);

      await expect(service.createModerator(body, adminId)).rejects.toBe(
        conflict,
      );
    });
  });

  describe('listAuditLogs (GEN-07)', () => {
    const stored = {
      _id: new Types.ObjectId('6741c0ffee0123456789abcd'),
      adminId: new Types.ObjectId(adminId),
      action: AuditAction.ResetPassword,
      targetType: AuditTargetType.User,
      targetId: accountId,
      createdAt: new Date('2026-11-16T09:30:00.000Z'),
    };

    it('passes the filters and the page to the audit service', async () => {
      const { audit, service } = setup();
      const query = Object.assign(new ListAuditLogsQueryDto(), {
        page: 2,
        limit: 5,
        action: AuditAction.ResetPassword,
        adminId,
        targetType: AuditTargetType.User,
        targetId: accountId,
      });

      await service.listAuditLogs(query);

      expect(audit.list).toHaveBeenCalledWith(
        {
          action: AuditAction.ResetPassword,
          adminId,
          targetType: AuditTargetType.User,
          targetId: accountId,
        },
        { skip: 5, limit: 5 },
      );
    });

    it('returns the mapped records with the page information', async () => {
      const { audit, service } = setup();
      audit.list.mockResolvedValue({ items: [stored], total: 11 });

      const result = await service.listAuditLogs(new ListAuditLogsQueryDto());

      expect(result).toEqual({
        items: [
          {
            id: '6741c0ffee0123456789abcd',
            adminId,
            action: 'reset_password',
            targetType: 'user',
            targetId: accountId,
            details: null,
            createdAt: '2026-11-16T09:30:00.000Z',
          },
        ],
        meta: { page: 1, limit: 10, total: 11, totalPages: 2 },
      });
    });
  });

  describe('suspend and reactivate (ACC-16)', () => {
    it('suspends an active user and ends every session of the account', async () => {
      const { usersService, sessions, service } = setup();

      const account = await service.suspend(accountId, adminId);

      expect(usersService.changeStatus).toHaveBeenCalledWith(
        accountObjectId,
        UserStatus.Active,
        UserStatus.Suspended,
      );
      expect(sessions.revokeAllOfUser).toHaveBeenCalledWith(
        accountId,
        expect.any(Date),
      );
      const changed = usersService.changeStatus.mock.invocationCallOrder[0];
      const ended = sessions.revokeAllOfUser.mock.invocationCallOrder[0];
      expect(changed).toBeLessThan(ended);
      expect(account.status).toBe('suspended');
    });

    it('still suspends and notifies when ending the sessions fails, and logs it', async () => {
      const { sessions, notifications, service } = setup();
      sessions.revokeAllOfUser.mockRejectedValue(new Error('database down'));
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();

      const account = await service.suspend(accountId, adminId);

      expect(account.status).toBe('suspended');
      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledTimes(1);
      logError.mockRestore();
    });

    it('sends the user an account_suspended notification, after the status change', async () => {
      const { usersService, notifications, service } = setup();

      await service.suspend(accountId, adminId);

      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledWith(
        accountObjectId,
        NotificationType.AccountSuspended,
        ACCOUNT_SUSPENDED_NOTIFICATION,
      );
      const changed = usersService.changeStatus.mock.invocationCallOrder[0];
      const notified = notifications.notify.mock.invocationCallOrder[0];
      expect(changed).toBeLessThan(notified);
    });

    it('ends every session of the account before it reactivates it, so none comes back', async () => {
      const { usersService, sessions, notifications, service } = setup(
        Role.User,
        UserStatus.Suspended,
      );

      const account = await service.reactivate(accountId, adminId);

      expect(sessions.revokeAllOfUser).toHaveBeenCalledWith(
        accountId,
        expect.any(Date),
      );
      expect(usersService.changeStatus).toHaveBeenCalledWith(
        accountObjectId,
        UserStatus.Suspended,
        UserStatus.Active,
      );
      const ended = sessions.revokeAllOfUser.mock.invocationCallOrder[0];
      const changed = usersService.changeStatus.mock.invocationCallOrder[0];
      expect(ended).toBeLessThan(changed);
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(account.status).toBe('active');
    });

    it('leaves the account suspended when ending its sessions fails, so a retry works', async () => {
      const { usersService, sessions, service } = setup(
        Role.User,
        UserStatus.Suspended,
      );
      const failure = new Error('database down');
      sessions.revokeAllOfUser.mockRejectedValue(failure);

      await expect(service.reactivate(accountId, adminId)).rejects.toBe(
        failure,
      );
      expect(usersService.changeStatus).not.toHaveBeenCalled();
    });

    it.each([
      ['suspend', UserStatus.Suspended, ACCOUNT_ALREADY_SUSPENDED_MESSAGE],
      ['reactivate', UserStatus.Active, ACCOUNT_NOT_SUSPENDED_MESSAGE],
      ['suspend', UserStatus.Deactivated, ACCOUNT_DEACTIVATED_MESSAGE],
      ['reactivate', UserStatus.Deactivated, ACCOUNT_DEACTIVATED_MESSAGE],
    ] as const)(
      'answers 409 to %s on a %s account, and changes nothing',
      async (action, status, message) => {
        const { usersService, sessions, notifications, service } = setup(
          Role.User,
          status,
        );

        const attempt = service[action](accountId, adminId);

        await expect(attempt).rejects.toBeInstanceOf(ConflictException);
        await expect(attempt).rejects.toThrow(message);
        expect(usersService.changeStatus).not.toHaveBeenCalled();
        expect(sessions.revokeAllOfUser).not.toHaveBeenCalled();
        expect(notifications.notify).not.toHaveBeenCalled();
      },
    );

    it.each(['suspend', 'reactivate'] as const)(
      'refuses to %s an administrator with 403',
      async (action) => {
        const { usersService, service } = setup(Role.Admin);

        await expect(service[action](accountId, adminId)).rejects.toThrow(
          ADMIN_STATUS_FORBIDDEN_MESSAGE,
        );
        expect(usersService.changeStatus).not.toHaveBeenCalled();
      },
    );

    it('answers 404 for an account that does not exist', async () => {
      const { usersService, service } = setup();
      usersService.findEntityById.mockResolvedValue(null);

      await expect(service.suspend(accountId, adminId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('answers 409 when another request changed the status first', async () => {
      const { usersService, sessions, service } = setup();
      usersService.changeStatus.mockResolvedValue(null);

      await expect(service.suspend(accountId, adminId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(sessions.revokeAllOfUser).not.toHaveBeenCalled();
    });
  });

  describe('suspend and reactivate moderators (ACC-15)', () => {
    it.each([Role.AirlineModerator, Role.HotelModerator])(
      'suspends a %s, ends its sessions and tells it why',
      async (role) => {
        const { usersService, sessions, notifications, service } = setup(role);

        const account = await service.suspend(accountId, adminId);

        expect(usersService.changeStatus).toHaveBeenCalledWith(
          accountObjectId,
          UserStatus.Active,
          UserStatus.Suspended,
        );
        expect(sessions.revokeAllOfUser).toHaveBeenCalledWith(
          accountId,
          expect.any(Date),
        );
        expect(notifications.notify).toHaveBeenCalledWith(
          accountObjectId,
          NotificationType.AccountSuspended,
          ACCOUNT_SUSPENDED_NOTIFICATION,
        );
        const ended = sessions.revokeAllOfUser.mock.invocationCallOrder[0];
        const told = notifications.notify.mock.invocationCallOrder[0];
        expect(ended).toBeLessThan(told);
        expect(account).toMatchObject({ role, status: 'suspended' });
      },
    );

    it.each([Role.AirlineModerator, Role.HotelModerator])(
      'reactivates a suspended %s',
      async (role) => {
        const { usersService, sessions, notifications, service } = setup(
          role,
          UserStatus.Suspended,
        );

        const account = await service.reactivate(accountId, adminId);

        expect(usersService.changeStatus).toHaveBeenCalledWith(
          accountObjectId,
          UserStatus.Suspended,
          UserStatus.Active,
        );
        const ended = sessions.revokeAllOfUser.mock.invocationCallOrder[0];
        const changed = usersService.changeStatus.mock.invocationCallOrder[0];
        expect(ended).toBeLessThan(changed);
        expect(notifications.notify).not.toHaveBeenCalled();
        expect(account.status).toBe('active');
      },
    );

    it.each([
      ['suspend', UserStatus.Suspended, ACCOUNT_ALREADY_SUSPENDED_MESSAGE],
      ['reactivate', UserStatus.Active, ACCOUNT_NOT_SUSPENDED_MESSAGE],
      ['suspend', UserStatus.Deactivated, ACCOUNT_DEACTIVATED_MESSAGE],
    ] as const)(
      'answers 409 to %s on a %s moderator, and tells nobody',
      async (action, status, message) => {
        const { usersService, notifications, service } = setup(
          Role.HotelModerator,
          status,
        );

        await expect(service[action](accountId, adminId)).rejects.toThrow(
          message,
        );
        expect(usersService.changeStatus).not.toHaveBeenCalled();
        expect(notifications.notify).not.toHaveBeenCalled();
      },
    );

    it('tells nobody when another request suspended the moderator first', async () => {
      const { usersService, notifications, service } = setup(
        Role.AirlineModerator,
      );
      usersService.changeStatus.mockResolvedValue(null);

      await expect(service.suspend(accountId, adminId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('audit records of status changes (GEN-07)', () => {
    it.each([
      ['suspend', UserStatus.Active, 'suspend_user'],
      ['reactivate', UserStatus.Suspended, 'reactivate_user'],
    ] as const)(
      'records %s with the admin, the account and its role, after the change',
      async (action, status, recorded) => {
        const { usersService, audit, service } = setup(
          Role.HotelModerator,
          status,
        );

        await service[action](accountId, adminId);

        expect(audit.record).toHaveBeenCalledWith({
          adminId,
          action: recorded,
          targetType: 'user',
          targetId: accountObjectId,
          details: 'hotel_moderator',
        });
        expect(
          usersService.changeStatus.mock.invocationCallOrder[0],
        ).toBeLessThan(audit.record.mock.invocationCallOrder[0]);
      },
    );

    it('records nothing when the change is refused', async () => {
      const { audit, service } = setup(Role.User, UserStatus.Suspended);

      await expect(service.suspend(accountId, adminId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('deactivate and reactivate providers (ACC-15)', () => {
    const moderatorIds = [new Types.ObjectId(), new Types.ObjectId()];

    function setupProvider(type: ProviderType, active: boolean) {
      const context = setup();
      const stored = { _id: providerObjectId, name: 'Nile View', active };
      const owner =
        type === ProviderType.Airline ? context.airlines : context.hotels;
      owner.findEntityOrThrow.mockResolvedValue(stored);
      const setActive = jest.fn((_id: string, value: boolean) =>
        Promise.resolve<typeof stored | null>({ ...stored, active: value }),
      );
      Object.assign(owner, { setActive });
      const findModeratorIdsOfProvider = jest
        .fn()
        .mockResolvedValue(moderatorIds);
      Object.assign(context.usersService, { findModeratorIdsOfProvider });
      return { ...context, owner, setActive, findModeratorIdsOfProvider };
    }

    it.each([ProviderType.Airline, ProviderType.Hotel])(
      'deactivates an active %s through its own service',
      async (type) => {
        const { owner, setActive, service } = setupProvider(type, true);

        const provider = await service.deactivateProvider(
          type,
          providerId,
          adminId,
        );

        expect(owner.findEntityOrThrow).toHaveBeenCalledWith(providerId);
        expect(setActive).toHaveBeenCalledWith(providerId, false);
        expect(provider).toEqual({
          type,
          id: providerId,
          name: 'Nile View',
          active: false,
        });
      },
    );

    it('tells every moderator of the hotel, without a link, like an airline', async () => {
      const { findModeratorIdsOfProvider, notifications, service } =
        setupProvider(ProviderType.Hotel, true);

      await service.deactivateProvider(ProviderType.Hotel, providerId, adminId);

      expect(findModeratorIdsOfProvider).toHaveBeenCalledWith(
        ProviderType.Hotel,
        providerObjectId,
      );
      expect(notifications.notifyMany).toHaveBeenCalledWith(
        moderatorIds,
        NotificationType.ProviderDeactivated,
        providerDeactivatedNotification(ProviderType.Hotel, 'Nile View'),
      );
    });

    it('tells every moderator of the airline, without a link', async () => {
      const { notifications, service } = setupProvider(
        ProviderType.Airline,
        true,
      );

      await service.deactivateProvider(
        ProviderType.Airline,
        providerId,
        adminId,
      );

      expect(notifications.notifyMany).toHaveBeenCalledWith(
        moderatorIds,
        NotificationType.ProviderDeactivated,
        providerDeactivatedNotification(ProviderType.Airline, 'Nile View'),
      );
    });

    it('still answers when telling the moderators fails after the change, and logs it', async () => {
      const { findModeratorIdsOfProvider, notifications, service } =
        setupProvider(ProviderType.Hotel, true);
      findModeratorIdsOfProvider.mockRejectedValue(new Error('database down'));
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();

      const result = await service.deactivateProvider(
        ProviderType.Hotel,
        providerId,
        adminId,
      );

      expect(result).toMatchObject({ type: 'hotel', active: false });
      // No traveller by default, so no notice was sent at all.
      expect(notifications.notifyMany).not.toHaveBeenCalled();
      expect(logError).toHaveBeenCalledTimes(1);
      logError.mockRestore();
    });

    it('words the notice so it stays true after a later reactivation and promises no other notice', () => {
      const text = providerDeactivatedNotification(
        ProviderType.Hotel,
        'Nile View',
      );

      expect(text).toContain('was deactivated');
      expect(text).toContain('While it is deactivated');
      expect(text).not.toMatch(/until it is reactivated/i);
    });

    it('never changes the status of the moderator accounts', async () => {
      const { usersService, sessions, service } = setupProvider(
        ProviderType.Hotel,
        true,
      );

      await service.deactivateProvider(ProviderType.Hotel, providerId, adminId);

      expect(usersService.changeStatus).not.toHaveBeenCalled();
      expect(sessions.revokeAllOfUser).not.toHaveBeenCalled();
    });

    it.each([ProviderType.Airline, ProviderType.Hotel])(
      'reactivates a deactivated %s without a notification',
      async (type) => {
        const { setActive, notifications, service } = setupProvider(
          type,
          false,
        );

        const provider = await service.reactivateProvider(
          type,
          providerId,
          adminId,
        );

        expect(setActive).toHaveBeenCalledWith(providerId, true);
        expect(provider.active).toBe(true);
        expect(notifications.notifyMany).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['deactivateProvider', false, PROVIDER_ALREADY_DEACTIVATED_MESSAGE],
      ['reactivateProvider', true, PROVIDER_NOT_DEACTIVATED_MESSAGE],
    ] as const)(
      'answers 409 to %s when active is already %s',
      async (action, active, message) => {
        const { setActive, notifications, service } = setupProvider(
          ProviderType.Hotel,
          active,
        );

        const attempt = service[action](
          ProviderType.Hotel,
          providerId,
          adminId,
        );

        await expect(attempt).rejects.toBeInstanceOf(ConflictException);
        await expect(attempt).rejects.toThrow(message);
        expect(setActive).not.toHaveBeenCalled();
        expect(notifications.notifyMany).not.toHaveBeenCalled();
      },
    );

    it('answers 409 and tells nobody when another request changed it first', async () => {
      const { setActive, notifications, service } = setupProvider(
        ProviderType.Airline,
        true,
      );
      setActive.mockResolvedValue(null);

      const attempt = service.deactivateProvider(
        ProviderType.Airline,
        providerId,
        adminId,
      );

      await expect(attempt).rejects.toThrow(PROVIDER_STATUS_CHANGED_MESSAGE);
      expect(notifications.notifyMany).not.toHaveBeenCalled();
    });

    it.each([
      ['deactivateProvider', true, 'deactivate_provider', ProviderType.Hotel],
      [
        'reactivateProvider',
        false,
        'reactivate_provider',
        ProviderType.Airline,
      ],
    ] as const)(
      '%s records the admin, the provider kind, its id and its name (GEN-07)',
      async (action, active, recorded, type) => {
        const { audit, service } = setupProvider(type, active);

        await service[action](type, providerId, adminId);

        expect(audit.record).toHaveBeenCalledWith({
          adminId,
          action: recorded,
          targetType: type,
          targetId: providerObjectId,
          details: 'Nile View',
        });
      },
    );

    it('records nothing when the provider already has that state', async () => {
      const { audit, service } = setupProvider(ProviderType.Hotel, false);

      await expect(
        service.deactivateProvider(ProviderType.Hotel, providerId, adminId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(audit.record).not.toHaveBeenCalled();
    });

    describe('the travellers of a deactivated provider', () => {
      const travellerIds = [new Types.ObjectId(), new Types.ObjectId()];

      it('tells the moderators and the travellers of an airline, each with their own text and no link', async () => {
        const context = setupProvider(ProviderType.Airline, true);
        context.flightBookings.findTravellerIdsOfAirline.mockResolvedValue(
          travellerIds,
        );

        await context.service.deactivateProvider(
          ProviderType.Airline,
          providerId,
          adminId,
        );

        expect(
          context.flightBookings.findTravellerIdsOfAirline,
        ).toHaveBeenCalledWith(providerObjectId, expect.any(Date));
        expect(
          context.hotelBookings.findTravellerIdsOfHotel,
        ).not.toHaveBeenCalled();
        expect(context.notifications.notifyMany.mock.calls).toEqual([
          [
            moderatorIds,
            NotificationType.ProviderDeactivated,
            providerDeactivatedNotification(ProviderType.Airline, 'Nile View'),
          ],
          [
            travellerIds,
            NotificationType.ProviderDeactivated,
            providerDeactivatedTravellerNotification(
              ProviderType.Airline,
              'Nile View',
            ),
          ],
        ]);
      });

      it('tells the moderators and the travellers of a hotel, each with their own text and no link', async () => {
        const context = setupProvider(ProviderType.Hotel, true);
        context.hotelBookings.findTravellerIdsOfHotel.mockResolvedValue(
          travellerIds,
        );

        await context.service.deactivateProvider(
          ProviderType.Hotel,
          providerId,
          adminId,
        );

        expect(
          context.hotelBookings.findTravellerIdsOfHotel,
        ).toHaveBeenCalledWith(providerObjectId, expect.any(Date));
        expect(
          context.flightBookings.findTravellerIdsOfAirline,
        ).not.toHaveBeenCalled();
        expect(context.notifications.notifyMany.mock.calls).toEqual([
          [
            moderatorIds,
            NotificationType.ProviderDeactivated,
            providerDeactivatedNotification(ProviderType.Hotel, 'Nile View'),
          ],
          [
            travellerIds,
            NotificationType.ProviderDeactivated,
            providerDeactivatedTravellerNotification(
              ProviderType.Hotel,
              'Nile View',
            ),
          ],
        ]);
      });

      it("sends only the moderators' notice when no traveller is affected", async () => {
        const { notifications, service } = setupProvider(
          ProviderType.Hotel,
          true,
        );

        await service.deactivateProvider(
          ProviderType.Hotel,
          providerId,
          adminId,
        );

        expect(notifications.notifyMany.mock.calls).toEqual([
          [
            moderatorIds,
            NotificationType.ProviderDeactivated,
            providerDeactivatedNotification(ProviderType.Hotel, 'Nile View'),
          ],
        ]);
      });

      it('still tells the moderators, answers, logs and records when the traveller lookup fails', async () => {
        const context = setupProvider(ProviderType.Airline, true);
        context.flightBookings.findTravellerIdsOfAirline.mockRejectedValue(
          new Error('database down'),
        );
        const logError = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation();

        const result = await context.service.deactivateProvider(
          ProviderType.Airline,
          providerId,
          adminId,
        );

        expect(result).toMatchObject({ type: 'airline', active: false });
        expect(context.notifications.notifyMany.mock.calls).toEqual([
          [
            moderatorIds,
            NotificationType.ProviderDeactivated,
            providerDeactivatedNotification(ProviderType.Airline, 'Nile View'),
          ],
        ]);
        expect(logError).toHaveBeenCalledTimes(1);
        expect(context.audit.record).toHaveBeenCalledTimes(1);
        logError.mockRestore();
      });

      it('still tells the travellers when the moderator lookup fails', async () => {
        const context = setupProvider(ProviderType.Hotel, true);
        context.findModeratorIdsOfProvider.mockRejectedValue(
          new Error('database down'),
        );
        context.hotelBookings.findTravellerIdsOfHotel.mockResolvedValue(
          travellerIds,
        );
        const logError = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation();

        const result = await context.service.deactivateProvider(
          ProviderType.Hotel,
          providerId,
          adminId,
        );

        expect(result).toMatchObject({ type: 'hotel', active: false });
        expect(context.notifications.notifyMany.mock.calls).toEqual([
          [
            travellerIds,
            NotificationType.ProviderDeactivated,
            providerDeactivatedTravellerNotification(
              ProviderType.Hotel,
              'Nile View',
            ),
          ],
        ]);
        expect(logError).toHaveBeenCalledTimes(1);
        expect(context.audit.record).toHaveBeenCalledTimes(1);
        logError.mockRestore();
      });

      it('logs the type and the provider id, never the user ids or the notice text', async () => {
        const context = setupProvider(ProviderType.Hotel, true);
        context.hotelBookings.findTravellerIdsOfHotel.mockResolvedValue(
          travellerIds,
        );
        context.notifications.notifyMany.mockRejectedValue(
          new Error('insert failed'),
        );
        const logError = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation();

        await context.service.deactivateProvider(
          ProviderType.Hotel,
          providerId,
          adminId,
        );

        const messages = logError.mock.calls.map((call) => String(call[0]));
        expect(messages).toHaveLength(2);
        for (const message of messages) {
          expect(message).toContain(`hotel ${providerId}`);
          expect(message).not.toContain('Nile View');
          for (const userId of [...moderatorIds, ...travellerIds]) {
            expect(message).not.toContain(userId.toString());
          }
        }
        logError.mockRestore();
      });

      it.each([
        ['deactivateProvider', false],
        ['reactivateProvider', true],
      ] as const)(
        'looks up nobody, tells nobody and records nothing when %s answers 409',
        async (action, active) => {
          const context = setupProvider(ProviderType.Hotel, active);

          await expect(
            context.service[action](ProviderType.Hotel, providerId, adminId),
          ).rejects.toBeInstanceOf(ConflictException);
          expect(context.findModeratorIdsOfProvider).not.toHaveBeenCalled();
          expect(
            context.hotelBookings.findTravellerIdsOfHotel,
          ).not.toHaveBeenCalled();
          expect(context.notifications.notifyMany).not.toHaveBeenCalled();
          expect(context.audit.record).not.toHaveBeenCalled();
        },
      );

      it('looks up nobody, tells nobody and records nothing when another request changed it first', async () => {
        const context = setupProvider(ProviderType.Airline, true);
        context.setActive.mockResolvedValue(null);

        await expect(
          context.service.deactivateProvider(
            ProviderType.Airline,
            providerId,
            adminId,
          ),
        ).rejects.toThrow(PROVIDER_STATUS_CHANGED_MESSAGE);
        expect(context.findModeratorIdsOfProvider).not.toHaveBeenCalled();
        expect(
          context.flightBookings.findTravellerIdsOfAirline,
        ).not.toHaveBeenCalled();
        expect(context.notifications.notifyMany).not.toHaveBeenCalled();
        expect(context.audit.record).not.toHaveBeenCalled();
      });

      it('looks up nobody, tells nobody and records nothing on a 404', async () => {
        const context = setupProvider(ProviderType.Airline, true);
        context.owner.findEntityOrThrow.mockRejectedValue(
          new NotFoundException('Airline not found'),
        );

        await expect(
          context.service.deactivateProvider(
            ProviderType.Airline,
            providerId,
            adminId,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(context.findModeratorIdsOfProvider).not.toHaveBeenCalled();
        expect(
          context.flightBookings.findTravellerIdsOfAirline,
        ).not.toHaveBeenCalled();
        expect(context.notifications.notifyMany).not.toHaveBeenCalled();
        expect(context.audit.record).not.toHaveBeenCalled();
      });

      it.each([ProviderType.Airline, ProviderType.Hotel])(
        'reactivating a %s looks up and tells nobody',
        async (type) => {
          const context = setupProvider(type, false);

          await context.service.reactivateProvider(type, providerId, adminId);

          expect(context.findModeratorIdsOfProvider).not.toHaveBeenCalled();
          expect(
            context.flightBookings.findTravellerIdsOfAirline,
          ).not.toHaveBeenCalled();
          expect(
            context.hotelBookings.findTravellerIdsOfHotel,
          ).not.toHaveBeenCalled();
          expect(context.notifications.notifyMany).not.toHaveBeenCalled();
        },
      );

      it.each([ProviderType.Airline, ProviderType.Hotel])(
        "words the %s travellers' notice: booking valid, nothing cancelled or refunded, no later notice",
        (type) => {
          const text = providerDeactivatedTravellerNotification(
            type,
            'Nile View',
          );

          expect(text).toBe(
            `The ${type} "Nile View" was deactivated by an administrator. Your confirmed booking with it remains valid and nothing is cancelled or refunded.`,
          );
          expect(text).not.toMatch(
            /until it is reactivated|will be told|we will/i,
          );
        },
      );

      it("keeps the longest travellers' notice within the notification limit", () => {
        const longest = providerDeactivatedTravellerNotification(
          ProviderType.Airline,
          'x'.repeat(HOTEL_NAME_MAX_LENGTH),
        );

        expect(longest.length).toBeLessThanOrEqual(
          NOTIFICATION_MESSAGE_MAX_LENGTH,
        );
      });
    });

    it('passes on the 404 of a provider that does not exist', async () => {
      const { owner, setActive, service } = setupProvider(
        ProviderType.Hotel,
        true,
      );
      owner.findEntityOrThrow.mockRejectedValue(
        new NotFoundException('Hotel not found'),
      );

      await expect(
        service.deactivateProvider(ProviderType.Hotel, providerId, adminId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(setActive).not.toHaveBeenCalled();
    });
  });
});
