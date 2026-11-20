import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ACCESS_TOKEN_COOKIE } from '../../common/constants/cookies';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { UserStatus } from '../../common/enums/user-status.enum';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from '../../common/interfaces/authenticated-user.interface';
import { UsersService } from '../../users/users.service';
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  EMAIL_NOT_VERIFIED_MESSAGE,
  LOGIN_REQUIRED_MESSAGE,
  PASSWORD_CHANGE_REQUIRED_MESSAGE,
} from '../auth.constants';
import { AuthTokensService, type TokenClaims } from '../auth-tokens.service';
import { SessionsService } from '../sessions.service';
import { ALLOW_TEMPORARY_PASSWORD_KEY } from '../decorators/allow-temporary-password.decorator';
import { REQUIRE_VERIFIED_EMAIL_KEY } from '../decorators/require-verified-email.decorator';

/** The route flags the guard reads with the account. */
interface RouteFlags {
  allowTemporaryPassword: boolean;
  requireVerifiedEmail: boolean;
}

/**
 * The authentication guard (ACC-04), registered for the whole app. A route
 * needs a logged-in user unless it is marked @Public(). It reads the access
 * token from the httpOnly cookie, loads the account and puts `{ id, role }`
 * on the request for @CurrentUser() and RolesGuard.
 *
 * The account is read on every request, so a suspension or a role change
 * applies at once, without waiting for the token to expire.
 *
 * A valid token is not enough (ACC-06): the session it names must still be
 * live. Logout revokes the session, and a session that had no authenticated
 * request for the inactivity limit has run out. Each request that gets in
 * counts as activity and moves the end of the session forward.
 *
 * A temporary password set by an admin (ACC-13, ACC-07a) must be changed
 * first: while the account has `mustChangePassword`, every route but those
 * marked @AllowTemporaryPassword() (GET /api/auth/me and
 * PATCH /api/auth/change-password) answers 403. The backend enforces it
 * (GEN-13), whatever the frontend does. The flag is read with the account on
 * every request, so the change applies at once.
 *
 * ACC-02: a route marked @RequireVerifiedEmail() (the routes that book)
 * answers 403 "Verify your email address before booking" to an account with
 * `emailVerified: false`. An account without the field (made before ACC-02)
 * is verified. It is checked last, after the suspension and the temporary
 * password.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AuthTokensService,
    private readonly usersService: UsersService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }

    const flag = (key: string): boolean =>
      this.reflector.getAllAndOverride<boolean | undefined>(key, [
        context.getHandler(),
        context.getClass(),
      ]) === true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = await this.authenticate(this.readToken(request), {
      allowTemporaryPassword: flag(ALLOW_TEMPORARY_PASSWORD_KEY),
      requireVerifiedEmail: flag(REQUIRE_VERIFIED_EMAIL_KEY),
    });
    return true;
  }

  private readToken(request: AuthenticatedRequest): string | undefined {
    const cookies: unknown = request.cookies;
    if (typeof cookies !== 'object' || cookies === null) {
      return undefined;
    }
    const token = (cookies as Record<string, unknown>)[ACCESS_TOKEN_COOKIE];
    return typeof token === 'string' && token !== '' ? token : undefined;
  }

  private async authenticate(
    token: string | undefined,
    flags: RouteFlags,
  ): Promise<AuthenticatedUser> {
    if (!token) {
      throw new UnauthorizedException(LOGIN_REQUIRED_MESSAGE);
    }

    let claims: TokenClaims;
    try {
      claims = await this.tokens.verifyAccessToken(token);
    } catch {
      // Expired, tampered with, or signed with another secret.
      throw new UnauthorizedException(LOGIN_REQUIRED_MESSAGE);
    }

    // Logged out, idle for too long, or never existed: the same answer as for
    // a token that is not valid, so the reason is not told to the caller.
    const live = await this.sessions.touch(
      claims.sessionId,
      claims.userId,
      new Date(),
    );
    if (!live) {
      throw new UnauthorizedException(LOGIN_REQUIRED_MESSAGE);
    }

    const user = await this.usersService.findEntityById(claims.userId);
    if (!user) {
      throw new UnauthorizedException(LOGIN_REQUIRED_MESSAGE);
    }
    if (user.status === UserStatus.Suspended) {
      throw new ForbiddenException(ACCOUNT_SUSPENDED_MESSAGE);
    }
    if (user.status !== UserStatus.Active) {
      throw new UnauthorizedException(LOGIN_REQUIRED_MESSAGE);
    }
    // After the checks above, so a suspended account still gets its own 403.
    // A document saved before the flag existed has none: it is not restricted.
    if (user.mustChangePassword === true && !flags.allowTemporaryPassword) {
      throw new ForbiddenException(PASSWORD_CHANGE_REQUIRED_MESSAGE);
    }
    // ACC-02, last: only `false` blocks; a document without the field passes.
    if (flags.requireVerifiedEmail && user.emailVerified === false) {
      throw new ForbiddenException(EMAIL_NOT_VERIFIED_MESSAGE);
    }
    return { id: user._id.toString(), role: user.role };
  }
}
