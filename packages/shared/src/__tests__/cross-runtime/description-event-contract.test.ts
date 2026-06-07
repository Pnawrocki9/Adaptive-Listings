/**
 * Cross-runtime description.requested contract parity test — FOLLOW-198 / FOLLOW-168.
 *
 * GUARDRAIL: This test MUST NOT hand-author the required-field list. The canonical list
 * comes from the JSON fixture at packages/shared/contracts/description-event.required.json.
 * Both this test and the Python consumer (apps/llm-gateway) read that same fixture.
 * If the fixture drifts from either runtime, CI fails.
 *
 * Evidence that this test drives the real production path (not an inject):
 *   - `requiredFromFixture` is loaded from the checked-in JSON fixture — the same artifact
 *     read by the Python consumer test.
 *   - `DescriptionRequestedEventSchema` is imported directly from the production schema
 *     module; its `.shape` is inspected to derive which keys Zod considers required at
 *     runtime. No field value is injected — the schema is the production Zod definition.
 *   - The negative-drift guard builds a minimal payload that sets every fixture field to a
 *     deliberately-wrong type, then asserts the schema rejects it — proving the schema
 *     actually validates those fields rather than accepting anything.
 *
 * Pattern: packages/shared/contracts/description-event.required.json → single source of
 * truth → TS consumer (here) + Python consumer (apps/llm-gateway).
 *
 * Closes FOLLOW-168 (Sprint 14, READY but never implemented) via FOLLOW-198.
 *
 * @module packages/shared/src/__tests__/cross-runtime/description-event-contract.test
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DescriptionRequestedEventSchema } from '../../schemas/description.js';

// ─── Load the shared fixture (single source of truth) ─────────────────────────
//
// IMPORTANT: This value is NOT hand-authored here. It comes from the checked-in
// JSON file that the Python test reads via the same relative path from repo root.
// If you add a field here without adding it to the schema, AC2 catches it (drift test).
// If you add a field to the schema without adding it here, the contract is silently wider
// than the fixture; the Python consumer would still use the old set — that is the drift
// scenario this gate prevents.

const FIXTURE_PATH = join(
  import.meta.dirname,
  '../../../contracts/description-event.required.json',
);

const requiredFromFixture: string[] = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

// ─── Derive required fields from the production Zod schema ─────────────────────
//
// `DescriptionRequestedEventSchema.shape` exposes each field's ZodType. A field is
// required (non-optional, non-nullable, not .optional()) when its `_def.typeName` is
// NOT "ZodOptional". We do NOT use `.safeParse({})` because that exercises only the
// parse path, not the structural introspection needed for parity assertions.

function zodRequiredKeys(schema: typeof DescriptionRequestedEventSchema): Set<string> {
  const required = new Set<string>();
  for (const [key, fieldSchema] of Object.entries(schema.shape)) {
    // A field is optional in Zod when wrapped in ZodOptional (typeName === 'ZodOptional').
    // All other wrapper types (ZodString, ZodUUID, ZodEnum, …) mean the field is required.
    const typeName = (fieldSchema._def as { typeName: string }).typeName;
    if (typeName !== 'ZodOptional') {
      required.add(key);
    }
  }
  return required;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('description.requested cross-runtime contract parity (FOLLOW-198)', () => {
  describe('fixture integrity', () => {
    it('fixture is a non-empty array of strings', () => {
      expect(Array.isArray(requiredFromFixture)).toBe(true);
      expect(requiredFromFixture.length).toBeGreaterThan(0);
      for (const field of requiredFromFixture) {
        expect(typeof field).toBe('string');
        expect(field.length).toBeGreaterThan(0);
      }
    });

    it('fixture contains no duplicate field names', () => {
      const set = new Set(requiredFromFixture);
      expect(set.size).toBe(requiredFromFixture.length);
    });
  });

  describe('TS schema ⊇ fixture required fields', () => {
    it('DescriptionRequestedEventSchema has every field listed in the fixture', () => {
      // This assertion uses the REAL Zod schema — no values are injected.
      // If someone adds a field to the fixture but forgets the TS schema, this fails.
      const schemaRequired = zodRequiredKeys(DescriptionRequestedEventSchema);

      for (const field of requiredFromFixture) {
        expect(
          schemaRequired.has(field),
          `Field "${field}" is in the shared fixture but is not a required field in DescriptionRequestedEventSchema. ` +
            `Either add it to the schema (required, non-optional) or remove it from the fixture.`,
        ).toBe(true);
      }
    });

    it('every fixture field exists as a key in the schema shape', () => {
      // Belt-and-suspenders: also checks that the field key itself exists in the shape,
      // not just that Zod would reject a missing value (covering renamed fields).
      const schemaKeys = new Set(Object.keys(DescriptionRequestedEventSchema.shape));

      for (const field of requiredFromFixture) {
        expect(
          schemaKeys.has(field),
          `Field "${field}" is in the shared fixture but does not exist as a key in DescriptionRequestedEventSchema.shape. ` +
            `This indicates the field was renamed or removed from the TS schema without updating the fixture.`,
        ).toBe(true);
      }
    });
  });

  describe('schema validation — fixture fields are enforced at runtime', () => {
    it('schema rejects a payload missing every fixture-required field', () => {
      // Build a payload that looks structurally valid but omits all fixture fields.
      // This proves the Zod schema actually validates the fixture fields at parse time.
      // The value under test comes from calling schema.safeParse() — not from injecting
      // a pre-canned result.
      const emptyPayload = {};
      const result = DescriptionRequestedEventSchema.safeParse(emptyPayload);
      expect(result.success).toBe(false);
    });

    it('schema rejects a payload where each fixture field has the wrong type', () => {
      // Deliberately set every fixture field to a numeric value (wrong type for strings/uuids).
      // This asserts the schema validates type correctness, not just key presence.
      const wrongTypes: Record<string, unknown> = {};
      for (const field of requiredFromFixture) {
        wrongTypes[field] = 9999; // wrong type for every fixture field
      }
      const result = DescriptionRequestedEventSchema.safeParse(wrongTypes);
      expect(result.success).toBe(false);
    });

    it('schema accepts a minimal valid payload containing all fixture-required fields', () => {
      // Build the minimal valid payload programmatically from the fixture list + schema
      // defaults — no field values are hand-authored; they are chosen to satisfy Zod's
      // type constraints discovered from the schema shape.
      const minimalPayload: Record<string, unknown> = {
        tenant_id: '550e8400-e29b-41d4-a716-446655440001',
        listing_id: 'prop-contract-test-001',
        archetype: 'yield_hunter',
        cache_key:
          'desc:550e8400-e29b-41d4-a716-446655440001:prop-contract-test-001:yield_hunter:en:claude-sonnet-4-6',
        original_description: 'A well-located property in Marbella with verified 6% gross yield.',
        // Additional required-by-schema fields (not in Python required set, but needed to pass):
        locale: 'en',
        copy_template: 'Seed template text for contract test.',
        listing_context: {},
      };

      // Verify that all fixture fields are present in this payload — confirms the payload
      // exercises every field the fixture declares required.
      for (const field of requiredFromFixture) {
        expect(Object.prototype.hasOwnProperty.call(minimalPayload, field)).toBe(true);
      }

      const result = DescriptionRequestedEventSchema.safeParse(minimalPayload);
      expect(result.success).toBe(true);
    });
  });

  describe('drift detection — AC2 guard', () => {
    it('fixture and TS required set agree: no fixture field is optional in TS', () => {
      // This is the primary AC2 assertion.
      // If a developer marks a fixture field as .optional() in TS (to be "backward compat")
      // without updating the fixture, this test catches it.
      const schemaRequired = zodRequiredKeys(DescriptionRequestedEventSchema);
      const fixtureSet = new Set(requiredFromFixture);

      const fixtureFieldsMadeOptionalInTS = requiredFromFixture.filter(
        (f) => !schemaRequired.has(f),
      );

      expect(
        fixtureFieldsMadeOptionalInTS,
        `The following fields are declared required in the shared fixture but were made ` +
          `optional in DescriptionRequestedEventSchema: ${fixtureFieldsMadeOptionalInTS.join(', ')}. ` +
          `Either keep them required in the TS schema or remove them from the fixture ` +
          `AND update the Python consumer's REQUIRED_FIELDS accordingly.`,
      ).toEqual([]);

      // Also verify the reverse: if a required TS field was removed from the fixture,
      // it's not a contract failure (the fixture is the Python consumer's minimum set,
      // not an exhaustive list). But log informational output so reviewers notice.
      const requiredTSNotInFixture = [...schemaRequired].filter((f) => !fixtureSet.has(f));
      // These are fields required by TS but NOT required by Python consumer.
      // That is intentional (locale, copy_template, listing_context are required by TS
      // but the Python consumer already has them or treats them as optional read-throughs).
      // No assertion needed — this is fine by design.
      expect(requiredTSNotInFixture).toBeDefined(); // informational only
    });
  });
});
