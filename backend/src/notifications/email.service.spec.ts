import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { EnvironmentVariables } from '../config/env.validation';
import { Role } from '../common/enums/role.enum';
import { MAIL_TRANSPORT, MAX_EMAILS_IN_FLIGHT } from './email.constants';
import { EmailService } from './email.service';
import { NotificationType } from './enums/notification-type.enum';
import {
  mailTransportProvider,
  type MailTransport,
  type OutgoingMail,
} from './mail-transport';

const SETTINGS: Record<string, string> = {
  FRONTEND_URL: 'http://localhost:3000',
  MAIL_FROM: 'Travel Platform <no-reply@example.com>',
  SMTP_USER: 'secret-login',
  SMTP_PASSWORD: 'secret-password',
};

const config = {
  get: (name: string) => SETTINGS[name],
} as unknown as ConfigService<EnvironmentVariables, true>;

/** A transport that records every email and answers when told to. */
function fakeTransport() {
  const sent: OutgoingMail[] = [];
  const sendMail = jest.fn((mail: OutgoingMail) => {
    sent.push(mail);
    return Promise.resolve({ messageId: 'x' });
  });
  return { sent, sendMail, transport: { sendMail } as MailTransport };
}

const recipients = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    email: `user${i}@example.com`,
    name: `User ${i}`,
  }));

let warn: jest.SpyInstance;
let error: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
});
afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

/** Everything the service logged, as one string. */
const logged = () => JSON.stringify([...warn.mock.calls, ...error.mock.calls]);

