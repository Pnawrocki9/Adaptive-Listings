// @vitest-environment node
// (the package default is jsdom, whose global `URL` `createRequire()` rejects at the harness's
// top-level Playwright resolution — same reason ac1-verdict.test.ts pins this)

/**
 * FOLLOW-1361 — AC(10), the quiz confirmation path (Faza Q package Q6, MASTER_DESIGN §E.4.10), must
 * not pass over a dead wire; FOLLOW-1367 — AC(5)'s CTA click and the public-config warm-up.
 *
 * Drives the REAL `evaluateAc10()`, `pickFirstRequestAfterQuizFold()`, `gradeRun()` and friends out
 * of `differentiator-e2e.mjs` (imported, not copied). `greenObs()` is the shape `driveAc10()` returns
 * for a run in which all three sub-sessions held; each RED row breaks exactly ONE thing in it, so a
 * row that still reads GREEN names a conjunct the verdict does not check.
 *
 * WHAT THE FIXTURES CANNOT FAKE, and is pinned against the real source instead:
 *   - the fold masses (0.72 / 0.90) and the sent-similarity cap (0.85) the verdict grades against are
 *     read from the SDK source by the harness, and checked here against the SDK's own
 *     `applyQuizLeaf()` and the route's playbook threshold (parity, CLAUDE.md QA rule);
 *   - "contrary" signals: for every non-neutral leaf, the signal the harness sends really lowers an
 *     UNCONFIRMED leaf through the SDK's own `applyBehavioralSignal()` and leaves a CONFIRMED one at
 *     0.90 — otherwise "the leaf did not move" would be vacuous;
 *   - the follow-up marker: the SDK sends `traits` iff its state carries `quiz_traits`, which only
 *     the quiz fold writes, and the fold refreshes unconditionally (source pins below);
 *   - the served default tree: the harness's first-answer walk reaches a result screen whose leaf
 *     offers at least one named alternative, so (b) has something to choose.
 *
 * WHAT THIS DOES NOT COVER: whether the live stack produces these observations. That is the manual
 * series (README §1.2); this file pins the verdict over an observation.
 *
 * Collected by `tests/e2e/vitest.config.ts`; run by `pnpm e2e:smoke` (nightly
 * `.github/workflows/e2e-smoke.yml`). It needs no substrate and takes no flag.
 *
 * @module tests/e2e/follow-819/ac10-verdict.test
 */

import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  ARCHETYPE_NAMES,
  applyBehavioralSignal,
  applyQuizLeaf,
  initIntentState,
} from '../../../packages/sdk/src/core/intent';
import { DEFAULT_QUIZ_DEFINITION_V2 } from '../../../packages/shared/src/quiz-default-v2';
import { nextStep } from '../../../packages/shared/src/schemas/quiz-walk';

interface Gate {
  value: number;
  comparison: string;
  source: string;
}
interface Fold {
  completed: number;
  confirmed: number;
  similarityCap: number;
  source: string;
}
interface Row {
  id: string;
  status: string;
  definition_hash: string | null;
  resolved_archetype: string | null;
  confirmed_archetype: string | null;
  offered: string[] | null;
  answer_path: unknown[] | null;
  step_ms: number[] | null;
  result_ms: number | null;
}
interface State {
  archetype: string | null;
  confidence: number | null;
  quiz_confirmed: boolean | null;
  signal_count?: number | null;
}
interface Sub {
  error?: string;
  sessionId: string | null;
  drewHoldout: boolean | null;
  draws?: { sessionId: string | null; drewHoldout: boolean | null }[];
  quizShown: boolean;
  resultShown: boolean;
  leaf: string | null;
  offered?: string[] | null;
  chosen?: string | null;
  row: Row | null;
  rowError?: string | null;
  stateAtFold: State | null;
  followUp: {
    reason: string | null;
    request: {
      seq: number;
      archetypeHint: string | null;
      confidence: number | null;
      similarity: number | null;
      traitsSent: boolean;
    } | null;
    body: Record<string, unknown> | null;
  } | null;
  contrary?: {
    bookmarkEventsEmitted: number;
    signalCountBefore: number | null;
    stateAfter: State | null;
  } | null;
}
interface Obs {
  fold: Fold;
  servedConfig: { status: number | null; body: Record<string, unknown> | null; error?: string };
  sessions: { confirm: Sub; correct: Sub; dismiss: Sub };
}
interface Ac10Verdict {
  ok: boolean;
  name: string;
  summary: string;
  evidence: { unmetPreconditions: string[] };
}
interface Graded {
  ac: string;
  verdict: 'PASS' | 'FAIL' | 'UNMEASURED';
  unmeasuredBecause: string | null;
}
interface Grade {
  results: Graded[];
  runVerdict: 'GREEN' | 'RED' | 'UNMEASURED';
  tallyLine: string;
}
interface Result {
  ac: string;
  name: string;
  ok: boolean;
  evidence?: unknown;
}
interface Call {
  seq: number;
  requestedMono?: number | null;
  traitsSent?: boolean;
  archetypeHint?: string;
}
interface Pick {
  next: Call | null;
  reason: string | null;
  notGradedSeqs: number[];
}

