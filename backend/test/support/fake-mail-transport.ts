import type {
  MailTransport,
  OutgoingMail,
} from './../../src/notifications/mail-transport';

/**
 * GEN-01-B: a mail transport that sends nothing and keeps every email, for
 * the end-to-end tests. A suite installs it with
 * `overrideProvider(MAIL_TRANSPORT).useValue(new FakeMailTransport())`.
 */
export class FakeMailTransport implements MailTransport {
  readonly sent: OutgoingMail[] = [];

  sendMail(mail: OutgoingMail): Promise<{ messageId: string }> {
    this.sent.push(mail);
    return Promise.resolve({ messageId: `fake-${this.sent.length}` });
  }

  /** The emails sent to one address. */
  to(address: string): OutgoingMail[] {
    return this.sent.filter((mail) => mail.to === address);
  }
}
