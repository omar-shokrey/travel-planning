import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { UserResponseDto } from '../users/dto/user-response.dto';
import { AdminController } from './admin.controller';
import type { AdminService } from './admin.service';

describe('AdminController', () => {
  const account = { id: '6740f1c2a4b5c6d7e8f90123' } as UserResponseDto;

  function setup() {
    const adminService = {
      resetPassword: jest.fn().mockResolvedValue(account),
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
});
