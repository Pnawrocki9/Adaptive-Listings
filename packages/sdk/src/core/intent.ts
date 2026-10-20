/**
 * Intent Engine — pure, never-throwing Bayesian archetype classifier; history in ADR-0024.
 * @module @estalara/sdk/core/intent
 */

import type { IntentWeights, TraitId } from '@estalara/shared';

export type Archetype =
  // Investors
  | 'yield_hunter'
  | 'vacation_rental_investor'
  | 'flip_investor'
  | 'portfolio_builder'
  | 'golden_visa_buyer'
  | 'commercial_investor'
  // Own use
  | 'family_buyer'
  | 'first_time_buyer'
  | 'upsizer'
  | 'downsizer'
  | 'luxury_buyer'
  | 'remote_worker'
  // Special / cross-border
  | 'lifestyle_expat'
  | 'retiree_relocator'
  | 'diaspora_buyer'
  | 'second_home_buyer'
  | 'student_parent'
  // Fallback
  | 'neutral';

/** Ordered list of all archetype names — used for iteration and uniform distribution. */
export const ARCHETYPE_NAMES: readonly Archetype[] = [
  'yield_hunter',
  'vacation_rental_investor',
  'flip_investor',
  'portfolio_builder',
  'golden_visa_buyer',
  'commercial_investor',
  'family_buyer',
  'first_time_buyer',
  'upsizer',
  'downsizer',
  'luxury_buyer',
  'remote_worker',
  'lifestyle_expat',
  'retiree_relocator',
  'diaspora_buyer',
  'second_home_buyer',
  'student_parent',
  'neutral',
];

/** Archetypes in the investor group — used for mismatch detection. */
export const INVESTOR_ARCHETYPES = new Set<Archetype>([
  'yield_hunter',
  'vacation_rental_investor',
  'flip_investor',
  'portfolio_builder',
  'golden_visa_buyer',
  'commercial_investor',
]);

/** Archetypes in the own-use group — used for mismatch detection. */
export const OWN_USE_ARCHETYPES = new Set<Archetype>([
  'family_buyer',
  'first_time_buyer',
  'upsizer',
  'downsizer',
  'luxury_buyer',
  'remote_worker',
]);

/** One probability value per archetype; values must sum to 1.0. */
export type ArchetypeProbabilities = Record<Archetype, number>;

