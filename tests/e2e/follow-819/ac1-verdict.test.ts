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
 *     has a schema and `listing_ids` — on EVERY source, including `default`. Since FOLLOW-1202 it
 *     is appended only when every listing in the batch has a cosine score.
 *
 * WHAT THIS DOES NOT COVER: whether the live route still produces these shapes. That is the manual
 * harness run itself (README §3); this file pins the verdict over a population, not the population.
 *
 * Red-first, executed (not reasoned): the pre-fix predicate passes the refusal, outage and template
 * fixtures below — transcripts are in the FOLLOW-1186 PR body.
 *
 * FOLLOW-1196 adds the other consumers of AC(1)'s qualifying predicate to this file, because they
 * share its fixtures: `evaluateAc7()` (ESC-073 clause 2), `selectProfileResponse()` (the response
 * AC(4) credits and AC(7) mirrors), `evaluateArmReachability()` and `attributePaintedSlots()`. The
 * AC(7) table's pre-fix column was executed against the `armsSeparated` bytes sliced from
 * `origin/main` — transcripts are in the FOLLOW-1196 PR body.
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
    GRADED_BY_FOLLOW_820_CONDITION_1: string;
    outcomes: Record<string, number>;
    adaptedResponses: readonly unknown[];
    sourcesObserved: Record<string, number>;
    legacy: { wouldHavePassed: boolean };
  };
}
interface Gate {
  value: number;
}
type EvaluateAc1 = (responses: readonly unknown[], serverGate: Gate) => Ac1Verdict;

interface Profile {
  archetype: string;
  confidence: number;
  similarity: number;
}
/** `driveHoldoutArm()`'s diagnostics object — the fields `evaluateAc7()` reads. */
interface ControlDiag {
  attempted?: boolean;
  error?: string;
  holdoutSessionId?: string;
  holdoutPctRequested?: number;
  profileMirrored?: Profile | null;
  adaptStatus?: number;
  adaptDirectiveCount?: number | null;
  decisionRowFound?: boolean;
  loggedHoldoutGroup?: boolean;
  loggedDirectiveCount?: number;
}
interface Ac7Input {
  control: ControlDiag;
  controlHoldoutPct: number;
  adaptedResponses: readonly unknown[];
  adaptedSessionId?: string | null;
  serverGate: Gate;
}
interface Ac7Verdict {
  ok: boolean;
  name: string;
  summary: string;
  evidence: {
    unmetPreconditions: string[];
    adaptedArm: { evaluatedResponseCount: number; adaptedResponseCount: number };
    legacy: { wouldHavePassed: boolean; directivesServedIncludingReorder: number };
  };
}
type EvaluateAc7 = (input: Ac7Input) => Ac7Verdict;
type SelectProfileResponse = (
  responses: readonly unknown[],
  serverGate: Gate,
) => { response: unknown; index: number; basis: string };
type EvaluateArmReachability = (
  responses: readonly object[],
  serverGate: Gate,
) => { peakConfidence: number; directives: number; clearedGate: boolean };
interface SlotAttribution {
  fromAdaptedResponse: string[];
  notFromAdaptedResponse: string[];
  perSlot: {
    slot: string;
    servedBy: string[];
    lastServedBy: string | null;
    fromAdaptedResponse: boolean;
  }[];
}
type AttributePaintedSlots = (
  changedSlots: readonly string[],
  responses: readonly object[],
  serverGate: Gate,
) => SlotAttribution;

let evaluateAc1: EvaluateAc1;
let evaluateAc7: EvaluateAc7;
let selectProfileResponse: SelectProfileResponse;
let evaluateArmReachability: EvaluateArmReachability;
let attributePaintedSlots: AttributePaintedSlots;