let evaluateAc10Raw: (obs: Obs, gate: Gate) => Ac10Verdict;
let gradeRun: (
  results: readonly Result[],
  facts: { adaptedArmDrewHoldout: boolean | null; adaptedResponsesArrivedAfterVerdict: number },
) => Grade;
let pickFirstRequestAfterQuizFold: (a: {
  calls: Call[];
  resolveClickMono: number | null;
  foldSeen: boolean;
}) => Pick;
let readQuizFoldConstants: (src: { intentSrc: string; adaptSrc: string }) => Fold;
let archetypeFromDisplayName: (
  names: Record<string, Record<string, string>> | null,
  text: string | null,
) => string | null;
let contrarySignalFor: (leaf: string | null) => { bedroomCount?: number; listingType?: string };
let evaluateServedQuizConfig: (probe: { status: number | null; body: unknown }) => {
  ok: boolean;
  reason: string;
};
let evaluateAc1: (responses: unknown[], gate: Gate) => { ok: boolean };
let missingGradedAcs: (results: readonly { ac: string }[]) => string[];
let GRADED_ACS: readonly string[];
let AC10_MAX_DRAWS: number;
let servedConfigNeverReachedBrowser: (s: Record<string, unknown>) => string | null;
let GATE: Gate;
let FOLD: Fold;
let harnessSrc: string;
let upSrc: string;
let intentLoopSrc: string;
let adaptSrc: string;
let intentSrc: string;
let routeSrc: string;

const evaluateAc10 = (obs: Obs): Ac10Verdict => evaluateAc10Raw(obs, GATE);
const unmet = (obs: Obs): string[] => evaluateAc10(obs).evidence.unmetPreconditions;
const read = (rel: string): Promise<string> => readFile(new URL(rel, import.meta.url), 'utf8');

beforeAll(async () => {
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const mod = (await import('./differentiator-e2e.mjs')) as {
    evaluateAc10: typeof evaluateAc10Raw;
    gradeRun: typeof gradeRun;
    pickFirstRequestAfterQuizFold: typeof pickFirstRequestAfterQuizFold;
    readQuizFoldConstants: typeof readQuizFoldConstants;
    readQuizFoldConstantsFromSdk: () => Promise<Fold>;
    readServerConfidenceGate: () => Promise<Gate>;
    archetypeFromDisplayName: typeof archetypeFromDisplayName;
    contrarySignalFor: typeof contrarySignalFor;
    evaluateServedQuizConfig: typeof evaluateServedQuizConfig;
    evaluateAc1: typeof evaluateAc1;
    missingGradedAcs: typeof missingGradedAcs;
    GRADED_ACS: readonly string[];
    AC10_MAX_DRAWS: number;
    servedConfigNeverReachedBrowser: typeof servedConfigNeverReachedBrowser;
  };
  evaluateAc10Raw = mod.evaluateAc10;
  gradeRun = mod.gradeRun;
  pickFirstRequestAfterQuizFold = mod.pickFirstRequestAfterQuizFold;
  readQuizFoldConstants = mod.readQuizFoldConstants;
  archetypeFromDisplayName = mod.archetypeFromDisplayName;
  contrarySignalFor = mod.contrarySignalFor;
  evaluateServedQuizConfig = mod.evaluateServedQuizConfig;
  evaluateAc1 = mod.evaluateAc1;
  missingGradedAcs = mod.missingGradedAcs;
  GRADED_ACS = mod.GRADED_ACS;
  AC10_MAX_DRAWS = mod.AC10_MAX_DRAWS;
  servedConfigNeverReachedBrowser = mod.servedConfigNeverReachedBrowser;
  GATE = await mod.readServerConfidenceGate();
  FOLD = await mod.readQuizFoldConstantsFromSdk();
  harnessSrc = await read('./differentiator-e2e.mjs');
  upSrc = await read('../../../scripts/dev/localhost-up.sh');
  intentLoopSrc = await read('../../../packages/sdk/src/core/intent-loop.ts');
  adaptSrc = await read('../../../packages/sdk/src/core/adapt.ts');
  intentSrc = await read('../../../packages/sdk/src/core/intent.ts');
  routeSrc = await read('../../../apps/control-plane/src/app/api/adapt/route.ts');
});

// ─── Fixtures ───────────────────────────────────────────────────────────────────────────────

const HASH = 'ab'.repeat(32); // a served sha-256 (64 hex), deliberately not the real pinned one
const LEAF = 'first_time_buyer';
const OFFERED = ['family_buyer', 'lifestyle_expat', 'student_parent'];
const CHOSEN = 'family_buyer';
const NAMES = {
  first_time_buyer: { en: 'First-time buyer', pl: 'Pierwszy własny dom' },
  family_buyer: { en: 'Family buyer', pl: 'Rodzina' },
  lifestyle_expat: { en: 'Lifestyle expat', pl: 'Ekspat' },
  student_parent: { en: 'Student parent', pl: 'Rodzic studenta' },
};

/** A response body that passes AC(1)'s `isAdaptedResponse()` for `archetype`. */
const adaptedBody = (archetype: string, over: Record<string, unknown> = {}) => ({
  archetype,
  confidence: 0.9,
  similarity: 0.85,
  source: 'llm_tweaked',
  directives: [
    { type: 'text', slot: 'headline', value: 'A bright two-bedroom flat' },
    { type: 'reorder', slot: 'features', order: ['a', 'b'] },
  ],
  ...over,
});

const row = (over: Partial<Row>): Row => ({
  id: '11111111-1111-4111-8111-111111111111',
  status: 'confirmed',
  definition_hash: HASH,
  resolved_archetype: LEAF,
  confirmed_archetype: LEAF,
  offered: null,
  answer_path: [{}, {}, {}],
  step_ms: [1200, 900, 1500],
  result_ms: 800,
  ...over,
});

const followUp = (hint: string, body: Record<string, unknown> | null) => ({
  reason: null,
  request: { seq: 4, archetypeHint: hint, confidence: 0.9, similarity: 0.85, traitsSent: true },
  body,
});

