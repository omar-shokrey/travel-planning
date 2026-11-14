import type { Types } from 'mongoose';
import type { UserResponseDto } from '../dto/user-response.dto';
import type { User } from '../models/user.schema';

/** The fields the mapper reads. A user document and a lean user both fit. */
export type UserSource = Pick<
  User,
  'name' | 'email' | 'role' | 'status' | 'createdAt'
> & { _id: Types.ObjectId };

/** Turns a stored user into what the API returns. Anything not listed here stays private. */
export function toUserResponse(user: UserSource): UserResponseDto {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}
