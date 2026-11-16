import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import type { UserResponseDto } from './dto/user-response.dto';
import type { ProfileService } from './profile.service';
import { UsersController } from './users.controller';

describe('UsersController', () => {
  const account = { id: '6740f1c2a4b5c6d7e8f90123' } as UserResponseDto;

  function setup() {
    const profileService = {
      updateMyProfile: jest.fn().mockResolvedValue(account),
    };
    const controller = new UsersController(
      profileService as unknown as ProfileService,
    );
    return { profileService, controller };
  }

  describe('updateMyProfile (ACC-09)', () => {
    it('gives the service the id of the logged-in user and the body, and returns its answer', async () => {
      const { profileService, controller } = setup();
      const body = { name: 'Sara' };

      expect(await controller.updateMyProfile(account.id, body)).toBe(account);
      expect(profileService.updateMyProfile).toHaveBeenCalledWith(
        account.id,
        body,
      );
    });

    it('needs a login, and is open to every role', () => {
      const reflector = new Reflector();
      const handler = UsersController.prototype.updateMyProfile;

      expect(reflector.get(IS_PUBLIC_KEY, handler)).toBeUndefined();
      expect(reflector.get(ROLES_KEY, handler)).toBeUndefined();
      expect(reflector.get(ROLES_KEY, UsersController)).toBeUndefined();
    });
  });
});
