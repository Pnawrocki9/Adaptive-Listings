// @vitest-environment node
// (the package default is jsdom, whose global `URL` `createRequire()` rejects at the harness's
// top-level Playwright resolution — same reason settle-on-response.test.ts pins this)

/**
 * FOLLOW-1252 — AC(5)'s this-run conversion read must wait as long as the SDK's own retry schedule
 * can take to deliver a `cta.clicked`, and no longer; and a conversion that never lands must stay
 * RED with a cause that says WHERE it was lost.
 *
 * WHAT HAPPENED (README §5.16, 6 runs at `d7e8ad26`, G G R G G R). In both reds the ingest workerd
 * answered the `cta.clicked` batch's first send with 503 (the browser sees a CORS-less
 * `net::ERR_FAILED`). The SDK held the batch and re-sent it on its next flush with the same
 * `Idempotency-Key` (FOLLOW-1242), and the row reached ClickHouse 7.9 s (run 3) and 8.15 s (run 6)
 * after the click. The harness read ONCE, `BATCH_INTERVAL_MS + 2000` = 7000 ms after the click, and
 * graded `thisRunConversions=0`. `legacyFixedSleepRead()` below is that read, kept executable.
 *
 * THE BUDGET IS READ FROM THE SDK, never typed here. `readAc5PollBudget()` parses
 * `BATCH_INTERVAL_MS` (packages/sdk/src/index.ts) and `MAX_FLUSHES` plus the power-of-two re-send
 * predicate (packages/sdk/src/core/events.ts) out of the real source files. The "mutate a constant"
 * rows feed `deriveAc5PollBudget()` the SAME real source text with one constant edited, so a change
 * to the SDK's schedule moves the budget and these rows notice.
 *
 * THE INGEST RECORDS ARE RUN 6's SHAPE: two POSTs carrying the same `cta.clicked` (same first
 * `event_id`, same key), the first failed at the network layer, the second answered 200. The event
 * id keeps run 6's real 8-hex prefix (`cdad2783`); the rest is zero-filled. Keys are synthetic.
 *
 * TIME IS VIRTUAL: `now`/`sleepFn` are injected, so an 85 s budget costs microseconds.
 *
 * Collected by `tests/e2e/vitest.config.ts` (`**\/*.test.ts`); run by `pnpm e2e:smoke`, which
 * `.github/workflows/e2e-smoke.yml` executes nightly. It needs no substrate and takes no flag.
 *
 * @module tests/e2e/follow-819/ac5-conversion-poll.test
 */

import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

interface Ac5PollBudget {
  batchIntervalMs: number;
  maxFlushes: number;
  sendFlushes: number[];
  lastSendAfterClickMs: number;
  slackMs: number;
  budgetMs: number;
  source: string[];
}
interface IngestPost {
  seq: number;
  requestedAt: number;
  key: string | null;
  firstEventId: string | null;
  types: string[];
  sessionIds: string[];
  status: number | null;
  failure: string | null;
}
interface EmittedEntry {
  url: string;
  body: { events?: { event_id: string; session_id: string; type: string }[] } | null;
}
interface Ac5Poll {
  landed: boolean;
  attempts: number;
  waitedMs: number;
  budgetMs: number;
  landedAtMs: number | null;
  conversions: number;
  unreadableReads: number;
}
interface CtaIngest {
  ctaPosts: {
    seq: number;
    key: string | null;
    firstEventId: string | null;
    status: number | null;
    failure: string | null;
  }[];
  ctaBatchAccepted: boolean;
  ingestPosts: number;
  ingest5xx: number;
  ingestFailedAtNetwork: number;
  resent: boolean;
  resentFirstEventIds: string[];
}
interface Ac5Loss {
  lossKind: 'cta_not_sent' | 'no_ingest_2xx_for_cta_batch' | 'ingest_accepted_row_never_landed';
  cause: string;
}
interface ThisRun {
  determinable: boolean;
  reason: string | null;
  treatmentArmDecisions: number;
  conversions: number;
}

