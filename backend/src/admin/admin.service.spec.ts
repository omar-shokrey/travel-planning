import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import type { UsersService } from '../users/users.service';
import {
  ACCOUNT_NOT_FOUND_MESSAGE,
  ADMIN_PASSWORD_RESET_FORBIDDEN_MESSAGE,
} from './admin.constants';
import { AdminService } from './admin.service';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';

const accountId = '6740f1c2a4b5c6d7e8f90123';
const accountObjectId = new Types.ObjectId(accountId);
const temporaryPassword = 'Temp0rary1';

function setup(role: Role = Role.User) {
  const stored = {
    _id: accountObjectId,
    name: 'Sara Ahmed',
    email: 'sara@example.com',
    role,
    status: UserStatus.Active,
    mustChangePassword: false,
    createdAt: new Date('2026-11-14T10:00:00.000Z'),
  };
  const usersService = {
    findEntityById: jest.fn().mockResolvedValue(stored),
    setTemporaryPassword: jest
      .fn()
      .mockResolvedValue({ ...stored, mustChangePassword: true }),
    listAccounts: jest.fn().mockResolvedValue({ items: [stored], total: 21 }),
  };
  const service = new AdminService(usersService as unknown as UsersService);
  return { usersService, service };
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
});
