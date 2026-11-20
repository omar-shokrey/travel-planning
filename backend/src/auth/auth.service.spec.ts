import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
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
import type { EmailService } from '../notifications/email.service';
import type { AuthTokenStoreService } from './auth-token-store.service';
import type { AuthTokensService, TokenClaims } from './auth-tokens.service';
import { AuthService } from './auth.service';
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  CURRENT_PASSWORD_INCORRECT_MESSAGE,
  EMAIL_ALREADY_VERIFIED_MESSAGE,
  EMAIL_SWITCHED_OFF_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  INVALID_VERIFICATION_LINK_MESSAGE,
  SAME_PASSWORD_MESSAGE,
  LOCKOUT_MINUTES,
  LOGIN_REQUIRED_MESSAGE,
  MAX_FAILED_LOGIN_ATTEMPTS,
  VERIFICATION_EMAIL_SENT_MESSAGE,
  VERIFICATION_RESEND_TOO_SOON_MESSAGE,
  accountLockedMessage,
} from './auth.constants';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { AuthTokenType } from './enums/auth-token-type.enum';
import type { SessionsService } from './sessions.service';

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

const SESSION_ID = '6740f1c2a4b5c6d7e8f90abc';

/** What the tokens service reads out of a token of the stored user's session. */
const claims: TokenClaims = {
  userId: '6740f1c2a4b5c6d7e8f90123',
  sessionId: SESSION_ID,
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
    /** Left out unless given, like an account saved before ACC-02. */
    emailVerified?: boolean;
    /** Whether the API sends email (SMTP_HOST set). Off by default. */
    emailEnabled?: boolean;
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
    ...(changes.emailVerified === undefined
      ? {}
      : { emailVerified: changes.emailVerified }),
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
    // Email verification (ACC-02).
    markEmailVerified: jest.fn().mockResolvedValue(true),
  };
  const tokens = {
    issueTokens: jest.fn().mockResolvedValue(issuedTokens),
    verifyRefreshToken: jest.fn().mockResolvedValue(claims),
    readClaims: jest.fn().mockResolvedValue(claims),
    // Not a real hash, but one that shows which token it was made from.
    hashToken: jest.fn((token: string) => `hash-of-${token}`),
  };
  // The sessions (ACC-06): by default the session is live, so a refresh wins.
  const sessions = {
    create: jest.fn().mockResolvedValue(undefined),
    rotate: jest.fn().mockResolvedValue(true),
    revoke: jest.fn().mockResolvedValue(undefined),
    revokeAllOfUser: jest.fn().mockResolvedValue(undefined),
  };
  // Email (GEN-01-B): the background tasks are kept so a test can run them.
  const background: { task: () => Promise<void>; what: string }[] = [];
  const email = {
    enabled: changes.emailEnabled ?? false,
    runInBackground: jest.fn((task: () => Promise<void>, what: string) => {
      background.push({ task, what });
    }),
    sendEmailVerification: jest.fn().mockResolvedValue(undefined),
  };
  const runBackground = async () => {
    for (const { task } of background.splice(0)) await task();
  };
  // The one-time tokens (ACC-02).
  const tokenStore = {
    issue: jest.fn().mockResolvedValue('a-one-time-token'),
    issueUnlessRecent: jest.fn().mockResolvedValue('a-one-time-token'),
    consume: jest.fn().mockResolvedValue(userObjectId),
  };
  const service = new AuthService(
    usersService as unknown as UsersService,
    tokens as unknown as AuthTokensService,
    sessions as unknown as SessionsService,
    email as unknown as EmailService,
    tokenStore as unknown as AuthTokenStoreService,
  );

  return {
    usersService,
    tokens,
    sessions,
    email,
    background,
    runBackground,
    tokenStore,
    service,
  };
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
        emailVerified: true,
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
        emailVerified: true,
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

  describe('register: email verification (ACC-02)', () => {
    it('with email on, creates the account unverified and emails a 24-hour link in the background', async () => {
      const { usersService, email, runBackground, tokenStore, service } = setup(
        { emailEnabled: true, emailVerified: false },
      );

      const response = await service.register(dto);

      expect(usersService.createRegisteredUser).toHaveBeenCalledWith(
        expect.objectContaining({ emailVerified: false }),
      );
      expect(response.emailVerified).toBe(false);
      // Nothing is created or sent before the answer.
      expect(email.runInBackground).toHaveBeenCalledWith(
        expect.any(Function),
        'email verification',
      );
      expect(tokenStore.issue).not.toHaveBeenCalled();
      expect(email.sendEmailVerification).not.toHaveBeenCalled();

      await runBackground();

      expect(tokenStore.issue).toHaveBeenCalledWith(
        userObjectId,
        AuthTokenType.EmailVerification,
        24 * 60 * MINUTE,
      );
      expect(email.sendEmailVerification).toHaveBeenCalledWith({
        name: 'Sara Ahmed',
        email: 'sara@example.com',
        token: 'a-one-time-token',
        expiresInHours: 24,
      });
    });

    it('with email off, creates the account verified, creates no token and sends nothing', async () => {
      const { usersService, email, tokenStore, service } = setup({
        emailEnabled: false,
      });

      const response = await service.register(dto);

      expect(usersService.createRegisteredUser).toHaveBeenCalledWith(
        expect.objectContaining({ emailVerified: true }),
      );
      expect(response.emailVerified).toBe(true);
      expect(email.runInBackground).not.toHaveBeenCalled();
      expect(tokenStore.issue).not.toHaveBeenCalled();
    });

    it('starts nothing in the background when the account is not created', async () => {
      const { usersService, email, service } = setup({ emailEnabled: true });
      usersService.createRegisteredUser.mockRejectedValueOnce(
        new ConflictException(EMAIL_TAKEN_MESSAGE),
      );

      await expect(service.register(dto)).rejects.toThrow(EMAIL_TAKEN_MESSAGE);
      expect(email.runInBackground).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmail (ACC-02)', () => {
    it('consumes the verification token and marks the account of its user as verified', async () => {
      const { tokenStore, usersService, service } = setup();

      await expect(service.verifyEmail('a-one-time-token')).resolves.toEqual({
        verified: true,
      });
      expect(tokenStore.consume).toHaveBeenCalledWith(
        'a-one-time-token',
        AuthTokenType.EmailVerification,
      );
      expect(usersService.markEmailVerified).toHaveBeenCalledWith(userObjectId);
    });

    it('answers 400 with the one message when the token is unknown, expired, used or replaced, and changes no account', async () => {
      const { tokenStore, usersService, service } = setup();
      tokenStore.consume.mockResolvedValueOnce(null);

      const result = service.verifyEmail('a-used-token');

      await expect(result).rejects.toBeInstanceOf(BadRequestException);
      await expect(result).rejects.toThrow(INVALID_VERIFICATION_LINK_MESSAGE);
      expect(usersService.markEmailVerified).not.toHaveBeenCalled();
    });

    it('answers the same 400 when the account of the token is gone', async () => {
      const { usersService, service } = setup();
      usersService.markEmailVerified.mockResolvedValueOnce(false);

      await expect(service.verifyEmail('a-one-time-token')).rejects.toThrow(
        INVALID_VERIFICATION_LINK_MESSAGE,
      );
    });

    it('logs the account id, never the token, and fails when the account cannot be marked after the token was used', async () => {
      const { usersService, service } = setup();
      const failure = new Error('database down');
      usersService.markEmailVerified.mockRejectedValueOnce(failure);
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(service.verifyEmail('a-one-time-token')).rejects.toBe(
        failure,
      );
      expect(logged).toHaveBeenCalledTimes(1);
      const [message] = logged.mock.calls[0] as [string];
      expect(message).toContain(userObjectId.toString());
      expect(JSON.stringify(logged.mock.calls)).not.toContain(
        'a-one-time-token',
      );
      logged.mockRestore();
    });
  });

  describe('resendVerification (ACC-02)', () => {
    it('replaces the token before the answer and emails the new link in the background', async () => {
      const { tokenStore, email, runBackground, service } = setup({
        emailEnabled: true,
        emailVerified: false,
      });

      await expect(
        service.resendVerification(userObjectId.toString()),
      ).resolves.toEqual({ message: VERIFICATION_EMAIL_SENT_MESSAGE });
      expect(tokenStore.issueUnlessRecent).toHaveBeenCalledWith(
        userObjectId,
        AuthTokenType.EmailVerification,
        24 * 60 * MINUTE,
        MINUTE,
      );
      expect(email.sendEmailVerification).not.toHaveBeenCalled();

      await runBackground();

      expect(email.sendEmailVerification).toHaveBeenCalledWith({
        name: 'Sara Ahmed',
        email: 'sara@example.com',
        token: 'a-one-time-token',
        expiresInHours: 24,
      });
    });

    it.each([
      ['true', true],
      ['missing (an account saved before ACC-02)', undefined],
    ])(
      'answers 409 when emailVerified is %s, and creates no token',
      async (_label, emailVerified) => {
        const { tokenStore, service } = setup({
          emailEnabled: true,
          emailVerified,
        });

        const result = service.resendVerification(userObjectId.toString());

        await expect(result).rejects.toBeInstanceOf(ConflictException);
        await expect(result).rejects.toThrow(EMAIL_ALREADY_VERIFIED_MESSAGE);
        expect(tokenStore.issueUnlessRecent).not.toHaveBeenCalled();
      },
    );

    it('answers 409 "email is switched off" when the API sends no email, and creates no token', async () => {
      const { tokenStore, email, service } = setup({
        emailEnabled: false,
        emailVerified: false,
      });

      const result = service.resendVerification(userObjectId.toString());

      await expect(result).rejects.toBeInstanceOf(ConflictException);
      await expect(result).rejects.toThrow(EMAIL_SWITCHED_OFF_MESSAGE);
      expect(tokenStore.issueUnlessRecent).not.toHaveBeenCalled();
      expect(email.runInBackground).not.toHaveBeenCalled();
    });

    it('answers 429 and sends nothing when the last link of the account is less than a minute old', async () => {
      const { tokenStore, email, service } = setup({
        emailEnabled: true,
        emailVerified: false,
      });
      tokenStore.issueUnlessRecent.mockResolvedValueOnce(null);

      const result = service.resendVerification(userObjectId.toString());

      await expect(result).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
        message: VERIFICATION_RESEND_TOO_SOON_MESSAGE,
      });
      expect(email.runInBackground).not.toHaveBeenCalled();
    });

    it('answers 401 when the account is gone', async () => {
      const { usersService, service } = setup({ emailEnabled: true });
      usersService.findEntityById.mockResolvedValueOnce(null);

      await expect(
        service.resendVerification(userObjectId.toString()),
      ).rejects.toThrow(LOGIN_REQUIRED_MESSAGE);
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
        expect.stringMatching(/^[0-9a-f]{24}$/),
      );
      expect(result.tokens).toBe(issuedTokens);
      expect(result.user).toEqual({
        id: '6740f1c2a4b5c6d7e8f90123',
        name: 'Sara Ahmed',
        email: 'sara@example.com',
        role: 'user',
        status: 'active',
        mustChangePassword: false,
        emailVerified: true,
        createdAt: '2026-11-14T10:00:00.000Z',
      });
    });

    it('never puts the password hash in the user it returns', async () => {
      const { service } = setup();

      const { user } = await service.login(loginDto);

      expect(JSON.stringify(user)).not.toContain(passwordHash);
      expect(user).not.toHaveProperty('passwordHash');
    });

    it('starts a session with the id that both tokens carry (ACC-06)', async () => {
      const { tokens, sessions, service } = setup();

      await service.login(loginDto);

      const [, tokenSessionId] = tokens.issueTokens.mock.calls[0] as [
        string,
        string,
      ];
      expect(sessions.create).toHaveBeenCalledTimes(1);
      const [created] = sessions.create.mock.calls[0] as [
        { id: Types.ObjectId; userId: Types.ObjectId; now: Date },
      ];
      expect(created.id.toString()).toBe(tokenSessionId);
      expect(created.userId).toBe(userObjectId);
      expect(created.now).toBeInstanceOf(Date);
    });

    it('stores the hash of the refresh token and never the token (ACC-06)', async () => {
      const { sessions, service } = setup();

      await service.login(loginDto);

      expect(sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          refreshTokenHash: 'hash-of-a-refresh-token',
        }),
      );
      expect(JSON.stringify(sessions.create.mock.calls)).not.toContain(
        issuedTokens.accessToken,
      );
      expect(JSON.stringify(sessions.create.mock.calls)).not.toContain(
        `"${issuedTokens.refreshToken}"`,
      );
    });

    it('makes a new session on every login, so two browsers do not share one (ACC-06)', async () => {
      const { sessions, service } = setup();

      await service.login(loginDto);
      await service.login(loginDto);

      const [first, second] = sessions.create.mock.calls.map(([created]) =>
        (created as { id: Types.ObjectId }).id.toString(),
      );
      expect(first).not.toBe(second);
    });

    it('starts no session when the login fails (ACC-06)', async () => {
      const wrong = setup();
      const suspended = setup({ status: UserStatus.Suspended });
      const locked = setup({ lockedUntil: new Date(Date.now() + MINUTE) });

      await wrong.service.login(wrongLogin).catch(() => undefined);
      await suspended.service.login(loginDto).catch(() => undefined);
      await locked.service.login(loginDto).catch(() => undefined);

      expect(wrong.sessions.create).not.toHaveBeenCalled();
      expect(suspended.sessions.create).not.toHaveBeenCalled();
      expect(locked.sessions.create).not.toHaveBeenCalled();
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

  describe('logout (ACC-06)', () => {
    it('revokes the session named by the refresh token', async () => {
      const { tokens, sessions, service } = setup();

      await service.logout({ refreshToken: 'a-refresh-token' });

      expect(tokens.readClaims).toHaveBeenCalledWith(
        'a-refresh-token',
        'refresh',
      );
      expect(sessions.revoke).toHaveBeenCalledTimes(1);
      expect(sessions.revoke).toHaveBeenCalledWith(
        SESSION_ID,
        claims.userId,
        expect.any(Date),
      );
    });

    it('revokes the session named by the access token when there is no refresh token', async () => {
      const { tokens, sessions, service } = setup();

      await service.logout({ accessToken: 'an-access-token' });

      expect(tokens.readClaims).toHaveBeenCalledWith(
        'an-access-token',
        'access',
      );
      expect(sessions.revoke).toHaveBeenCalledWith(
        SESSION_ID,
        claims.userId,
        expect.any(Date),
      );
    });

    it('revokes the session once when both tokens name it', async () => {
      const { sessions, service } = setup();

      await service.logout({
        refreshToken: 'a-refresh-token',
        accessToken: 'an-access-token',
      });

      expect(sessions.revoke).toHaveBeenCalledTimes(1);
    });

    it('revokes both sessions when the two tokens name different ones', async () => {
      const { tokens, sessions, service } = setup();
      tokens.readClaims.mockResolvedValueOnce(claims).mockResolvedValueOnce({
        ...claims,
        sessionId: '6740f1c2a4b5c6d7e8f90def',
      });

      await service.logout({
        refreshToken: 'a-refresh-token',
        accessToken: 'an-access-token',
      });

      expect(sessions.revoke).toHaveBeenCalledTimes(2);
    });

    it('does nothing, and does not fail, when no token was sent', async () => {
      const { tokens, sessions, service } = setup();

      await expect(service.logout({})).resolves.toBeUndefined();

      expect(tokens.readClaims).not.toHaveBeenCalled();
      expect(sessions.revoke).not.toHaveBeenCalled();
    });

    it('revokes nothing, and does not fail, when the token is not ours', async () => {
      const { tokens, sessions, service } = setup();
      tokens.readClaims.mockResolvedValue(null);

      await expect(
        service.logout({ refreshToken: 'garbage', accessToken: 'garbage' }),
      ).resolves.toBeUndefined();

      expect(sessions.revoke).not.toHaveBeenCalled();
    });
  });

  describe('refresh (ACC-06)', () => {
    /** Runs a refresh that must fail and returns the error. */
    const failureOf = (attempt: Promise<unknown>): Promise<unknown> =>
      attempt.then(
        () => {
          throw new Error('The refresh was expected to fail');
        },
        (error: unknown) => error,
      );

    it('issues new tokens for the same session and returns the public user', async () => {
      const { tokens, service } = setup();
      const newTokens = {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      };
      tokens.issueTokens.mockResolvedValueOnce(newTokens);

      const result = await service.refresh('a-refresh-token');

      expect(tokens.verifyRefreshToken).toHaveBeenCalledWith('a-refresh-token');
      expect(tokens.issueTokens).toHaveBeenCalledWith(
        claims.userId,
        SESSION_ID,
      );
      expect(result.tokens).toBe(newTokens);
      expect(result.user).toMatchObject({
        id: claims.userId,
        email: 'sara@example.com',
        role: 'user',
      });
      expect(JSON.stringify(result.user)).not.toContain(passwordHash);
    });

    it('swaps the stored hash of the old refresh token for the hash of the new one', async () => {
      const { tokens, sessions, service } = setup();
      tokens.issueTokens.mockResolvedValueOnce({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      });

      await service.refresh('a-refresh-token');

      expect(sessions.rotate).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        userId: claims.userId,
        currentHash: 'hash-of-a-refresh-token',
        newHash: 'hash-of-new-refresh',
        now: expect.any(Date),
      });
    });

    it('answers 401 without looking anything up when there is no refresh token', async () => {
      const { usersService, tokens, sessions, service } = setup();

      const error = await failureOf(service.refresh(undefined));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe(
        LOGIN_REQUIRED_MESSAGE,
      );
      expect(tokens.verifyRefreshToken).not.toHaveBeenCalled();
      expect(usersService.findEntityById).not.toHaveBeenCalled();
      expect(sessions.rotate).not.toHaveBeenCalled();
    });

    it('answers 401 when the token is not valid or has expired, and issues nothing', async () => {
      const { usersService, tokens, sessions, service } = setup();
      tokens.verifyRefreshToken.mockRejectedValue(new Error('jwt expired'));

      const error = await failureOf(service.refresh('a-refresh-token'));

      expect(error).toBeInstanceOf(UnauthorizedException);
      // The reason (expired, tampered, wrong secret) is not told to the caller.
      expect((error as UnauthorizedException).message).toBe(
        LOGIN_REQUIRED_MESSAGE,
      );
      expect(usersService.findEntityById).not.toHaveBeenCalled();
      expect(tokens.issueTokens).not.toHaveBeenCalled();
      expect(sessions.rotate).not.toHaveBeenCalled();
    });

    it('answers 401 when the session is revoked, has run out or holds another token', async () => {
      const { sessions, service } = setup();
      // One atomic update decides all three: it matched no live session with this token.
      sessions.rotate.mockResolvedValue(false);

      const error = await failureOf(service.refresh('a-refresh-token'));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe(
        LOGIN_REQUIRED_MESSAGE,
      );
    });

    it('answers 401 when the account is gone', async () => {
      const { usersService, sessions, service } = setup();
      usersService.findEntityById.mockResolvedValue(null);

      const error = await failureOf(service.refresh('a-refresh-token'));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(sessions.rotate).not.toHaveBeenCalled();
    });

    it('answers 401 when the account was deactivated (ACC-12)', async () => {
      const { tokens, sessions, service } = setup({
        status: UserStatus.Deactivated,
      });

      const error = await failureOf(service.refresh('a-refresh-token'));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(tokens.issueTokens).not.toHaveBeenCalled();
      expect(sessions.rotate).not.toHaveBeenCalled();
    });

    it('answers 403 when the account is suspended, and issues nothing', async () => {
      const { tokens, sessions, service } = setup({
        status: UserStatus.Suspended,
      });

      const error = await failureOf(service.refresh('a-refresh-token'));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe(
        ACCOUNT_SUSPENDED_MESSAGE,
      );
      expect(tokens.issueTokens).not.toHaveBeenCalled();
      expect(sessions.rotate).not.toHaveBeenCalled();
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
    /** The access cookie of the request; the mock reads its claims as `claims`. */
    const ACCESS_TOKEN = 'the-access-token';
    const change: ChangePasswordDto = {
      currentPassword: 'Passw0rdOK',
      newPassword: 'N3wPassword',
    };

    it('checks the current password of the logged-in user and saves the new one', async () => {
      const { usersService, service } = setup();

      await service.changePassword(userId, ACCESS_TOKEN, change);

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

      const user = await service.changePassword(userId, ACCESS_TOKEN, change);

      expect(user).toMatchObject({ id: userId, mustChangePassword: false });
      expect(user).not.toHaveProperty('passwordHash');
    });

    it('refuses a wrong current password with 400 and saves nothing', async () => {
      const { usersService, service } = setup();

      const attempt = service.changePassword(userId, ACCESS_TOKEN, {
        ...change,
        currentPassword: 'Wr0ngPassword',
      });

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toThrow(CURRENT_PASSWORD_INCORRECT_MESSAGE);
      expect(usersService.updatePassword).not.toHaveBeenCalled();
    });

    it('refuses a new password that is the same as the current one', async () => {
      const { usersService, service } = setup();

      const attempt = service.changePassword(userId, ACCESS_TOKEN, {
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
      const attempt = service.changePassword(userId, ACCESS_TOKEN, {
        currentPassword: 'Wr0ngPassword',
        newPassword: 'Wr0ngPassword',
      });

      await expect(attempt).rejects.toThrow(CURRENT_PASSWORD_INCORRECT_MESSAGE);
    });

    it('answers 401 when the account is gone', async () => {
      const { usersService, service } = setup();
      usersService.findEntityByIdWithPasswordHash.mockResolvedValue(null);

      const attempt = service.changePassword(userId, ACCESS_TOKEN, change);

      await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException);
      expect(usersService.updatePassword).not.toHaveBeenCalled();
    });

    it('answers 401 when the account is gone before the new password is saved', async () => {
      const { usersService, service } = setup();
      usersService.updatePassword.mockResolvedValue(null);

      await expect(
        service.changePassword(userId, ACCESS_TOKEN, change),
      ).rejects.toThrow(LOGIN_REQUIRED_MESSAGE);
    });

    it('ends the other sessions of the user and keeps the one that made the change', async () => {
      const { tokens, sessions, service } = setup();

      await service.changePassword(userId, ACCESS_TOKEN, change);

      expect(tokens.readClaims).toHaveBeenCalledWith(ACCESS_TOKEN, 'access');
      expect(sessions.revokeAllOfUser).toHaveBeenCalledWith(
        userId,
        expect.any(Date),
        claims.sessionId,
      );
    });

    it('saves the password first, then ends the other sessions', async () => {
      const { usersService, sessions, service } = setup();

      await service.changePassword(userId, ACCESS_TOKEN, change);

      const saved = usersService.updatePassword.mock.invocationCallOrder[0];
      const ended = sessions.revokeAllOfUser.mock.invocationCallOrder[0];
      expect(saved).toBeLessThan(ended);
    });

    it('answers 401 and changes nothing when the claims of the access cookie cannot be read', async () => {
      const { tokens, usersService, sessions, service } = setup();
      tokens.readClaims.mockResolvedValue(null);

      const attempt = service.changePassword(userId, ACCESS_TOKEN, change);

      await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(attempt).rejects.toThrow(LOGIN_REQUIRED_MESSAGE);
      expect(usersService.updatePassword).not.toHaveBeenCalled();
      expect(sessions.revokeAllOfUser).not.toHaveBeenCalled();
    });

    it('answers 401 and changes nothing when there is no access cookie', async () => {
      const { usersService, sessions, service } = setup();

      const attempt = service.changePassword(userId, undefined, change);

      await expect(attempt).rejects.toThrow(LOGIN_REQUIRED_MESSAGE);
      expect(usersService.updatePassword).not.toHaveBeenCalled();
      expect(sessions.revokeAllOfUser).not.toHaveBeenCalled();
    });

    it('answers 401 when the access cookie belongs to another user', async () => {
      const { tokens, usersService, service } = setup();
      tokens.readClaims.mockResolvedValue({
        ...claims,
        userId: '6740f1c2a4b5c6d7e8f90999',
      });

      await expect(
        service.changePassword(userId, ACCESS_TOKEN, change),
      ).rejects.toThrow(LOGIN_REQUIRED_MESSAGE);
      expect(usersService.updatePassword).not.toHaveBeenCalled();
    });

    it('ends no session when the password is not changed', async () => {
      const { sessions, service } = setup();

      await service
        .changePassword(userId, ACCESS_TOKEN, {
          ...change,
          currentPassword: 'Wr0ngPassword',
        })
        .catch(() => undefined);

      expect(sessions.revokeAllOfUser).not.toHaveBeenCalled();
    });
  });
});
