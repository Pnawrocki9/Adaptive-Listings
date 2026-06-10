# FOLLOW-263 — Repoint pilot-freeze guard at tenants.quiz_enabled

**Sprint:** 13b hardening (MUST land before TICKET-PILOT-001 measurement window opens) **Priority:**
P2 **Estimated:** 2h **Agent:** backend-engineer **Depends on:** FOLLOW-102 **Source:** RETRO-049
§4a LG-2 — restores RETRO-012/FOLLOW-117 closure

## Problem

The pilot-freeze guard (introduced by RETRO-012/FOLLOW-117) is designed to prevent quiz state
changes from contaminating the CTA-lift measurement window. It reads the quiz enabled/disabled state
from the JSONB `settings.quizConfig.enabled` column.

FOLLOW-102 moved the quiz source-of-truth to `tenants.quiz_enabled` (a typed boolean column,
migration 0025). The JSONB path was not updated. Result: the freeze guard is now silently blind to
the actual quiz state — a tenant can toggle quiz via the new dashboard control while the freeze
guard reads stale data from the old JSONB column and allows the change.

This re-opens the RETRO-012/FOLLOW-117 closure. It must be fixed before TICKET-PILOT-001's
measurement window begins, or the CTA-lift measurement is invalid.

## Fix

Repoint the freeze guard read from `settings.quizConfig?.enabled` to `tenants.quiz_enabled`.

Find the freeze guard logic (likely in `apps/control-plane/src/app/api/tenants/[id]/route.ts` or a
middleware/service layer it calls) and update the quiz-state read to use the new column.

If both columns still exist simultaneously (the JSONB `quizConfig.enabled` was not removed by
FOLLOW-102), document which is the authoritative SoT and add a comment. The correct SoT is
`tenants.quiz_enabled` per FOLLOW-102.

## Acceptance Criteria

- [ ] **AC1:** The pilot-freeze guard reads quiz enabled/disabled state exclusively from
      `tenants.quiz_enabled`, not from JSONB `settings.quizConfig.enabled`.
- [ ] **AC2:** A test covers the freeze guard firing correctly when `tenants.quiz_enabled = false`
      AND when `tenants.quiz_enabled = true` — verifying the guard reads the typed column.
- [ ] **AC3:** A test specifically covers the scenario where `quiz_enabled` changes during a freeze
      window — the guard correctly blocks or allows based on `tenants.quiz_enabled`.
- [ ] **AC4:** The freeze guard does NOT fire for `pilotFrozen = true` + `quiz_enabled = false`
      (freeze guard is irrelevant if quiz is already off).
- [ ] **AC5:** RETRO-012 / FOLLOW-117 precedent cited in fix comment.

## Key files

- `apps/control-plane/src/app/api/tenants/[id]/route.ts` — PATCH handler (FOLLOW-102 added this)
- Wherever the freeze guard lives (grep for `pilotFrozen`, `quizConfig`, `freeze`)
- `packages/db/src/schema/tenants.ts` — `quizEnabled` column (FOLLOW-102 migration 0025)

## Branch

`backend-engineer/FOLLOW-263-freeze-guard-quiz-sot`
