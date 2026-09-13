import '@testing-library/jest-dom';

// FOLLOW-1201: `assignHoldout()` refuses to run without a server-side secret (never keyed on the
// public tenant_id again). Every route suite that reaches the holdout gate needs one; the value
// is a fixture, built with `.repeat()` so no token-shaped literal lands in the repo.
process.env.HOLDOUT_ASSIGNMENT_SECRET ??= 'test-holdout-assignment-secret-'.repeat(2);
// FOLLOW-1201: the configured rate is the tenant's, not the caller's. Route suites used to pin the
// treatment arm by SENDING `holdout_pct: 0`; a public caller's number is now ignored, so the test
// environment's configured rate is 0 — every session is treatment unless a suite stubs
// `HOLDOUT_PCT` or forces the holdout arm with the ADAPT_API_KEY ops credential.
process.env.HOLDOUT_PCT ??= '0';