let deriveAc5PollBudget: (args: {
  indexSrc: string;
  eventsSrc: string;
  slackMs?: number;
}) => Ac5PollBudget;
let readAc5PollBudget: () => Promise<Ac5PollBudget>;
let pollThisRunConversion: (args: {
  countConversions: () => Promise<number | null>;
  budgetMs: number;
  clickAt: number;
  pollMs?: number;
  now?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
}) => Promise<Ac5Poll>;
let summarizeCtaIngest: (args: {
  ingestPosts: IngestPost[];
  emitted: EmittedEntry[];
  ingestOrigin: string;
  sessionId: string;
}) => CtaIngest;
let classifyConversionLoss: (args: { ctaIngest: CtaIngest; budgetMs: number }) => Ac5Loss;
let evaluateThisRunConversion: (
  thisRun: ThisRun,
  loss: Ac5Loss | null,
) => { converted: boolean; unmet: string[] };

beforeAll(async () => {
  // The harness runs main() at import unless told not to — see the guard at its foot.
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const mod = (await import('./differentiator-e2e.mjs')) as Record<string, unknown>;
  deriveAc5PollBudget = mod.deriveAc5PollBudget as typeof deriveAc5PollBudget;
  readAc5PollBudget = mod.readAc5PollBudget as typeof readAc5PollBudget;
  pollThisRunConversion = mod.pollThisRunConversion as typeof pollThisRunConversion;
  summarizeCtaIngest = mod.summarizeCtaIngest as typeof summarizeCtaIngest;
  classifyConversionLoss = mod.classifyConversionLoss as typeof classifyConversionLoss;
  evaluateThisRunConversion = mod.evaluateThisRunConversion as typeof evaluateThisRunConversion;
});

const SDK_INDEX = new URL('../../../packages/sdk/src/index.ts', import.meta.url);
const SDK_EVENTS = new URL('../../../packages/sdk/src/core/events.ts', import.meta.url);
const HARNESS = new URL('./differentiator-e2e.mjs', import.meta.url);

const INGEST = 'http://localhost:8787';
const SID = 'c3bb1bfa-38b5-493f-8794-d5f6e0356f76'; // run 6's session
const CTA_EVENT = 'cdad2783-0000-4000-8000-000000000000';
const PRIOR_EVENT = '0ebada8b-0000-4000-8000-000000000000';
/** Run 6: the row reached ClickHouse 8.15 s after the click. */
const RUN6_LANDS_MS = 8150;

function virtualClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number): Promise<void> => {
      t += ms;
      return Promise.resolve();
    },
  };
}

/** A ClickHouse `count()` that returns 0 until the row lands at `landsAtMs`, and 1 after. */
function rowLandingAt(clock: { now: () => number }, landsAtMs: number | null) {
  return () => Promise.resolve(landsAtMs !== null && clock.now() >= landsAtMs ? 1 : 0);
}

/**
 * THE DEFECT, KEPT EXECUTABLE: the pre-FOLLOW-1252 read in main() — sleep a full batch interval
 * plus 2000 ms after the click, then count once.
 */
async function legacyFixedSleepRead(
  clock: ReturnType<typeof virtualClock>,
  count: () => Promise<number>,
  batchIntervalMs: number,
) {
  await clock.sleep(batchIntervalMs + 2000);
  return count();
}

function ctaBatch(seq: number, requestedAt: number, status: number | null, failure: string | null) {
  return {
    post: {
      seq,
      requestedAt,
      key: 'idem-key-cta-batch',
      firstEventId: CTA_EVENT,
      types: ['cta.clicked', 'session.quality.snapshot', 'intent.snapshot'],
      sessionIds: [SID],
      status,
      failure,
    } satisfies IngestPost,
    emitted: {
      url: `${INGEST}/v1/events`,
      body: {
        events: [
          { event_id: CTA_EVENT, session_id: SID, type: 'cta.clicked' },
          { event_id: 'd40cf266-0000-4000-8000-000000000000', session_id: SID, type: 'x' },
        ],
      },
    } satisfies EmittedEntry,
  };
}
const priorBatch = {
  post: {
    seq: 1,
    requestedAt: -9000,
    key: 'idem-key-prior-batch',
    firstEventId: PRIOR_EVENT,
    types: ['scroll.depth'],
    sessionIds: [SID],
    status: 200,
    failure: null,
  } satisfies IngestPost,
  emitted: {
    url: `${INGEST}/v1/events`,
    body: { events: [{ event_id: PRIOR_EVENT, session_id: SID, type: 'scroll.depth' }] },
  } satisfies EmittedEntry,
};
/** An `/api/adapt` POST lands in `emitted[]` too; it must never be mistaken for an ingest batch. */
const adaptPost: EmittedEntry = { url: 'http://localhost:3000/api/adapt', body: null };

