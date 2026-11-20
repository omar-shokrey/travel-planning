import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { hash } from 'bcrypt';
import {
  isValidObjectId,
  type Model,
  type QueryFilter,
  type Types,
} from 'mongoose';
import { PASSWORD_SALT_ROUNDS } from '../common/constants/password';
import { ProviderType } from '../common/enums/provider-type.enum';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import { User, type UserDocument } from './models/user.schema';

export const EMAIL_TAKEN_MESSAGE = 'This email is already registered';

/** What the admin account list (ACC-14) may filter on. Every field is optional. */
export interface AccountListCriteria {
  /** Part of the name or the email, in any letter case. Plain text, not a pattern. */
  search?: string;
  role?: Role;
  status?: UserStatus;
}

/** Escapes the characters a regular expression gives a meaning to, so a search is plain text. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** What a caller gives to create a registered user. It cannot choose the role or the status. */
export interface CreateUserInput {
  name: string;
  email: string;
  /** The plain password. It is hashed here and never stored or logged. */
  password: string;
  /** When the user accepted the terms and the privacy policy. */
  consentAcceptedAt: Date;
  /**
   * ACC-02: false when the email must be verified before booking. Left out,
   * the account is verified.
   */
  emailVerified?: boolean;
}

/**
 * What the admin gives to create a moderator account (ACC-13). The status and
 * the password-change flag are not here: every moderator starts active and
 * must change the temporary password.
 */
export interface CreateModeratorInput {
  name: string;
  email: string;
  /** The temporary password. It is hashed here and never stored or logged. */
  password: string;
  role: Role.AirlineModerator | Role.HotelModerator;
  providerType: ProviderType;
  providerId: Types.ObjectId;
}

/** When a run of failed logins locks an account (ACC-05). */
export interface LockoutPolicy {
  /** The number of failed logins in a row that locks the account. */
  maxAttempts: number;
  /** How long the lock lasts, in milliseconds. */
  lockMs: number;
}

/**
 * The profile fields of ACC-09. `undefined` keeps a field, `null` removes the
 * phone or the preferred currency. The name can be changed, never removed.
 */
export interface ProfileChanges {
  name?: string;
  phone?: string | null;
  preferredCurrency?: string | null;
}

/**
 * Owns the `users` collection. Other modules go through this service and never
 * write to the collection themselves.
 */
