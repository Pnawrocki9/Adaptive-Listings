/**
 * scripts/feedback-canary.mts — operator canary for FOLLOW-450 AC2.
 *
 * Purpose:
 *   Proves, against a real deployment, that `POST /api/adapt/feedback` is
 *   enabled (`FEEDBACK_ENDPOINT_ENABLED=true`) and that a signed ping actually
 *   moves a real `ab_bandit_weights` row — not just that the endpoint returns
 *   202. Run this ONCE right after flipping `FEEDBACK_ENDPOINT_ENABLED=true`
 *   in Doppler prd (ADR-0015 §Lifting the interim 503), and any time the
 *   endpoint's live status needs re-verification.
 *
 * Scope (ADR-0015 permanent ops-bypass disposition):
 *   Uses the `ADAPT_API_KEY` ops-bypass credential, which is PERMANENTLY
 *   scoped to `OPS_TENANT_ID` (ADR-0015 §ADAPT_API_KEY ops bypass). The canary
 *   writes ONLY to a dedicated `(OPS_TENANT_ID, CANARY_ARCHETYPE,
 *   CANARY_VARIANT)` row — never to a real tenant's arms — and reverts that
 *   row to its pre-canary state after observing the delta, so repeated runs
 *   never let the canary's own Beta counters drift or leave a stray row
 *   behind on a fresh tenant.
 *
 * What it proves:
 *   1. The endpoint is reachable and returns 202 (not 503 — endpoint enabled;
 *      not 401/403 — ADAPT_API_KEY + OPS_TENANT_ID are correctly provisioned).
 *   2. The fire-and-forget `after()` write actually lands: polls
 *      `ab_bandit_weights` directly via `DATABASE_URL_ADMIN` until the row
 *      reflects the exact delta `updateBanditArm()` would produce, or fails
 *      loud (non-zero exit) if it never lands within the timeout — this
 *      script does NOT declare success on the HTTP 202 alone, because a 202
 *      only proves the request was accepted, not that Thompson sampling
 *      state actually moved (the audit F-06 gap this ticket closes).
 *
 * Usage (from repo root, after Doppler prd has FEEDBACK_ENDPOINT_ENABLED=true,
 * ADAPT_API_KEY, and OPS_TENANT_ID provisioned):
 *
 *   FEEDBACK_URL=https://app.estalara.com/api/adapt/feedback \
 *   ADAPT_API_KEY=<doppler-prd-value> \
 *   OPS_TENANT_ID=<doppler-prd-value> \
 *   DATABASE_URL_ADMIN=<doppler-prd-value> \
 *     pnpm feedback:canary
 *
 * Or, with Doppler wired to prd:
 *   doppler run --config prd -- pnpm feedback:canary
 *
 * Exit codes:
 *   0 — canary ping observed a real Beta delta; row reverted cleanly.
 *   1 — misconfiguration (missing env var), non-202 HTTP response, or the
 *       delta never landed within the poll timeout. Never silently "passes"
 *       on an unverified write (Rule K.2 — this ops tool must fail loud too).
 *
 * @module apps/control-plane/scripts/feedback-canary
 */

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { createAdminClient, abBanditWeights } from '@estalara/db';
import { updateBanditArm } from '@estalara/shared';

// ─── Canary identifiers ────────────────────────────────────────────────────
//
// Dedicated archetype/variant pair — never used by real playbooks or SEED_VARIANTS
// (see apps/control-plane/src/lib/bandit-query.ts) — so this row never mixes with
// production Thompson sampling arms even though it lives under OPS_TENANT_ID.

export const CANARY_ARCHETYPE = 'estalara_ops_canary';
export const CANARY_VARIANT = 'estalara_ops_canary_v1';

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 10; // ~15s total — afterResponse() on Vercel completes well within this.

// ─── Pure helpers (unit-tested in feedback-canary.test.ts) ────────────────

export interface BanditRow {
  alpha: number;
  beta: number;
}

/**
 * The exact row state expected after the canary ping, given the pre-ping row
 * (or Beta(1,1) if no row existed yet — mirrors `updateArmAsync`'s
 * "missing row → treat as Beta(1,1)" convention in feedback/route.ts).
 */
export function expectedAfter(before: BanditRow | null, converted: boolean): BanditRow {
  const start = before ?? { alpha: 1.0, beta: 1.0 };
  return updateBanditArm(start.alpha, start.beta, converted);
}

/** True iff `actual` exactly matches the expected post-ping Beta parameters. */
export function deltaObserved(actual: BanditRow | null, expected: BanditRow): boolean {
  if (!actual) return false;
  return actual.alpha === expected.alpha && actual.beta === expected.beta;
}

// ─── DB helpers ─────────────────────────────────────────────────────────────