/** Run 6: refused at the network layer (the CORS-less 503), then re-sent and accepted. */
function run6Records() {
  const first = ctaBatch(2, 3100, null, 'net::ERR_FAILED');
  const resend = ctaBatch(3, 8100, 200, null);
  return {
    ingestPosts: [priorBatch.post, first.post, resend.post],
    emitted: [priorBatch.emitted, adaptPost, first.emitted, resend.emitted],
  };
}

describe('FOLLOW-1252: the poll budget is the SDK retry schedule, read from its source', () => {
  it('reads the real SDK source and covers every timed send, including the 2nd-flush re-send', async () => {
    const b = await readAc5PollBudget();
    // Every number below comes from the SDK source through the reader, none is typed here.
    expect(b.sendFlushes[0]).toBe(1);
    expect(b.sendFlushes).toContain(2);
    expect(b.sendFlushes.every((n) => (n & (n - 1)) === 0)).toBe(true);
    expect(b.lastSendAfterClickMs).toBe(
      b.sendFlushes[b.sendFlushes.length - 1] * b.batchIntervalMs,
    );
    expect(b.budgetMs).toBe(b.lastSendAfterClickMs + b.slackMs);
    expect(b.budgetMs).toBeGreaterThanOrEqual(2 * b.batchIntervalMs + b.slackMs);
    expect(b.budgetMs).toBeGreaterThan(RUN6_LANDS_MS);
    expect(b.source).toEqual([
      'packages/sdk/src/index.ts BATCH_INTERVAL_MS',
      'packages/sdk/src/core/events.ts MAX_FLUSHES',
    ]);
  });

  it('moves when the SDK constants move', async () => {
    const indexSrc = await readFile(SDK_INDEX, 'utf8');
    const eventsSrc = await readFile(SDK_EVENTS, 'utf8');
    const real = deriveAc5PollBudget({ indexSrc, eventsSrc });

    const fewerFlushes = deriveAc5PollBudget({
      indexSrc,
      eventsSrc: eventsSrc.replace(/const MAX_FLUSHES = \d+;/, 'const MAX_FLUSHES = 4;'),
    });
    expect(fewerFlushes.maxFlushes).toBe(4);
    expect(fewerFlushes.sendFlushes).toEqual([1, 2, 4]);
    expect(fewerFlushes.budgetMs).toBe(4 * real.batchIntervalMs + real.slackMs);
    expect(fewerFlushes.budgetMs).not.toBe(real.budgetMs);

    const fasterInterval = deriveAc5PollBudget({
      indexSrc: indexSrc.replace(
        /const BATCH_INTERVAL_MS = [0-9_]+;/,
        'const BATCH_INTERVAL_MS = 2_000;',
      ),
      eventsSrc,
    });
    expect(fasterInterval.batchIntervalMs).toBe(2000);
    expect(fasterInterval.budgetMs).toBe(
      real.sendFlushes[real.sendFlushes.length - 1] * 2000 + real.slackMs,
    );

    // A cap that is not a power of two: the batch is only dropped on a SEND flush at or past the
    // cap, so the last send is the next power of two, not the cap.
    const oddCap = deriveAc5PollBudget({
      indexSrc,
      eventsSrc: eventsSrc.replace(/const MAX_FLUSHES = \d+;/, 'const MAX_FLUSHES = 10;'),
    });
    expect(oddCap.sendFlushes).toEqual([1, 2, 4, 8, 16]);
  });

  it('refuses to guess when the schedule it knows how to read is gone', async () => {
    const indexSrc = await readFile(SDK_INDEX, 'utf8');
    const eventsSrc = await readFile(SDK_EVENTS, 'utf8');
    expect(() =>
      deriveAc5PollBudget({
        indexSrc,
        eventsSrc: eventsSrc.replace('!(++b.n & (b.n - 1))', 'b.n++ % 3 === 0'),
      }),
    ).toThrow(/re-send schedule/);
    expect(() =>
      deriveAc5PollBudget({
        indexSrc,
        eventsSrc: eventsSrc.replace(/const MAX_FLUSHES = \d+;/, ''),
      }),
    ).toThrow(/MAX_FLUSHES/);
    expect(() =>
      deriveAc5PollBudget({
        indexSrc: indexSrc.replace(/const BATCH_INTERVAL_MS = [0-9_]+;/, ''),
        eventsSrc,
      }),
    ).toThrow(/BATCH_INTERVAL_MS/);
  });
});

