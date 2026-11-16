import type { ProviderType } from '../common/enums/provider-type.enum';

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

/** ACC-16: suspending an account that is already suspended. */
export const ACCOUNT_ALREADY_SUSPENDED_MESSAGE =
  'The account is already suspended';

/** ACC-16: reactivating an account that is not suspended. */
export const ACCOUNT_NOT_SUSPENDED_MESSAGE = 'The account is not suspended';

/**
 * ACC-16: a deactivated account was closed by its owner (ACC-12). It is not
 * suspended or reactivated by an admin.
 */
export const ACCOUNT_DEACTIVATED_MESSAGE =
  'A deactivated account cannot be suspended or reactivated';

/** ACC-16: the status of an administrator is not changed here. */
export const ADMIN_STATUS_FORBIDDEN_MESSAGE =
  'An administrator account cannot be suspended or reactivated';

/**
 * ACC-16 / GEN-01: the in-app notification of a suspended account, user or
 * moderator (ACC-15). The account cannot log in while suspended, so it is
 * read after the reactivation.
 */
export const ACCOUNT_SUSPENDED_NOTIFICATION =
  'Your account was suspended by an administrator.';

/** ACC-16: another request changed the status between the check and the update. */
export const ACCOUNT_STATUS_CHANGED_MESSAGE =
  'The account status was changed by another request. Reload it and try again';

/** ACC-15: `:type` of the provider routes is not `hotel` or `airline`. */
export const PROVIDER_TYPE_MESSAGE = 'type must be one of: hotel, airline';

/** ACC-15: deactivating a hotel or airline that is already deactivated. */
export const PROVIDER_ALREADY_DEACTIVATED_MESSAGE =
  'The provider is already deactivated';

/** ACC-15: reactivating a hotel or airline that is active. */
export const PROVIDER_NOT_DEACTIVATED_MESSAGE =
  'The provider is not deactivated';

/** ACC-15: another request changed the provider between the check and the update. */
export const PROVIDER_STATUS_CHANGED_MESSAGE =
  'The provider status was changed by another request. Reload it and try again';

/**
 * ACC-15: the in-app notification the moderators of a deactivated hotel or
 * airline get.
 */
export function providerDeactivatedNotification(
  type: ProviderType,
  name: string,
): string {
  return `Your ${type} "${name}" was deactivated by an administrator. It is hidden from search and cannot be booked until it is reactivated. Existing confirmed bookings remain valid.`;
}