describe('EmailService switched off (GEN-01-B)', () => {
  it('is not enabled and sends nothing when there is no transport', async () => {
    const service = new EmailService(null, config);

    expect(service.enabled).toBe(false);
    await expect(
      service.sendNotification(
        recipients(2),
        NotificationType.Refund,
        'Your refund is on its way.',
      ),
    ).resolves.toBeUndefined();
    await expect(
      service.sendModeratorInvitation({
        name: 'Mona',
        email: 'mona@example.com',
        role: Role.HotelModerator,
      }),
    ).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('EmailService.sendNotification (GEN-01-B)', () => {
  it('sends each recipient one plain-text email from MAIL_FROM, to the stored address, with the type’s subject', async () => {
    const { sent, transport } = fakeTransport();
    const service = new EmailService(transport, config);

    expect(service.enabled).toBe(true);
    await service.sendNotification(
      recipients(2),
      NotificationType.BookingCancelled,
      'Your booking FB-7KQ2MX is cancelled.',
    );

    expect(sent).toEqual([
      {
        from: 'Travel Platform <no-reply@example.com>',
        to: 'user0@example.com',
        subject: 'Your booking is cancelled',
        text: expect.stringContaining('Hello User 0,') as string,
      },
      {
        from: 'Travel Platform <no-reply@example.com>',
        to: 'user1@example.com',
        subject: 'Your booking is cancelled',
        text: expect.stringContaining('Hello User 1,') as string,
      },
    ]);
    expect(sent[0].text).toContain('Your booking FB-7KQ2MX is cancelled.');
    expect(sent[0].text).toContain('Log in at http://localhost:3000');
    expect(sent[0]).not.toHaveProperty('html');
  });

  it('sends one email to an address listed twice', async () => {
    const { sent, transport } = fakeTransport();
    const service = new EmailService(transport, config);

    await service.sendNotification(
      [...recipients(1), ...recipients(1)],
      NotificationType.Refund,
      'Refund.',
    );

    expect(sent).toHaveLength(1);
  });

  it('sends nothing for no recipient', async () => {
    const { sendMail, transport } = fakeTransport();

    await new EmailService(transport, config).sendNotification(
      [],
      NotificationType.Refund,
      'Refund.',
    );

    expect(sendMail).not.toHaveBeenCalled();
  });

  it(`has at most ${MAX_EMAILS_IN_FLIGHT} emails in flight at once, and sends them all`, async () => {
    let inFlight = 0;
    let most = 0;
    const sendMail = jest.fn(async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
    });
    const service = new EmailService({ sendMail }, config);

    await service.sendNotification(
      recipients(12),
      NotificationType.FlightChanged,
      'Your flight moved.',
    );

    expect(sendMail).toHaveBeenCalledTimes(12);
    expect(most).toBe(MAX_EMAILS_IN_FLIGHT);
  });

  it(`keeps at most ${MAX_EMAILS_IN_FLIGHT} emails in flight across calls running at the same time`, async () => {
    let inFlight = 0;
    let most = 0;
    const sendMail = jest.fn(async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
    });
    const service = new EmailService({ sendMail }, config);

    await Promise.all([
      service.sendNotification(recipients(8), NotificationType.Refund, 'A.'),
      service.sendNotification(
        recipients(8).map((r) => ({ ...r, email: `b-${r.email}` })),
        NotificationType.FlightChanged,
        'B.',
      ),
      service.sendModeratorInvitation({
        name: 'Mona',
        email: 'mona@example.com',
        role: Role.HotelModerator,
      }),
    ]);

    expect(sendMail).toHaveBeenCalledTimes(17);
    expect(most).toBe(MAX_EMAILS_IN_FLIGHT);
  });

  it('frees the slot of a failed email for the next one', async () => {
    const sendMail = jest
      .fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockRejectedValueOnce(new Error('c'))
      .mockRejectedValueOnce(new Error('d'))
      .mockRejectedValueOnce(new Error('e'))
      .mockRejectedValueOnce(new Error('f'))
      .mockResolvedValue({});
    const service = new EmailService({ sendMail }, config);

    await service.sendNotification(
      recipients(8),
      NotificationType.Refund,
      'R.',
    );
    await service.sendNotification(
      recipients(3),
      NotificationType.Refund,
      'R.',
    );

    expect(sendMail).toHaveBeenCalledTimes(11);
    expect(warn.mock.calls[0][0]).toContain('6 of 8 recipient(s)');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('never throws: one failure does not stop the others, and one warning gives the type, the count and the error code only', async () => {
    const sendMail = jest.fn((mail: OutgoingMail) =>
      mail.to === 'user1@example.com'
        ? Promise.reject(
            Object.assign(
              new Error(
                'Recipient user1@example.com rejected, login secret-login / secret-password',
              ),
              { code: 'EENVELOPE' },
            ),
          )
        : Promise.resolve({}),
    );
    const service = new EmailService({ sendMail }, config);

    await expect(
      service.sendNotification(
        recipients(3),
        NotificationType.AccountSuspended,
        'Your account is suspended by an administrator.',
      ),
    ).resolves.toBeUndefined();

    expect(sendMail).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      'Could not email the "account_suspended" notification to 1 of 3 recipient(s) (EENVELOPE)',
    );
    for (const secret of [
      'user1@example.com',
      'User 1',
      'secret-login',
      'secret-password',
      'suspended by an administrator',
    ]) {
      expect(logged()).not.toContain(secret);
    }
  });

  it('logs "unknown error" for an error with no SMTP code, and lists each code once', async () => {
    const sendMail = jest
      .fn()
      .mockRejectedValueOnce(new Error('user0@example.com'))
      .mockRejectedValueOnce({ code: 'lower-case' })
      .mockRejectedValueOnce(
        Object.assign(new Error('x'), { code: 'ETIMEDOUT' }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('y'), { code: 'ETIMEDOUT' }),
      )
      .mockRejectedValueOnce(null);
    const service = new EmailService({ sendMail }, config);

    await service.sendNotification(
      recipients(5),
      NotificationType.Refund,
      'Refund.',
    );

    expect(warn.mock.calls[0][0]).toBe(
      'Could not email the "refund" notification to 5 of 5 recipient(s) (unknown error, ETIMEDOUT)',
    );
    expect(logged()).not.toContain('user0@example.com');
  });
});

describe('EmailService.sendModeratorInvitation (ACC-13, GEN-01-B)', () => {
  it('emails the moderator their role and the login address, and never a password even if one is passed by mistake', async () => {
    const { sent, transport } = fakeTransport();
    const service = new EmailService(transport, config);

    await service.sendModeratorInvitation({
      name: 'Adam Air',
      email: 'adam@example.com',
      role: Role.AirlineModerator,
      temporaryPassword: 'Temp0rary1',
    } as never);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: 'Travel Platform <no-reply@example.com>',
      to: 'adam@example.com',
      subject: 'Your moderator account on the Travel Platform',
    });
    expect(sent[0].text).toContain('created an airline moderator account');
    expect(sent[0].text).toContain('Log in at http://localhost:3000');
    expect(JSON.stringify(sent)).not.toContain('Temp0rary1');
  });

  it('never throws when the server refuses it, and logs no address', async () => {
    const sendMail = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('adam@example.com'), { code: 'EAUTH' }),
      );
    const service = new EmailService({ sendMail }, config);

    await expect(
      service.sendModeratorInvitation({
        name: 'Adam Air',
        email: 'adam@example.com',
        role: Role.AirlineModerator,
      }),
    ).resolves.toBeUndefined();
    expect(warn.mock.calls[0][0]).toBe(
      'Could not email the moderator invitation to 1 of 1 recipient(s) (EAUTH)',
    );
    expect(logged()).not.toContain('adam@example.com');
  });
});