describe('FOLLOW-1252: a re-sent conversion (run 6, lands at 8.15 s)', () => {
  it('reads RED under the legacy 7 s read — the §5.16 false red, reproduced', async () => {
    const b = await readAc5PollBudget();
    const clock = virtualClock();
    const n = await legacyFixedSleepRead(
      clock,
      rowLandingAt(clock, RUN6_LANDS_MS),
      b.batchIntervalMs,
    );
    expect(clock.now()).toBe(7000);
    expect(n).toBe(0);
  });

  it('reads GREEN under the poll, and records when it was seen', async () => {
    const b = await readAc5PollBudget();
    const clock = virtualClock();
    const count = rowLandingAt(clock, RUN6_LANDS_MS);
    const poll = await pollThisRunConversion({
      countConversions: count,
      budgetMs: b.budgetMs,
      clickAt: 0,
      pollMs: 500,
      now: clock.now,
      sleepFn: clock.sleep,
    });
    expect(poll.landed).toBe(true);
    expect(poll.conversions).toBe(1);
    expect(poll.budgetMs).toBe(b.budgetMs);
    expect(poll.landedAtMs).toBe(8500); // first 500 ms poll at or after 8150
    expect(poll.waitedMs).toBe(8500);
    expect(poll.attempts).toBe(18); // reads at 0, 500, …, 8500
    expect(poll.unreadableReads).toBe(0);

    // The verdict reads the count AFTER the poll, as main() does: converted.
    const thisRun = {
      determinable: true,
      reason: null,
      treatmentArmDecisions: 1,
      conversions: await count(),
    };
    const v = evaluateThisRunConversion(thisRun, null);
    expect(v.converted).toBe(true);
    expect(v.unmet).toEqual([]);
  });

  it('records that the ingest refused the first send and the SDK re-sent it', () => {
    const r = run6Records();
    const s = summarizeCtaIngest({ ...r, ingestOrigin: INGEST, sessionId: SID });
    expect(s.ingestPosts).toBe(3);
    expect(s.ingestFailedAtNetwork).toBe(1);
    expect(s.ingest5xx).toBe(0);
    expect(s.ctaPosts.map((p) => [p.seq, p.status, p.failure])).toEqual([
      [2, null, 'net::ERR_FAILED'],
      [3, 200, null],
    ]);
    expect(s.ctaBatchAccepted).toBe(true);
    expect(s.resent).toBe(true);
    expect(s.resentFirstEventIds).toEqual([CTA_EVENT]);
  });

  it('counts an ingest 5xx the browser DID see (a CORS-carrying 503) as a 5xx', () => {
    const first = ctaBatch(2, 3100, 503, null);
    const s = summarizeCtaIngest({
      ingestPosts: [first.post],
      emitted: [first.emitted],
      ingestOrigin: INGEST,
      sessionId: SID,
    });
    expect(s.ingest5xx).toBe(1);
    expect(s.ctaBatchAccepted).toBe(false);
    expect(s.resent).toBe(false);
  });
});

