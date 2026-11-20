import { Role } from '../common/enums/role.enum';
import {
  MODERATOR_INVITATION_SUBJECT,
  NOTIFICATION_EMAIL_SUBJECTS,
} from './email.constants';
import { moderatorInvitationEmail, notificationEmail } from './email-templates';
import { NotificationType } from './enums/notification-type.enum';

const LOGIN_URL = 'http://localhost:3000';

describe('NOTIFICATION_EMAIL_SUBJECTS (GEN-01-B)', () => {
  it('has a subject for every notification type', () => {
    for (const type of Object.values(NotificationType)) {
      expect(NOTIFICATION_EMAIL_SUBJECTS[type]).toMatch(/\S/);
    }
    expect(Object.keys(NOTIFICATION_EMAIL_SUBJECTS).sort()).toEqual(
      Object.values(NotificationType).sort(),
    );
  });

  it('has no line break in any subject, so none can add a mail header', () => {
    for (const subject of [
      ...Object.values(NOTIFICATION_EMAIL_SUBJECTS),
      MODERATOR_INVITATION_SUBJECT,
    ]) {
      expect(subject).not.toMatch(/[\r\n]/);
    }
  });
});

describe('notificationEmail (GEN-01-B)', () => {
  it('greets the user, repeats the message and points to the login page, in plain text', () => {
    const email = notificationEmail(
      NotificationType.BookingConfirmed,
      'Sara Ahmed',
      'Your flight booking FB-7KQ2MX is confirmed.',
      LOGIN_URL,
    );

    expect(email.subject).toBe('Your booking is confirmed');
    expect(email.text).toBe(
      [
        'Hello Sara Ahmed,',
        '',
        'Your flight booking FB-7KQ2MX is confirmed.',
        '',
        'Log in at http://localhost:3000 to see the details.',
        '',
        'Travel Platform',
      ].join('\n'),
    );
    expect(email.text).not.toMatch(/<[a-z]/i);
  });

  it('keeps a line break in a name or message in the body only: the subject stays the fixed one', () => {
    const email = notificationEmail(
      NotificationType.AccountSuspended,
      'Evil\r\nBcc: x@example.com',
      'Text\r\nSubject: changed',
      LOGIN_URL,
    );

    expect(email.subject).toBe('Your account is suspended');
    expect(email.text).toContain('Evil\r\nBcc: x@example.com');
    expect(email.text).toContain('Text\r\nSubject: changed');
  });
});

describe('moderatorInvitationEmail (ACC-13, GEN-01-B)', () => {
  it.each([
    [Role.HotelModerator, 'a hotel moderator'],
    [Role.AirlineModerator, 'an airline moderator'],
  ] as const)(
    'names the %s role, the login address and the password change, with the fixed subject',
    (role, words) => {
      const email = moderatorInvitationEmail(
        { name: 'Mona Hotel', role },
        LOGIN_URL,
      );

      expect(email.subject).toBe(MODERATOR_INVITATION_SUBJECT);
      expect(email.text).toContain('Hello Mona Hotel,');
      expect(email.text).toContain(
        `An administrator created ${words} account for you on the Travel Platform.`,
      );
      expect(email.text).toContain(`Log in at ${LOGIN_URL}`);
      expect(email.text).toContain(
        'the temporary password the administrator gave you',
      );
      expect(email.text).toContain(
        'You must change that password at your first login.',
      );
    },
  );

  it('never holds a password, even if one is passed by mistake', () => {
    const email = moderatorInvitationEmail(
      {
        name: 'Mona Hotel',
        role: Role.HotelModerator,
        temporaryPassword: 'Temp0rary1',
      } as never,
      LOGIN_URL,
    );

    expect(JSON.stringify(email)).not.toContain('Temp0rary1');
  });
});
