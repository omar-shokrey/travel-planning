import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { Public } from '../../common/decorators/public.decorator';
import { Role } from '../../common/enums/role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import type { AuthenticatedRequest } from '../../common/interfaces/authenticated-user.interface';
import type { UsersService } from '../../users/users.service';
import type { AuthTokensService } from '../auth-tokens.service';
import type { SessionsService } from '../sessions.service';
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  LOGIN_REQUIRED_MESSAGE,
  PASSWORD_CHANGE_REQUIRED_MESSAGE,
} from '../auth.constants';
import { AllowTemporaryPassword } from '../decorators/allow-temporary-password.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

class ProtectedController {
  privateRoute(): string {
    return 'ok';
  }

  @Public()
  openRoute(): string {
    return 'ok';
  }
}

@Public()
class OpenController {
  anyRoute(): string {
    return 'ok';
  }
}

class AuthLikeController {
  @AllowTemporaryPassword()
  allowedRoute(): string {
    return 'ok';
  }

  otherRoute(): string {
    return 'ok';
  }
}

@AllowTemporaryPassword()
class AllowedController {
  anyRoute(): string {
    return 'ok';
  }
}

const USER_ID = '6740f1c2a4b5c6d7e8f90123';
const SESSION_ID = '6740f1c2a4b5c6d7e8f90abc';

function storedUser(
  fields: {
    role?: Role;
    status?: UserStatus;
    /** Left out unless given, like a document saved before the field existed. */
    mustChangePassword?: boolean;
  } = {},
) {
  return {
    _id: new Types.ObjectId(USER_ID),
    role: fields.role ?? Role.User,
    status: fields.status ?? UserStatus.Active,
    ...(fields.mustChangePassword === undefined
      ? {}
      : { mustChangePassword: fields.mustChangePassword }),
  };
}

