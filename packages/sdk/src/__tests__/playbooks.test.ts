/**
 * Tests for the 18-archetype playbook registry (TICKET-ADP-003).
 *
 * Covers:
 *   1. getPlaybook() returns correct playbook for each of the 18 archetypes
 *   2. getPlaybook() falls back to neutral for an unknown archetype
 *   3. Every non-neutral playbook has non-empty description, signals, feature_priority
 *   4. Spot-checks on the copy of key archetypes' slots
 *   5. getAllPlaybooks() covers every archetype
 *
 * NOT covered here, deliberately (FOLLOW-890): the /api/adapt decision tree. See the
 * note at the foot of this file.
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
  // ESC-075 rewrote both headlines below, so both assertions were rewritten to check the RULE
  // instead of a literal — a spot-check pinned to a string is the reason these two were the only
  // tests that noticed the copy change, and it noticed by breaking rather than by judging.
  //
  // `yield_hunter` was 'Rental Yield: {yield}% | Gross Income: {income}/yr'. Neither figure is
  // carried by any data the estate holds, and the archetype's own HARD RULES forbid quoting
  // either unverified — the slot template was contradicting its own anti-hallucination contract.
  it('yield_hunter headline is yield-framed and quotes no figure (ESC-075)', () => {
    const playbook = getPlaybook('yield_hunter');
    const headlineSlot = playbook.slots.find((s) => s.slot === 'headline');
    expect(headlineSlot).toBeDefined();
    expect(headlineSlot?.en).toMatch(/yield/i);
    expect(headlineSlot?.en).not.toMatch(/\{[a-z][a-z0-9_]*\}/i);
  });

  // `family_buyer` was '{bedrooms}BR Family Home — {school_rating} School District'. School
  // ratings need a third-party dataset nobody in the estate has, and the HARD RULES forbid
  // quoting one. `{bedrooms}` stays: it IS a fact of the listing and resolves server-side.
  it('family_buyer headline is family-framed and claims no school rating (ESC-075)', () => {
    const playbook = getPlaybook('family_buyer');
    const headlineSlot = playbook.slots.find((s) => s.slot === 'headline');
    expect(headlineSlot?.en).toMatch(/family/i);
    expect(headlineSlot?.en).not.toMatch(/school/i);
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

// ─── 6. The decision tree is NOT tested here (FOLLOW-890) ────────────────────

/**
 * This file used to carry `simulateDecisionTree()` — a hand-written copy of
 * `runDecisionTree()` from `apps/control-plane/src/app/api/adapt/route.ts`, declared
 * in its own docblock as a replication of it. It was deleted, not repaired.
 *
 * It had drifted into asserting a contract the route cannot honour: it returned
 * `{ directives: [], source: 'llm_full' }`, while `route.ts:340-345` returns the
 * gateway's directives with `'llm_full'` and empty directives ONLY with
 * `'playbook_fallback_llm_unavailable'` (the route's own header says so at
 * `route.ts:15`). That false pair was asserted green here while
 * `route.test.ts:396-408` asserted the opposite for the same branch — two green
 * suites, one branch, opposite contracts.
 *
 * It is deleted rather than corrected because the direction of the dependency makes
 * a copy here permanently unsound: the control plane imports `getPlaybook` from THIS
 * package (`route.ts:49`), so a copy of its branch logic in this package's tests can
 * never be imported, never be type-checked against the original, and can only drift.
 *
 * Every branch of the tree, both boundary edges, and both gateway outcomes are
 * covered against the REAL handler in
 * `apps/control-plane/src/app/api/adapt/route.test.ts:246-453`. Nothing this block
 * asserted is now unasserted: its playbook-copy claims are duplicated verbatim in
 * section 4 above, and its branch claims were always the route suite's to make.
 *
 * Do not re-create the copy. To learn what the route returns, read `route.ts` or run
 * that suite.
 */
