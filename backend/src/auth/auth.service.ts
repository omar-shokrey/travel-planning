import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { compare, hash } from 'bcrypt';
import { PASSWORD_SALT_ROUNDS } from '../common/constants/password';
import { UserStatus } from '../common/enums/user-status.enum';
import type { UserResponseDto } from '../users/dto/user-response.dto';
import { toUserResponse } from '../users/mappers/user.mapper';
import { UsersService, type LockoutPolicy } from '../users/users.service';
import type { AuthTokens } from './auth-cookies.service';
import { AuthTokensService } from './auth-tokens.service';
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  LOCKOUT_MINUTES,
  LOGIN_REQUIRED_MESSAGE,
  MAX_FAILED_LOGIN_ATTEMPTS,
  accountLockedMessage,
} from './auth.constants';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

const MILLISECONDS_PER_MINUTE = 60_000;

/** The lockout of ACC-05: 5 failed logins in a row lock the account for 15 minutes. */
const LOCKOUT_POLICY: LockoutPolicy = {
  maxAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
  lockMs: LOCKOUT_MINUTES * MILLISECONDS_PER_MINUTE,
};

/** What a successful login gives the controller: the user for the body, the tokens for the cookies. */
export interface LoginResult {
  user: UserResponseDto;
  tokens: AuthTokens;
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
    const tokens = await this.tokens.issueTokens(user._id.toString());
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

  private getUnknownEmailHash(): Promise<string> {
    this.unknownEmailHash ??= hash(
      'a password that no account has',
      PASSWORD_SALT_ROUNDS,
    );
    return this.unknownEmailHash;
  }
}