export interface IntentState {
  archetype: Archetype;
  /**
   * 0.0 – 1.0: the posterior of `archetype` (§E.4.4 v3.0). Only a chat fold in a session without a
   * quiz scales it, by `CHAT_ONLY_CONFIDENCE_SCALE` (capped at 1.0) [FOLLOW-1359].
   */
  confidence: number;
  probabilities: ArchetypeProbabilities;
  /** Count of behavioral signals processed (known event types only). */
  signal_count: number;
  /** Unix ms timestamp of the last update. */
  last_updated_at: number;
  quiz_answered: boolean;
  /**
   * Dwell ticks already applied, persisted so rehydration never re-boosts (Rule R) [FOLLOW-227].
   */
  dwell_ticks_applied?: number;
  /** Chat ever folded; fallback gate for unstamped records (Rule R) [FOLLOW-252, FOLLOW-1024]. */
  chatPriorApplied?: boolean;
  /** `detected_at` of the last folded chat extraction (Rule R) [FOLLOW-1024]. */
  chatPriorAppliedAt?: string;
  /** Confident quiz-vs-chat disagreement; metadata, not an override [FOLLOW-100]. */
  chat_mismatch?: { quiz_archetype: Archetype; chat_archetype: Archetype };
  /**
   * Buyer traits the quiz recorded, canonical order (ESC-086 item 4) [FOLLOW-1357]. Persisted
   * with the state (`carry` keeps it); sent as `traits` on `/api/adapt` and `intent.snapshot`.
   */
  quiz_traits?: TraitId[];
  /**
   * The buyer confirmed (or corrected to) the quiz leaf: behaviour keeps the leaf's mass, chat is
   * tempered by τ, drift never fires (§E.4.4, §E.4.5) [FOLLOW-1359].
   */
  quiz_confirmed?: boolean;
  /** "None of these" on the result screen: the pre-quiz state, unpinned (§E.4.4) [FOLLOW-1359]. */
  quiz_rejected?: true;
  /** The leaf was re-pinned by behavioural drift, not by the buyer (§E.4.5) [FOLLOW-1359]. */
  source?: 'drift';
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Hysteresis margin against near-tie churn; not raised before calibration [FOLLOW-344]. */
export const SWITCH_MARGIN = 0.05;

/** Prior before any evidence; exported for the drift gate, readonly [FOLLOW-331]. */
export const BASE_PRIOR: ArchetypeProbabilities = {
  // Investors (each 0.04)
  yield_hunter: 0.04,
  vacation_rental_investor: 0.04,
  flip_investor: 0.04,
  portfolio_builder: 0.04,
  golden_visa_buyer: 0.04,
  commercial_investor: 0.04,
  // Own use (each 0.04)
  family_buyer: 0.04,
  first_time_buyer: 0.04,
  upsizer: 0.04,
  downsizer: 0.04,
  luxury_buyer: 0.04,
  remote_worker: 0.04,
  // Special (each 0.03)
  lifestyle_expat: 0.03,
  retiree_relocator: 0.03,
  diaspora_buyer: 0.03,
  second_home_buyer: 0.03,
  student_parent: 0.03,
  // Fallback
  neutral: 0.37,
};

/** Likelihood at 1.0 (no information) except the overrides. */
function makeLikelihood(overrides: Partial<ArchetypeProbabilities>): ArchetypeProbabilities {
  const baseline = Object.fromEntries(
    ARCHETYPE_NAMES.map((k) => [k, 1.0]),
  ) as ArchetypeProbabilities;
  return { ...baseline, ...overrides };
}

/** Behavioural likelihoods, damped: > 1 favours, < 1 disfavours. */
const SIGNAL_LIKELIHOODS: Record<string, ArchetypeProbabilities> = {
  'scroll.depth': makeLikelihood({ neutral: 0.95 }),
  'listing.viewed': makeLikelihood({
    yield_hunter: 1.08,
    portfolio_builder: 1.1,
    neutral: 0.92,
  }),
  'cta.clicked': makeLikelihood({
    yield_hunter: 1.15,
    flip_investor: 1.12,
    portfolio_builder: 1.1,
    luxury_buyer: 1.08,
    neutral: 0.85,
  }),
  // quiz.event is a no-op at the behavioral layer — quiz prior path is the strong update
  'quiz.event': makeLikelihood({}),
  // High intent; payload boosts live in applyBehavioralSignal().
  'listing.bookmarked': makeLikelihood({ neutral: 0.7 }),
  // device_type.desktop — desktop browsing over-indexes for investor archetypes (FOLLOW-207).
  // Investors typically browse alongside spreadsheets on a wide screen.
  'device_type.desktop': makeLikelihood({
    portfolio_builder: 1.2,
    yield_hunter: 1.2,
    flip_investor: 1.2,
    commercial_investor: 1.2,
    family_buyer: 0.95,
    first_time_buyer: 0.95,
    upsizer: 0.95,
    downsizer: 0.95,
    luxury_buyer: 0.95,
    remote_worker: 0.95,
    lifestyle_expat: 0.95,
    retiree_relocator: 0.95,
    diaspora_buyer: 0.95,
    second_home_buyer: 0.95,
    student_parent: 0.95,
    neutral: 0.95,
    vacation_rental_investor: 0.95,
    golden_visa_buyer: 0.95,
  }),
  // device_type.mobile — mobile browsing over-indexes for own-use archetypes (FOLLOW-207).
  // Own-use buyers "sofa scroll" on mobile while envisioning day-to-day living.
  'device_type.mobile': makeLikelihood({
    family_buyer: 1.2,
    first_time_buyer: 1.2,
    upsizer: 1.2,
    downsizer: 1.2,
    portfolio_builder: 0.95,
    yield_hunter: 0.95,
    flip_investor: 0.95,
    commercial_investor: 0.95,
    luxury_buyer: 0.95,
    remote_worker: 0.95,
    lifestyle_expat: 0.95,
    retiree_relocator: 0.95,
    diaspora_buyer: 0.95,
    second_home_buyer: 0.95,
    student_parent: 0.95,
    neutral: 0.95,
    vacation_rental_investor: 0.95,
    golden_visa_buyer: 0.95,
  }),
  // Lifestyle signal (luxury, second home, expat), damped [FOLLOW-100].
  'photo.dwell': makeLikelihood({
    luxury_buyer: 1.15,
    second_home_buyer: 1.12,
    lifestyle_expat: 1.08,
    neutral: 0.88,
  }),
  // Base neutral push; payload.feature boosts are in applyBehavioralSignal().
  'feature.expanded': makeLikelihood({ neutral: 0.85 }),
  // Own-use financing signal (first-time, family) [FOLLOW-100].
  'mortgage_calc.used': makeLikelihood({
    family_buyer: 1.2,
    first_time_buyer: 1.25,
    upsizer: 1.1,
    neutral: 0.8,
  }),
  // price.compared — opening the price-comparison view across listings. Over-indexes for
  // value-seeking investor archetypes who shop on margin/yield (FOLLOW-100).
  'price.compared': makeLikelihood({
    flip_investor: 1.2,
    yield_hunter: 1.1,
    portfolio_builder: 1.08,
    neutral: 0.85,
  }),
  // General intent, no discriminator: pushes away from neutral [FOLLOW-100].
  'inquiry.started': makeLikelihood({ neutral: 0.7 }),
};

/** Floor for unnamed archetypes, so named ones dominate (§D.1.1) [FOLLOW-100]. */
const CHAT_REST_LIKELIHOOD = 0.05;

/** Named archetypes keep their §D.1.1 value; others get the floor. */
function makeChatLikelihood(overrides: Partial<ArchetypeProbabilities>): ArchetypeProbabilities {
  const baseline = Object.fromEntries(
    ARCHETYPE_NAMES.map((k) => [k, CHAT_REST_LIKELIHOOD]),
  ) as ArchetypeProbabilities;
  return { ...baseline, ...overrides };
}

/** §D.1.1 chat likelihoods keyed "dimension=value", undamped [FOLLOW-087]. */
export const CHAT_INTENT_LIKELIHOODS: Record<string, ArchetypeProbabilities> = {
  'purchase_purpose=investment': makeChatLikelihood({
    yield_hunter: 0.7,
    vacation_rental_investor: 0.6,
    flip_investor: 0.6,
    portfolio_builder: 0.7,
    golden_visa_buyer: 0.5,
    commercial_investor: 0.5,
  }),
  'purchase_purpose=second_home': makeChatLikelihood({
    second_home_buyer: 0.85,
    lifestyle_expat: 0.4,
  }),
  'purchase_purpose=vacation_rental': makeChatLikelihood({
    vacation_rental_investor: 0.9,
  }),
  'purchase_purpose=retirement': makeChatLikelihood({
    retiree_relocator: 0.85,
    downsizer: 0.5,
  }),
  'purchase_purpose=relocation': makeChatLikelihood({
    lifestyle_expat: 0.7,
    remote_worker: 0.6,
    retiree_relocator: 0.4,
  }),
  'cross_border=foreign_buyer': makeChatLikelihood({
    golden_visa_buyer: 0.7,
    lifestyle_expat: 0.6,
    diaspora_buyer: 0.4,
  }),
  'cross_border=expat_returning': makeChatLikelihood({
    diaspora_buyer: 0.85,
  }),
  'family_stage=young_family': makeChatLikelihood({
    family_buyer: 0.8,
    student_parent: 0.4,
  }),
  'family_stage=established_family': makeChatLikelihood({
    family_buyer: 0.7,
    upsizer: 0.5,
  }),
  'family_stage=empty_nester': makeChatLikelihood({
    downsizer: 0.75,
    retiree_relocator: 0.3,
  }),
  'family_stage=retiree': makeChatLikelihood({
    retiree_relocator: 0.85,
    downsizer: 0.6,
  }),
  'finance_complexity=investment_vehicle': makeChatLikelihood({
    yield_hunter: 0.6,
    golden_visa_buyer: 0.6,
    commercial_investor: 0.5,
  }),
  'finance_complexity=standard_mortgage': makeChatLikelihood({
    first_time_buyer: 0.7,
    family_buyer: 0.4,
  }),
  // Decomposed from urgency=0-3mo + purchase_purpose=investment.
  'urgency=0-3mo': makeChatLikelihood({
    flip_investor: 0.6,
    yield_hunter: 0.5,
  }),
  // Compound case `urgency=12mo+ + purchase_purpose=investment` → portfolio_builder:0.7.
  'urgency=12mo+': makeChatLikelihood({
    portfolio_builder: 0.6,
    yield_hunter: 0.5,
  }),
  'geo_priority=school_district': makeChatLikelihood({
    family_buyer: 0.7,
    student_parent: 0.6,
  }),
  'feature_priority=workspace': makeChatLikelihood({
    remote_worker: 0.85,
  }),
  // Compound case `budget_band=comfortable + purchase_purpose=primary` → luxury_buyer:0.6.
  'budget_band=comfortable': makeChatLikelihood({
    luxury_buyer: 0.6,
  }),
  'tax_aware=true': makeChatLikelihood({
    yield_hunter: 0.4,
    golden_visa_buyer: 0.5,
    vacation_rental_investor: 0.4,
  }),
};

/** Behavioural damping (30%); exported for the drift gate [FOLLOW-331]. */
export const BEHAVIORAL_DAMPING = 0.3;

// ─── Server-supplied weight overrides (ADR-0012 Ticket C, FOLLOW-268-sdk) ────

/** Per-session intent parameters from `resolveIntentOverrides()`. */
export interface IntentEngineOverrides {
  /** Resolved behavioral damping scalar. Default: BEHAVIORAL_DAMPING (0.3). */
  behavioralDamping: number;
  /** Resolved initial archetype priors (normalized to sum-to-1). Default: BASE_PRIOR. */
  basePrior: ArchetypeProbabilities;
  /** Server rows over SIGNAL_LIKELIHOODS; missing archetypes = 1.0. */
  signalLikelihoods: Record<string, ArchetypeProbabilities>;
}

/**
 * Defaults from module constants, so callers never branch on null.
 * @internal
 */
function defaultOverrides(): IntentEngineOverrides {
  return {
    behavioralDamping: BEHAVIORAL_DAMPING,
    basePrior: { ...BASE_PRIOR },
    signalLikelihoods: { ...SIGNAL_LIKELIHOODS },
  };
}

/**
 * Merge server weights over the defaults (ADR-0012 §3); null weights = default behaviour.
 * @param weights - Parsed IntentWeights from the server, or null on failure.
 * @returns IntentEngineOverrides for this session.
 */
export function resolveIntentOverrides(weights: IntentWeights | null): IntentEngineOverrides {
  if (!weights) return defaultOverrides();

  // ── behavioralDamping ──────────────────────────────────────────────────────
  const behavioralDamping = weights.behavioral_damping ?? BEHAVIORAL_DAMPING;

  // Merge over BASE_PRIOR, then normalise: no collapse on partial overrides (ADR-0012).
  let basePrior: ArchetypeProbabilities;
  if (weights.priors && Object.keys(weights.priors).length > 0) {
    const merged = { ...BASE_PRIOR };
    for (const [k, v] of Object.entries(weights.priors)) {
      if (k in merged) {
        (merged as Record<string, number>)[k] = v;
      }
    }
    basePrior = normalize(merged);
  } else {
    basePrior = { ...BASE_PRIOR };
  }

  // Server rows over SDK defaults; missing archetypes = 1.0.
  let signalLikelihoods: Record<string, ArchetypeProbabilities>;
  if (weights.signal_likelihoods && Object.keys(weights.signal_likelihoods).length > 0) {
    signalLikelihoods = { ...SIGNAL_LIKELIHOODS };
    for (const [signalKey, archRow] of Object.entries(weights.signal_likelihoods)) {
      // Build a full archetype row: start from 1.0 baseline (no-information),
      // then overlay the server-supplied per-archetype values.
      const baselineRow = Object.fromEntries(ARCHETYPE_NAMES.map((k) => [k, 1.0]));
      for (const [archKey, archVal] of Object.entries(archRow)) {
        baselineRow[archKey] = archVal;
      }
      signalLikelihoods[signalKey] = baselineRow as ArchetypeProbabilities;
    }
  } else {
    signalLikelihoods = { ...SIGNAL_LIKELIHOODS };
  }

  return { behavioralDamping, basePrior, signalLikelihoods };
}

/**
 * How the buyer closed the quiz's result screen (§E.4.4 v3.0): `completed` = leaf reached, not
 * confirmed (incl. × / no confirmation step); `corrected` = the leaf passed is the correction.
 */
export type QuizEvidence = 'completed' | 'confirmed' | 'corrected';

/** Leaf mass of an unconfirmed quiz result; the rest share 0.28 / 17 (§E.4.4) [FOLLOW-1359]. */
const QUIZ_COMPLETED_MASS = 0.72;

/** Leaf mass of a confirmed or corrected quiz result; the rest share 0.10 / 17 [FOLLOW-1359]. */
const QUIZ_CONFIRMED_MASS = 0.9;

/** Cromwell floor per archetype when a confirmed leaf renormalises the rest [FOLLOW-1359]. */
const QUIZ_PROB_FLOOR = 0.005;

/** Chat likelihoods are raised to τ while the quiz leaf is confirmed (§E.4.4) [FOLLOW-1359]. */
const CHAT_CONFIRMED_TAU = 0.5;

/**
 * Chat-fold confidence multiplier, ONLY in a session without a quiz (capped at 1.0) — CEO decision
 * Q-G; AC(8) G-04 rests on it: 0.553 × 1.2 [FOLLOW-1359].
 */
const CHAT_ONLY_CONFIDENCE_SCALE = 1.2;

/** Uniform probability per archetype = 1 / 18. */
const UNIFORM_PROB = 1 / ARCHETYPE_NAMES.length;

// ─── Mismatch detection constants ────────────────────────────────────────────

/** Minimum behavioral signals required before a mismatch can be reported. */
const MISMATCH_MIN_SIGNALS = 3;

/** Opposing group probability threshold to flag a mismatch. */
const MISMATCH_OPPOSING_THRESHOLD = 0.4;

/** Confidence gap threshold — behavioral top confidence vs quiz archetype probability. */
const MISMATCH_GAP_THRESHOLD = 0.3;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function isFiniteProbs(probs: ArchetypeProbabilities): boolean {
  return ARCHETYPE_NAMES.every((k) => Number.isFinite(probs[k]));
}

function uniform(): ArchetypeProbabilities {
  return Object.fromEntries(
    ARCHETYPE_NAMES.map((k) => [k, UNIFORM_PROB]),
  ) as ArchetypeProbabilities;
}

function applyLikelihood(
  prior: ArchetypeProbabilities,
  likelihood: ArchetypeProbabilities,
): ArchetypeProbabilities {
  const product = Object.fromEntries(
    ARCHETYPE_NAMES.map((k) => [k, prior[k] * likelihood[k]]),
  ) as ArchetypeProbabilities;
  return normalize(product);
}

/** Bookkeeping every rebuild must carry, so no evidence counts twice (Rule R) [FOLLOW-1306]. */
function carry(state: IntentState): IntentState {
  const kept = { ...state };
  delete kept.chat_mismatch;
  return kept;
}

/**
 * The one rebuild for every behavioural recompute site: a confirmed leaf keeps its mass and the
 * rest is renormalised (floored at QUIZ_PROB_FLOOR); confidence = the posterior, no bonus
 * (§E.4.4 v3.0) [FOLLOW-1359].
 * @param signals - Added to `signal_count` (1 for a counted behavioural event, else 0).
 * @param hold    - Hysteresis + quiz stickiness against the current archetype (false = cold path).
 */
function rebuild(
  state: IntentState,
  probabilities: ArchetypeProbabilities,
  signals: number,
  hold = true,
): IntentState {
  if (state.quiz_confirmed) {
    const leaf = state.archetype;
    const others = ARCHETYPE_NAMES.length - 1;
    // The leaf keeps its mass, up to 1 − 17 × floor (0.915) so every other archetype keeps the floor.
    const mass = Math.min(state.probabilities[leaf], 1 - others * QUIZ_PROB_FLOOR);
    let rest = 0;
    for (const k of ARCHETYPE_NAMES) if (k !== leaf) rest += probabilities[k];
    probabilities = Object.fromEntries(
      ARCHETYPE_NAMES.map((k) => [
        k,
        k === leaf
          ? mass
          : QUIZ_PROB_FLOOR +
            ((1 - mass - others * QUIZ_PROB_FLOOR) * probabilities[k]) / (rest || 1),
      ]),
    ) as ArchetypeProbabilities;
  }
  const { archetype, confidence } = classifyFromProbabilities(
    probabilities,
    hold ? state.archetype : undefined,
    state.quiz_answered,
  );
  return {
    ...carry(state),
    archetype,
    confidence,
    probabilities,
    signal_count: state.signal_count + signals,
    last_updated_at: Date.now(),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Normalise to 1.0; degenerate input → uniform. */
export function normalize(probs: ArchetypeProbabilities): ArchetypeProbabilities {
  if (!isFiniteProbs(probs)) return uniform();
  let sum = 0;
  for (const k of ARCHETYPE_NAMES) {
    sum += Math.max(0, probs[k]);
  }
  if (sum <= 0 || !Number.isFinite(sum)) return uniform();
  return Object.fromEntries(
    ARCHETYPE_NAMES.map((k) => [k, Math.max(0, probs[k]) / sum]),
  ) as ArchetypeProbabilities;
}

/**
 * Archetype + confidence from a distribution; 'neutral' wins ties, hysteresis via currentArchetype
 * [FOLLOW-363].
 * @param probs            - Normalized posterior distribution.
 * @param currentArchetype - The current archetype; omit only on cold-start/one-shot paths.
 */
function classifyFromProbabilities(
  probs: ArchetypeProbabilities,
  currentArchetype?: Archetype,
  quizAnswered = false,
): {
  archetype: Archetype;
  confidence: number;
} {
  let archetype: Archetype = 'neutral';
  let maxProb = probs.neutral;
  for (const k of ARCHETYPE_NAMES) {
    if (probs[k] > maxProb) {
      archetype = k;
      maxProb = probs[k];
    }
  }

  // Hysteresis: hold the current archetype unless the new leader exceeds it by SWITCH_MARGIN.
  if (
    currentArchetype !== undefined &&
    archetype !== currentArchetype &&
    probs[archetype] - probs[currentArchetype] < SWITCH_MARGIN
  ) {
    archetype = currentArchetype;
    maxProb = probs[currentArchetype];
  }

  // A neutral-led drift must not unseat a quiz archetype (§D.6, ADR-0014) [FOLLOW-344].
  if (
    quizAnswered &&
    archetype === 'neutral' &&
    currentArchetype !== undefined &&
    currentArchetype !== 'neutral'
  ) {
    archetype = currentArchetype;
    maxProb = probs[currentArchetype];
  }

  return { archetype, confidence: maxProb };
}

/**
 * Initial state from BASE_PRIOR or `overrides.basePrior`.
 * @param overrides - Resolved session-level overrides from `resolveIntentOverrides()`, or undefined.
 */
export function initIntentState(overrides?: IntentEngineOverrides): IntentState {
  const probabilities = overrides ? { ...overrides.basePrior } : { ...BASE_PRIOR };
  const { archetype, confidence } = classifyFromProbabilities(probabilities);
  return {
    archetype,
    confidence,
    probabilities,
    signal_count: 0,
    last_updated_at: Date.now(),
    quiz_answered: false,
  };
}

/** Facet-conditional boosts for `filter.applied` (Master Design C.1) [FOLLOW-211]. */
function applyFilterBoosts(
  probs: ArchetypeProbabilities,
  facet: string,
  value?: unknown,
): ArchetypeProbabilities {
  const boosted = { ...probs };

  if (facet === 'commercial') {
    boosted.commercial_investor += 0.15;
  } else if (facet === 'investment_yield') {
    boosted.yield_hunter += 0.12;
    boosted.portfolio_builder += 0.08;
  } else if (facet === 'bedrooms') {
    const numValue = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numValue) && numValue >= 3) {
      boosted.family_buyer += 0.1;
    }
  } else if (facet === 'renovation') {
    // FOLLOW-100: any renovation filter is a fixer-upper / value-add signal.
    boosted.flip_investor += 0.15;
  } else if (facet === 'type') {
    // FOLLOW-100: holiday/vacation property type → short-term-rental investor.
    const strValue = typeof value === 'string' ? value.toLowerCase() : '';
    if (strValue === 'holiday' || strValue === 'vacation') {
      boosted.vacation_rental_investor += 0.18;
    }
  } else if (facet === 'price_max') {
    // FOLLOW-100: a low price ceiling indicates a budget-constrained first-time buyer.
    // Accepts a numeric threshold (≤ 300_000) or the explicit string 'low'.
    const isLowString = typeof value === 'string' && value.toLowerCase() === 'low';
    const numValue = typeof value === 'number' ? value : Number(value);
    if (isLowString || (Number.isFinite(numValue) && numValue <= 300_000)) {
      boosted.first_time_buyer += 0.12;
    }
  } else if (facet === 'bedrooms_min') {
    // FOLLOW-100: a high bedroom floor (≥ 4) indicates a household needing more space.
    const numValue = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numValue) && numValue >= 4) {
      boosted.upsizer += 0.12;
    }
  } else if (facet === 'bedrooms_max') {
    // FOLLOW-100: a low bedroom ceiling (≤ 2) indicates someone scaling down.
    const numValue = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numValue) && numValue <= 2) {
      boosted.downsizer += 0.12;
    }
  } else if (facet === 'near_university' || facet === 'school_district') {
    // FOLLOW-100: proximity-to-education filters → student-parent and family buyers.
    boosted.student_parent += 0.15;
    boosted.family_buyer += 0.08;
  }
  // price_range → no archetype-specific boost
  // all other facets → no boost

  return normalize(boosted);
}

