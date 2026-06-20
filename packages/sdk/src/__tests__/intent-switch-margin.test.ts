/**
 * FOLLOW-344 — Archetype switch-margin (hysteresis) tests.
 *
 * Tests:
 *  - AC1: near-tie (gap < SWITCH_MARGIN) → archetype does NOT flip
 *  - AC2: clear winner (gap >= SWITCH_MARGIN) → archetype switches
 *  - AC3: currentArchetype = undefined → switches freely (init case)
 *  - AC4: SWITCH_MARGIN exported constant has expected value
 *  - AC5: hysteresis applies across all intercept paths in applyBehavioralSignal
 */

import { describe, expect, it } from 'vitest';

import {
  ARCHETYPE_NAMES,
  SWITCH_MARGIN,
  applyBehavioralSignal,
  classifyFromProbabilities,
  initIntentState,
} from '../core/intent.js';
import type { ArchetypeProbabilities } from '../core/intent.js';

/** Build a probability distribution from explicit values; fills the rest uniformly. */
function makeProbs(explicit: Partial<ArchetypeProbabilities>): ArchetypeProbabilities {
  const explicitSum = Object.values(explicit).reduce<number>((acc, v) => acc + v, 0);
  const remaining = 1.0 - explicitSum;
  const unspecifiedKeys = ARCHETYPE_NAMES.filter((k) => !(k in explicit));
  const fillValue = unspecifiedKeys.length > 0 ? remaining / unspecifiedKeys.length : 0;

  return Object.fromEntries(
    ARCHETYPE_NAMES.map((k) => [k, explicit[k] ?? fillValue]),
  ) as ArchetypeProbabilities;
}

// ─── AC4: SWITCH_MARGIN constant ─────────────────────────────────────────────

describe('SWITCH_MARGIN constant', () => {
  it('is exported and equals 0.05', () => {
    expect(SWITCH_MARGIN).toBe(0.05);
  });
});

// ─── AC3: undefined currentArchetype → switches freely (init case) ───────────

describe('classifyFromProbabilities — AC3: no currentArchetype → free switch', () => {
  it('returns the argmax when no currentArchetype is provided', () => {
    // yield_hunter leads by a small margin (< SWITCH_MARGIN) — but no currentArchetype
    // so hysteresis guard does not engage and the leader is returned freely.
    const probs = makeProbs({ yield_hunter: 0.08, neutral: 0.37 });
    const { archetype } = classifyFromProbabilities(probs, undefined);
    expect(archetype).toBe('neutral'); // neutral has 0.37, highest
  });

  it('returns argmax without hysteresis when currentArchetype is absent', () => {
    // portfolio_builder leads over neutral by a small gap < SWITCH_MARGIN
    const gap = SWITCH_MARGIN - 0.01; // 0.04
    const neutralProb = 0.2;
    const portfolioProb = neutralProb + gap; // 0.24
    const probs = makeProbs({ portfolio_builder: portfolioProb, neutral: neutralProb });
    // Without hysteresis (no currentArchetype), portfolio_builder should win
    const { archetype } = classifyFromProbabilities(probs, undefined);
    expect(archetype).toBe('portfolio_builder');
  });
});

// ─── AC1: near-tie → archetype does NOT flip ──────────────────────────────────

describe('classifyFromProbabilities — AC1: near-tie below SWITCH_MARGIN → no flip', () => {
  it('retains currentArchetype when new leader beats it by less than SWITCH_MARGIN', () => {
    // Current archetype is yield_hunter.
    // New leader (portfolio_builder) beats yield_hunter by gap < SWITCH_MARGIN.
    const currentArchetype = 'yield_hunter' as const;
    const gap = SWITCH_MARGIN - 0.01; // 0.04 — below threshold
    const yieldProb = 0.2;
    const portfolioProb = yieldProb + gap; // 0.24
    const probs = makeProbs({
      portfolio_builder: portfolioProb,
      yield_hunter: yieldProb,
      neutral: 0.1,
    });

    const { archetype } = classifyFromProbabilities(probs, currentArchetype);
    // New leader does not beat current by >= SWITCH_MARGIN → retain yield_hunter
    expect(archetype).toBe('yield_hunter');
  });

  it('retains currentArchetype when gap is exactly zero (tie)', () => {
    const currentArchetype = 'family_buyer' as const;
    const tiedProb = 0.2;
    const probs = makeProbs({ family_buyer: tiedProb, first_time_buyer: tiedProb, neutral: 0.1 });
    // first_time_buyer does not beat family_buyer — tie handled by retain
    const { archetype } = classifyFromProbabilities(probs, currentArchetype);
    expect(archetype).toBe('family_buyer');
  });

  it('retains currentArchetype when gap is exactly SWITCH_MARGIN - epsilon', () => {
    const currentArchetype = 'flip_investor' as const;
    const flipProb = 0.15;
    const competitorProb = flipProb + SWITCH_MARGIN - 0.001; // just below threshold
    const probs = makeProbs({
      portfolio_builder: competitorProb,
      flip_investor: flipProb,
      neutral: 0.1,
    });
    const { archetype } = classifyFromProbabilities(probs, currentArchetype);
    expect(archetype).toBe('flip_investor');
  });
});

// ─── AC2: clear winner → archetype switches ───────────────────────────────────

