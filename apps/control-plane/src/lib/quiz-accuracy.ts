/**
 * Quiz accuracy report — the pure computation (FOLLOW-1363, plan Faza Q package Q8, MASTER_DESIGN
 * §E.4.8 v3.0). Implements `docs/decisions/PREREG-quiz-accuracy-2026-10.md` §2–§4 and §7 and
 * nothing else: no I/O, no clock, so the golden fixtures run without a database. The SQL reader is
 * `readQuizAccuracyData` in `lib/quiz-runs.ts`; the route is
 * `GET /api/admin/tenants/quiz-accuracy`; the staff tab is `/admin/tenants/[id]/quiz-accuracy`.
 *
 * What is computed over WHICH rows (the PREREG fixes a single analysis on a fixed sample, so the
 * headline cannot simply be "all rows so far"):
 *
 * - HEADLINE (§3) — the FIRST {@link N_REQUIRED} decided rows of the selected hash in
 *   `shown_at` order (ties by id). Fewer than 400 decided rows is `INSUFFICIENT_N`; once 400 exist a
 *   later row can never change the verdict. PASS iff the two-sided 95 % Wilson LOWER bound of
 *   confirmed / (confirmed + corrected) is >= 0.90 (372/400 passes, 371/400 fails).
 * - FUTILITY (§3) — looks at EXACTLY the first 130 and the first 200 decided rows; a Wilson UPPER
 *   bound < 0.90 at either look is `FUTILE` (stop, fix the tree, which changes the hash). Computed
 *   on the chronological prefixes, so the answer is the same whenever the tab is opened.
 * - PESSIMISTIC (§3) — the same sample window with the `unconfirmed` runs in it counted as wrong.
 * - SECONDARY (§4) — per-leaf precision/recall, macro recall, confusion matrix, language, speed
 *   tertile and monthly rows are computed over ALL decided rows in scope (a per-class claim needs
 *   n_true >= 100, which 400 rows spread over 12 classes cannot give) and are reported, never gated.
 * - The all-rows Wilson interval is also returned as `all_decided` — descriptive monitoring
 *   (§7), explicitly NOT a verdict.
 *
 * `none_of_these` (a `corrected` run whose target is "none of these") is a MISS for the predicted
 * leaf's precision and for the headline, and is a column of the confusion matrix; it is not a true
 * class (it has no recall).
 *
 * @module apps/control-plane/src/lib/quiz-accuracy
 */

import { minSuccessesForLowerBound, wilsonInterval } from '@estalara/shared';

/** Fixed sample size of the pre-registered analysis (PREREG §3). */
const N_REQUIRED = 400;
/** Decided-row counts at which the futility rule looks (PREREG §3). */
const FUTILITY_LOOKS: readonly number[] = [130, 200];
/** Required Wilson lower bound for PASS and the futility upper-bound threshold (PREREG §3). */
const PASS_BOUND = 0.9;
/** A "yes" faster than this on the confirmation screen is flagged, never excluded (PREREG §3). */
const FAST_YES_MS = 1500;
/** Classes with at least this many true labels enter the macro recall (PREREG §4). */
const MIN_TRUE_FOR_MACRO = 30;
/** A per-class claim needs at least this many true labels (PREREG §4). */
const MIN_TRUE_FOR_CLAIM = 100;
/** A claimable class is flagged when its recall lower bound is below this (PREREG §4). */
const RECALL_FLAG_BOUND = 0.8;
/** Validity condition: decided / completed must be at least this (PREREG §3). */
const RESPONSE_RATE_MIN = 0.6;
/** Monthly warning only fires for a month with at least this many decided runs (PREREG §7). */
const MONTHLY_WARN_MIN_DECIDED = 100;
/** The correction target when the buyer rejects every offered archetype. */
const NONE_OF_THESE = 'none_of_these';

/** A terminal confirmation outcome that enters the report. */
type AccuracyRunStatus = 'confirmed' | 'corrected' | 'unconfirmed';

/**
 * One non-neutral run that reached a confirmation outcome, in chronological order.
 * `confirmed` / `corrected` are the "decided" rows; `unconfirmed` only feeds the pessimistic variant.
 */
