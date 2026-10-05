// @vitest-environment node
// (the package default is jsdom, whose global `URL` `createRequire()` rejects at the harness's
// top-level Playwright resolution — same reason ac1-verdict.test.ts pins this)

/**
 * FOLLOW-1300 — AC(4) under the bandit freeze must grade a HOLDOUT draw as UNMEASURED, not RED.
 *
 * A holdout response carries no `variant` field, so "every served variant is control" cannot hold
 * on a held-out session. A RED resets the condition-1 series; a holdout draw is neutral (series
 * rule (2)). Drives the REAL `evaluateAc4Frozen()` and `gradeRun()` out of
 * `differentiator-e2e.mjs` (imported, not copied). The holdout flag in the grade rows is not
 * hand-set on the result: it is `holdoutFromResponses()` run over the same bodies.
 *
 * Collected by `tests/e2e/vitest.config.ts`; needs no substrate and takes no flag.
 *
 * @module tests/e2e/follow-819/ac4-verdict.test
 */

import { beforeAll, describe, expect, it } from 'vitest';

interface Ac4In {
  httpStatus: number;
  reason: string | null;
  armMoved: boolean;
  servedBodies: unknown[];
  loggedVariants: string[];
  drewHoldout: boolean | null;
}
interface Ac4Out {
  ok: boolean;
  unmeasured: 'holdout' | null;
}
interface Graded {
  ac: string;
  verdict: 'PASS' | 'FAIL' | 'UNMEASURED';
  unmeasuredBecause: string | null;
}

let evaluateAc4Frozen: (i: Ac4In) => Ac4Out;
let holdoutFromResponses: (bodies: unknown[]) => { drewHoldout: boolean | null };
let gradeRun: (
  results: readonly { ac: string; name: string; ok: boolean; evidence?: unknown }[],
  facts: { adaptedArmDrewHoldout: boolean | null; adaptedResponsesArrivedAfterVerdict: number },
) => { results: Graded[]; runVerdict: string; tallyLine: string };

beforeAll(async () => {
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const mod = (await import('./differentiator-e2e.mjs')) as {
    evaluateAc4Frozen: typeof evaluateAc4Frozen;
    holdoutFromResponses: typeof holdoutFromResponses;
    gradeRun: typeof gradeRun;
  };
  evaluateAc4Frozen = mod.evaluateAc4Frozen;
  holdoutFromResponses = mod.holdoutFromResponses;
  gradeRun = mod.gradeRun;
});

const control = { archetype: 'yield_hunter', variant: 'control', directives: [{ type: 'cta' }] };
const holdoutBody = { holdout_group: true, archetype: 'neutral', directives: [] };

/** A frozen run in which everything held. */
function green(over: Partial<Ac4In> = {}): Ac4In {
  const servedBodies = over.servedBodies ?? [control, control];
  return {
    httpStatus: 404,
    reason: 'bandit_disabled',
    armMoved: false,
    servedBodies,
    loggedVariants: ['control'],
    drewHoldout: holdoutFromResponses(servedBodies).drewHoldout,
    ...over,
  };
}

