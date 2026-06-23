/**
 * FOLLOW-368 — Cross-runtime Redis round-trip smoke test.
 *
 * Purpose: prove that the Python `write_shadow_intent` writer and the
 * TypeScript `readShadowChatIntent` reader share ONE Upstash Redis instance
 * (env-var name parity).
 *
 * The two runtimes use DIFFERENT env-var names:
 *   Python writer (Modal):    UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *   TypeScript reader (Vercel): UPSTASH_REDIS_URL     / UPSTASH_REDIS_TOKEN
 *
 * If the two env pairs are not provisioned to point at the same Upstash database,
 * writes and reads silently miss each other with no error — HW-3 from RETRO-098.
 *
 * This test catches that misconfiguration by:
 *   1. Spawning the Python script (shadow_intent_writer.py) which calls the
 *      PRODUCTION `write_shadow_intent()` function using UPSTASH_REDIS_REST_* creds.
 *   2. Calling the PRODUCTION `readShadowChatIntent()` from chat-intent-cache.ts
 *      using UPSTASH_REDIS_* creds (Vercel env-var names).
 *   3. Asserting the read returns the value the Python side wrote (round-trip).
 *   4. Asserting the Upstash TTL for the key is within the expected 24 h window.
 *
 * Skip / hard-fail contract (mirrors intent-weights-live-smoke / RETRO-007):
 *   - Creds absent + no require flag → soft-skip (GitHub Actions ::notice::).
 *   - REQUIRE_REDIS_SMOKE=1 + any cred absent → hard-fail immediately.
 *   - Creds present + round-trip broken → hard-fail (the test catches a dead wire).
 *
 * Required env vars:
 *   UPSTASH_REDIS_REST_URL   — Upstash REST endpoint for the Python writer
 *   UPSTASH_REDIS_REST_TOKEN — Upstash REST token for the Python writer
 *   UPSTASH_REDIS_URL        — Upstash REST endpoint for the TypeScript reader
 *   UPSTASH_REDIS_TOKEN      — Upstash REST token for the TypeScript reader
 *   REQUIRE_REDIS_SMOKE      — set to "1" in the CI job that provides the secrets
 *
 * Both URL pairs MUST point at the same Upstash database for the round-trip to
 * succeed. If they do not, AC-RT1 will fail with "readShadowChatIntent returned
 * null" — which is the correct behaviour (it surfaces the misconfiguration).
 *
 * Secrets needed (ESC-028):
 *   None of the four secrets above exist as GitHub Actions secrets today.
 *   They must be provisioned as a single logical "test Upstash instance" before
 *   this CI job can run in non-skip mode.
 *   See backlog/ESCALATIONS.md ESC-028 and docs/runbooks/upstash-redis-env-parity.md.
 *
 * @module tests/integration/redis-shadow-round-trip.smoke
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Production-path import ───────────────────────────────────────────────────
//
// `readShadowChatIntent` is the REAL function from chat-intent-cache.ts.
// It reads UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN from process.env.
// Nothing is mocked here.
import { readShadowChatIntent } from '../../apps/control-plane/src/lib/chat-intent-cache.js';

// ─── Smoke constants (must match shadow_intent_writer.py) ────────────────────

const SMOKE_TENANT_ID = 'smoke-tenant-368';
const SMOKE_SESSION_ID = 'smoke-session-368';

/**
 * Expected intent_dimensions fields written by the Python script.
 * MUST be kept in sync with shadow_intent_writer.py — any drift here means
 * the test is asserting the wrong value, which would be a false-pass.
 */
const EXPECTED_PURCHASE_PURPOSE = 'investment';
const EXPECTED_ARCHETYPE_HINT = 'yield_hunter';
const EXPECTED_CONFIDENCE = 0.85;
const EXPECTED_TTL_SECONDS = 86400; // 24 h — the production default

// ─── Env var gate — skip / hard-fail logic ───────────────────────────────────

const PYTHON_REST_URL = process.env.UPSTASH_REDIS_REST_URL ?? '';
const PYTHON_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';
const TS_REDIS_URL = process.env.UPSTASH_REDIS_URL ?? '';
const TS_REDIS_TOKEN = process.env.UPSTASH_REDIS_TOKEN ?? '';

const HAS_PYTHON_CREDS = Boolean(PYTHON_REST_URL) && Boolean(PYTHON_REST_TOKEN);
const HAS_TS_CREDS = Boolean(TS_REDIS_URL) && Boolean(TS_REDIS_TOKEN);
const HAS_ALL_CREDS = HAS_PYTHON_CREDS && HAS_TS_CREDS;

