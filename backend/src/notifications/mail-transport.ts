import type { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type { EnvironmentVariables } from '../config/env.validation';
import { MAIL_TRANSPORT, SMTP_TIMEOUT_MS } from './email.constants';

/** One email as it is handed to the transport: plain text, one recipient. */
export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** What EmailService needs of a nodemailer transporter (and what a test fake implements). */
export interface MailTransport {
  sendMail(mail: OutgoingMail): Promise<unknown>;
}

/** The SMTP settings, read from the environment (GEN-01-B, env.validation.ts). */
export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

/** The options handed to nodemailer's createTransport. */
export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
  requireTLS?: boolean;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}

/**
 * GEN-01-B: the nodemailer transporter for these settings, or null when
 * SMTP_HOST is empty (email switched off). Every SMTP step times out after
 * SMTP_TIMEOUT_MS. With no SMTP_USER the server is used without a login (a
 * local test inbox). With a login on a connection that starts plain
 * (SMTP_SECURE false), STARTTLS is required, so the credentials are never
 * sent unencrypted to a server that does not offer it. `create` is nodemailer's createTransport; a test passes
 * its own to read the options.
 */
export function buildMailTransport(
  settings: SmtpSettings,
  create: (options: SmtpTransportOptions) => MailTransport = createTransport,
): MailTransport | null {
  if (settings.host === '') {
    return null;
  }
  return create({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    ...(settings.user !== '' && {
      auth: { user: settings.user, pass: settings.password },
      ...(!settings.secure && { requireTLS: true }),
    }),
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
}

/** Provides MAIL_TRANSPORT from the SMTP_* settings. */
export const mailTransportProvider: FactoryProvider<MailTransport | null> = {
  provide: MAIL_TRANSPORT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
    buildMailTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('SMTP_PORT', { infer: true }),
      secure: config.get('SMTP_SECURE', { infer: true }),
      user: config.get('SMTP_USER', { infer: true }),
      password: config.get('SMTP_PASSWORD', { infer: true }),
    }),
};