beforeAll(async () => {
  // The harness runs main() at import unless told not to — see the guard at its foot.
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const mod = (await import('./differentiator-e2e.mjs')) as {
    evaluateAc1: EvaluateAc1;
    evaluateAc7: EvaluateAc7;
    selectProfileResponse: SelectProfileResponse;
    evaluateArmReachability: EvaluateArmReachability;
    attributePaintedSlots: AttributePaintedSlots;
  };
  evaluateAc1 = mod.evaluateAc1;
  evaluateAc7 = mod.evaluateAc7;
  selectProfileResponse = mod.selectProfileResponse;
  evaluateArmReachability = mod.evaluateArmReachability;
  attributePaintedSlots = mod.attributePaintedSlots;
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

/**
 * FOLLOW-1205: the field FOLLOW-820 condition 1 names (`docs/MASTER_DESIGN.md`, README §0) and the
 * verdict must be one count. Driven over every VERDICTS population, plus the two `llm_*` shapes that
 * fail a conjunct, which are the rows the pre-fix `outcomes.adapted` (any `llm_*` source) got wrong.
 */
describe('FOLLOW-1205 parity — outcomes.adapted IS the qualifying count', () => {
  const POPULATIONS = [
    ...VERDICTS.map(([name, responses]) => ({ name, responses })),
    { name: 'llm_tweaked, neutral archetype', responses: [{ ...tweaked, archetype: 'neutral' }] },
    { name: 'llm_full below the gate', responses: [{ ...full, confidence: 0.5 }] },
  ];

  it.each(POPULATIONS)(
    '$name → ok === (outcomes.adapted > 0) === adaptedResponses.length > 0',
    ({ responses }) => {
      const v = evaluateAc1(responses, GATE);
      expect(v.evidence.GRADED_BY_FOLLOW_820_CONDITION_1).toBe('outcomes.adapted');
      expect(v.evidence.outcomes.adapted).toBe(v.evidence.adaptedResponses.length);
      expect(v.ok).toBe(v.evidence.outcomes.adapted > 0);
    },
  );

  it('the outcome buckets still partition the population', () => {
    const responses = [
      neutralDefault,
      refused,
      outage,
      template,
      tweakedButStripped,
      tweaked,
      full,
    ];
    const v = evaluateAc1(responses, GATE);
    const total = Object.values(v.evidence.outcomes).reduce((n, c) => n + c, 0);
    expect(total).toBe(responses.length);
    expect(v.evidence.outcomes).toMatchObject({ adapted: 2, llmNotQualifying: 1 });
  });
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

  // FOLLOW-1205 (architect finding): this case used to assert `adapted: 1` next to a RED verdict —
  // the grade FOLLOW-820 reads disagreed with the verdict on the same run.
  it('an llm_* source that fails a conjunct is llmNotQualifying, not adapted', () => {
    const v = evaluateAc1([neutralDefault, tweakedButStripped], GATE);
    expect(v.ok).toBe(false);
    expect(v.evidence.outcomes).toMatchObject({ adapted: 0, llmNotQualifying: 1 });
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

describe('FOLLOW-1196 reporting — AC(1) records the population it graded', () => {
  it('evaluatedResponseCount counts the object bodies the verdict saw, not the raw list', () => {
    const v = evaluateAc1([neutralDefault, template, 'not-a-body', null], GATE) as Ac1Verdict & {
      evidence: { evaluatedResponseCount: number };
    };
    expect(v.evidence.evaluatedResponseCount).toBe(2);
  });
});

// ─── FOLLOW-1196: AC(7) ─────────────────────────────────────────────────────────────────────

/** The profile `main()` derives from one response (`toControlProfile()`), written out. */
const profileOf = (b: { archetype: string; confidence: number; similarity: number }): Profile => ({
  archetype: b.archetype,
  confidence: b.confidence,
  similarity: b.similarity,
});

/**
 * `driveHoldoutArm()`'s diagnostics for a control session that drew holdout: the route's holdout
 * early return (`directives: []`, `route.ts`), then a logged row with `holdout_group` true and
 * `directive_count` 0. `profileMirrored` is whatever `main()` would have sent for that run.
 */
const heldOutControl = (profileMirrored: Profile | null): ControlDiag => ({
  attempted: true,
  holdoutSessionId: 'f1075hold-fixture',
  holdoutPctRequested: 1,
  profileMirrored,
  adaptStatus: 200,
  adaptDirectiveCount: 0,
  decisionRowFound: true,
  loggedHoldoutGroup: true,
  loggedDirectiveCount: 0,
});

interface Ac7Row {
  name: string;
  responses: readonly object[];
  control: ControlDiag;
  controlHoldoutPct: number;
  legacyOk: boolean;
  fixedOk: boolean;
}

/**
 * The VERDICT table. `legacyOk` is the pre-FOLLOW-1196 `armsSeparated` verdict. The red-first run
 * executed the SLICED pre-fix bytes against the `fixedOk` column and failed exactly the rows where
 * the two differ. `profileMirrored` in each row is what `main()` would have sent. The pre-fix
 * `best` (highest confidence) and the post-fix one coincide whenever no adapted response exists.
 */
const AC7_VERDICTS: readonly Ac7Row[] = [
  // RETRO-325 §4a LG-1, the stub's named fixture: a dead LLM path still yields a reorder.
  {
    name: 'LG-1: default+reorder and a withheld cta; control 0/0',
    responses: [neutralDefault, template],
    control: heldOutControl(profileOf(template)),
    controlHoldoutPct: 1,
    legacyOk: true,
    fixedOk: false,
  },
  {
    name: 'refused batch only; control 0/0',
    responses: [neutralDefault, refused],
    control: heldOutControl(profileOf(refused)),
    controlHoldoutPct: 1,
    legacyOk: true,
    fixedOk: false,
  },
  {
    name: 'llm_tweaked stripped to a reorder; control 0/0',
    responses: [neutralDefault, tweakedButStripped],
    control: heldOutControl(profileOf(tweakedButStripped)),
    controlHoldoutPct: 1,
    legacyOk: true,
    fixedOk: false,
  },
  // RETRO-325 §4a LG-2: adaptation happened, but the control mirrored the template's profile.
  {
    name: 'LG-2: llm_tweaked present, control mirrored the earlier template',
    responses: [template, tweaked],
    control: heldOutControl(profileOf(template)),
    controlHoldoutPct: 1,
    legacyOk: true,
    fixedOk: false,
  },
  // Rule Q amendment 1 clause 5: the empty population, executed.
  {
    name: 'empty adapted population; control 0/0',
    responses: [],
    control: heldOutControl(profileOf(tweaked)),
    controlHoldoutPct: 1,
    legacyOk: false,
    fixedOk: false,
  },
  // The control half, unchanged: each must stay red under both predicates.
  {
    name: 'control served and logged a directive (holdout broken)',
    responses: [neutralDefault, tweaked],
    control: {
      ...heldOutControl(profileOf(tweaked)),
      adaptDirectiveCount: 1,
      loggedDirectiveCount: 1,
    },
    controlHoldoutPct: 1,
    legacyOk: false,
    fixedOk: false,
  },
  {
    name: 'red-first knob: holdout_pct 0, control not held out',
    responses: [neutralDefault, tweaked],
    control: {
      ...heldOutControl(profileOf(tweaked)),
      holdoutPctRequested: 0,
      adaptDirectiveCount: 3,
      loggedHoldoutGroup: false,
      loggedDirectiveCount: 3,
    },
    controlHoldoutPct: 0,
    legacyOk: false,
    fixedOk: false,
  },
  {
    name: 'control profile not adaptable (none mirrored)',
    responses: [tweaked],
    control: heldOutControl(null),
    controlHoldoutPct: 1,
    legacyOk: false,
    fixedOk: false,
  },
  {
    name: 'control decision row never landed',
    responses: [tweaked],
    control: {
      ...heldOutControl(profileOf(tweaked)),
      decisionRowFound: false,
      loggedHoldoutGroup: undefined,
      loggedDirectiveCount: undefined,
    },
    controlHoldoutPct: 1,
    legacyOk: false,
    fixedOk: false,
  },
  // The silent direction of the NEW predicate: it must not refuse real separation.
  {
    name: 'positive control: llm_tweaked after default + template, profile mirrored from it',
    responses: [neutralDefault, template, tweaked],
    control: heldOutControl(profileOf(tweaked)),
    controlHoldoutPct: 1,
    legacyOk: true,
    fixedOk: true,
  },
  {
    name: 'llm_full, profile mirrored from it',
    responses: [full],
    control: heldOutControl(profileOf(full)),
    controlHoldoutPct: 1,
    legacyOk: true,
    fixedOk: true,
  },
];

const POSITIVE_CONTROL = AC7_VERDICTS[AC7_VERDICTS.length - 2];

const ac7 = (row: Ac7Row) =>
  evaluateAc7({
    control: row.control,
    controlHoldoutPct: row.controlHoldoutPct,
    adaptedResponses: row.responses,
    adaptedSessionId: 'session-fixture',
    serverGate: GATE,
  });

describe('FOLLOW-1196 AC(7) verdict — the adapted half is an adapted response', () => {
  it.each(AC7_VERDICTS)('$name → separated=$fixedOk', (row) => {
    expect(ac7(row).ok).toBe(row.fixedOk);
  });
});

describe('FOLLOW-1196 AC(7) reporting — the PASS/FAIL line prints what it counted', () => {
  it.each(AC7_VERDICTS)('$name → legacy.wouldHavePassed=$legacyOk', (row) => {
    expect(ac7(row).evidence.legacy.wouldHavePassed).toBe(row.legacyOk);
  });

  it('LG-1 fixture: names zero adapted, the control counts and the unmet conjunct', () => {
    const v = ac7(AC7_VERDICTS[0]);
    expect(v.summary).toContain('adapted arm: 0 of 2 responses adapted');
    expect(v.summary).toContain('control arm: served 0, logged 0, drewHoldout true, holdout_pct 1');
    expect(v.evidence.unmetPreconditions).toEqual(['adaptedArmHasNoAdaptedResponse']);
    expect(v.evidence.legacy.directivesServedIncludingReorder).toBe(3);
  });

  it('LG-2 fixture: names the profile mismatch, not a missing adapted response', () => {
    const v = ac7(AC7_VERDICTS[3]);
    expect(v.evidence.unmetPreconditions).toEqual(['controlProfileNotFromAdaptedResponse']);
    expect(v.evidence.adaptedArm.adaptedResponseCount).toBe(1);
  });

  it('positive control: prints the counted population and the first adapted response', () => {
    const v = ac7(POSITIVE_CONTROL);
    expect(v.summary).toContain('adapted arm: 1 of 3 responses adapted');
    expect(v.summary).toContain('first: llm_tweaked yield_hunter @ 1');
    expect(v.summary).toContain('unmet: []');
    expect(v.evidence.adaptedArm.evaluatedResponseCount).toBe(3);
  });

  it('the AC name embeds the counted summary and carries no literal "> 0"', () => {
    for (const row of AC7_VERDICTS) {
      const v = ac7(row);
      expect(v.name).not.toContain('> 0');
      expect(v.name).toContain(`counted: ${v.summary}`);
    }
  });
});

// ─── FOLLOW-1196: the response AC(4) credits and AC(7) mirrors ───────────────────────────────

describe('FOLLOW-1196 selectProfileResponse() — first adapted response, else a stated fallback', () => {
  it('picks the adapted response over an earlier, equally confident template and refusal', () => {
    const v = selectProfileResponse([template, refused, tweaked], GATE);
    expect(v.basis).toBe('first_adapted_response');
    expect(v.index).toBe(2);
    expect(v.response).toBe(tweaked);
  });

  it('tie-break: the EARLIER adapted response wins, even over a later, more confident one', () => {
    const lessConfident = { ...tweaked, confidence: 0.9 };
    expect(selectProfileResponse([lessConfident, full], GATE).index).toBe(0);
    expect(selectProfileResponse([tweaked, full], GATE).index).toBe(0);
  });

  it('falls back to the highest confidence, earliest on ties, and says so', () => {
    const v = selectProfileResponse([neutralDefault, template, refused], GATE);
    expect(v.basis).toBe('highest_confidence_fallback');
    expect(v.index).toBe(1);
  });

  it('an empty population selects nothing', () => {
    expect(selectProfileResponse([], GATE)).toEqual({
      response: null,
      index: -1,
      basis: 'no_responses',
    });
  });
});

// ─── FOLLOW-1196: arm A / arm B reachability ─────────────────────────────────────────────────

describe('FOLLOW-1196 evaluateArmReachability() — clearedGate is the confidence claim only', () => {
  it('a neutral cold-start response carrying a reorder does not clear the gate', () => {
    expect(evaluateArmReachability([neutralDefault], GATE)).toEqual({
      peakConfidence: neutralDefault.confidence,
      directives: 1,
      clearedGate: false,
    });
  });

  it('confidence above the gate clears it with zero directives (the dropped conjunct)', () => {
    expect(evaluateArmReachability([body({ directives: [] })], GATE).clearedGate).toBe(true);
  });

  it('exactly at the gate does not clear it (strict >, as the route)', () => {
    const atGate = { ...refused, confidence: 0.6 };
    expect(evaluateArmReachability([atGate], GATE).clearedGate).toBe(false);
  });
});

// ─── FOLLOW-1196: AC(2) painted-slot attribution (reporting only) ────────────────────────────

describe('FOLLOW-1196 attributePaintedSlots() — which painted slots an adapted response served', () => {
  it('attributes a slot to the LAST response that served it', () => {
    const v = attributePaintedSlots(['cta', 'headline'], [template, tweaked], GATE);
    expect(v.fromAdaptedResponse).toEqual(['cta', 'headline']);
    expect(v.perSlot[0]).toEqual({
      slot: 'cta',
      servedBy: ['playbook', 'llm_tweaked'],
      lastServedBy: 'llm_tweaked',
      fromAdaptedResponse: true,
    });
  });

  it('a template cta served after an adapted batch is not attributed to adaptation', () => {
    const v = attributePaintedSlots(['cta'], [tweaked, refused], GATE);
    expect(v.fromAdaptedResponse).toEqual([]);
    expect(v.notFromAdaptedResponse).toEqual(['cta']);
    expect(v.perSlot[0].lastServedBy).toBe('playbook_fallback_llm_unavailable');
  });

  it('a changed slot that no response served is reported unattributed', () => {
    expect(attributePaintedSlots(['price'], [tweaked], GATE).perSlot[0]).toEqual({
      slot: 'price',
      servedBy: [],
      lastServedBy: null,
      fromAdaptedResponse: false,
    });
  });
});
