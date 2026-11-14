/**
 * The longest password the API accepts. bcrypt reads only the first 72 bytes
 * of a password, so a longer one would be cut without the user knowing.
 */
export const PASSWORD_MAX_LENGTH = 72;

/** Shown under the consent checkbox when it is not ticked (ACC-01). */
export const CONSENT_REQUIRED_MESSAGE =
  'acceptedTerms must be true: accept the terms and the privacy policy to register';
