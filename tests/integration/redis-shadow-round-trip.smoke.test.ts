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
 *   - REQUIRE_REDIS_SMOKE is NOT this file's decision — the calling CI job
 *     (redis-shadow-smoke.yml) sets it based on TRIGGER TYPE, not on whether
 *     secrets currently happen to be present (FOLLOW-762 — RETRO-238 §4a
 *     LG-2). push / schedule / workflow_dispatch / same-repo pull_request all
 *     set REQUIRE_REDIS_SMOKE=1 unconditionally; only a fork-originated
 *     pull_request may leave it unset, because GitHub Actions withholds
 *     repository secrets from fork-originated runs by design.
 *   - REQUIRE_REDIS_SMOKE=1 + any cred absent → hard-fail immediately (this
 *     is proven to actually fire by the workflow's "Negative control" job —
 *     see redis-shadow-smoke.yml — not merely asserted here).
 *   - REQUIRE_REDIS_SMOKE unset + creds absent → soft-skip (GitHub Actions
 *     ::notice::) — the fork-PR / local-dev case only.
 *   - Creds present + round-trip broken → hard-fail (the test catches a dead wire).
 *
 * Required env vars:
 *   UPSTASH_REDIS_REST_URL   — Upstash REST endpoint for the Python writer
 *   UPSTASH_REDIS_REST_TOKEN — Upstash REST token for the Python writer
 *   UPSTASH_REDIS_URL        — Upstash REST endpoint for the TypeScript reader
 *   UPSTASH_REDIS_TOKEN      — Upstash REST token for the TypeScript reader
 *   REQUIRE_REDIS_SMOKE      — set by the CI job per the trigger-type contract above
 *
 * Both URL pairs MUST point at the same Upstash database for the round-trip to
 * succeed. If they do not, AC-RT1 will fail with "readShadowChatIntent returned
 * null" — which is the correct behaviour (it surfaces the misconfiguration).
 *
 * Secrets (ESC-028, RESOLVED 2026-07-13):
 *   All four secrets are provisioned as GitHub Actions secrets against a
 *   single shared "test Upstash instance". Provisioning is a PRECONDITION for
 *   the trigger-type hard-fail contract above to succeed rather than throw —
 *   it does not itself gate whether REQUIRE_REDIS_SMOKE is set. See
 *   backlog/ESCALATIONS.md ESC-028 and docs/runbooks/upstash-redis-env-parity.md.
 *
 * FOLLOW-752 extends this file with a second describe block proving the
 * `SET … NX` write-admission invariant (ADR-0020 D3/D4) against this SAME
 * real instance — see the bottom of this file.
 *
 * @module tests/integration/redis-shadow-round-trip.smoke
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Production-path import ───────────────────────────────────────────────────
//
// `readShadowChatIntent` is the REAL function from chat-intent-cache.ts.
// It reads UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN from process.env.
// Nothing is mocked here.
import {
  readShadowChatIntent,
  deleteShadowChatIntent,
} from '../../apps/control-plane/src/lib/chat-intent-cache.js';

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

// ─── FOLLOW-752 — the `SET … NX` write-admission invariant (ADR-0020 D3/D4) ──
//
// FOLLOW-736's whole deliverable is one invariant: an extraction carrying no
// usable dimension must neither remove a stored prior nor refresh its TTL.
// Until this block, that invariant was proved only against a `MagicMock`
// (apps/intent-engine/src/test_intent_engine.py `_write()` helper), which
// proves `nx=True` was PASSED, not that Redis HONOURED it. The two cases below
// run the PRODUCTION `write_shadow_intent` against the SAME real Upstash
// instance AC-RT1/AC-RT2 already use, then read the result back with the
// PRODUCTION `readShadowChatIntent` / a direct TTL call — nothing here is
// mocked or hand-injected.
//
// Uses a DIFFERENT tenant/session pair than AC-RT1/AC-RT2 (`smoke-tenant-368`)
// so the two suites can never interfere with each other's fixture state.
//
// FOLLOW-761: `redis-shadow-smoke.yml` triggers on both `push` and
// `pull_request` for one agent-branch commit, and a nightly cron is a third
// writer — all three can target the SAME Upstash instance. A `concurrency`
// group now serializes runs that share a branch, but that is scheduling, not
// a guarantee: two DIFFERENT branches' runs (or a local run alongside CI) are
// NOT in the same group and CAN execute genuinely concurrently. Fixed keys
// were the actual exposure (RETRO-238 §4a LG-1, a MEASURED 26s overlap): if
// `nx=True` were ever broken, one run's "empty" write could clobber the key
// right as a concurrent run's "signal" write restored it, so THAT run's value
// assertion would pass even though NX was broken — a false GREEN over the one
// invariant this describe block exists to prove. Namespacing every fixture
// key by `NX_RUN_SUFFIX` (the CI job's `github.run_id`, threaded through as an
// env var — see redis-shadow-smoke.yml; falls back to a fixed literal for
// local/offline runs, never `Math.random()`) makes two runs' keys disjoint by
// construction, independent of whether the concurrency group ever fires.
const NX_RUN_SUFFIX = process.env.NX_RUN_SUFFIX ?? 'local-dev';

