// @vitest-environment node
// (the package default is jsdom, whose global `URL` `createRequire()` rejects at the harness's
// top-level Playwright resolution)

/**
 * FOLLOW-1186 — AC(1) of the FOLLOW-819 harness must not pass on a response nobody adapted.
 *
 * Drives the REAL verdict function out of `differentiator-e2e.mjs` (imported, not copied) with
 * response bodies shaped exactly as `apps/control-plane/src/app/api/adapt/route.ts` assembles them
 * at HEAD. Each shape names the return site it mirrors, so a reviewer can diff the fixture against
 * the route rather than trust it:
 *
 *   - `runDecisionTree()` branch 3, gateway `null`: `withholdUngroundedDirectives(await
 *     resolvePlaybook())` → only the `cta` survives (`NON_ASSERTIVE_SLOTS` in
 *     `lib/ungrounded-directives.ts`), `source: 'playbook_fallback_llm_unavailable'`,
 *     `fallback_reason` = the gateway's `onFallback` reason, `variant_suppressed` → the POST
 *     handler records `variant: 'control'`.
 *   - branch 2: the same withhold, `source: 'playbook'`, `fallback_reason:
 *     'ungrounded_directives_withheld'`.
 *   - branch 3 success: `{ directives: gatewayResult.directives, source: 'llm_tweaked' }`, no
 *     `fallback_reason`.
 *   - the POST handler then filters by page type and appends a `reorder` directive when the tenant
 *     has a schema and `listing_ids` — on EVERY source, including `default`.
 *
 * WHAT THIS DOES NOT COVER: whether the live route still produces these shapes. That is the manual
 * harness run itself (README §3); this file pins the verdict over a population, not the population.
 *
 * Red-first, executed (not reasoned): the pre-fix predicate passes the refusal, outage and template
 * fixtures below — transcripts are in the FOLLOW-1186 PR body.
 *
 * Collected by `tests/e2e/vitest.config.ts` (`**\/*.test.ts`); run by `pnpm e2e:smoke`, which
 * `.github/workflows/e2e-smoke.yml` executes nightly. It needs no substrate and takes no flag.
 *
 * @module tests/e2e/follow-819/ac1-verdict.test
 */

import { beforeAll, describe, expect, it } from 'vitest';

interface Ac1Verdict {
  ok: boolean;
  summary: string;
  evidence: {
    outcomes: Record<string, number>;
    sourcesObserved: Record<string, number>;
    legacy: { wouldHavePassed: boolean };
  };
}
type EvaluateAc1 = (responses: readonly object[], serverGate: { value: number }) => Ac1Verdict;

let evaluateAc1: EvaluateAc1;

beforeAll(async () => {
  // The harness runs main() at import unless told not to — see the guard at its foot.
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const mod = (await import('./differentiator-e2e.mjs')) as { evaluateAc1: EvaluateAc1 };
  evaluateAc1 = mod.evaluateAc1;
});

/** `readServerConfidenceGate()` reads 0.6 with `<=` from route.ts at HEAD. */
const GATE = {
  value: 0.6,
  comparison: '<=',
  source: 'apps/control-plane/src/app/api/adapt/route.ts',
};

const ARCH = 'yield_hunter';

const text = (slot: string, value: string) => ({
  type: 'text',
  slot,
  value,
  archetype: ARCH,
  confidence: 1,
});

/** Appended by the POST handler after runDecisionTree() — independent of `source`. */
const reorder = (archetype: string, confidence: number) => ({
  type: 'reorder',
  container_selector: '[data-estalara-listing]',
  item_selector: '[data-estalara-listing-id]',
  score_function: 'archetype_affinity',
  scores: [{ listing_id: 'fixture-listing-1', score: 0.349 }],
  archetype,
  confidence,
});

/** The POST handler's `response: AdaptationDirectives` literal, key order included. */
const body = (fields: Record<string, unknown>) => ({
  adapt_decision_id: 'adapt-decision-fixture',
  session_id: 'session-fixture',
  archetype: ARCH,
  confidence: 1,
  similarity: 0.85,
  page_context: 2,
  directives: [] as object[],
  source: 'default',
  variant: 'control',
  generated_at: '2026-09-13T00:00:00.000Z',
  ...fields,
});

/** Branch 3 (0.6 < similarity <= 0.85), gateway null because the fact check refused the batch. */
const refused = body({
  directives: [text('cta', 'Request Investment Pack'), reorder(ARCH, 1)],
  source: 'playbook_fallback_llm_unavailable',
  fallback_reason: 'fact_check_refused',
});

/** Branch 3, gateway null because the model never answered. */
const outage = body({
  directives: [text('cta', 'Request Investment Pack')],
  source: 'playbook_fallback_llm_unavailable',
  fallback_reason: 'llm_unavailable',
});

