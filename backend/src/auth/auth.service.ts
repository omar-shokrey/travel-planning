import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { compare, hash } from 'bcrypt';
import { PASSWORD_SALT_ROUNDS } from '../common/constants/password';
import { UserStatus } from '../common/enums/user-status.enum';
import type { UserResponseDto } from '../users/dto/user-response.dto';
import { toUserResponse } from '../users/mappers/user.mapper';
import { UsersService } from '../users/users.service';
import type { AuthTokens } from './auth-cookies.service';
import { AuthTokensService } from './auth-tokens.service';
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  LOGIN_REQUIRED_MESSAGE,
} from './auth.constants';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

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
   * Checks the email and the password and issues the tokens (ACC-04).
   *
   * An unknown email, a wrong password and a deactivated account (ACC-12) all
   * get the same answer, so nobody can find out which emails are registered.
   * The suspension is told only after the password is right, so it is not
   * shown to someone who does not know it.
   */
  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.usersService.findEntityByEmailWithPasswordHash(
      dto.email,
    );
    const passwordHash =
      user?.passwordHash ?? (await this.getUnknownEmailHash());
    const passwordMatches = await compare(dto.password, passwordHash);
    if (!user || !passwordMatches || user.status === UserStatus.Deactivated) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    if (user.status === UserStatus.Suspended) {
      throw new ForbiddenException(ACCOUNT_SUSPENDED_MESSAGE);
    }

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

  private getUnknownEmailHash(): Promise<string> {
    this.unknownEmailHash ??= hash(
      'a password that no account has',
      PASSWORD_SALT_ROUNDS,
    );
    return this.unknownEmailHash;
  }
}
