import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { ProviderType } from '../common/enums/provider-type.enum';
import { Role } from '../common/enums/role.enum';
import type { UserResponseDto } from '../users/dto/user-response.dto';
import { PROVIDER_TYPE_MESSAGE } from './admin.constants';
import { AdminController, PROVIDER_TYPE_PIPE } from './admin.controller';
import type { AdminService } from './admin.service';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

describe('AdminController', () => {
  const adminId = '6740f1c2a4b5c6d7e8f90001';
  const account = { id: '6740f1c2a4b5c6d7e8f90123' } as UserResponseDto;
  const page = {
    items: [account],
    meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
  };

  function setup() {
    const adminService = {
      listAuditLogs: jest.fn().mockResolvedValue(page),
      resetPassword: jest.fn().mockResolvedValue(account),
      listAccounts: jest.fn().mockResolvedValue(page),
      createModerator: jest.fn().mockResolvedValue(account),
      suspend: jest.fn().mockResolvedValue(account),
      reactivate: jest.fn().mockResolvedValue(account),
      deactivateProvider: jest.fn(),
      reactivateProvider: jest.fn(),
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
    it('gives the service the account id, the body and the admin id, and returns its answer', async () => {
      const { adminService, controller } = setup();
      const body = { temporaryPassword: 'Temp0rary1' };

      expect(await controller.resetPassword(account.id, body, adminId)).toBe(
        account,
      );
      expect(adminService.resetPassword).toHaveBeenCalledWith(
        account.id,
        body,
        adminId,
      );
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

  describe('listAuditLogs (GEN-07)', () => {
    it('gives the service the query and returns its page', async () => {
      const { adminService, controller } = setup();
      const query = new ListAuditLogsQueryDto();

      expect(await controller.listAuditLogs(query)).toBe(page);
      expect(adminService.listAuditLogs).toHaveBeenCalledWith(query);
    });
  });

  describe('createModerator (ACC-13)', () => {
    it('gives the service the body and the admin id, and returns the new account', async () => {
      const { adminService, controller } = setup();
      const body = {
        name: 'Mona Hotel',
        email: 'mona@example.com',
        role: Role.HotelModerator as Role.HotelModerator,
        providerId: '6740f1c2a4b5c6d7e8f90abc',
        temporaryPassword: 'Temp0rary1',
      };

      expect(await controller.createModerator(body, adminId)).toBe(account);
      expect(adminService.createModerator).toHaveBeenCalledWith(body, adminId);
    });
  });

  describe('suspend and reactivate (ACC-16)', () => {
    it.each(['suspend', 'reactivate'] as const)(
      'gives the service the account id to %s and returns its answer',
      async (action) => {
        const { adminService, controller } = setup();

        expect(await controller[action](account.id)).toBe(account);
        expect(adminService[action]).toHaveBeenCalledWith(account.id);
      },
    );
  });

  describe('deactivate and reactivate providers (ACC-15)', () => {
    const provider = {
      type: ProviderType.Hotel,
      id: '6740f1c2a4b5c6d7e8f90abc',
      name: 'Nile View',
      active: false,
    };

    it.each(['deactivateProvider', 'reactivateProvider'] as const)(
      '%s gives the service the type and the id, and returns its answer',
      async (action) => {
        const { adminService, controller } = setup();
        adminService[action].mockResolvedValue(provider);

        expect(await controller[action](ProviderType.Hotel, provider.id)).toBe(
          provider,
        );
        expect(adminService[action]).toHaveBeenCalledWith(
          ProviderType.Hotel,
          provider.id,
        );
      },
    );

    it.each(['hotel', 'airline'])('accepts the type %s', async (type) => {
      expect(await PROVIDER_TYPE_PIPE.transform(type, { type: 'param' })).toBe(
        type,
      );
    });

    it.each(['ship', 'Hotel', ''])(
      'refuses the type "%s" with 400',
      async (type) => {
        const attempt = PROVIDER_TYPE_PIPE.transform(type, { type: 'param' });

        await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
        await expect(attempt).rejects.toThrow(PROVIDER_TYPE_MESSAGE);
      },
    );
  });
});
