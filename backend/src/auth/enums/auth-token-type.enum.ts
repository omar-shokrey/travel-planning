/**
 * ACC-02, ACC-07: what a one-time token of `auth_tokens` is for. A user has at
 * most one live token of each type.
 */
export enum AuthTokenType {
  EmailVerification = 'email_verification',
  PasswordReset = 'password_reset',
}
