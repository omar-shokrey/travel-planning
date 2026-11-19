/**
 * Runs before every end-to-end test file (`setupFiles` in jest-e2e.json). The
 * app reads FXRATES_API_KEY and FXRATES_API_URL when it loads (ITN-18). No
 * test may call the real FXRatesAPI or use the real key from backend/.env, so
 * the address is a `.test` name that never resolves: a budget summary then
 * shows no converted totals. The ITN-18 tests answer that address themselves.
 */
export const TEST_FXRATES_API_URL = 'http://fxrates.e2e.test';
export const TEST_FXRATES_API_KEY = 'e2e-fxrates-key-not-used-anywhere-else';

process.env.FXRATES_API_URL = TEST_FXRATES_API_URL;
process.env.FXRATES_API_KEY = TEST_FXRATES_API_KEY;
