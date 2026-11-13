import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opens a route to guests. Every other route requires a logged-in user, so
 * forgetting this decorator makes a route private, never public by accident.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