const REQUIRE = process.env.REQUIRE_REDIS_SMOKE === '1';

/**
 * When REQUIRE_REDIS_SMOKE=1 the secrets MUST be present. A missing secret
 * means the CI job is misconfigured; a silent skip would produce a green badge
 * over a test that never ran — the failure mode documented in RETRO-007.
 */
if (REQUIRE && !HAS_ALL_CREDS) {
  const missing = [
    !PYTHON_REST_URL && 'UPSTASH_REDIS_REST_URL',
    !PYTHON_REST_TOKEN && 'UPSTASH_REDIS_REST_TOKEN',
    !TS_REDIS_URL && 'UPSTASH_REDIS_URL',
    !TS_REDIS_TOKEN && 'UPSTASH_REDIS_TOKEN',
  ]
    .filter(Boolean)
    .join(', ');

  throw new Error(
    `REQUIRE_REDIS_SMOKE=1 is set but the following secrets are absent: ${missing}. ` +
      'The redis-shadow-round-trip CI job MUST supply all four creds. ' +
      'A silent skip is forbidden — fix the job secrets or unset REQUIRE_REDIS_SMOKE. ' +
      'See backlog/ESCALATIONS.md ESC-028 for provisioning instructions.',
  );
}

// ─── Soft-skip announcement ───────────────────────────────────────────────────

