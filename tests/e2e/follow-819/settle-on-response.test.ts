// @vitest-environment node
// (the package default is jsdom, whose global `URL` `createRequire()` rejects at the harness's
// top-level Playwright resolution — same reason ac1-verdict.test.ts and grounding-source.test.ts
// pin this)

/**
 * FOLLOW-1239 + FOLLOW-1240 — the FOLLOW-819 harness's post-quiz observation window must close on
 * the QUIZ TURN'S OWN `/api/adapt` response, identified by the request that carried it, and a
 * window that closes for any other reason must never be able to read as "the product did not adapt".
 *
 * FOLLOW-1239 (measured 2026-09-20 at `62ac28f0`, README §5.11 run 2). The harness did
 * `await sleep(3000); await Promise.all(pending)` after the quiz loop and then snapshotted
 * `decided[]` for AC(1)/AC(2). The post-quiz turnaround on that run was **5.278 s**, so the
 * `llm_tweaked` response was pushed into `decided[]` 1.05 s AFTER `evaluateAc1()` had read the array.
 * `legacyFixedSleepSettle()` below is that wait, kept executable.
 *
 * FOLLOW-1240 + its RETRO-340 amendment (the fix #919 shipped identified the awaited response by
 * ARRAY POSITION). `const postQuizStartIndex = decided.length` was taken AFTER the quiz loop's final
 * `sleep(1200)`, so a FAST quiz-turn response (259–785 ms on the holdout run) landed BEFORE the index.
 * If it was not adapted — holdout, template, `default`, an error — neither `new-response` nor
 * `adapted-response` could fire, the wait burned the whole 30 s budget, and the cause printed was
 * "NO /api/adapt response from the quiz turn … an LLM/control-plane outage, a quiz that never
 * resolved a leaf, or a turnaround longer than the budget" — none of which had happened. The
 * converse was positional too: ANY later `/api/adapt` (a behavioural refresh, the CTA click)
 * satisfied `new-response` whether or not the quiz caused it. `legacyPositionalSettle()` below is
 * that wait, kept executable, so every FOLLOW-1240 row is driven through BOTH it and the real
 * `settleForAdaptResponse()`: the legacy column reproduces the defect, the real one asserts the fix.
 * The two legacy functions live in this file and nowhere else: they are the bugs, kept executable.
 *
 * THE BODIES ARE REAL BYTES, not shapes typed from ticket prose:
 *   - `COLD_START` / `LATE_ADAPTED`: `decided[0]` / `decided[1]` of the 62ac28f0 artefact.
 *   - `HOLDOUT_*`: session `6f1f169e-…` (FOLLOW-1239 substrate run 2, 2026-09-20T20:14:43Z), the run
 *     FOLLOW-1240 was filed from. Its `last-run.json` was overwritten by the next run, so the three
 *     bodies are rebuilt from the two sources that survive, and each field says which:
 *     `adapt_decision_id`, `session_id`, `page_context` and the timestamps are the three
 *     `adaptation_decisions` rows ClickHouse still holds for that session (local
 *     `estalara_ch_local`, read 2026-09-22); every other field is the literal holdout-branch
 *     `NextResponse.json({...})` in `apps/control-plane/src/app/api/adapt/route.ts` (`archetype:
 *     'neutral'`, `confidence: 0.5`, `directives: []`, `reorderDirectives: []`, `source: 'default'`,
 *     `holdout_group: true`). `similarity` is that branch's `body.similarity ?? 0.5` echo of the
 *     SDK's request and affects no predicate.
 *
 * WHAT THIS FILE MUST NEVER BECOME. The settle may change WHEN the population is read and must never
 * change WHAT counts as adaptation. The outage, refusal, template, holdout and absent-response rows
 * are the negative controls: each still reads AC(1) RED, with `postQuizSettle.cause` naming why.
 * `evaluateAc1()` is imported, never re-implemented (FOLLOW-1186).
 *
 * TIME IS VIRTUAL. `virtualClock()` injects `now`/`sleepFn`, so a 30 s budget costs microseconds and
 * no row can flake on a loaded box. Request/response timestamps are the scheduled virtual times. No
 * wall clock, no `Math.random()`, no ordering by chance.
 *
 * Collected by `tests/e2e/vitest.config.ts` (`**\/*.test.ts`); run by `pnpm e2e:smoke`, which
 * `.github/workflows/e2e-smoke.yml` executes nightly. It needs no substrate and takes no flag.
 *
 * @module tests/e2e/follow-819/settle-on-response.test
 */

import { beforeAll, describe, expect, it } from 'vitest';

interface Gate {
  value: number;
  comparison: string;
  source: string;
}
/** One entry of the harness's `adaptRequests[]` — pushed by the context `request` listener. */
interface AdaptRequest {
  seq: number;
  requestedAt: number;
  url: string;
  archetypeHint: string | null;
  confidence: number | null;
  failure: string | null;
}
/** One entry of the harness's `decided[]` — pushed when a response body has been read. */
interface DecidedEntry {
  url: string;
  status: number;
  body?: unknown;
  bodyError?: string;
  requestSeq: number | null;
  receivedAt: number;
}
type EndedBy =
  | 'quiz-response'
  | 'quiz-response-holdout'
  | 'quiz-request-failed'
  | 'no-quiz-turn'
  | 'budget';