function greenObs(): Obs {
  return {
    fold: { completed: 0.72, confirmed: 0.9, similarityCap: 0.85, source: 'pinned' },
    servedConfig: {
      status: 200,
      body: {
        data_source: 'db',
        definition_hash: HASH,
        quiz_definition: { confirm: { names_i18n: NAMES } },
      },
    },
    sessions: {
      confirm: {
        sessionId: 'a'.repeat(32),
        drewHoldout: false,
        quizShown: true,
        resultShown: true,
        leaf: LEAF,
        row: row({}),
        stateAtFold: { archetype: LEAF, confidence: 0.9, quiz_confirmed: true, signal_count: 4 },
        followUp: followUp(LEAF, adaptedBody(LEAF)),
        contrary: {
          bookmarkEventsEmitted: 2,
          signalCountBefore: 4,
          stateAfter: { archetype: LEAF, confidence: 0.9, quiz_confirmed: true, signal_count: 6 },
        },
      },
      correct: {
        sessionId: 'b'.repeat(32),
        drewHoldout: false,
        quizShown: true,
        resultShown: true,
        leaf: LEAF,
        offered: [...OFFERED],
        chosen: CHOSEN,
        row: row({ status: 'corrected', confirmed_archetype: CHOSEN, offered: [...OFFERED] }),
        stateAtFold: { archetype: CHOSEN, confidence: 0.9, quiz_confirmed: true },
        followUp: followUp(CHOSEN, adaptedBody(CHOSEN)),
      },
      dismiss: {
        sessionId: 'c'.repeat(32),
        drewHoldout: false,
        quizShown: true,
        resultShown: true,
        leaf: LEAF,
        row: row({ status: 'unconfirmed', confirmed_archetype: null }),
        stateAtFold: { archetype: LEAF, confidence: 0.72, quiz_confirmed: false },
        followUp: followUp(LEAF, adaptedBody(LEAF, { confidence: 0.72 })),
      },
    },
  };
}

/** Clone `greenObs()` and apply one edit. */
const broken = (edit: (o: Obs) => void): Obs => {
  const o = structuredClone(greenObs());
  edit(o);
  return o;
};

const facts = { adaptedArmDrewHoldout: false, adaptedResponsesArrivedAfterVerdict: 0 };
const asResult = (v: Ac10Verdict): Result => ({
  ac: 'AC(10)',
  name: v.name,
  ok: v.ok,
  evidence: v.evidence,
});

// ─── The verdict ────────────────────────────────────────────────────────────────────────────

describe('FOLLOW-1361 — evaluateAc10(): GREEN only when all three sub-sessions held', () => {
  it('is GREEN for (a) confirm, (b) correct and (c) ×, with nothing unmet', () => {
    const v = evaluateAc10(greenObs());
    expect(v.evidence.unmetPreconditions).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.summary).toContain(`(b) correct: ${LEAF} → ${CHOSEN}`);
  });

  it('grades with the fold constants the harness read from the SDK (0.72 / 0.90 / 0.85)', () => {
    expect(FOLD.completed).toBe(0.72);
    expect(FOLD.confirmed).toBe(0.9);
    expect(FOLD.similarityCap).toBe(0.85);
    expect(evaluateAc10Raw({ ...greenObs(), fold: FOLD }, GATE).ok).toBe(true);
  });
});

describe('FOLLOW-1361 — RED: the quiz_runs row', () => {
  it.each([
    ['(a) row missing', 'confirm', 'a:quizRunRowMissing'],
    ['(b) row missing', 'correct', 'b:quizRunRowMissing'],
    ['(c) row missing', 'dismiss', 'c:quizRunRowMissing'],
  ] as const)('%s', (_n, kind, want) => {
    const o = broken((x) => {
      x.sessions[kind].row = null;
    });
    expect(evaluateAc10(o).ok).toBe(false);
    expect(unmet(o)).toContain(want);
  });

  it('an unreadable Postgres is RED, named, never a missing-row guess', () => {
    const o = broken((x) => {
      x.sessions.confirm.row = null;
      x.sessions.confirm.rowError = 'DATABASE_URL_ADMIN not set';
    });
    expect(unmet(o)).toContain('a:quizRunRowUnreadable');
  });

  it('a row still at `completed` (the confirmed ping never landed) is RED', () => {
    const o = broken((x) => {
      x.sessions.confirm.row = row({ status: 'completed', confirmed_archetype: null });
    });
    expect(unmet(o)).toEqual(
      expect.arrayContaining(['a:rowStatus=completed', 'a:rowConfirmedArchetype=null']),
    );
  });

  it('a row without step_ms entries, or fewer than the walk had, is RED', () => {
    for (const step_ms of [null, [], [1200, 900]]) {
      const o = broken((x) => {
        x.sessions.confirm.row = row({ step_ms });
      });
      expect(evaluateAc10(o).ok).toBe(false);
      expect(unmet(o).some((u) => u.startsWith('a:stepMs='))).toBe(true);
    }
  });

  it('a row for another leaf than the result screen showed is RED', () => {
    const o = broken((x) => {
      x.sessions.confirm.row = row({ resolved_archetype: 'yield_hunter' });
    });
    expect(unmet(o)).toContain('a:rowResolvedArchetype=yield_hunter');
  });
});

