import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import type { SessionsService } from '../auth/sessions.service';
import type { UsersService } from '../users/users.service';
import {
  ACCOUNT_NOT_FOUND_MESSAGE,
  ADMIN_PASSWORD_RESET_FORBIDDEN_MESSAGE,
} from './admin.constants';
import { AdminService } from './admin.service';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';
import type { AirlinesService } from '../flights/airlines.service';
import type { HotelsService } from '../hotels/hotels.service';
import { ProviderType } from '../common/enums/provider-type.enum';
import { PROVIDER_NOT_FOUND_MESSAGE } from './admin.constants';
import {
  ACCOUNT_ALREADY_SUSPENDED_MESSAGE,
  ACCOUNT_DEACTIVATED_MESSAGE,
  ACCOUNT_NOT_SUSPENDED_MESSAGE,
  ADMIN_STATUS_FORBIDDEN_MESSAGE,
  ONLY_USER_STATUS_MESSAGE,
} from './admin.constants';

const accountId = '6740f1c2a4b5c6d7e8f90123';
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
  // The providers of ACC-13: by default both exist.
  const airlines = {
    findEntityOrThrow: jest.fn().mockResolvedValue({ _id: providerObjectId }),
  };
  const hotels = {
    findEntityOrThrow: jest.fn().mockResolvedValue({ _id: providerObjectId }),
  };
  const service = new AdminService(
    usersService as unknown as UsersService,
    sessions as unknown as SessionsService,
    airlines as unknown as AirlinesService,
    hotels as unknown as HotelsService,
  );
  return { usersService, sessions, airlines, hotels, service };
}

