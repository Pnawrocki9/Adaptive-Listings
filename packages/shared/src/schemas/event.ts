/**
 * Event envelope shared by all Estalara events.
 *
 * Spec: ADR-0003 (docs/adr/0003-event-schema-and-versioning.md). Master Design C.1 lists the
 * authoritative event taxonomy. Every per-type event schema is built by extending this envelope
 * with a discriminator on `type` and a typed `payload`.
 *
 * Versioning rules (within `schema_version: 1`):
 * - Adding new event types: OK
 * - Adding optional payload fields: OK
 * - Adding new enum values: OK (consumers must default on unknown)
 * - Removing/renaming fields or changing types: NEVER (requires schema_version bump + new ADR)
 *
 * @module @estalara/shared/schemas/event
 */

import { z } from 'zod';

import { noPii } from './pii-blacklist.js';

/** Geographic regions Estalara deploys to. */
export const RegionSchema = z.enum(['eu', 'us', 'uk', 'uae']);
export type Region = z.infer<typeof RegionSchema>;

/**
 * Consent state under which the event was captured. Drives downstream privacy gating
 * (cross-tenant aggregation, persistence). See Master Design G.2 + H.1.
 */
export const ConsentStateSchema = z.enum([
  'none',
  'session-only',
  'legitimate-interest',
  'consented',
]);
export type ConsentState = z.infer<typeof ConsentStateSchema>;

/**
 * Common envelope. Every Estalara event (regardless of `type`) MUST satisfy this shape.
 *
 * Per ADR-0003: envelope is validated strictly; payload validation per-type is lenient
 * (unknown payload fields are ignored, not rejected) so that producers can ship additive
 * payload changes without coordinated consumer updates.
 *
 * @example
 * {
 *   event_id: '01928f00-7000-7000-8000-123456789abc',
 *   tenant_id: '01928f00-7000-7000-8000-aaaaaaaaaaaa',
 *   session_id: 'a'.repeat(40),
 *   ts: 1714180000000,
 *   region: 'eu',
 *   consent_state: 'legitimate-interest',
 *   schema_version: 1,
 *   type: 'page.view',
 *   payload: { url: 'https://example.com/listing/1', viewport: { width: 1440, height: 900 }, device_class: 'desktop' }
 * }
 */
const EventEnvelopeBaseSchema = z.object({
  /** UUIDv7 generated client-side at event creation. */
  event_id: z.string().uuid(),

  /** Tenant that owns the event. UUID. */
  tenant_id: z.string().uuid(),

  /**
   * Tab-scoped random session identifier. 32–64 chars.
   *
   * The SDK mints a 36-char UUID v4 (FOLLOW-1106 / ESC-070 Path C —
   * `packages/sdk/src/core/session.ts`). Sessions minted before that ticket
   * carry a 64-char hex value and remain valid for the life of their tab, so
   * this bound must keep accepting BOTH shapes. Do not narrow it to a fixed
   * length or a hex-only pattern.
   */
  session_id: z.string().min(32).max(64),

  /** Milliseconds since Unix epoch (client clock). */
  ts: z.number().int().positive(),

  /** Region the request was served from. */
  region: RegionSchema,

  /** Consent state at event time. */
  consent_state: ConsentStateSchema,

  /** Schema major version. Bump only via new ADR superseding ADR-0003. */
  schema_version: z.literal(1),

  /** Event type discriminator (e.g. `page.view`, `chat.message.sent`). */
  type: z.string().min(1),

  /** Type-specific payload. Validated leniently per type via discriminated union. */
  payload: z.record(z.unknown()),

  /** Listing the event refers to (optional — not all events are listing-scoped). */
  listing_id: z.string().optional(),

  /** Server-side annotation written by the intent engine. SDK MUST NOT set this. */
  archetype_hint: z.string().optional(),
});

export { EventEnvelopeBaseSchema };

/**
 * PII-validated event envelope. Use this for all ingest validation.
 * Per-event schemas use EventEnvelopeBaseSchema.extend() internally.
 */
export const EventEnvelopeSchema = EventEnvelopeBaseSchema.superRefine((data, ctx) => {
  noPii(data.payload, ctx, ['payload']);
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
