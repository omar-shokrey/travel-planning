import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
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
  CURRENT_PASSWORD_INCORRECT_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  SAME_PASSWORD_MESSAGE,
  LOCKOUT_MINUTES,
  LOGIN_REQUIRED_MESSAGE,
  MAX_FAILED_LOGIN_ATTEMPTS,
  accountLockedMessage,
} from './auth.constants';
import type { ChangePasswordDto } from './dto/change-password.dto';
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

const MINUTE = 60_000;

/** The id of the stored user below, as the object the users service is given. */
const userObjectId = new Types.ObjectId('6740f1c2a4b5c6d7e8f90123');

const wrongLogin: LoginDto = { ...loginDto, password: 'Wr0ngPassword' };

const issuedTokens = {
  accessToken: 'an-access-token',
  refreshToken: 'a-refresh-token',
};

/** A real bcrypt hash of the password above. Few rounds, so the tests stay fast. */
let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hash(loginDto.password, 4);
});

function setup(
  changes: {
    status?: UserStatus;
    lockedUntil?: Date;
    mustChangePassword?: boolean;
  } = {},
) {
  // A stored user, with the private fields a real document carries.
  const stored = {
    _id: userObjectId,
    name: 'Sara Ahmed',
    email: 'sara@example.com',
    passwordHash,
    role: Role.User,
    status: changes.status ?? UserStatus.Active,
    failedLoginAttempts: 0,
    lockedUntil: changes.lockedUntil,
    mustChangePassword: changes.mustChangePassword ?? false,
    createdAt: new Date('2026-11-14T10:00:00.000Z'),
  };
  const usersService = {
    createRegisteredUser: jest.fn().mockResolvedValue(stored),
    findEntityByEmailWithPasswordHash: jest.fn().mockResolvedValue(stored),
    findEntityById: jest.fn().mockResolvedValue(stored),
    // The lockout (ACC-05): by default no failure reaches the limit.
    recordFailedLogin: jest.fn().mockResolvedValue(null),
    clearExpiredLock: jest.fn().mockResolvedValue(undefined),
    resetFailedLogins: jest.fn().mockResolvedValue(undefined),
    // Change password (ACC-08).
    findEntityByIdWithPasswordHash: jest.fn().mockResolvedValue(stored),
    updatePassword: jest
      .fn()
      .mockResolvedValue({ ...stored, mustChangePassword: false }),
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
        mustChangePassword: false,
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
        mustChangePassword: false,
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

  describe('lockout (ACC-05)', () => {
    /** What the login rejects with, so a test can look at its status and message. */
    const failureOf = (attempt: Promise<unknown>): Promise<unknown> =>
      attempt.then(
        () => undefined,
        (error: unknown) => error,
      );

    it('counts a wrong password against that account, with the limit of the requirement', async () => {
      const { usersService, service } = setup();

      await failureOf(service.login(wrongLogin));

      expect(MAX_FAILED_LOGIN_ATTEMPTS).toBe(5);
      expect(LOCKOUT_MINUTES).toBe(15);
      expect(usersService.recordFailedLogin).toHaveBeenCalledTimes(1);
      expect(usersService.recordFailedLogin).toHaveBeenCalledWith(
        userObjectId,
        { maxAttempts: 5, lockMs: 15 * MINUTE },
        expect.any(Date),
      );
    });

    it('answers the usual 401 while the limit is not reached', async () => {
      const { service } = setup();

      const error = await failureOf(service.login(wrongLogin));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe(
        INVALID_CREDENTIALS_MESSAGE,
      );
    });

    it('answers 429 with the lockout message on the failure that locks the account', async () => {
      const { usersService, tokens, service } = setup();
      usersService.recordFailedLogin.mockResolvedValueOnce(
        new Date(Date.now() + 15 * MINUTE),
      );

      const error = await failureOf(service.login(wrongLogin));

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect((error as HttpException).message).toBe(accountLockedMessage(15));
      expect(tokens.issueTokens).not.toHaveBeenCalled();
    });

    it('refuses a locked account even with the right password, and does not look at the password', async () => {
      const { usersService, tokens, service } = setup({
        lockedUntil: new Date(Date.now() + 3 * MINUTE),
      });

      const error = await failureOf(service.login(loginDto));

      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect((error as HttpException).message).toBe(accountLockedMessage(3));
      expect(tokens.issueTokens).not.toHaveBeenCalled();
      expect(usersService.recordFailedLogin).not.toHaveBeenCalled();
      expect(usersService.resetFailedLogins).not.toHaveBeenCalled();
      expect(usersService.clearExpiredLock).not.toHaveBeenCalled();
    });

    it('gives a locked account the same answer for a wrong password, and does not count it', async () => {
      const { usersService, service } = setup({
        lockedUntil: new Date(Date.now() + 3 * MINUTE),
      });

      const error = await failureOf(service.login(wrongLogin));

      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect(usersService.recordFailedLogin).not.toHaveBeenCalled();
    });

    it('rounds the time that is left up to whole minutes', async () => {
      const cases: [number, number][] = [
        [30_000, 1],
        [90_000, 2],
        [14 * MINUTE + 1_000, 15],
      ];

      for (const [msLeft, minutes] of cases) {
        const { service } = setup({
          lockedUntil: new Date(Date.now() + msLeft),
        });

        const error = await failureOf(service.login(loginDto));

        expect((error as HttpException).message).toBe(
          accountLockedMessage(minutes),
        );
      }
    });

    it('writes the message in the singular for one minute', () => {
      expect(accountLockedMessage(1)).toBe(
        'Too many failed login attempts. Your account is locked. Try again in 1 minute.',
      );
      expect(accountLockedMessage(15)).toBe(
        'Too many failed login attempts. Your account is locked. Try again in 15 minutes.',
      );
    });

    it('lets the user in again when the lock has run out, and clears the lock first', async () => {
      const { usersService, tokens, service } = setup({
        lockedUntil: new Date(Date.now() - 1_000),
      });

      const result = await service.login(loginDto);

      expect(result.tokens).toBe(issuedTokens);
      expect(usersService.clearExpiredLock).toHaveBeenCalledWith(
        userObjectId,
        expect.any(Date),
      );
      expect(tokens.issueTokens).toHaveBeenCalledTimes(1);
    });

    it('starts the count again after a lock has run out: the lock is cleared before the failure is counted', async () => {
      const { usersService, service } = setup({
        lockedUntil: new Date(Date.now() - 1_000),
      });

      const error = await failureOf(service.login(wrongLogin));

      expect(error).toBeInstanceOf(UnauthorizedException);
      const [cleared] = usersService.clearExpiredLock.mock.invocationCallOrder;
      const [counted] = usersService.recordFailedLogin.mock.invocationCallOrder;
      expect(cleared).toBeLessThan(counted);
    });

    it('does not touch the lock of an account that was never locked', async () => {
      const { usersService, service } = setup();

      await service.login(loginDto);

      expect(usersService.clearExpiredLock).not.toHaveBeenCalled();
    });

    it('resets the count after a successful login', async () => {
      const { usersService, service } = setup();

      await service.login(loginDto);

      expect(usersService.resetFailedLogins).toHaveBeenCalledWith(userObjectId);
      expect(usersService.recordFailedLogin).not.toHaveBeenCalled();
    });

    it('does not reset the count after a wrong password', async () => {
      const { usersService, service } = setup();

      await failureOf(service.login(wrongLogin));

      expect(usersService.resetFailedLogins).not.toHaveBeenCalled();
    });

    it('never counts or locks an unknown email', async () => {
      const { usersService, service } = setup();
      usersService.findEntityByEmailWithPasswordHash.mockResolvedValue(null);

      const error = await failureOf(service.login(wrongLogin));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(usersService.recordFailedLogin).not.toHaveBeenCalled();
      expect(usersService.clearExpiredLock).not.toHaveBeenCalled();
      expect(usersService.resetFailedLogins).not.toHaveBeenCalled();
    });

    it('never counts or locks a deactivated account, which answers 401 even if it was locked (ACC-12)', async () => {
      const { usersService, service } = setup({
        status: UserStatus.Deactivated,
        lockedUntil: new Date(Date.now() + 3 * MINUTE),
      });

      const error = await failureOf(service.login(wrongLogin));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe(
        INVALID_CREDENTIALS_MESSAGE,
      );
      expect(usersService.recordFailedLogin).not.toHaveBeenCalled();
    });

    it('counts the wrong passwords of a suspended account', async () => {
      const { usersService, service } = setup({ status: UserStatus.Suspended });

      await failureOf(service.login(wrongLogin));

      expect(usersService.recordFailedLogin).toHaveBeenCalledTimes(1);
    });

    it('does not count the right password of a suspended account, and does not reset the count either', async () => {
      const { usersService, service } = setup({ status: UserStatus.Suspended });

      const error = await failureOf(service.login(loginDto));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(usersService.recordFailedLogin).not.toHaveBeenCalled();
      expect(usersService.resetFailedLogins).not.toHaveBeenCalled();
    });

    it('tells a locked account that it is locked before it tells that it is suspended', async () => {
      const { service } = setup({
        status: UserStatus.Suspended,
        lockedUntil: new Date(Date.now() + 3 * MINUTE),
      });

      const error = await failureOf(service.login(loginDto));

      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
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

  describe('changePassword (ACC-08)', () => {
    const userId = '6740f1c2a4b5c6d7e8f90123';
    const change: ChangePasswordDto = {
      currentPassword: 'Passw0rdOK',
      newPassword: 'N3wPassword',
    };

    it('checks the current password of the logged-in user and saves the new one', async () => {
      const { usersService, service } = setup();

      await service.changePassword(userId, change);

      expect(usersService.findEntityByIdWithPasswordHash).toHaveBeenCalledWith(
        userId,
      );
      expect(usersService.updatePassword).toHaveBeenCalledWith(
        userObjectId,
        'N3wPassword',
      );
    });

    it('returns the public user, which no longer has to change the password', async () => {
      const { service } = setup({ mustChangePassword: true });

      const user = await service.changePassword(userId, change);

      expect(user).toMatchObject({ id: userId, mustChangePassword: false });
      expect(user).not.toHaveProperty('passwordHash');
    });

    it('refuses a wrong current password with 400 and saves nothing', async () => {
      const { usersService, service } = setup();

      const attempt = service.changePassword(userId, {
        ...change,
        currentPassword: 'Wr0ngPassword',
      });

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toThrow(CURRENT_PASSWORD_INCORRECT_MESSAGE);
      expect(usersService.updatePassword).not.toHaveBeenCalled();
    });

    it('refuses a new password that is the same as the current one', async () => {
      const { usersService, service } = setup();

      const attempt = service.changePassword(userId, {
        ...change,
        newPassword: change.currentPassword,
      });

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toThrow(SAME_PASSWORD_MESSAGE);
      expect(usersService.updatePassword).not.toHaveBeenCalled();
    });

    it('checks the current password before it says the new one is the same', async () => {
      const { service } = setup();

      // Someone who does not know the password learns nothing from this answer.
      const attempt = service.changePassword(userId, {
        currentPassword: 'Wr0ngPassword',
        newPassword: 'Wr0ngPassword',
      });

      await expect(attempt).rejects.toThrow(CURRENT_PASSWORD_INCORRECT_MESSAGE);
    });

    it('answers 401 when the account is gone', async () => {
      const { usersService, service } = setup();
      usersService.findEntityByIdWithPasswordHash.mockResolvedValue(null);

      const attempt = service.changePassword(userId, change);

      await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException);
      expect(usersService.updatePassword).not.toHaveBeenCalled();
    });

    it('answers 401 when the account is gone before the new password is saved', async () => {
      const { usersService, service } = setup();
      usersService.updatePassword.mockResolvedValue(null);

      await expect(service.changePassword(userId, change)).rejects.toThrow(
        LOGIN_REQUIRED_MESSAGE,
      );
    });
  });
});
