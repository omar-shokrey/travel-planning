/**
 * Runs before every end-to-end test file (`setupFiles` in jest-e2e.json). The
 * app reads STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET when it loads (PAY-01).
 * No test may call Stripe or use the real keys from backend/.env, so these are
 * fake test values. The payment tests replace the three gateway calls that
 * reach Stripe and sign their own webhook events with this secret, so the
 * signature check itself is the real one.
 */
export const TEST_STRIPE_SECRET_KEY = 'sk_test_e2e_not_used_anywhere_else';
export const TEST_STRIPE_WEBHOOK_SECRET = 'whsec_e2e_not_used_anywhere_else';

process.env.STRIPE_SECRET_KEY = TEST_STRIPE_SECRET_KEY;
process.env.STRIPE_WEBHOOK_SECRET = TEST_STRIPE_WEBHOOK_SECRET;
