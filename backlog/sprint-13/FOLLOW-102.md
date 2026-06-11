# FOLLOW-102 — Quiz ON/OFF toggle

**Sprint:** 13b **Priority:** P2 **Estimated hours:** 3 **Agent:** sdk-engineer (lead) +
backend-engineer (Drizzle migration + API) **Branch:** `sdk-engineer/FOLLOW-102-quiz-toggle`
**Depends on:** none (independent) **Master Design reference:** §B.1, §E.4, §D.6

---

## Context

`tenants` table currently has a `quizConfig` (jsonb) field for quiz v1 settings (Sprint 9.5) but
does NOT have a dedicated `quiz_enabled boolean` column as the boolean SoT for the ON/OFF toggle.
`SdkConfig` (packages/sdk/src/core/config.ts) does NOT yet have a `quiz` sub-object field.

The quiz toggle is needed because tenants with high-quality chat coverage (e.g. app.estalara.com)
may find the quiz UX-invasive and want to disable it, relying on behavioral + chat NLP signals only
(§D.6 rationale). Tenants without chat need quiz as a primary archetype signal source.

This ticket is **tenant-gated OFF** for the pilot tenant under the Sprint 13b freeze rule. The
dashboard toggle ships but must default to `true` so the pilot's behavior is unchanged.

---

## Acceptance Criteria

### AC1 — DB migration: `tenants.quiz_enabled` boolean column

- Add Drizzle migration `0025_tenants_quiz_enabled.sql` adding
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quiz_enabled boolean NOT NULL DEFAULT true;`
- Update `packages/db/src/schema/tenants.ts` Drizzle schema:
  `quizEnabled: boolean('quiz_enabled').notNull().default(true)`
- Migration must pass the Rule O monotonicity CI gate — verify `_journal.json` `when` value is in
  2026 and after the previous entry's `when`.

### AC2 — Backend: `PATCH /api/tenants/:id` accepts `quiz_enabled`

- Extend `PATCH /api/tenants/:id` (or the relevant control-plane tenant-update route) to accept and
  persist `quiz_enabled: boolean`.
- Tenant-scoped: only the authenticated tenant's own record can be updated (RLS enforced).
- Return the updated tenant row (including `quiz_enabled`) in the response.
- Add ≥3 tests covering: toggle OFF, toggle ON, invalid payload.

### AC3 — SDK: `SdkConfig.quiz` sub-object + `data-quiz-enabled` attribute

- Add `quiz?: { enabled: boolean; trigger_after_n_listings?: number }` to `SdkConfig` in
  `packages/sdk/src/core/config.ts`.
- Add `DEFAULT_CONFIG` extension: `quiz: { enabled: true, trigger_after_n_listings: 3 }`.
- `readConfig()` must parse `data-quiz-enabled` attribute (string `'false'` → `false`, anything else
  → `true`) and `data-quiz-trigger` attribute (number) into the `quiz` sub-object.
- The quiz widget init path in `packages/sdk/src/index.ts` (or wherever the quiz trigger runs) must
  check `config.quiz?.enabled !== false` before rendering/triggering the quiz widget. If
  `enabled === false`, skip quiz entirely — no prompt, no widget, no quiz events.
- Add ≥4 tests: `readConfig` parses `data-quiz-enabled="false"` correctly; quiz trigger skipped when
  `enabled: false`; quiz fires normally when `enabled: true`; `trigger_after_n_listings` respected.

### AC4 — buildSnippet: emit `data-quiz-enabled` when `quiz_enabled === false`

- `buildSnippet()` in `apps/control-plane/src/components/onboarding/DetectionPreview.tsx` must
  accept the `quiz_enabled` field from the activated tenant config.
- When `quiz_enabled === false`, emit `data-quiz-enabled="false"` in the `<script>` tag.
- When `quiz_enabled === true` (default), omit the attribute (truthy default, smaller snippet).
- This is the Rule L production-producer verification: the SDK consumer (`config.ts`) reads the
  attribute that `buildSnippet` must produce.
- Add ≥2 tests: snippet with `quiz_enabled=false` contains the attribute; snippet with
  `quiz_enabled=true` omits it.

### AC5 — Dashboard toggle: `/dashboard/quiz` page (or inline in `/dashboard/settings`)

- Add a simple toggle UI at `/dashboard/quiz` (or inline in an existing settings page) that:
  - Reads the current `quiz_enabled` value from the tenant record via an authenticated GET.
  - Shows a labeled toggle: "Quiz widget" ON/OFF with a brief description matching §B.1 rationale.
  - PATCHes `/api/tenants/:id` on toggle change (optimistic update, error rollback).
- Dashboard route must be protected by the existing auth middleware.
- Add ≥2 tests: toggle renders current state; toggle action calls the PATCH endpoint.

### AC6 — Rule H compliance

- `quiz_enabled` is read from `tenants` table and fed into `buildSnippet()` (Rule L producer).
- The SDK's `readConfig()` consumes `data-quiz-enabled` (Rule I: non-test importer exists).
- No new exported symbol without a non-test caller.

---

## Files to create/modify

| File                                                                   | Change                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------- |
| `packages/db/migrations/0025_tenants_quiz_enabled.sql`                 | New SQL migration                                         |
| `packages/db/migrations/meta/_journal.json`                            | Add entry (Rule O: verify 2026 timestamp)                 |
| `packages/db/src/schema/tenants.ts`                                    | Add `quizEnabled` field                                   |
| `packages/sdk/src/core/config.ts`                                      | Add `quiz` to SdkConfig + readConfig                      |
| `packages/sdk/src/index.ts`                                            | Gate quiz trigger behind `config.quiz?.enabled !== false` |
| `apps/control-plane/src/components/onboarding/DetectionPreview.tsx`    | Emit `data-quiz-enabled` from `buildSnippet`              |
| `apps/control-plane/src/app/api/tenants/[id]/route.ts` (or equivalent) | Accept `quiz_enabled` in PATCH                            |
| `apps/control-plane/src/app/dashboard/quiz/page.tsx` (new)             | Dashboard toggle UI                                       |
| Test files for each above                                              | ≥3 tests each                                             |

---

## Constraints

- Default `quiz_enabled = true` everywhere — pilot tenant is NOT changed.
- Sprint 13b freeze rule: do NOT modify pilot-tenant data or any event schema.
- Rule O: after `pnpm db:generate`, inspect `_journal.json` entry 25 — ensure `when` is a 2026
  millisecond timestamp and strictly greater than entry 24's `when`. Patch if drizzle-kit
  year-drifts it.
- Rule R does not apply here (no intent-state mutation).
- Rule S: if you add `quiz_enabled` handling to any symmetric set (e.g. multiple tenant endpoints),
  apply to all siblings.

---

## Definition of Done

All 6 AC items pass. CI green on: Lint, Typecheck, Test (Node22), Format, Build (control-plane),
Rule H, Rule J, Migration journal monotonicity. Pre-existing-red gates (Rule I, Build (SDK), Python
tests) are non-blocking if they were red on main before this branch.

PR opened on branch `sdk-engineer/FOLLOW-102-quiz-toggle` targeting `main`.
