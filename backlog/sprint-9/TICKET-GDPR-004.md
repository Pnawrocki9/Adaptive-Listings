# TICKET-GDPR-004 — Consent State Propagation to Decision API

**Sprint:** 9 **Agent:** backend-engineer **Priority:** P0 **Estimated hours:** 6 **Status:**
BACKLOG **Depends on:** TICKET-AB-001 (merged PR #80 — consent-aware skip already implemented for
A/B assignment; this ticket extends that pattern to personalization gating), TICKET-041 (SDK consent
banner emits `consent.granted` / `consent.denied` events — those events are the upstream signal)
**Unblocks:** (none — this completes the consent propagation chain for MVP)

## Context

TICKET-AB-001 (merged Sprint 8) implemented a `consent_state`-aware skip for A/B holdout assignment:
when `consent_state === 'opted_out'` or `'unknown'` and the tenant has consent mode enabled, the
session skips assignment and is served a default experience. AC item 3 of that ticket reads: "When
`consent_state` is `'granted'`, assignment proceeds normally."

That skip logic covers one path (A/B assignment) but not the full Decision API personalization flow.
Currently, the Decision API will generate and return archetype-adapted directives for a session
regardless of consent state if the A/B gate routes them to "treatment." This ticket completes the
circuit: consent state must gate the entire personalization response, not just the bandit
assignment.

The consent state originates from the SDK (TICKET-041, `consent.granted` / `consent.denied` events).
Those events flow through the ingest pipeline and are written to ClickHouse as part of the events
fact table. The Decision API must read (or be passed) the consent state at request time and enforce
the gate.

Master Design G.2 defines three modes. For EU-region tenants in the default "Session Mode" (Mode A),
the lawful basis is legitimate interest. For tenants who have enabled "Consent Mode" (Mode B, the
`consent_required = true` flag), personalization MUST NOT proceed without an explicit
`consent.granted` signal. This ticket implements the Mode B gate.

**Cross-reference:** TICKET-AB-001 AC item 3 (consent-aware skip) — read that implementation in
`apps/decision-api/src/lib/ab-assignment.ts` before starting. Extend, do not duplicate.

**References:**

- `docs/MASTER_DESIGN.md` section G.2 (Mode A / B / C consent strategy)
- `docs/MASTER_DESIGN.md` section H.1 (GDPR consent obligations for Mode B tenants)
- `backlog/sprint-8/TICKET-AB-001.md` AC item 3 (existing consent-aware skip pattern)
- `packages/db/src/schema/tenants.ts` — `consent_required` boolean column to add
- `packages/db/src/schema/consent_records.ts` — source of truth for session consent state

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **`consent_required` boolean added to `tenants` table.** A new column with:
   - `consent_required boolean NOT NULL DEFAULT true`
   - In the migration: set `DEFAULT true` for all tenants whose `region` resolves to `eu` or `uk`
     (column currently stored in `tenants.metadata` JSONB — check actual schema before writing
     migration). Set `DEFAULT false` for `us` and `uae` regions (UAE PDPL does not require consent
     for Mode A; CCPA does not apply until thresholds are met).
   - Rationale: EU/UK tenants default to consent-required (GDPR/UK GDPR Mode B by default); US/UAE
     tenants default to consent-not-required (legitimate interest / CCPA threshold).
   - Migration generated via `pnpm --filter @estalara/db drizzle-kit generate`.

2. **Ingest pipeline writes `consent_state` to ClickHouse events table.** When the ingest worker
   receives a `consent.granted` or `consent.denied` event from the SDK (TICKET-041), it must:
   - Map `consent.granted` → `consent_state = 'granted'`
   - Map `consent.denied` → `consent_state = 'denied'`
   - All other events without an accompanying consent signal → `consent_state = 'unknown'` Verify
     the ClickHouse `events` table has a `consent_state` column (check the DDL from TICKET-014
     output in `infra/clickhouse/`). If it is absent, add a migration file under `infra/clickhouse/`
     that adds the column with `DEFAULT 'unknown'`.

3. **Decision API gates on consent state when `consent_required = true` for the tenant.** In the
   Decision API adapt route (wherever `callLlmGateway()` or the playbook path is invoked):
   - Resolve `consent_required` from the tenant config (Redis-cached tenant config, or Postgres
     fallback — reuse the existing tenant config fetch pattern, not a new DB call per request).
   - Read `consent_state` from the inbound request context. The ingest pipeline should be attaching
     this to the session record; the adapt request body should include `consent_state` (check
     existing `AdaptRequest` schema in `packages/shared`; add `consent_state` field if absent).
   - Gate logic:
     ```
     if (tenant.consent_required && consent_state !== 'granted') {
       return default_directives (same as A/B holdout default branch)
       // do NOT emit ab_assignment event for this session
       // do NOT write to ClickHouse adaptation_decisions with personalized content
     }
     ```
   - Default directives returned when gated: the `copy_template.en` slot values from the neutral
     archetype playbook (not the detected archetype). This is identical to the holdout default
     branch in TICKET-AB-001.

