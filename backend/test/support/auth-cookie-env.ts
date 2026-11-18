/**
 * Import this before anything that loads AppModule. It pins the cookie
 * settings (ACC-19), so a test that checks the exact `Set-Cookie` attributes
 * gives the same result on every machine, whatever a local backend/.env says.
 * The values are the defaults of `config/env.validation.ts`.
 */
export const TEST_ACCESS_TOKEN_MINUTES = 10;
export const TEST_SESSION_INACTIVITY_MINUTES = 30;

process.env.ACCESS_TOKEN_MINUTES = String(TEST_ACCESS_TOKEN_MINUTES);
process.env.SESSION_INACTIVITY_MINUTES = String(
  TEST_SESSION_INACTIVITY_MINUTES,
);
process.env.COOKIE_SECURE = 'true';
process.env.COOKIE_SAME_SITE = 'lax';
