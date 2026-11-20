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

/**
 * ACC-12: the deactivation of your own account is refused while you have a
 * confirmed flight booking or hotel reservation. A booking that is still
 * confirmed is not over yet: GEN-11 completes it once the trip ends.
 */
export const ACCOUNT_HAS_CONFIRMED_BOOKINGS_MESSAGE =
  'You have upcoming confirmed bookings. Cancel them or wait until the trips are over, then deactivate your account';

/**
 * ACC-12: the deactivation is refused while a booking waits for payment and
 * its hold has not ended, because a payment inside the hold would confirm a
 * booking of an account that can no longer log in.
 */
export const ACCOUNT_HAS_UNPAID_BOOKING_MESSAGE =
  'You have a booking waiting for payment. Pay it, or wait until its hold ends, then deactivate your account';

/**
 * ACC-12: the account was no longer active when the deactivation was saved,
 * for example an admin suspended it at the same moment.
 */
export const ACCOUNT_CHANGED_MESSAGE =
  'Your account was changed by another request. Please try again';

/**
 * ACC-02: how long an email verification link works, in hours. The workbook
 * gives no lifetime; a day lets the user open the email later.
 */
export const EMAIL_VERIFICATION_TOKEN_HOURS = 24;

/**
 * ACC-02: the longest verification token the route reads. A real one has 43
 * characters (32 random bytes in base64url); anything far longer is refused
 * as a bad request without a database lookup.
 */
export const VERIFICATION_TOKEN_MAX_LENGTH = 128;

/** ACC-02: the answer of a route that books while the email is not verified. */
export const EMAIL_NOT_VERIFIED_MESSAGE =
  'Verify your email address before booking';

/**
 * ACC-02: the one answer of a verification link that does not work: unknown,
 * expired, already used or replaced by a newer one. It never says which.
 */
export const INVALID_VERIFICATION_LINK_MESSAGE =
  'The verification link is invalid or has expired';

/** ACC-02: a new verification link asked for by an account that is already verified. */
export const EMAIL_ALREADY_VERIFIED_MESSAGE =
  'Your email address is already verified';

/** ACC-02: a new verification link asked for while the API sends no email (SMTP_HOST is empty). */
export const EMAIL_SWITCHED_OFF_MESSAGE =
  'Email is switched off on this server, so no verification link can be sent';

/** ACC-02: the answer of a new verification link. The email goes out after the answer. */
export const VERIFICATION_EMAIL_SENT_MESSAGE =
  'A new verification link is on its way to your email address';

/**
 * ACC-02: a new verification link can be asked for once a minute. Otherwise
 * anyone who registered with someone else's address could flood that inbox
 * by calling the route in a loop.
 */
export const VERIFICATION_RESEND_INTERVAL_SECONDS = 60;

/** ACC-02: the answer of a new verification link asked for within the minute. */
export const VERIFICATION_RESEND_TOO_SOON_MESSAGE =
  'A verification link was sent less than a minute ago. Check your inbox, or try again in a minute';
