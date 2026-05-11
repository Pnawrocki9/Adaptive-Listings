/**
 * Intent Engine — Bayesian archetype classifier.
 *
 * Archetypes: 'investor' | 'family' | 'neutral'
 *
 * Prior sources (in decreasing strength):
 *   1. Quiz answers (explicit self-declaration, full likelihood applied)
 *   2. Behavioral signals (implicit, multiplied by BEHAVIORAL_DAMPING)
 *      - Scroll depth, listing views, CTA clicks, etc.
 *
 * Decay: probabilities move toward the uniform distribution (1/3 each) at the
 * configured rate per minute. Without new evidence the classifier loses
 * confidence and returns to neutral over time.
 *
 * All public functions are pure: they return a new state without mutating
 * the input. Functions never throw — degenerate input (NaN, zero sum) is
 * sanitized to the uniform distribution.
 *
 * @module @estalara/sdk/core/intent
 */

export type Archetype = 'investor' | 'family' | 'neutral';

export interface ArchetypeProbabilities {
  /** Probability the visitor is an investor. */
  investor: number;
  /** Probability the visitor is a personal/family buyer. */
  family: number;
  /** Probability the visitor is undecided / browsing. */
  neutral: number;
}

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

/** Base prior — before any evidence is observed. */
const BASE_PRIOR: ArchetypeProbabilities = {
  investor: 0.25,
  family: 0.35,
  neutral: 0.4,
};

/**
 * Quiz answer likelihoods — P(answer | archetype).
 *
 * These are applied multiplicatively to the current prior and renormalized,
 * yielding a strong posterior shift toward the indicated archetype.
 */
const QUIZ_LIKELIHOODS = {
  purpose_investment: { investor: 0.85, family: 0.05, neutral: 0.1 },
  purpose_personal: { investor: 0.1, family: 0.75, neutral: 0.15 },
  horizon_short: { investor: 0.6, family: 0.25, neutral: 0.15 },
  horizon_long: { investor: 0.2, family: 0.5, neutral: 0.3 },
} as const;

/**
 * Behavioral signal likelihoods — multiplicative weights applied (after damping)
 * to the current prior.
 *
 * Values > 1.0 favor the archetype; values < 1.0 disfavor it.
 */
const SIGNAL_LIKELIHOODS: Record<string, ArchetypeProbabilities> = {
  'scroll.depth': { investor: 1.05, family: 1.05, neutral: 0.95 },
  'listing.viewed': { investor: 1.1, family: 1.1, neutral: 0.9 },
  'cta.clicked': { investor: 1.15, family: 1.08, neutral: 0.85 },
  // quiz.event is a no-op at the behavioral layer — the quiz prior path is the strong update
  'quiz.event': { investor: 1.0, family: 1.0, neutral: 1.0 },
};

/** How much to dampen behavioral likelihoods relative to quiz likelihoods. */
const BEHAVIORAL_DAMPING = 0.3;

/** Default decay rate per minute (fraction of distance toward uniform). */
const DEFAULT_DECAY_RATE = 0.02;

/** Confidence multiplier when the quiz has been answered (capped at 1.0). */
const QUIZ_CONFIDENCE_BONUS = 1.2;

/** Probability assigned to each archetype under the uniform distribution. */
const UNIFORM_PROB = 1 / 3;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function isFiniteProbs(probs: ArchetypeProbabilities): boolean {
  return (
    Number.isFinite(probs.investor) &&
    Number.isFinite(probs.family) &&
    Number.isFinite(probs.neutral)
  );
}

function uniform(): ArchetypeProbabilities {
  return { investor: UNIFORM_PROB, family: UNIFORM_PROB, neutral: UNIFORM_PROB };
}

/**
 * Multiplicative Bayesian update: posterior ∝ prior × likelihood, then normalize.
 */
function applyLikelihood(
  prior: ArchetypeProbabilities,
  likelihood: ArchetypeProbabilities,
): ArchetypeProbabilities {
  return normalize({
    investor: prior.investor * likelihood.investor,
    family: prior.family * likelihood.family,
    neutral: prior.neutral * likelihood.neutral,
  });
}

/**
 * Compute confidence, applying the quiz bonus when quiz_answered is true.
 */
