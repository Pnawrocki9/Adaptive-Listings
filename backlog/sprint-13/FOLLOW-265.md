# FOLLOW-265 — Reconcile pilot-freeze guard narrowing: restore Lane-C coverage OR ratify quiz-only + sync PILOT_FREEZE_RULE.md

**Sprint:** 13b **Agent:** backend-engineer **Priority:** P1 **Estimated hours:** 3 **Status:**
IN_PROGRESS **Source retro:** RETRO-051 (§4a LG-1; §4a LG-2; §4d DG-1; §4c TG-1; §5a/§5c/§5d)
**Source ticket:** FOLLOW-263 / PR #260 (`56b6d66`) **Promoted:** 2026-06-10

---

## Context

FOLLOW-263 (PR #260) repointed the pilot-freeze guard's quiz axis from JSONB `quizConfig.enabled` to
the typed `tenants.quiz_enabled` column — correct, end-to-end verified. However the rewrite REPLACED
the whole `LANE_C_FLAG_KEYS` multi-flag set (`lane_c_active`, `intent_engine_enabled`,
`enabled`/quiz, `shadow_mode_override`, old `route.ts:90-94`) with a single
`if (!row.quizEnabled) return;` at `apps/control-plane/src/app/api/adapt/route.ts:142`.

The three dropped flags never had a producer (grep across apps/packages/migrations/json confirmed
zero writers — no live coverage was lost), BUT:

- `intent_engine_enabled` was the documented hook for the chat-intent Lane-C feature
  (FOLLOW-087/100/101 merged and classified SHADOW-ONLY by PILOT_FREEZE_RULE.md:39)
- `docs/ops/PILOT_FREEZE_RULE.md:93-95` + `:100-105` still describe the guard as reading
  `tenants.quizConfig` and emitting `active_lane_c_flags: [...]` over a 4-flag set — both gone
- The log payload field renamed `active_lane_c_flags: string[]` → `quiz_enabled: boolean` with no
  sweep of downstream log-alerts/dashboards
- Legacy `quizConfig.enabled` is now read by nothing (third consecutive retro flagging this JSONB
  blob decay)

The pilot-freeze safety backstop was narrowed as a side-effect of a single-axis ticket, and its
ratified Decision-3 contract doc now contradicts the code. This MUST be reconciled before
TICKET-PILOT-001 opens the CTA-lift measurement window.

---

## Key files

- `apps/control-plane/src/app/api/adapt/route.ts` (~`:142` — the current single-check guard)
- `docs/ops/PILOT_FREEZE_RULE.md` (`:93-95`, `:100-105` — stale description)
- `packages/db/src/schema/tenants.ts` (`quizConfig` JSONB field — orphaned key)
- Any Sentry/Grafana saved searches keying on `active_lane_c_flags`

---

## Acceptance criteria

- [ ] AC1 (LG-1): DECIDE explicitly — either (a) restore forward-compatible Lane-C multi-flag
      coverage (read the typed `quiz_enabled` column AND a documented mechanism for future Lane-C
      flags such as `lane_c_active` / `intent_engine_enabled` / `shadow_mode_override`), OR (b)
      ratify "quiz_enabled only; other Lane-C features controlled by merge-discipline + PR
      checklist, not the runtime backstop." Either choice is valid; this ticket codifies whichever
      the backend-engineer deems appropriate given the current state (no CEO pre-approval required —
      this is an internal implementation decision, not a pricing/compliance/vendor call).
- [ ] AC2 (DG-1): Update `docs/ops/PILOT_FREEZE_RULE.md` to match the chosen contract — the
      §runtime-warning paragraph (`:93-95`, remove `tenants.quizConfig` + `active_lane_c_flags`
      references), the watched-flag list (`:100-105`), and Decision 3 — so code and doc agree.
- [ ] AC3 (§5c): Document the `active_lane_c_flags` → `quiz_enabled` log-field rename for ops and
      update any Sentry/Grafana saved-search or alert that keyed on `active_lane_c_flags` (or
      confirm none exists in the observability config and record that confirmation inline).
- [ ] AC4 (LG-2): Retire or explicitly annotate the now-orphaned `quizConfig.enabled` legacy JSONB
      key (read by nothing after the repoint) — reconcile the two-store divergence that RETRO-049
      §5d and RETRO-051 §5d both flagged.
- [ ] AC5 (TG-1): Add a test that pins whichever contract AC1 chooses (e.g. if quiz-only is
      ratified, a test asserting a hypothetical non-quiz Lane-C flag does NOT fire, with an
      "intentional — FOLLOW-265" comment; if multi-flag restored, a test asserting it fires).
- [ ] AC6: Fix the minor `route.ts:92` "(Rule H — FOLLOW-263)" mis-citation — the relevant precedent
      is RETRO-012/FOLLOW-117 SoT-alignment, not Rule H.
- [ ] AC7: Lint, typecheck, tests pass in CI.

---

## Test plan

- Unit: test that the freeze guard fires / does not fire per the AC1-chosen contract (AC5).
- Grep confirm: `active_lane_c_flags` absent from all non-test production files after rename (AC3
  evidence).
- Doc diff: PILOT_FREEZE_RULE.md updated to match the chosen contract (AC2).

---

## Definition of Done (universal)

- [ ] Branch named `backend-engineer/FOLLOW-265-<slug>`
- [ ] Conventional commits referencing [FOLLOW-265]
- [ ] PR opened with FOLLOW-265 in title
- [ ] All ACs verified
- [ ] CI green (typecheck, lint, test, build)
- [ ] `promoted_to_queue: true` in FOLLOW_UPS.md confirmed
- [ ] `retro_completed` handled by PM post-merge

---

## Cross-references

- Source: RETRO-051 (§4a LG-1/LG-2, §4d DG-1, §4c TG-1)
- Precedent: RETRO-012 / FOLLOW-117 (SoT-alignment pattern — cite this, not Rule H)
- Handoff: FOLLOW-102 (established `tenants.quiz_enabled` as the SoT column)
- Sequence: MUST complete before TICKET-PILOT-001 measurement window opens