const NX_WARM_TENANT_ID = `smoke-tenant-752-warm-${NX_RUN_SUFFIX}`;
const NX_WARM_SESSION_ID = `smoke-session-752-warm-${NX_RUN_SUFFIX}`;
const NX_COLD_TENANT_ID = `smoke-tenant-752-cold-${NX_RUN_SUFFIX}`;
const NX_COLD_SESSION_ID = `smoke-session-752-cold-${NX_RUN_SUFFIX}`;

// Must match the "signal" fixture in nx_invariant_writer.py.
const NX_SIGNAL_PURCHASE_PURPOSE = 'primary_residence';
const NX_SIGNAL_ARCHETYPE_HINT = 'family_upsizer';
const NX_SIGNAL_CONFIDENCE = 0.9;

/**
 * Run the PRODUCTION `write_shadow_intent` (via nx_invariant_writer.py) for a
 * given tenant/session pair. `mode` selects which fixture the Python side
 * builds — see nx_invariant_writer.py for the exact payload shapes.
 */
function runNxWriter(tenantId: string, sessionId: string, mode: 'signal' | 'empty') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const writerScript = path.resolve(__dirname, 'nx_invariant_writer.py');
  const result = spawnSync('python3', [writerScript, tenantId, sessionId, mode], {
    env: {
      ...process.env,
      UPSTASH_REDIS_REST_URL: PYTHON_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: PYTHON_REST_TOKEN,
    },
    encoding: 'utf-8',
    timeout: 15_000,
  });
  expect(
    result.status,
    `nx_invariant_writer.py (mode=${mode}, tenant=${tenantId}, session=${sessionId}) ` +
      `exited with code ${String(result.status)}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  ).toBe(0);
}

/**
 * Direct Upstash REST TTL check via the TS-side credentials — same call shape
 * as AC-RT2 above, factored out here because the NX cases below need it twice
 * (once per write) rather than once.
 */
async function fetchTtl(tenantId: string, sessionId: string): Promise<number> {
  const base = TS_REDIS_URL.replace(/\/$/, '');
  const key = `shadow:${tenantId}:${sessionId}:chat_intent`;
  const ttlPath = ['ttl', key].map((a) => encodeURIComponent(a)).join('/');
  const res = await fetch(`${base}/${ttlPath}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${TS_REDIS_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  });
  expect(res.ok, `TTL check returned HTTP ${String(res.status)} — expected 200.`).toBe(true);
  const body = (await res.json()) as { result: number };
  return body.result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('FOLLOW-752 — SET … NX write-admission invariant honoured by a REAL Redis instance', () => {
  // FOLLOW-761 AC3: run-scoped keys (NX_RUN_SUFFIX) are never reused across
  // runs, so — unlike AC-RT1/AC-RT2's fixed keys — nothing ever overwrites
  // them again. Without cleanup they'd sit in the shared Upstash instance for
  // their full 24h TTL, one extra pair per CI run. `deleteShadowChatIntent` is
  // the production erase path (`chat-intent-cache.ts:151`, the GDPR Art. 17
  // DSR route), reused here rather than a bespoke DEL, so cleanup can never
  // drift from the key format the production erase path actually deletes.
  afterAll(async () => {
    if (!HAS_ALL_CREDS) return;
    await deleteShadowChatIntent(NX_WARM_TENANT_ID, NX_WARM_SESSION_ID);
    await deleteShadowChatIntent(NX_COLD_TENANT_ID, NX_COLD_SESSION_ID);
  });

  /**
   * AC1(a) — warm key. A signal-bearing payload is written first (unconditional
   * `SET`, real TTL=86400). A SECOND, empty-dimension payload
   * (`data_source == "model"` — AC2, a neutral success, NOT a degraded-only
   * fixture) is then written for the SAME {tenant, session}. Per ADR-0020
   * D3/D4, `SET … NX` against the now-existing key must perform NO mutation:
   * neither the stored value NOR the TTL may change. This test FAILS if
   * `nx=True` is removed from `redis_writer.py:130` (verified locally against
   * a real dockerised Redis — see the FOLLOW-752 PR body for the mutation
   * red/green evidence).
   */
  it.skipIf(!HAS_ALL_CREDS)(
    'AC1(a): a warm key — an empty-dimension write neither clobbers the prior value nor refreshes its TTL',
    async () => {
      // Step 1: signal-bearing write — unconditional overwrite branch.
      runNxWriter(NX_WARM_TENANT_ID, NX_WARM_SESSION_ID, 'signal');
      const ttlAfterSignal = await fetchTtl(NX_WARM_TENANT_ID, NX_WARM_SESSION_ID);
      expect(
        ttlAfterSignal,
        'TTL after the signal-bearing write must reflect the fresh ex=86400.',
      ).toBeGreaterThan(EXPECTED_TTL_SECONDS - 60);

      // Let enough wall-clock time pass that a refreshed TTL would be
      // distinguishable from a preserved one.
      await sleep(2_500);

      // Step 2: empty-dimension write for the SAME key — must hit `SET … NX`
      // and therefore perform NO mutation at all.
      runNxWriter(NX_WARM_TENANT_ID, NX_WARM_SESSION_ID, 'empty');

      // Assert via the REAL readShadowChatIntent that the FIRST (signal) record
      // is what comes back, not the second (empty) one.
      const result = await readShadowChatIntent(NX_WARM_TENANT_ID, NX_WARM_SESSION_ID);
      expect(
        result,
        'readShadowChatIntent returned null for the warm-key NX case — expected the ' +
          'preserved signal-bearing record.',
      ).not.toBeNull();
      expect(
        result!.intent_dimensions.purchase_purpose,
        'The empty-dimension write clobbered the stored prior — nx=True is not being ' +
          'honoured by the real Redis instance.',
      ).toBe(NX_SIGNAL_PURCHASE_PURPOSE);
      expect(result!.archetype_hint).toBe(NX_SIGNAL_ARCHETYPE_HINT);
      expect(result!.confidence).toBeCloseTo(NX_SIGNAL_CONFIDENCE, 2);

      // ADR-0020 D4: the empty write must not refresh the retention clock. A
      // value-equality assertion alone would pass even if the TTL had been
      // reset to 86400 — this is the half that catches that regression.
      const ttlAfterEmpty = await fetchTtl(NX_WARM_TENANT_ID, NX_WARM_SESSION_ID);
      expect(
        ttlAfterEmpty,
        `TTL was refreshed by the empty-dimension write (ttlAfterEmpty=${String(ttlAfterEmpty)} ` +
          `>= ttlAfterSignal=${String(ttlAfterSignal)}). ADR-0020 D4 requires the residual ` +
          'lifetime to only ever shorten or stay unchanged, never extend.',
      ).toBeLessThan(ttlAfterSignal);
      expect(ttlAfterEmpty).toBeGreaterThan(0);
    },
  );

  /**
   * AC1(b) — cold key. An empty-dimension payload (`data_source == "model"`,
   * AC2) written on a FRESH session_id — no prior exists — IS stored, with its
   * markers intact (the record is not silently dropped or altered because it
   * carries no signal; `SET … NX` succeeds unconditionally against a key that
   * does not yet exist).
   */
  it.skipIf(!HAS_ALL_CREDS)(
    'AC1(b): a cold key — an empty-dimension write on a fresh session IS stored, markers intact',
    async () => {
      // Ensure the key is genuinely cold via the PRODUCTION delete path (idempotent).
      await deleteShadowChatIntent(NX_COLD_TENANT_ID, NX_COLD_SESSION_ID);

      runNxWriter(NX_COLD_TENANT_ID, NX_COLD_SESSION_ID, 'empty');

      const result = await readShadowChatIntent(NX_COLD_TENANT_ID, NX_COLD_SESSION_ID);
      expect(
        result,
        'readShadowChatIntent returned null for the cold-key NX case — the create-only ' +
          'SET … NX write did not land against a genuinely absent key.',
      ).not.toBeNull();

      // Markers intact: all 12 dimensions null, and the provenance fields the
      // write carried survive untouched (ADR-0020 D6 — no merge, no stitching).
      expect(result!.intent_dimensions.purchase_purpose ?? null).toBeNull();
      expect(result!.archetype_hint).toBe('neutral');
      expect(result!.confidence).toBeCloseTo(0, 2);
      expect((result as unknown as { data_source?: string }).data_source).toBe('model');

      const ttl = await fetchTtl(NX_COLD_TENANT_ID, NX_COLD_SESSION_ID);
      expect(ttl).toBeGreaterThan(EXPECTED_TTL_SECONDS - 60);
      expect(ttl).toBeLessThanOrEqual(EXPECTED_TTL_SECONDS);
    },
  );
});
