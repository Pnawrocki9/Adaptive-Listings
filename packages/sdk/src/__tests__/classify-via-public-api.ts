/**
 * Test helper: drives the module-private archetype classifier in `core/intent.ts` through its
 * public callers, so the hysteresis and quiz-stickiness tests keep pinning the PRODUCTION code
 * without the classifier being exported only for tests (Rule I) [FOLLOW-1295].
 *
 * - No `currentArchetype` → `initIntentState()`, the classifier's free (cold-start) call site.
 * - With `currentArchetype` → `applyBehavioralSignal()` with a no-information likelihood (every
 *   archetype at 1.0, undamped), the guarded call site; the distribution passes through
 *   `normalize()` unchanged up to floating-point rounding.
 */

import {
  ARCHETYPE_NAMES,
  applyBehavioralSignal,
  initIntentState,
  resolveIntentOverrides,
} from '../core/intent.js';
import type { Archetype, ArchetypeProbabilities } from '../core/intent.js';

const PROBE_EVENT = 'test.classify_probe';

const NO_INFORMATION = Object.fromEntries(
  ARCHETYPE_NAMES.map((k) => [k, 1]),
) as ArchetypeProbabilities;

export function classifyFromProbabilities(
  probs: ArchetypeProbabilities,
  currentArchetype?: Archetype,
  quizAnswered = false,
): { archetype: Archetype; confidence: number } {
  const defaults = resolveIntentOverrides(null);
  if (currentArchetype === undefined) {
    const s = initIntentState({ ...defaults, basePrior: probs });
    return { archetype: s.archetype, confidence: s.confidence };
  }
  const state = {
    ...initIntentState(),
    probabilities: probs,
    archetype: currentArchetype,
    quiz_answered: quizAnswered,
  };
  const s = applyBehavioralSignal(state, PROBE_EVENT, undefined, {
    ...defaults,
    behavioralDamping: 1,
    signalLikelihoods: { ...defaults.signalLikelihoods, [PROBE_EVENT]: NO_INFORMATION },
  });
  return { archetype: s.archetype, confidence: s.confidence };
}
