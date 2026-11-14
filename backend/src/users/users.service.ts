import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { hash } from 'bcrypt';
import type { Model } from 'mongoose';
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
}