describe('FOLLOW-1361 — RED: the built-in tree, or no served tree at all', () => {
  it('a row on builtin-en-v2 is RED (the SDK walked its fallback, not the served tree)', () => {
    const o = broken((x) => {
      x.sessions.confirm.row = row({ definition_hash: 'builtin-en-v2' });
    });
    expect(unmet(o)).toContain('a:builtinTreeWalked');
  });

  it('a row on another sha-256 than the served one is RED', () => {
    const o = broken((x) => {
      x.sessions.dismiss.row = row({
        status: 'unconfirmed',
        confirmed_archetype: null,
        definition_hash: 'cd'.repeat(32),
      });
    });
    expect(unmet(o)).toContain(`c:definitionHashNotServed=${'cd'.repeat(32)}`);
  });

  it('a series that fell back (public-config answered `fallback`) is RED, whatever the rows say', () => {
    const o = broken((x) => {
      x.servedConfig = { status: 200, body: { data_source: 'fallback' } };
    });
    expect(evaluateAc10(o).ok).toBe(false);
    expect(unmet(o)).toContain('served:data_source=fallback');
  });

  it('a cold public-config (the SDK timed out) is RED: no result screen, no leaf', () => {
    const o = broken((x) => {
      x.sessions.correct.resultShown = false;
      x.sessions.correct.leaf = null;
    });
    expect(unmet(o)).toEqual(
      expect.arrayContaining(['b:resultScreenNotShown', 'b:leafNotReadFromResultScreen']),
    );
  });

  it('a quiz that never opened is RED, not skipped', () => {
    const o = broken((x) => {
      x.sessions.dismiss.quizShown = false;
    });
    expect(unmet(o)).toContain('c:quizNotShown');
  });

  it('a sub-session that threw is RED', () => {
    const o = broken((x) => {
      x.sessions.correct = { ...x.sessions.correct, error: 'TimeoutError: locator.click' };
    });
    expect(unmet(o)).toEqual(['b:threw']);
  });
});

describe('FOLLOW-1361 — RED: (a) confirm — state, follow-up, contrary signals', () => {
  it('a confirmed state at the completed mass (0.72, the Q4 fold not applied) is RED', () => {
    const o = broken((x) => {
      x.sessions.confirm.stateAtFold = { archetype: LEAF, confidence: 0.72, quiz_confirmed: false };
    });
    expect(unmet(o).some((u) => u.startsWith('a:stateAtFold='))).toBe(true);
  });

  it('a follow-up at confidence 0.72 is RED', () => {
    const o = broken((x) => {
      x.sessions.confirm.followUp!.request!.confidence = 0.72;
    });
    expect(unmet(o)).toContain('a:followUpConfidence=0.72');
  });

  it('a follow-up sending similarity 0.9 (the ESC-087 cap lost → playbook branch) is RED', () => {
    const o = broken((x) => {
      x.sessions.confirm.followUp!.request!.similarity = 0.9;
    });
    expect(unmet(o)).toContain('a:followUpSimilarity=0.9');
  });

  it.each([
    ['playbook / ungrounded_directives_withheld (ESC-087)', { source: 'playbook' }],
    ['a reorder only', { directives: [{ type: 'reorder', slot: 'features', order: [] }] }],
    ['adapted for another archetype', { archetype: 'yield_hunter' }],
  ])('a follow-up answered NOT adapted is RED: %s', (_n, over) => {
    const o = broken((x) => {
      x.sessions.confirm.followUp!.body = adaptedBody(LEAF, over);
    });
    expect(unmet(o).some((u) => u.startsWith('a:followUpNotAdapted('))).toBe(true);
  });

  it('no follow-up observed is RED and names the timing reason', () => {
    const o = broken((x) => {
      x.sessions.confirm.followUp = { reason: 'none_sent_after_fold', request: null, body: null };
    });
    expect(unmet(o)).toContain('a:noFollowUp(none_sent_after_fold)');
  });

  it('the confirmed leaf DRIFTED under the two contrary signals is RED', () => {
    const o = broken((x) => {
      x.sessions.confirm.contrary!.stateAfter!.archetype = 'family_buyer';
    });
    expect(unmet(o)).toContain('a:leafDrifted=family_buyer');
  });

  it('the confirmed leaf LOST MASS under the two contrary signals is RED', () => {
    const o = broken((x) => {
      x.sessions.confirm.contrary!.stateAfter!.confidence = 0.462;
    });
    expect(unmet(o)).toContain('a:leafLostMass=0.462');
  });

  it('contrary signals that never reached the SDK are RED, not "the leaf held"', () => {
    for (const edit of [
      (x: Obs) => {
        x.sessions.confirm.contrary!.bookmarkEventsEmitted = 0;
      },
      (x: Obs) => {
        x.sessions.confirm.contrary!.stateAfter!.signal_count = 4;
      },
      (x: Obs) => {
        x.sessions.confirm.contrary = null;
      },
    ]) {
      const o = broken(edit);
      expect(evaluateAc10(o).ok).toBe(false);
      expect(unmet(o).some((u) => u.startsWith('a:contrarySignalsNotApplied('))).toBe(true);
    }
  });
});

describe('FOLLOW-1361 — RED: (b) correct', () => {
  it('the follow-up carries the PRE-correction hint (the walked leaf) → RED, named (STOP rule)', () => {
    const o = broken((x) => {
      x.sessions.correct.followUp = followUp(LEAF, adaptedBody(LEAF));
    });
    expect(evaluateAc10(o).ok).toBe(false);
    expect(unmet(o)).toContain(`b:followUpCarriesPreCorrectionHint=${LEAF}`);
  });

  it('the follow-up carries the chosen hint but is served the walked leaf → RED (not serving the correction)', () => {
    const o = broken((x) => {
      x.sessions.correct.followUp!.body = adaptedBody(LEAF);
    });
    expect(unmet(o).some((u) => u.startsWith('b:followUpNotAdapted('))).toBe(true);
  });

  it('the row records another correction than the buyer clicked → RED', () => {
    const o = broken((x) => {
      x.sessions.correct.row!.confirmed_archetype = 'lifestyle_expat';
    });
    expect(unmet(o)).toContain('b:rowConfirmedArchetype=lifestyle_expat');
  });

  it('"None of these" (none_of_these / neutral) is not a correction to an archetype → RED', () => {
    const o = broken((x) => {
      x.sessions.correct.chosen = 'neutral';
    });
    expect(unmet(o)).toContain('b:noAlternativeChosen=neutral');
  });

  it('the row offered other alternatives than the DOM showed → RED', () => {
    const o = broken((x) => {
      x.sessions.correct.row!.offered = ['family_buyer', 'downsizer'];
    });
    expect(unmet(o)).toContain('b:rowOffered=["family_buyer","downsizer"]');
  });

  it('the state did not fold to the chosen archetype at 0.90 → RED', () => {
    const o = broken((x) => {
      x.sessions.correct.stateAtFold = { archetype: LEAF, confidence: 0.9, quiz_confirmed: true };
    });
    expect(unmet(o).some((u) => u.startsWith('b:stateAtFold='))).toBe(true);
  });
});

