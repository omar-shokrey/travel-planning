/** The answer when an admin route names an account that does not exist. */
export const ACCOUNT_NOT_FOUND_MESSAGE = 'Account not found';

/**
 * The answer when an admin tries to reset the password of an administrator
 * (ACC-07a). The requirement covers users and moderators only; admin accounts
 * are seeded and managed outside the API.
 */
export const ADMIN_PASSWORD_RESET_FORBIDDEN_MESSAGE =
  'The password of an administrator cannot be reset here';

/**
 * The longest search text of the account list (ACC-14). A name has at most
 * 100 characters (`USER_NAME_MAX_LENGTH`); an email can be longer, so 254, the
 * longest email address.
 */
export const ACCOUNT_SEARCH_MAX_LENGTH = 254;

/**
 * The answer when the provider of a new moderator does not exist (ACC-13),
 * by provider type. It is a 400 on `providerId`, because the id is part of
 * the body the admin sent.
 */
export const PROVIDER_NOT_FOUND_MESSAGE = {
  airline: 'providerId must be the id of an existing airline',
  hotel: 'providerId must be the id of an existing hotel',
} as const;