async function readRow(
  db: ReturnType<typeof createAdminClient>,
  opsTenantId: string,
): Promise<BanditRow | null> {
  const rows = await db
    .select({ alpha: abBanditWeights.alpha, beta: abBanditWeights.beta })
    .from(abBanditWeights)
    .where(
      and(
        eq(abBanditWeights.tenantId, opsTenantId),
        eq(abBanditWeights.archetype, CANARY_ARCHETYPE),
        eq(abBanditWeights.variant, CANARY_VARIANT),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const feedbackUrl = process.env.FEEDBACK_URL;
  const adaptApiKey = process.env.ADAPT_API_KEY;
  const opsTenantId = process.env.OPS_TENANT_ID;
  const adminUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;

  const missing = [
    !feedbackUrl && 'FEEDBACK_URL',
    !adaptApiKey && 'ADAPT_API_KEY',
    !opsTenantId && 'OPS_TENANT_ID',
    !adminUrl && 'DATABASE_URL_ADMIN (or DATABASE_URL_DIRECT)',
  ].filter((v): v is string => Boolean(v));

  if (missing.length > 0) {
    console.error(
      `[feedback-canary] ERROR: missing required env var(s): ${missing.join(', ')}.\n` +
        'This canary requires the live prod (or staging) endpoint URL, the ADAPT_API_KEY ' +
        'ops-bypass credential, its scoped OPS_TENANT_ID, and direct DB access to verify ' +
        'the write actually landed (HTTP 202 alone does not prove a bandit-state change).',
    );
    process.exit(1);
  }

  const db = createAdminClient();

  console.log(
    `[feedback-canary] Reading pre-ping state for (tenant=${opsTenantId!}, ` +
      `archetype=${CANARY_ARCHETYPE}, variant=${CANARY_VARIANT})…`,
  );
  const before = await readRow(db, opsTenantId!);
  console.log(
    `[feedback-canary] Before: ${before ? JSON.stringify(before) : '(no row — Beta(1,1) default)'}`,
  );

  const expected = expectedAfter(before, /* converted= */ true);

  const body = JSON.stringify({
    session_id: `canary-${randomUUID()}`,
    tenant_id: opsTenantId,
    archetype: CANARY_ARCHETYPE,
    variant: CANARY_VARIANT,
    converted: true,
  });

  // ADR-0015 §Step 2 (ops bypass): bearerToken === ADAPT_API_KEY skips the
  // SHA-256 api_keys lookup AND the HMAC body-signature check entirely — no
  // X-Estalara-Signature header is required or sent on this path.
  console.log('[feedback-canary] POSTing canary ping (ops-bypass auth)…');
  const res = await fetch(feedbackUrl!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adaptApiKey!}`,
    },
    body,
  });

  if (res.status !== 202) {
    const text = await res.text().catch(() => '');
    console.error(
      `[feedback-canary] FAIL: expected 202 Accepted, got ${res.status}. Body: ${text}\n` +
        'This usually means FEEDBACK_ENDPOINT_ENABLED is not true, or ADAPT_API_KEY / ' +
        'OPS_TENANT_ID are misconfigured in this environment.',
    );
    process.exit(1);
  }
  console.log('[feedback-canary] 202 Accepted. Polling for the async bandit-weights write…');

  let observed: BanditRow | null = null;
  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    observed = await readRow(db, opsTenantId!);
    if (deltaObserved(observed, expected)) {
      console.log(
        `[feedback-canary] PASS: observed real ab_bandit_weights delta after ${attempt} poll(s). ` +
          `After: ${JSON.stringify(observed)} (expected ${JSON.stringify(expected)}).`,
      );
      break;
    }
  }

  const passed = deltaObserved(observed, expected);

  // ── Revert: restore pre-canary state so this ops tenant's row never drifts
  // and repeated runs stay idempotent (Rule K.2 spirit — an ops script must not
  // leave production state altered as a side effect of a health check).
  console.log('[feedback-canary] Reverting canary row to pre-ping state…');
  if (before === null) {
    await db
      .delete(abBanditWeights)
      .where(
        and(
          eq(abBanditWeights.tenantId, opsTenantId!),
          eq(abBanditWeights.archetype, CANARY_ARCHETYPE),
          eq(abBanditWeights.variant, CANARY_VARIANT),
        ),
      );
    console.log(
      '[feedback-canary] Reverted: deleted the canary row (it did not exist before this run).',
    );
  } else {
    await db
      .update(abBanditWeights)
      .set({ alpha: before.alpha, beta: before.beta, updatedAt: new Date() })
      .where(
        and(
          eq(abBanditWeights.tenantId, opsTenantId!),
          eq(abBanditWeights.archetype, CANARY_ARCHETYPE),
          eq(abBanditWeights.variant, CANARY_VARIANT),
        ),
      );
    console.log(`[feedback-canary] Reverted: restored alpha=${before.alpha}, beta=${before.beta}.`);
  }

  if (!passed) {
    console.error(
      `[feedback-canary] FAIL: no bandit-weights delta observed within ${
        (POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000
      }s. The endpoint accepted the ping (202) but the async DB write never landed — ` +
        'the feedback loop is NOT confirmed live.',
    );
    process.exit(1);
  }

  console.log('[feedback-canary] Canary complete — the feedback/bandit loop is confirmed live.');
}

// ─── Entrypoint guard (mirrors seed-local-tenant.mts) ──────────────────────

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('feedback-canary.mts') ||
    process.argv[1].endsWith('feedback-canary.ts') ||
    process.argv[1].endsWith('feedback-canary.js'));

if (isMain) {
  main().catch((err: unknown) => {
    console.error(
      '[feedback-canary] Fatal error:',
      err instanceof Error ? (err.stack ?? err.message) : err,
    );
    process.exit(1);
  });
}

export { main as runFeedbackCanary };
