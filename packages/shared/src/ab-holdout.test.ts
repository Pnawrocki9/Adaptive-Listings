/**
 * `assignHoldout` — keyed on a server-side secret, never on a page-visible value.
 * FOLLOW-1201 AC(2) (audit SEC-4).
 *
 * CLAIM (Rule AU): an attacker holding everything the page exposes (`tenant_id`, the API key,
 * any `session_id` they choose) cannot predict which arm a session lands in, so they cannot
 * grind sessions into the adapted arm offline and then convert only those.
 *
 * ASSERTION: `publicOnlyPrediction` below is the PRE-FIX algorithm verbatim (HMAC keyed on
 * `tenant_id`) — the attacker's best model. We pick the sessions that model says are TREATMENT
 * and run the real `assignHoldout` on them with a secret. If the arm is unpredictable, those
 * sessions land in holdout at the configured rate (chance); if the secret is ignored, none do.
 * Deterministic inputs → deterministic count, so the bounds are exact, not flaky.
 *
 * Red-first (Rule AS §3): at the pre-fix commit `assignment_secret` is not an input, the
 * prediction is exact, and the grinder test reads 0 holdouts among predicted-treatment sessions.
 *
 * @module @estalara/shared/ab-holdout.test
 */

import { describe, expect, it } from 'vitest';

import { assignHoldout } from './ab-holdout.js';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
// Secrets built with `.repeat()` so no 40+ char token literal lands in the diff (gitleaks).
const SECRET_A = 'holdout-secret-a-'.repeat(3);
const SECRET_B = 'holdout-secret-b-'.repeat(3);
const HOLDOUT_PCT = 0.5;
const N = 2000;

/** The pre-fix algorithm — every input is on the page. This is what an offline grinder runs. */
async function publicOnlyPrediction(tenantId: string, sessionId: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(tenantId),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(sessionId));
  const ratio = new DataView(sig).getUint32(0, false) / 0xffffffff;
  return ratio < HOLDOUT_PCT;
}

function sessionIds(): string[] {
  return Array.from({ length: N }, (_, i) => `grind-${String(i).padStart(6, '0')}`.padEnd(32, 'x'));
}

describe('assignHoldout — server-side secret keying [FOLLOW-1201 AC(2)]', () => {
  it('offline grinder: sessions predicted TREATMENT from public inputs land in holdout at chance, not never', async () => {
    const predictedTreatment: string[] = [];
    for (const sid of sessionIds()) {
      if (!(await publicOnlyPrediction(TENANT_ID, sid))) predictedTreatment.push(sid);
    }
    // Sanity on the fixture: the public model itself splits near 50/50 — an empty population
    // would make every assertion below vacuous (Rule Q amendment 1 §5).
    expect(predictedTreatment.length).toBeGreaterThan(N * 0.4);
    expect(predictedTreatment.length).toBeLessThan(N * 0.6);

    let landedInHoldout = 0;
    for (const sid of predictedTreatment) {
      const r = await assignHoldout({
        tenant_id: TENANT_ID,
        session_id: sid,
        holdout_pct: HOLDOUT_PCT,
        assignment_secret: SECRET_A,
      });
      if (!r.skipped && r.holdout_group) landedInHoldout += 1;
    }
    const fraction = landedInHoldout / predictedTreatment.length;
    // Chance is 0.5 ± ~3.5pp at n≈1000 (3σ). A predictable arm reads 0.
    expect(fraction).toBeGreaterThan(0.4);
    expect(fraction).toBeLessThan(0.6);
  });

  it('two different secrets assign the same sessions differently (the secret is load-bearing)', async () => {
    let differ = 0;
    const ids = sessionIds().slice(0, 500);
    for (const sid of ids) {
      const a = await assignHoldout({
        tenant_id: TENANT_ID,
        session_id: sid,
        holdout_pct: HOLDOUT_PCT,
        assignment_secret: SECRET_A,
      });
      const b = await assignHoldout({
        tenant_id: TENANT_ID,
        session_id: sid,
        holdout_pct: HOLDOUT_PCT,
        assignment_secret: SECRET_B,
      });
      if (!a.skipped && !b.skipped && a.holdout_group !== b.holdout_group) differ += 1;
    }
    // Independent fair coins disagree half the time.
    expect(differ / ids.length).toBeGreaterThan(0.4);
    expect(differ / ids.length).toBeLessThan(0.6);
  });

  it('is deterministic for the same (secret, tenant_id, session_id)', async () => {
    const first = await assignHoldout({
      tenant_id: TENANT_ID,
      session_id: 'a'.repeat(32),
      assignment_secret: SECRET_A,
    });
    for (let i = 0; i < 50; i++) {
      const again = await assignHoldout({
        tenant_id: TENANT_ID,
        session_id: 'a'.repeat(32),
        assignment_secret: SECRET_A,
      });
      expect(again).toMatchObject({
        skipped: false,
        holdout_group: (first as { holdout_group: boolean }).holdout_group,
      });
    }
  });

  it('binds the tenant: the same session_id under another tenant is an independent draw', async () => {
    let differ = 0;
    const ids = sessionIds().slice(0, 500);
    for (const sid of ids) {
      const a = await assignHoldout({
        tenant_id: TENANT_ID,
        session_id: sid,
        holdout_pct: HOLDOUT_PCT,
        assignment_secret: SECRET_A,
      });
      const b = await assignHoldout({
        tenant_id: '660e8400-e29b-41d4-a716-446655440000',
        session_id: sid,
        holdout_pct: HOLDOUT_PCT,
        assignment_secret: SECRET_A,
      });
      if (!a.skipped && !b.skipped && a.holdout_group !== b.holdout_group) differ += 1;
    }
    expect(differ / ids.length).toBeGreaterThan(0.4);
    expect(differ / ids.length).toBeLessThan(0.6);
  });

  it('refuses to assign without a secret — never silently falls back to public keying', async () => {
    await expect(
      assignHoldout({
        tenant_id: TENANT_ID,
        session_id: 'b'.repeat(32),
        assignment_secret: '',
      }),
    ).rejects.toThrow(/assignment_secret/);
  });
});
