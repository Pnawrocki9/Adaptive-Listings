/**
 * FOLLOW-405 — SEED_VARIANTS ↔ playbook parity gate (AC-1, AC-2).
 *
 * Asserts that SEED_VARIANTS, VARIANT_INDEX, and the SDK playbooks stay in
 * sync. The actual playbook data is imported from @estalara/sdk — NOT a mock
 * — so this test fails CI when:
 *   a) A new arm is added to SEED_VARIANTS without adding variants.en[N] to
 *      the playbooks (adding 'v3' without a fourth entry reds the length check).
 *   b) VARIANT_INDEX drifts from SEED_VARIANTS (would red the exact-keys check).
 *   c) SEED_VARIANTS[0] or VARIANT_INDEX['control'] is reordered.
 *
 * AC-1: For every member v of SEED_VARIANTS, VARIANT_INDEX[v] is a valid
 *       in-range index into variants.en[] of every non-neutral playbook slot
 *       that carries a variants field.
 *
 * AC-2: SEED_VARIANTS[0] === 'control' and VARIANT_INDEX['control'] === 0.
 *
 * NOTE: This file intentionally does NOT mock @estalara/sdk/playbooks. The
 * entire point of the parity gate is to validate against real playbook data.
 * Mocking the playbooks here would be self-injection — the exact weakness
 * this ticket prevents (Rule K.1 + Rule Y).
 *
 * @module apps/control-plane/src/lib/__tests__/variant-index.parity.test
 */

import { describe, expect, it, vi } from 'vitest';

// ── bandit-query.ts imports @estalara/db and drizzle-orm at module level.
// Mock them so the module can load in the test environment without a real
// Postgres connection. Only SEED_VARIANTS (a static const) is used here —
// no DB calls are made by these tests.
vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  abBanditWeights: {},
}));
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
}));

// @estalara/sdk/playbooks is intentionally NOT mocked — real data required.
import { SEED_VARIANTS } from '../bandit-query.js';
import { VARIANT_INDEX } from '../variant-index.js';
import { getAllPlaybooks } from '@estalara/sdk/playbooks';

// ── AC-1: every SEED_VARIANTS arm must index into every non-neutral playbook ──

describe('SEED_VARIANTS ↔ playbook variants.en parity (FOLLOW-405 AC-1)', () => {
  it(
    'every SEED_VARIANTS arm resolves to a defined, in-range VARIANT_INDEX entry ' +
      'for every non-neutral playbook slot that carries a variants field',
    () => {
      const playbooks = getAllPlaybooks();

      for (const [archetypeId, playbook] of playbooks.entries()) {
        // Neutral archetype carries no variants — skip it.
        if (archetypeId === 'neutral') continue;

        for (const slot of playbook.slots) {
          if (!slot.variants) continue;

          // Gate: variants.en must be at least as long as SEED_VARIANTS.
          // Adding 'v3' to SEED_VARIANTS without a fourth playbook entry reds here.
          const parityMsg =
            `${archetypeId} slot "${slot.slot}": variants.en has ` +
            `${String(slot.variants.en.length)} entries but SEED_VARIANTS has ` +
            `${String(SEED_VARIANTS.length)} arms — add the missing variant copy to the playbook`;
          expect(slot.variants.en.length, parityMsg).toBeGreaterThanOrEqual(SEED_VARIANTS.length);

          // Every VARIANT_INDEX[v] must be a valid index into variants.en.
          for (const variant of SEED_VARIANTS) {
            const idx = VARIANT_INDEX[variant];
            expect(idx).not.toBeUndefined();
            expect(idx!).toBeGreaterThanOrEqual(0);
            expect(idx!).toBeLessThan(slot.variants.en.length);
          }
        }
      }
    },
  );

  it('VARIANT_INDEX contains exactly the entries from SEED_VARIANTS — no extras, no missing', () => {
    // This reds if someone adds a key to VARIANT_INDEX manually without touching SEED_VARIANTS,
    // or removes a SEED_VARIANTS arm without removing it from the index.
    expect(Object.keys(VARIANT_INDEX).sort()).toEqual([...SEED_VARIANTS].sort());
  });
});

// ── AC-2: pin positional order — a future reorder fails CI immediately ──────

describe('SEED_VARIANTS order pinning (FOLLOW-405 AC-2)', () => {
  it('SEED_VARIANTS[0] is "control" — a reorder breaks the copy-selection convention', () => {
    // Index 0 is the baseline/control arm. Reordering this would cause control
    // sessions to silently receive v1/v2 copy and v1/v2 sessions to receive
    // control copy — corrupting A/B measurement without surfacing a runtime error.
    expect(SEED_VARIANTS[0]).toBe('control');
  });

  it('VARIANT_INDEX["control"] is 0 — maps to base copy per types.ts:27 convention', () => {
    // variants.en[0] mirrors the base `s.en` value (see types.ts:27 JSDoc).
    // If VARIANT_INDEX['control'] !== 0, control sessions get non-control copy.
    expect(VARIANT_INDEX.control).toBe(0);
  });
});
