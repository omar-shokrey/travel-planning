import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { UserResponseDto } from '../users/dto/user-response.dto';
import { AdminController } from './admin.controller';
import type { AdminService } from './admin.service';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';

describe('AdminController', () => {
  const account = { id: '6740f1c2a4b5c6d7e8f90123' } as UserResponseDto;
  const page = {
    items: [account],
    meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
  };

  function setup() {
    const adminService = {
      resetPassword: jest.fn().mockResolvedValue(account),
      listAccounts: jest.fn().mockResolvedValue(page),
      createModerator: jest.fn().mockResolvedValue(account),
    };
    const controller = new AdminController(
      adminService as unknown as AdminService,
    );
    return { adminService, controller };
  }

  it('is open to administrators only', () => {
    expect(
      new Reflector().get<Role[] | undefined>(ROLES_KEY, AdminController),
    ).toEqual([Role.Admin]);
  });

  describe('resetPassword (ACC-07a)', () => {
    it('gives the service the account id and the body, and returns its answer', async () => {
      const { adminService, controller } = setup();
      const body = { temporaryPassword: 'Temp0rary1' };

      expect(await controller.resetPassword(account.id, body)).toBe(account);
      expect(adminService.resetPassword).toHaveBeenCalledWith(account.id, body);
    });
  });

  describe('listAccounts (ACC-14)', () => {
    it('gives the service the query and returns its page', async () => {
      const { adminService, controller } = setup();
      const query = new ListAccountsQueryDto();

      expect(await controller.listAccounts(query)).toBe(page);
      expect(adminService.listAccounts).toHaveBeenCalledWith(query);
    });
  });

  describe('createModerator (ACC-13)', () => {
    it('gives the service the body and returns the new account', async () => {
      const { adminService, controller } = setup();
      const body = {
        name: 'Mona Hotel',
        email: 'mona@example.com',
        role: Role.HotelModerator as Role.HotelModerator,
        providerId: '6740f1c2a4b5c6d7e8f90abc',
        temporaryPassword: 'Temp0rary1',
      };

      expect(await controller.createModerator(body)).toBe(account);
      expect(adminService.createModerator).toHaveBeenCalledWith(body);
    });
  });
});
