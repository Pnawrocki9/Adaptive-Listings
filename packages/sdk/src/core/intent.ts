/**
 * Intent Engine — Bayesian archetype classifier.
 *
 * Archetypes: 18 fine-grained buyer/investor personas
 *
 * Prior sources (in decreasing strength):
 *   1. Quiz answers (explicit self-declaration, full likelihood applied)
 *   2. Behavioral signals (implicit, multiplied by BEHAVIORAL_DAMPING)
 *      - Scroll depth, listing views, CTA clicks, etc.
 *
 * Decay: probabilities move toward the uniform distribution (1/18 each) at the
 * configured rate per minute. Without new evidence the classifier loses
 * confidence and returns to neutral over time.
 *
 * All public functions are pure: they return a new state without mutating
 * the input. Functions never throw — degenerate input (NaN, zero sum) is
 * sanitized to the uniform distribution.
 *
 * @module @estalara/sdk/core/intent
 */

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
  /** 0.0 – 1.0. With quiz_answered=true, this includes the QUIZ_CONFIDENCE_BONUS (capped at 1.0). */
  confidence: number;
  probabilities: ArchetypeProbabilities;
  /** Count of behavioral signals processed (known event types only). */
  signal_count: number;
  /** Unix ms timestamp of the last update. */
  last_updated_at: number;
  quiz_answered: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Base prior — before any evidence is observed.
 *
 * Distribution rationale:
 *   6 investor archetypes × 0.04 = 0.24
 *   6 own-use archetypes  × 0.04 = 0.24
 *   5 special archetypes  × 0.03 = 0.15
 *   neutral                       = 0.37 (default before signals)
 *   Total                         = 1.00
 */
const BASE_PRIOR: ArchetypeProbabilities = {
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

/** Quiz answer likelihoods — P(answer | archetype). */
const QUIZ_LIKELIHOODS = {
  purpose_investment: {
    yield_hunter: 0.8,
    vacation_rental_investor: 0.7,
    flip_investor: 0.65,
    portfolio_builder: 0.75,
    golden_visa_buyer: 0.6,
    commercial_investor: 0.55,
    family_buyer: 0.05,
    first_time_buyer: 0.05,
    upsizer: 0.08,
    downsizer: 0.05,
    luxury_buyer: 0.15,
    remote_worker: 0.05,
    lifestyle_expat: 0.1,
    retiree_relocator: 0.08,
    diaspora_buyer: 0.2,
    second_home_buyer: 0.25,
    student_parent: 0.05,
    neutral: 0.1,
  },
  purpose_personal: {
    yield_hunter: 0.05,
    vacation_rental_investor: 0.08,
    flip_investor: 0.05,
    portfolio_builder: 0.05,
    golden_visa_buyer: 0.1,
    commercial_investor: 0.03,
    family_buyer: 0.75,
    first_time_buyer: 0.7,
    upsizer: 0.65,
    downsizer: 0.6,
    luxury_buyer: 0.5,
    remote_worker: 0.55,
    lifestyle_expat: 0.6,
    retiree_relocator: 0.65,
    diaspora_buyer: 0.5,
    second_home_buyer: 0.4,
    student_parent: 0.7,
    neutral: 0.15,
  },
  horizon_short: {
    yield_hunter: 0.55,
    vacation_rental_investor: 0.5,
    flip_investor: 0.8,
    portfolio_builder: 0.45,
    golden_visa_buyer: 0.6,
    commercial_investor: 0.45,
    family_buyer: 0.35,
    first_time_buyer: 0.4,
    upsizer: 0.35,
    downsizer: 0.3,
    luxury_buyer: 0.35,
    remote_worker: 0.5,
    lifestyle_expat: 0.55,
    retiree_relocator: 0.35,
    diaspora_buyer: 0.45,
    second_home_buyer: 0.4,
    student_parent: 0.6,
    neutral: 0.2,
  },
  horizon_long: {
    yield_hunter: 0.6,
    vacation_rental_investor: 0.55,
    flip_investor: 0.2,
    portfolio_builder: 0.7,
    golden_visa_buyer: 0.55,
    commercial_investor: 0.6,
    family_buyer: 0.5,
    first_time_buyer: 0.45,
    upsizer: 0.5,
    downsizer: 0.55,
    luxury_buyer: 0.55,
    remote_worker: 0.4,
    lifestyle_expat: 0.5,
    retiree_relocator: 0.6,
    diaspora_buyer: 0.5,
    second_home_buyer: 0.55,
    student_parent: 0.3,
    neutral: 0.3,
  },
} as const;

/**
 * Build a likelihood object with all archetypes at 1.0 (no information),
 * overriding specific archetypes for targeted behavioral signals.
 */
function makeLikelihood(overrides: Partial<ArchetypeProbabilities>): ArchetypeProbabilities {
  const baseline = Object.fromEntries(
    ARCHETYPE_NAMES.map((k) => [k, 1.0]),
  ) as ArchetypeProbabilities;
  return { ...baseline, ...overrides };
}

/**
 * Behavioral signal likelihoods — multiplicative weights applied (after damping).
 * Values > 1.0 favor the archetype; < 1.0 disfavor it; 1.0 = no information.
 */
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
  // listing.bookmarked — saving a listing = high intent; strongly pushes away from neutral.
  // Payload-conditional boosts (bedroomCount, listingType) are applied additively in
  // applyBehavioralSignal() — they cannot be encoded in a static likelihood table.
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
  // micro_poll.answered — explicit single yes/no intent signal from the micro-poll toast
  // (FOLLOW-209). Payload-conditional boosts are applied in applyBehavioralSignal(); this
  // entry serves as the signal registration so unknown-event-type guard does not short-circuit.
  'micro_poll.answered': makeLikelihood({ neutral: 0.8 }),
};

