/**
 * Tests for the 18-archetype playbook registry (TICKET-ADP-003).
 *
 * Covers:
 *   1. getPlaybook() returns correct playbook for each of the 18 archetypes
 *   2. getPlaybook() falls back to neutral for an unknown archetype
 *   3. Every non-neutral playbook has non-empty description, signals, feature_priority
 *   4. Integration: route decision tree + playbook lookup → correct directive shape
 */

import { describe, it, expect } from 'vitest';
import { getPlaybook, getAllPlaybooks } from '../core/playbooks/index.js';
import type { Archetype } from '../core/intent.js';
import { ARCHETYPE_NAMES } from '../core/intent.js';

// ─── 1. Individual archetype lookups ─────────────────────────────────────────

describe('getPlaybook — all 18 archetypes', () => {
  const nonNeutralArchetypes: Archetype[] = ARCHETYPE_NAMES.filter((a) => a !== 'neutral');

  it.each(nonNeutralArchetypes)('returns playbook for %s', (archetype) => {
    const playbook = getPlaybook(archetype);
    expect(playbook.archetype).toBe(archetype);
    expect(playbook.slots).toBeDefined();
    expect(playbook.listing_rules).toBeDefined();
    expect(playbook.feature_priority).toBeDefined();
    expect(playbook.description).toBeDefined();
    expect(playbook.signals).toBeDefined();
  });

  it('returns neutral playbook for neutral archetype', () => {
    const playbook = getPlaybook('neutral');
    expect(playbook.archetype).toBe('neutral');
    expect(playbook.slots).toHaveLength(0);
    expect(playbook.feature_priority).toHaveLength(0);
    expect(playbook.signals).toHaveLength(0);
  });
});

// ─── 2. Unknown archetype fallback ───────────────────────────────────────────

describe('getPlaybook — unknown archetype fallback', () => {
  it('returns neutral playbook for an unknown archetype id', () => {
    // Cast needed to simulate a runtime value that slips past TypeScript
    const playbook = getPlaybook('unknown_archetype_id' as Archetype);
    expect(playbook.archetype).toBe('neutral');
    expect(playbook.slots).toHaveLength(0);
  });
});

// ─── 3. Non-empty guard tests ─────────────────────────────────────────────────

describe('playbook data completeness — non-neutral archetypes', () => {
  const nonNeutralArchetypes: Archetype[] = ARCHETYPE_NAMES.filter((a) => a !== 'neutral');

  it.each(nonNeutralArchetypes)('%s has non-empty description', (archetype) => {
    const playbook = getPlaybook(archetype);
    expect(playbook.description.length).toBeGreaterThan(0);
  });

  it.each(nonNeutralArchetypes)('%s has at least 1 signal', (archetype) => {
    const playbook = getPlaybook(archetype);
    expect(playbook.signals.length).toBeGreaterThan(0);
  });

  it.each(nonNeutralArchetypes)('%s has at least 1 feature_priority entry', (archetype) => {
    const playbook = getPlaybook(archetype);
    expect(playbook.feature_priority.length).toBeGreaterThan(0);
  });

  it.each(nonNeutralArchetypes)('%s has at least 1 slot', (archetype) => {
    const playbook = getPlaybook(archetype);
    expect(playbook.slots.length).toBeGreaterThan(0);
  });

  it.each(nonNeutralArchetypes)('%s has exactly 3 slots (headline, cta, feature)', (archetype) => {
    const playbook = getPlaybook(archetype);
    expect(playbook.slots.length).toBe(3);
    const slotNames = playbook.slots.map((s) => s.slot);
    expect(slotNames).toContain('headline');
    expect(slotNames).toContain('cta');
    expect(slotNames).toContain('feature');
  });

  it.each(nonNeutralArchetypes)('%s slot names use canonical values only', (archetype) => {
    const playbook = getPlaybook(archetype);
    const allowedSlots = ['headline', 'cta', 'feature'];
    for (const slot of playbook.slots) {
      expect(allowedSlots).toContain(slot.slot);
    }
  });

  it.each(nonNeutralArchetypes)('%s headline slot has at least 3 copy variants', (archetype) => {
    const playbook = getPlaybook(archetype);
    const headline = playbook.slots.find((s) => s.slot === 'headline');
    expect(headline).toBeDefined();
    expect(headline?.variants).toBeDefined();
    expect(headline?.variants?.en.length).toBeGreaterThanOrEqual(3);
  });

  it.each(nonNeutralArchetypes)('%s has a non-empty English copy_template', (archetype) => {
    const playbook = getPlaybook(archetype);
    expect(playbook.copy_template).toBeDefined();
    expect(playbook.copy_template.en.length).toBeGreaterThan(50);
  });

  it.each(nonNeutralArchetypes)(
    '%s listing_rules has boost_class and suppress_class',
    (archetype) => {
      const playbook = getPlaybook(archetype);
      expect(playbook.listing_rules.boost_class).toBe('estalara-boost');
      expect(playbook.listing_rules.suppress_class).toBe('estalara-suppress');
    },
  );
});

// ─── 4. Spot-checks for specific playbook content ────────────────────────────