export interface AccuracyRun {
  status: AccuracyRunStatus;
  /** The quiz leaf (never `neutral`). */
  resolved_archetype: string;
  /** The leaf (confirmed) or the correction target / `none_of_these` (corrected). */
  confirmed_archetype: string | null;
  language: string | null;
  /** UTC `YYYY-MM` of `shown_at`. */
  month: string;
  /** Sum of `step_ms`; `null` when the run has no timings. */
  step_total_ms: number | null;
  result_ms: number | null;
}

/** One grouped row of the funnel query (rows of ALL statuses, neutral included). */
export interface FunnelGroupRow {
  month: string;
  status: string;
  /** `resolved_archetype = 'neutral'`. */
  neutral: boolean;
  last_step: number | null;
  count: number;
}

/** One definition hash seen in range. */
export interface HashSummary {
  hash: string;
  /** Highest `definition_version` seen with this hash; `null` for the built-in default. */
  version: number | null;
  /** Decided rows (confirmed + corrected, non-neutral) of this hash in range. */
  n: number;
}

type QuizAccuracyVerdict = 'PASS' | 'FAIL' | 'FUTILE' | 'INSUFFICIENT_N';

interface WilsonBounds {
  lo: number;
  hi: number;
}

interface Proportion {
  n: number;
  correct: number;
  accuracy: number | null;
  wilson95: WilsonBounds;
}

export interface QuizAccuracyReport {
  definition_hash: string | null;
  /** Applied filters, echoed so a consumer can see what the verdict covers. */
  filters: { from: string | null; to: string | null; language: string | null };
  definition_hashes: HashSummary[];
  funnel: {
    /** Every run of the hash in scope (each was shown). */
    shown: number;
    /** `dismissed` runs by the step the card closed on (`step: null` = not recorded). */
    dismissed_by_step: { step: number | null; count: number }[];
    /** Runs that reached the result screen (status completed, confirmed, corrected or unconfirmed). */
    completed: number;
    /** Of `completed`: the neutral leaf, which is never asked to confirm. */
    completed_neutral: number;
    confirmed: number;
    corrected: number;
    unconfirmed: number;
  };
  headline: Proportion & {
    /** Decided rows of the hash in scope (all of them, not just the analysed 400). */
    decided: number;
    /** Decided rows the verdict is computed over: `min(decided, 400)`. */
    analysed_n: number;
    verdict: QuizAccuracyVerdict;
    n_required: number;
    /** Successes needed at `n_required` for the lower bound to reach 0.90 (372 at n = 400). */
    pass_threshold: number | null;
    futility_looks: {
      n: number;
      reached: boolean;
      correct: number | null;
      hi: number | null;
      futile: boolean;
    }[];
    /**
     * False when a `from`/`to`/`language` filter narrows the sample: the numbers are then a
     * description of a subset, not the pre-registered analysis.
     */
    verdict_binding: boolean;
  };
  /** Unconfirmed runs inside the analysed window counted as wrong (PREREG §3 validity). */
  pessimistic: Proportion & { unconfirmed: number; would_pass: boolean };
  /** All decided rows in scope, descriptive monitoring only (PREREG §7). */
  all_decided: Proportion;
  macro_recall: {
    value: number | null;
    classes: string[];
    min_true: number;
  };
  per_leaf: PerLeaf[];
  confusion: {
    /** Predicted leaves (rows), sorted. */
    labels: string[];
    /** Columns: `labels` followed by `none_of_these`. */
    columns: string[];
    /** `matrix[i][j]` = decided runs predicted `labels[i]` whose true label is `columns[j]`. */
    matrix: number[][];
  };
  by_language: ({ language: string } & Proportion)[];
  by_speed_tertile: SpeedTertile[];
  fast_yes: {
    confirmed_with_timing: number;
    fast: number;
    share: number | null;
    threshold_ms: number;
  };
  monthly: MonthlyRow[];
  response_rate: {
    decided: number;
    /** Completed runs that were asked to confirm (`completed - completed_neutral`). */
    asked: number;
    rate: number | null;
    min_rate: number;
    /** `null` when nothing was asked yet. */
    valid: boolean | null;
  };
}

interface PerLeaf {
  archetype: string;
  predicted_n: number;
  precision: number | null;
  precision_ci: WilsonBounds;
  true_n: number;
  recall: number | null;
  recall_ci: WilsonBounds;
  /** n_true >= 100. */
  claimable: boolean;
  /** Claimable and the recall lower bound is below 0.80. */
  flagged: boolean;
}