describe('FOLLOW-1361 — RED: (c) × is the negative control', () => {
  it('a × recorded as confirmed is RED', () => {
    const o = broken((x) => {
      x.sessions.dismiss.row = row({ status: 'confirmed' });
    });
    expect(unmet(o)).toEqual(
      expect.arrayContaining(['c:rowStatus=confirmed', `c:rowConfirmedArchetype=${LEAF}`]),
    );
  });

  it('a × that folded at the confirmed mass is RED', () => {
    const o = broken((x) => {
      x.sessions.dismiss.stateAtFold = { archetype: LEAF, confidence: 0.9, quiz_confirmed: true };
    });
    expect(unmet(o).some((u) => u.startsWith('c:stateAtFold='))).toBe(true);
  });

  it('(c) needs no adaptation: its own holdout draw changes nothing', () => {
    const o = broken((x) => {
      x.sessions.dismiss.drewHoldout = true;
      x.sessions.dismiss.followUp!.body = { archetype: 'neutral', holdout_group: true };
    });
    expect(evaluateAc10(o).ok).toBe(true);
  });
});

describe('FOLLOW-1361 — UNMEASURED only on a holdout draw of (a) or (b)', () => {
  const holdoutBody = { archetype: 'neutral', confidence: 0, directives: [], holdout_group: true };

  it('(a) drew holdout on every draw → UNMEASURED:holdout in the TALLY, never PASS', () => {
    const o = broken((x) => {
      x.sessions.confirm.drewHoldout = true;
      x.sessions.confirm.followUp!.body = holdoutBody;
    });
    const v = evaluateAc10(o);
    expect(v.ok).toBe(false);
    expect(v.evidence.unmetPreconditions).toEqual(['a:drewHoldout']);
    const g = gradeRun([asResult(v)], facts);
    expect(g.results[0]?.verdict).toBe('UNMEASURED');
    expect(g.results[0]?.unmeasuredBecause).toBe('holdout');
    expect(g.tallyLine).toBe('TALLY green=0 red=0 unmeasured=1 total=1 run=UNMEASURED');
  });

  it('a holdout draw next to any other failure stays RED', () => {
    const o = broken((x) => {
      x.sessions.correct.drewHoldout = true;
      x.sessions.correct.followUp!.body = holdoutBody;
      x.sessions.dismiss.row = null;
    });
    expect(gradeRun([asResult(evaluateAc10(o))], facts).results[0]?.verdict).toBe('FAIL');
  });

  it('a holdout draw does not excuse a pre-correction hint', () => {
    const o = broken((x) => {
      x.sessions.correct.drewHoldout = true;
      x.sessions.correct.followUp = followUp(LEAF, holdoutBody);
    });
    expect(gradeRun([asResult(evaluateAc10(o))], facts).results[0]?.verdict).toBe('FAIL');
  });

  it('redraws are bounded and small', () => {
    expect(AC10_MAX_DRAWS).toBeGreaterThanOrEqual(1);
    expect(AC10_MAX_DRAWS).toBeLessThanOrEqual(3);
  });
});

