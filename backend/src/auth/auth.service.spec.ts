import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { hash } from 'bcrypt';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import {
  EMAIL_TAKEN_MESSAGE,
  type CreateUserInput,
  type UsersService,
} from '../users/users.service';
import type { AuthTokensService } from './auth-tokens.service';
import { AuthService } from './auth.service';
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  LOGIN_REQUIRED_MESSAGE,
} from './auth.constants';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

const dto: RegisterDto = {
  name: 'Sara Ahmed',
  email: 'sara@example.com',
  password: 'Passw0rdOK',
  acceptedTerms: true,
};

const loginDto: LoginDto = {
  email: 'sara@example.com',
  password: 'Passw0rdOK',
};

const issuedTokens = {
  accessToken: 'an-access-token',
  refreshToken: 'a-refresh-token',
};

/** A real bcrypt hash of the password above. Few rounds, so the tests stay fast. */
let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hash(loginDto.password, 4);
});

function setup(changes: { status?: UserStatus } = {}) {
  // A stored user, with the private fields a real document carries.
  const stored = {
    _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
    name: 'Sara Ahmed',
    email: 'sara@example.com',
    passwordHash,
    role: Role.User,
    status: changes.status ?? UserStatus.Active,
    failedLoginAttempts: 0,
    createdAt: new Date('2026-11-14T10:00:00.000Z'),
  };
  const usersService = {
    createRegisteredUser: jest.fn().mockResolvedValue(stored),
    findEntityByEmailWithPasswordHash: jest.fn().mockResolvedValue(stored),
    findEntityById: jest.fn().mockResolvedValue(stored),
  };
  const tokens = { issueTokens: jest.fn().mockResolvedValue(issuedTokens) };
  const service = new AuthService(
    usersService as unknown as UsersService,
    tokens as unknown as AuthTokensService,
  );

  return { usersService, tokens, service };
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

  describe('login (ACC-04)', () => {
    it('looks the account up by the email that was sent', async () => {
      const { usersService, service } = setup();

      await service.login(loginDto);

      expect(
        usersService.findEntityByEmailWithPasswordHash,
      ).toHaveBeenCalledWith('sara@example.com');
    });

    it('returns the public user and the tokens issued for that user', async () => {
      const { tokens, service } = setup();

      const result = await service.login(loginDto);

      expect(tokens.issueTokens).toHaveBeenCalledWith(
        '6740f1c2a4b5c6d7e8f90123',
      );
      expect(result.tokens).toBe(issuedTokens);
      expect(result.user).toEqual({
        id: '6740f1c2a4b5c6d7e8f90123',
        name: 'Sara Ahmed',
        email: 'sara@example.com',
        role: 'user',
        status: 'active',
        createdAt: '2026-11-14T10:00:00.000Z',
      });
    });

    it('never puts the password hash in the user it returns', async () => {
      const { service } = setup();

      const { user } = await service.login(loginDto);

      expect(JSON.stringify(user)).not.toContain(passwordHash);
      expect(user).not.toHaveProperty('passwordHash');
    });

    it('rejects a wrong password with the generic message and issues nothing', async () => {
      const { tokens, service } = setup();

      const attempt = service.login({ ...loginDto, password: 'Wr0ngPassword' });

      await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(attempt).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
      expect(tokens.issueTokens).not.toHaveBeenCalled();
    });

    it('gives an unknown email the same answer as a wrong password', async () => {
      const { usersService, tokens, service } = setup();
      usersService.findEntityByEmailWithPasswordHash.mockResolvedValue(null);

      const attempt = service.login(loginDto);

      await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(attempt).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
      expect(tokens.issueTokens).not.toHaveBeenCalled();
    });

    it('still does the work of a password check for an unknown email', async () => {
      const { usersService, service } = setup();
      usersService.findEntityByEmailWithPasswordHash.mockResolvedValue(null);

      const started = Date.now();
      await service.login(loginDto).catch(() => undefined);

      // A check against a real user above costs about a millisecond here (4
      // rounds). The platform's rounds make the check take far longer than
      // this, so an answer that came at once would show that it was skipped.
      expect(Date.now() - started).toBeGreaterThanOrEqual(20);
    });

    it('treats a deactivated account like an unknown one (ACC-12)', async () => {
      const { tokens, service } = setup({ status: UserStatus.Deactivated });

      const attempt = service.login(loginDto);

      await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(attempt).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
      expect(tokens.issueTokens).not.toHaveBeenCalled();
    });

    it('tells a suspended account that it is suspended and issues nothing', async () => {
      const { tokens, service } = setup({ status: UserStatus.Suspended });

      const attempt = service.login(loginDto);

      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      await expect(attempt).rejects.toThrow(ACCOUNT_SUSPENDED_MESSAGE);
      expect(tokens.issueTokens).not.toHaveBeenCalled();
    });

    it('does not tell the suspension to someone who has the wrong password', async () => {
      const { service } = setup({ status: UserStatus.Suspended });

      const attempt = service.login({ ...loginDto, password: 'Wr0ngPassword' });

      await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(attempt).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
    });
  });

  describe('me (ACC-04)', () => {
    it('returns the public user of the id from the token', async () => {
      const { usersService, service } = setup();

      const user = await service.me('6740f1c2a4b5c6d7e8f90123');

      expect(usersService.findEntityById).toHaveBeenCalledWith(
        '6740f1c2a4b5c6d7e8f90123',
      );
      expect(user).toMatchObject({
        id: '6740f1c2a4b5c6d7e8f90123',
        email: 'sara@example.com',
        role: 'user',
      });
      expect(user).not.toHaveProperty('passwordHash');
    });

    it('answers 401 when the account is gone', async () => {
      const { usersService, service } = setup();
      usersService.findEntityById.mockResolvedValue(null);

      const attempt = service.me('6740f1c2a4b5c6d7e8f90123');

      await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(attempt).rejects.toThrow(LOGIN_REQUIRED_MESSAGE);
    });
  });
});
