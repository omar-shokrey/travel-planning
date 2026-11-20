import { Role } from '../common/enums/role.enum';
import { NotificationType } from './enums/notification-type.enum';

/**
 * GEN-01-B: the injection token of the mail transport. It is the nodemailer
 * transporter built from the SMTP_* settings, or null when SMTP_HOST is empty
 * (email switched off). The end-to-end tests replace it with a fake that
 * collects the messages, so no test ever reaches an SMTP server.
 */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/**
 * How long one SMTP step may take, in milliseconds: opening the connection,
 * waiting for the server's greeting, and any silence on the socket. A slow or
 * dead server then fails one email in seconds instead of minutes.
 */
export const SMTP_TIMEOUT_MS = 5_000;

/** At most this many emails are being sent at the same moment, across the whole app. */
export const MAX_EMAILS_IN_FLIGHT = 5;

/**
 * The fixed subject of each notification email. The subject never holds
 * text a user wrote (a name, a hotel name), so nothing can add a mail header.
 */
export const NOTIFICATION_EMAIL_SUBJECTS: Readonly<
  Record<NotificationType, string>
> = {
  [NotificationType.BookingConfirmed]: 'Your booking is confirmed',
  [NotificationType.BookingCancelled]: 'Your booking is cancelled',
  [NotificationType.Refund]: 'An update on your refund',
  [NotificationType.FlightChanged]: 'Your flight has changed',
  [NotificationType.AccountSuspended]: 'Your account is suspended',
  [NotificationType.ProviderDeactivated]:
    'A hotel or airline you are linked to was deactivated',
};

/** The subject of the invitation a new moderator gets (ACC-13). */
export const MODERATOR_INVITATION_SUBJECT =
  'Your moderator account on the Travel Platform';

/** The roles a moderator invitation names, in words, with their article. */
export const MODERATOR_ROLE_NAMES: Readonly<
  Record<Role.HotelModerator | Role.AirlineModerator, string>
> = {
  [Role.HotelModerator]: 'a hotel moderator',
  [Role.AirlineModerator]: 'an airline moderator',
};

/** ACC-02: the subject of the email with the verification link. */
export const EMAIL_VERIFICATION_SUBJECT = 'Verify your email address';

/** ACC-07: the subject of the email with the password reset link. */
export const PASSWORD_RESET_SUBJECT = 'Reset your password';
