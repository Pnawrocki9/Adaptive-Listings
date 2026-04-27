---
id: TICKET-011
title: Zod schemas in packages/shared for all event types (envelope + 30 type schemas)
sprint: 1
priority: P0
agent: architect
status: BLOCKED
estimated_hours: 6
depends_on: [TICKET-010]
produces: [TICKET-012, TICKET-014]
affects_files:
  - "packages/shared/src/schemas/event.ts"
  - "packages/shared/src/schemas/events/*.ts"
  - "packages/shared/src/schemas/index.ts"
  - "packages/shared/tests/schemas/*.test.ts"
context_files:
  - docs/MASTER_DESIGN.md (sections C.1 — full event taxonomy)
  - docs/adr/0003-event-schema-and-versioning.md
labels: [sprint-1, p0, architecture, schemas]
---

# TICKET-011: Zod schemas for all event types

## Summary

Implement the event schemas as TypeScript Zod schemas in `packages/shared/src/schemas/`. This is the canonical contract used by SDK, ingest worker, stream consumers, and ClickHouse projection. ADR-0003 is the spec; this ticket is the implementation. Master Design C.1 lists 10 categories of events (page lifecycle, mouse/scroll, photo interactions, floorplan, price/feature focus, search/filter, chat, cross-listing, inquiry/conversion, device/context). Implement at least 30 event types covering all 10 categories.

## Context

ADR-0003 (just ratified in TICKET-010) defines:
- Common envelope shape (event_id, tenant_id, session_id, ts, region, consent_state, schema_version, type, payload, listing_id?, archetype_hint?)
- Per-type payload schemas as discriminated union
- Versioning rules (additive only within schema_version=1)

Master Design C.1 is the authoritative event list. Krystian (CPO) curated it from real-estate domain knowledge. Don't add or remove event types without an ADR — implement exactly what C.1 specifies.

## Scope

### In scope
- `packages/shared/src/schemas/event.ts` — `EventEnvelopeSchema` per ADR-0003
- `packages/shared/src/schemas/events/` — one file per event type (or grouped per category, your call), exporting payload schema + extended event schema
- `packages/shared/src/schemas/index.ts` — `EventSchema` discriminated union of all event types, plus type exports
- Coverage: all 10 categories from Master Design C.1, with at least 30 distinct event types implemented:
  - page lifecycle: `page.view`, `page.exit`, `tab.visible`, `tab.hidden` (4)
  - mouse/scroll: `scroll.depth`, `mouse.dwell`, `mouse.rage_click`, `mouse.exit_intent` (4)
  - photo: `photo.opened`, `photo.gallery.next`, `photo.zoomed`, `photo.dwell` (4)
  - floorplan: `floorplan.opened`, `floorplan.zoom`, `floorplan.dwell` (3)
  - price/feature: `price.hovered`, `price.compared`, `feature.expanded`, `mortgage_calc.used` (4)
  - search/filter: `search.query`, `filter.applied`, `filter.removed`, `sort.changed` (4)
  - chat: `chat.opened`, `chat.message.sent`, `chat.intent.detected` (3)
  - cross-listing: `listing.next`, `listing.compared`, `listing.bookmarked` (3)
  - inquiry/conversion: `inquiry.started`, `inquiry.completed`, `tour.requested` (3)
  - device/context: `session.started` (with device class, viewport, language, geo, time-of-day) (1)
- Comprehensive Zod-based tests: round-trip parse, fail on missing required, fail on type mismatch, success on correct shape, success on optional fields absent
- JSDoc on every exported schema with example JSON

### Out of scope
- Runtime validation in actual ingest endpoint (TICKET-012)
- ClickHouse DDL (TICKET-014)
- SDK emitting events (Sprint 3+)
- Codegen for other languages (Python, Go) — Sprint 2.5+ if needed

## Acceptance criteria

- [ ] AC1: `packages/shared/src/schemas/event.ts` exports `EventEnvelopeSchema` matching ADR-0003 exactly (event_id UUID, tenant_id UUID, session_id 32-64 chars, ts positive int, region enum 4 values, consent_state enum 4 values, schema_version literal 1, type string, payload record)
- [ ] AC2: At least 30 event types implemented across all 10 categories from Master Design C.1
- [ ] AC3: `packages/shared/src/schemas/index.ts` exports `EventSchema = z.discriminatedUnion('type', [...])` covering all 30+ types
- [ ] AC4: Each event type has its own payload schema with strong typing (e.g., `PageViewPayloadSchema` with url, referrer, viewport, device_class)
- [ ] AC5: Tests exist for every category (10 test files OR one big test file with ≥30 test cases): valid shape parses, missing required fails with helpful error, extra fields are ignored (lenient payload, strict envelope per ADR)
- [ ] AC6: Tests achieve ≥90% coverage on `packages/shared/src/schemas/`
- [ ] AC7: TypeScript types are inferred and re-exported (`type EventEnvelope = z.infer<typeof EventEnvelopeSchema>`, etc.)
- [ ] AC8: JSDoc with one example per event type (developer experience)
- [ ] AC9: All CI checks pass; bundle size of `packages/shared` (which goes into SDK) increases by <5KB minified+gzipped
- [ ] AC10: PR title `feat(shared): event schemas v1 [TICKET-011]`

