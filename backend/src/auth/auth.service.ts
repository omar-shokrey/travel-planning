import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { compare, hash } from 'bcrypt';
import { Types } from 'mongoose';
import { PASSWORD_SALT_ROUNDS } from '../common/constants/password';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import { EmailService } from '../notifications/email.service';
import type { UserResponseDto } from '../users/dto/user-response.dto';
import { toUserResponse } from '../users/mappers/user.mapper';
import { UsersService, type LockoutPolicy } from '../users/users.service';
import type { AuthTokens } from './auth-cookies.service';
import { AuthTokenStoreService } from './auth-token-store.service';
import { AuthTokensService, type TokenClaims } from './auth-tokens.service';
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  CURRENT_PASSWORD_INCORRECT_MESSAGE,
  EMAIL_ALREADY_VERIFIED_MESSAGE,
  EMAIL_SWITCHED_OFF_MESSAGE,
  EMAIL_VERIFICATION_TOKEN_HOURS,
  INVALID_CREDENTIALS_MESSAGE,
  INVALID_RESET_LINK_MESSAGE,
  INVALID_VERIFICATION_LINK_MESSAGE,
  LOCKOUT_MINUTES,
  LOGIN_REQUIRED_MESSAGE,
  SAME_PASSWORD_MESSAGE,
  MAX_FAILED_LOGIN_ATTEMPTS,
  MAX_PENDING_PASSWORD_RESETS,
  PASSWORD_RESET_DONE_MESSAGE,
  PASSWORD_RESET_REQUESTED_MESSAGE,
  PASSWORD_RESET_TOKEN_MINUTES,
  VERIFICATION_EMAIL_SENT_MESSAGE,
  VERIFICATION_RESEND_INTERVAL_SECONDS,
  VERIFICATION_RESEND_TOO_SOON_MESSAGE,
  accountLockedMessage,
} from './auth.constants';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type {
  EmailVerifiedResponseDto,
  VerificationEmailSentResponseDto,
} from './dto/email-verification-response.dto';
import type { LoginDto } from './dto/login.dto';
import type {
  PasswordResetDoneResponseDto,
  PasswordResetRequestedResponseDto,
} from './dto/password-reset-response.dto';
import type { ResetForgottenPasswordDto } from './dto/reset-forgotten-password.dto';
import type { RegisterDto } from './dto/register.dto';
import { AuthTokenType } from './enums/auth-token-type.enum';
import { SessionsService } from './sessions.service';

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;

/** ACC-07: how long a reset link works, in milliseconds. */
const PASSWORD_RESET_TOKEN_MS =
  PASSWORD_RESET_TOKEN_MINUTES * MILLISECONDS_PER_MINUTE;

