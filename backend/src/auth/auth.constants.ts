/**
 * The longest password the API accepts. bcrypt reads only the first 72 bytes
 * of a password, so a longer one would be cut without the user knowing.
 */
export const PASSWORD_MAX_LENGTH = 72;

/** Shown under the consent checkbox when it is not ticked (ACC-01). */
export const CONSENT_REQUIRED_MESSAGE =
  'acceptedTerms must be true: accept the terms and the privacy policy to register';

/**
 * The only message a failed login gives (ACC-04). It is the same for an
 * unknown email and a wrong password, so it never tells which one failed.
 */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

/** Shown to a suspended account that logs in with the right password (ACC-04). */
export const ACCOUNT_SUSPENDED_MESSAGE = 'Your account is suspended';

/** The answer of a password change whose current password is wrong (ACC-08). */
export const CURRENT_PASSWORD_INCORRECT_MESSAGE =
  'The current password is incorrect';

/** The answer of a password change that keeps the same password (ACC-08). */
export const SAME_PASSWORD_MESSAGE =
  'The new password must be different from the current password';

/**
 * The answer of every route but `GET /api/auth/me` and
 * `PATCH /api/auth/change-password` while the account still has a temporary
 * password set by an admin (ACC-13, ACC-07a). It is a 403, not a 401: the
 * caller is logged in. The suspended account's 403 has its own message.
 */
export const PASSWORD_CHANGE_REQUIRED_MESSAGE =
  'You must change your temporary password first';

/** The answer of any route that needs a logged-in user. It matches the one of RolesGuard. */
export const LOGIN_REQUIRED_MESSAGE = 'You must log in to do this';

/** How many failed logins in a row lock an account (ACC-05). */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;

/** How long a locked account stays locked, in minutes (ACC-05). */
export const LOCKOUT_MINUTES = 15;

/**
 * The answer of a login to a locked account (ACC-05), with the time that is
 * left, rounded up to whole minutes so the user never tries too early. It is
 * the same whether or not the password that was sent is right, so it says
 * nothing about the password.
 */
export function accountLockedMessage(minutesLeft: number): string {
  const unit = minutesLeft === 1 ? 'minute' : 'minutes';
  return `Too many failed login attempts. Your account is locked. Try again in ${minutesLeft} ${unit}.`;
}