describe('AdminService', () => {
  describe('resetPassword (ACC-07a)', () => {
    it.each([Role.User, Role.AirlineModerator, Role.HotelModerator])(
      'sets the temporary password of a %s account',
      async (role) => {
        const { usersService, service } = setup(role);

        await service.resetPassword(accountId, { temporaryPassword });

        expect(usersService.findEntityById).toHaveBeenCalledWith(accountId);
        expect(usersService.setTemporaryPassword).toHaveBeenCalledWith(
          accountObjectId,
          temporaryPassword,
        );
      },
    );

    it('returns the public account, without the password hash', async () => {
      const { service } = setup();

      const account = await service.resetPassword(accountId, {
        temporaryPassword,
      });

      expect(account).toMatchObject({
        id: accountId,
        email: 'sara@example.com',
      });
      expect(account).not.toHaveProperty('passwordHash');
    });

    it('answers 404 for an account that does not exist', async () => {
      const { usersService, service } = setup();
      usersService.findEntityById.mockResolvedValue(null);

      const attempt = service.resetPassword(accountId, { temporaryPassword });

      await expect(attempt).rejects.toBeInstanceOf(NotFoundException);
      await expect(attempt).rejects.toThrow(ACCOUNT_NOT_FOUND_MESSAGE);
      expect(usersService.setTemporaryPassword).not.toHaveBeenCalled();
    });

    it('refuses to reset the password of an administrator', async () => {
      const { usersService, service } = setup(Role.Admin);

      const attempt = service.resetPassword(accountId, { temporaryPassword });

      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      await expect(attempt).rejects.toThrow(
        ADMIN_PASSWORD_RESET_FORBIDDEN_MESSAGE,
      );
      expect(usersService.setTemporaryPassword).not.toHaveBeenCalled();
    });

    it('ends every session of the account, after the password is saved', async () => {
      const { usersService, sessions, service } = setup();

      await service.resetPassword(accountId, { temporaryPassword });

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
        .resetPassword(accountId, { temporaryPassword })
        .catch(() => undefined);

      expect(sessions.revokeAllOfUser).not.toHaveBeenCalled();
    });

    it('answers 404 when the account is deleted before the password is saved', async () => {
      const { usersService, service } = setup();
      usersService.setTemporaryPassword.mockResolvedValue(null);

      await expect(
        service.resetPassword(accountId, { temporaryPassword }),
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

        await mocks.service.createModerator({ ...body, role });

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

      const account = await service.createModerator(body);

      expect(account).toMatchObject({
        role: 'hotel_moderator',
        mustChangePassword: true,
        assignment: { providerType: 'hotel', providerId },
      });
      expect(JSON.stringify(account)).not.toContain(temporaryPassword);
    });

    it('refuses a provider that does not exist with 400 on providerId, and creates nothing', async () => {
      const { hotels, usersService, service } = setup();
      hotels.findEntityOrThrow.mockRejectedValue(
        new NotFoundException('Hotel not found'),
      );

      const attempt = service.createModerator(body);

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
        service.createModerator({ ...body, role: Role.AirlineModerator }),
      ).rejects.toBe(failure);
    });

    it('passes on the 409 of an email that is already registered', async () => {
      const { usersService, service } = setup();
      const conflict = new Error('This email is already registered');
      usersService.createModerator.mockRejectedValue(conflict);

      await expect(service.createModerator(body)).rejects.toBe(conflict);
    });
  });

  describe('suspend and reactivate (ACC-16)', () => {
    it('suspends an active user and ends every session of the account', async () => {
      const { usersService, sessions, service } = setup();

      const account = await service.suspend(accountId);

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

    it('reactivates a suspended user without touching sessions', async () => {
      const { usersService, sessions, service } = setup(
        Role.User,
        UserStatus.Suspended,
      );

      const account = await service.reactivate(accountId);

      expect(usersService.changeStatus).toHaveBeenCalledWith(
        accountObjectId,
        UserStatus.Suspended,
        UserStatus.Active,
      );
      expect(sessions.revokeAllOfUser).not.toHaveBeenCalled();
      expect(account.status).toBe('active');
    });

    it.each([
      ['suspend', UserStatus.Suspended, ACCOUNT_ALREADY_SUSPENDED_MESSAGE],
      ['reactivate', UserStatus.Active, ACCOUNT_NOT_SUSPENDED_MESSAGE],
      ['suspend', UserStatus.Deactivated, ACCOUNT_DEACTIVATED_MESSAGE],
      ['reactivate', UserStatus.Deactivated, ACCOUNT_DEACTIVATED_MESSAGE],
    ] as const)(
      'answers 409 to %s on a %s account, and changes nothing',
      async (action, status, message) => {
        const { usersService, sessions, service } = setup(Role.User, status);

        const attempt = service[action](accountId);

        await expect(attempt).rejects.toBeInstanceOf(ConflictException);
        await expect(attempt).rejects.toThrow(message);
        expect(usersService.changeStatus).not.toHaveBeenCalled();
        expect(sessions.revokeAllOfUser).not.toHaveBeenCalled();
      },
    );

    it.each(['suspend', 'reactivate'] as const)(
      'refuses to %s an administrator with 403',
      async (action) => {
        const { usersService, service } = setup(Role.Admin);

        await expect(service[action](accountId)).rejects.toThrow(
          ADMIN_STATUS_FORBIDDEN_MESSAGE,
        );
        expect(usersService.changeStatus).not.toHaveBeenCalled();
      },
    );

    it.each([Role.AirlineModerator, Role.HotelModerator])(
      'refuses a %s with 400: moderators are handled by ACC-15',
      async (role) => {
        const { usersService, service } = setup(role);

        const attempt = service.suspend(accountId);

        await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
        await expect(attempt).rejects.toThrow(ONLY_USER_STATUS_MESSAGE);
        expect(usersService.changeStatus).not.toHaveBeenCalled();
      },
    );

    it('answers 404 for an account that does not exist', async () => {
      const { usersService, service } = setup();
      usersService.findEntityById.mockResolvedValue(null);

      await expect(service.suspend(accountId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('answers 409 when another request changed the status first', async () => {
      const { usersService, sessions, service } = setup();
      usersService.changeStatus.mockResolvedValue(null);

      await expect(service.suspend(accountId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(sessions.revokeAllOfUser).not.toHaveBeenCalled();
    });
  });
});