interface SettleResult {
  endedBy: EndedBy;
  timedOut: boolean;
  waitedMs: number;
  quizCompletedAt: number | null;
  quizRequest: {
    seq: number;
    requestedAt: number;
    msAfterCompletingClick: number;
    archetypeHint: string | null;
    confidence: number | null;
    failure: string | null;
  } | null;
  quizResponse: {
    requestSeq: number;
    decidedIndex: number;
    status: number;
    receivedAt: number;
    msAfterRequest: number;
    arrivedBeforeSettleStarted: boolean;
    source: string | null;
    archetype: string | null;
    confidence: number | null;
    holdoutGroup: boolean;
  } | null;
  responsesAfterCompletingClick: number;
  adaptedResponseCount: number;
  budgetMs: number;
  floorMs: number;
  paintGraceMs: number;
  cause: string;
}
type SettleForAdaptResponse = (args: {
  decided: DecidedEntry[];
  pending: Promise<unknown>[];
  adaptRequests: AdaptRequest[];
  quizCompletedAt: number | null;
  serverGate: Gate;
  budgetMs?: number;
  floorMs?: number;
  paintGraceMs?: number;
  pollMs?: number;
  now?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
}) => Promise<SettleResult>;
interface Ac1Verdict {
  ok: boolean;
  evidence: {
    evaluatedResponseCount: number;
    outcomes: Record<string, number>;
    sourcesObserved: Record<string, number>;
  };
}
type EvaluateAc1 = (responses: readonly unknown[], serverGate: Gate) => Ac1Verdict;
type EvaluateIngestProbe = (probe: {
  status: number | null;
  bodyText: string | null;
  networkError: string | null;
}) => { ok: boolean; failureClass: string | null; reason: string };

let settleForAdaptResponse: SettleForAdaptResponse;
let evaluateAc1: EvaluateAc1;
let evaluateIngestProbe: EvaluateIngestProbe;

beforeAll(async () => {
  // The harness runs main() at import unless told not to — see the guard at its foot.
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const mod = (await import('./differentiator-e2e.mjs')) as {
    settleForAdaptResponse: SettleForAdaptResponse;
    evaluateAc1: EvaluateAc1;
    evaluateIngestProbe: EvaluateIngestProbe;
  };
  settleForAdaptResponse = mod.settleForAdaptResponse;
  evaluateAc1 = mod.evaluateAc1;
  evaluateIngestProbe = mod.evaluateIngestProbe;
});

/** `readServerConfidenceGate()` reads 0.6 with `<=` from route.ts at HEAD. */
const GATE: Gate = {
  value: 0.6,
  comparison: '<=',
  source: 'apps/control-plane/src/app/api/adapt/route.ts',
};

const LISTING_ID = '839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c';
const SESSION_ID = '32a76517-3989-4e5e-af79-43c383af4622';

const reorder = (archetype: string, confidence: number, score: number) => ({
  type: 'reorder',
  container_selector: '[data-estalara-listing]',
  item_selector: '[data-estalara-listing-id]',
  score_function: 'archetype_affinity',
  scores: [{ listing_id: LISTING_ID, score }],
  archetype,
  confidence,
});
const text = (slot: string, value: string) => ({
  type: 'text',
  slot,
  value,
  archetype: 'yield_hunter',
  confidence: 1,
});

/** `decided[0]` of the 62ac28f0 artefact — the page-load cold start. */
const COLD_START = {
  adapt_decision_id: 'e42c0733-6cbd-432a-b844-4f7e755b1d61',
  session_id: SESSION_ID,
  archetype: 'neutral',
  confidence: 0.36554663991975933,
  similarity: 0.36554663991975933,
  page_context: 2,
  directives: [reorder('neutral', 0.36554663991975933, 0.11262607147946391)],
  source: 'default',
  variant: 'v2',
  generated_at: '2026-09-20T18:33:10.576Z',
};

/** `decided[1]` of the 62ac28f0 artefact — the adaptation its own AC(1) reported as absent. */
const LATE_ADAPTED = {
  adapt_decision_id: '472bd2da-64b4-41c1-8398-fabf4b72e585',
  session_id: SESSION_ID,
  archetype: 'yield_hunter',
  confidence: 1,
  similarity: 0.85,
  page_context: 2,
  directives: [
    text(
      'headline',
      'Single-family rental on quiet residential street — 3 bed, 2 bath in Palm Coast',
    ),
    text('cta', 'Request Investment Pack'),
    text('feature', 'Established residential location near schools and local amenities'),
    reorder('yield_hunter', 1, 0.1303936294515975),
  ],
  source: 'llm_tweaked',
  variant: 'v1',
  generated_at: '2026-09-20T18:33:24.805Z',
};

/**
 * The same turn, but the gateway answered null: `withholdUngroundedDirectives()` leaves the
 * non-assertive `cta` only (`NON_ASSERTIVE_SLOTS`, `lib/ungrounded-directives.ts`). This is what the
 * runs before FOLLOW-1225 got, and it must stay RED however long the harness waits for it.
 */
const LATE_OUTAGE = {
  ...LATE_ADAPTED,
  directives: [text('cta', 'Request Investment Pack'), reorder('yield_hunter', 1, 0.13)],
  source: 'playbook_fallback_llm_unavailable',
  fallback_reason: 'listing_context_unavailable',
  variant: 'control',
};

/** The same turn, fact-checked and REFUSED. Also RED, also however long the harness waits. */
const LATE_REFUSED = {
  ...LATE_OUTAGE,
  fallback_reason: 'fact_check_refused',
};

/**
 * Branch 2's template answer — the `playbook` + `ungrounded_directives_withheld` body every §5.13 run
 * drew on the CTA click. A FAST non-adapted answer: the RETRO-340 LG-1 axis that is not holdout.
 */
