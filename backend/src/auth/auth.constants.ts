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

/** The answer of any route that needs a logged-in user. It matches the one of RolesGuard. */
export const LOGIN_REQUIRED_MESSAGE = 'You must log in to do this';
