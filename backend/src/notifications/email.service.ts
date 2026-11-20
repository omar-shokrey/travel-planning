import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation';
import {
  type EmailContent,
  type EmailVerificationRequest,
  emailVerificationEmail,
  type InvitedModerator,
  moderatorInvitationEmail,
  notificationEmail,
} from './email-templates';
import { MAIL_TRANSPORT, MAX_EMAILS_IN_FLIGHT } from './email.constants';
import type { NotificationType } from './enums/notification-type.enum';
import type { MailTransport } from './mail-transport';

/** A user an email goes to: the stored address and name only. */
export interface EmailRecipient {
  email: string;
  name: string;
}

/** One email to send: the stored address of one user and its content. */
interface PendingEmail extends EmailContent {
  to: string;
}

/**
 * The error code nodemailer gives (EAUTH, ECONNECTION, ETIMEDOUT, EENVELOPE,
 * ...), the only part of an error that is logged: an SMTP error message can
 * hold an address or a server answer.
 */
function errorCode(error: unknown): string {
  const code =
    error !== null && typeof error === 'object' && 'code' in error
      ? error.code
      : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code)
    ? code
    : 'unknown error';
}

/**
 * GEN-01-B: sends the email notifications, the moderator invitations and the
 * verification links (ACC-02) through the SMTP transport. When SMTP_HOST is empty there is no transport:
 * `enabled` is false and every method returns at once, sending nothing.
 *
 * Sending never throws and is bounded: at most MAX_EMAILS_IN_FLIGHT emails at
 * once across the whole app (one queue for every caller), every SMTP step
 * times out (mail-transport.ts), and one failed email never stops the others.
 * A failure is logged with what was sent and how many failed only, never an
 * address, a name, a message, a token or an SMTP credential.
 */
@Injectable()
export class EmailService implements OnApplicationShutdown {
  private readonly logger = new Logger(EmailService.name);
  private readonly running = new Set<Promise<void>>();
  /** Emails being sent now, and the senders waiting for a free slot. */
  private inFlight = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** False when SMTP_HOST is empty: nothing is ever sent. */
  get enabled(): boolean {
    return this.transport !== null;
  }

  /** The email of one in-app notification, to each recipient once (GEN-01-B). */
  async sendNotification(
    recipients: readonly EmailRecipient[],
    type: NotificationType,
    message: string,
  ): Promise<void> {
    const loginUrl = this.loginUrl();
    const byAddress = new Map(recipients.map((r) => [r.email, r]));
    await this.sendAll(
      [...byAddress.values()].map((recipient) => ({
        to: recipient.email,
        ...notificationEmail(type, recipient.name, message, loginUrl),
      })),
      `"${type}" notification`,
    );
  }

  /** The invitation of a new moderator (ACC-13), without the password. */
  async sendModeratorInvitation(moderator: InvitedModerator): Promise<void> {
    await this.sendAll(
      [
        {
          to: moderator.email,
          ...moderatorInvitationEmail(moderator, this.loginUrl()),
        },
      ],
      'moderator invitation',
    );
  }

  /**
   * ACC-02: the email with the verification link. The token is in the link
   * only; it is never logged.
   */
  async sendEmailVerification(
    request: EmailVerificationRequest,
  ): Promise<void> {
    await this.sendAll(
      [
        {
          to: request.email,
          ...emailVerificationEmail(request, this.loginUrl()),
        },
      ],
      'email verification',
    );
  }

  /**
   * Runs `task` after the caller's work, without making the caller wait for
   * the mail server: a request answers as soon as its own write is done. A
   * failure of the task is logged with `what` and an error code only.
   */
  runInBackground(task: () => Promise<void>, what: string): void {
    const run = Promise.resolve()
      .then(task)
      .catch((error: unknown) => {
        this.logger.error(`Could not email the ${what} (${errorCode(error)})`);
      });
    this.running.add(run);
    void run.finally(() => this.running.delete(run));
  }

  /** Resolves when every email started in the background is done (tests, shutdown). */
  async whenIdle(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.allSettled(this.running);
    }
  }

  /** Lets the emails already started finish when the app is closed (`app.close()`). */
  async onApplicationShutdown(): Promise<void> {
    await this.whenIdle();
  }

  /**
   * Runs `send` when fewer than MAX_EMAILS_IN_FLIGHT emails are being sent by
   * this service, from any caller; otherwise waits for a free slot. A slot is
   * handed straight to the next waiting sender when one finishes.
   */
  private async withSlot<T>(send: () => Promise<T>): Promise<T> {
    if (this.inFlight < MAX_EMAILS_IN_FLIGHT) {
      this.inFlight++;
    } else {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      return await send();
    } finally {
      const next = this.waiting.shift();
      if (next) {
        next();
      } else {
        this.inFlight--;
      }
    }
  }

  private loginUrl(): string {
    return this.config.get('FRONTEND_URL', { infer: true });
  }

  /**
   * Sends every email, each through the shared queue (`withSlot`). Each
   * failure is counted, and one warning names what was sent, how many of how
   * many failed and the error codes.
   */
  private async sendAll(emails: PendingEmail[], what: string): Promise<void> {
    const transport = this.transport;
    if (transport === null || emails.length === 0) {
      return;
    }
    const from = this.config.get('MAIL_FROM', { infer: true });
    let failed = 0;
    const codes = new Set<string>();
    await Promise.all(
      emails.map((email) =>
        this.withSlot(() =>
          transport.sendMail({
            from,
            to: email.to,
            subject: email.subject,
            text: email.text,
          }),
        ).catch((error: unknown) => {
          failed++;
          codes.add(errorCode(error));
        }),
      ),
    );
    if (failed > 0) {
      this.logger.warn(
        `Could not email the ${what} to ${failed} of ${emails.length} recipient(s) (${[...codes].join(', ')})`,
      );
    }
  }
}