/**
 * Update intent state from a behavioural event; unknown events return the same reference.
 * @param state     - Current intent state.
 * @param eventType - The behavioral event type string.
 * @param payload   - Optional event payload (used by payload-conditional intercepts).
 * @param overrides - Optional session-level weight overrides from `resolveIntentOverrides()`.
 */
export function applyBehavioralSignal(
  state: IntentState,
  eventType: string,
  payload?: Record<string, unknown>,
  overrides?: IntentEngineOverrides,
): IntentState {
  // Resolve the effective damping and likelihood table for this call.
  const effectiveDamping = overrides ? overrides.behavioralDamping : BEHAVIORAL_DAMPING;
  const effectiveLikelihoods = overrides ? overrides.signalLikelihoods : SIGNAL_LIKELIHOODS;

  // Static neutral push, then payload boosts [FOLLOW-210].
  if (eventType === 'listing.bookmarked') {
    const rawLikelihoodBookmarked = effectiveLikelihoods['listing.bookmarked'];
    // rawLikelihoodBookmarked is always defined (key exists in SIGNAL_LIKELIHOODS above)
    if (!rawLikelihoodBookmarked) return state;

    const dampedLikelihoodBookmarked = Object.fromEntries(
      ARCHETYPE_NAMES.map((k) => [k, 1 + (rawLikelihoodBookmarked[k] - 1) * effectiveDamping]),
    ) as ArchetypeProbabilities;

    // Step 1: apply the static multiplicative likelihood (neutral push)
    let probabilities = applyLikelihood(state.probabilities, dampedLikelihoodBookmarked);

    // Step 2: apply payload-conditional additive boosts
    const bedroomCount =
      typeof payload?.bedroomCount === 'number' ? payload.bedroomCount : undefined;
    const listingType = typeof payload?.listingType === 'string' ? payload.listingType : undefined;

    const boosted = { ...probabilities };
    if (bedroomCount !== undefined && bedroomCount >= 3) {
      boosted.family_buyer += 0.15;
      boosted.upsizer += 0.1;
    }
    if (listingType === 'commercial') {
      boosted.commercial_investor += 0.2;
    }
    probabilities = normalize(boosted);

    return rebuild(state, probabilities, 1);
  }

  // Static neutral push, then payload.feature boosts [FOLLOW-100].
  if (eventType === 'feature.expanded') {
    const rawLikelihoodFeature = effectiveLikelihoods['feature.expanded'];
    // rawLikelihoodFeature is always defined (key exists in SIGNAL_LIKELIHOODS above)
    if (!rawLikelihoodFeature) return state;

    const dampedLikelihoodFeature = Object.fromEntries(
      ARCHETYPE_NAMES.map((k) => [k, 1 + (rawLikelihoodFeature[k] - 1) * effectiveDamping]),
    ) as ArchetypeProbabilities;

    // Step 1: apply the static multiplicative likelihood (neutral push).
    let probabilities = applyLikelihood(state.probabilities, dampedLikelihoodFeature);

    // Step 2: apply payload-conditional multiplicative boosts keyed on payload.feature.
    const feature = typeof payload?.feature === 'string' ? payload.feature.toLowerCase() : '';
    const boosted = { ...probabilities };

    if (feature === 'yield' || feature === 'str' || feature === 'rental_yield') {
      boosted.vacation_rental_investor *= 1.3;
      boosted.yield_hunter *= 1.15;
    } else if (feature === 'legal' || feature === 'visa' || feature === 'golden_visa') {
      boosted.golden_visa_buyer *= 1.35;
      boosted.lifestyle_expat *= 1.1;
    } else if (feature === 'home_office' || feature === 'workspace' || feature === 'internet') {
      boosted.remote_worker *= 1.4;
    } else if (feature === 'accessibility') {
      boosted.downsizer *= 1.2;
      boosted.retiree_relocator *= 1.15;
    } else if (feature === 'climate') {
      boosted.retiree_relocator *= 1.2;
      boosted.lifestyle_expat *= 1.1;
    } else if (feature === 'expat' || feature === 'international' || feature === 'foreign') {
      boosted.lifestyle_expat *= 1.3;
      boosted.diaspora_buyer *= 1.15;
    }
    // unrecognized feature → no boost (base neutral-push from step 1 only)

    probabilities = normalize(boosted);
    return rebuild(state, probabilities, 1);
  }

  // Intercept filter.applied before the static SIGNAL_LIKELIHOODS lookup.
  if (eventType === 'filter.applied') {
    const facet = typeof payload?.facet === 'string' ? payload.facet : '';
    if (!facet) return state;

    const probabilities = applyFilterBoosts(state.probabilities, facet, payload?.value);
    return rebuild(state, probabilities, 1);
  }

  const rawLikelihood = effectiveLikelihoods[eventType];
  if (!rawLikelihood) return state;

  const dampedLikelihood = Object.fromEntries(
    ARCHETYPE_NAMES.map((k) => [k, 1 + (rawLikelihood[k] - 1) * effectiveDamping]),
  ) as ArchetypeProbabilities;

  return rebuild(state, applyLikelihood(state.probabilities, dampedLikelihood), 1);
}

