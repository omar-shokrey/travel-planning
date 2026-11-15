import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { hash } from 'bcrypt';
import { isValidObjectId, type Model, type Types } from 'mongoose';
import { PASSWORD_SALT_ROUNDS } from '../common/constants/password';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import { User, type UserDocument } from './models/user.schema';

export const EMAIL_TAKEN_MESSAGE = 'This email is already registered';

/** What a caller gives to create a registered user. It cannot choose the role or the status. */
export interface CreateUserInput {
  name: string;
  email: string;
  /** The plain password. It is hashed here and never stored or logged. */
  password: string;
  /** When the user accepted the terms and the privacy policy. */
  consentAcceptedAt: Date;
}

/** When a run of failed logins locks an account (ACC-05). */
export interface LockoutPolicy {
  /** The number of failed logins in a row that locks the account. */
  maxAttempts: number;
  /** How long the lock lasts, in milliseconds. */
  lockMs: number;
}

/**
 * Owns the `users` collection. Other modules go through this service and never
 * write to the collection themselves.
 */
@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  /**
   * Creates an active account with the `user` role (ACC-01). It returns the
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
    });
  }

  /**
   * Finds an account by email for the login check (ACC-04). It is the only
   * lookup that reads `passwordHash`, which the schema hides by default. The
   * entity is for the auth service: it never leaves the API.
   */
  findEntityByEmailWithPasswordHash(
    email: string,
  ): Promise<UserDocument | null> {
    return this.users
      .findOne({ email: email.trim().toLowerCase() })
      .select('+passwordHash')
      .exec();
  }

  /** Finds an account by id, without the password hash. `null` when there is none. */
  findEntityById(id: string): Promise<UserDocument | null> {
    if (!isValidObjectId(id)) {
      return Promise.resolve(null);
    }
    return this.users.findById(id).exec();
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
}