/** How much to dampen behavioral likelihoods relative to quiz likelihoods. */
const BEHAVIORAL_DAMPING = 0.3;

/** Default decay rate per minute (fraction of distance toward uniform). */
const DEFAULT_DECAY_RATE = 0.02;

/** Confidence multiplier when the quiz has been answered (capped at 1.0). */
const QUIZ_CONFIDENCE_BONUS = 1.2;

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

function withConfidenceBonus(rawConfidence: number, quizAnswered: boolean): number {
  if (!quizAnswered) return rawConfidence;
  return Math.min(rawConfidence * QUIZ_CONFIDENCE_BONUS, 1.0);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalize probabilities to sum to 1.0.
 * Degenerate inputs (NaN, zero sum, negatives) fall back to the uniform distribution.
 */
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
 * Derive archetype and confidence from a probability distribution.
 *
 * Tie-break: 'neutral' wins equal-probability contests so fully-decayed
 * states classify as 'neutral' rather than an arbitrary archetype.
 */
export function classifyFromProbabilities(probs: ArchetypeProbabilities): {
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
  return { archetype, confidence: maxProb };
}

/** Initialize intent state with BASE_PRIOR probabilities. */
export function initIntentState(): IntentState {
  const probabilities = { ...BASE_PRIOR };
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

/**
 * Update intent state from quiz answers (purpose + horizon).
 *
 * Applies the two likelihoods sequentially:
 *   P(A | quiz) ∝ P(purpose | A) × P(horizon | A) × P(A)
 *
 * Sets `quiz_answered = true`, enabling the confidence bonus for all
 * future updates. signal_count is preserved.
 */
export function applyQuizPrior(
  state: IntentState,
  purpose: 'personal' | 'investment',
  horizon: 'short' | 'long',
): IntentState {
  const purposeLikelihood =
    purpose === 'investment'
      ? QUIZ_LIKELIHOODS.purpose_investment
      : QUIZ_LIKELIHOODS.purpose_personal;
  const horizonLikelihood =
    horizon === 'short' ? QUIZ_LIKELIHOODS.horizon_short : QUIZ_LIKELIHOODS.horizon_long;

  let probabilities = applyLikelihood(state.probabilities, purposeLikelihood);
  probabilities = applyLikelihood(probabilities, horizonLikelihood);

  const { archetype, confidence: rawConfidence } = classifyFromProbabilities(probabilities);

  return {
    archetype,
    confidence: withConfidenceBonus(rawConfidence, true),
    probabilities,
    signal_count: state.signal_count,
    last_updated_at: Date.now(),
    quiz_answered: true,
  };
}

/**
 * Facet-conditional intent boosts for `filter.applied`.
 *
 * Returns a new ArchetypeProbabilities with additive boosts applied and
 * re-normalized to sum to 1.0. If the facet does not warrant a targeted
 * boost (e.g. `price_range`), the input probabilities are returned unchanged.
 *
 * Boost values are smaller than quiz likelihoods (behavioral evidence only),
 * consistent with BEHAVIORAL_DAMPING applied on other signal types.
 *
 * Boost rules (Master Design C.1 + FOLLOW-211 spec):
 *   commercial        → commercial_investor +0.15
 *   investment_yield  → yield_hunter +0.12, portfolio_builder +0.08
 *   bedrooms ≥ 3      → family_buyer +0.10
 *   price_range       → no archetype-specific boost (generic signal)
 *   all other facets  → no boost (ignored)
 */
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
  }
  // price_range → no archetype-specific boost
  // all other facets → no boost

  return normalize(boosted);
}

