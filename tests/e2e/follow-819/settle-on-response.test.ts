// @vitest-environment node
// (the package default is jsdom, whose global `URL` `createRequire()` rejects at the harness's
// top-level Playwright resolution — same reason ac1-verdict.test.ts and grounding-source.test.ts
// pin this)

/**
 * FOLLOW-1239 — the FOLLOW-819 harness's post-quiz observation window must close on the RESPONSE,
 * not on a stopwatch, and a window that closes early must never be able to read as "the product did
 * not adapt".
 *
 * WHAT THIS CLOSES, measured 2026-09-20 at `62ac28f0` (README §5.11 run 2). The harness did
 * `await sleep(3000); await Promise.all(pending)` after the quiz loop and then snapshotted
 * `decided[]` for AC(1)/AC(2). The post-quiz turnaround on that run was **5.278 s** (quiz
 * `step=completed` 18:33:19.527 → `/api/adapt` `generated_at` 18:33:24.805), so the `llm_tweaked`
 * response with three text directives was pushed into `decided[]` 1.05 s AFTER `evaluateAc1()` had
 * read the array. The artefact therefore holds, in one file, `decided[1].body.source:
 * 'llm_tweaked'` AND `AC(1).evidence.evaluatedResponseCount: 1, sourcesObserved: {default: 1}`.
 * AC(1) is FOLLOW-820 condition 1 clause 1; the same commit class had read PASS three hours earlier.
 *
 * THE TWO BODIES BELOW ARE THE BYTES OF THAT RUN, not shapes typed from the ticket prose: copied out
 * of its `last-run.json` `decided[0]` and `decided[1]` (ids and `generated_at` kept, so the fixture
 * is traceable to the run). Nothing here is adjusted to make a verdict come out a particular way.
 *
 * RED-FIRST, and the column that proves it: `legacyFixedSleepSettle()` IS the pre-fix wait — a
 * literal `sleep(3000)` then `Promise.all(pending)` then snapshot. Every row below is driven through
 * BOTH it and the real `settleForAdaptResponse()`, and the first table asserts that the legacy
 * column reproduces the false RED while the fix reads GREEN over the same traffic. The legacy
 * function lives in this file and nowhere else: it is the bug, kept executable.
 *
 * WHAT THIS FILE MUST NEVER BECOME. A longer wait is allowed to change WHEN the population is read
 * and must never change WHAT counts as adaptation. So the outage, refusal, template and absent-
 * response rows are here as the negative controls: they arrive (or fail to arrive) inside the new,
 * wider window and AC(1) still reads RED, with `postQuizSettle.cause` naming which. `evaluateAc1()`
 * is imported, never re-implemented — the predicate stays `source ∈ {llm_tweaked, llm_full}`,
 * non-neutral, confidence > gate, ≥1 non-`reorder` directive (FOLLOW-1186).
 *
 * TIME IS VIRTUAL. `virtualClock()` injects `now`/`sleepFn`, so a 30 s budget costs microseconds and
 * no row can flake on a loaded box. No wall clock, no `Math.random()`, no ordering by chance.
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
interface DecidedEntry {
  url: string;
  status: number;
  body?: unknown;
}
interface SettleResult {
  endedBy: 'new-response' | 'adapted-response' | 'budget';
  timedOut: boolean;
  waitedMs: number;
  newResponseCount: number;
  adaptedResponseCount: number;
  budgetMs: number;
  floorMs: number;
  paintGraceMs: number;
  cause: string;
}
type SettleForAdaptResponse = (args: {
  decided: DecidedEntry[];
  pending: Promise<unknown>[];
  startIndex: number;
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

/** The post-quiz turnaround measured on 2026-09-20: 18:33:19.527 → 18:33:24.805. */
const MEASURED_TURNAROUND_MS = 5278;

/**
 * A deterministic clock. `sleep()` fires every arrival scheduled at or before the new time, in
 * schedule order, then advances. Nothing is timing-dependent, so no row here can flake.
 */
