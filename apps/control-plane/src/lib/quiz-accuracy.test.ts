/**
 * Golden fixtures for the pure quiz-accuracy computation (FOLLOW-1363). Every expectation below is
 * a number from `docs/decisions/PREREG-quiz-accuracy-2026-10.md` or hand-computed from a tiny
 * matrix, not a mirror of the implementation.
 */
import { describe, expect, it } from 'vitest';
import { wilsonInterval } from '@estalara/shared';
import { buildQuizAccuracyReport, type AccuracyRun, type FunnelGroupRow } from './quiz-accuracy';

const NONE_OF_THESE = 'none_of_these';
type QuizAccuracyInput = Parameters<typeof buildQuizAccuracyReport>[0];
const FILTERS = { from: null, to: null, language: null };

function run(over: Partial<AccuracyRun> & Pick<AccuracyRun, 'status'>): AccuracyRun {
  return {
    resolved_archetype: 'yield_hunter',
    confirmed_archetype: null,
    language: 'en',
    month: '2026-11',
    step_total_ms: 9000,
    result_ms: 4000,
    ...over,
  };
}

/** `correct` confirmed rows then `n - correct` corrected rows (to `none_of_these`), in that order. */
function sample(n: number, correct: number): AccuracyRun[] {
  return Array.from({ length: n }, (_, i) =>
    i < correct
      ? run({ status: 'confirmed', confirmed_archetype: 'yield_hunter' })
      : run({ status: 'corrected', confirmed_archetype: NONE_OF_THESE }),
  );
}

/**
 * The same counts but with the misses spread evenly through the sequence, so the two futility
 * prefixes are representative of the whole sample.
 */
function spread(n: number, correct: number): AccuracyRun[] {
  const wrong = n - correct;
  return Array.from({ length: n }, (_, i) => {
    const isWrong = Math.floor(((i + 1) * wrong) / n) > Math.floor((i * wrong) / n);
    return isWrong
      ? run({ status: 'corrected', confirmed_archetype: NONE_OF_THESE })
      : run({ status: 'confirmed', confirmed_archetype: 'yield_hunter' });
  });
}

function report(runs: AccuracyRun[], funnelRows: FunnelGroupRow[] = []) {
  const input: QuizAccuracyInput = {
    definitionHash: 'h1',
    hashes: [{ hash: 'h1', version: 3, n: runs.length }],
    runs,
    funnelRows,
    filters: FILTERS,
  };
  return buildQuizAccuracyReport(input);
}