/**
 * Update intent state from a behavioral event.
 *
 * For `filter.applied`, facet-conditional additive boosts are applied directly
 * to the probability distribution (see `applyFilterBoosts`). This path bypasses
 * the multiplicative SIGNAL_LIKELIHOODS table because the boost magnitude depends
 * on runtime payload values that cannot be encoded in a static table.
 *
 * For all other known event types, the raw signal likelihood from
 * SIGNAL_LIKELIHOODS is dampened by BEHAVIORAL_DAMPING (0.3) and applied
 * multiplicatively. Unknown event types return the state unchanged (same
 * reference, signal_count is NOT incremented).
 */
export function applyBehavioralSignal(
  state: IntentState,
  eventType: string,
  payload?: Record<string, unknown>,
): IntentState {
  // Intercept listing.bookmarked before the static SIGNAL_LIKELIHOODS lookup.
  // The static table handles the neutral→0.70 push; here we apply payload-conditional additive
  // boosts on top of the multiplicative update (FOLLOW-210 spec step 3).
  if (eventType === 'listing.bookmarked') {
    const rawLikelihoodBookmarked = SIGNAL_LIKELIHOODS['listing.bookmarked'];
    // rawLikelihoodBookmarked is always defined (key exists in SIGNAL_LIKELIHOODS above)
    if (!rawLikelihoodBookmarked) return state;

    const dampedLikelihoodBookmarked = Object.fromEntries(
      ARCHETYPE_NAMES.map((k) => [k, 1 + (rawLikelihoodBookmarked[k] - 1) * BEHAVIORAL_DAMPING]),
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

    const { archetype, confidence: rawConfidence } = classifyFromProbabilities(probabilities);
    return {
      archetype,
      confidence: withConfidenceBonus(rawConfidence, state.quiz_answered),
      probabilities,
      signal_count: state.signal_count + 1,
      last_updated_at: Date.now(),
      quiz_answered: state.quiz_answered,
    };
  }

  // Intercept micro_poll.answered before the static SIGNAL_LIKELIHOODS lookup (FOLLOW-209).
  // Applies question-and-answer-conditional multiplicative boosts on top of the static
  // neutral-push entry. Bypasses the generic damped-likelihood path because boost magnitude
  // depends on payload values that cannot be encoded in the static table.
  if (eventType === 'micro_poll.answered') {
    const question = typeof payload?.question === 'string' ? payload.question : '';
    const answer = payload?.answer === 'yes' || payload?.answer === 'no' ? payload.answer : null;
    if (!question || !answer) return state;

    const boosted = { ...state.probabilities };

    if (question === 'purpose_investment') {
      if (answer === 'yes') {
        // Yes → investment intent: boost investor archetypes
        boosted.portfolio_builder *= 1.2;
        boosted.flip_investor *= 1.2;
        boosted.yield_hunter *= 1.2;
      } else {
        // No → personal use: boost own-use archetypes
        boosted.family_buyer *= 1.1;
        boosted.first_time_buyer *= 1.1;
        boosted.upsizer *= 1.1;
      }
    } else if (question === 'family_buyer' && answer === 'yes') {
      boosted.family_buyer *= 1.25;
    } else if (question === 'vacation_rental_investor' && answer === 'yes') {
      boosted.vacation_rental_investor *= 1.3;
    }

    const probabilities = normalize(boosted);
    const { archetype, confidence: rawConfidence } = classifyFromProbabilities(probabilities);

    return {
      archetype,
      confidence: withConfidenceBonus(rawConfidence, state.quiz_answered),
      probabilities,
      signal_count: state.signal_count + 1,
      last_updated_at: Date.now(),
      quiz_answered: state.quiz_answered,
    };
  }

  // Intercept filter.applied before the static SIGNAL_LIKELIHOODS lookup.
  if (eventType === 'filter.applied') {
    const facet = typeof payload?.facet === 'string' ? payload.facet : '';
    if (!facet) return state;

    const probabilities = applyFilterBoosts(state.probabilities, facet, payload?.value);
    const { archetype, confidence: rawConfidence } = classifyFromProbabilities(probabilities);

    return {
      archetype,
      confidence: withConfidenceBonus(rawConfidence, state.quiz_answered),
      probabilities,
      signal_count: state.signal_count + 1,
      last_updated_at: Date.now(),
      quiz_answered: state.quiz_answered,
    };
  }

  const rawLikelihood = SIGNAL_LIKELIHOODS[eventType];
  if (!rawLikelihood) return state;

  const dampedLikelihood = Object.fromEntries(
    ARCHETYPE_NAMES.map((k) => [k, 1 + (rawLikelihood[k] - 1) * BEHAVIORAL_DAMPING]),
  ) as ArchetypeProbabilities;

  const probabilities = applyLikelihood(state.probabilities, dampedLikelihood);
  const { archetype, confidence: rawConfidence } = classifyFromProbabilities(probabilities);

  return {
    archetype,
    confidence: withConfidenceBonus(rawConfidence, state.quiz_answered),
    probabilities,
    signal_count: state.signal_count + 1,
    last_updated_at: Date.now(),
    quiz_answered: state.quiz_answered,
  };
}

/**
 * Apply temporal decay toward the uniform distribution.
 *
 * decayFactor = clamp(decayRate × elapsedMinutes, 0, 1)
 * Each probability is linearly interpolated toward UNIFORM_PROB by decayFactor.
 *
 * elapsedMs <= 0 returns the state unchanged.
 */
export function applyDecay(
  state: IntentState,
  elapsedMs: number,
  decayRate: number = DEFAULT_DECAY_RATE,
): IntentState {
  if (elapsedMs <= 0) return state;

  const elapsedMin = elapsedMs / 60_000;
  const rawFactor = decayRate * elapsedMin;
  const decayFactor = Math.min(Math.max(rawFactor, 0), 1);
  const keep = 1 - decayFactor;

  const decayed = Object.fromEntries(
    ARCHETYPE_NAMES.map((k) => [k, state.probabilities[k] * keep + UNIFORM_PROB * decayFactor]),
  ) as ArchetypeProbabilities;

  const probabilities = normalize(decayed);
  const { archetype, confidence: rawConfidence } = classifyFromProbabilities(probabilities);

  return {
    archetype,
    confidence: withConfidenceBonus(rawConfidence, state.quiz_answered),
    probabilities,
    signal_count: state.signal_count,
    last_updated_at: Date.now(),
    quiz_answered: state.quiz_answered,
  };
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

/**
 * Detect if quiz-declared archetype contradicts behavioral signals.
 *
 * Returns null when:
 *   - signal_count < 3 (insufficient evidence)
 *   - quiz and behavioral archetypes agree
 *
 * Mismatch fires when:
 *   1. Quiz says investor group but behavioral signals favour own-use group (sum > 0.4)
 *   2. Quiz says own-use group but behavioral signals favour investor group (sum > 0.4)
 *   3. Confidence gap (behavioral_confidence − quiz_archetype_prob) > 0.3
 */
export function detectMismatch(
  quizArchetype: Archetype,
  behavioralState: IntentState,
  sessionId: string,
): MismatchEvent | null {
  if (behavioralState.signal_count < MISMATCH_MIN_SIGNALS) return null;
  if (quizArchetype === behavioralState.archetype) return null;

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
 * Update intent state from a v2 quiz leaf resolution (direct archetype assignment).
 *
 * Called by quiz-widget v2.0 on leaf resolution. Sets the target archetype to 0.85
 * probability; all others share the remaining 0.15 uniformly. Confidence is capped
 * at 1.0 and includes the QUIZ_CONFIDENCE_BONUS. quiz_answered is set to true.
 *
 * applyQuizPrior() is preserved as the legacy fallback for the old 2-question flat quiz.
 *
 * @param state - Current intent state (signal_count and last_updated_at are preserved).
 * @param archetype - The leaf archetype resolved by the decision tree.
 */
export function applyQuizLeaf(state: IntentState, archetype: Archetype): IntentState {
  const leafProb = 0.85;
  const otherCount = ARCHETYPE_NAMES.length - 1;
  const otherProb = 0.15 / otherCount;

  const probabilities = Object.fromEntries(
    ARCHETYPE_NAMES.map((k) => [k, k === archetype ? leafProb : otherProb]),
  ) as ArchetypeProbabilities;

  return {
    archetype,
    confidence: Math.min(0.85 * QUIZ_CONFIDENCE_BONUS, 1.0),
    probabilities,
    signal_count: state.signal_count,
    last_updated_at: Date.now(),
    quiz_answered: true,
  };
}

/**
 * Calculate behavioral-only intent state from a signal history.
 * Starts from BASE_PRIOR and applies only behavioral signals — no quiz prior.
 */
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

/**
 * Investment-intent keywords matched against the full referrer URL and UTM term.
 * A match boosts investor archetypes by weak additive priors.
 */
const INVESTMENT_KEYWORDS = ['investment', 'rental', 'yield', 'inwestycja', 'wynajem'] as const;

/**
 * Own-use-intent keywords matched against the full referrer URL and UTM term.
 * A match boosts own-use archetypes by weak additive priors.
 */
const OWN_USE_KEYWORDS = ['family', 'apartment', 'mieszkanie', 'dom'] as const;

/**
 * Apply referrer URL + UTM term as cold-session intent priors (FOLLOW-207).
 *
 * Rules:
 *   - Investment keywords in `referrer` OR `utmTerm` → portfolio_builder +0.05,
 *     yield_hunter +0.04, commercial_investor +0.03
 *   - Own-use keywords in `referrer` OR `utmTerm` → family_buyer +0.05,
 *     first_time_buyer +0.03
 *   - No matching keywords → return `state` unchanged (same reference)
 *   - When both groups match, both sets of boosts are applied simultaneously
 *   - Result is always renormalized so probabilities sum to 1.0
 *
 * This is a pure function — the input `state` is never mutated.
 * `signal_count` and `quiz_answered` are preserved unchanged.
 *
 * @param state  - Current intent state (typically the result of `initIntentState()`).
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

  const probabilities = normalize(boosted);
  const { archetype, confidence: rawConfidence } = classifyFromProbabilities(probabilities);

  return {
    archetype,
    confidence: withConfidenceBonus(rawConfidence, state.quiz_answered),
    probabilities,
    signal_count: state.signal_count,
    last_updated_at: Date.now(),
    quiz_answered: state.quiz_answered,
  };
}

// ─── Archetype hint priors (TICKET-AUTO-007) ─────────────────────────────────

/**
 * Maximum aggregate boost summed across all hints for a single archetype.
 *
 * Mirrors the cap enforced by `extractArchetypeHints` in `@estalara/sdk/auto-detect`
 * so the Intent Engine never overcommits to a site-level prior — behavioral and quiz
 * evidence must remain able to dominate.
 */
const HINT_MAX_BOOST_PER_ARCHETYPE = 0.3;

/**
 * Shape of a single hint accepted by `applyArchetypeHints`.
 *
 * `archetype_id` is widened to `string` to accept upstream hint payloads — unknown
 * values are silently dropped inside `applyArchetypeHints` rather than producing a
 * type error at the call site. The SDK structurally accepts `ArchetypeHint` from
 * `@estalara/shared` without importing it (avoids tightening the public surface).
 */
export interface ArchetypeHintLike {
  archetype_id: string;
  confidence_boost: number;
  signal?: string;
}

/**
 * Apply site-level archetype hints as Bayesian prior boosts.
 *
 * Called **once** at session start when a `TenantSiteSchema` is available — typically
 * before any behavioral signal has been processed. For each hint the corresponding
 * archetype's prior probability is increased by `hint.confidence_boost`; the resulting
 * distribution is re-normalized so probabilities sum to 1.0.
 *
 * Multiple hints targeting the same archetype are **summed** and **capped** at
 * `HINT_MAX_BOOST_PER_ARCHETYPE` (0.30). Non-finite or non-positive boosts are
 * ignored. Hints whose `archetype_id` is not a known archetype are silently dropped.
 *
 * The returned state is a fresh immutable object; the input is never mutated.
 * `signal_count` and `quiz_answered` are preserved.
 *
 * @param state - Current intent state (typically the result of `initIntentState()`).
 * @param hints - Site-level hints from `extractArchetypeHints` (may be empty).
 */
export function applyArchetypeHints(
  state: IntentState,
  hints: readonly ArchetypeHintLike[],
): IntentState {
  if (hints.length === 0) return state;

  // Sum + cap boosts per archetype (defensive — extractArchetypeHints already caps,
  // but we don't trust upstream callers and this guarantees the invariant).
  const cumulativeBoost = Object.fromEntries(ARCHETYPE_NAMES.map((k) => [k, 0])) as Record<
    Archetype,
    number
  >;

  const knownArchetypes = new Set<string>(ARCHETYPE_NAMES);

  for (const hint of hints) {
    if (!knownArchetypes.has(hint.archetype_id)) continue;
    if (!Number.isFinite(hint.confidence_boost)) continue;
    if (hint.confidence_boost <= 0) continue;
    const archetype = hint.archetype_id as Archetype;
    cumulativeBoost[archetype] = Math.min(
      cumulativeBoost[archetype] + hint.confidence_boost,
      HINT_MAX_BOOST_PER_ARCHETYPE,
    );
  }

  // Build boosted probabilities, then normalize to sum to 1.0.
  const boosted = Object.fromEntries(
    ARCHETYPE_NAMES.map((k) => [k, state.probabilities[k] + cumulativeBoost[k]]),
  ) as ArchetypeProbabilities;

  const probabilities = normalize(boosted);
  const { archetype, confidence: rawConfidence } = classifyFromProbabilities(probabilities);

  return {
    archetype,
    confidence: withConfidenceBonus(rawConfidence, state.quiz_answered),
    probabilities,
    signal_count: state.signal_count,
    last_updated_at: Date.now(),
    quiz_answered: state.quiz_answered,
  };
}

// ─── Listing-view rate signal (FOLLOW-208) ────────────────────────────────────

/**
 * Apply listing-view rate as a portfolio_builder / flip_investor behavioral discriminator.
 *
 * Rate is computed as `viewCount / (elapsedMs / 60_000)` (views per minute).
 *
 * Boost rules:
 *   - rate ≥ 3 views/min AND viewCount ≥ 2 → portfolio_builder +0.12, flip_investor +0.08,
 *     neutral −0.10 (floored at 0 before renormalization)
 *   - rate ≤ 0.5 views/min AND viewCount ≥ 2 → family_buyer +0.06, first_time_buyer +0.06,
 *     upsizer +0.04
 *   - viewCount < 2 → return `state` unchanged (no-op — first view is baseline)
 *   - elapsedMs ≤ 0 → return `state` unchanged (guard against division by zero)
 *   - Otherwise (0.5 < rate < 3) → return `state` unchanged
 *
 * The result is always renormalized so probabilities sum to 1.0.
 * This is a pure function — the input `state` is never mutated.
 * `signal_count` and `quiz_answered` are preserved.
 *
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

  const probabilities = normalize(rateBoost);
  const { archetype, confidence: rawConfidence } = classifyFromProbabilities(probabilities);

  return {
    archetype,
    confidence: withConfidenceBonus(rawConfidence, state.quiz_answered),
    probabilities,
    signal_count: state.signal_count,
    last_updated_at: Date.now(),
    quiz_answered: state.quiz_answered,
  };
}