beforeAll(() => {
  if (!HAS_ALL_CREDS) {
    const missingPython = [
      !PYTHON_REST_URL && 'UPSTASH_REDIS_REST_URL',
      !PYTHON_REST_TOKEN && 'UPSTASH_REDIS_REST_TOKEN',
    ]
      .filter(Boolean)
      .join(', ');
    const missingTs = [
      !TS_REDIS_URL && 'UPSTASH_REDIS_URL',
      !TS_REDIS_TOKEN && 'UPSTASH_REDIS_TOKEN',
    ]
      .filter(Boolean)
      .join(', ');
    const allMissing = [missingPython, missingTs].filter(Boolean).join('; ');

    const notice =
      `Skipping FOLLOW-368 Redis round-trip smoke — missing: ${allMissing}. ` +
      'To run: set UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (Python side), ' +
      'UPSTASH_REDIS_URL, UPSTASH_REDIS_TOKEN (TS side) — all four pointing at the SAME ' +
      'Upstash instance. See docs/runbooks/upstash-redis-env-parity.md and ESC-028.';

    // GitHub Actions notice annotation — visible in step log UI.
    console.log(`::notice::${notice}`);
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FOLLOW-368 — cross-runtime Redis round-trip: write_shadow_intent (Python) → readShadowChatIntent (TS)', () => {
  /**
   * AC-RT1: The Python writer (`write_shadow_intent`) writes a payload to Redis
   * and the TypeScript reader (`readShadowChatIntent`) reads it back successfully,
   * with matching intent_dimensions fields.
   *
   * This test will FAIL if:
   *   (a) UPSTASH_REDIS_REST_* and UPSTASH_REDIS_* point at DIFFERENT Upstash
   *       instances — the write lands in DB-A but the read queries DB-B → null.
   *   (b) The Python write fails (shadow_intent_writer.py exits non-zero).
   *   (c) The TS reader's Upstash credentials are invalid.
   *
   * ALL three failure modes represent a broken wire and the test correctly fails.
   */
  it.skipIf(!HAS_ALL_CREDS)(
    'AC-RT1: write_shadow_intent (Python) → readShadowChatIntent (TS) round-trip succeeds',
    async () => {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const writerScript = path.resolve(__dirname, 'shadow_intent_writer.py');

      // Step 1: Write the payload via the PRODUCTION Python path.
      // spawnSync runs the production write_shadow_intent() in a subprocess —
      // this is NOT a mock. It uses UPSTASH_REDIS_REST_URL / _TOKEN from env.
      const writeResult = spawnSync('python3', [writerScript], {
        env: {
          ...process.env,
          // Ensure the Python subprocess inherits the write-side creds from env.
          UPSTASH_REDIS_REST_URL: PYTHON_REST_URL,
          UPSTASH_REDIS_REST_TOKEN: PYTHON_REST_TOKEN,
        },
        encoding: 'utf-8',
        timeout: 15_000,
      });

      expect(
        writeResult.status,
        `Python writer (shadow_intent_writer.py) exited with code ${String(writeResult.status)}.\n` +
          `stdout: ${writeResult.stdout}\n` +
          `stderr: ${writeResult.stderr}\n` +
          'Ensure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set to a valid ' +
          'Upstash REST endpoint and token. See docs/runbooks/upstash-redis-env-parity.md.',
      ).toBe(0);

      // Step 2: Read the payload back via the PRODUCTION TypeScript path.
      // readShadowChatIntent uses UPSTASH_REDIS_URL / _TOKEN from process.env.
      // If these point at a DIFFERENT instance than UPSTASH_REDIS_REST_*, the
      // read will return null and the assertion below will fail — which is correct.
      const result = await readShadowChatIntent(SMOKE_TENANT_ID, SMOKE_SESSION_ID);

      expect(
        result,
        'readShadowChatIntent returned null — expected a ShadowChatIntent. ' +
          'This means either:\n' +
          '  (a) UPSTASH_REDIS_URL/TOKEN and UPSTASH_REDIS_REST_URL/TOKEN point at DIFFERENT ' +
          'Upstash instances (HW-3 env-var divergence from RETRO-098).\n' +
          '  (b) The UPSTASH_REDIS_URL / UPSTASH_REDIS_TOKEN credentials are invalid.\n' +
          '  (c) The Python write step failed silently (check AC-RT1 write exit code above).\n' +
          'Fix: provision both env-var pairs to the SAME Upstash instance. ' +
          'See docs/runbooks/upstash-redis-env-parity.md.',
      ).not.toBeNull();

      // Step 3: Assert the round-tripped fields match what the Python writer sent.
      expect(result!.intent_dimensions.purchase_purpose).toBe(EXPECTED_PURCHASE_PURPOSE);
      expect(result!.archetype_hint).toBe(EXPECTED_ARCHETYPE_HINT);
      expect(result!.confidence).toBeCloseTo(EXPECTED_CONFIDENCE, 2);
      expect(result!.intent_dimensions.tax_aware).toBe(true);
      expect(result!.intent_dimensions.finance_complexity).toBe('cash');
    },
  );

  /**
   * AC-RT2: The 24 h TTL is present on the written key.
   *
   * We check the TTL via a direct Upstash REST GET on the TTL endpoint using the
   * TS-side credentials. A TTL of -1 (no TTL) or -2 (key missing) indicates a
   * broken write or missing TTL — both represent a production correctness issue
   * (stale shadow data would never self-clean).
   *
   * TTL tolerance: the key may have been written a few seconds earlier in AC-RT1,
   * so we allow up to 60 s of elapsed time in the assertion.
   */
  it.skipIf(!HAS_ALL_CREDS)(
    'AC-RT2: shadow key has a 24 h TTL (86400 s ± 60 s tolerance)',
    async () => {
      const base = TS_REDIS_URL.replace(/\/$/, '');
      const key = `shadow:${SMOKE_TENANT_ID}:${SMOKE_SESSION_ID}:chat_intent`;
      const ttlPath = ['ttl', key].map((a) => encodeURIComponent(a)).join('/');

      const ttlRes = await fetch(`${base}/${ttlPath}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${TS_REDIS_TOKEN}` },
        signal: AbortSignal.timeout(10_000),
      });

      expect(ttlRes.ok, `TTL check returned HTTP ${String(ttlRes.status)} — expected 200.`).toBe(
        true,
      );

      const ttlBody = (await ttlRes.json()) as { result: number };
      const ttl = ttlBody.result;

      expect(
        ttl,
        'TTL is -2 — key is missing (write did not reach this Upstash instance). ' +
          'Verify UPSTASH_REDIS_REST_* and UPSTASH_REDIS_* point at the SAME database. ' +
          'See docs/runbooks/upstash-redis-env-parity.md.',
      ).not.toBe(-2);

      expect(
        ttl,
        'TTL is -1 — key exists but has no TTL. write_shadow_intent() must set ex=86400. ' +
          'Check that the production write path includes the `ex=ttl_seconds` argument.',
      ).not.toBe(-1);

      // The key was written within the last 60 s, so TTL must be in (86400-60, 86400].
      const TOLERANCE_SECONDS = 60;
      expect(ttl).toBeGreaterThan(EXPECTED_TTL_SECONDS - TOLERANCE_SECONDS);
      expect(ttl).toBeLessThanOrEqual(EXPECTED_TTL_SECONDS);
    },
  );
});
