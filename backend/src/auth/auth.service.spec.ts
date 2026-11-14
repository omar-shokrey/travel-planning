import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import {
  EMAIL_TAKEN_MESSAGE,
  type CreateUserInput,
  type UsersService,
} from '../users/users.service';
import { AuthService } from './auth.service';
import type { RegisterDto } from './dto/register.dto';

const dto: RegisterDto = {
  name: 'Sara Ahmed',
  email: 'sara@example.com',
  password: 'Passw0rdOK',
  acceptedTerms: true,
};

function setup() {
  // A stored user, with the private fields a real document carries.
  const stored = {
    _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
    name: 'Sara Ahmed',
    email: 'sara@example.com',
    passwordHash: 'a-bcrypt-hash',
    role: Role.User,
    status: UserStatus.Active,
    failedLoginAttempts: 0,
    createdAt: new Date('2026-11-14T10:00:00.000Z'),
  };
  const usersService = {
    createRegisteredUser: jest.fn().mockResolvedValue(stored),
  };
  const service = new AuthService(usersService as unknown as UsersService);

  return { usersService, service };
}

describe('AuthService', () => {
  describe('register (ACC-01)', () => {
    it('creates the user from the name, the email and the password only', async () => {
      const { usersService, service } = setup();

      await service.register(dto);

      expect(usersService.createRegisteredUser).toHaveBeenCalledTimes(1);
      expect(usersService.createRegisteredUser).toHaveBeenCalledWith({
        name: 'Sara Ahmed',
        email: 'sara@example.com',
        password: 'Passw0rdOK',
        consentAcceptedAt: expect.any(Date),
      });
    });

    it('records the time of the request as the consent time', async () => {
      const { usersService, service } = setup();

      const before = Date.now();
      await service.register(dto);
      const after = Date.now();

      const [input] = usersService.createRegisteredUser.mock.calls[0] as [
        CreateUserInput,
      ];
      expect(input.consentAcceptedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(input.consentAcceptedAt.getTime()).toBeLessThanOrEqual(after);
    });

    it('returns the public user, without the password hash', async () => {
      const { service } = setup();

      expect(await service.register(dto)).toEqual({
        id: '6740f1c2a4b5c6d7e8f90123',
        name: 'Sara Ahmed',
        email: 'sara@example.com',
        role: 'user',
        status: 'active',
        createdAt: '2026-11-14T10:00:00.000Z',
      });
    });

    it('passes on the error when the email is already registered', async () => {
      const { usersService, service } = setup();
      const emailTaken = new ConflictException(EMAIL_TAKEN_MESSAGE);
      usersService.createRegisteredUser.mockRejectedValueOnce(emailTaken);

      await expect(service.register(dto)).rejects.toBe(emailTaken);
    });
  });
});
