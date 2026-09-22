// @vitest-environment node
// (the package default is jsdom, whose global `URL` `createRequire()` rejects at the harness's
// top-level Playwright resolution — same reason the sibling files pin this)

/**
 * FOLLOW-1240 — the FOLLOW-819 run's TALLY must say UNMEASURED where the adapted axis was not
 * measured, and must never print a bare `N/6 green` over such a run.
 *
 * WHAT THIS CLOSES. Two runs drew holdout on the browser session: FOLLOW-1239 substrate run 2
 * (session `6f1f169e-…`, 2026-09-20) and #920 run 3 (session `ed12d87f-…`, 2026-09-21). Both printed
 * `2/6 acceptance criteria green`, counting AC(1), AC(2) and AC(7) as RED, while the same run's
 * `[FOLLOW-1098]` line — printed ~35 s LATER, below AC(4) — said those ACs were "UNMEASURED … NOT
 * failed". A FOLLOW-820 grader quotes the tally, not the warning. RETRO-339/340 add a second axis:
 * `adaptedResponsesArrivedAfterVerdict > 0` next to a RED AC(1) is the observation window's red, not
 * the product's, and until now only a human reading README §3.6 acted on it.
 *
 * WHAT IS REAL HERE. AC(1) and AC(7) results are produced by the harness's own `evaluateAc1()` and
 * `evaluateAc7()` over the holdout session's bodies (rebuilt from its ClickHouse rows — see
 * `settle-on-response.test.ts`'s docblock) and over a control-arm diagnostics object shaped as
 * `driveHoldoutArm()` returns it. AC(2)–AC(5) evidence objects carry the fields `record()` writes for
 * them in `main()`, reduced to the ones the grader reads. `holdoutFromResponses()` and `gradeRun()`
 * are imported from the harness, never re-implemented.
 *
 * WHAT THIS FILE MUST NEVER BECOME. The grader may move a FAIL to UNMEASURED and nothing else: a
 * PASS is never touched, a FAIL is never made a PASS, and an AC whose failure has a cause of its
 * own (a control arm that served directives, a rollup 500) stays RED on a holdout run. Those are the
 * negative controls below.
 *
 * Collected by `tests/e2e/vitest.config.ts` (`**\/*.test.ts`); run by `pnpm e2e:smoke`, which
 * `.github/workflows/e2e-smoke.yml` executes nightly. It needs no substrate and takes no flag.
 *
 * @module tests/e2e/follow-819/run-grade.test
 */

import { readFileSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

interface Gate {
  value: number;
}
interface Result {
  ac: string;
  name: string;
  ok: boolean;
  evidence: Record<string, unknown>;
}
type Verdict = 'PASS' | 'FAIL' | 'UNMEASURED';
interface GradedResult extends Result {
  verdict: Verdict;
  unmeasuredBecause: 'holdout' | 'window' | null;
}
interface RunFacts {
  adaptedArmDrewHoldout: boolean | null;
  adaptedResponsesArrivedAfterVerdict: number;
}
interface RunGrade {
  results: GradedResult[];
  tally: { green: number; red: number; unmeasured: number; total: number };
  runVerdict: 'GREEN' | 'RED' | 'UNMEASURED';
  tallyLine: string;
  summaryLine: string;
}
type GradeRun = (results: readonly Result[], facts: RunFacts) => RunGrade;
type HoldoutFromResponses = (bodies: readonly unknown[]) => {
  drewHoldout: boolean | null;
  holdoutBodies: number;
  total: number;
};
type EvaluateAc1 = (
  responses: readonly unknown[],
  serverGate: Gate,
) => { ok: boolean; summary: string; evidence: Record<string, unknown> };
type EvaluateAc7 = (input: {
  control: Record<string, unknown>;
  controlHoldoutPct: number;
  adaptedResponses: readonly unknown[];
  adaptedSessionId?: string | null;
  serverGate: Gate;
}) => { ok: boolean; name: string; evidence: Record<string, unknown> };
type SelectProfileResponse = (
  responses: readonly unknown[],
  serverGate: Gate,
) => { response: { archetype?: string; confidence?: number; similarity?: number } | null };

let gradeRun: GradeRun;
let holdoutFromResponses: HoldoutFromResponses;
let evaluateAc1: EvaluateAc1;
let evaluateAc7: EvaluateAc7;
let selectProfileResponse: SelectProfileResponse;

beforeAll(async () => {
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const mod = (await import('./differentiator-e2e.mjs')) as {
    gradeRun: GradeRun;
    holdoutFromResponses: HoldoutFromResponses;
    evaluateAc1: EvaluateAc1;
    evaluateAc7: EvaluateAc7;
    selectProfileResponse: SelectProfileResponse;
  };
  gradeRun = mod.gradeRun;
  holdoutFromResponses = mod.holdoutFromResponses;
  evaluateAc1 = mod.evaluateAc1;
  evaluateAc7 = mod.evaluateAc7;
  selectProfileResponse = mod.selectProfileResponse;
});

const GATE: Gate = { value: 0.6 };

/** Session `6f1f169e-…`'s three bodies — provenance in `settle-on-response.test.ts`. */
const holdoutBody = (id: string, similarity: number, generatedAt: string) => ({
  adapt_decision_id: id,
  session_id: '6f1f169e-bb94-4031-9ef7-053bda8ee4fc',
  archetype: 'neutral',
  confidence: 0.5,
  similarity,
  page_context: 2,
  directives: [],
  reorderDirectives: [],
  source: 'default',
  holdout_group: true,
  generated_at: generatedAt,
});
const HOLDOUT_BODIES = [
  holdoutBody(
    '35f0b0e7-95e7-40fc-8b88-54f9f295c727',
    0.36554663991975933,
    '2026-09-20T20:14:46.262Z',
  ),
  holdoutBody('337423a5-1068-4a0f-b50b-b5ee538a2a27', 0.85, '2026-09-20T20:15:03.163Z'),
];

/** A non-holdout session's bodies: the 62ac28f0 cold start + the quiz turn's `llm_tweaked`. */
const COLD_START = {
  archetype: 'neutral',
  confidence: 0.36554663991975933,
  similarity: 0.36554663991975933,
  page_context: 2,
  directives: [{ type: 'reorder' }],
  source: 'default',
};
const ADAPTED = {
  archetype: 'yield_hunter',
  confidence: 1,
  similarity: 0.85,
  page_context: 2,
  directives: [
    { type: 'text', slot: 'headline', value: 'Single-family rental on quiet residential street' },
    { type: 'reorder' },
  ],
  source: 'llm_tweaked',
};

/**
 * `driveHoldoutArm()`'s diagnostics after a healthy control call, mirroring `profile` (what
 * `toControlProfile(best)` hands it). Fields as that function sets them.
 */
const controlDiag = (
  profile: { archetype?: string; confidence?: number; similarity?: number } | null,
  served = 0,
) => ({
  attempted: true,
  holdoutSessionId: 'f1075hold-0000000000000000000000000000',
  holdoutPctRequested: 1,
  profileMirrored: profile?.archetype
    ? {
        archetype: profile.archetype,
        confidence: profile.confidence ?? 0,
        similarity: typeof profile.similarity === 'number' ? profile.similarity : 0.5,
      }
    : null,
  adaptStatus: 200,
  adaptDirectiveCount: served,
  decisionRowFound: true,
  loggedHoldoutGroup: true,
  loggedDirectiveCount: served,
});

/** The six results `main()` records, built from the real evaluators where the harness has one. */
function runResults(
  bodies: readonly unknown[],
  {
    ac2Changed = [] as string[],
    ac5 = { httpStatus: 200, data_source: 'clickhouse', ctaLift: -50, ok: false },
    controlServed = 0,
  } = {},
): Result[] {
  const ac1 = evaluateAc1(bodies, GATE);
  const best = selectProfileResponse(bodies, GATE).response;
  const ac7 = evaluateAc7({
    control: controlDiag(best, controlServed),
    controlHoldoutPct: 1,
    adaptedResponses: bodies,
    serverGate: GATE,
  });
  return [
    { ac: 'AC(1)', name: 'LLM-adapted /adapt response', ok: ac1.ok, evidence: ac1.evidence },
    {
      ac: 'AC(2)',
      name: 'a [data-estalara-slot] changed',
      ok: ac2Changed.length > 0,
      evidence: { changedSlots: ac2Changed },
    },
    { ac: 'AC(3)', name: 'adaptation_decisions row', ok: true, evidence: { rowCount: 3 } },
    { ac: 'AC(4)', name: 'bandit row moved', ok: true, evidence: { httpStatus: 202 } },
    {
      ac: 'AC(5)',
      name: 'lift from real rows AND this run converted',
      ok: ac5.ok,
      evidence: {
        httpStatus: ac5.httpStatus,
        data_source: ac5.data_source,
        ctaLift: ac5.ctaLift,
        unmetPreconditions: ac5.ok ? [] : ['thisRunTreatmentArmDecisions=0'],
      },
    },
    { ac: 'AC(7)', name: ac7.name, ok: ac7.ok, evidence: ac7.evidence },
  ];
}

const verdictOf = (g: RunGrade, ac: string) => g.results.find((r) => r.ac === ac);
const LEGACY_TALLY = /^\d+\/\d+ acceptance criteria green$/;

describe('FOLLOW-1240 — holdoutFromResponses reads the draw off the bodies, at settle time', () => {
  it('every body `holdout_group: true` → drew holdout', () => {
    expect(holdoutFromResponses(HOLDOUT_BODIES)).toEqual({
      drewHoldout: true,
      holdoutBodies: 2,
      total: 2,
    });
  });
  it('a treatment-arm session carries no `holdout_group` → did not draw holdout', () => {
    expect(holdoutFromResponses([COLD_START, ADAPTED]).drewHoldout).toBe(false);
  });
  it('mixed → null (the one-group-per-session invariant broke; never resolved silently)', () => {
    expect(holdoutFromResponses([HOLDOUT_BODIES[0], ADAPTED]).drewHoldout).toBeNull();
  });
  it('no bodies → null, not "not held out"', () => {
    expect(holdoutFromResponses([]).drewHoldout).toBeNull();
  });
});

describe('FOLLOW-1240 — the holdout run grades UNMEASURED, not 2/6', () => {
  it('RED-FIRST: session 6f1f169e-… used to read "2/6 acceptance criteria green"', () => {
    const results = runResults(HOLDOUT_BODIES);
    // What the harness printed: the real evaluators say FAIL for AC(1), AC(2), AC(5), AC(7).
    expect(results.filter((r) => r.ok).map((r) => r.ac)).toEqual(['AC(3)', 'AC(4)']);

    const g = gradeRun(results, {
      adaptedArmDrewHoldout: true,
      adaptedResponsesArrivedAfterVerdict: 0,
    });
    for (const ac of ['AC(1)', 'AC(2)', 'AC(5)', 'AC(7)']) {
      expect(verdictOf(g, ac)).toMatchObject({
        verdict: 'UNMEASURED',
        unmeasuredBecause: 'holdout',
      });
    }
    expect(verdictOf(g, 'AC(3)')?.verdict).toBe('PASS');
    expect(g.tally).toEqual({ green: 2, red: 0, unmeasured: 4, total: 6 });
    expect(g.runVerdict).toBe('UNMEASURED');
    expect(g.tallyLine).toBe('TALLY green=2 red=0 unmeasured=4 total=6 run=UNMEASURED');
    expect(g.summaryLine).not.toMatch(LEGACY_TALLY);
    expect(g.summaryLine).not.toMatch(/^2\/6/);
    expect(g.summaryLine).toMatch(/UNMEASURED/);
    // The raw predicate outcome is kept: UNMEASURED never rewrites `ok`.
    expect(verdictOf(g, 'AC(1)')?.ok).toBe(false);
  });

  it('#920 run 3: a holdout run whose rollup ALSO 500ed keeps AC(5) RED for that cause', () => {
    const results = runResults(HOLDOUT_BODIES, {
      ac5: {
        httpStatus: 500,
        data_source: 'unknown',
        ctaLift: null as unknown as number,
        ok: false,
      },
    });
    const g = gradeRun(results, {
      adaptedArmDrewHoldout: true,
      adaptedResponsesArrivedAfterVerdict: 0,
    });
    expect(verdictOf(g, 'AC(5)')?.verdict).toBe('FAIL');
    expect(g.tally).toEqual({ green: 2, red: 1, unmeasured: 3, total: 6 });
    expect(g.runVerdict).toBe('RED');
    expect(g.tallyLine).toBe('TALLY green=2 red=1 unmeasured=3 total=6 run=RED');
  });

  it('a control arm that SERVED directives is a real AC(7) red, holdout or not', () => {
    const g = gradeRun(runResults(HOLDOUT_BODIES, { controlServed: 3 }), {
      adaptedArmDrewHoldout: true,
      adaptedResponsesArrivedAfterVerdict: 0,
    });
    expect(verdictOf(g, 'AC(7)')?.verdict).toBe('FAIL');
  });

  it('holdout never touches a PASS', () => {
    const g = gradeRun(runResults(HOLDOUT_BODIES, { ac2Changed: ['cta'] }), {
      adaptedArmDrewHoldout: true,
      adaptedResponsesArrivedAfterVerdict: 0,
    });
    expect(verdictOf(g, 'AC(2)')).toMatchObject({ verdict: 'PASS', unmeasuredBecause: null });
  });

  it('an indeterminate draw (null) reclassifies nothing', () => {
    const g = gradeRun(runResults(HOLDOUT_BODIES), {
      adaptedArmDrewHoldout: null,
      adaptedResponsesArrivedAfterVerdict: 0,
    });
    expect(g.tally.unmeasured).toBe(0);
    expect(g.runVerdict).toBe('RED');
  });
});

describe('FOLLOW-1240 amendment — `adaptedResponsesArrivedAfterVerdict` is consumed by the grader', () => {
  it('> 0 next to a FAIL AC(1): UNMEASURED (window), not FAIL', () => {
    const g = gradeRun(runResults([COLD_START]), {
      adaptedArmDrewHoldout: false,
      adaptedResponsesArrivedAfterVerdict: 1,
    });
    expect(verdictOf(g, 'AC(1)')).toMatchObject({
      verdict: 'UNMEASURED',
      unmeasuredBecause: 'window',
    });
    expect(g.runVerdict).not.toBe('GREEN');
    expect(g.tallyLine).toMatch(/ unmeasured=[1-9]/);
  });

  it('= 0: the same FAIL stays FAIL — the product did not adapt', () => {
    const g = gradeRun(runResults([COLD_START]), {
      adaptedArmDrewHoldout: false,
      adaptedResponsesArrivedAfterVerdict: 0,
    });
    expect(verdictOf(g, 'AC(1)')).toMatchObject({ verdict: 'FAIL', unmeasuredBecause: null });
    expect(verdictOf(g, 'AC(7)')?.verdict).toBe('FAIL');
    expect(g.runVerdict).toBe('RED');
  });
});

describe('FOLLOW-1240 — a fully measured run keeps the tally a FOLLOW-820 grader already quotes', () => {
  it('6/6: the legacy line is still printed, next to the machine line', () => {
    const g = gradeRun(
      runResults([COLD_START, ADAPTED], {
        ac2Changed: ['headline'],
        ac5: { httpStatus: 200, data_source: 'clickhouse', ctaLift: -50, ok: true },
      }),
      {
        adaptedArmDrewHoldout: false,
        adaptedResponsesArrivedAfterVerdict: 0,
      },
    );
    expect(g.results.every((r) => r.verdict === 'PASS')).toBe(true);
    expect(g.tallyLine).toBe('TALLY green=6 red=0 unmeasured=0 total=6 run=GREEN');
    expect(g.summaryLine).toBe('6/6 acceptance criteria green');
  });
});

describe('FOLLOW-1240 AC 3 — the [FOLLOW-1098] warning is emitted BEFORE the AC(1) line', () => {
  it('in main(), the settle-time holdout warning precedes the AC(1) record() call', () => {
    // Source order is the property: `main()` is sequential, and the warning used to be emitted
    // ~35 s after AC(1), below AC(4), from the ClickHouse read. The behaviour of what it prints is
    // pinned above through `holdoutFromResponses()`; this pins WHERE it is printed.
    const src = readFileSync(new URL('./differentiator-e2e.mjs', import.meta.url), 'utf8');
    const main = src.slice(src.indexOf('async function main('));
    const warning = main.search(/printHoldoutWarning\(/);
    const ac1 = main.search(/record\(\s*'AC\(1\)'/);
    const ac2 = main.search(/record\(\s*'AC\(2\)'/);
    expect(warning).toBeGreaterThan(0);
    expect(ac1).toBeGreaterThan(0);
    expect(warning).toBeLessThan(ac1);
    expect(ac1).toBeLessThan(ac2);
  });
});