interface SpeedTertile extends Proportion {
  tertile: 1 | 2 | 3;
  /** Min / max summed `step_ms` in the tertile. */
  step_ms_range: [number, number] | null;
  fast_yes_share: number | null;
}

interface MonthlyRow extends Proportion {
  month: string;
  decided: number;
  /** Completed-and-asked runs of the month (response-rate denominator). */
  asked: number;
  response_rate: number | null;
  /** The PREREG §7 warning conditions, evaluated for this month. */
  warn: { upper_bound_below_target: boolean; response_rate_below_min: boolean };
}

function proportion(correct: number, n: number): Proportion {
  const w = wilsonInterval(correct, n);
  return {
    n,
    correct,
    accuracy: n === 0 ? null : correct / n,
    wilson95: { lo: w.lo, hi: w.hi },
  };
}

function isDecided(r: AccuracyRun): boolean {
  return r.status === 'confirmed' || r.status === 'corrected';
}

/** The buyer's true label of a decided run. */
function trueLabel(r: AccuracyRun): string {
  return r.status === 'confirmed' ? r.resolved_archetype : (r.confirmed_archetype ?? NONE_OF_THESE);
}

/** Chronological prefix ending at the `limit`-th decided row (unconfirmed runs before it stay). */
function analysedWindow(runs: readonly AccuracyRun[], limit: number): AccuracyRun[] {
  const out: AccuracyRun[] = [];
  let decided = 0;
  for (const r of runs) {
    if (decided === limit) break; // everything after the last sample row is outside the window
    if (isDecided(r)) decided += 1;
    out.push(r);
  }
  return out;
}

function countCorrect(runs: readonly AccuracyRun[]): number {
  return runs.reduce((acc, r) => acc + (r.status === 'confirmed' ? 1 : 0), 0);
}

/**
 * The PREREG verdict from the chronological decided rows (PREREG §3).
 * FUTILE wins over everything (the rule says stop); below 400 there is no pass/fail.
 */
function verdictOf(decided: readonly AccuracyRun[]): {
  verdict: QuizAccuracyVerdict;
  looks: QuizAccuracyReport['headline']['futility_looks'];
} {
  const looks = FUTILITY_LOOKS.map((n) => {
    if (decided.length < n) return { n, reached: false, correct: null, hi: null, futile: false };
    const correct = countCorrect(decided.slice(0, n));
    const hi = wilsonInterval(correct, n).hi;
    return { n, reached: true, correct, hi, futile: hi < PASS_BOUND };
  });
  if (looks.some((l) => l.futile)) return { verdict: 'FUTILE', looks };
  if (decided.length < N_REQUIRED) return { verdict: 'INSUFFICIENT_N', looks };
  const lo = wilsonInterval(countCorrect(decided.slice(0, N_REQUIRED)), N_REQUIRED).lo;
  return { verdict: lo >= PASS_BOUND ? 'PASS' : 'FAIL', looks };
}

/** Group decided rows by a key into `Proportion`s. */
function groupProportions<K extends string>(
  decided: readonly AccuracyRun[],
  key: (r: AccuracyRun) => K,
): Map<K, Proportion> {
  const acc = new Map<K, { n: number; correct: number }>();
  for (const r of decided) {
    const k = key(r);
    const cur = acc.get(k) ?? { n: 0, correct: 0 };
    cur.n += 1;
    if (r.status === 'confirmed') cur.correct += 1;
    acc.set(k, cur);
  }
  return new Map([...acc].map(([k, v]) => [k, proportion(v.correct, v.n)]));
}

function buildPerLeaf(decided: readonly AccuracyRun[], labels: readonly string[]): PerLeaf[] {
  return labels.map((archetype) => {
    const predicted = decided.filter((r) => r.resolved_archetype === archetype);
    const predictedOk = predicted.filter((r) => r.status === 'confirmed').length;
    const trueN = decided.filter((r) => trueLabel(r) === archetype).length;
    const precision = proportion(predictedOk, predicted.length);
    // recall: of the runs whose TRUE label is this class, how many were predicted as it
    // (a confirmed run is predicted = true; a correction INTO the class is a miss).
    const recall = proportion(predictedOk, trueN);
    const claimable = trueN >= MIN_TRUE_FOR_CLAIM;
    return {
      archetype,
      predicted_n: predicted.length,
      precision: precision.accuracy,
      precision_ci: precision.wilson95,
      true_n: trueN,
      recall: recall.accuracy,
      recall_ci: recall.wilson95,
      claimable,
      flagged: claimable && recall.wilson95.lo < RECALL_FLAG_BOUND,
    };
  });
}