// ─── Mismatch detection ───────────────────────────────────────────────────────

/** Mismatch event — logged when quiz answers contradict behavioral signals. */
export interface MismatchEvent {
  session_id: string;
  quiz_archetype: Archetype;
  behavioral_archetype: Archetype;
  /** behavioral top-archetype confidence minus quiz archetype's behavioral probability. */
  confidence_gap: number;
  signal_count: number;
  ts: number;
}

/** Quiz vs behaviour contradiction; needs ≥3 signals. */
export function detectMismatch(
  quizArchetype: Archetype,
  behavioralState: IntentState,
  sessionId: string,
): MismatchEvent | null {
  if (behavioralState.signal_count < MISMATCH_MIN_SIGNALS) return null;
  // Never a drift to `neutral` (BASE_PRIOR leads with it) — §E.4.5 v3.0 [FOLLOW-1359].
  if (quizArchetype === behavioralState.archetype || behavioralState.archetype === 'neutral') {
    return null;
  }

  const probs = behavioralState.probabilities;
  const quizArchetypeProb = probs[quizArchetype];
  const behavioralConfidence = behavioralState.confidence;
  const confidence_gap = behavioralConfidence - quizArchetypeProb;

  const quizIsInvestor = INVESTOR_ARCHETYPES.has(quizArchetype);
  const quizIsOwnUse = OWN_USE_ARCHETYPES.has(quizArchetype);

  let investorGroupProb = 0;
  let ownUseGroupProb = 0;
  for (const a of INVESTOR_ARCHETYPES) {
    investorGroupProb += probs[a];
  }
  for (const a of OWN_USE_ARCHETYPES) {
    ownUseGroupProb += probs[a];
  }

  const opposingArchetypeHigh =
    (quizIsInvestor && ownUseGroupProb > MISMATCH_OPPOSING_THRESHOLD) ||
    (quizIsOwnUse && investorGroupProb > MISMATCH_OPPOSING_THRESHOLD);

  const gapHigh = confidence_gap > MISMATCH_GAP_THRESHOLD;

  if (!opposingArchetypeHigh && !gapHigh) return null;

  return {
    session_id: sessionId,
    quiz_archetype: quizArchetype,
    behavioral_archetype: behavioralState.archetype,
    confidence_gap,
    signal_count: behavioralState.signal_count,
    ts: Date.now(),
  };
}

