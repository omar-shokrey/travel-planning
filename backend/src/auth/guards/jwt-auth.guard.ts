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
  LOGIN_REQUIRED_MESSAGE,
} from '../auth.constants';
import { AuthTokensService, type TokenClaims } from '../auth-tokens.service';
import { SessionsService } from '../sessions.service';

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

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = await this.authenticate(this.readToken(request));
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
    return { id: user._id.toString(), role: user.role };
  }
}