/** A confirmed run that recorded how long the buyer looked at the confirmation screen. */
function hasConfirmedTiming(r: AccuracyRun): boolean {
  return r.status === 'confirmed' && r.result_ms !== null;
}

/** A confirmation faster than {@link FAST_YES_MS}: flagged, never excluded (PREREG §3). */
function isFastYes(r: AccuracyRun): boolean {
  return r.result_ms !== null && r.result_ms < FAST_YES_MS;
}

function buildSpeed(decided: readonly AccuracyRun[]): SpeedTertile[] {
  const timed = decided
    .flatMap((r, i) => (r.step_total_ms === null ? [] : [{ r, i, ms: r.step_total_ms }]))
    .sort((a, b) => a.ms - b.ms || a.i - b.i);
  const size = timed.length / 3;
  return ([1, 2, 3] as const).map((tertile) => {
    const slice = timed.slice(Math.round((tertile - 1) * size), Math.round(tertile * size));
    const rows = slice.map((s) => s.r);
    const confirmedTimed = rows.filter(hasConfirmedTiming);
    const fast = confirmedTimed.filter(isFastYes).length;
    const first = slice[0];
    const last = slice[slice.length - 1];
    return {
      tertile,
      ...proportion(countCorrect(rows), rows.length),
      step_ms_range: first && last ? [first.ms, last.ms] : null,
      fast_yes_share: confirmedTimed.length === 0 ? null : fast / confirmedTimed.length,
    };
  });
}

/** Input of {@link buildQuizAccuracyReport}; produced by `readQuizAccuracyData`. */
interface QuizAccuracyInput {
  /** The selected hash (`null` when the tenant has no run with a hash). */
  definitionHash: string | null;
  hashes: HashSummary[];
  /** Non-neutral confirmed / corrected / unconfirmed runs of the hash, oldest first. */
  runs: AccuracyRun[];
  funnelRows: FunnelGroupRow[];
  filters: { from: string | null; to: string | null; language: string | null };
}