/**
 * v3.0 quiz fold (§E.4.4): the leaf at 0.72 (`completed`) or 0.90 (`confirmed` / `corrected`), the
 * rest share the remainder equally (both above QUIZ_PROB_FLOOR); confidence = the leaf's posterior.
 * A `neutral` leaf sets `quiz_answered` and pins nothing [FOLLOW-1359].
 * @param state     - Current intent state (signal_count is preserved).
 * @param archetype - The leaf; for `corrected`, the archetype the buyer corrected to.
 * @param evidence  - How the result screen closed.
 */
export function applyQuizLeaf(
  state: IntentState,
  archetype: Archetype,
  evidence: QuizEvidence = 'completed',
): IntentState {
  if (archetype === 'neutral') {
    return { ...carry(state), last_updated_at: Date.now(), quiz_answered: true };
  }
  const mass = evidence === 'completed' ? QUIZ_COMPLETED_MASS : QUIZ_CONFIRMED_MASS;
  const probabilities = Object.fromEntries(
    ARCHETYPE_NAMES.map((k) => [
      k,
      k === archetype ? mass : (1 - mass) / (ARCHETYPE_NAMES.length - 1),
    ]),
  ) as ArchetypeProbabilities;

  return {
    ...carry(state),
    archetype,
    confidence: mass,
    probabilities,
    last_updated_at: Date.now(),
    quiz_answered: true,
    quiz_confirmed: evidence !== 'completed',
  };
}