/** ACC-02: how long a verification link works, in milliseconds. */
const EMAIL_VERIFICATION_TOKEN_MS =
  EMAIL_VERIFICATION_TOKEN_HOURS * MILLISECONDS_PER_HOUR;

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
  private readonly logger = new Logger(AuthService.name);

  /**
   * A hash that no password matches. An unknown email is checked against it,
   * so a login takes as long for an email that has no account as for one that
   * has. Made on first use, once.
   */
  private unknownEmailHash: Promise<string> | undefined;

  /** ACC-07: forgot-password requests being worked on in the background. */
  private pendingPasswordResets = 0;

  constructor(
    private readonly usersService: UsersService,
    private readonly tokens: AuthTokensService,
    private readonly sessions: SessionsService,
    private readonly email: EmailService,
    private readonly tokenStore: AuthTokenStoreService,
  ) {}

  /**
   * Creates the account of a guest (ACC-01). The DTO has already checked the
   * consent, so the time of this request is stored as the time it was given.
   * Registering does not log the user in.
   *
   * ACC-02: when the API sends email, the account starts with
   * `emailVerified: false` and the verification link is created and emailed
   * in the background, after the answer. A failure there is logged and the
   * account stays; the user asks for a new link (`resendVerification`). When
   * email is switched off (SMTP_HOST empty) nobody could ever verify, so the
   * account starts verified and nothing is created or sent.
   */
  async register(dto: RegisterDto): Promise<UserResponseDto> {
    const mustVerify = this.email.enabled;
    const user = await this.usersService.createRegisteredUser({
      name: dto.name,
      email: dto.email,
      password: dto.password,
      consentAcceptedAt: new Date(),
      emailVerified: !mustVerify,
    });
    if (mustVerify) {
      const recipient = { id: user._id, name: user.name, email: user.email };
      this.email.runInBackground(
        () => this.sendVerificationLink(recipient),
        'email verification',
      );
    }
    return toUserResponse(user);
  }

  /**
   * ACC-02, GET /api/auth/verify-email: uses the token of the link and marks
   * the email of its account as verified. The token is consumed in one atomic
   * step first, so it works once. An unknown, expired, used or replaced token,
   * or one whose account is gone, all get the same 400.
   *
   * If marking the account fails after the token was consumed, the error is
   * logged and the request answers 500: the link no longer works, and the user
   * asks for a new one.
   */
  async verifyEmail(token: string): Promise<EmailVerifiedResponseDto> {
    const userId = await this.tokenStore.consume(
      token,
      AuthTokenType.EmailVerification,
    );
    if (!userId) {
      throw new BadRequestException(INVALID_VERIFICATION_LINK_MESSAGE);
    }
    let marked: boolean;
    try {
      marked = await this.usersService.markEmailVerified(userId);
    } catch (error) {
      this.logger.error(
        `The email of account ${userId.toString()} was not marked as verified after its link was used`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
    if (!marked) {
      throw new BadRequestException(INVALID_VERIFICATION_LINK_MESSAGE);
    }
    return { verified: true };
  }

  /**
   * ACC-02, POST /api/auth/resend-verification: a new link for the logged-in
   * user whose email is not verified yet. The new token replaces the old one
   * before the answer, so the old link stops working at once; the email goes
   * out in the background. 409 for a verified account, and when email is
   * switched off. 429 when the last link of the account (from registration
   * or an earlier request) is less than a minute old, so the route cannot be
   * used to flood an inbox.
   */
  async resendVerification(
    userId: string,
  ): Promise<VerificationEmailSentResponseDto> {
    const user = await this.usersService.findEntityById(userId);
    if (!user) {
      throw new UnauthorizedException(LOGIN_REQUIRED_MESSAGE);
    }
    if (user.emailVerified !== false) {
      throw new ConflictException(EMAIL_ALREADY_VERIFIED_MESSAGE);
    }
    if (!this.email.enabled) {
      throw new ConflictException(EMAIL_SWITCHED_OFF_MESSAGE);
    }
    const token = await this.tokenStore.issueUnlessRecent(
      user._id,
      AuthTokenType.EmailVerification,
      EMAIL_VERIFICATION_TOKEN_MS,
      VERIFICATION_RESEND_INTERVAL_SECONDS * 1000,
    );
    if (token === null) {
      throw new HttpException(
        VERIFICATION_RESEND_TOO_SOON_MESSAGE,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const recipient = { name: user.name, email: user.email };
    this.email.runInBackground(
      () =>
        this.email.sendEmailVerification({
          ...recipient,
          token,
          expiresInHours: EMAIL_VERIFICATION_TOKEN_HOURS,
        }),
      'email verification',
    );
    return { message: VERIFICATION_EMAIL_SENT_MESSAGE };
  }

  /**
   * ACC-07, POST /api/auth/forgot-password: always the same answer, at once.
   * The lookup, the token and the email run in the background after it, so
   * neither the body, the status nor the time of the answer depends on
   * whether an account has this email. When email is switched off nothing is
   * started at all. At most MAX_PENDING_PASSWORD_RESETS requests are worked
   * on at once; past that a request gets the same answer and is dropped.
   */
  forgotPassword(email: string): PasswordResetRequestedResponseDto {
    if (
      this.email.enabled &&
      this.pendingPasswordResets < MAX_PENDING_PASSWORD_RESETS
    ) {
      this.pendingPasswordResets++;
      this.email.runInBackground(async () => {
        try {
          await this.sendResetLink(email);
        } finally {
          this.pendingPasswordResets--;
        }
      }, 'password reset');
    }
    return { message: PASSWORD_RESET_REQUESTED_MESSAGE };
  }

  /**
   * ACC-07, POST /api/auth/reset-password: the DTO has already checked the
   * new password, so a password that breaks the rule never uses up the link.
   * The token is consumed in one atomic step, so it works once. The password
   * is then stored only if the account is still an active registered user;
   * an unknown, expired, used or replaced token, or an account that is no
   * longer active, all get the same 400. The lockout and the temporary
   * password are cleared, the email counts as verified (the link reached
   * it), and every session of the account ends: whoever held one must log in
   * with the new password. Nobody is logged in here.
   */
  async resetPassword(
    dto: ResetForgottenPasswordDto,
  ): Promise<PasswordResetDoneResponseDto> {
    const userId = await this.tokenStore.consume(
      dto.token,
      AuthTokenType.PasswordReset,
    );
    if (!userId) {
      throw new BadRequestException(INVALID_RESET_LINK_MESSAGE);
    }
    const updated = await this.usersService.resetForgottenPassword(
      userId,
      dto.newPassword,
    );
    if (!updated) {
      throw new BadRequestException(INVALID_RESET_LINK_MESSAGE);
    }
    try {
      await this.sessions.revokeAllOfUser(userId.toString(), new Date());
    } catch (error) {
      // The new password is stored and the link is used up; the old
      // sessions could not be ended. A new reset link ends them.
      this.logger.error(
        `The sessions of account ${userId.toString()} were not ended after its password reset`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
    return { message: PASSWORD_RESET_DONE_MESSAGE };
  }

  /**
   * ACC-07: in the background of a forgot-password request. Only an active
   * account with the role `user` gets a link: moderators and administrators
   * keep the admin reset (ACC-07a), and a suspended or deactivated account
   * gets nothing. The new token replaces the account's older one, so the
   * older link stops working.
   */
  private async sendResetLink(email: string): Promise<void> {
    const user = await this.usersService.findEntityByEmail(email);
    if (!user || user.role !== Role.User || user.status !== UserStatus.Active) {
      return;
    }
    const token = await this.tokenStore.issue(
      user._id,
      AuthTokenType.PasswordReset,
      PASSWORD_RESET_TOKEN_MS,
    );
    await this.email.sendPasswordReset({
      name: user.name,
      email: user.email,
      token,
      expiresInMinutes: PASSWORD_RESET_TOKEN_MINUTES,
    });
  }

  /** ACC-02: creates the verification token of a new account and emails its link. */
  private async sendVerificationLink(recipient: {
    id: Types.ObjectId;
    name: string;
    email: string;
  }): Promise<void> {
    const token = await this.tokenStore.issue(
      recipient.id,
      AuthTokenType.EmailVerification,
      EMAIL_VERIFICATION_TOKEN_MS,
    );
    await this.email.sendEmailVerification({
      name: recipient.name,
      email: recipient.email,
      token,
      expiresInHours: EMAIL_VERIFICATION_TOKEN_HOURS,
    });
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
    accessToken: string | undefined,
    dto: ChangePasswordDto,
  ): Promise<UserResponseDto> {
    // The session that makes the change, read as logout reads it. It is the
    // one that stays logged in. The guard has already checked this cookie, so
    // claims that cannot be read, or that name another user, mean the request
    // is not what it seems: nothing is changed.
    const current = accessToken
      ? await this.tokens.readClaims(accessToken, 'access')
      : null;
    if (!current || current.userId !== userId) {
      throw new UnauthorizedException(LOGIN_REQUIRED_MESSAGE);
    }

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
    // After the password, so a failure here never leaves the old password in
    // place. Someone who stole another session of this account loses it.
    await this.sessions.revokeAllOfUser(userId, new Date(), current.sessionId);
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