/** Compute the full report (pure). */
export function buildQuizAccuracyReport(input: QuizAccuracyInput): QuizAccuracyReport {
  const { runs, funnelRows } = input;
  const decided = runs.filter(isDecided);

  // Headline: the pre-registered fixed sample.
  const sample = decided.slice(0, N_REQUIRED);
  const { verdict, looks } = verdictOf(decided);
  const headlineProp = proportion(countCorrect(sample), sample.length);
  const window = analysedWindow(runs, N_REQUIRED);
  const pessimisticRuns = window;
  const pessimisticProp = proportion(countCorrect(pessimisticRuns), pessimisticRuns.length);

  // Funnel.
  const sumWhere = (pred: (f: FunnelGroupRow) => boolean): number =>
    funnelRows.filter(pred).reduce((a, f) => a + f.count, 0);
  const reachedResult = (f: FunnelGroupRow): boolean =>
    f.status === 'completed' ||
    f.status === 'confirmed' ||
    f.status === 'corrected' ||
    f.status === 'unconfirmed';
  const dismissed = new Map<number | null, number>();
  for (const f of funnelRows) {
    if (f.status === 'dismissed') {
      dismissed.set(f.last_step, (dismissed.get(f.last_step) ?? 0) + f.count);
    }
  }
  const completed = sumWhere(reachedResult);
  const completedNeutral = sumWhere((f) => reachedResult(f) && f.neutral);
  const asked = completed - completedNeutral;

  // Labels: every archetype seen as predicted or as a true label.
  const labelSet = new Set<string>();
  for (const r of decided) {
    labelSet.add(r.resolved_archetype);
    const t = trueLabel(r);
    if (t !== NONE_OF_THESE) labelSet.add(t);
  }
  const labels = [...labelSet].sort();
  const columns = [...labels, NONE_OF_THESE];
  const matrix = labels.map(() => columns.map(() => 0));
  for (const r of decided) {
    const row = labels.indexOf(r.resolved_archetype);
    const col = columns.indexOf(trueLabel(r));
    const cells = matrix[row];
    if (cells) cells[col] = (cells[col] ?? 0) + 1;
  }

  const perLeaf = buildPerLeaf(decided, labels);
  const macroClasses = perLeaf.filter((p) => p.true_n >= MIN_TRUE_FOR_MACRO && p.recall !== null);
  const macro =
    macroClasses.length === 0
      ? null
      : macroClasses.reduce((a, p) => a + (p.recall ?? 0), 0) / macroClasses.length;

  const fastConfirmed = decided.filter(hasConfirmedTiming);
  const fast = fastConfirmed.filter(isFastYes).length;

  const askedByMonth = new Map<string, number>();
  for (const f of funnelRows) {
    if (reachedResult(f) && !f.neutral) {
      askedByMonth.set(f.month, (askedByMonth.get(f.month) ?? 0) + f.count);
    }
  }
  const monthProps = groupProportions(decided, (r) => r.month);
  const months = [...new Set([...monthProps.keys(), ...askedByMonth.keys()])].sort();
  const monthly: MonthlyRow[] = months.map((month) => {
    const p = monthProps.get(month) ?? proportion(0, 0);
    const askedM = askedByMonth.get(month) ?? 0;
    const rate = askedM === 0 ? null : p.n / askedM;
    return {
      month,
      ...p,
      decided: p.n,
      asked: askedM,
      response_rate: rate,
      warn: {
        upper_bound_below_target: p.n >= MONTHLY_WARN_MIN_DECIDED && p.wilson95.hi < PASS_BOUND,
        response_rate_below_min:
          p.n >= MONTHLY_WARN_MIN_DECIDED && rate !== null && rate < RESPONSE_RATE_MIN,
      },
    };
  });

  const rate = asked === 0 ? null : decided.length / asked;
  const threshold = minSuccessesForLowerBound(N_REQUIRED, PASS_BOUND);

  return {
    definition_hash: input.definitionHash,
    filters: input.filters,
    definition_hashes: input.hashes,
    funnel: {
      shown: sumWhere(() => true),
      dismissed_by_step: [...dismissed]
        .map(([step, count]) => ({ step, count }))
        .sort((a, b) => (a.step ?? Infinity) - (b.step ?? Infinity)),
      completed,
      completed_neutral: completedNeutral,
      confirmed: sumWhere((f) => f.status === 'confirmed'),
      corrected: sumWhere((f) => f.status === 'corrected'),
      unconfirmed: sumWhere((f) => f.status === 'unconfirmed'),
    },
    headline: {
      ...headlineProp,
      decided: decided.length,
      analysed_n: sample.length,
      verdict,
      n_required: N_REQUIRED,
      pass_threshold: threshold,
      futility_looks: looks,
      verdict_binding:
        input.filters.from === null && input.filters.to === null && input.filters.language === null,
    },
    pessimistic: {
      ...pessimisticProp,
      unconfirmed: pessimisticRuns.filter((r) => r.status === 'unconfirmed').length,
      would_pass: pessimisticProp.n >= N_REQUIRED && pessimisticProp.wilson95.lo >= PASS_BOUND,
    },
    all_decided: proportion(countCorrect(decided), decided.length),
    macro_recall: {
      value: macro,
      classes: macroClasses.map((p) => p.archetype),
      min_true: MIN_TRUE_FOR_MACRO,
    },
    per_leaf: perLeaf,
    confusion: { labels, columns, matrix },
    by_language: [...groupProportions(decided, (r) => r.language ?? 'unknown')]
      .map(([language, p]) => ({ language, ...p }))
      .sort((a, b) => a.language.localeCompare(b.language)),
    by_speed_tertile: buildSpeed(decided),
    fast_yes: {
      confirmed_with_timing: fastConfirmed.length,
      fast,
      share: fastConfirmed.length === 0 ? null : fast / fastConfirmed.length,
      threshold_ms: FAST_YES_MS,
    },
    monthly,
    response_rate: {
      decided: decided.length,
      asked,
      rate,
      min_rate: RESPONSE_RATE_MIN,
      valid: rate === null ? null : rate >= RESPONSE_RATE_MIN,
    },
  };
}