/**
 * Sustained behavioural drift re-pins the candidate at the `completed` mass, marked
 * `source: 'drift'`; the caller never passes `neutral` nor a confirmed state (§E.4.5) [FOLLOW-1359].
 */
export function applyDriftCandidate(state: IntentState, candidate: Archetype): IntentState {
  return { ...applyQuizLeaf(state, candidate), source: 'drift' };
}

/**
 * Fold chat dimensions (§D.1.1) once per message; the caller's watermark dedupes [FOLLOW-1024].
 * @param state            - Current intent state (typically post-quiz).
 * @param intentDimensions - Flat chat-intent dimension → value map.
 */
export function applyChatIntentPrior(
  state: IntentState,
  intentDimensions: Record<string, string>,
): IntentState {
  const entries = Object.entries(intentDimensions);
  if (entries.length === 0) return state;

  let probabilities = state.probabilities;
  let matched = false;

  for (const [dimension, value] of entries) {
    const likelihood = CHAT_INTENT_LIKELIHOODS[`${dimension}=${value}`];
    if (!likelihood) continue;
    // Multiplicative, NOT damped (§D.7); tempered by τ while the quiz leaf is confirmed (§E.4.4).
    probabilities = applyLikelihood(
      probabilities,
      state.quiz_confirmed
        ? (Object.fromEntries(
            ARCHETYPE_NAMES.map((k) => [k, likelihood[k] ** CHAT_CONFIRMED_TAU]),
          ) as ArchetypeProbabilities)
        : likelihood,
    );
    matched = true;
  }

  // No dimension matched a known entry → distribution unchanged; return original reference.
  if (!matched) return state;

  const quizArchetypeBefore = state.archetype;
  // Hysteresis + quiz stickiness on every message [FOLLOW-1024].
  const { archetype, confidence: rawConfidence } = classifyFromProbabilities(
    probabilities,
    state.archetype,
    state.quiz_answered,
  );
  // The ×1.2 only without a quiz (CEO decision Q-G); after a quiz, the posterior [FOLLOW-1359].
  const confidence = state.quiz_answered
    ? rawConfidence
    : Math.min(rawConfidence * CHAT_ONLY_CONFIDENCE_SCALE, 1.0);

  // Confident chat leader vs the quiz archetype's updated probability.
  let chat_mismatch: { quiz_archetype: Archetype; chat_archetype: Archetype } | undefined;
  if (
    confidence > 0.7 &&
    state.quiz_answered &&
    archetype !== quizArchetypeBefore &&
    probabilities[archetype] - probabilities[quizArchetypeBefore] > MISMATCH_GAP_THRESHOLD
  ) {
    chat_mismatch = { quiz_archetype: quizArchetypeBefore, chat_archetype: archetype };
  }

  return {
    ...carry(state),
    archetype,
    confidence,
    probabilities,
    last_updated_at: Date.now(),
    ...(chat_mismatch !== undefined ? { chat_mismatch } : {}),
  };
}