@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  /**
   * Creates an active account with the `user` role (ACC-01), verified unless
   * `emailVerified` is false (ACC-02). It returns the
   * entity, for other services: map it with `toUserResponse` before it leaves
   * the API.
   */
  async createRegisteredUser(input: CreateUserInput): Promise<UserDocument> {
    const email = input.email.trim().toLowerCase();
    if (await this.users.exists({ email })) {
      throw new ConflictException(EMAIL_TAKEN_MESSAGE);
    }

    const passwordHash = await hash(input.password, PASSWORD_SALT_ROUNDS);
    // Two requests with the same new email can both pass the check above. The
    // unique index then rejects the second one, and the exception filter
    // answers it with 409 as well.
    return this.users.create({
      name: input.name,
      email,
      passwordHash,
      role: Role.User,
      status: UserStatus.Active,
      consentAcceptedAt: input.consentAcceptedAt,
      emailVerified: input.emailVerified ?? true,
    });
  }

  /**
   * Creates a moderator account linked to exactly one airline or hotel
   * (ACC-13). It starts active, with `mustChangePassword` set, so the
   * moderator replaces the temporary password at the first login (ACC-08).
   * The caller has checked that the provider exists.
   */
  async createModerator(input: CreateModeratorInput): Promise<UserDocument> {
    const email = input.email.trim().toLowerCase();
    if (await this.users.exists({ email })) {
      throw new ConflictException(EMAIL_TAKEN_MESSAGE);
    }

    const passwordHash = await hash(input.password, PASSWORD_SALT_ROUNDS);
    // As in createRegisteredUser, the unique index on `email` catches two
    // requests that pass the check at the same moment (409 via the filter).
    return this.users.create({
      name: input.name,
      email,
      passwordHash,
      role: input.role,
      status: UserStatus.Active,
      mustChangePassword: true,
      assignment: {
        providerType: input.providerType,
        providerId: input.providerId,
      },
    });
  }

  /**
   * Moves an account from one status to another (ACC-16), only if it still
   * has the `from` status: two admins acting at the same moment cannot both
   * win, and the loser gets `null`. It returns the account after the change.
   */
  changeStatus(
    id: Types.ObjectId,
    from: UserStatus,
    to: UserStatus,
  ): Promise<UserDocument | null> {
    return this.users
      .findOneAndUpdate(
        { _id: id, status: from },
        { $set: { status: to } },
        { returnDocument: 'after' },
      )
      .exec();
  }

  /**
   * ACC-12: the user closes their own account. One conditional update that
   * matches only an active account with the `user` role, so an account an
   * admin suspended in the meantime, or one already deactivated, is left
   * alone and the caller gets `null`. It sets the status and `deactivatedAt`
   * together and returns the account after the change. The checks before it
   * (password, bookings) are made by the auth module.
   */
  deactivateOwnAccount(
    id: Types.ObjectId,
    now: Date,
  ): Promise<UserDocument | null> {
    return this.users
      .findOneAndUpdate(
        { _id: id, role: Role.User, status: UserStatus.Active },
        { $set: { status: UserStatus.Deactivated, deactivatedAt: now } },
        { returnDocument: 'after' },
      )
      .exec();
  }

  /**
   * Finds an account by email with its password hash, for the login check
   * (ACC-04); the schema hides `passwordHash` by default. The entity is for
   * the auth service: it never leaves the API.
   */
  findEntityByEmailWithPasswordHash(
    email: string,
  ): Promise<UserDocument | null> {
    return this.users
      .findOne({ email: email.trim().toLowerCase() })
      .select('+passwordHash')
      .exec();
  }

  /**
   * ACC-07: finds an account by email, without the password hash, for the
   * forgot-password request. The email is trimmed and lowercased as at
   * login. `null` when there is none.
   */
  findEntityByEmail(email: string): Promise<UserDocument | null> {
    return this.users.findOne({ email: email.trim().toLowerCase() }).exec();
  }

  /** Finds an account by id, without the password hash. `null` when there is none. */
  findEntityById(id: string): Promise<UserDocument | null> {
    if (!isValidObjectId(id)) {
      return Promise.resolve(null);
    }
    return this.users.findById(id).exec();
  }

  /**
   * Saves the profile fields of an account in one update (ACC-09), so either
   * every change is saved or none is. A field given as `null` is removed. It
   * returns the account after the change, or `null` when there is none.
   */
  updateProfile(
    id: string,
    changes: ProfileChanges,
  ): Promise<UserDocument | null> {
    if (!isValidObjectId(id)) {
      return Promise.resolve(null);
    }
    const $set: Record<string, string> = {};
    const $unset: Record<string, 1> = {};
    for (const [field, value] of Object.entries(changes)) {
      if (value === null) {
        $unset[field] = 1;
      } else if (value !== undefined) {
        $set[field] = value as string;
      }
    }
    if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
      return this.users.findById(id).exec();
    }
    return this.users
      .findByIdAndUpdate(
        id,
        {
          ...(Object.keys($set).length > 0 && { $set }),
          ...(Object.keys($unset).length > 0 && { $unset }),
        },
        { returnDocument: 'after', runValidators: true },
      )
      .exec();
  }

  /**
   * ACC-02: marks the email of the account as verified. Returns false when
   * the account no longer exists.
   */
  async markEmailVerified(id: Types.ObjectId): Promise<boolean> {
    const { matchedCount } = await this.users
      .updateOne({ _id: id }, { $set: { emailVerified: true } })
      .exec();
    return matchedCount > 0;
  }

  /**
   * Finds an account by id with its password hash, for the password change
   * (ACC-08). The entity is for the auth service: it never leaves the API.
   */
  findEntityByIdWithPasswordHash(id: string): Promise<UserDocument | null> {
    if (!isValidObjectId(id)) {
      return Promise.resolve(null);
    }
    return this.users.findById(id).select('+passwordHash').exec();
  }

  /**
   * Replaces the password of an account and clears `mustChangePassword`, so
   * an account that had a temporary password (ACC-07a, ACC-13) is done with
   * it (ACC-08). The plain password is hashed here and never stored. It
   * returns the updated account, or `null` when it is gone.
   */
  async updatePassword(
    id: Types.ObjectId,
    password: string,
  ): Promise<UserDocument | null> {
    const passwordHash = await hash(password, PASSWORD_SALT_ROUNDS);
    return this.users
      .findByIdAndUpdate(
        id,
        { $set: { passwordHash, mustChangePassword: false } },
        { returnDocument: 'after' },
      )
      .exec();
  }

  /**
   * One page of accounts for the admin list (ACC-14), newest first, and the
   * number of accounts that match. The search matches part of the name or
   * the email, ignoring letter case. The entities are for the admin service,
   * which maps them; the password hash is never read.
   */
  async listAccounts(
    criteria: AccountListCriteria,
    page: { skip: number; limit: number },
  ): Promise<{ items: UserDocument[]; total: number }> {
    const filter: QueryFilter<User> = {
      ...(criteria.role && { role: criteria.role }),
      ...(criteria.status && { status: criteria.status }),
    };
    if (criteria.search) {
      // The `$regex` string form, not a RegExp object: in our e2e runs against
      // Atlas, a count with RegExp objects and the `i` flag inside `$or` never
      // got an answer, while this equivalent form always did.
      const pattern = { $regex: escapeRegExp(criteria.search), $options: 'i' };
      filter.$or = [{ name: pattern }, { email: pattern }];
    }

    const [items, total] = await Promise.all([
      this.users
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(page.skip)
        .limit(page.limit)
        .exec(),
      this.users.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  /**
   * Gives an account a temporary password chosen by an admin (ACC-07a). The
   * plain password is hashed here and never stored. `mustChangePassword` is
   * set so the owner must choose a new one at the next login, and the login
   * lockout (ACC-05) is cleared so the temporary password works at once. One
   * update, so no other write can slip in between. It returns the updated
   * account, or `null` when it is gone.
   */
  async setTemporaryPassword(
    id: Types.ObjectId,
    password: string,
  ): Promise<UserDocument | null> {
    const passwordHash = await hash(password, PASSWORD_SALT_ROUNDS);
    return this.users
      .findByIdAndUpdate(
        id,
        {
          $set: {
            passwordHash,
            mustChangePassword: true,
            failedLoginAttempts: 0,
          },
          $unset: { lockedUntil: 1 },
        },
        { returnDocument: 'after' },
      )
      .exec();
  }

  /**
   * ACC-07: the new password of a reset by email. In one update, and only
   * while the account is an active registered user: it stores the hash,
   * clears `mustChangePassword` and the login lockout (ACC-05), so a locked
   * account is opened by its own reset, and marks the email verified
   * (ACC-02): the link reached that mailbox. The plain password is hashed
   * here and never stored. Returns `null` when no such active account exists.
   */
  async resetForgottenPassword(
    id: Types.ObjectId,
    password: string,
  ): Promise<UserDocument | null> {
    const passwordHash = await hash(password, PASSWORD_SALT_ROUNDS);
    return this.users
      .findOneAndUpdate(
        { _id: id, role: Role.User, status: UserStatus.Active },
        {
          $set: {
            passwordHash,
            mustChangePassword: false,
            failedLoginAttempts: 0,
            emailVerified: true,
          },
          $unset: { lockedUntil: 1 },
        },
        { returnDocument: 'after' },
      )
      .exec();
  }

  /**
   * Counts one failed login of the account (ACC-05). It returns the time the
   * account is locked until when this failure reached the limit, and `null`
   * while the account is still open.
   *
   * The count is one atomic `$inc`, so requests that fail at the same moment
   * cannot count the same number twice and slip past the limit. Only the
   * first failure over the limit sets the lock: the others find it already
   * set, so a second request cannot push the end of the lock back.
   */
  async recordFailedLogin(
    id: Types.ObjectId,
    policy: LockoutPolicy,
    now: Date,
  ): Promise<Date | null> {
    const counted = await this.users
      .findByIdAndUpdate(
        id,
        { $inc: { failedLoginAttempts: 1 } },
        { returnDocument: 'after' },
      )
      .select('failedLoginAttempts')
      .exec();
    if (!counted || counted.failedLoginAttempts < policy.maxAttempts) {
      return null;
    }

    const lockedUntil = new Date(now.getTime() + policy.lockMs);
    await this.users
      .updateOne(
        {
          _id: id,
          $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
        },
        { $set: { lockedUntil } },
      )
      .exec();
    return lockedUntil;
  }

  /**
   * Opens an account whose lock has run out, and starts its count again, so
   * the user has the full number of attempts after the lock (ACC-05). It does
   * nothing for an account that is not locked or is still locked.
   */
  async clearExpiredLock(id: Types.ObjectId, now: Date): Promise<void> {
    await this.users
      .updateOne(
        { _id: id, lockedUntil: { $lte: now } },
        { $set: { failedLoginAttempts: 0 }, $unset: { lockedUntil: 1 } },
      )
      .exec();
  }

  /**
   * Forgets the failed logins of the account after a successful login
   * (ACC-05). An account with nothing to forget is not written to, which is
   * the case of almost every login.
   */
  async resetFailedLogins(id: Types.ObjectId): Promise<void> {
    await this.users
      .updateOne(
        {
          _id: id,
          $or: [
            { failedLoginAttempts: { $gt: 0 } },
            { lockedUntil: { $ne: null } },
          ],
        },
        { $set: { failedLoginAttempts: 0 }, $unset: { lockedUntil: 1 } },
      )
      .exec();
  }

  /**
   * The ids of the moderators assigned to one hotel or airline, for the
   * notification of a deactivated provider (ACC-15). Accounts closed by their
   * owner (ACC-12) are left out. Uses the index on `assignment.providerId`.
   */
  async findModeratorIdsOfProvider(
    providerType: ProviderType,
    providerId: Types.ObjectId,
  ): Promise<Types.ObjectId[]> {
    const moderators = await this.users
      .find({
        'assignment.providerId': providerId,
        'assignment.providerType': providerType,
        status: { $ne: UserStatus.Deactivated },
      })
      .select('_id')
      .lean()
      .exec();
    return moderators.map((moderator) => moderator._id);
  }

  /**
   * The names that may be shown for these accounts, read in one query:
   * account id (as a string) to name. A missing or deactivated account (ACC-12)
   * is not in the map, so the caller shows "Deleted user" for it. A suspended
   * account keeps its name. Reads only `name`. Used by the public reviews of a
   * hotel (HTL-24).
   */
  async findNamesByIds(
    ids: readonly Types.ObjectId[],
  ): Promise<Map<string, string>> {
    const unique = [...new Map(ids.map((id) => [id.toString(), id])).values()];
    if (unique.length === 0) return new Map();
    const accounts = await this.users
      .find({ _id: { $in: unique }, status: { $ne: UserStatus.Deactivated } })
      .select('name')
      .lean<{ _id: Types.ObjectId; name: string }[]>()
      .exec();
    return new Map(
      accounts.map((account) => [account._id.toString(), account.name]),
    );
  }
}