describe('FOLLOW-1369 — an unserved quiz config is a precondition, not an SDK verdict', () => {
  const T0 = 1000;
  const builtinPing = [{ event: 'shown', definition_hash: 'builtin-en-v2' }];
  /** A sub-session whose card walked the built-in tree. */
  const unserved = (x: Obs, kind: 'confirm' | 'correct' | 'dismiss', configNet: object): void => {
    x.sessions[kind] = {
      ...x.sessions[kind],
      resultShown: false,
      leaf: null,
      row: row({ definition_hash: 'builtin-en-v2' }),
      pings: builtinPing,
      configNet,
    } as never;
  };
  const neverCompleted = {
    options: [
      { method: 'OPTIONS', startedMono: T0, finishedMono: T0 + 6600, status: 204, failure: null },
    ],
    get: [
      {
        method: 'GET',
        startedMono: T0 + 6600,
        finishedMono: T0 + 15000,
        status: null,
        failure: 'net::ERR_ABORTED',
      },
    ],
  };
  const completed = {
    options: [
      { method: 'OPTIONS', startedMono: T0, finishedMono: T0 + 50, status: 204, failure: null },
    ],
    get: [
      { method: 'GET', startedMono: T0 + 50, finishedMono: T0 + 400, status: 200, failure: null },
    ],
  };

  it('shown ping builtin-en-v2 and the GET never completed → the ONLY unmet entry, UNMEASURED:config', () => {
    const o = broken((x) => {
      unserved(x, 'confirm', neverCompleted);
    });
    const u = unmet(o);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatch(
      /^a:servedConfigNeverReachedBrowser\(OPTIONS 204 6600ms; GET no-response 8400ms net::ERR_ABORTED\)$/,
    );
    const g = gradeRun([asResult(evaluateAc10(o))], facts);
    expect(g.results[0]?.verdict).toBe('UNMEASURED');
    expect(g.results[0]?.unmeasuredBecause).toBe('config');
    expect(g.tallyLine).toBe('TALLY green=0 red=0 unmeasured=1 total=1 run=UNMEASURED');
  });

  it('applies to (c) too, and a pending GET (no finish) counts as never completed', () => {
    const o = broken((x) => {
      unserved(x, 'dismiss', {
        options: [],
        get: [{ method: 'GET', startedMono: T0, finishedMono: null, status: null, failure: null }],
      });
    });
    expect(unmet(o)).toEqual(['c:servedConfigNeverReachedBrowser(GET no-response pending)']);
    expect(gradeRun([asResult(evaluateAc10(o))], facts).results[0]?.verdict).toBe('UNMEASURED');
  });

  it('the GET DID complete (200) yet the card used the built-in tree → RED, an SDK defect', () => {
    const o = broken((x) => {
      unserved(x, 'confirm', completed);
    });
    expect(unmet(o)).toContain('a:builtinTreeWalked');
    expect(unmet(o).some((u) => u.includes('servedConfigNeverReachedBrowser'))).toBe(false);
    expect(gradeRun([asResult(evaluateAc10(o))], facts).results[0]?.verdict).toBe('FAIL');
  });

  it('a shown ping on the SERVED hash is never an unserved config, whatever the GET did', () => {
    expect(
      servedConfigNeverReachedBrowser({
        pings: [{ event: 'shown', definition_hash: HASH }],
        configNet: neverCompleted,
      }),
    ).toBeNull();
  });

  it('an unserved sub-session next to any other failure stays RED', () => {
    const o = broken((x) => {
      unserved(x, 'confirm', neverCompleted);
      x.sessions.dismiss.row = null;
    });
    expect(gradeRun([asResult(evaluateAc10(o))], facts).results[0]?.verdict).toBe('FAIL');
  });

  it('the driver redraws an unserved sub-session within AC10_MAX_DRAWS and records the draw', () => {
    const drive = harnessSrc.slice(harnessSrc.indexOf('async function driveAc10Session'));
    const body = drive.slice(0, drive.indexOf('async function openAc10Session'));
    expect(body).toContain('servedConfigNeverReachedBrowser(s.obs)');
    expect(body).toContain('attempt < AC10_MAX_DRAWS');
  });
});

// ─── Which request is "the first after the fold" ────────────────────────────────────────────

describe('FOLLOW-1361 — pickFirstRequestAfterQuizFold(): the post-fold state stamp, not seq', () => {
  const CLICK = 1000;

  it('takes the first request sent at/after the click that carries the folded state (traits)', () => {
    const calls: Call[] = [
      { seq: 1, requestedMono: 100, traitsSent: false },
      { seq: 2, requestedMono: 999, traitsSent: false },
      { seq: 3, requestedMono: 1002, traitsSent: true },
      { seq: 4, requestedMono: 1500, traitsSent: true },
    ];
    const p = pickFirstRequestAfterQuizFold({ calls, resolveClickMono: CLICK, foldSeen: true });
    expect(p.next?.seq).toBe(3);
    expect(p.reason).toBeNull();
  });

  it('a request sent after the click WITHOUT the folded state (a refresh in flight) is not graded', () => {
    const calls: Call[] = [
      { seq: 1, requestedMono: 1001, traitsSent: false },
      { seq: 2, requestedMono: 1003, traitsSent: true },
    ];
    const p = pickFirstRequestAfterQuizFold({ calls, resolveClickMono: CLICK, foldSeen: true });
    expect(p.next?.seq).toBe(2);
    expect(p.notGradedSeqs).toEqual([1]);
  });

  it('never selects on the hint: the first post-fold request wins even when a later one has the "right" hint', () => {
    const calls: Call[] = [
      { seq: 1, requestedMono: 1001, traitsSent: true, archetypeHint: LEAF },
      { seq: 2, requestedMono: 1400, traitsSent: true, archetypeHint: CHOSEN },
    ];
    const p = pickFirstRequestAfterQuizFold({ calls, resolveClickMono: CLICK, foldSeen: true });
    expect(p.next?.archetypeHint).toBe(LEAF);
  });

  it.each([
    ['the click was not recorded', null, true, 'resolve_click_not_recorded'],
    ['the fold never showed in the persisted state', CLICK, false, 'fold_not_observed'],
  ] as const)('refuses when %s', (_n, click, foldSeen, reason) => {
    const calls: Call[] = [{ seq: 1, requestedMono: 1500, traitsSent: true }];
    const p = pickFirstRequestAfterQuizFold({ calls, resolveClickMono: click, foldSeen });
    expect(p.next).toBeNull();
    expect(p.reason).toBe(reason);
  });

  it('refuses when a request BEFORE the click already carried traits (the marker proves nothing)', () => {
    const calls: Call[] = [
      { seq: 1, requestedMono: 500, traitsSent: true },
      { seq: 2, requestedMono: 1500, traitsSent: true },
    ];
    const p = pickFirstRequestAfterQuizFold({ calls, resolveClickMono: CLICK, foldSeen: true });
    expect(p.next).toBeNull();
    expect(p.reason).toBe('fold_marker_not_unique');
    expect(p.notGradedSeqs).toEqual([1]);
  });

  it('none sent after the fold → reason, never a pass on an earlier request', () => {
    const calls: Call[] = [{ seq: 1, requestedMono: 1100, traitsSent: false }];
    const p = pickFirstRequestAfterQuizFold({ calls, resolveClickMono: CLICK, foldSeen: true });
    expect(p.next).toBeNull();
    expect(p.reason).toBe('none_sent_after_fold');
  });

  it('the marker is real: the SDK sends `traits` iff the state carries quiz_traits, and only the quiz fold writes them', () => {
    expect(adaptSrc).toMatch(
      /if \(intentState\.quiz_traits\) body\.traits = intentState\.quiz_traits;/,
    );
    expect(initIntentState()).not.toHaveProperty('quiz_traits');
    expect(applyQuizLeaf(initIntentState(), 'yield_hunter', 'confirmed')).not.toHaveProperty(
      'quiz_traits',
    );
    // intent-loop.ts onComplete: fold, then quiz_traits on the state, then an unconditional refresh.
    const onComplete = intentLoopSrc.slice(
      intentLoopSrc.indexOf('const final = outcome.final_archetype;'),
      intentLoopSrc.indexOf('() => {\n          // 24h cooldown after closing'),
    );
    expect(onComplete).toContain('applyQuizLeaf(ctx.state, final, evidence)');
    expect(onComplete).toContain('quiz_traits: outcome.traits');
    expect(onComplete).toMatch(/\n {10}void adapt\.refresh\(\);\n/);
  });
});