describe('EmailService.sendEmailVerification (ACC-02, GEN-01-B)', () => {
  const request = {
    name: 'Sara Ahmed',
    email: 'sara@example.com',
    token: 'q3Zf8kV1uX9cLr0bT2mN7pQwYh5sJd4eAiOgKl6zRvE',
    expiresInHours: 24,
  };

  it('emails the link to the frontend page with the token, from MAIL_FROM, with the fixed subject', async () => {
    const { sent, transport } = fakeTransport();
    const service = new EmailService(transport, config);

    await service.sendEmailVerification(request);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: 'Travel Platform <no-reply@example.com>',
      to: 'sara@example.com',
      subject: 'Verify your email address',
    });
    expect(sent[0].text).toContain(
      `http://localhost:3000/verify-email?token=${request.token}`,
    );
    expect(sent[0].text).toContain('expires in 24 hours');
  });

  it('sends nothing when email is switched off', async () => {
    const service = new EmailService(null, config);

    await expect(
      service.sendEmailVerification(request),
    ).resolves.toBeUndefined();
  });

  it('never throws when the server refuses it, and logs neither the address nor the token', async () => {
    const sendMail = jest.fn().mockRejectedValue(
      Object.assign(new Error(`sara@example.com ${request.token}`), {
        code: 'ECONNECTION',
      }),
    );
    const service = new EmailService({ sendMail }, config);

    await expect(
      service.sendEmailVerification(request),
    ).resolves.toBeUndefined();
    expect(warn.mock.calls[0][0]).toBe(
      'Could not email the email verification to 1 of 1 recipient(s) (ECONNECTION)',
    );
    expect(logged()).not.toContain('sara@example.com');
    expect(logged()).not.toContain(request.token);
  });
});

describe('EmailService.runInBackground (GEN-01-B)', () => {
  it('does not make the caller wait, and whenIdle waits for the task', async () => {
    const service = new EmailService(null, config);
    let done = false;

    service.runInBackground(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      done = true;
    }, 'test');

    expect(done).toBe(false);
    await service.whenIdle();
    expect(done).toBe(true);
  });

  it('logs a failed task with what it sent and an error code only, and never throws', async () => {
    const service = new EmailService(null, config);

    service.runInBackground(
      () =>
        Promise.reject(
          Object.assign(new Error('lookup of user0@example.com failed'), {
            code: 'ECONNRESET',
          }),
        ),
      '"refund" notification',
    );
    await service.whenIdle();

    expect(error).toHaveBeenCalledWith(
      'Could not email the "refund" notification (ECONNRESET)',
    );
    expect(logged()).not.toContain('user0@example.com');
  });

  it('waits for the emails still being sent when the app stops', async () => {
    const service = new EmailService(null, config);
    let done = false;
    service.runInBackground(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      done = true;
    }, 'test');

    await service.onApplicationShutdown();

    expect(done).toBe(true);
  });

  it('is idle at once when nothing runs', async () => {
    await expect(
      new EmailService(null, config).whenIdle(),
    ).resolves.toBeUndefined();
  });
});

describe('EmailService in a Nest module (GEN-01-B)', () => {
  const settings = (host: string) => ({
    provide: ConfigService,
    useValue: {
      get: (name: string) =>
        ({
          SMTP_HOST: host,
          SMTP_PORT: 1025,
          SMTP_SECURE: false,
          SMTP_USER: '',
          SMTP_PASSWORD: '',
          FRONTEND_URL: 'http://localhost:3000',
          MAIL_FROM: 'Travel Platform <no-reply@example.com>',
        })[name],
    },
  });

  it('gets no transport and is switched off when SMTP_HOST is empty', async () => {
    const module = await Test.createTestingModule({
      providers: [EmailService, mailTransportProvider, settings('')],
    }).compile();

    expect(module.get(MAIL_TRANSPORT)).toBeNull();
    expect(module.get(EmailService).enabled).toBe(false);
  });

  it('gets the nodemailer transport when SMTP_HOST is set', async () => {
    const module = await Test.createTestingModule({
      providers: [EmailService, mailTransportProvider, settings('localhost')],
    }).compile();

    expect(module.get(EmailService).enabled).toBe(true);
  });
});
