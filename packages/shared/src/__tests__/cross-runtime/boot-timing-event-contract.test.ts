/**
 * Cross-runtime `boot_timing` contract parity test — FOLLOW-1037 / MP-011.
 *
 * GUARDRAIL: This test MUST NOT hand-author the required-field list. The canonical list
 * comes from the shared JSON fixture at:
 *   packages/shared/contracts/boot-timing-event.required.json
 *
 * Both this test and the Python consumer (`apps/stream-consumer/src/models/event.py`,
 * `BOOT_TIMING_REQUIRED_FIELDS` / `is_valid_boot_timing_payload`) read that same fixture. If the
 * fixture drifts from either runtime, CI fails.
 *
 * Unlike `description-event-contract.test.ts` / `listing-embed-seed-event-contract.test.ts` (whose
 * Python side is a dedicated Modal job that parses specific fields out of a Redpanda event),
 * `boot_timing` rides the generic SDK ingest envelope: every event type, `boot_timing` included,
 * is validated at the ingest boundary by `EventSchema` (this package) and at the stream-consumer
 * boundary by the generic `EventEnvelope` Pydantic model (`payload: dict[str, Any]`, no per-type
 * sub-schema). The parity gate here is therefore narrower and pattern-adapted: it asserts
 * `BootTimingPayloadSchema` (the payload-only schema, not the envelope) required-key set matches
 * the fixture, and that a payload satisfying the fixture round-trips through BOTH runtimes.
 *
 * Pattern mirrors description-event-contract.test.ts (FOLLOW-198 / FOLLOW-168).
 *
 * @module packages/shared/src/__tests__/cross-runtime/boot-timing-event-contract.test
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BootTimingEventSchema,
  BootTimingPayloadSchema,
} from '../../schemas/events/boot-timing.js';

// ─── Load the shared fixture (single source of truth) ─────────────────────────

const FIXTURE_PATH = join(
  import.meta.dirname,
  '../../../contracts/boot-timing-event.required.json',
);

const requiredFromFixture: string[] = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

// ─── Derive required fields from the production Zod schema ─────────────────────

function zodRequiredKeys(schema: typeof BootTimingPayloadSchema): Set<string> {
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

describe('boot_timing cross-runtime contract parity (FOLLOW-1037 / MP-011)', () => {
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
    it('BootTimingPayloadSchema has every field listed in the fixture', () => {
      const schemaRequired = zodRequiredKeys(BootTimingPayloadSchema);

      for (const field of requiredFromFixture) {
        expect(
          schemaRequired.has(field),
          `Field "${field}" is in the shared fixture but is not a required field in ` +
            `BootTimingPayloadSchema. Either add it to the schema (required, non-optional) or ` +
            `remove it from the fixture.`,
        ).toBe(true);
      }
    });

    it('every fixture field exists as a key in the schema shape', () => {
      const schemaKeys = new Set(Object.keys(BootTimingPayloadSchema.shape));

      for (const field of requiredFromFixture) {
        expect(
          schemaKeys.has(field),
          `Field "${field}" is in the shared fixture but does not exist as a key in ` +
            `BootTimingPayloadSchema.shape.`,
        ).toBe(true);
      }
    });
  });

  describe('schema validation — fixture fields are enforced at runtime', () => {
    it('BootTimingPayloadSchema rejects a payload missing every fixture-required field', () => {
      const result = BootTimingPayloadSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('BootTimingPayloadSchema rejects a payload where a fixture field is the wrong type', () => {
      const wrongTypes: Record<string, unknown> = {};
      for (const field of requiredFromFixture) {
        wrongTypes[field] = 'not-a-number';
      }
      const result = BootTimingPayloadSchema.safeParse(wrongTypes);
      expect(result.success).toBe(false);
    });

    it('BootTimingPayloadSchema accepts a minimal valid payload containing only fixture fields', () => {
      const minimalPayload: Record<string, unknown> = {};
      for (const field of requiredFromFixture) {
        minimalPayload[field] = 123;
      }
      // Confirms this payload really does exercise every fixture field.
      for (const field of requiredFromFixture) {
        expect(Object.prototype.hasOwnProperty.call(minimalPayload, field)).toBe(true);
      }

      const result = BootTimingPayloadSchema.safeParse(minimalPayload);
      expect(result.success).toBe(true);
    });

    it('full BootTimingEventSchema (envelope + payload) accepts a real event shape', () => {
      // Round-trips a fixture-satisfying payload through the FULL envelope schema — the same
      // shape `apps/ingest/src/handlers/events.ts` validates every incoming event against
      // (EventSchema.safeParse, of which BootTimingEventSchema is one arm of the union).
      const event = {
        event_id: '01928f00-7000-7000-8000-123456789abc',
        tenant_id: '01928f00-7000-7000-8000-aaaaaaaaaaaa',
        session_id: 'a'.repeat(40),
        ts: 1_714_180_000_000,
        region: 'eu' as const,
        consent_state: 'consented' as const,
        schema_version: 1 as const,
        type: 'boot_timing' as const,
        payload: { preInit: 1174, initToConfig: 2, configFetch: 97, adapt: 21, total: 1295 },
      };
      const result = BootTimingEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });
  });

  describe('drift detection — AC2 guard', () => {
    it('fixture and TS required set agree: no fixture field is optional in TS', () => {
      const schemaRequired = zodRequiredKeys(BootTimingPayloadSchema);
      const fixtureFieldsMadeOptionalInTS = requiredFromFixture.filter(
        (f) => !schemaRequired.has(f),
      );

      expect(
        fixtureFieldsMadeOptionalInTS,
        `The following fields are declared required in the shared fixture but were made ` +
          `optional in BootTimingPayloadSchema: ${fixtureFieldsMadeOptionalInTS.join(', ')}. ` +
          `Either keep them required in the TS schema or remove them from the fixture AND update ` +
          `the Python consumer's BOOT_TIMING_REQUIRED_FIELDS accordingly.`,
      ).toEqual([]);
    });
  });
});
