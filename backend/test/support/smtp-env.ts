/**
 * Runs before every end-to-end test file (`setupFiles` in jest-e2e.json),
 * after test-database.ts has read backend/.env. GEN-01-B: no test may reach an
 * SMTP server, even if backend/.env names one, so email is switched off here.
 * A suite that checks the emails replaces MAIL_TRANSPORT with
 * FakeMailTransport (fake-mail-transport.ts), which only collects them.
 */
export const TEST_MAIL_FROM =
  'Travel Platform <no-reply@travel-platform.local>';

process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASSWORD = '';
process.env.MAIL_FROM = TEST_MAIL_FROM;