function withConfidenceBonus(rawConfidence: number, quizAnswered: boolean): number {
  if (!quizAnswered) return rawConfidence;
  return Math.min(rawConfidence * QUIZ_CONFIDENCE_BONUS, 1.0);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalize probabilities to sum to 1.0.
 *
 * Edge cases:
 *   - NaN / Infinity values → uniform distribution
 *   - Zero or negative sum → uniform distribution
 *   - Negative individual values → clamped to 0 before summing
 *
 * Exported for testing.
 */
export function normalize(probs: ArchetypeProbabilities): ArchetypeProbabilities {
  if (!isFiniteProbs(probs)) return uniform();
  const i = Math.max(0, probs.investor);
  const f = Math.max(0, probs.family);
  const n = Math.max(0, probs.neutral);
  const sum = i + f + n;
  if (sum <= 0 || !Number.isFinite(sum)) return uniform();
  return { investor: i / sum, family: f / sum, neutral: n / sum };
}

/**
 * Derive archetype and confidence from a probability distribution.
 *
 * Tie-break order: neutral > family > investor — matching the BASE_PRIOR ranking
 * so a fully-decayed state classifies as 'neutral' rather than an arbitrary
 * archetype.
 *
 * Confidence = max(probs). The quiz bonus (if applicable) is layered on
 * separately by the state-update functions.
 */
export function classifyFromProbabilities(probs: ArchetypeProbabilities): {
  archetype: Archetype;
  confidence: number;
} {
  let archetype: Archetype = 'neutral';
  let maxProb = probs.neutral;
  if (probs.family > maxProb) {
    archetype = 'family';
    maxProb = probs.family;
  }
  if (probs.investor > maxProb) {
    archetype = 'investor';
    maxProb = probs.investor;
  }
  return { archetype, confidence: maxProb };
}

/**
 * Initialize intent state with BASE_PRIOR probabilities.
 */
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
 * Sets `quiz_answered = true`, which enables the confidence bonus for all
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
 * Update intent state from a behavioral event.
 *
 * The raw signal likelihood is dampened by BEHAVIORAL_DAMPING (default 0.3),
 * so a single behavioral event has a much smaller effect than a quiz answer.
 * Multiple signals accumulate.
 *
 * Unknown event types return the state unchanged (same reference,
 * signal_count is NOT incremented).
 *
 * @param _payload reserved for future context-specific updates (e.g. yield_pct on listing.viewed)
 */
export function applyBehavioralSignal(
  state: IntentState,
  eventType: string,
  _payload?: Record<string, unknown>,
): IntentState {
  const rawLikelihood = SIGNAL_LIKELIHOODS[eventType];
  if (!rawLikelihood) return state;

  // Linear damping toward 1.0 — small deviations stay small, large deviations shrink
  const dampedLikelihood: ArchetypeProbabilities = {
    investor: 1 + (rawLikelihood.investor - 1) * BEHAVIORAL_DAMPING,
    family: 1 + (rawLikelihood.family - 1) * BEHAVIORAL_DAMPING,
    neutral: 1 + (rawLikelihood.neutral - 1) * BEHAVIORAL_DAMPING,
  };

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

// ─── Mismatch detection ───────────────────────────────────────────────────────

/** Minimum behavioral signals required before a mismatch can be reported. */
const MISMATCH_MIN_SIGNALS = 3;

/** Behavioral probability threshold for the opposing archetype to flag a mismatch. */
const MISMATCH_OPPOSING_THRESHOLD = 0.4;

/** Confidence gap threshold — behavioral top archetype confidence vs quiz archetype probability. */
const MISMATCH_GAP_THRESHOLD = 0.3;

/**
 * Mismatch event — logged when quiz answers contradict behavioral signals.
 * Feeds Detection Quality Score (DQS) for archetype accuracy improvement.
 */
export interface MismatchEvent {
  session_id: string;
  quiz_archetype: Archetype;
  behavioral_archetype: Archetype;
  /** behavioral top-archetype confidence minus quiz archetype's behavioral probability. */
  confidence_gap: number;
  /** How many behavioral signals accumulated before the mismatch was detected. */
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
 * Mismatch fires when any of these conditions holds:
 *   1. Quiz declared 'investor' but behavioral signals assign >0.4 probability to 'family'
 *   2. Quiz declared 'family' but behavioral signals assign >0.4 probability to 'investor'
 *   3. Confidence gap (behavioral_confidence - quiz_archetype_behavioral_prob) > 0.3
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

  const opposingArchetypeHigh =
    (quizArchetype === 'investor' && probs.family > MISMATCH_OPPOSING_THRESHOLD) ||
    (quizArchetype === 'family' && probs.investor > MISMATCH_OPPOSING_THRESHOLD);

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
 * Calculate behavioral-only intent state from a signal history.
 * Starts from BASE_PRIOR and applies only behavioral signals — no quiz prior.
 * Used to compare against the quiz-declared archetype for mismatch detection.
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

/**
 * Apply temporal decay toward the uniform distribution.
 *
 * decayFactor = clamp(decayRate × elapsedMinutes, 0, 1)
 *
 * Each probability is linearly interpolated toward UNIFORM_PROB by decayFactor.
 * The interpolation preserves the sum (still 1.0 up to floating-point error),
 * but we renormalize at the end for safety.
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

  const probabilities = normalize({
    investor: state.probabilities.investor * keep + UNIFORM_PROB * decayFactor,
    family: state.probabilities.family * keep + UNIFORM_PROB * decayFactor,
    neutral: state.probabilities.neutral * keep + UNIFORM_PROB * decayFactor,
  });

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