// ─── Parity: the constants and the signals the verdict leans on ─────────────────────────────

describe('FOLLOW-1361 — parity with the SDK and the route', () => {
  it('the harness fold masses equal what applyQuizLeaf() actually assigns', () => {
    const completed = applyQuizLeaf(initIntentState(), 'first_time_buyer', 'completed');
    const confirmed = applyQuizLeaf(initIntentState(), 'first_time_buyer', 'confirmed');
    const corrected = applyQuizLeaf(initIntentState(), 'first_time_buyer', 'corrected');
    expect(completed.confidence).toBe(FOLD.completed);
    expect(confirmed.confidence).toBe(FOLD.confirmed);
    expect(corrected.confidence).toBe(FOLD.confirmed);
    expect(confirmed.probabilities.first_time_buyer).toBe(FOLD.confirmed);
  });

  it('the sent-similarity cap keeps a confirmed leaf off the playbook branch (ESC-087)', () => {
    const m = /const\s+HIGH_SIMILARITY_THRESHOLD\s*=\s*([0-9.]+)\s*;/.exec(routeSrc);
    expect(m).not.toBeNull();
    const playbookAbove = Number(m![1]);
    // Branch 2 is `similarity > HIGH_SIMILARITY_THRESHOLD`; the cap must not exceed it.
    expect(routeSrc).toMatch(/similarity\s*>\s*HIGH_SIMILARITY_THRESHOLD/);
    expect(FOLD.similarityCap).toBeLessThanOrEqual(playbookAbove);
    expect(Math.min(FOLD.confirmed, FOLD.similarityCap)).toBe(FOLD.similarityCap);
  });

  it('the confirmed and completed masses both clear the server gate (AC(1) predicate reachable)', () => {
    expect(FOLD.completed).toBeGreaterThan(GATE.value);
    expect(FOLD.confirmed).toBeGreaterThan(GATE.value);
  });

  it('readQuizFoldConstants() throws when a constant is gone (never a silent default)', () => {
    expect(() =>
      readQuizFoldConstants({
        intentSrc: intentSrc.replace('QUIZ_CONFIRMED_MASS', 'QUIZ_CONFIRMED_MASS_RENAMED'),
        adaptSrc,
      }),
    ).toThrow(/QUIZ_CONFIRMED_MASS/);
    expect(() =>
      readQuizFoldConstants({ intentSrc, adaptSrc: adaptSrc.replace(/SENT_SIMILARITY_CAP/g, 'X') }),
    ).toThrow(/SENT_SIMILARITY_CAP/);
  });

  it.each(ARCHETYPE_NAMES.filter((a) => a !== 'neutral'))(
    'the contrary signal for %s lowers an UNCONFIRMED leaf and leaves a CONFIRMED one at 0.90',
    (leaf) => {
      const signal = contrarySignalFor(leaf);
      let unconfirmed = applyQuizLeaf(initIntentState(), leaf, 'completed');
      let confirmed = applyQuizLeaf(initIntentState(), leaf, 'confirmed');
      for (let i = 0; i < 2; i++) {
        unconfirmed = applyBehavioralSignal(unconfirmed, 'listing.bookmarked', signal);
        confirmed = applyBehavioralSignal(confirmed, 'listing.bookmarked', signal);
      }
      expect(unconfirmed.probabilities[leaf]).toBeLessThan(FOLD.completed);
      expect(confirmed.archetype).toBe(leaf);
      expect(confirmed.confidence).toBeCloseTo(FOLD.confirmed, 12);
      expect(confirmed.signal_count).toBe(2);
    },
  );
});

// ─── Reading the DOM against the served definition ──────────────────────────────────────────

describe('FOLLOW-1361 — archetypeFromDisplayName(): the DOM text, mapped through the served names', () => {
  it('maps a display name in any language, and nothing else', () => {
    expect(archetypeFromDisplayName(NAMES, 'Family buyer')).toBe('family_buyer');
    expect(archetypeFromDisplayName(NAMES, '  Pierwszy własny dom ')).toBe('first_time_buyer');
    expect(archetypeFromDisplayName(NAMES, 'None of these — show me everything')).toBeNull();
    expect(archetypeFromDisplayName(NAMES, '')).toBeNull();
    expect(archetypeFromDisplayName(null, 'Family buyer')).toBeNull();
  });

  it('an ambiguous name maps to nothing (never the first match)', () => {
    const dup = { ...NAMES, upsizer: { en: 'Family buyer' } };
    expect(archetypeFromDisplayName(dup, 'Family buyer')).toBeNull();
  });

  it('the served default v2: the harness first-answer walk reaches a result screen with a named alternative', () => {
    const def = DEFAULT_QUIZ_DEFINITION_V2;
    const path: (number | number[])[] = [];
    let ns = nextStep(def, { path });
    for (let i = 0; i < 10 && ns.kind === 'question'; i++) {
      const q = def.questions.find((x) => x.id === (ns as { questionId: string }).questionId)!;
      path.push(q.kind === 'multi' ? [0] : 0);
      ns = nextStep(def, { path });
    }
    expect(ns.kind).toBe('confirm');
    const leaf = (ns as { leaf: string }).leaf;
    const names = def.confirm!.names_i18n as Record<string, Record<string, string>>;
    const alts = (def.confirm!.alternatives[leaf] ?? []).filter((a) => names[a]);
    expect(alts.length).toBeGreaterThan(0);
    for (const id of [leaf, ...alts]) {
      for (const text of Object.values(names[id] ?? {})) {
        expect(archetypeFromDisplayName(names, text)).toBe(id);
      }
    }
  });
});

