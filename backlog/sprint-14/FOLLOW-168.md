# FOLLOW-168 — Cross-language event-contract parity gate for `description.requested` (TS Zod publisher ⟷ Python consumer)

**Sprint:** 14 **Agent:** qa-engineer + backend-engineer **Priority:** P1 **Estimated hours:** 3
**Status:** READY **Source retro:** RETRO-028 §3 (TG-1) **Source ticket:** TICKET-DESC-001 (PR #182)
**Promoted:** 2026-06-03 (by human request)

---

## Context

ESC-018's root cause was that the TypeScript publisher's event shape
(`DescriptionRequestedEventSchema`, `packages/shared/src/schemas/description.ts`) and the Python
consumer's hand-written `required` field set (`apps/llm-gateway/src/jobs/generate_description.py`
`consume_description_requests()`, ~`:1095`) drifted apart **with nothing failing** — each runtime
tested only its own copy, so `original_description` was required by the consumer but never sent by
the producer, silently dropping every message on the real Redpanda→Modal path from the original
pipeline merge until ADR-0009 surfaced it.

PR #182 fixed the **data** (added the field + producer write + verified consumer read) but added
**no parity gate**. This ticket adds the missing verification: a single shared contract artifact
asserted by **both** runtimes so the next field added to one side without the other fails CI.

This is the cross-language analogue of **Rule J** (which today only gates TS↔TS mirror files) and
**Rule H** (same-runtime Zod scaffold). RETRO-028 §6 logged the pattern as a watch-item at count 1
(below the RULE_PROMOTION_THRESHOLD of 2); a second occurrence promotes it to a codified Rule.

**Related but distinct:** ESC-019 (production backend auth gap) is the _reachability_ half of the
same ticket's verification debt — out of scope here; this ticket is purely the publisher⟷consumer
field-set contract.

## Scope

### In scope

- A single source of truth for the `description.requested` required-key set.
- An assertion in the **TS/Vitest** path and in the **Python/pytest** path (or one path reading the
  other's checked-in artifact) that pins producer/consumer agreement.
- A negative regression test proving CI fails when one side adds/removes a required field.

### Out of scope

- Production backend auth / reachability (ESC-019).
- Generalising the gate to other event topics (`estalara.events`, etc.) — may be a follow-up if the
  pattern recurs, but this ticket targets `description.requested` only.

## Acceptance criteria

The ticket is DONE when ALL of these are true:

- [ ] AC1: The TS `DescriptionRequestedEventSchema` required-key set is asserted to be a superset of
      the Python consumer's `required` set, derived from a **single shared source of truth** (a
      checked-in JSON fixture listing canonical required keys, OR a Zod-generated artifact consumed
      by the Python test).
- [ ] AC2: A regression test proves (by negative case) that adding a required field to either
      runtime without the other fails CI.
- [ ] AC3: The gate runs in both the JS/Vitest path and the Python/pytest path (or one path reads
      the other's checked-in artifact), and is wired into CI.
- [ ] AC4: Lint, typecheck, build pass in CI.

## Implementation guidance

Strategy options (pick one, document the choice):

- **(a)** A checked-in JSON fixture (e.g.
  `packages/shared/contracts/description-event.required.json`) listing canonical required keys, read
  by a new `packages/shared/__tests__/cross-runtime/description-event-contract.test.ts` AND by
  `apps/llm-gateway/src/jobs/test_generate_description.py`.
- **(b)** A generated artifact from the Zod schema (build step) consumed by the Python test.

Option (a) is lower-machinery and recommended for a single topic.

## Test plan

- Unit (TS): assert `DescriptionRequestedEventSchema` requires ⊇ shared fixture keys.
- Unit (Python): assert `consume_description_requests()` `required` set == shared fixture keys.
- Negative: a test (or CI dry-run) demonstrating drift is caught.

## Definition of Done (universal)

- [ ] Branch named `<agent>/FOLLOW-168-<slug>`
- [ ] Conventional commits referencing [FOLLOW-168]
- [ ] PR opened with FOLLOW-168 in title
- [ ] All ACs verified
- [ ] CI green (typecheck, lint, test, build)
- [ ] `promoted_to_queue: true` and status synced in `backlog/FOLLOW_UPS.md`
- [ ] `retro_completed` handled by PM post-merge
