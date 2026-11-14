import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import type { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import type { RegisterDto } from './dto/register.dto';

const dto: RegisterDto = {
  name: 'Sara Ahmed',
  email: 'sara@example.com',
  password: 'Passw0rdOK',
  acceptedTerms: true,
};

const created: UserResponseDto = {
  id: '6740f1c2a4b5c6d7e8f90123',
  name: 'Sara Ahmed',
  email: 'sara@example.com',
  role: Role.User,
  status: UserStatus.Active,
  createdAt: '2026-11-14T10:00:00.000Z',
};

describe('AuthController', () => {
  describe('register (ACC-01)', () => {
    it('hands the body to the service and returns its answer', async () => {
      const authService = { register: jest.fn().mockResolvedValue(created) };
      const controller = new AuthController(
        authService as unknown as AuthService,
      );

      expect(await controller.register(dto)).toBe(created);
      expect(authService.register).toHaveBeenCalledWith(dto);
    });

    it('is open to guests', () => {
      // The authentication guard (ACC-04) lets a route through only if it is public.
      expect(
        new Reflector().get<boolean>(
          IS_PUBLIC_KEY,
          AuthController.prototype.register,
        ),
      ).toBe(true);
    });
  });
});