describe('verdict (PREREG §3)', () => {
  it('372/400 confirmed is PASS and 371/400 is FAIL', () => {
    const pass = report(spread(400, 372)).headline;
    expect(pass.verdict).toBe('PASS');
    expect(pass.wilson95.lo).toBeGreaterThanOrEqual(0.9);
    expect(pass.pass_threshold).toBe(372);
    expect(pass.n_required).toBe(400);
    const fail = report(spread(400, 371)).headline;
    expect(fail.verdict).toBe('FAIL');
    expect(fail.wilson95.lo).toBeLessThan(0.9);
    expect(fail.correct).toBe(371);
  });

  it('is INSUFFICIENT_N below 400 decided rows, even at 100 % accuracy', () => {
    const h = report(sample(399, 399)).headline;
    expect(h.verdict).toBe('INSUFFICIENT_N');
    expect(h.decided).toBe(399);
    expect(h.accuracy).toBe(1);
  });

  it('is INSUFFICIENT_N with no rows at all and a [0,1] interval', () => {
    const r = report([]);
    expect(r.headline.verdict).toBe('INSUFFICIENT_N');
    expect(r.headline.accuracy).toBeNull();
    expect(r.headline.wilson95).toEqual({ lo: 0, hi: 1 });
    expect(r.response_rate.valid).toBeNull();
  });

  it('only the first 400 decided rows count; later rows cannot change the verdict', () => {
    const rows = [...spread(400, 372), ...sample(500, 0)];
    const r = report(rows);
    expect(r.headline.verdict).toBe('PASS');
    expect(r.headline.decided).toBe(900);
    expect(r.headline.analysed_n).toBe(400);
    expect(r.all_decided.n).toBe(900);
    expect(r.all_decided.wilson95.lo).toBeLessThan(0.9);
  });

  it('futility at n = 130: upper bound < 0.90 is FUTILE', () => {
    // 110/130 is the last count whose Wilson upper bound (0.898) is below 0.90; 111/130 is not.
    expect(wilsonInterval(110, 130).hi).toBeLessThan(0.9);
    expect(wilsonInterval(111, 130).hi).toBeGreaterThanOrEqual(0.9);
    const futile = report(sample(130, 110)).headline;
    expect(futile.verdict).toBe('FUTILE');
    expect(futile.futility_looks[0]).toMatchObject({ n: 130, reached: true, futile: true });
    expect(futile.futility_looks[1]).toMatchObject({ n: 200, reached: false, futile: false });
    expect(report(sample(130, 111)).headline.verdict).toBe('INSUFFICIENT_N');
  });

  it('futility at n = 200 (130 clean, 200 not)', () => {
    // first 130 all confirmed (hi 1.0); of the next 70 only 40 confirmed -> 170/200 = 85 %.
    const rows = [...sample(130, 130), ...sample(70, 40)];
    expect(wilsonInterval(170, 200).hi).toBeLessThan(0.9);
    const h = report(rows).headline;
    expect(h.futility_looks[0]).toMatchObject({ n: 130, futile: false });
    expect(h.futility_looks[1]).toMatchObject({ n: 200, reached: true, futile: true });
    expect(h.verdict).toBe('FUTILE');
  });

  it('futility boundary at n = 200 is 171 (upper bound 0.897) vs 172 (0.901)', () => {
    const at = (k: number) => report([...sample(130, 130), ...sample(70, k - 130)]).headline;
    expect(at(171).futility_looks[1]).toMatchObject({ n: 200, futile: true });
    expect(at(172).futility_looks[1]).toMatchObject({ n: 200, futile: false });
    expect(at(172).verdict).toBe('INSUFFICIENT_N');
  });

  it('FUTILE stays FUTILE once 400 rows exist (the rule says stop)', () => {
    const rows = [...sample(130, 100), ...sample(270, 270)];
    expect(report(rows).headline.verdict).toBe('FUTILE');
  });

  it('a narrowing filter makes the verdict non-binding', () => {
    const r = buildQuizAccuracyReport({
      definitionHash: 'h1',
      hashes: [],
      runs: spread(400, 372),
      funnelRows: [],
      filters: { from: null, to: null, language: 'pl' },
    });
    expect(r.headline.verdict_binding).toBe(false);
    expect(report([]).headline.verdict_binding).toBe(true);
  });
});

describe('pessimistic variant (PREREG §3)', () => {
  it('counts unconfirmed runs inside the 400-row window as wrong', () => {
    const rows = [
      ...spread(400, 372),
      // after the 400th decided row: outside the window, ignored
      run({ status: 'unconfirmed' }),
    ];
    // 20 unconfirmed interleaved at the start -> inside the window
    const early = Array.from({ length: 20 }, () => run({ status: 'unconfirmed' }));
    const r = report([...early, ...rows]);
    expect(r.headline.verdict).toBe('PASS');
    expect(r.pessimistic.unconfirmed).toBe(20);
    expect(r.pessimistic.n).toBe(420);
    expect(r.pessimistic.correct).toBe(372);
    expect(r.pessimistic.would_pass).toBe(false);
    expect(r.pessimistic.wilson95.lo).toBeLessThan(0.9);
  });

  it('equals the headline when nothing is unconfirmed', () => {
    const r = report(spread(400, 380));
    expect(r.pessimistic.unconfirmed).toBe(0);
    expect(r.pessimistic.accuracy).toBe(r.headline.accuracy);
    expect(r.pessimistic.would_pass).toBe(true);
  });
});