## Implementation guidance

Structure suggestion:

```
packages/shared/src/schemas/
├── event.ts                          # envelope
├── events/
│   ├── index.ts                      # re-exports, EventSchema discriminated union
│   ├── page-lifecycle.ts             # 4 types in one file
│   ├── mouse-scroll.ts               # 4 types
│   ├── photo.ts                      # 4 types
│   ├── floorplan.ts
│   ├── price-feature.ts
│   ├── search-filter.ts
│   ├── chat.ts
│   ├── cross-listing.ts
│   ├── inquiry.ts
│   └── device-context.ts
└── index.ts                          # public re-exports
```

Example for a single event:

```typescript
// packages/shared/src/schemas/events/page-lifecycle.ts
import { z } from 'zod';
import { EventEnvelopeSchema } from '../event.js';

/**
 * page.view — emitted on every distinct page navigation.
 *
 * @example
 * {
 *   type: 'page.view',
 *   payload: {
 *     url: 'https://agencja.com/properties/123',
 *     referrer: 'https://google.com/search',
 *     viewport: { width: 1440, height: 900 },
 *     device_class: 'desktop'
 *   }
 * }
 */
export const PageViewPayloadSchema = z.object({
  url: z.string().url(),
  referrer: z.string().url().optional(),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  device_class: z.enum(['mobile', 'tablet', 'desktop']),
});

export const PageViewEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('page.view'),
  payload: PageViewPayloadSchema,
});

export type PageViewEvent = z.infer<typeof PageViewEventSchema>;

// ... three more events in this file (page.exit, tab.visible, tab.hidden)
```

Testing pattern:

```typescript
// packages/shared/tests/schemas/events/page-lifecycle.test.ts
import { describe, it, expect } from 'vitest';
import { PageViewEventSchema } from '../../../src/schemas/events/page-lifecycle';

describe('PageViewEventSchema', () => {
  it('parses valid event', () => {
    const valid = {
      event_id: '01928f00-7000-7000-8000-123456789abc',
      tenant_id: '01928f00-7000-7000-8000-aaaaaaaaaaaa',
      session_id: 'a'.repeat(40),
      ts: 1714180000000,
      region: 'eu',
      consent_state: 'legitimate-interest',
      schema_version: 1,
      type: 'page.view',
      payload: {
        url: 'https://example.com/listing/1',
        viewport: { width: 1440, height: 900 },
        device_class: 'desktop',
      },
    };
    expect(() => PageViewEventSchema.parse(valid)).not.toThrow();
  });
  
  it('rejects missing url', () => {
    // ...
  });
});
```

For the discriminated union:

```typescript
// packages/shared/src/schemas/events/index.ts
import { z } from 'zod';
import { PageViewEventSchema, /* ... */ } from './page-lifecycle.js';
// ... more imports

export const EventSchema = z.discriminatedUnion('type', [
  PageViewEventSchema,
  PageExitEventSchema,
  // ... all 30+ types
]);

export type Event = z.infer<typeof EventSchema>;
```

## Test plan

- Unit: at least one test per event type (30+ tests), covering parse success, parse failure on missing required, type inference smoke test
- Property-based: use `@faker-js/faker` to generate random valid events, verify all parse without errors (smoke test for schema correctness)
- Build: `pnpm --filter @estalara/shared build` succeeds
- Bundle size: `pnpm exec size-limit` confirms shared package stays under budget

## Definition of Done

- [ ] Branch `architect/TICKET-011-event-schemas`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean
- [ ] HANDOFF: TICKET-011 → TICKET-012 (ingest can validate now), TICKET-014 (ClickHouse schema can mirror these)

## Notes

- This is the most "schema-heavy" ticket in Sprint 1. Take time to get it right — every other ticket depends on these contracts.
- If Master Design C.1 is ambiguous about a specific event's payload shape, make a reasonable choice and document it in JSDoc; flag in PR description for human review.
- Don't add events not in C.1. If you think one is missing, escalate.
