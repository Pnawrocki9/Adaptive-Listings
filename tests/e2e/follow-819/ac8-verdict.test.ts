// @vitest-environment node
// (the package default is jsdom, whose global `URL` `createRequire()` rejects at the harness's
// top-level Playwright resolution — same reason ac1-verdict.test.ts pins this)

/**
 * FOLLOW-1299 — AC(8), the chat arm (FOLLOW-820 condition 1b), must not pass over a dead hop.
 *
 * Drives the REAL `evaluateAc8()`, `gradeRun()` and `deriveChatRefreshBudget()` out of
 * `differentiator-e2e.mjs` (imported, not copied). The observation object is the shape
 * `driveChatArm()` returns; `greenObs()` is the shape of a run in which every hop held, and each
 * row below breaks exactly ONE thing in it, so a row that still reads GREEN names a conjunct the
 * verdict does not actually check.
 *
 * THE PREDICATES THIS FILE EXISTS TO RULE OUT (each is executable below as `legacy…`):
 *   - "the archetype after the message is `yield_hunter`" — green on a session that was
 *     `yield_hunter` before anyone spoke, with the whole chat chain dead;
 *   - "the neutral message did not change the archetype" with no proof the message was processed —
 *     green when the shim is down, because a dead chain changes nothing either.
 *
 *   - FOLLOW-1302: "the first message moved the label" (`legacyLabelMoved`, the FOLLOW-1299 shape) —
 *     the CEO ruling of 2026-10-05 says condition 1b needs, after a SECOND consistent message, a
 *     response passing AC(1)'s `isAdaptedResponse()`, on the same page view.
 *
 * Gap candidate G-04 (the chat extraction boundary) is pinned below over the REAL SDK fold
 * (`applyChatIntentPrior()` from `packages/sdk/src/core/intent.ts`), with a parity check of the
 * SDK's gate mirror (`DECISION_CONFIDENCE_GATE`) against the route's `CONFIDENCE_THRESHOLD`.
 *
 * WHAT THIS DOES NOT COVER: whether the live chain produces these observations. That is the manual
 * harness run (README §3, §5.18); this file pins the verdict over an observation, not the
 * observation.
 *
 * Collected by `tests/e2e/vitest.config.ts` (`**\/*.test.ts`); run by `pnpm e2e:smoke`, which
 * `.github/workflows/e2e-smoke.yml` executes nightly. It needs no substrate and takes no flag.
 *
 * @module tests/e2e/follow-819/ac8-verdict.test
 */

import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import { DECISION_CONFIDENCE_GATE } from '../../../packages/sdk/src/core/adapt-floor';
import { applyChatIntentPrior, initIntentState } from '../../../packages/sdk/src/core/intent';

