# ADR-0003: Event Schema Design and Versioning Strategy

## Status

ACCEPTED — 2026-04-29

## Context

Estalara Adaptive Listings ingests behavioral events from embedded SDK at ~6M events/day target
(Year 1, peak 70k/sec). Events flow through a pipeline of independently versioned services:

```
SDK (browser) → Cloudflare Worker (ingest) → Redpanda (queue) → Modal Stream Consumer → ClickHouse (storage) → Modal Intent Engine (real-time) → Dashboard (control plane)
```

Every component evolves independently — SDK gets minor updates, ingest worker gets refactors,
ClickHouse schemas migrate. We need a versioning contract that:

1. **Survives independent deployments** — a new SDK version can talk to old ingest, an old SDK can
   talk to new ingest
2. **Allows additive changes** without coordinated deploys
3. **Catches breaking changes** at compile time / CI, not in production
4. **Travels with every event** — no out-of-band schema registry needed in MVP
5. **Maps cleanly to ClickHouse** for storage efficiency and query performance

## Decision

We adopt the following event envelope and versioning strategy.

### Envelope (ALL events share this shape)

> **CORRECTION — 2026-08-24 (FOLLOW-1105 / ESC-070), appended not rewritten.** The
> `// HMAC fingerprint hash` comment on `session_id` below describes an identifier that **never
> existed in this codebase**. From the SDK's first commit (`852f5dee`, 2026-05-10) the shipped value
> was an unkeyed `SHA-256` over four browser attributes — no tenant secret, no day bucket, no
> rotation — and since FOLLOW-1106 (`d9160da0`, 2026-08-24) it is a **random UUID v4** carrying no
> device input at all. The `min(32).max(64)` bound is unchanged and still admits both shapes: legacy
> 64-char hex rows and 36-char UUIDs coexist, and nothing re-derives or migrates them. The line is
> left in place because this ADR is a record of what was decided, not of what is true today; the
> mechanism of record is `docs/compliance/dpia.md` §2.2.1, and it is enforced by
> `scripts/check-session-identifier-corpus-sync.mjs`.

```typescript
// packages/shared/src/schemas/event.ts
import { z } from 'zod';

export const EventEnvelopeSchema = z.object({
  // Routing & identity
  event_id: z.string().uuid(), // UUIDv7 client-generated
  tenant_id: z.string().uuid(),
  session_id: z.string().min(32).max(64), // HMAC fingerprint hash

  // Time & geography
  ts: z.number().int().positive(), // ms since epoch (client clock)
  region: z.enum(['eu', 'us', 'uk', 'uae']),

  // Compliance
  consent_state: z.enum(['none', 'session-only', 'legitimate-interest', 'consented']),

  // Schema versioning
  schema_version: z.literal(1), // increments on breaking changes

  // Event-specific
  type: z.string(), // e.g. "page.view", "chat.message.sent"
  payload: z.record(z.unknown()), // typed per `type` (see below)

  // Optional context
  listing_id: z.string().optional(),
  archetype_hint: z.string().optional(), // populated server-side, not by SDK
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
```

### Per-type payload schemas (discriminated union)

Each event type has its own payload schema:

```typescript
// packages/shared/src/schemas/events/page-view.ts
export const PageViewPayloadSchema = z.object({
  url: z.string().url(),
  referrer: z.string().url().optional(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  device_class: z.enum(['mobile', 'tablet', 'desktop']),
});

export const PageViewEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('page.view'),
  payload: PageViewPayloadSchema,
});
```

A central `EventSchema` is a discriminated union of all per-type schemas, used for validation at
every boundary.

### Versioning rules

**Within a major schema_version, only ADDITIVE changes:**

- Adding new event types — OK
- Adding optional payload fields — OK
- Adding new enum values — OK (consumers must `default` on unknown)
- Removing or renaming fields — NEVER (breaking, requires schema_version bump)
- Changing field types — NEVER (breaking, requires schema_version bump)

