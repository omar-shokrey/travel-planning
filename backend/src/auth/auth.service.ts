import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { compare, hash } from 'bcrypt';
import { Types } from 'mongoose';
import { PASSWORD_SALT_ROUNDS } from '../common/constants/password';
import { UserStatus } from '../common/enums/user-status.enum';
import type { UserResponseDto } from '../users/dto/user-response.dto';
import { toUserResponse } from '../users/mappers/user.mapper';
import { UsersService, type LockoutPolicy } from '../users/users.service';
import type { AuthTokens } from './auth-cookies.service';
import { AuthTokensService, type TokenClaims } from './auth-tokens.service';
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  CURRENT_PASSWORD_INCORRECT_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  LOCKOUT_MINUTES,
  LOGIN_REQUIRED_MESSAGE,
  SAME_PASSWORD_MESSAGE,
  MAX_FAILED_LOGIN_ATTEMPTS,
  accountLockedMessage,
} from './auth.constants';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { SessionsService } from './sessions.service';

const MILLISECONDS_PER_MINUTE = 60_000;

/** The lockout of ACC-05: 5 failed logins in a row lock the account for 15 minutes. */
const LOCKOUT_POLICY: LockoutPolicy = {
  maxAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
  lockMs: LOCKOUT_MINUTES * MILLISECONDS_PER_MINUTE,
};

/**
 * What a successful login or refresh gives the controller: the user for the
 * body, the tokens for the cookies.
 */
export interface LoginResult {
  user: UserResponseDto;
  tokens: AuthTokens;
}

/** The tokens a request to log out carried. Either one, both or none. */
export interface LogoutTokens {
  refreshToken?: string;
  accessToken?: string;
}

@Injectable()
export class AuthService {
  /**
   * A hash that no password matches. An unknown email is checked against it,
   * so a login takes as long for an email that has no account as for one that
   * has. Made on first use, once.
   */
  private unknownEmailHash: Promise<string> | undefined;

