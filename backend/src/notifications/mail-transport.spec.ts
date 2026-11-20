import { ConfigService } from '@nestjs/config';
import { MAIL_TRANSPORT, SMTP_TIMEOUT_MS } from './email.constants';
import {
  buildMailTransport,
  mailTransportProvider,
  type SmtpSettings,
} from './mail-transport';

const settings = (fields: Partial<SmtpSettings> = {}): SmtpSettings => ({
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  user: '',
  password: '',
  ...fields,
});

describe('buildMailTransport (GEN-01-B)', () => {
  it('builds no transport when SMTP_HOST is empty: email is switched off', () => {
    const create = jest.fn();

    expect(buildMailTransport(settings({ host: '' }), create)).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('passes the host, port, TLS and a 5-second timeout for each SMTP step', () => {
    const transport = { sendMail: jest.fn() };
    const create = jest.fn().mockReturnValue(transport);

    expect(
      buildMailTransport(settings({ port: 465, secure: true }), create),
    ).toBe(transport);
    expect(create).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 5_000,
    });
    expect(SMTP_TIMEOUT_MS).toBe(5_000);
  });

  it('logs in with SMTP_USER and SMTP_PASSWORD, and requires STARTTLS on a plain connection', () => {
    const create = jest.fn().mockReturnValue({ sendMail: jest.fn() });

    buildMailTransport(
      settings({ user: 'mailer', password: 's3cret' }),
      create,
    );

    expect(create.mock.calls[0][0]).toMatchObject({
      auth: { user: 'mailer', pass: 's3cret' },
      requireTLS: true,
    });
  });

  it('does not ask for STARTTLS on a connection that is TLS from the first byte', () => {
    const create = jest.fn().mockReturnValue({ sendMail: jest.fn() });

    buildMailTransport(
      settings({ user: 'mailer', password: 's3cret', port: 465, secure: true }),
      create,
    );

    expect(create.mock.calls[0][0]).not.toHaveProperty('requireTLS');
  });

  it('uses no login with an empty SMTP_USER (a local test inbox)', () => {
    const create = jest.fn().mockReturnValue({ sendMail: jest.fn() });

    buildMailTransport(settings({ password: 'ignored' }), create);

    expect(create.mock.calls[0][0]).not.toHaveProperty('auth');
    expect(create.mock.calls[0][0]).not.toHaveProperty('requireTLS');
  });

  it('uses nodemailer by default: a real SMTP transporter that is not connected yet', () => {
    const transport = buildMailTransport(settings({ host: 'localhost' }));

    expect(typeof transport?.sendMail).toBe('function');
  });
});

describe('mailTransportProvider (GEN-01-B)', () => {
  const config = (values: Record<string, unknown>) =>
    ({
      get: (name: string) => values[name],
    }) as unknown as ConfigService;

  it('provides MAIL_TRANSPORT from the SMTP settings', () => {
    expect(mailTransportProvider.provide).toBe(MAIL_TRANSPORT);
    expect(mailTransportProvider.inject).toEqual([ConfigService]);
  });

  it('is null when SMTP_HOST is empty', () => {
    expect(
      mailTransportProvider.useFactory(
        config({
          SMTP_HOST: '',
          SMTP_PORT: 1025,
          SMTP_SECURE: false,
          SMTP_USER: '',
          SMTP_PASSWORD: '',
        }),
      ),
    ).toBeNull();
  });

  it('is a transporter when SMTP_HOST is set', () => {
    const transport = mailTransportProvider.useFactory(
      config({
        SMTP_HOST: 'localhost',
        SMTP_PORT: 1025,
        SMTP_SECURE: false,
        SMTP_USER: '',
        SMTP_PASSWORD: '',
      }),
    ) as { sendMail: unknown } | null;

    expect(typeof transport?.sendMail).toBe('function');
  });
});
