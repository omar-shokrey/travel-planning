import { SetMetadata } from '@nestjs/common';

export const ALLOW_TEMPORARY_PASSWORD_KEY = 'allowTemporaryPassword';

/**
 * ACC-13, ACC-07a: lets an account that still has a temporary password
 * (`mustChangePassword: true`) use this route. Every other route that needs a
 * login answers it 403 (`JwtAuthGuard`). Only two routes carry it:
 * `PATCH /api/auth/change-password`, the way out, and `GET /api/auth/me`,
 * which the frontend needs to learn who is logged in. It can be set on a
 * handler or on a controller; it changes nothing for a `@Public()` route.
 */
export const AllowTemporaryPassword = () =>
  SetMetadata(ALLOW_TEMPORARY_PASSWORD_KEY, true);