const FAST_TEMPLATE = {
  ...LATE_OUTAGE,
  source: 'playbook',
  fallback_reason: 'ungrounded_directives_withheld',
};

/** Session `6f1f169e-…` — see the module docblock for which field came from where. */
const HOLDOUT_SESSION_ID = '6f1f169e-bb94-4031-9ef7-053bda8ee4fc';
const holdoutBody = (adaptDecisionId: string, similarity: number, generatedAt: string) => ({
  adapt_decision_id: adaptDecisionId,
  session_id: HOLDOUT_SESSION_ID,
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
/** ClickHouse row 1 (ts 20:14:46.262) — the page-load call. */
const HOLDOUT_COLD_START = holdoutBody(
  '35f0b0e7-95e7-40fc-8b88-54f9f295c727',
  0.36554663991975933,
  '2026-09-20T20:14:46.262Z',
);
/** ClickHouse row 2 (ts 20:15:03.163) — the quiz turn; logged would-be `yield_hunter` @ 1. */
const HOLDOUT_QUIZ_TURN = holdoutBody(
  '337423a5-1068-4a0f-b50b-b5ee538a2a27',
  0.85,
  '2026-09-20T20:15:03.163Z',
);
/** ClickHouse row 3 (ts 20:15:34.255) — the CTA click, 31 s after the quiz turn. */
const HOLDOUT_CTA = holdoutBody(
  '2ab683f8-d124-490e-a594-671b9b816472',
  0.8551991,
  '2026-09-20T20:15:34.255Z',
);
/** FOLLOW-1240's measured route latencies for those three calls, in order. */
const HOLDOUT_LATENCY_MS = { coldStart: 785, quizTurn: 533, cta: 259 } as const;

/** The post-quiz turnaround measured on 2026-09-20: 18:33:19.527 → 18:33:24.805. */
const MEASURED_TURNAROUND_MS = 5278;

/**
 * The quiz loop's timeline, in virtual ms. The completing click is timestamped just BEFORE it is
 * dispatched (that is what the harness records as `quizCompletedAt`); the quiz-completion callback
 * calls `refreshDirectives()` synchronously, so the quiz turn's request follows within a few ms; the
 * loop then sleeps 1200 ms before it can see that the card is gone, and only then does the settle
 * start. Everything a fast control plane answers inside those 1200 ms is ALREADY in `decided[]` when
 * the settle begins — the RETRO-340 LG-1 window.
 */
const CLICK_MS = 17000;
const QUIZ_REQUEST_MS = CLICK_MS + 5;
const SETTLE_START_MS = CLICK_MS + 1200;

/**
 * A deterministic clock. `sleep()` fires every event scheduled at or before the new time, in
 * schedule order, then advances. Nothing is timing-dependent, so no row here can flake.
 */
function virtualClock() {
  let t = 0;
  const scheduled: { at: number; order: number; fire: () => void; done: boolean }[] = [];
  let order = 0;
  return {
    // Arrow properties, not shorthand methods: every one of these is handed to the harness as a
    // bare reference, and a `this`-bound method would be an unbound-method hazard there.
    now: () => t,
    at: (ms: number, fire: () => void) => {
      scheduled.push({ at: ms, order: order++, fire, done: false });
      scheduled.sort((a, b) => a.at - b.at || a.order - b.order);
    },
    sleep: async (ms: number) => {
      const target = t + ms;
      for (const s of scheduled) {
        if (!s.done && s.at <= target) {
          s.done = true;
          s.fire();
        }
      }
      t = target;
      await Promise.resolve();
    },
  };
}

/** One `/api/adapt` call the SDK makes: when its request goes out, and when/how it settles. */
interface Call {
  requestedAtMs: number;
  respondedAtMs?: number;
  failedAtMs?: number;
  body?: unknown;
  archetypeHint?: string | null;
}

/**
 * The traffic model, mirroring the harness's two context listeners: a `request` event pushes into
 * `adaptRequests[]` with the next `seq`; a response pushes into `decided[]` (and `pending[]`) only
 * once its body has been read, carrying the `requestSeq` of the request it answers; a
 * `requestfailed` event stamps `failure` on the request.
 */
function traffic(clock: ReturnType<typeof virtualClock>, calls: readonly Call[]) {
  const adaptRequests: AdaptRequest[] = [];
  const decided: DecidedEntry[] = [];
  const pending: Promise<unknown>[] = [];
  calls.forEach((c, i) => {
    const seq = i + 1;
    clock.at(c.requestedAtMs, () => {
      adaptRequests.push({
        seq,
        requestedAt: c.requestedAtMs,
        url: 'http://localhost:3000/api/adapt',
        archetypeHint: c.archetypeHint ?? null,
        confidence: null,
        failure: null,
      });
    });
    if (c.respondedAtMs !== undefined) {
      const at = c.respondedAtMs;
      clock.at(at, () => {
        decided.push({
          url: 'http://localhost:3000/api/adapt',
          status: 200,
          body: c.body,
          requestSeq: seq,
          receivedAt: at,
        });
        pending.push(Promise.resolve());
      });
    }
    if (c.failedAtMs !== undefined) {
      clock.at(c.failedAtMs, () => {
        const req = adaptRequests.find((r) => r.seq === seq);
        if (req) req.failure = 'net::ERR_CONNECTION_RESET';
      });
    }
  });
  return { adaptRequests, decided, pending };
}

/** Advance to the moment the harness starts the settle, then run the REAL settle. */
async function settleFromLoopEnd(
  clock: ReturnType<typeof virtualClock>,
  t: ReturnType<typeof traffic>,
  {
    quizCompletedAt = CLICK_MS,
    startMs = SETTLE_START_MS,
  }: { quizCompletedAt?: number | null; startMs?: number } = {},
) {
  await clock.sleep(startMs - clock.now());
  return settleForAdaptResponse({
    decided: t.decided,
    pending: t.pending,
    adaptRequests: t.adaptRequests,
    quizCompletedAt,
    serverGate: GATE,
    now: clock.now,
    sleepFn: clock.sleep,
  });
}

/**
 * THE FOLLOW-1239 BUG, kept executable: the pre-FOLLOW-1239 post-quiz wait, byte for byte in
 * behaviour — `await sleep(3000); await Promise.all(pending);` and then the caller snapshots.
 */
async function legacyFixedSleepSettle(
  clock: ReturnType<typeof virtualClock>,
  pending: Promise<unknown>[],
): Promise<void> {
  await clock.sleep(3000);
  await Promise.all([...pending]);
}

/** What AC(1) sees: the bodies present in `decided[]` at the instant the verdict reads it. */
const gradeNow = (decided: DecidedEntry[]) =>
  evaluateAc1(
    decided.filter((d) => d.body).map((d) => d.body),
    GATE,
  );

/**
 * THE FOLLOW-1240 BUG, kept executable: `settleForAdaptResponse()` as #919 shipped it (`e0cd7560`),
 * exit conditions and cause strings unchanged. `startIndex` is `decided.length` at the moment the
 * caller begins the wait — array POSITION, which is the defect. `adapted-response` asks AC(1)'s own
 * predicate through `evaluateAc1()` (the parity case below pins that equivalence).
 */
async function legacyPositionalSettle(
  clock: ReturnType<typeof virtualClock>,
  t: ReturnType<typeof traffic>,
  startMs = SETTLE_START_MS,
) {
  await clock.sleep(startMs - clock.now());
  const startIndex = t.decided.length;
  const started = clock.now();
  let endedBy: 'new-response' | 'adapted-response' | 'budget' = 'budget';
  for (;;) {
    const elapsed = clock.now() - started;
    if (elapsed >= 3000 && t.decided.length - startIndex > 0) {
      endedBy = 'new-response';
      break;
    }
    if (elapsed >= 3000 && gradeNow(t.decided).evidence.outcomes.adapted > 0) {
      endedBy = 'adapted-response';
      break;
    }
    if (elapsed >= 30000) break;
    await clock.sleep(250);
  }
  if (endedBy !== 'budget') await clock.sleep(1500);
  await Promise.all([...t.pending]);
  const newResponseCount = t.decided.length - startIndex;
  const cause =
    endedBy === 'budget'
      ? newResponseCount > 0
        ? 'BUDGET EXPIRED after 30000 ms; post-quiz response(s) landed only in the final poll gap.'
        : 'BUDGET EXPIRED after 30000 ms with NO /api/adapt response from the quiz turn. The ' +
          'post-quiz decision call never completed — an LLM/control-plane outage, a quiz that ' +
          'never resolved a leaf, or a turnaround longer than the budget.'
      : `ended on ${endedBy}`;
  return { endedBy, waitedMs: clock.now() - started, cause };
}

/**
 * The artefact's `adaptedResponsesArrivedAfterVerdict`, computed the way the harness computes it:
 * AC(1)'s own predicate over the bodies that landed after `gradedResponseCount`.
 */
const lateAdaptedCount = (decided: DecidedEntry[], gradedResponseCount: number) =>
  gradeNow(decided.slice(gradedResponseCount)).evidence.outcomes.adapted;

/** The page-load call every scenario starts with: requested at 0, answered at 785 ms. */
const coldStartCall = (body: unknown = COLD_START): Call => ({
  requestedAtMs: 0,
  respondedAtMs: HOLDOUT_LATENCY_MS.coldStart,
  body,
});

describe('FOLLOW-1239 — the 2026-09-20 false RED, reproduced and fixed', () => {
  it('legacy fixed 3 s sleep: AC(1) RED over 1 body while the artefact ends up holding 2', async () => {
    const clock = virtualClock();
    const t = traffic(clock, [
      coldStartCall(),
      {
        requestedAtMs: QUIZ_REQUEST_MS,
        respondedAtMs: SETTLE_START_MS + MEASURED_TURNAROUND_MS,
        body: LATE_ADAPTED,
      },
    ]);
    await clock.sleep(SETTLE_START_MS);

    await legacyFixedSleepSettle(clock, t.pending);
    const verdict = gradeNow(t.decided);
    const gradedResponseCount = t.decided.length;

    // The verdict, exactly as `62ac28f0`'s artefact recorded it.
    expect(verdict.ok).toBe(false);
    expect(verdict.evidence.evaluatedResponseCount).toBe(1);
    expect(verdict.evidence.sourcesObserved).toEqual({ default: 1 });
    expect(verdict.evidence.outcomes.adapted).toBe(0);

    // …and then the response lands — 2.278 s after this window closed — into the array the file
    // serialises. The two numbers FOLLOW-1239 asks the artefact to carry.
    await clock.sleep(MEASURED_TURNAROUND_MS - 3000);
    expect(t.decided).toHaveLength(2);
    expect((t.decided[1].body as { source: string }).source).toBe('llm_tweaked');
    expect(t.decided.length - gradedResponseCount).toBe(1);
    expect(lateAdaptedCount(t.decided, gradedResponseCount)).toBe(1);
  });

  it('settleForAdaptResponse: the same traffic ends the wait on the quiz response and AC(1) is GREEN', async () => {
    const clock = virtualClock();
    const t = traffic(clock, [
      coldStartCall(),
      {
        requestedAtMs: QUIZ_REQUEST_MS,
        respondedAtMs: SETTLE_START_MS + MEASURED_TURNAROUND_MS,
        body: LATE_ADAPTED,
      },
    ]);

    const settle = await settleFromLoopEnd(clock, t);
    const verdict = gradeNow(t.decided);
    const gradedResponseCount = t.decided.length;

    expect(settle.endedBy).toBe('quiz-response');
    expect(settle.timedOut).toBe(false);
    expect(settle.quizRequest?.seq).toBe(2);
    expect(settle.quizResponse?.requestSeq).toBe(2);
    expect(settle.quizResponse?.arrivedBeforeSettleStarted).toBe(false);
    // It waited for the response and not a millisecond of the budget beyond it: the first poll
    // boundary at or after 5278 ms (250 ms poll) plus the paint grace.
    expect(settle.waitedMs).toBe(5500 + settle.paintGraceMs);
    expect(settle.waitedMs).toBeLessThan(settle.budgetMs);

    expect(verdict.ok).toBe(true);
    expect(verdict.evidence.evaluatedResponseCount).toBe(2);
    expect(verdict.evidence.outcomes.adapted).toBe(1);

    // No ADAPTED body arrives after the verdict any more — the artefact and its own AC(1) agree.
    await clock.sleep(10000);
    expect(t.decided.length - gradedResponseCount).toBe(0);
    expect(lateAdaptedCount(t.decided, gradedResponseCount)).toBe(0);
  });
});

describe('FOLLOW-1240 — the awaited response is identified by REQUEST, not by array position', () => {
  it('RED-FIRST (RETRO-340 LG-1): a FAST non-adapted quiz-turn response that lands before the old index', async () => {
    // A template answer 259 ms after the quiz turn's request — inside the loop's final 1200 ms sleep.
    const calls: Call[] = [
      coldStartCall(),
      { requestedAtMs: QUIZ_REQUEST_MS, respondedAtMs: QUIZ_REQUEST_MS + 259, body: FAST_TEMPLATE },
    ];

    // The legacy column: the response is before `startIndex` and not adapted, so neither exit can
    // fire. It burns the whole budget and names three causes, none of which happened.
    const legacyClock = virtualClock();
    const legacy = await legacyPositionalSettle(legacyClock, traffic(legacyClock, calls));
    expect(legacy.endedBy).toBe('budget');
    expect(legacy.waitedMs).toBe(30000);
    expect(legacy.cause).toMatch(/NO \/api\/adapt response from the quiz turn/);

    // The fix: the quiz turn's request is the first `/api/adapt` request at or after the completing
    // click, and the wait ends on ITS response — which was already there.
    const clock = virtualClock();
    const t = traffic(clock, calls);
    const settle = await settleFromLoopEnd(clock, t);
    expect(settle.endedBy).toBe('quiz-response');
    expect(settle.timedOut).toBe(false);
    expect(settle.quizRequest).toMatchObject({ seq: 2, requestedAt: QUIZ_REQUEST_MS });
    expect(settle.quizRequest?.msAfterCompletingClick).toBe(5);
    expect(settle.quizResponse).toMatchObject({
      requestSeq: 2,
      decidedIndex: 1,
      msAfterRequest: 259,
      arrivedBeforeSettleStarted: true,
      source: 'playbook',
      holdoutGroup: false,
    });
    expect(settle.waitedMs).toBe(settle.floorMs + settle.paintGraceMs);
    expect(settle.cause).not.toMatch(/NO \/api\/adapt response/);
    // …and AC(1) is still RED over it: the settle changed WHEN, never WHAT counts.
    expect(gradeNow(t.decided).ok).toBe(false);
    expect(gradeNow(t.decided).evidence.outcomes.template).toBe(1);
  });

  it('RED-FIRST (FOLLOW-1240 AC 4): the holdout run 6f1f169e, its real bodies — no budget, and the cause is holdout', async () => {
    const calls: Call[] = [
      coldStartCall(HOLDOUT_COLD_START),
      {
        requestedAtMs: QUIZ_REQUEST_MS,
        respondedAtMs: QUIZ_REQUEST_MS + HOLDOUT_LATENCY_MS.quizTurn,
        body: HOLDOUT_QUIZ_TURN,
      },
      // The CTA click, ~31 s after the quiz turn (ClickHouse ts 20:15:34.255 − 20:15:03.163).
      {
        requestedAtMs: QUIZ_REQUEST_MS + 31092,
        respondedAtMs: QUIZ_REQUEST_MS + 31092 + HOLDOUT_LATENCY_MS.cta,
        body: HOLDOUT_CTA,
      },
    ];

    // Today's output, reproduced: the full budget, then the misnamed cause.
    const legacyClock = virtualClock();
    const legacyTraffic = traffic(legacyClock, calls);
    const legacy = await legacyPositionalSettle(legacyClock, legacyTraffic);
    expect(legacy.endedBy).toBe('budget');
    expect(legacy.waitedMs).toBe(30000);
    expect(legacy.cause).toMatch(/NO \/api\/adapt response from the quiz turn/);
    expect(legacy.cause).toMatch(/outage/);
    expect(gradeNow(legacyTraffic.decided).ok).toBe(false);

    // The fix: it ends the moment it can see the quiz turn's own response is a holdout one — no
    // floor, no paint grace (there is nothing to paint), no budget.
    const clock = virtualClock();
    const t = traffic(clock, calls);
    const settle = await settleFromLoopEnd(clock, t);
    expect(settle.endedBy).toBe('quiz-response-holdout');
    expect(settle.timedOut).toBe(false);
    expect(settle.waitedMs).toBe(0);
    expect(settle.quizResponse).toMatchObject({
      requestSeq: 2,
      holdoutGroup: true,
      source: 'default',
      archetype: 'neutral',
      msAfterRequest: HOLDOUT_LATENCY_MS.quizTurn,
      arrivedBeforeSettleStarted: true,
    });
    expect(settle.cause).toMatch(/holdout/i);
    expect(settle.cause).toMatch(/UNMEASURED/);
    expect(settle.cause).not.toMatch(/outage|NO \/api\/adapt response/);

    // AC(1)'s predicate is untouched: over these bodies it is still not green. Whether that reads
    // FAIL or UNMEASURED is the tally's job (`run-grade.test.ts`), not the settle's.
    const verdict = gradeNow(t.decided);
    expect(verdict.ok).toBe(false);
    expect(verdict.evidence.outcomes.adapted).toBe(0);
    expect(verdict.evidence.sourcesObserved).toEqual({ default: 2 });
  });

  it('the CONVERSE: an unrelated response arriving during the floor no longer ends the wait', async () => {
    // A behavioural refresh requested BEFORE the completing click answers `default` 1 s into the
    // settle. #919's `new-response` took it for the quiz answer, ended at the floor, and graded
    // AC(1) RED while the quiz turn's `llm_tweaked` was still in flight — the 18:32Z false RED in a
    // new form. The quiz turn's response lands at +5278 ms.
    const calls: Call[] = [
      coldStartCall(),
      { requestedAtMs: CLICK_MS - 500, respondedAtMs: SETTLE_START_MS + 1000, body: COLD_START },
      {
        requestedAtMs: QUIZ_REQUEST_MS,
        respondedAtMs: SETTLE_START_MS + MEASURED_TURNAROUND_MS,
        body: LATE_ADAPTED,
      },
    ];

    const legacyClock = virtualClock();
    const legacyTraffic = traffic(legacyClock, calls);
    const legacy = await legacyPositionalSettle(legacyClock, legacyTraffic);
    expect(legacy.endedBy).toBe('new-response');
    expect(gradeNow(legacyTraffic.decided).ok).toBe(false); // the false RED

    const clock = virtualClock();
    const t = traffic(clock, calls);
    const settle = await settleFromLoopEnd(clock, t);
    expect(settle.endedBy).toBe('quiz-response');
    expect(settle.quizRequest?.seq).toBe(3);
    expect(settle.quizResponse?.requestSeq).toBe(3);
    expect(settle.waitedMs).toBe(5500 + settle.paintGraceMs);
    expect(gradeNow(t.decided).ok).toBe(true);
  });

  it('a later request (the CTA click) cannot stand in for the quiz turn: the FIRST request at or after the click is the one', async () => {
    // Two requests after the click. The quiz-completion callback calls `refreshDirectives()`
    // synchronously, so the quiz turn's request is the first; a second call that answers first
    // must not end the wait.
    const calls: Call[] = [
      coldStartCall(),
      {
        requestedAtMs: QUIZ_REQUEST_MS,
        respondedAtMs: SETTLE_START_MS + 8000,
        body: LATE_ADAPTED,
      },
      { requestedAtMs: CLICK_MS + 900, respondedAtMs: CLICK_MS + 1100, body: FAST_TEMPLATE },
    ];
    const clock = virtualClock();
    const t = traffic(clock, calls);
    const settle = await settleFromLoopEnd(clock, t);
    expect(settle.endedBy).toBe('quiz-response');
    expect(settle.quizRequest?.seq).toBe(2);
    expect(settle.quizResponse?.requestSeq).toBe(2);
    expect(settle.waitedMs).toBe(8000 + settle.paintGraceMs);
    expect(settle.responsesAfterCompletingClick).toBe(2);
  });

  it('REWRITTEN (was "a NON-adapted response already in the population does NOT end the wait early"): only the pre-click one is ignored', async () => {
    // #919's version put a `default` before `startIndex` and expected the wait to stay open, on the
    // premise that a pre-index `default` is never the quiz turn's answer. The settle had no input
    // that could tell. It has one now — the request each response answers — and the premise holds
    // exactly for a response to a request issued BEFORE the completing click: that one stays
    // ignored, and the wait ends on the quiz turn's own answer at +20 s.
    const clock = virtualClock();
    const t = traffic(clock, [
      coldStartCall(),
      {
        requestedAtMs: QUIZ_REQUEST_MS,
        respondedAtMs: SETTLE_START_MS + 20000,
        body: LATE_ADAPTED,
      },
    ]);
    const settle = await settleFromLoopEnd(clock, t);
    expect(settle.endedBy).toBe('quiz-response');
    expect(settle.quizResponse?.requestSeq).toBe(2);
    expect(settle.waitedMs).toBe(20000 + settle.paintGraceMs);
    expect(gradeNow(t.decided).ok).toBe(true);
    // The flipped half of the old premise — a NON-adapted QUIZ-TURN response already present DOES
    // end the wait — is the LG-1 red-first case above.
  });

  it('an adapted quiz-turn response that landed during the loop ends the wait at the floor', async () => {
    // Was #919's `adapted-response` exit. That exit is gone: it accepted an adapted body from ANY
    // request, which is the positional defect's other face. The fast healthy run now ends on the
    // quiz turn's own response, at the same moment.
    const clock = virtualClock();
    const t = traffic(clock, [
      coldStartCall(),
      { requestedAtMs: QUIZ_REQUEST_MS, respondedAtMs: QUIZ_REQUEST_MS + 900, body: LATE_ADAPTED },
    ]);
    const settle = await settleFromLoopEnd(clock, t);
    expect(settle.endedBy).toBe('quiz-response');
    expect(settle.quizResponse?.arrivedBeforeSettleStarted).toBe(true);
    expect(settle.waitedMs).toBe(settle.floorMs + settle.paintGraceMs);
    expect(gradeNow(t.decided).ok).toBe(true);
  });

  it('an adapted response to a PRE-click request does not end the wait for the quiz turn', async () => {
    const clock = virtualClock();
    const t = traffic(clock, [
      coldStartCall(LATE_ADAPTED),
      { requestedAtMs: QUIZ_REQUEST_MS, respondedAtMs: SETTLE_START_MS + 7000, body: LATE_ADAPTED },
    ]);
    const settle = await settleFromLoopEnd(clock, t);
    expect(settle.endedBy).toBe('quiz-response');
    expect(settle.waitedMs).toBe(7000 + settle.paintGraceMs);
  });
});

describe('FOLLOW-1240 — every other way the wait can end, each with its own cause', () => {
  it('a quiz that never completed has no quiz turn to wait for: `no-quiz-turn`, at the floor', async () => {
    const clock = virtualClock();
    const t = traffic(clock, [coldStartCall()]);
    const settle = await settleFromLoopEnd(clock, t, { quizCompletedAt: null });
    expect(settle.endedBy).toBe('no-quiz-turn');
    expect(settle.timedOut).toBe(false);
    expect(settle.quizRequest).toBeNull();
    expect(settle.waitedMs).toBe(settle.floorMs);
    expect(settle.cause).toMatch(/did not complete/);
    expect(gradeNow(t.decided).ok).toBe(false);
  });

  it('a failed quiz-turn request ends the wait at the floor with `quiz-request-failed`', async () => {
    const clock = virtualClock();
    const t = traffic(clock, [
      coldStartCall(),
      { requestedAtMs: QUIZ_REQUEST_MS, failedAtMs: QUIZ_REQUEST_MS + 40 },
    ]);
    const settle = await settleFromLoopEnd(clock, t);
    expect(settle.endedBy).toBe('quiz-request-failed');
    expect(settle.quizRequest?.failure).toBe('net::ERR_CONNECTION_RESET');
    expect(settle.waitedMs).toBe(settle.floorMs);
    expect(settle.cause).toMatch(/ERR_CONNECTION_RESET/);
    expect(gradeNow(t.decided).ok).toBe(false);
  });

  it('BUDGET, nothing after the click: the only case that may say "NO /api/adapt response"', async () => {
    const clock = virtualClock();
    const t = traffic(clock, [coldStartCall(), { requestedAtMs: QUIZ_REQUEST_MS }]);
    const settle = await settleFromLoopEnd(clock, t);
    expect(settle.endedBy).toBe('budget');
    expect(settle.timedOut).toBe(true);
    expect(settle.waitedMs).toBe(settle.budgetMs); // it terminated; it did not hang
    expect(settle.responsesAfterCompletingClick).toBe(0);
    expect(settle.quizRequest?.seq).toBe(2);
    expect(settle.quizResponse).toBeNull();
    expect(settle.cause).toMatch(/BUDGET EXPIRED/);
    expect(settle.cause).toMatch(
      /NO \/api\/adapt response arrived at or after the completing click/,
    );
    expect(gradeNow(t.decided).ok).toBe(false);
  });

  it('BUDGET with another response after the click: the cause does NOT claim no response arrived', async () => {
    const clock = virtualClock();
    const t = traffic(clock, [
      coldStartCall(),
      { requestedAtMs: QUIZ_REQUEST_MS },
      { requestedAtMs: CLICK_MS + 3000, respondedAtMs: CLICK_MS + 3300, body: FAST_TEMPLATE },
    ]);
    const settle = await settleFromLoopEnd(clock, t);
    expect(settle.endedBy).toBe('budget');
    expect(settle.responsesAfterCompletingClick).toBe(1);
    expect(settle.cause).not.toMatch(/NO \/api\/adapt response/);
    expect(settle.cause).toMatch(/request #2/);
    expect(settle.cause).toMatch(/1 other/);
  });

  it('BUDGET with NO request after the click: names the missing REQUEST, not a missing response', async () => {
    const clock = virtualClock();
    // The cold start is slow enough to answer after the click: a response arrived after the click,
    // but no request was ever issued at or after it.
    const t = traffic(clock, [
      { requestedAtMs: CLICK_MS - 100, respondedAtMs: CLICK_MS + 300, body: COLD_START },
    ]);
    const settle = await settleFromLoopEnd(clock, t);
    expect(settle.endedBy).toBe('budget');
    expect(settle.quizRequest).toBeNull();
    expect(settle.responsesAfterCompletingClick).toBe(1);
    expect(settle.cause).toMatch(/NO \/api\/adapt REQUEST/);
    expect(settle.cause).not.toMatch(/NO \/api\/adapt response/);
  });

  const NEGATIVE_CONTROLS: readonly [name: string, body: unknown, outcome: string][] = [
    ['gateway outage (cta survives the withhold)', LATE_OUTAGE, 'outage'],
    ['fact check refused (cta survives the withhold)', LATE_REFUSED, 'refused'],
    ['template answer', FAST_TEMPLATE, 'template'],
  ];
  for (const [name, body, outcome] of NEGATIVE_CONTROLS) {
    it(`a late ${name} ends the wait on the quiz response and is STILL RED`, async () => {
      const clock = virtualClock();
      const t = traffic(clock, [
        coldStartCall(),
        { requestedAtMs: QUIZ_REQUEST_MS, respondedAtMs: SETTLE_START_MS + 12000, body },
      ]);
      const settle = await settleFromLoopEnd(clock, t);
      const verdict = gradeNow(t.decided);

      // The wait DID observe it — the window is not the reason for the red.
      expect(settle.endedBy).toBe('quiz-response');
      expect(settle.quizResponse?.requestSeq).toBe(2);
      expect(settle.adaptedResponseCount).toBe(0);
      expect(verdict.evidence.evaluatedResponseCount).toBe(2);
      expect(verdict.evidence.outcomes[outcome]).toBe(1);
      expect(verdict.ok).toBe(false);
    });
  }

  it('an adapted response is never invented: the settle counts exactly what evaluateAc1 counts', async () => {
    // Parity over the duplicated "is this response adapted?" computation. `settleForAdaptResponse()`
    // reports it; `evaluateAc1()` grades on it. They call the SAME `isAdaptedResponse()` in the
    // harness, and this asserts they cannot drift: exact equality, no tolerance.
    const populations: readonly (readonly unknown[])[] = [
      [COLD_START],
      [COLD_START, LATE_ADAPTED],
      [COLD_START, LATE_OUTAGE],
      [COLD_START, LATE_REFUSED],
      [COLD_START, FAST_TEMPLATE],
      [HOLDOUT_COLD_START, HOLDOUT_QUIZ_TURN],
      [COLD_START, { ...LATE_ADAPTED, confidence: 0.6 }],
      [COLD_START, { ...LATE_ADAPTED, archetype: 'neutral' }],
      [LATE_ADAPTED, LATE_ADAPTED],
    ];
    for (const population of populations) {
      const clock = virtualClock();
      const t = traffic(
        clock,
        population.map((body, i) => ({ requestedAtMs: i * 10, respondedAtMs: i * 10 + 1, body })),
      );
      const settle = await settleFromLoopEnd(clock, t, { quizCompletedAt: null });
      expect(settle.adaptedResponseCount).toBe(gradeNow(t.decided).evidence.outcomes.adapted);
    }
  });

  it('the wait never ends before the SDK batch-flush floor the 3 s sleep was sized for', async () => {
    const clock = virtualClock();
    const t = traffic(clock, [
      coldStartCall(),
      { requestedAtMs: QUIZ_REQUEST_MS, respondedAtMs: SETTLE_START_MS, body: LATE_ADAPTED },
    ]);
    const settle = await settleFromLoopEnd(clock, t);
    expect(settle.endedBy).toBe('quiz-response');
    expect(settle.floorMs).toBe(3000);
    expect(settle.waitedMs).toBe(settle.floorMs + settle.paintGraceMs);
  });

  it('the budget is 30 s, ~5.7x the measured 5.278 s post-quiz turnaround', async () => {
    const clock = virtualClock();
    const t = traffic(clock, [coldStartCall(), { requestedAtMs: QUIZ_REQUEST_MS }]);
    const settle = await settleFromLoopEnd(clock, t);
    // Pinned so that widening it is a deliberate edit with this measurement in view (README §3.6).
    expect(settle.budgetMs).toBe(30000);
    expect(settle.budgetMs / MEASURED_TURNAROUND_MS).toBeGreaterThan(5);
  });
});

describe('FOLLOW-1238 (preflight half) — a bound-but-silent ingest origin is refused up front', () => {
  // The 2026-09-20 state: `wrangler dev`'s esbuild bundle failed (11 unresolved imports, no
  // `apps/ingest/node_modules` in the worktree) and the process STILL bound :8787 and accepted
  // connections while answering nothing. Zero `events` rows for both sessions of that run; AC(5)
  // and AC(7) red ten minutes later with no mention of ingest.
  const CASES: readonly [name: string, probe: Parameters<EvaluateIngestProbe>[0], cls: string][] = [
    [
      'nothing listening',
      { status: null, bodyText: null, networkError: 'TypeError: fetch failed' },
      'unreachable',
    ],
    [
      'bound, accepts the connection, answers nothing',
      {
        status: null,
        bodyText: null,
        networkError: 'TimeoutError: The operation was aborted due to timeout',
      },
      'bound_but_silent',
    ],
    [
      'answering, but not 200',
      { status: 500, bodyText: 'boom', networkError: null },
      'health_non_ok',
    ],
  ];
  for (const [name, probe, cls] of CASES) {
    it(`refuses to start: ${name}`, () => {
      const verdict = evaluateIngestProbe(probe);
      expect(verdict.ok).toBe(false);
      expect(verdict.failureClass).toBe(cls);
    });
  }

  it('accepts a real 200', () => {
    const verdict = evaluateIngestProbe({
      status: 200,
      bodyText: '{"status":"ok","service":"estalara-ingest"}',
      networkError: null,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.failureClass).toBeNull();
  });
});
