/** The answer when an admin route names an account that does not exist. */
export const ACCOUNT_NOT_FOUND_MESSAGE = 'Account not found';

/**
 * The answer when an admin tries to reset the password of an administrator
 * (ACC-07a). The requirement covers users and moderators only; admin accounts
 * are seeded and managed outside the API.
 */
export const ADMIN_PASSWORD_RESET_FORBIDDEN_MESSAGE =
  'The password of an administrator cannot be reset here';