describe('getPlaybook — spot checks for key archetypes', () => {
  it('yield_hunter has rental yield headline slot', () => {
    const playbook = getPlaybook('yield_hunter');
    const headlineSlot = playbook.slots.find((s) => s.slot === 'headline');
    expect(headlineSlot).toBeDefined();
    expect(headlineSlot?.en).toContain('{yield}');
  });

  it('family_buyer headline mentions school district', () => {
    const playbook = getPlaybook('family_buyer');
    const headlineSlot = playbook.slots.find((s) => s.slot === 'headline');
    expect(headlineSlot?.en).toContain('School District');
  });

  it('lifestyle_expat headline mentions expat community', () => {
    const playbook = getPlaybook('lifestyle_expat');
    const headlineSlot = playbook.slots.find((s) => s.slot === 'headline');
    expect(headlineSlot?.en).toContain('Expat Community');
  });

  it('first_time_buyer has 3 slots (headline, cta, feature)', () => {
    const playbook = getPlaybook('first_time_buyer');
    expect(playbook.slots).toHaveLength(3);
    const slots = playbook.slots.map((s) => s.slot);
    expect(slots).toContain('headline');
    expect(slots).toContain('cta');
    expect(slots).toContain('feature');
  });

  it('golden_visa_buyer headline mentions Golden Visa', () => {
    const playbook = getPlaybook('golden_visa_buyer');
    const headlineSlot = playbook.slots.find((s) => s.slot === 'headline');
    expect(headlineSlot?.en).toContain('Golden Visa');
  });
});

// ─── 5. getAllPlaybooks() coverage ────────────────────────────────────────────

describe('getAllPlaybooks()', () => {
  it('returns a map with 18 entries (all ARCHETYPE_NAMES)', () => {
    const all = getAllPlaybooks();
    expect(all.size).toBe(ARCHETYPE_NAMES.length);
  });

  it('contains every archetype from ARCHETYPE_NAMES', () => {
    const all = getAllPlaybooks();
    for (const archetype of ARCHETYPE_NAMES) {
      expect(all.has(archetype)).toBe(true);
    }
  });
});

// ─── 6. Integration: directive shape from decision tree ──────────────────────

/**
 * Replicates the decision tree logic from route.ts to test the playbook
 * output shape without importing from the Next.js app (which has no node_modules
 * in the SDK test environment).
 */
function simulateDecisionTree(
  archetypeId: Archetype,
  confidence: number,
  similarity: number,
): {
  directives: {
    type: string;
    slot: string;
    value: string;
    archetype: string;
    confidence: number;
  }[];
  source: string;
} {
  const CONFIDENCE_THRESHOLD = 0.6;
  const HIGH_SIMILARITY_THRESHOLD = 0.85;
  const LOW_SIMILARITY_THRESHOLD = 0.6;

  if (confidence <= CONFIDENCE_THRESHOLD) {
    return { directives: [], source: 'default' };
  }
  if (similarity <= LOW_SIMILARITY_THRESHOLD) {
    return { directives: [], source: 'llm_full' };
  }

  const playbook = getPlaybook(archetypeId);
  const directives = playbook.slots.map((s) => ({
    type: 'text' as const,
    slot: s.slot,
    value: s.en,
    archetype: archetypeId,
    confidence,
  }));

  if (similarity > HIGH_SIMILARITY_THRESHOLD) {
    return { directives, source: 'playbook' };
  }
  return { directives, source: 'llm_tweaked' };
}

describe('Integration: decision tree + playbook lookup', () => {
  it('yield_hunter (confidence=0.75, similarity=0.90) → source=playbook, non-empty directives', () => {
    const result = simulateDecisionTree('yield_hunter', 0.75, 0.9);
    expect(result.source).toBe('playbook');
    expect(result.directives.length).toBeGreaterThan(0);
    const first = result.directives[0];
    expect(first).toBeDefined();
    if (first) {
      expect(first.type).toBe('text');
      expect(first.archetype).toBe('yield_hunter');
      expect(first.confidence).toBe(0.75);
    }
    // headline slot should contain yield placeholder
    const headlineDirective = result.directives.find((d) => d.slot === 'headline');
    expect(headlineDirective?.value).toContain('{yield}');
  });

  it('family_buyer (confidence=0.80, similarity=0.88) → source=playbook, school district headline', () => {
    const result = simulateDecisionTree('family_buyer', 0.8, 0.88);
    expect(result.source).toBe('playbook');
    expect(result.directives.length).toBeGreaterThan(0);
    const headlineDirective = result.directives.find((d) => d.slot === 'headline');
    expect(headlineDirective?.value).toContain('School District');
  });

  it('lifestyle_expat (confidence=0.70, similarity=0.95) → source=playbook, expat headline', () => {
    const result = simulateDecisionTree('lifestyle_expat', 0.7, 0.95);
    expect(result.source).toBe('playbook');
    expect(result.directives.length).toBeGreaterThan(0);
    const headlineDirective = result.directives.find((d) => d.slot === 'headline');
    expect(headlineDirective?.value).toContain('Expat Community');
  });

  it('low confidence (0.4) → source=default, empty directives regardless of archetype', () => {
    const result = simulateDecisionTree('yield_hunter', 0.4, 0.95);
    expect(result.source).toBe('default');
    expect(result.directives).toHaveLength(0);
  });

  it('low similarity (0.5) → source=llm_full, empty directives', () => {
    const result = simulateDecisionTree('family_buyer', 0.75, 0.5);
    expect(result.source).toBe('llm_full');
    expect(result.directives).toHaveLength(0);
  });

  it('medium similarity (0.72) → source=llm_tweaked, non-empty directives', () => {
    const result = simulateDecisionTree('lifestyle_expat', 0.7, 0.72);
    expect(result.source).toBe('llm_tweaked');
    expect(result.directives.length).toBeGreaterThan(0);
  });
});