/** Branch 2 (similarity > 0.85): template copy, assertive slots withheld. */
const template = body({
  similarity: 0.8552,
  directives: [text('cta', 'Request Investment Pack'), reorder(ARCH, 1)],
  source: 'playbook',
  fallback_reason: 'ungrounded_directives_withheld',
});

/** Arm A's cold-start response: below the gate, neutral, and still carrying a reorder. */
const neutralDefault = body({
  archetype: 'neutral',
  confidence: 0.36554663991975933,
  similarity: 0.36554663991975933,
  page_context: 1,
  directives: [reorder('neutral', 0.36554663991975933)],
  source: 'default',
  variant: 'default',
});

/** Branch 3 success — the 2026-08-26 6/6 run's served slots. */
const tweaked = body({
  directives: [
    text('headline', 'Rental Yield: {yield}% | Gross Income: {income}/yr'),
    text('cta', 'Request Investment Pack'),
    text('feature', 'Investment Performance'),
    reorder(ARCH, 1),
  ],
  source: 'llm_tweaked',
  variant: 'v1',
});

/** Branch 4 (similarity <= 0.6) success. */
const full = body({
  similarity: 0.41,
  directives: [text('headline', 'Gross Yield Stated in the Listing'), reorder(ARCH, 1)],
  source: 'llm_full',
});

/** An `llm_tweaked` batch whose only text directive was the headline, on a non-detail page. */
const tweakedButStripped = body({
  page_context: 1,
  directives: [reorder(ARCH, 1)],
  source: 'llm_tweaked',
});

/**
 * The VERDICT table. Only `ok` is asserted here, so the same table can be driven against the
 * pre-fix predicate and read as a clean pass/fail split (the pre-fix code had no reporting).
 */
const VERDICTS: readonly [name: string, responses: readonly object[], adapted: boolean][] = [
  // The direction that was reported: a REFUSED batch read as adapted.
  ['branch-3 fact_check_refused (cta)', [refused], false],
  ['branch-3 llm_unavailable (cta)', [outage], false],
  ['branch-2 playbook (cta after withhold)', [template], false],
  ['default + refused + playbook session', [neutralDefault, refused, template], false],
  ['llm_tweaked with only a reorder left', [neutralDefault, tweakedButStripped], false],
  // Rule Q amendment 1 clause 5: the empty population is a negative control, executed.
  ['empty population', [], false],
  ['llm_tweaked at exactly the gate', [{ ...tweaked, confidence: 0.6 }], false],
  // The silent direction of the NEW predicate: it must not refuse real adaptation.
  ['llm_tweaked (positive control)', [tweaked], true],
  ['llm_full', [full], true],
  ['llm_tweaked after playbook + refused', [neutralDefault, template, refused, tweaked], true],
];

describe('FOLLOW-1186 verdict — AC(1) grades adaptation, not a directive count', () => {
  it.each(VERDICTS.map(([name, responses, adapted]) => ({ name, responses, adapted })))(
    '$name → adapted=$adapted',
    ({ responses, adapted }) => {
      expect(evaluateAc1(responses, GATE).ok).toBe(adapted);
    },
  );
});

describe('FOLLOW-1186 reporting — the PASS/FAIL line prints what it counted', () => {
  it('names the refusal and counts zero adapted', () => {
    const v = evaluateAc1([refused], GATE);
    expect(v.evidence.outcomes).toMatchObject({ adapted: 0, refused: 1 });
    expect(v.summary).toContain('0 of 1 responses adapted');
    expect(v.summary).toContain('playbook_fallback_llm_unavailable/fact_check_refused×1');
    expect(v.evidence.legacy.wouldHavePassed).toBe(true);
  });

  it('separates outage, template and default from refusal', () => {
    const v = evaluateAc1([neutralDefault, outage, template], GATE);
    expect(v.evidence.outcomes).toMatchObject({
      adapted: 0,
      refused: 0,
      outage: 1,
      template: 1,
      default: 1,
    });
  });

  it('counts an llm_* source separately from whether it adapted anything', () => {
    const v = evaluateAc1([neutralDefault, tweakedButStripped], GATE);
    expect(v.evidence.outcomes).toMatchObject({ adapted: 1 });
    expect(v.summary).toContain('0 of 2 responses adapted');
  });

  it('prints the empty population as empty', () => {
    expect(evaluateAc1([], GATE).summary).toContain('0 of 0 responses adapted');
    expect(evaluateAc1([], GATE).summary).toContain('sources observed: none');
  });

  it('prints the adapted response and its slots', () => {
    const v = evaluateAc1([neutralDefault, template, refused, tweaked], GATE);
    expect(v.summary).toContain('1 of 4 responses adapted');
    expect(v.summary).toContain(
      'first: llm_tweaked yield_hunter @ 1 slots [headline, cta, feature]',
    );
  });
});