describe('FOLLOW-1300 — evaluateAc4Frozen()', () => {
  it('PASS when the ping is refused, nothing moved and every variant is control', () => {
    expect(evaluateAc4Frozen(green())).toMatchObject({ ok: true, unmeasured: null });
  });

  it('UNMEASURED:holdout when the session drew holdout (bodies carry no variant)', () => {
    const i = green({ servedBodies: [holdoutBody, holdoutBody], loggedVariants: [''] });
    expect(i.drewHoldout).toBe(true); // sourced from holdoutFromResponses, not hand-set
    expect(evaluateAc4Frozen(i)).toEqual(
      expect.objectContaining({ ok: false, unmeasured: 'holdout' }),
    );
  });

  it('RED when a NON-holdout response is missing `variant`', () => {
    const i = green({ servedBodies: [control, { archetype: 'x', directives: [] }] });
    expect(i.drewHoldout).toBe(false);
    expect(evaluateAc4Frozen(i)).toMatchObject({ ok: false, unmeasured: null });
  });

  it.each(['v1', 'v2'])('RED when a served response carries %s', (v) => {
    const r = evaluateAc4Frozen(green({ servedBodies: [control, { ...control, variant: v }] }));
    expect(r).toMatchObject({ ok: false, unmeasured: null });
  });

  it('RED when a logged row is not control', () => {
    expect(evaluateAc4Frozen(green({ loggedVariants: ['control', 'v1'] }))).toMatchObject({
      ok: false,
      unmeasured: null,
    });
  });

  it.each([202, 503])('RED when the ping answers %i, even on a holdout draw', (httpStatus) => {
    expect(evaluateAc4Frozen(green({ httpStatus }))).toMatchObject({ ok: false, unmeasured: null });
    const held = green({
      httpStatus,
      servedBodies: [holdoutBody],
      loggedVariants: [''],
    });
    expect(evaluateAc4Frozen(held)).toMatchObject({ ok: false, unmeasured: null });
  });

  it('RED when the arm moved, even on a holdout draw', () => {
    const held = green({ armMoved: true, servedBodies: [holdoutBody], loggedVariants: [''] });
    expect(evaluateAc4Frozen(held)).toMatchObject({ ok: false, unmeasured: null });
  });
});

describe('FOLLOW-1300 — gradeRun() over AC(4)', () => {
  const frozenEv = (over: Record<string, unknown> = {}) => ({
    mode: 'bandit_frozen',
    httpStatus: 404,
    reason: 'bandit_disabled',
    armMoved: false,
    ...over,
  });
  const facts = (drew: boolean | null) => ({
    adaptedArmDrewHoldout: drew,
    adaptedResponsesArrivedAfterVerdict: 0,
  });

  it('counts a holdout-drawn frozen AC(4) as UNMEASURED:holdout in the TALLY', () => {
    const g = gradeRun([{ ac: 'AC(4)', name: 'n', ok: false, evidence: frozenEv() }], facts(true));
    expect(g.results[0]).toMatchObject({ verdict: 'UNMEASURED', unmeasuredBecause: 'holdout' });
    expect(g.tallyLine).toBe('TALLY green=0 red=0 unmeasured=1 total=1 run=UNMEASURED');
  });

  it('stays RED without a holdout draw', () => {
    const g = gradeRun([{ ac: 'AC(4)', name: 'n', ok: false, evidence: frozenEv() }], facts(false));
    expect(g.results[0]).toMatchObject({ verdict: 'FAIL', unmeasuredBecause: null });
    expect(g.runVerdict).toBe('RED');
  });

  it.each([
    ['ping 202', { httpStatus: 202 }],
    ['ping 503', { httpStatus: 503 }],
    ['moved arm', { armMoved: true }],
  ])('stays RED on a holdout draw when %s', (_n, over) => {
    const g = gradeRun(
      [{ ac: 'AC(4)', name: 'n', ok: false, evidence: frozenEv(over) }],
      facts(true),
    );
    expect(g.results[0]).toMatchObject({ verdict: 'FAIL', unmeasuredBecause: null });
  });

  it('flag-on path (mode bandit_live) is untouched: a failure stays RED on a holdout draw', () => {
    const ev = { mode: 'bandit_live', httpStatus: 202 };
    const g = gradeRun([{ ac: 'AC(4)', name: 'n', ok: false, evidence: ev }], facts(true));
    expect(g.results[0]).toMatchObject({ verdict: 'FAIL', unmeasuredBecause: null });
  });

  it('a PASS is never turned into UNMEASURED', () => {
    const g = gradeRun([{ ac: 'AC(4)', name: 'n', ok: true, evidence: frozenEv() }], facts(true));
    expect(g.results[0]?.verdict).toBe('PASS');
  });
});
