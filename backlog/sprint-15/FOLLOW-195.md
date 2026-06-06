# FOLLOW-195 — SCHEMA-001: live.signup Zod event schema

**Sprint:** 15 **Agent:** backend-engineer **Priority:** P0 **Estimated hours:** 3 **Status:** READY
**Source:** Audit F-09, Master_Design v3.7 SCHEMA-001 **Promoted:** 2026-06-05

---

## Context

The primary conversion event for the Adaptive Listings pilot is `live.signup` (user books a live
session slot on a listing) OR `chat.contact_initiated` (user initiates chat with an agent). These
were ratified as the canonical conversion events in Master_Design v3.7 (CEO decision D-4,
2026-05-30).

**`live.signup` has no Zod schema.** There is no `packages/shared/src/schemas/events/live.ts`. The
event is neither validated, nor stored in ClickHouse with a typed schema, nor consumed by the
feedback route. Without this schema, Thompson sampling never receives positive outcome signals and
the pilot CTA-lift measurement window produces no conversion attribution.

SCHEMA-001 is a Track B (Week 2) prerequisite. FOLLOW-196 (CustomEvent hooks in Estalara-app) and
FOLLOW-197 (SDK listeners) both depend on this schema being defined first.

Additionally, `packages/sdk/src/core/adapt.ts:243` has `registerFeedbackListener` with default
`feedbackEvents: ['inquiry.completed']` — this must be updated to include `live.signup` as the
primary conversion event per the v3.7 CEO decision.

## Scope

- Create `packages/shared/src/schemas/events/live.ts` with a `LiveSignupEventSchema` (Zod). Schema
  must include at minimum: `event_type: 'live.signup'`, `session_id: string`, `tenant_id: string`,
  `listing_id: string`, `slot_uuid: string`, `timestamp: number`.
- Export `LiveSignupEventSchema` from `packages/shared/src/index.ts`.
- Check whether a new ClickHouse column is required in `apps/ingest/src/` for `live.signup` events
  (they likely route through the existing `events` table; confirm the column/discriminator
  handling). If a migration is needed, add it to `infra/clickhouse/migrations/`.
- Update `packages/sdk/src/core/adapt.ts:243`: change `registerFeedbackListener` default
  `feedbackEvents` to include `'live.signup'` as the primary conversion event (alongside or
  replacing `'inquiry.completed'` per v3.7 decision D-4).

## Acceptance criteria

- [ ] AC1: `LiveSignupEventSchema` exported from `packages/shared/src/index.ts`. Zod validation
      passes for a valid `live.signup` event object.
- [ ] AC2: ClickHouse migration applied (or confirmed not needed with explanation) for `live.signup`
      event type.
- [ ] AC3: `registerFeedbackListener` default in `adapt.ts` includes `'live.signup'` as a primary
      conversion event.
- [ ] AC4: Unit tests cover schema validation (valid + invalid payloads). CI green.

## Definition of Done

- [ ] Branch `backend-engineer/FOLLOW-195-schema-001-live-signup`; commits referencing [FOLLOW-195];
      PR opened; CI green.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [] · **produces:** [FOLLOW-196, FOLLOW-197, FOLLOW-200 (quiz_completions conversion
tracking)]