describe('classifyFromProbabilities — AC2: clear win >= SWITCH_MARGIN → switch', () => {
  it('switches to new archetype when gap exactly equals SWITCH_MARGIN', () => {
    const currentArchetype = 'yield_hunter' as const;
    const yieldProb = 0.15;
    const portfolioProb = yieldProb + SWITCH_MARGIN; // exactly at threshold
    const probs = makeProbs({
      portfolio_builder: portfolioProb,
      yield_hunter: yieldProb,
      neutral: 0.1,
    });

    const { archetype } = classifyFromProbabilities(probs, currentArchetype);
    // Gap exactly equals SWITCH_MARGIN → switch
    expect(archetype).toBe('portfolio_builder');
  });

  it('switches to new archetype when gap exceeds SWITCH_MARGIN', () => {
    const currentArchetype = 'neutral' as const;
    const neutralProb = 0.1;
    const winnerProb = neutralProb + SWITCH_MARGIN + 0.05; // 0.05 above threshold
    const probs = makeProbs({ family_buyer: winnerProb, neutral: neutralProb });

    const { archetype } = classifyFromProbabilities(probs, currentArchetype);
    expect(archetype).toBe('family_buyer');
  });
});

// ─── AC5: hysteresis applies across applyBehavioralSignal intercept paths ─────

describe('applyBehavioralSignal — AC5: hysteresis applied in behavioral update paths', () => {
  it('does not flip archetype when behavioral signal produces near-tie in generic path', () => {
    // Start from a state where yield_hunter is the current archetype with decent probability.
    // Apply a very weak behavioral signal (scroll.depth) that gives a tiny nudge toward neutral.
    // The nudge should not flip the archetype because the new leader (if different) won't clear SWITCH_MARGIN.
    const initial = initIntentState();
    // Manually set up a state where yield_hunter is just above all others
    // by applying a strong prior signal first
    let state = applyBehavioralSignal(initial, 'cta.clicked');
    state = applyBehavioralSignal(state, 'cta.clicked');
    state = applyBehavioralSignal(state, 'cta.clicked');

    const archetypeBeforeScroll = state.archetype;
    // Now apply a weak signal — scroll.depth only pushes neutral down slightly
    const afterScroll = applyBehavioralSignal(state, 'scroll.depth');

    // The archetype should remain stable (scroll.depth is a weak signal with no positive boost)
    // — either stays the same or only changes if the new leader clearly beats by >= SWITCH_MARGIN
    if (afterScroll.archetype !== archetypeBeforeScroll) {
      // If it changed, verify it was a clear win
      expect(
        afterScroll.probabilities[afterScroll.archetype] -
          afterScroll.probabilities[archetypeBeforeScroll],
      ).toBeGreaterThanOrEqual(SWITCH_MARGIN);
    }
  });

  it('listing.bookmarked path respects hysteresis', () => {
    // listing.bookmarked intercept: verify that a near-tie does not flip
    const state = initIntentState();
    // Apply bookmarked with no payload (base neutral push only)
    const after = applyBehavioralSignal(state, 'listing.bookmarked', {});
    // The archetype should only switch from neutral if a new leader beats neutral by >= SWITCH_MARGIN
    if (after.archetype !== state.archetype) {
      expect(
        after.probabilities[after.archetype] - after.probabilities[state.archetype],
      ).toBeGreaterThanOrEqual(SWITCH_MARGIN);
    }
  });

  it('filter.applied path respects hysteresis', () => {
    const state = initIntentState();
    const after = applyBehavioralSignal(state, 'filter.applied', {
      facet: 'bedrooms_min',
      value: 3,
    });
    if (after.archetype !== state.archetype) {
      expect(
        after.probabilities[after.archetype] - after.probabilities[state.archetype],
      ).toBeGreaterThanOrEqual(SWITCH_MARGIN);
    }
  });

  it('hysteresis guard directly: near-tie from classifyFromProbabilities retains current archetype', () => {
    // Directly test the hysteresis logic in classifyFromProbabilities to verify
    // that consecutive small nudges cannot flip without crossing SWITCH_MARGIN.
    //
    // Scenario: current archetype is yield_hunter at 0.20.
    // After a weak signal, portfolio_builder reaches 0.23 (gap = 0.03 < SWITCH_MARGIN=0.05).
    // Expected: yield_hunter retained.
    const currentArchetype = 'yield_hunter' as const;
    const yieldProb = 0.2;
    const portfolioProb = 0.23; // gap = 0.03, below SWITCH_MARGIN

    const probs = makeProbs({
      yield_hunter: yieldProb,
      portfolio_builder: portfolioProb,
      neutral: 0.1,
    });

    const { archetype: afterFirst } = classifyFromProbabilities(probs, currentArchetype);
    expect(afterFirst).toBe('yield_hunter'); // held

    // Second small nudge: portfolio_builder grows to 0.24 (gap = 0.04, still below 0.05)
    const probs2 = makeProbs({ yield_hunter: yieldProb, portfolio_builder: 0.24, neutral: 0.1 });
    const { archetype: afterSecond } = classifyFromProbabilities(probs2, afterFirst);
    expect(afterSecond).toBe('yield_hunter'); // still held

    // Third nudge crosses the threshold: portfolio_builder at 0.26 (gap = 0.06 > SWITCH_MARGIN)
    const probs3 = makeProbs({
      yield_hunter: yieldProb,
      portfolio_builder: yieldProb + SWITCH_MARGIN + 0.01,
      neutral: 0.1,
    });
    const { archetype: afterThird } = classifyFromProbabilities(probs3, afterSecond);
    expect(afterThird).toBe('portfolio_builder'); // now switches
  });
});
