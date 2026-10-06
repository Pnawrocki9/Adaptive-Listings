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

let evaluateAc8: (obs: ChatObs) => Ac8Verdict;
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
  expectedArchetype: string;
};
let sdkIndexSrc: string;

beforeAll(async () => {
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const mod = (await import('./differentiator-e2e.mjs')) as {
    evaluateAc8: typeof evaluateAc8;
    gradeRun: typeof gradeRun;
    deriveChatRefreshBudget: typeof deriveChatRefreshBudget;
    CHAT_ARM_SCRIPT: typeof script;
  };
  evaluateAc8 = mod.evaluateAc8;
  gradeRun = mod.gradeRun;
  deriveChatRefreshBudget = mod.deriveChatRefreshBudget;
  script = mod.CHAT_ARM_SCRIPT;
  sdkIndexSrc = await readFile(
    new URL('../../../packages/sdk/src/index.ts', import.meta.url),
    'utf8',
  );
});

const SID = 'c'.repeat(32);
const STAMP = '2026-10-04T12:00:09.000000+00:00';

/** Every hop held, the baseline was `neutral`, the neutral message was processed and moved nothing. */
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
  };
}

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
    expect(v.evidence.hops?.map((h) => h.ok)).toEqual(Array<boolean>(7).fill(true));
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
    const v = evaluateAc8(obs);
    expect(v.ok).toBe(false);
    expect(v.brokenHop).toBe('3:intent_engine_shim_reachable');
    expect(v.evidence.hops?.filter((h) => !h.ok).map((h) => h.hop)).toEqual([3, 4, 5, 6, 7]);
    expect(v.evidence.unmetPreconditions).toContain(
      'negativeControlNotProven:neutralMessageNeverReachedTheShim',
    );
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

  it('carries nothing the SDK’s PII scrub would rewrite (digits, @)', () => {
    for (const m of [script.neutralMessage, script.positiveMessage]) {
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