describe('per-leaf, macro recall, confusion (PREREG §4)', () => {
  // 4 runs predicted A: 3 confirmed, 1 corrected to B.
  // 3 runs predicted B: 2 confirmed, 1 corrected to none_of_these.
  // 2 runs predicted C: 1 confirmed, 1 corrected to A.
  const runs: AccuracyRun[] = [
    ...Array.from({ length: 3 }, () =>
      run({ status: 'confirmed', resolved_archetype: 'A', confirmed_archetype: 'A' }),
    ),
    run({ status: 'corrected', resolved_archetype: 'A', confirmed_archetype: 'B' }),
    ...Array.from({ length: 2 }, () =>
      run({ status: 'confirmed', resolved_archetype: 'B', confirmed_archetype: 'B' }),
    ),
    run({ status: 'corrected', resolved_archetype: 'B', confirmed_archetype: NONE_OF_THESE }),
    run({ status: 'confirmed', resolved_archetype: 'C', confirmed_archetype: 'C' }),
    run({ status: 'corrected', resolved_archetype: 'C', confirmed_archetype: 'A' }),
  ];
  const r = report(runs);
  const leaf = (a: string) => r.per_leaf.find((p) => p.archetype === a)!;

  it('precision = confirmed / predicted; none_of_these is a miss', () => {
    expect(leaf('A')).toMatchObject({ predicted_n: 4, precision: 3 / 4 });
    expect(leaf('B')).toMatchObject({ predicted_n: 3, precision: 2 / 3 });
    expect(leaf('C')).toMatchObject({ predicted_n: 2, precision: 1 / 2 });
  });

  it('recall = confirmed / true labels (confirmed leaf + correction targets)', () => {
    // true A: 3 confirmed + 1 corrected-into (from C) = 4 -> recall 3/4
    expect(leaf('A')).toMatchObject({ true_n: 4, recall: 3 / 4 });
    // true B: 2 confirmed + 1 corrected-into (from A) = 3 -> 2/3
    expect(leaf('B')).toMatchObject({ true_n: 3, recall: 2 / 3 });
    // true C: 1 confirmed -> 1/1
    expect(leaf('C')).toMatchObject({ true_n: 1, recall: 1 });
    expect(leaf('A').precision_ci).toEqual({
      lo: wilsonInterval(3, 4).lo,
      hi: wilsonInterval(3, 4).hi,
    });
  });

  it('macro recall only over classes with >= 30 true labels (none here -> null)', () => {
    expect(r.macro_recall).toEqual({ value: null, classes: [], min_true: 30 });
  });

  it('macro recall averages the eligible classes only', () => {
    // class X: 40 true, 36 confirmed (recall 0.9); class Y: 30 true, 24 confirmed (0.8);
    // class Z: 29 true -> excluded.
    const mk = (cls: string, ok: number, total: number): AccuracyRun[] => [
      ...Array.from({ length: ok }, () =>
        run({ status: 'confirmed', resolved_archetype: cls, confirmed_archetype: cls }),
      ),
      ...Array.from({ length: total - ok }, () =>
        run({ status: 'corrected', resolved_archetype: 'Q', confirmed_archetype: cls }),
      ),
    ];
    const m = report([...mk('X', 36, 40), ...mk('Y', 24, 30), ...mk('Z', 29, 29)]);
    // Z: 29 true labels < 30 -> excluded; Q is only ever predicted (0 true labels).
    expect(m.per_leaf.find((p) => p.archetype === 'Z')!.true_n).toBe(29);
    expect(m.macro_recall.classes).toEqual(['X', 'Y']);
    expect(m.macro_recall.value).toBeCloseTo(0.85);
  });

  it('claimable at n_true >= 100, flagged when the recall lower bound < 0.80', () => {
    const build = (ok: number): AccuracyRun[] => [
      ...Array.from({ length: ok }, () =>
        run({ status: 'confirmed', resolved_archetype: 'K', confirmed_archetype: 'K' }),
      ),
      ...Array.from({ length: 100 - ok }, () =>
        run({ status: 'corrected', resolved_archetype: 'Q', confirmed_archetype: 'K' }),
      ),
    ];
    // PREREG: at n = 100 fewer than 88 correct has a lower bound < 0.80.
    const k = (ok: number) => report(build(ok)).per_leaf.find((p) => p.archetype === 'K')!;
    expect(k(87)).toMatchObject({ claimable: true, flagged: true });
    expect(k(88)).toMatchObject({ claimable: true, flagged: false });
    const small = report(build(100).slice(0, 60)).per_leaf.find((p) => p.archetype === 'K')!;
    expect(small).toMatchObject({ claimable: false, flagged: false });
  });

  it('confusion matrix: rows = predicted, columns = true labels + none_of_these', () => {
    expect(r.confusion.labels).toEqual(['A', 'B', 'C']);
    expect(r.confusion.columns).toEqual(['A', 'B', 'C', NONE_OF_THESE]);
    expect(r.confusion.matrix).toEqual([
      [3, 1, 0, 0], // predicted A
      [0, 2, 0, 1], // predicted B
      [1, 0, 1, 0], // predicted C
    ]);
  });
});