function setup() {
  const tokens = {
    verifyAccessToken: jest
      .fn()
      .mockResolvedValue({ userId: USER_ID, sessionId: SESSION_ID }),
  };
  const usersService = {
    findEntityById: jest.fn().mockResolvedValue(storedUser()),
  };
  // By default the session is live (ACC-06).
  const sessions = { touch: jest.fn().mockResolvedValue(true) };
  const guard = new JwtAuthGuard(
    new Reflector(),
    tokens as unknown as AuthTokensService,
    usersService as unknown as UsersService,
    sessions as unknown as SessionsService,
  );

  /** Runs the guard on a request. By default the request carries an access cookie. */
  const run = (
    controller: unknown,
    handler: unknown,
    request: Partial<AuthenticatedRequest> = {
      cookies: { access_token: 'a-token' },
    },
  ) => {
    const context = {
      getClass: () => controller,
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { request, result: guard.canActivate(context) };
  };

  const runPrivate = (request?: Partial<AuthenticatedRequest>) =>
    run(
      ProtectedController,
      ProtectedController.prototype.privateRoute,
      request,
    );

  return { tokens, usersService, sessions, run, runPrivate };
}

describe('JwtAuthGuard', () => {
  describe('routes marked @Public()', () => {
    it('lets a guest through a public route, without looking at any token', async () => {
      const { tokens, usersService, sessions, run } = setup();

      const { result } = run(
        ProtectedController,
        ProtectedController.prototype.openRoute,
        { cookies: {} },
      );

      await expect(result).resolves.toBe(true);
      expect(tokens.verifyAccessToken).not.toHaveBeenCalled();
      expect(sessions.touch).not.toHaveBeenCalled();
      expect(usersService.findEntityById).not.toHaveBeenCalled();
    });

    it('lets a public route through even when the cookie is broken', async () => {
      const { tokens, run } = setup();
      tokens.verifyAccessToken.mockRejectedValue(new Error('jwt malformed'));

      const { result } = run(
        ProtectedController,
        ProtectedController.prototype.openRoute,
        { cookies: { access_token: 'garbage' } },
      );

      await expect(result).resolves.toBe(true);
    });

    it('uses @Public() set on the controller', async () => {
      const { run } = setup();

      const { result } = run(
        OpenController,
        OpenController.prototype.anyRoute,
        { cookies: {} },
      );

      await expect(result).resolves.toBe(true);
    });
  });

  describe('routes that need a login', () => {
    it('puts the id and the role of an active user on the request', async () => {
      const { tokens, usersService, runPrivate } = setup();
      usersService.findEntityById.mockResolvedValue(
        storedUser({ role: Role.AirlineModerator }),
      );

      const { request, result } = runPrivate();

      await expect(result).resolves.toBe(true);
      expect(tokens.verifyAccessToken).toHaveBeenCalledWith('a-token');
      expect(usersService.findEntityById).toHaveBeenCalledWith(USER_ID);
      expect(request.user).toEqual({
        id: USER_ID,
        role: Role.AirlineModerator,
      });
    });

    const requestsWithoutAToken: [string, Partial<AuthenticatedRequest>][] = [
      ['no cookie at all', { cookies: {} }],
      ['no cookie parser', {}],
      ['an empty access cookie', { cookies: { access_token: '' } }],
      [
        'an access cookie that is not a text',
        { cookies: { access_token: { a: 1 } } },
      ],
      ['only the refresh cookie', { cookies: { refresh_token: 'a-token' } }],
    ];

    it.each(requestsWithoutAToken)(
      'answers 401 for %s, without looking anything up',
      async (_name, requestFields) => {
        const { tokens, usersService, sessions, runPrivate } = setup();

        const { request, result } = runPrivate(requestFields);

        await expect(result).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(result).rejects.toThrow(LOGIN_REQUIRED_MESSAGE);
        expect(tokens.verifyAccessToken).not.toHaveBeenCalled();
        expect(sessions.touch).not.toHaveBeenCalled();
        expect(usersService.findEntityById).not.toHaveBeenCalled();
        expect(request.user).toBeUndefined();
      },
    );

    it('answers 401 with the same message when the token is not valid', async () => {
      const { tokens, usersService, sessions, runPrivate } = setup();
      tokens.verifyAccessToken.mockRejectedValue(new Error('jwt expired'));

      const { request, result } = runPrivate();

      await expect(result).rejects.toBeInstanceOf(UnauthorizedException);
      // The reason (expired, tampered, wrong secret) is not told to the caller.
      await expect(result).rejects.toThrow(LOGIN_REQUIRED_MESSAGE);
      expect(sessions.touch).not.toHaveBeenCalled();
      expect(usersService.findEntityById).not.toHaveBeenCalled();
      expect(request.user).toBeUndefined();
    });

    it('answers 401 when the account no longer exists', async () => {
      const { usersService, runPrivate } = setup();
      usersService.findEntityById.mockResolvedValue(null);

      const { request, result } = runPrivate();

      await expect(result).rejects.toBeInstanceOf(UnauthorizedException);
      expect(request.user).toBeUndefined();
    });

    it('answers 401 when the account was deactivated after the login', async () => {
      const { usersService, runPrivate } = setup();
      usersService.findEntityById.mockResolvedValue(
        storedUser({ status: UserStatus.Deactivated }),
      );

      const { request, result } = runPrivate();

      await expect(result).rejects.toBeInstanceOf(UnauthorizedException);
      expect(request.user).toBeUndefined();
    });

    it('answers 403 when the account was suspended after the login', async () => {
      const { usersService, runPrivate } = setup();
      usersService.findEntityById.mockResolvedValue(
        storedUser({ status: UserStatus.Suspended }),
      );

      const { request, result } = runPrivate();

      await expect(result).rejects.toBeInstanceOf(ForbiddenException);
      await expect(result).rejects.toThrow(ACCOUNT_SUSPENDED_MESSAGE);
      expect(request.user).toBeUndefined();
    });

    it('counts the request as activity in the session the token names (ACC-06)', async () => {
      const { sessions, runPrivate } = setup();

      const before = Date.now();
      await runPrivate().result;
      const after = Date.now();

      expect(sessions.touch).toHaveBeenCalledTimes(1);
      const [sessionId, userId, moment] = sessions.touch.mock.calls[0] as [
        string,
        string,
        Date,
      ];
      expect([sessionId, userId]).toEqual([SESSION_ID, USER_ID]);
      expect(moment.getTime()).toBeGreaterThanOrEqual(before);
      expect(moment.getTime()).toBeLessThanOrEqual(after);
    });

    it('answers 401 when the session is revoked, has run out or does not exist (ACC-06)', async () => {
      const { usersService, sessions, runPrivate } = setup();
      // One answer for all three: the session is not live.
      sessions.touch.mockResolvedValue(false);

      const { request, result } = runPrivate();

      await expect(result).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(result).rejects.toThrow(LOGIN_REQUIRED_MESSAGE);
      expect(usersService.findEntityById).not.toHaveBeenCalled();
      expect(request.user).toBeUndefined();
    });

    it('asks the session before it reads the account', async () => {
      const { usersService, sessions, runPrivate } = setup();

      await runPrivate().result;

      const [touched] = sessions.touch.mock.invocationCallOrder;
      const [read] = usersService.findEntityById.mock.invocationCallOrder;
      expect(touched).toBeLessThan(read);
    });

    it('takes the role from the account, not from the token', async () => {
      const { usersService, runPrivate } = setup();
      usersService.findEntityById.mockResolvedValue(
        storedUser({ role: Role.Admin }),
      );

      const { request, result } = runPrivate();

      await result;
      // The token carries only the user id and the session id, so a role can only come from the database.
      expect(request.user).toEqual({ id: USER_ID, role: Role.Admin });
    });
  });

  describe('a temporary password that must be changed first (ACC-13, ACC-07a)', () => {
    it('answers 403 with its own message on a route without @AllowTemporaryPassword()', async () => {
      const { usersService, runPrivate } = setup();
      usersService.findEntityById.mockResolvedValue(
        storedUser({ mustChangePassword: true }),
      );

      const { request, result } = runPrivate();

      await expect(result).rejects.toBeInstanceOf(ForbiddenException);
      await expect(result).rejects.toThrow(PASSWORD_CHANGE_REQUIRED_MESSAGE);
      expect(request.user).toBeUndefined();
    });

    it('also refuses a route of the same controller that is not marked', async () => {
      const { usersService, run } = setup();
      usersService.findEntityById.mockResolvedValue(
        storedUser({ mustChangePassword: true }),
      );

      const { result } = run(
        AuthLikeController,
        AuthLikeController.prototype.otherRoute,
      );

      await expect(result).rejects.toThrow(PASSWORD_CHANGE_REQUIRED_MESSAGE);
    });

    it('lets the account through a route marked on the handler, with its id and role', async () => {
      const { usersService, run } = setup();
      usersService.findEntityById.mockResolvedValue(
        storedUser({ mustChangePassword: true }),
      );

      const { request, result } = run(
        AuthLikeController,
        AuthLikeController.prototype.allowedRoute,
      );

      await expect(result).resolves.toBe(true);
      expect(request.user).toEqual({ id: USER_ID, role: Role.User });
    });

    it('lets the account through a route of a controller marked as a whole', async () => {
      const { usersService, run } = setup();
      usersService.findEntityById.mockResolvedValue(
        storedUser({ mustChangePassword: true }),
      );

      const { result } = run(
        AllowedController,
        AllowedController.prototype.anyRoute,
      );

      await expect(result).resolves.toBe(true);
    });

    it.each([
      ['false', false],
      ['missing (an account saved before the field existed)', undefined],
    ])(
      'does not restrict an account whose flag is %s',
      async (_name, mustChangePassword) => {
        const { usersService, runPrivate } = setup();
        usersService.findEntityById.mockResolvedValue(
          storedUser({ mustChangePassword }),
        );

        const { request, result } = runPrivate();

        await expect(result).resolves.toBe(true);
        expect(request.user).toEqual({ id: USER_ID, role: Role.User });
      },
    );

    it('tells a suspended account that it is suspended, not that its password is temporary', async () => {
      const { usersService, runPrivate } = setup();
      usersService.findEntityById.mockResolvedValue(
        storedUser({ status: UserStatus.Suspended, mustChangePassword: true }),
      );

      const { result } = runPrivate();

      await expect(result).rejects.toBeInstanceOf(ForbiddenException);
      await expect(result).rejects.toThrow(ACCOUNT_SUSPENDED_MESSAGE);
    });

    it('tells a suspended account that it is suspended on an allowed route too', async () => {
      const { usersService, run } = setup();
      usersService.findEntityById.mockResolvedValue(
        storedUser({ status: UserStatus.Suspended, mustChangePassword: true }),
      );

      const { result } = run(
        AuthLikeController,
        AuthLikeController.prototype.allowedRoute,
      );

      await expect(result).rejects.toThrow(ACCOUNT_SUSPENDED_MESSAGE);
    });

    it('answers 401 for a deactivated account with the flag', async () => {
      const { usersService, runPrivate } = setup();
      usersService.findEntityById.mockResolvedValue(
        storedUser({
          status: UserStatus.Deactivated,
          mustChangePassword: true,
        }),
      );

      const { result } = runPrivate();

      await expect(result).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(result).rejects.toThrow(LOGIN_REQUIRED_MESSAGE);
    });

    it('answers 401 for a guest and a missing account, before the flag is looked at', async () => {
      const { usersService, runPrivate } = setup();
      usersService.findEntityById.mockResolvedValue(null);

      await expect(runPrivate().result).rejects.toThrow(LOGIN_REQUIRED_MESSAGE);
      await expect(runPrivate({ cookies: {} }).result).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('leaves a @Public() route open, without reading the account', async () => {
      const { usersService, run } = setup();
      usersService.findEntityById.mockResolvedValue(
        storedUser({ mustChangePassword: true }),
      );

      const { result } = run(
        ProtectedController,
        ProtectedController.prototype.openRoute,
      );

      await expect(result).resolves.toBe(true);
      expect(usersService.findEntityById).not.toHaveBeenCalled();
    });
  });
});