interface Next {
  requestSeq: number;
  sameSession: boolean;
  archetypeHint: string | null;
  responseStatus: number;
  responseArchetype: string | null;
}
interface ChatObs {
  expectedArchetype: string;
  eventName: string;
  shimOrigin: string;
  sessionId: string | null;
  drewHoldout: boolean | null;
  baseline: { archetype: string | null; archetypes: (string | null)[]; responses: number } | null;
  negative: {
    emitted: boolean;
    ingestStatus: number | null;
    shadowSeen: boolean;
    responsesAfterMessage: number;
    archetypesAfter: (string | null)[];
  } | null;
  positive: {
    emitted: boolean;
    ingestStatus: number | null;
    shimHealthStatus: number | null;
    shadowReadable: boolean;
    shadowKey: string | null;
    shadowAdvanced: boolean;
    record: { detected_at: string; intent_dimensions: Record<string, unknown> } | null;
    carrier: {
      requestSeq: number;
      dimensions: Record<string, string> | null;
      detectedAt: string | null;
    } | null;
    next: Next | null;
  } | null;
  second: {
    emitted: boolean;
    ingestStatus: number | null;
    shadowAdvanced: boolean;
    record: { detected_at: string; intent_dimensions: Record<string, unknown> } | null;
    carrier: {
      requestSeq: number;
      dimensions: Record<string, string> | null;
      detectedAt: string | null;
    } | null;
    next: (Next & { confidenceSent: number | null }) | null;
    responsesAfterCarrier: { requestSeq: number; sessionId: string | null; body: unknown }[];
  } | null;
  navigationsAfterBaseline?: number | null;
}
interface Gate {
  value: number;
  comparison: string;
  source: string;
}
interface Ac8Verdict {
  ok: boolean;
  name: string;
  summary: string;
  brokenHop: string | null;
  evidence: {
    unmetPreconditions: string[];
    hops?: { hop: number; name: string; ok: boolean; detail: string }[];
    baselineDiffers?: boolean;
    negativeControl?: { ok: boolean; proven: boolean; notProvenBecause: string | null };
    secondExtractionChanged?: { dimension: string; first: unknown; second: unknown }[] | null;
    adaptedAfterSecondMessage?: { requestSeq: number; source: string } | null;
  };
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
interface Budget {
  debounceMs: number;
  retryMs: number;
  maxAttempts: number;
  cycleMs: number;
  budgetMs: number;
}

let evaluateAc8Raw: (obs: ChatObs, serverGate: Gate) => Ac8Verdict;
/** The real gate, read from route.ts by the harness's own reader (beforeAll). */
let GATE: Gate;
const evaluateAc8 = (obs: ChatObs): Ac8Verdict => evaluateAc8Raw(obs, GATE);
let gradeRun: (
  results: readonly { ac: string; name: string; ok: boolean; evidence?: unknown }[],
  facts: {
    adaptedArmDrewHoldout: boolean | null;
    adaptedResponsesArrivedAfterVerdict: number;
    chatArmDrewHoldout?: boolean | null;
  },
) => Grade;
let deriveChatRefreshBudget: (args: { indexSrc: string; slackMs?: number }) => Budget;
let script: {
  eventName: string;
  neutralMessage: string;
  positiveMessage: string;
  secondMessage: string;
  expectedArchetype: string;
};
let sdkIndexSrc: string;

beforeAll(async () => {
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const mod = (await import('./differentiator-e2e.mjs')) as {
    evaluateAc8: typeof evaluateAc8Raw;
    gradeRun: typeof gradeRun;
    deriveChatRefreshBudget: typeof deriveChatRefreshBudget;
    readServerConfidenceGate: () => Promise<Gate>;
    CHAT_ARM_SCRIPT: typeof script;
  };
  evaluateAc8Raw = mod.evaluateAc8;
  GATE = await mod.readServerConfidenceGate();
  gradeRun = mod.gradeRun;
  deriveChatRefreshBudget = mod.deriveChatRefreshBudget;
  script = mod.CHAT_ARM_SCRIPT;
  // FOLLOW-1296: the chat bridge, the follow-up predicate and the chat-refresh schedule moved
  // with `refreshDirectives()` from `index.ts` into `core/adapt-loop.ts`; the pins read them there.
  sdkIndexSrc = await readFile(
    new URL('../../../packages/sdk/src/core/adapt-loop.ts', import.meta.url),
    'utf8',
  );
});

const SID = 'c'.repeat(32);
const STAMP = '2026-10-04T12:00:09.000000+00:00';
const STAMP2 = '2026-10-04T12:00:31.000000+00:00';

/** A response body that passes AC(1)'s `isAdaptedResponse()` (the shape of a branch-3 reply). */
const adaptedBody = (over: Record<string, unknown> = {}) => ({
  archetype: 'yield_hunter',
  confidence: 0.664,
  source: 'llm_tweaked',
  directives: [
    { type: 'text', slot: 'headline', value: 'A let-ready flat' },
    { type: 'reorder', slot: 'features', order: ['a', 'b'] },
  ],
  ...over,
});

/**
 * Every hop held, the baseline was `neutral`, the neutral message was processed and moved nothing,
 * and after the SECOND message the SDK's own follow-up (#13) was answered ADAPTED, no reload.
 */
function greenObs(): ChatObs {
  return {
    expectedArchetype: 'yield_hunter',
    eventName: 'estalara:chat:message-sent',
    shimOrigin: 'http://localhost:8090',
    sessionId: SID,
    drewHoldout: false,
    baseline: { archetype: 'neutral', archetypes: ['neutral'], responses: 1 },
    negative: {
      emitted: true,
      ingestStatus: 200,
      shadowSeen: true,
      responsesAfterMessage: 3,
      archetypesAfter: ['neutral', 'neutral', 'neutral', 'neutral'],
    },
    positive: {
      emitted: true,
      ingestStatus: 200,
      shimHealthStatus: 200,
      shadowReadable: true,
      shadowKey: `shadow:00000000-0000-0000-0000-0000000000e2:${SID}:chat_intent`,
      shadowAdvanced: true,
      record: { detected_at: STAMP, intent_dimensions: { purchase_purpose: 'investment' } },
      carrier: {
        requestSeq: 7,
        dimensions: { purchase_purpose: 'investment', tax_aware: 'true' },
        detectedAt: STAMP,
      },
      next: {
        requestSeq: 8,
        sameSession: true,
        archetypeHint: 'yield_hunter',
        responseStatus: 200,
        responseArchetype: 'yield_hunter',
      },
    },
    second: {
      emitted: true,
      ingestStatus: 200,
      shadowAdvanced: true,
      record: {
        detected_at: STAMP2,
        intent_dimensions: {
          purchase_purpose: 'investment',
          finance_complexity: 'investment_vehicle',
        },
      },
      carrier: {
        requestSeq: 12,
        dimensions: { purchase_purpose: 'investment', finance_complexity: 'investment_vehicle' },
        detectedAt: STAMP2,
      },
      next: {
        requestSeq: 13,
        sameSession: true,
        archetypeHint: 'yield_hunter',
        confidenceSent: 0.664,
        responseStatus: 200,
        responseArchetype: 'yield_hunter',
      },
      responsesAfterCarrier: [{ requestSeq: 13, sessionId: SID, body: adaptedBody() }],
    },
    navigationsAfterBaseline: 0,
  };
}

/**
 * The FOLLOW-1299 predicate (README §5.18–§5.20): hops 1–7 — the first message moved the label.
 * The CEO ruling of 2026-10-05 says this is NOT condition 1b; it is kept to prove AC(8) rejects it.
 */
const legacyLabelMoved = (o: ChatObs): boolean => {
  const next = o.positive?.next ?? null;
  return (
    o.baseline?.archetype !== o.expectedArchetype &&
    next !== null &&
    next.archetypeHint === o.expectedArchetype &&
    next.responseArchetype === o.expectedArchetype
  );
};

/** The predicate a first draft would write: only the final archetype is read. */
const legacyFinalArchetypeOnly = (o: ChatObs): boolean =>
  o.positive?.next?.responseArchetype === o.expectedArchetype;
/** The negative control a first draft would write: no proof the neutral message was processed. */
const legacyUnprovenNegativeControl = (o: ChatObs): boolean =>
  (o.negative?.archetypesAfter ?? []).every((a) => a === o.baseline?.archetype);

describe('FOLLOW-1299 — evaluateAc8() (the chat arm, FOLLOW-820 condition 1b)', () => {
  it('GREEN when every hop held, the baseline differed and the negative control held', () => {
    const v = evaluateAc8(greenObs());
    expect(v.ok).toBe(true);
    expect(v.brokenHop).toBeNull();
    expect(v.evidence.unmetPreconditions).toEqual([]);
    expect(v.evidence.hops?.map((h) => h.ok)).toEqual(Array<boolean>(12).fill(true));
    expect(v.evidence.baselineDiffers).toBe(true);
    expect(v.evidence.negativeControl).toMatchObject({ ok: true, proven: true });
    expect(v.summary).toContain('neutral → yield_hunter');
  });

  describe('each hop, broken alone, is RED and is the hop named', () => {
    const rows: [string, (o: ChatObs) => void][] = [
      [
        '1:sdk_emitted_chat_message_sent',
        (o) => {
          if (o.positive) o.positive.emitted = false;
        },
      ],
      [
        '2:ingest_acked_2xx',
        (o) => {
          if (o.positive) o.positive.ingestStatus = 503;
        },
      ],
      [
        '3:intent_engine_shim_reachable',
        (o) => {
          if (o.positive) o.positive.shimHealthStatus = null;
        },
      ],
      [
        '4:shadow_key_written_by_this_message',
        (o) => {
          if (o.positive) {
            o.positive.shadowAdvanced = false;
            o.positive.record = null;
          }
        },
      ],
      [
        '5:adapt_response_carries_chat_intent',
        (o) => {
          if (o.positive) o.positive.carrier = null;
        },
      ],
      [
        '6:sdk_sent_folded_archetype_hint',
        (o) => {
          if (o.positive?.next) o.positive.next.archetypeHint = 'neutral';
        },
      ],
      [
        '7:adapt_response_archetype',
        (o) => {
          if (o.positive?.next) o.positive.next.responseArchetype = 'neutral';
        },
      ],
    ];
    it.each(rows)('%s', (hop, breakIt) => {
      const obs = greenObs();
      breakIt(obs);
      const v = evaluateAc8(obs);
      expect(v.ok).toBe(false);
      expect(v.brokenHop).toBe(hop);
      expect(v.evidence.unmetPreconditions).toContain(`brokenHop=${hop}`);
    });
  });

  it('hop 5 is RED when the response carries dimensions stamped by a DIFFERENT extraction', () => {
    const obs = greenObs();
    if (obs.positive?.carrier) obs.positive.carrier.detectedAt = '2026-10-03T00:00:00+00:00';
    expect(evaluateAc8(obs).brokenHop).toBe('5:adapt_response_carries_chat_intent');
  });

  it('hop 5 is RED when the response carries the stamp and no dimension', () => {
    const obs = greenObs();
    if (obs.positive?.carrier) obs.positive.carrier.dimensions = {};
    expect(evaluateAc8(obs).brokenHop).toBe('5:adapt_response_carries_chat_intent');
  });

  it('hop 6 is RED when the hint arrives under a different session_id', () => {
    const obs = greenObs();
    if (obs.positive?.next) obs.positive.next.sameSession = false;
    expect(evaluateAc8(obs).brokenHop).toBe('6:sdk_sent_folded_archetype_hint');
  });

  it('hop 2 accepts any 2xx and nothing else', () => {
    const accepted = greenObs();
    if (accepted.positive) accepted.positive.ingestStatus = 202;
    expect(evaluateAc8(accepted).ok).toBe(true);
    const unanswered = greenObs();
    if (unanswered.positive) unanswered.positive.ingestStatus = null;
    expect(evaluateAc8(unanswered).brokenHop).toBe('2:ingest_acked_2xx');
  });

  it('RED when the baseline was ALREADY the expected archetype — the legacy predicate passes it', () => {
    const obs = greenObs();
    obs.baseline = { archetype: 'yield_hunter', archetypes: ['yield_hunter'], responses: 1 };
    if (obs.negative) obs.negative.archetypesAfter = ['yield_hunter'];
    expect(legacyFinalArchetypeOnly(obs)).toBe(true);
    const v = evaluateAc8(obs);
    expect(v.ok).toBe(false);
    expect(v.evidence.unmetPreconditions).toEqual(['baselineAlreadyExpectedArchetype']);
  });

  it('RED when there is no baseline archetype at all', () => {
    const obs = greenObs();
    obs.baseline = { archetype: null, archetypes: [], responses: 0 };
    const v = evaluateAc8(obs);
    expect(v.ok).toBe(false);
    expect(v.evidence.unmetPreconditions).toContain('noBaselineArchetype');
  });

  describe('the negative control is graded, and must be proven live', () => {
    it('RED when the neutral message changed the archetype', () => {
      const obs = greenObs();
      if (obs.negative) obs.negative.archetypesAfter = ['neutral', 'family_buyer'];
      const v = evaluateAc8(obs);
      expect(v.ok).toBe(false);
      expect(v.brokenHop).toBeNull();
      expect(v.evidence.unmetPreconditions).toEqual([
        'neutralMessageChangedArchetype:neutral→family_buyer',
      ]);
    });

    it('RED when the neutral message never reached the shim — the legacy control passes it', () => {
      const obs = greenObs();
      if (obs.negative) obs.negative.shadowSeen = false;
      expect(legacyUnprovenNegativeControl(obs)).toBe(true);
      const v = evaluateAc8(obs);
      expect(v.ok).toBe(false);
      expect(v.evidence.negativeControl).toMatchObject({ ok: false, proven: false });
      expect(v.evidence.unmetPreconditions).toEqual([
        'negativeControlNotProven:neutralMessageNeverReachedTheShim',
      ]);
    });

    it.each([
      [
        'neutralMessageNotAcceptedByIngest',
        (o: ChatObs) => {
          if (o.negative) o.negative.ingestStatus = 503;
        },
      ],
      [
        'neutralMessageNotAcceptedByIngest',
        (o: ChatObs) => {
          if (o.negative) o.negative.emitted = false;
        },
      ],
      [
        'noAdaptResponseAfterNeutralMessage',
        (o: ChatObs) => {
          if (o.negative) o.negative.responsesAfterMessage = 0;
        },
      ],
      [
        'noArchetypeAfterNeutralMessage',
        (o: ChatObs) => {
          if (o.negative) o.negative.archetypesAfter = [];
        },
      ],
    ])('RED, not proven: %s', (reason, breakIt) => {
      const obs = greenObs();
      breakIt(obs);
      const v = evaluateAc8(obs);
      expect(v.ok).toBe(false);
      expect(v.evidence.unmetPreconditions).toEqual([`negativeControlNotProven:${reason}`]);
    });

    it('RED when the negative control was never run', () => {
      const obs = greenObs();
      obs.negative = null;
      expect(evaluateAc8(obs).ok).toBe(false);
    });
  });

  it('a dead chain (SKIP_CHAT=1 shape) is RED at hop 3 and the control is NOT proven', () => {
    const obs = greenObs();
    obs.negative = {
      emitted: true,
      ingestStatus: 200,
      shadowSeen: false,
      responsesAfterMessage: 3,
      archetypesAfter: ['neutral', 'neutral', 'neutral', 'neutral'],
    };
    obs.positive = {
      emitted: true,
      ingestStatus: 200,
      shimHealthStatus: null,
      shadowReadable: true,
      shadowKey: null,
      shadowAdvanced: false,
      record: null,
      carrier: null,
      next: {
        requestSeq: 9,
        sameSession: true,
        archetypeHint: 'neutral',
        responseStatus: 200,
        responseArchetype: 'neutral',
      },
    };
    obs.second = {
      emitted: true,
      ingestStatus: 200,
      shadowAdvanced: false,
      record: null,
      carrier: null,
      next: null,
      responsesAfterCarrier: [],
    };
    const v = evaluateAc8(obs);
    expect(v.ok).toBe(false);
    expect(v.brokenHop).toBe('3:intent_engine_shim_reachable');
    expect(v.evidence.hops?.filter((h) => !h.ok).map((h) => h.hop)).toEqual([
      3, 4, 5, 6, 7, 9, 10, 11, 12,
    ]);
    expect(v.evidence.unmetPreconditions).toContain(
      'negativeControlNotProven:neutralMessageNeverReachedTheShim',
    );
  });
});

describe('FOLLOW-1302 — condition 1b is an ADAPTED response after the second message, not a moved label', () => {
  const setSecond = (o: ChatObs, f: (s: NonNullable<ChatObs['second']>) => void) => {
    if (o.second) f(o.second);
  };

  it('label moved but not adapted = RED — the FOLLOW-1299 predicate passes it', () => {
    // The recorded negative case: the second extraction repeats the first, the fold stays under
    // the gate on the same archetype, so the SDK draws no follow-up and nothing is adapted.
    const obs = greenObs();
    setSecond(obs, (s) => {
      s.next = null;
      s.responsesAfterCarrier = [];
    });
    expect(legacyLabelMoved(obs)).toBe(true);
    const v = evaluateAc8(obs);
    expect(v.ok).toBe(false);
    expect(v.brokenHop).toBe('11:sdk_drew_follow_up_above_gate');
    expect(v.evidence.hops?.filter((h) => !h.ok).map((h) => h.hop)).toEqual([11, 12]);
    expect(v.evidence.adaptedAfterSecondMessage).toBeNull();
  });

  it('label moved and a call followed, but under the gate and unadapted = RED at hop 11', () => {
    const obs = greenObs();
    setSecond(obs, (s) => {
      if (s.next) s.next.confidenceSent = 0.484;
      s.responsesAfterCarrier = [
        {
          requestSeq: 13,
          sessionId: SID,
          body: adaptedBody({
            confidence: 0.484,
            source: 'default',
            directives: [{ type: 'reorder', slot: 'features', order: ['a'] }],
          }),
        },
      ];
    });
    expect(legacyLabelMoved(obs)).toBe(true);
    const v = evaluateAc8(obs);
    expect(v.ok).toBe(false);
    expect(v.brokenHop).toBe('11:sdk_drew_follow_up_above_gate');
    expect(v.evidence.hops?.find((h) => h.hop === 12)?.ok).toBe(false);
  });

  it.each<[string, Record<string, unknown>]>([
    [
      'the fact check refused the batch (template cta only)',
      {
        source: 'playbook_fallback_llm_unavailable',
        directives: [{ type: 'text', slot: 'cta', value: 'Ask' }],
      },
    ],
    ['the default branch', { source: 'default' }],
    ['only the reorder', { directives: [{ type: 'reorder', slot: 'features', order: ['a'] }] }],
    ['a neutral archetype', { archetype: 'neutral' }],
    ['confidence exactly at the gate', { confidence: 0.6 }],
  ])('RED at hop 12 when the follow-up’s response is not adapted: %s', (_label, over) => {
    const obs = greenObs();
    setSecond(obs, (s) => {
      s.responsesAfterCarrier = [{ requestSeq: 13, sessionId: SID, body: adaptedBody(over) }];
    });
    const v = evaluateAc8(obs);
    expect(v.ok).toBe(false);
    expect(v.brokenHop).toBe('12:adapted_response_after_second_message');
  });

  it('adapted after message 2 without reload = GREEN, graded by AC(1)’s own predicate', () => {
    const v = evaluateAc8(greenObs());
    expect(v.ok).toBe(true);
    expect(v.evidence.adaptedAfterSecondMessage).toMatchObject({
      requestSeq: 13,
      source: 'llm_tweaked',
    });
    expect(v.summary).toContain('was ADAPTED (llm_tweaked');
    expect(v.summary).toContain('no reload');
  });

  it('RED when the page was navigated after the baseline, or the count was not recorded', () => {
    const reloaded = greenObs();
    reloaded.navigationsAfterBaseline = 1;
    expect(evaluateAc8(reloaded).evidence.unmetPreconditions).toEqual([
      'pageNavigatedAfterBaseline=1',
    ]);
    const unrecorded = greenObs();
    delete unrecorded.navigationsAfterBaseline;
    expect(evaluateAc8(unrecorded).ok).toBe(false);
    expect(evaluateAc8(unrecorded).evidence.unmetPreconditions).toEqual([
      'pageNavigatedAfterBaseline=unrecorded',
    ]);
  });

  it('an adapted response from another session, or not after the carrier, does not count', () => {
    const other = greenObs();
    setSecond(other, (s) => {
      s.responsesAfterCarrier = [
        { requestSeq: 13, sessionId: 'd'.repeat(32), body: adaptedBody() },
      ];
    });
    expect(evaluateAc8(other).brokenHop).toBe('12:adapted_response_after_second_message');
    const early = greenObs();
    setSecond(early, (s) => {
      s.responsesAfterCarrier = [{ requestSeq: 12, sessionId: SID, body: adaptedBody() }];
    });
    expect(evaluateAc8(early).brokenHop).toBe('12:adapted_response_after_second_message');
  });

  it('hop 9 is RED when the second record carries the FIRST message’s stamp', () => {
    const obs = greenObs();
    setSecond(obs, (s) => {
      if (s.record) s.record.detected_at = STAMP;
      if (s.carrier) s.carrier.detectedAt = STAMP;
    });
    expect(evaluateAc8(obs).brokenHop).toBe('9:second_shadow_record_written');
  });

  it('hop 10 is RED when no response carries the second record’s stamp', () => {
    const obs = greenObs();
    setSecond(obs, (s) => {
      if (s.carrier) s.carrier.detectedAt = STAMP;
    });
    expect(evaluateAc8(obs).brokenHop).toBe('10:adapt_response_carries_second_intent');
  });

  it('a RED second message leaves the first message’s hops 1–7 green (they stay intermediate hops)', () => {
    const obs = greenObs();
    setSecond(obs, (s) => {
      s.emitted = false;
    });
    const v = evaluateAc8(obs);
    expect(v.evidence.hops?.slice(0, 7).every((h) => h.ok)).toBe(true);
    expect(v.brokenHop).toBe('8:second_message_emitted_and_acked');
  });

  it('names the dimension the second extraction changed (evidence, not a conjunct)', () => {
    const obs = greenObs();
    if (obs.positive?.record) {
      obs.positive.record.intent_dimensions = {
        purchase_purpose: 'investment',
        finance_complexity: 'standard_mortgage',
      };
    }
    expect(evaluateAc8(obs).evidence.secondExtractionChanged).toEqual([
      { dimension: 'finance_complexity', first: 'standard_mortgage', second: 'investment_vehicle' },
    ]);
  });
});

/**
 * Gap candidate G-04 (Codex Review intake 2026-10-11): the chat extraction boundary — what an
 * extraction must contain for the SDK's fold to cross the server's directive gate. Drives the REAL
 * `initIntentState()` / `applyChatIntentPrior()` out of the SDK source (imported, not copied) and
 * the gate read from route.ts. `E1` is the first message's extraction as the live shim recorded it
 * every run (README §5.18); `E2` is the second message's (README §5.21).
 *
 * From `initIntentState()` (no behavioural signal) the fold lands at 0.351 → 0.463 (E1 twice) /
 * 0.643 (E1 then E2); the live browser session, which carries init-time hints, measured 0.367 →
 * 0.403 (E1 twice, the red-first run) / 0.664 (E1 then E2, every GREEN run) — README §5.21; the
 * intake's 0.484 for E1 twice was not reproduced. The assertions are the boundary, not those
 * decimals.
 */
describe('G-04 — what a second extraction must contain for the fold to cross the gate', () => {
  const E1: Record<string, string> = {
    purchase_purpose: 'investment',
    finance_complexity: 'standard_mortgage',
    decision_role: 'decider',
    risk_appetite: 'balanced',
    tax_aware: 'true',
  };
  const E2: Record<string, string> = { ...E1, finance_complexity: 'investment_vehicle' };
  /** The fold after the first message, from a cold start (pure and deterministic). */
  const S1 = applyChatIntentPrior(initIntentState(), E1);
  /**
   * The SDK's follow-up predicate (`refreshDirectives()`, index.ts, FOLLOW-1306): a fold earns a
   * follow-up call when it changed the hint OR moved the confidence across the gate. Mirrored here;
   * the source-shape assertion below fails if index.ts stops computing it this way.
   */
  const followUpDrawn = (
    before: { archetype: string; confidence: number },
    after: { archetype: string; confidence: number },
  ) =>
    after.archetype !== before.archetype ||
    after.confidence > DECISION_CONFIDENCE_GATE !== before.confidence > DECISION_CONFIDENCE_GATE;

  it('the SDK’s gate mirror equals the route’s gate (parity — FOLLOW-1306 keeps one in step)', () => {
    expect(GATE.comparison).toBe('<=');
    expect(DECISION_CONFIDENCE_GATE).toBe(GATE.value);
  });

  it('index.ts still draws the follow-up on a hint change OR a gate crossing', () => {
    expect(sdkIndexSrc).toMatch(
      /currentIntentState\.archetype !== sentHint \|\|\s*currentIntentState\.confidence > DECISION_CONFIDENCE_GATE !== sentAboveGate/,
    );
  });

  it('one message from a cold start moves the label and stays under the gate', () => {
    const s0 = initIntentState();
    const s1 = S1;
    expect(s0.archetype).toBe('neutral');
    expect(s1.archetype).toBe('yield_hunter');
    expect(s1.confidence).toBeLessThanOrEqual(GATE.value);
    expect(followUpDrawn(s0, s1)).toBe(true); // the hint changed: hops 6–7
  });

  it('NEGATIVE: the same extraction twice stays under the gate, same archetype — no follow-up', () => {
    const s1 = S1;
    const s2 = applyChatIntentPrior(s1, E1);
    expect(s2.archetype).toBe('yield_hunter');
    expect(s2.confidence).toBeGreaterThan(s1.confidence);
    expect(s2.confidence).toBeLessThanOrEqual(GATE.value);
    expect(followUpDrawn(s1, s2)).toBe(false);
  });

  it('POSITIVE: E2 (finance_complexity → investment_vehicle) crosses the gate on yield_hunter', () => {
    const s1 = S1;
    const s2 = applyChatIntentPrior(s1, E2);
    expect(s2.archetype).toBe('yield_hunter');
    expect(s2.confidence).toBeGreaterThan(GATE.value);
    expect(followUpDrawn(s1, s2)).toBe(true);
  });

  it.each<[string, Record<string, string>, 'crosses' | 'stays' | 'flips']>([
    [
      'investment + investment_vehicle',
      { purchase_purpose: 'investment', finance_complexity: 'investment_vehicle' },
      'crosses',
    ],
    ['investment_vehicle alone', { finance_complexity: 'investment_vehicle' }, 'stays'],
    [
      'investment + tax_aware, no finance dimension',
      { purchase_purpose: 'investment', tax_aware: 'true' },
      'stays',
    ],
    ['E1 with finance_complexity → cash', { ...E1, finance_complexity: 'cash' }, 'stays'],
    [
      'investment_vehicle + tax_aware, no purpose',
      { finance_complexity: 'investment_vehicle', tax_aware: 'true' },
      'flips',
    ],
  ])('boundary: %s → %s', (_label, dims, outcome) => {
    const s2 = applyChatIntentPrior(S1, dims);
    if (outcome === 'crosses') {
      expect(s2.archetype).toBe('yield_hunter');
      expect(s2.confidence).toBeGreaterThan(GATE.value);
    } else if (outcome === 'stays') {
      expect(s2.archetype).toBe('yield_hunter');
      expect(s2.confidence).toBeLessThanOrEqual(GATE.value);
    } else {
      expect(s2.archetype).not.toBe('yield_hunter');
    }
  });
});

describe('FOLLOW-1299 — AC(8) in gradeRun(): UNMEASURED only on the chat session’s own holdout draw', () => {
  const holdoutObs = (): ChatObs => ({
    ...greenObs(),
    drewHoldout: true,
    baseline: { archetype: 'neutral', archetypes: ['neutral'], responses: 1 },
    negative: null,
    positive: null,
  });
  const asResult = (v: Ac8Verdict) => ({
    ac: 'AC(8)',
    name: v.name,
    ok: v.ok,
    evidence: v.evidence,
  });
  const mainArmMeasured = { adaptedArmDrewHoldout: false, adaptedResponsesArrivedAfterVerdict: 0 };

  it('a holdout draw is not GREEN and its only unmet precondition is the draw', () => {
    const v = evaluateAc8(holdoutObs());
    expect(v.ok).toBe(false);
    expect(v.evidence.unmetPreconditions).toEqual(['chatArmDrewHoldout']);
  });

  it('grades UNMEASURED:holdout, and the run is UNMEASURED, not RED and not GREEN', () => {
    const g = gradeRun([asResult(evaluateAc8(holdoutObs()))], {
      ...mainArmMeasured,
      chatArmDrewHoldout: true,
    });
    expect(g.results[0]).toMatchObject({ verdict: 'UNMEASURED', unmeasuredBecause: 'holdout' });
    expect(g.runVerdict).toBe('UNMEASURED');
    expect(g.tallyLine).toBe('TALLY green=0 red=0 unmeasured=1 total=1 run=UNMEASURED');
  });

  it('a broken hop stays RED when the QUIZ session drew holdout and the chat session did not', () => {
    const obs = greenObs();
    if (obs.positive) obs.positive.carrier = null;
    const g = gradeRun([asResult(evaluateAc8(obs))], {
      adaptedArmDrewHoldout: true,
      adaptedResponsesArrivedAfterVerdict: 1,
      chatArmDrewHoldout: false,
    });
    expect(g.results[0]).toMatchObject({ verdict: 'FAIL', unmeasuredBecause: null });
    expect(g.runVerdict).toBe('RED');
  });

  it('a broken hop stays RED even when the holdout fact says true', () => {
    const obs = greenObs();
    if (obs.positive) obs.positive.shimHealthStatus = null;
    const g = gradeRun([asResult(evaluateAc8(obs))], {
      ...mainArmMeasured,
      chatArmDrewHoldout: true,
    });
    expect(g.results[0]?.verdict).toBe('FAIL');
  });

  it('the draw-only failure stays RED when the holdout fact is absent or false', () => {
    const r = asResult(evaluateAc8(holdoutObs()));
    expect(gradeRun([r], mainArmMeasured).results[0]?.verdict).toBe('FAIL');
    expect(
      gradeRun([r], { ...mainArmMeasured, chatArmDrewHoldout: false }).results[0]?.verdict,
    ).toBe('FAIL');
  });

  it('a GREEN AC(8) is PASS whatever the facts say', () => {
    const g = gradeRun([asResult(evaluateAc8(greenObs()))], {
      adaptedArmDrewHoldout: true,
      adaptedResponsesArrivedAfterVerdict: 3,
      chatArmDrewHoldout: true,
    });
    expect(g.results[0]?.verdict).toBe('PASS');
    expect(g.runVerdict).toBe('GREEN');
  });

  it('a harness throw inside the arm (`chatArmThrew`) is RED', () => {
    const g = gradeRun(
      [
        {
          ac: 'AC(8)',
          name: 'chat arm',
          ok: false,
          evidence: { unmetPreconditions: ['chatArmThrew'] },
        },
      ],
      { ...mainArmMeasured, chatArmDrewHoldout: null },
    );
    expect(g.results[0]?.verdict).toBe('FAIL');
  });
});

describe('FOLLOW-1299 — the chat arm’s script and its wait budget come from the SDK', () => {
  it('dispatches the event name the SDK source listens for', () => {
    expect(sdkIndexSrc).toContain(`document.addEventListener('${script.eventName}'`);
  });

  it('expects the archetype §P.0 item 1b names for a rental-yield question', () => {
    expect(script.expectedArchetype).toBe('yield_hunter');
    expect(script.positiveMessage).toMatch(/rental yield/);
  });

  it('the second message is a rental-yield question too, and a different one', () => {
    expect(script.secondMessage).toMatch(/rental yield/);
    expect(script.secondMessage).not.toBe(script.positiveMessage);
  });

  it('carries nothing the SDK’s PII scrub would rewrite (digits, @)', () => {
    for (const m of [script.neutralMessage, script.positiveMessage, script.secondMessage]) {
      expect(m).not.toMatch(/[0-9@]/);
    }
  });

  it('reads the chat-refresh schedule off the real SDK source', () => {
    const b = deriveChatRefreshBudget({ indexSrc: sdkIndexSrc, slackMs: 20000 });
    expect(b.cycleMs).toBe(b.debounceMs + (b.maxAttempts - 1) * b.retryMs);
    expect(b.budgetMs).toBe(b.cycleMs + 20000);
    expect(b.maxAttempts).toBeGreaterThanOrEqual(2);
  });

  it('moves when one SDK constant is edited', () => {
    const real = deriveChatRefreshBudget({ indexSrc: sdkIndexSrc, slackMs: 0 });
    const edited = deriveChatRefreshBudget({
      indexSrc: sdkIndexSrc.replace(
        /const CHAT_REFRESH_RETRY_MS = [0-9_]+;/,
        'const CHAT_REFRESH_RETRY_MS = 9_000;',
      ),
      slackMs: 0,
    });
    expect(edited.retryMs).toBe(9000);
    expect(edited.cycleMs).toBe(real.debounceMs + (real.maxAttempts - 1) * 9000);
  });

  it('throws, never guesses, when a constant is gone', () => {
    expect(() =>
      deriveChatRefreshBudget({
        indexSrc: sdkIndexSrc.replace(/const CHAT_REFRESH_MAX_ATTEMPTS = [0-9_]+;/, ''),
      }),
    ).toThrow(/CHAT_REFRESH_MAX_ATTEMPTS/);
  });
});
