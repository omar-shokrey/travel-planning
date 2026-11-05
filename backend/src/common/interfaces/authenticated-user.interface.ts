import type { Request } from 'express';
import type { Role } from '../enums/role.enum';

/** The logged-in user. The authentication guard (ACC-04) attaches it to the request. */
export interface AuthenticatedUser {
  id: string;
  role: Role;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