4. **Consent gate is bypassed for `consent_required = false` tenants.** When the tenant's
   `consent_required` is `false`, the gate does not run and the Decision API proceeds normally
   regardless of `consent_state`. Add a test for this case (AC test item 5).

5. **Existing `ab_assignment` consent-aware skip is not broken.** The TICKET-AB-001 implementation
   in `apps/decision-api/src/lib/ab-assignment.ts` currently reads `consent_state` from the event
   payload. This ticket must not alter that logic — the two checks (A/B skip + personalization gate)
   are independent and both must apply.

6. **`consent_state` field added to `AdaptRequest` Zod schema.** In
   `packages/shared/src/schemas/decision.ts` (or wherever `AdaptRequest` is defined), add:
   - `consent_state: z.enum(['granted', 'denied', 'unknown']).default('unknown')` This is an
     additive change (backward compatible — existing callers omitting the field get the `'unknown'`
     default, which causes gating for EU tenants and no effect for non-EU tenants).

7. **ClickHouse `adaptation_decisions` captures gated responses.** When a session is gated (consent
   not granted), write a row to `adaptation_decisions` with `holdout_group = true` and a new field
   `gate_reason = 'consent_required'`. This allows analytics to distinguish consent-gated sessions
   from A/B holdout sessions. If adding a new column to `adaptation_decisions`, include the
   ClickHouse DDL migration.

8. **Test coverage ≥70% for all changed code in Decision API; ≥80% for changes in
   `packages/shared`.**

9. **No TypeScript `any` without inline `// eslint-disable` + reason.**

10. **`pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass locally.**

## Files to touch

| File                                                       | Action                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/db/src/schema/tenants.ts`                        | Add `consent_required` boolean column                                                      |
| `packages/db/migrations/`                                  | New Drizzle migration for `consent_required` column                                        |
| `packages/shared/src/schemas/decision.ts`                  | Add `consent_state` to `AdaptRequest` schema                                               |
| `apps/decision-api/src/app/api/adapt/route.ts`             | Add consent gate logic                                                                     |
| `apps/decision-api/src/lib/consent-gate.ts`                | NEW — extractable consent gate function                                                    |
| `apps/decision-api/src/lib/__tests__/consent-gate.test.ts` | NEW — unit tests                                                                           |
| `apps/ingest/src/index.ts` (or event handler)              | Ensure `consent_state` written to ClickHouse                                               |
| `infra/clickhouse/`                                        | New DDL migration: `consent_state` on events table + `gate_reason` on adaptation_decisions |

Read `backlog/sprint-8/TICKET-AB-001.md` (the full spec, not just the context paragraph) and
`apps/decision-api/src/lib/ab-assignment.ts` before starting. The consent gate in this ticket must
integrate with the A/B assignment skip without duplication.

## Test expectations

### Unit tests (required)

1. **Gate triggers for EU tenant with `consent_required = true` and `consent_state = 'unknown'`.**
   Call `consentGate({ consentRequired: true, consentState: 'unknown' })`. Assert result is
   `{ gated: true, reason: 'consent_required' }`.

2. **Gate triggers for EU tenant with `consent_required = true` and `consent_state = 'denied'`.**
   Same call with `consentState: 'denied'`. Assert `{ gated: true, reason: 'consent_required' }`.

3. **Gate does NOT trigger when `consent_state = 'granted'`.** Call with
   `consentRequired: true, consentState: 'granted'`. Assert `{ gated: false }`.

4. **Gate does NOT trigger when `consent_required = false`.** Call with
   `consentRequired: false, consentState: 'unknown'`. Assert `{ gated: false }`.

### Integration tests (required)

5. **Gated session returns default directives.** Send a mock adapt request with
   `consent_state: 'unknown'` to a mock EU tenant with `consent_required: true`. Assert the response
   contains directives sourced from the neutral archetype `copy_template.en`, not an
   archetype-specific playbook.

6. **Non-gated session returns adapted directives.** Send a mock adapt request with
   `consent_state: 'granted'` to the same tenant. Assert the response contains archetype-specific
   directives (not the neutral default).

7. **A/B holdout skip still works.** Send a mock adapt request with `consent_state: 'opted_out'`
   (TICKET-AB-001 value). Assert no `ab_assignment` event is emitted AND no personalized response is
   returned. Both gates must fire independently.

8. **Backward compatibility.** Send a mock adapt request with no `consent_state` field. Assert the
   Zod schema defaults to `'unknown'` and the gate behavior matches AC item 1 for EU tenants.

## Branch naming

`backend-engineer/TICKET-GDPR-004-consent-state-propagation`

## PR title format

`feat(decision-api,shared,db,ingest): consent state gate — Decision API + consent_required tenant flag [TICKET-GDPR-004]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- PM-orchestrator validates AC items 1–10 above, specifically AC items 3–5 (gate logic correctness).
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