  constructor(
    private readonly usersService: UsersService,
    private readonly tokens: AuthTokensService,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * Creates the account of a guest (ACC-01). The DTO has already checked the
   * consent, so the time of this request is stored as the time it was given.
   * Registering does not log the user in.
   */
  async register(dto: RegisterDto): Promise<UserResponseDto> {
    const user = await this.usersService.createRegisteredUser({
      name: dto.name,
      email: dto.email,
      password: dto.password,
      consentAcceptedAt: new Date(),
    });
    return toUserResponse(user);
  }

  /**
   * Checks the email and the password and issues the tokens (ACC-04), and
   * locks the account after too many wrong passwords in a row (ACC-05).
   *
   * An unknown email, a wrong password and a deactivated account (ACC-12) all
   * get the same answer, so nobody can find out which emails are registered.
   * A deactivated account is also never counted or locked, for the same
   * reason. The suspension is told only after the password is right, so it is
   * not shown to someone who does not know it.
   *
   * A locked account is refused before the password is looked at, so a guess
   * that is right still gets nothing while the lock lasts. The 5th wrong
   * password in a row gets the lockout answer at once. When the lock has run
   * out the count starts again, and a successful login also resets it.
   *
   * A successful login starts a session (ACC-06). Both tokens name it, and the
   * hash of the refresh token is stored with it.
   */
  async login(dto: LoginDto): Promise<LoginResult> {
    const found = await this.usersService.findEntityByEmailWithPasswordHash(
      dto.email,
    );
    // From here a deactivated account is an unknown one: no count, no lock.
    const user = found?.status === UserStatus.Deactivated ? null : found;

    if (user?.lockedUntil) {
      const now = new Date();
      if (user.lockedUntil.getTime() > now.getTime()) {
        throw this.lockedOut(user.lockedUntil, now);
      }
      await this.usersService.clearExpiredLock(user._id, now);
    }

    const passwordHash =
      user?.passwordHash ?? (await this.getUnknownEmailHash());
    const passwordMatches = await compare(dto.password, passwordHash);
    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    if (!passwordMatches) {
      const now = new Date();
      const lockedUntil = await this.usersService.recordFailedLogin(
        user._id,
        LOCKOUT_POLICY,
        now,
      );
      if (lockedUntil) {
        throw this.lockedOut(lockedUntil, new Date());
      }
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    if (user.status === UserStatus.Suspended) {
      throw new ForbiddenException(ACCOUNT_SUSPENDED_MESSAGE);
    }

    await this.usersService.resetFailedLogins(user._id);
    // The id is made first, because both tokens carry it.
    const sessionId = new Types.ObjectId();
    const tokens = await this.tokens.issueTokens(
      user._id.toString(),
      sessionId.toString(),
    );
    await this.sessions.create({
      id: sessionId,
      userId: user._id,
      refreshTokenHash: this.tokens.hashToken(tokens.refreshToken),
      now: new Date(),
    });
    return { user: toUserResponse(user), tokens };
  }

  /**
   * Ends the session the request belongs to (ACC-06): the session is revoked,
   * so neither of its tokens works any more, even before they expire.
   *
   * It never fails. Logging out with no cookie, with a broken one or a second
   * time is fine, and the controller clears the cookies in every case. An
   * expired token still ends its session, so a user whose access token ran
   * out can still log out for good. A token that is not ours revokes nothing.
   */
  async logout(sent: LogoutTokens): Promise<void> {
    const [fromRefresh, fromAccess] = await Promise.all([
      sent.refreshToken
        ? this.tokens.readClaims(sent.refreshToken, 'refresh')
        : null,
      sent.accessToken
        ? this.tokens.readClaims(sent.accessToken, 'access')
        : null,
    ]);
    // Both cookies normally name the same session. If they name two, both end.
    const sessions = new Map<string, TokenClaims>();
    for (const claims of [fromRefresh, fromAccess]) {
      if (claims) {
        sessions.set(`${claims.sessionId}:${claims.userId}`, claims);
      }
    }
    const now = new Date();
    await Promise.all(
      [...sessions.values()].map((claims) =>
        this.sessions.revoke(claims.sessionId, claims.userId, now),
      ),
    );
  }

  /**
   * Gives a session that is still live new tokens (ACC-06), so the user stays
   * logged in without the password. The refresh token works once: the new
   * one replaces it in the session, and the old one is refused from then on.
   * Of two refreshes with the same token at the same time only one succeeds.
   *
   * Every way to fail is the same 401 as having no login: no cookie, a token
   * that is not valid or has expired, a session that was revoked or has been
   * idle for the whole limit, a token that was already used, an account that
   * is gone or deactivated. A suspended account gets the 403 of the guard.
   */
  async refresh(refreshToken: string | undefined): Promise<LoginResult> {
    const claims = await this.verifiedRefreshClaims(refreshToken);
    if (!refreshToken || !claims) {
      throw new UnauthorizedException(LOGIN_REQUIRED_MESSAGE);
    }

    const user = await this.usersService.findEntityById(claims.userId);
    if (!user || user.status === UserStatus.Deactivated) {
      throw new UnauthorizedException(LOGIN_REQUIRED_MESSAGE);
    }
    if (user.status === UserStatus.Suspended) {
      throw new ForbiddenException(ACCOUNT_SUSPENDED_MESSAGE);
    }

    const tokens = await this.tokens.issueTokens(
      claims.userId,
      claims.sessionId,
    );
    const rotated = await this.sessions.rotate({
      sessionId: claims.sessionId,
      userId: claims.userId,
      currentHash: this.tokens.hashToken(refreshToken),
      newHash: this.tokens.hashToken(tokens.refreshToken),
      now: new Date(),
    });
    if (!rotated) {
      throw new UnauthorizedException(LOGIN_REQUIRED_MESSAGE);
    }
    return { user: toUserResponse(user), tokens };
  }

  /** The account of the logged-in user (ACC-04, ACC-19). */
  async me(userId: string): Promise<UserResponseDto> {
    const user = await this.usersService.findEntityById(userId);
    if (!user) {
      throw new UnauthorizedException(LOGIN_REQUIRED_MESSAGE);
    }
    return toUserResponse(user);
  }

  /** The claims of the refresh token sent, or `null` when there is none or it is not valid. */
  private async verifiedRefreshClaims(
    token: string | undefined,
  ): Promise<TokenClaims | null> {
    if (!token) {
      return null;
    }
    try {
      return await this.tokens.verifyRefreshToken(token);
    } catch {
      return null;
    }
  }

  /** The 429 of a locked account, with the whole minutes left rounded up. */
  private lockedOut(lockedUntil: Date, now: Date): HttpException {
    const minutesLeft = Math.max(
      1,
      Math.ceil(
        (lockedUntil.getTime() - now.getTime()) / MILLISECONDS_PER_MINUTE,
      ),
    );
    return new HttpException(
      accountLockedMessage(minutesLeft),
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * Changes the password of the logged-in user (ACC-08). The current password
   * is checked first, so someone who only holds the session (an unlocked
   * computer) cannot change it. The new password must differ from the current
   * one, which matters most after a temporary password (ACC-07a, ACC-13).
   * Saving it clears `mustChangePassword`.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<UserResponseDto> {
    const user = await this.usersService.findEntityByIdWithPasswordHash(userId);
    if (!user) {
      throw new UnauthorizedException(LOGIN_REQUIRED_MESSAGE);
    }
    if (!(await compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException(CURRENT_PASSWORD_INCORRECT_MESSAGE);
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException(SAME_PASSWORD_MESSAGE);
    }

    const updated = await this.usersService.updatePassword(
      user._id,
      dto.newPassword,
    );
    if (!updated) {
      throw new UnauthorizedException(LOGIN_REQUIRED_MESSAGE);
    }
    return toUserResponse(updated);
  }

  private getUnknownEmailHash(): Promise<string> {
    this.unknownEmailHash ??= hash(
      'a password that no account has',
      PASSWORD_SALT_ROUNDS,
    );
    return this.unknownEmailHash;
  }
}