/** Behavioural-only state from BASE_PRIOR. */
export function calculateBehavioralOnlyState(
  signalHistory: { eventType: string; payload?: Record<string, unknown> }[],
): IntentState {
  let state = initIntentState();
  for (const signal of signalHistory) {
    state = applyBehavioralSignal(state, signal.eventType, signal.payload);
  }
  return state;
}

// ─── Referrer hint priors (FOLLOW-207) ───────────────────────────────────────

/** Investment keywords in referrer / UTM term. */
const INVESTMENT_KEYWORDS = ['investment', 'rental', 'yield', 'inwestycja', 'wynajem'] as const;

/** Own-use keywords in referrer / UTM term. */
const OWN_USE_KEYWORDS = ['family', 'apartment', 'mieszkanie', 'dom'] as const;

/**
 * Referrer + UTM term as weak cold-session priors [FOLLOW-207].
 * @param state    - Current intent state (typically the result of `initIntentState()`).
 * @param referrer - `document.referrer` value (may be empty string).
 * @param utmTerm  - Value of the `utm_term` query parameter (may be empty string).
 */
export function applyReferrerHints(
  state: IntentState,
  referrer: string,
  utmTerm: string,
): IntentState {
  const haystack = `${referrer} ${utmTerm}`.toLowerCase();

  const hasInvestment = INVESTMENT_KEYWORDS.some((kw) => haystack.includes(kw));
  const hasOwnUse = OWN_USE_KEYWORDS.some((kw) => haystack.includes(kw));

  // No matching keywords — return state unchanged (no-op, same reference).
  if (!hasInvestment && !hasOwnUse) return state;

  const boosted = { ...state.probabilities };

  if (hasInvestment) {
    boosted.portfolio_builder += 0.05;
    boosted.yield_hunter += 0.04;
    boosted.commercial_investor += 0.03;
  }

  if (hasOwnUse) {
    boosted.family_buyer += 0.05;
    boosted.first_time_buyer += 0.03;
  }

  // Cold-session path: no hysteresis against the current archetype.
  return rebuild(state, normalize(boosted), 0, false);
}