**Bumping schema_version:**

- Requires new ADR superseding this one
- Requires migration plan (parallel ingestion of v1+v2 for ≥2 weeks)
- Requires consumer updates before SDK update (consumers ready before producers send)

### Forward compatibility

Consumers MUST:

- Ignore unknown fields in payload (don't crash)
- Default to neutral behavior on unknown event types (log, don't crash)
- Validate envelope strictly, validate payload leniently (warn, don't block)

### Storage in ClickHouse

ClickHouse `events` table stores `payload` as ZSTD-compressed JSON String. Materialized views
project specific event types into typed columns for fast queries:

```sql
CREATE MATERIALIZED VIEW page_views_mv
TO page_views_table
AS SELECT
  event_id, tenant_id, session_id, ts, region, listing_id,
  JSONExtractString(payload, 'url') AS url,
  JSONExtractInt(payload, 'viewport', 'width') AS viewport_width,
  ...
FROM events WHERE type = 'page.view';
```

This keeps the canonical events table polymorphic while giving fast typed access for analytics.

## Consequences

### Positive

- **Independent deployment:** SDK v1.4 ships, ingest stays v1.2, both work
- **Type safety end-to-end:** Zod schemas in packages/shared used by SDK, ingest, control-plane
- **Cheap evolution:** new event types added in one PR (schema + producer + consumer)
- **Compliance traceable:** consent_state on every event, forensically auditable

### Negative

- **Storage cost:** JSON payload is more verbose than columnar; mitigated by ZSTD compression and
  materialized views
- **Validation cost on hot path:** Zod parse on every ingest event — measured ~0.5ms p50, acceptable
  within 50ms budget
- **Schema discipline required:** developers must remember "additive only" rule; CI gate planned for
  schema diff check

### Risks

- A malformed schema deployment could cascade to consumers; mitigated by canary deploys and Great
  Expectations contracts in data quality job
- Forward-compat assumptions could mask real bugs; mitigated by strict envelope validation +
  comprehensive logging of "unknown type" / "unknown field" cases

### Reversibility

Medium. Switching to a different schema serialization (e.g., Protobuf, Avro) would require migrating
SDK, all 6 consumers, and ClickHouse storage. Estimated 4-6 weeks of cross-cutting work. Worth it
only if we hit clear performance walls with JSON (>20% latency or >50% storage cost increase).

## Alternatives considered

### Alternative A: Protobuf over JSON

**Pros:** smaller wire size (~30-40%), faster parse (~5x), schema-first development.

**Cons:**

- SDK bundle bloat (~50-100KB protobuf-js library, blows our 25KB budget)
- Browser support limited
- Toolchain complexity (codegen, .proto files in monorepo)
- ClickHouse JSON support is excellent; protobuf adds friction for ad-hoc analytics

**Rejected:** SDK bundle budget is non-negotiable. Wire size savings irrelevant when we're CPU-bound
at consumer side, not network-bound.

### Alternative B: Schema Registry (Confluent / Karapace)

**Pros:** central source of truth, version negotiation, can break compat detection at producer time.

**Cons:**

- Adds operational complexity (another service to maintain)
- Adds latency (registry lookup at boundary or aggressive caching)
- Doesn't fit Cloudflare Worker (no persistent connections, cold start sensitivity)
- Overkill for MVP

**Rejected:** premature for our scale. Revisit at Y2 if we cross 100 event types or 50 tenants
writing custom events.

## References

- Master Design: section C.1 (event taxonomy), C.2 (ingestion strategy), I (tech stack)
- ADR-0001: Event Schema (proposed, superseded by this one)
- packages/shared/src/schemas/event.ts (implementation)
- packages/shared/src/schemas/events/\*.ts (per-type schemas)
- https://docs.confluent.io/platform/current/schema-registry/fundamentals/index.html (alternative
  considered)
