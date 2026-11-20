import { Role } from '../common/enums/role.enum';
import {
  MODERATOR_INVITATION_SUBJECT,
  MODERATOR_ROLE_NAMES,
  NOTIFICATION_EMAIL_SUBJECTS,
} from './email.constants';
import type { NotificationType } from './enums/notification-type.enum';

/** The subject and the plain-text body of one email. */
export interface EmailContent {
  subject: string;
  text: string;
}

/**
 * GEN-01-B: the email of an in-app notification. The subject is fixed for the
 * type; the body greets the user, repeats the notification text and asks them
 * to log in to see the details. Plain text only, no HTML and no deep link.
 */
export function notificationEmail(
  type: NotificationType,
  name: string,
  message: string,
  loginUrl: string,
): EmailContent {
  return {
    subject: NOTIFICATION_EMAIL_SUBJECTS[type],
    text: [
      `Hello ${name},`,
      '',
      message,
      '',
      `Log in at ${loginUrl} to see the details.`,
      '',
      'Travel Platform',
    ].join('\n'),
  };
}

/** Who a moderator invitation is for. */
export interface InvitedModerator {
  name: string;
  email: string;
  role: Role.HotelModerator | Role.AirlineModerator;
}

/**
 * ACC-13, GEN-01-B: the invitation a new moderator gets: their name, their
 * role, where to log in, and that they sign in with the temporary password
 * the administrator gave them and must change it at the first login. It never
 * holds the password: this function is not even given it.
 */
export function moderatorInvitationEmail(
  moderator: Pick<InvitedModerator, 'name' | 'role'>,
  loginUrl: string,
): EmailContent {
  return {
    subject: MODERATOR_INVITATION_SUBJECT,
    text: [
      `Hello ${moderator.name},`,
      '',
      `An administrator created ${MODERATOR_ROLE_NAMES[moderator.role]} account for you on the Travel Platform.`,
      '',
      `Log in at ${loginUrl} with this email address and the temporary password the administrator gave you.`,
      'You must change that password at your first login.',
      '',
      'Travel Platform',
    ].join('\n'),
  };
}