function virtualClock() {
  let t = 0;
  const scheduled: { at: number; fire: () => void; done: boolean }[] = [];
  return {
    // Arrow properties, not shorthand methods: every one of these is handed to the harness as a
    // bare reference, and a `this`-bound method would be an unbound-method hazard there.
    now: () => t,
    at: (ms: number, fire: () => void) => {
      scheduled.push({ at: ms, fire, done: false });
      scheduled.sort((a, b) => a.at - b.at);
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

/**
 * The traffic model. A `/api/adapt` response appears in BOTH `decided[]` and `pending[]` only when
 * its body has been read — which is why the 18:32Z run's `await Promise.all(pending)` returned
 * immediately: the second response's `response` event had not fired yet, so there was no promise to
 * await. Pre-existing bodies are the ones already read when the post-quiz wait begins.
 */
function traffic(
  clock: ReturnType<typeof virtualClock>,
  present: readonly unknown[],
  arrivals: readonly { atMs: number; body: unknown }[],
) {
  const decided: DecidedEntry[] = present.map((body) => ({
    url: 'http://localhost:3000/api/adapt',
    status: 200,
    body,
  }));
  const pending: Promise<unknown>[] = present.map(() => Promise.resolve());
  for (const a of arrivals) {
    clock.at(a.atMs, () => {
      decided.push({ url: 'http://localhost:3000/api/adapt', status: 200, body: a.body });
      pending.push(Promise.resolve());
    });
  }
  return { decided, pending };
}

/**
 * THE BUG, kept executable: the pre-FOLLOW-1239 post-quiz wait, byte for byte in behaviour —
 * `await sleep(3000); await Promise.all(pending);` and then the caller snapshots `decided[]`.
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

describe('FOLLOW-1239 — the 2026-09-20 false RED, reproduced and fixed', () => {
  it('legacy fixed 3 s sleep: AC(1) RED over 1 body while the artefact ends up holding 2', async () => {
    const clock = virtualClock();
    const { decided, pending } = traffic(
      clock,
      [COLD_START],
      [{ atMs: MEASURED_TURNAROUND_MS, body: LATE_ADAPTED }],
    );

    await legacyFixedSleepSettle(clock, pending);
    const verdict = gradeNow(decided);
    const gradedResponseCount = decided.length;

    // The verdict, exactly as `62ac28f0`'s artefact recorded it.
    expect(verdict.ok).toBe(false);
    expect(verdict.evidence.evaluatedResponseCount).toBe(1);
    expect(verdict.evidence.sourcesObserved).toEqual({ default: 1 });
    expect(verdict.evidence.outcomes.adapted).toBe(0);

    // …and then the response lands — 2.278 s after this window closed, and (as the run recorded it)
    // 1.05 s after the harness had gone on to snapshot the DOM — into the array the file serialises.
    await clock.sleep(MEASURED_TURNAROUND_MS - 3000);
    expect(decided).toHaveLength(2);
    expect((decided[1].body as { source: string }).source).toBe('llm_tweaked');
    // The number FOLLOW-1239 asks the artefact to carry. Non-zero IS the false RED.
    expect(decided.length - gradedResponseCount).toBe(1);
  });

  it('settleForAdaptResponse: the same traffic ends the wait on the response and AC(1) is GREEN', async () => {
    const clock = virtualClock();
    const { decided, pending } = traffic(
      clock,
      [COLD_START],
      [{ atMs: MEASURED_TURNAROUND_MS, body: LATE_ADAPTED }],
    );

    const settle = await settleForAdaptResponse({
      decided,
      pending,
      startIndex: decided.length,
      serverGate: GATE,
      now: clock.now,
      sleepFn: clock.sleep,
    });
    const verdict = gradeNow(decided);
    const gradedResponseCount = decided.length;

    expect(settle.endedBy).toBe('new-response');
    expect(settle.timedOut).toBe(false);
    expect(settle.newResponseCount).toBe(1);
    // It waited for the response and not a millisecond of the budget beyond it: the first poll
    // boundary at or after 5278 ms (250 ms poll) plus the paint grace.
    expect(settle.waitedMs).toBe(5500 + settle.paintGraceMs);
    expect(settle.waitedMs).toBeLessThan(settle.budgetMs);

    expect(verdict.ok).toBe(true);
    expect(verdict.evidence.evaluatedResponseCount).toBe(2);
    expect(verdict.evidence.outcomes.adapted).toBe(1);
    expect(verdict.evidence.sourcesObserved).toEqual({ default: 1, llm_tweaked: 1 });

    // Nothing arrives after the verdict any more — the artefact and its own AC(1) agree.
    await clock.sleep(10000);
    expect(decided.length - gradedResponseCount).toBe(0);
  });
});

describe('FOLLOW-1239 — the wider window must not turn a substrate failure green', () => {
  it('a response that never arrives times out, stays RED, and the cause is named', async () => {
    const clock = virtualClock();
    const { decided, pending } = traffic(clock, [COLD_START], []);

    const settle = await settleForAdaptResponse({
      decided,
      pending,
      startIndex: decided.length,
      serverGate: GATE,
      now: clock.now,
      sleepFn: clock.sleep,
    });
    const verdict = gradeNow(decided);

    expect(settle.endedBy).toBe('budget');
    expect(settle.timedOut).toBe(true);
    expect(settle.newResponseCount).toBe(0);
    expect(settle.adaptedResponseCount).toBe(0);
    expect(settle.waitedMs).toBe(settle.budgetMs); // it terminated; it did not hang
    // The named cause, and the distinction the old evidence could not draw: absent, not refused.
    expect(settle.cause).toMatch(/BUDGET EXPIRED/);
    expect(settle.cause).toMatch(/NO \/api\/adapt response from the quiz turn/);

    expect(verdict.ok).toBe(false);
    expect(verdict.evidence.outcomes.adapted).toBe(0);
    expect(verdict.evidence.sourcesObserved).toEqual({ default: 1 });
  });

  const NEGATIVE_CONTROLS: readonly [name: string, body: unknown, outcome: string][] = [
    ['gateway outage (cta survives the withhold)', LATE_OUTAGE, 'outage'],
    ['fact check refused (cta survives the withhold)', LATE_REFUSED, 'refused'],
  ];
  for (const [name, body, outcome] of NEGATIVE_CONTROLS) {
    it(`a late ${name} ends the wait and is STILL RED`, async () => {
      const clock = virtualClock();
      const { decided, pending } = traffic(clock, [COLD_START], [{ atMs: 12000, body }]);

      const settle = await settleForAdaptResponse({
        decided,
        pending,
        startIndex: decided.length,
        serverGate: GATE,
        now: clock.now,
        sleepFn: clock.sleep,
      });
      const verdict = gradeNow(decided);

      // The wait DID observe it — the window is not the reason for the red.
      expect(settle.endedBy).toBe('new-response');
      expect(settle.newResponseCount).toBe(1);
      expect(settle.adaptedResponseCount).toBe(0);
      expect(verdict.evidence.evaluatedResponseCount).toBe(2);
      expect(verdict.evidence.outcomes[outcome]).toBe(1);
      expect(verdict.ok).toBe(false);
    });
  }

  it('an adapted response is never invented: the settle counts exactly what evaluateAc1 counts', async () => {
    // Parity over the duplicated "is this response adapted?" computation. `settleForAdaptResponse()`
    // asks it to decide whether to stop waiting; `evaluateAc1()` asks it for the verdict. They call
    // the SAME `isAdaptedResponse()` in the harness, and this asserts they cannot drift: exact
    // equality, no tolerance, over every population this file builds.
    const populations: readonly (readonly unknown[])[] = [
      [COLD_START],
      [COLD_START, LATE_ADAPTED],
      [COLD_START, LATE_OUTAGE],
      [COLD_START, LATE_REFUSED],
      [COLD_START, { ...LATE_ADAPTED, confidence: 0.6 }],
      [COLD_START, { ...LATE_ADAPTED, archetype: 'neutral' }],
      [LATE_ADAPTED, LATE_ADAPTED],
    ];
    for (const population of populations) {
      const clock = virtualClock();
      const { decided, pending } = traffic(clock, population, []);
      const settle = await settleForAdaptResponse({
        decided,
        pending,
        startIndex: decided.length,
        serverGate: GATE,
        now: clock.now,
        sleepFn: clock.sleep,
      });
      expect(settle.adaptedResponseCount).toBe(gradeNow(decided).evidence.outcomes.adapted);
    }
  });
});

describe('FOLLOW-1239 — the two early exits, and the floor under both', () => {
  it('an adapted response already in the population ends the wait without burning the budget', async () => {
    // The fast substrate: the quiz turn's response landed during the quiz loop itself, so there is
    // no NEW response to wait for. Ending here is what keeps a healthy run from paying 30 s.
    const clock = virtualClock();
    const { decided, pending } = traffic(clock, [COLD_START, LATE_ADAPTED], []);

    const settle = await settleForAdaptResponse({
      decided,
      pending,
      startIndex: decided.length,
      serverGate: GATE,
      now: clock.now,
      sleepFn: clock.sleep,
    });

    expect(settle.endedBy).toBe('adapted-response');
    expect(settle.newResponseCount).toBe(0);
    expect(settle.waitedMs).toBe(settle.floorMs + settle.paintGraceMs);
    expect(gradeNow(decided).ok).toBe(true);
  });

  it('a NON-adapted response already in the population does NOT end the wait early', async () => {
    // The guardrail on the exit above: only an ADAPTED response may short-circuit. A cold-start
    // `default` sitting in the population must leave the wait open for the quiz turn's answer.
    const clock = virtualClock();
    const { decided, pending } = traffic(
      clock,
      [COLD_START],
      [{ atMs: 20000, body: LATE_ADAPTED }],
    );

    const settle = await settleForAdaptResponse({
      decided,
      pending,
      startIndex: decided.length,
      serverGate: GATE,
      now: clock.now,
      sleepFn: clock.sleep,
    });

    expect(settle.endedBy).toBe('new-response');
    expect(settle.waitedMs).toBe(20000 + settle.paintGraceMs);
    expect(gradeNow(decided).ok).toBe(true);
  });

  it('the wait never ends before the SDK batch-flush floor the 3 s sleep was sized for', async () => {
    const clock = virtualClock();
    const { decided, pending } = traffic(clock, [COLD_START], [{ atMs: 0, body: LATE_ADAPTED }]);
    // The arrival is scheduled at t=0, i.e. already there on the first poll.
    await clock.sleep(0);

    const settle = await settleForAdaptResponse({
      decided,
      pending,
      startIndex: 1,
      serverGate: GATE,
      now: clock.now,
      sleepFn: clock.sleep,
    });

    expect(settle.endedBy).toBe('new-response');
    expect(settle.floorMs).toBe(3000);
    expect(settle.waitedMs).toBe(settle.floorMs + settle.paintGraceMs);
  });

  it('the budget is 30 s, ~5.7x the measured 5.278 s post-quiz turnaround', async () => {
    const clock = virtualClock();
    const { decided, pending } = traffic(clock, [COLD_START], []);
    const settle = await settleForAdaptResponse({
      decided,
      pending,
      startIndex: 1,
      serverGate: GATE,
      now: clock.now,
      sleepFn: clock.sleep,
    });
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