describe('FOLLOW-1252: a conversion that never lands stays RED, with the right cause', () => {
  async function expire() {
    const b = await readAc5PollBudget();
    const clock = virtualClock();
    const poll = await pollThisRunConversion({
      countConversions: rowLandingAt(clock, null),
      budgetMs: b.budgetMs,
      clickAt: 0,
      pollMs: 500,
      now: clock.now,
      sleepFn: clock.sleep,
    });
    return { b, poll };
  }
  const zero: ThisRun = {
    determinable: true,
    reason: null,
    treatmentArmDecisions: 1,
    conversions: 0,
  };

  it('spends the whole budget and no more', async () => {
    const { b, poll } = await expire();
    expect(poll.landed).toBe(false);
    expect(poll.landedAtMs).toBeNull();
    expect(poll.waitedMs).toBe(b.budgetMs);
    expect(poll.conversions).toBe(0);
  });

  it('every send refused → no_ingest_2xx_for_cta_batch', async () => {
    const { b } = await expire();
    const posts = [ctaBatch(2, 3100, null, 'net::ERR_FAILED'), ctaBatch(3, 8100, 503, null)];
    const ctaIngest = summarizeCtaIngest({
      ingestPosts: posts.map((p) => p.post),
      emitted: posts.map((p) => p.emitted),
      ingestOrigin: INGEST,
      sessionId: SID,
    });
    const loss = classifyConversionLoss({ ctaIngest, budgetMs: b.budgetMs });
    expect(loss.lossKind).toBe('no_ingest_2xx_for_cta_batch');
    expect(loss.cause).toContain(String(b.budgetMs));
    expect(loss.cause).toContain('net::ERR_FAILED');
    expect(loss.cause).toContain('503');
    const v = evaluateThisRunConversion(zero, loss);
    expect(v.converted).toBe(false);
    expect(v.unmet).toEqual([
      'thisRunConversions=0',
      'thisRunConversionLoss=no_ingest_2xx_for_cta_batch',
    ]);
  });

  it('ingest said 200 but no row → ingest_accepted_row_never_landed', async () => {
    const { b } = await expire();
    const ctaIngest = summarizeCtaIngest({
      ...run6Records(),
      ingestOrigin: INGEST,
      sessionId: SID,
    });
    const loss = classifyConversionLoss({ ctaIngest, budgetMs: b.budgetMs });
    expect(loss.lossKind).toBe('ingest_accepted_row_never_landed');
    expect(loss.cause).toContain(String(b.budgetMs));
    const v = evaluateThisRunConversion(zero, loss);
    expect(v.converted).toBe(false);
    expect(v.unmet).toContain('thisRunConversionLoss=ingest_accepted_row_never_landed');
  });

  it('no ingest POST carried the cta.clicked (the §5.5 negative control) → cta_not_sent', async () => {
    const { b } = await expire();
    const ctaIngest = summarizeCtaIngest({
      ingestPosts: [priorBatch.post],
      emitted: [priorBatch.emitted],
      ingestOrigin: INGEST,
      sessionId: SID,
    });
    const loss = classifyConversionLoss({ ctaIngest, budgetMs: b.budgetMs });
    expect(loss.lossKind).toBe('cta_not_sent');
    const v = evaluateThisRunConversion(zero, loss);
    expect(v.converted).toBe(false);
    expect(v.unmet[0]).toBe('thisRunConversions=0');
  });

  it('an unreadable ClickHouse is counted, never read as a landed row', async () => {
    const clock = virtualClock();
    const poll = await pollThisRunConversion({
      countConversions: () => Promise.resolve(null),
      budgetMs: 2000,
      clickAt: 0,
      pollMs: 500,
      now: clock.now,
      sleepFn: clock.sleep,
    });
    expect(poll.landed).toBe(false);
    expect(poll.unreadableReads).toBe(poll.attempts);
  });

  it('keeps the existing conjuncts: no decision row, or indeterminate, is not a conversion', () => {
    expect(
      evaluateThisRunConversion({ ...zero, treatmentArmDecisions: 0, conversions: 3 }, null),
    ).toEqual({ converted: false, unmet: ['thisRunTreatmentArmDecisions=0'] });
    expect(
      evaluateThisRunConversion(
        {
          determinable: false,
          reason: 'clickhouse_unreachable',
          treatmentArmDecisions: 0,
          conversions: 0,
        },
        null,
      ),
    ).toEqual({ converted: false, unmet: ['thisRun=indeterminate(clickhouse_unreachable)'] });
  });
});

describe('FOLLOW-1252: main() is wired to the poll, not the fixed sleep', () => {
  it('derives the budget from the SDK, polls, and grades through evaluateThisRunConversion()', async () => {
    const src = await readFile(HARNESS, 'utf8');
    const main = src.slice(src.indexOf('async function main()'));
    expect(main).toContain('await readAc5PollBudget()');
    expect(main).toContain('await pollThisRunConversion(');
    expect(main).toContain('evaluateThisRunConversion(thisRunAdaptedArm');
    expect(main).not.toMatch(/sleep\(batchIntervalMs \+ 2000\)/);
  });
});
