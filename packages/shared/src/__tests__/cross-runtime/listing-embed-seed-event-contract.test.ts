/**
 * Cross-runtime listing-embed-seed.requested contract parity test — FOLLOW-435.
 *
 * GUARDRAIL: This test MUST NOT hand-author the required-field list.  The canonical
 * list comes from the JSON fixture at:
 *   packages/shared/contracts/listing-embed-seed-event.required.json
 *
 * Both this test and the Python consumer (apps/llm-gateway, LEG 2 of FOLLOW-435)
 * must read that same fixture.  If the fixture drifts from either runtime, CI fails.
 *
 * Pattern mirrors description-event-contract.test.ts (FOLLOW-198 / FOLLOW-168).
 *
 * @module packages/shared/src/__tests__/cross-runtime/listing-embed-seed-event-contract.test
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ListingEmbeddingSeedRequestedEventSchema } from '../../schemas/listing-embed-seed.js';

// ─── Load the shared fixture (single source of truth) ─────────────────────────

const FIXTURE_PATH = join(
  import.meta.dirname,
  '../../../contracts/listing-embed-seed-event.required.json',
);

const requiredFromFixture: string[] = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

// ─── Derive required fields from the production Zod schema ─────────────────────

function zodRequiredKeys(schema: typeof ListingEmbeddingSeedRequestedEventSchema): Set<string> {
  const required = new Set<string>();
  for (const [key, fieldSchema] of Object.entries(schema.shape)) {
    const typeName = (fieldSchema._def as { typeName: string }).typeName;
    if (typeName !== 'ZodOptional') {
      required.add(key);
    }
  }
  return required;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('listing-embed-seed.requested cross-runtime contract parity (FOLLOW-435)', () => {
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
    it('ListingEmbeddingSeedRequestedEventSchema has every field listed in the fixture', () => {
      const schemaRequired = zodRequiredKeys(ListingEmbeddingSeedRequestedEventSchema);

      for (const field of requiredFromFixture) {
        expect(
          schemaRequired.has(field),
          `Field "${field}" is in the shared fixture but is not a required field in ` +
            `ListingEmbeddingSeedRequestedEventSchema. Either add it to the schema (required, ` +
            `non-optional) or remove it from the fixture.`,
        ).toBe(true);
      }
    });

    it('every fixture field exists as a key in the schema shape', () => {
      const schemaKeys = new Set(Object.keys(ListingEmbeddingSeedRequestedEventSchema.shape));

      for (const field of requiredFromFixture) {
        expect(
          schemaKeys.has(field),
          `Field "${field}" is in the shared fixture but does not exist as a key in ` +
            `ListingEmbeddingSeedRequestedEventSchema.shape.`,
        ).toBe(true);
      }
    });
  });

  describe('schema validation — fixture fields are enforced at runtime', () => {
    it('schema rejects an empty payload', () => {
      const result = ListingEmbeddingSeedRequestedEventSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('schema rejects a payload where tenant_id is not a UUID', () => {
      const result = ListingEmbeddingSeedRequestedEventSchema.safeParse({
        tenant_id: 'not-a-uuid',
        listing_ids: ['prop-001'],
      });
      expect(result.success).toBe(false);
    });

    it('schema rejects a payload with an empty listing_ids array', () => {
      const result = ListingEmbeddingSeedRequestedEventSchema.safeParse({
        tenant_id: '550e8400-e29b-41d4-a716-446655440000',
        listing_ids: [],
      });
      expect(result.success).toBe(false);
    });

    it('schema accepts a minimal valid payload', () => {
      const result = ListingEmbeddingSeedRequestedEventSchema.safeParse({
        tenant_id: '550e8400-e29b-41d4-a716-446655440000',
        listing_ids: ['prop-051', 'prop-052'],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('drift detection — AC2 guard', () => {
    it('fixture and TS required set agree: no fixture field is optional in TS', () => {
      const schemaRequired = zodRequiredKeys(ListingEmbeddingSeedRequestedEventSchema);

      const fixtureFieldsMadeOptionalInTS = requiredFromFixture.filter(
        (f) => !schemaRequired.has(f),
      );

      expect(
        fixtureFieldsMadeOptionalInTS,
        `The following fields are declared required in the shared fixture but were made ` +
          `optional in ListingEmbeddingSeedRequestedEventSchema: ` +
          `${fixtureFieldsMadeOptionalInTS.join(', ')}.`,
      ).toEqual([]);
    });
  });
});