// ─── Listing-view rate signal (FOLLOW-208) ────────────────────────────────────

/**
 * Listing views per minute as an investor/own-use discriminator; pure.
 * @param state     - Current intent state.
 * @param viewCount - Total listing views recorded this session.
 * @param elapsedMs - Milliseconds elapsed since session start (must be > 0).
 */
export function applyListingViewRate(
  state: IntentState,
  viewCount: number,
  elapsedMs: number,
): IntentState {
  // Guard: first view is baseline — need at least two views for a meaningful rate.
  if (viewCount < 2) return state;
  // Guard: avoid division by zero / negative elapsed time.
  if (elapsedMs <= 0) return state;

  const rate = viewCount / (elapsedMs / 60_000);

  let rateBoost: ArchetypeProbabilities | null = null;

  if (rate >= 3) {
    // High-velocity browsing: investor/comparison-shopper signal.
    rateBoost = { ...state.probabilities };
    rateBoost.portfolio_builder += 0.12;
    rateBoost.flip_investor += 0.08;
    // Floor neutral at 0 before normalize handles renormalization.
    rateBoost.neutral = Math.max(0, rateBoost.neutral - 0.1);
  } else if (rate <= 0.5) {
    // Slow, deliberate browsing: own-use buyer signal.
    rateBoost = { ...state.probabilities };
    rateBoost.family_buyer += 0.06;
    rateBoost.first_time_buyer += 0.06;
    rateBoost.upsizer += 0.04;
  }

  // No matching bracket → return state unchanged (same reference).
  if (!rateBoost) return state;

  // Guarded: runs on every view [FOLLOW-363].
  return rebuild(state, normalize(rateBoost), 0);
}

// ─── Dwell-time confidence boost (FOLLOW-190, capped in FOLLOW-227) ───────────

/** Base boost magnitude for a single dwell-time threshold tick (FOLLOW-190). */
export const DWELL_BASE_BOOST = 0.08;

/** Unit of elapsed time used as the log2 denominator in applyDwellSignal (ms). */
export const DWELL_UNIT_MS = 30_000;

/** Max dwell ticks per session, enforced via `dwell_ticks_applied` (Rule R) [FOLLOW-227]. */
export const DWELL_MAX_SESSION_CONTRIBUTION = 3 as const;

/**
 * Dwell boost to the leader; the caller checks the session cap first [FOLLOW-190].
 * @returns Same state reference when archetype==="neutral", elapsed_ms<=0, or boost<=1.
 */
export function applyDwellSignal(state: IntentState, elapsed_ms: number): IntentState {
  if (state.archetype === 'neutral') return state;
  if (elapsed_ms <= 0) return state;
  const boost = 1 + DWELL_BASE_BOOST * Math.log2(elapsed_ms / DWELL_UNIT_MS);
  if (boost <= 1) return state;
  const likelihood = Object.fromEntries(
    ARCHETYPE_NAMES.map((k) => [k, k === state.archetype ? boost : 1.0]),
  ) as ArchetypeProbabilities;
  // Guarded: runs on every dwell tick [FOLLOW-363].
  return {
    ...rebuild(state, applyLikelihood(state.probabilities, likelihood), 0),
    // Increment the tick counter so the persisted envelope carries the correct
    // count into the next listing page (Rule R idempotency — FOLLOW-227).
    dwell_ticks_applied: (state.dwell_ticks_applied ?? 0) + 1,
  };
}
