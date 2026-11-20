import { Role } from '../common/enums/role.enum';
import {
  EMAIL_VERIFICATION_SUBJECT,
  MODERATOR_INVITATION_SUBJECT,
  NOTIFICATION_EMAIL_SUBJECTS,
  PASSWORD_RESET_SUBJECT,
} from './email.constants';
import {
  emailVerificationEmail,
  frontendLink,
  moderatorInvitationEmail,
  notificationEmail,
  passwordResetEmail,
} from './email-templates';
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

describe('frontendLink (ACC-02)', () => {
  it('puts the token in the query string of the frontend page', () => {
    expect(frontendLink('http://localhost:3000', 'verify-email', 'abc')).toBe(
      'http://localhost:3000/verify-email?token=abc',
    );
  });

  it('drops a trailing slash of FRONTEND_URL, so the path has one slash', () => {
    expect(frontendLink('https://travel.example/', 'verify-email', 'abc')).toBe(
      'https://travel.example/verify-email?token=abc',
    );
  });

  it('encodes a character that has a meaning in a URL', () => {
    expect(frontendLink('http://localhost:3000', 'verify-email', 'a&b=c')).toBe(
      'http://localhost:3000/verify-email?token=a%26b%3Dc',
    );
  });
});

describe('emailVerificationEmail (ACC-02)', () => {
  const request = {
    name: 'Sara Ahmed',
    token: 'q3Zf8kV1uX9cLr0bT2mN7pQwYh5sJd4eAiOgKl6zRvE',
    expiresInHours: 24,
  };

  it('greets the user and gives the verification link, its lifetime and what to do if they did not register, in plain text', () => {
    const { subject, text } = emailVerificationEmail(request, LOGIN_URL);

    expect(subject).toBe(EMAIL_VERIFICATION_SUBJECT);
    expect(subject).toBe('Verify your email address');
    expect(text).toContain('Hello Sara Ahmed,');
    expect(text).toContain(
      'http://localhost:3000/verify-email?token=q3Zf8kV1uX9cLr0bT2mN7pQwYh5sJd4eAiOgKl6zRvE',
    );
    expect(text).toContain('The link expires in 24 hours.');
    expect(text).toContain('If you did not register, ignore this email.');
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it('never holds a password, even if one is passed by mistake', () => {
    const { subject, text } = emailVerificationEmail(
      { ...request, password: 'Passw0rdOK' } as typeof request,
      LOGIN_URL,
    );

    expect(`${subject}${text}`).not.toContain('Passw0rdOK');
  });

  it('keeps a line break in the name in the body only: the subject stays fixed, with no line break', () => {
    const { subject, text } = emailVerificationEmail(
      { ...request, name: 'Sara\r\nBcc: someone@example.com' },
      LOGIN_URL,
    );

    expect(text).toContain('Sara\r\nBcc: someone@example.com');
    expect(subject).toBe('Verify your email address');
    expect(subject).not.toMatch(/[\r\n]/);
  });
});

describe('passwordResetEmail (ACC-07)', () => {
  const request = {
    name: 'Sara Ahmed',
    token: 'q3Zf8kV1uX9cLr0bT2mN7pQwYh5sJd4eAiOgKl6zRvE',
    expiresInMinutes: 30,
  };

  it('gives the reset link, its 30 minutes, that it works once, and that nothing changed if not asked for, in plain text', () => {
    const { subject, text } = passwordResetEmail(request, LOGIN_URL);

    expect(subject).toBe(PASSWORD_RESET_SUBJECT);
    expect(subject).toBe('Reset your password');
    expect(text).toContain('Hello Sara Ahmed,');
    expect(text).toContain(
      'http://localhost:3000/reset-password?token=q3Zf8kV1uX9cLr0bT2mN7pQwYh5sJd4eAiOgKl6zRvE',
    );
    expect(text).toContain('This link expires in 30 minutes and works once.');
    expect(text).toContain(
      'If you did not ask for this, ignore this email: your password has not changed.',
    );
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it('never holds a password, even if one is passed by mistake', () => {
    const { subject, text } = passwordResetEmail(
      { ...request, password: 'Passw0rdOK' } as typeof request,
      LOGIN_URL,
    );

    expect(`${subject}${text}`).not.toContain('Passw0rdOK');
  });

  it('keeps a line break in the name in the body only: the subject stays fixed, with no line break', () => {
    const { subject, text } = passwordResetEmail(
      { ...request, name: 'Sara\r\nBcc: someone@example.com' },
      LOGIN_URL,
    );

    expect(text).toContain('Sara\r\nBcc: someone@example.com');
    expect(subject).toBe('Reset your password');
    expect(subject).not.toMatch(/[\r\n]/);
  });
});
