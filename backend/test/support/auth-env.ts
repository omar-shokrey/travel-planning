/**
 * Import this before anything that loads AppModule. Login signs tokens with
 * JWT_ACCESS_SECRET and JWT_REFRESH_SECRET, and the tests must not depend on
 * the real ones in backend/.env (CI has no .env at all). Two different values,
 * so a test can prove that one token type is refused as the other.
 */
export const TEST_ACCESS_SECRET = 'e2e-access-secret-not-used-anywhere-else';
export const TEST_REFRESH_SECRET = 'e2e-refresh-secret-not-used-anywhere-else';

process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