describe('funnel, response rate, splits', () => {
  const f = (
    status: string,
    count: number,
    over: Partial<FunnelGroupRow> = {},
  ): FunnelGroupRow => ({
    month: '2026-11',
    status,
    neutral: false,
    last_step: null,
    count,
    ...over,
  });
  const funnelRows = [
    f('shown', 10),
    f('dismissed', 5, { last_step: 1 }),
    f('dismissed', 3, { last_step: 0 }),
    f('dismissed', 1, { last_step: null }),
    f('completed', 4, { neutral: true }),
    f('completed', 2),
    f('confirmed', 60),
    f('corrected', 10),
    f('unconfirmed', 8),
  ];
  const r = report(spread(70, 60), funnelRows);

  it('maps every status', () => {
    expect(r.funnel).toEqual({
      shown: 103,
      dismissed_by_step: [
        { step: 0, count: 3 },
        { step: 1, count: 5 },
        { step: null, count: 1 },
      ],
      completed: 84,
      completed_neutral: 4,
      confirmed: 60,
      corrected: 10,
      unconfirmed: 8,
    });
  });

  it('response rate = decided / asked (neutral completions are never asked)', () => {
    expect(r.response_rate).toMatchObject({ decided: 70, asked: 80, min_rate: 0.6, valid: true });
    expect(r.response_rate.rate).toBeCloseTo(70 / 80);
    const low = report(spread(70, 60), [f('completed', 130)]);
    expect(low.response_rate.valid).toBe(false);
  });

  it('splits by language with an "unknown" bucket', () => {
    const rows = [
      run({ status: 'confirmed', language: 'pl' }),
      run({ status: 'corrected', language: 'pl', confirmed_archetype: NONE_OF_THESE }),
      run({ status: 'confirmed', language: 'en' }),
      run({ status: 'confirmed', language: null }),
    ];
    const by = Object.fromEntries(report(rows).by_language.map((l) => [l.language, l]));
    expect(by.pl).toMatchObject({ n: 2, correct: 1, accuracy: 0.5 });
    expect(by.en).toMatchObject({ n: 1, correct: 1 });
    expect(by.unknown).toMatchObject({ n: 1, correct: 1 });
  });

  it('speed tertiles by summed step_ms; fast "yes" is reported, never excluded', () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      run({
        status: 'confirmed',
        step_total_ms: (i + 1) * 1000,
        // the three fastest walkers also clicked "yes" in < 1.5 s
        result_ms: i < 3 ? 900 : 5000,
      }),
    );
    const r2 = report(rows);
    expect(r2.by_speed_tertile.map((t) => t.n)).toEqual([3, 3, 3]);
    expect(r2.by_speed_tertile[0]).toMatchObject({
      step_ms_range: [1000, 3000],
      fast_yes_share: 1,
    });
    expect(r2.by_speed_tertile[2]!.fast_yes_share).toBe(0);
    expect(r2.fast_yes).toEqual({
      confirmed_with_timing: 9,
      fast: 3,
      share: 1 / 3,
      threshold_ms: 1500,
    });
    expect(r2.headline.decided).toBe(9); // fast rows still counted
  });

  it('result_ms exactly 1500 is not fast; missing timings are skipped', () => {
    const r3 = report([
      run({ status: 'confirmed', result_ms: 1500, step_total_ms: null }),
      run({ status: 'confirmed', result_ms: 1499, step_total_ms: null }),
    ]);
    expect(r3.fast_yes).toMatchObject({ confirmed_with_timing: 2, fast: 1 });
    expect(r3.by_speed_tertile.every((t) => t.n === 0)).toBe(true);
  });

  it('monthly rows carry the PREREG §7 warning flags', () => {
    const rows = [
      ...Array.from({ length: 100 }, (_, i) =>
        i < 80
          ? run({ status: 'confirmed', month: '2026-11' })
          : run({ status: 'corrected', month: '2026-11', confirmed_archetype: NONE_OF_THESE }),
      ),
      ...Array.from({ length: 99 }, () =>
        run({ status: 'corrected', month: '2026-12', confirmed_archetype: NONE_OF_THESE }),
      ),
    ];
    const m = report(rows, [
      f('completed', 100, { month: '2026-11' }),
      f('completed', 99, { month: '2026-12' }),
    ]).monthly;
    expect(m.map((x) => x.month)).toEqual(['2026-11', '2026-12']);
    expect(m[0]!.warn).toEqual({ upper_bound_below_target: true, response_rate_below_min: false });
    // 99 decided < 100: no warning even at 0 % accuracy
    expect(m[1]!.warn).toEqual({ upper_bound_below_target: false, response_rate_below_min: false });
  });
});