describe('FOLLOW-1367 — evaluateServedQuizConfig(): the tree AC(10) walks is served', () => {
  const ok = {
    data_source: 'db',
    definition_hash: HASH,
    quiz_definition: { confirm: { names_i18n: NAMES } },
  };

  it('accepts 200 + db + a served sha-256 + a confirm block', () => {
    expect(evaluateServedQuizConfig({ status: 200, body: ok }).ok).toBe(true);
  });

  it.each([
    ['a cold compile timeout', { status: null, body: null }],
    ['a 401', { status: 401, body: { error: 'Invalid API key' } }],
    ['a fallback answer', { status: 200, body: { ...ok, data_source: 'fallback' } }],
    ['the built-in label', { status: 200, body: { ...ok, definition_hash: 'builtin-en-v2' } }],
    ['no confirm block', { status: 200, body: { ...ok, quiz_definition: {} } }],
  ])('refuses %s', (_n, probe) => {
    expect(evaluateServedQuizConfig(probe).ok).toBe(false);
  });

  it('localhost-up.sh step 10 warms public-config with the fixture key and fails loudly on the harness check', () => {
    expect(upSrc).toMatch(/api\/quiz\/public-config/);
    expect(upSrc).toMatch(/-m 180 -H "Authorization: Bearer \$FIXTURE_PAGE_KEY"/);
    expect(upSrc).toMatch(/h\.assertServedQuizConfig\(/);
    expect(upSrc).toMatch(/\|\| die "GET \/api\/quiz\/public-config does not serve the quiz tree/);
  });
});

// ─── FOLLOW-1367: AC(5)'s CTA click; TALLY 8; AC(1) at the new values ───────────────────────

describe('FOLLOW-1367 — AC(5) closes the quiz card before its CTA click, never force-clicks', () => {
  it('closeQuizCardBeforeCta() runs before the click and its result lands in AC(5) evidence', () => {
    const at = (s: string) => harnessSrc.indexOf(s);
    const close = at(
      'const quizOverlayBeforeCta = ctaButtonFound ? await closeQuizCardBeforeCta(page)',
    );
    const click = at('await ctaButton.click({ timeout: 5000 });');
    expect(close).toBeGreaterThan(0);
    expect(click).toBeGreaterThan(close);
    expect(harnessSrc).toContain('          quizOverlayBeforeCta,');
  });

  it('closes with the card’s own × and waits for it to be gone; no force anywhere on that path', () => {
    const fn = harnessSrc.slice(
      harnessSrc.indexOf('async function closeQuizCardBeforeCta(page)'),
      harnessSrc.indexOf('// ─── FOLLOW-1361: AC(10), the quiz confirmation path'),
    );
    expect(fn).toContain(".locator('.estalara-quiz-close')");
    expect(fn).toContain("waitFor({ state: 'hidden', timeout })");
    expect(fn).not.toMatch(/force:\s*true/);
    expect(harnessSrc).not.toMatch(/ctaButton\.click\(\{[^}]*force/);
  });
});

describe('FOLLOW-1361 — TALLY total=8, every graded AC listed', () => {
  const all = (): Result[] =>
    ['AC(1)', 'AC(2)', 'AC(3)', 'AC(4)', 'AC(5)', 'AC(7)', 'AC(8)', 'AC(10)'].map((ac) => ({
      ac,
      name: ac,
      ok: true,
    }));

  it('lists eight graded ACs, AC(10) among them', () => {
    expect([...GRADED_ACS]).toEqual(all().map((r) => r.ac));
  });

  it('a full green run reads TALLY green=8 … total=8 run=GREEN', () => {
    expect(gradeRun(all(), facts).tallyLine).toBe(
      'TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN',
    );
  });

  it('missingGradedAcs() names an AC a run never recorded (main() then records it RED)', () => {
    expect(missingGradedAcs(all())).toEqual([]);
    expect(missingGradedAcs(all().filter((r) => r.ac !== 'AC(10)'))).toEqual(['AC(10)']);
    expect(harnessSrc).toContain('for (const ac of missingGradedAcs(results))');
  });
});

describe('FOLLOW-1361 — AC(1)’s predicate at the post-Q4 values', () => {
  it('accepts an llm_tweaked response for a confirmed leaf (confidence 0.90, similarity 0.85)', () => {
    expect(evaluateAc1([adaptedBody(LEAF)], GATE).ok).toBe(true);
  });

  it('accepts an unconfirmed leaf at 0.72 too, and still refuses the playbook branch', () => {
    expect(evaluateAc1([adaptedBody(LEAF, { confidence: 0.72, similarity: 0.72 })], GATE).ok).toBe(
      true,
    );
    expect(evaluateAc1([adaptedBody(LEAF, { source: 'playbook' })], GATE).ok).toBe(false);
  });

  it('no harness comment still quotes the pre-Q4 quiz pins (1.0 / p=0.85)', () => {
    expect(harnessSrc).not.toContain('min(0.85 × 1.2, 1.0) = 1.0');
    expect(harnessSrc).not.toContain('at p=0.85');
  });
});
