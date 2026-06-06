# FOLLOW-202 — Navigator.language browser detection for quiz

**Sprint:** 15 **Agent:** sdk-engineer **Priority:** P2 **Estimated hours:** 2 **Status:** READY
**Source:** Audit §10.1 multilanguage section **Promoted:** 2026-06-05

---

## Context

The quiz widget already supports `en`, `pl`, and `es`. However, language is read exclusively from
the `data-language` attribute on the `<script>` tag. If the attribute is absent or unrecognized, the
SDK falls back to hardcoded `'en'` — `navigator.language` is never consulted.

Master_Design v4.0 §E.4.6 specifies a 4-level language resolution priority:

1. `quizConfig.language` — admin-set per-tenant preference (from DB via `/api/quiz/config`)
2. `data-language` attribute — embed-time attribute on the `<script>` tag
3. `navigator.language` — browser's declared language (e.g., `'pl-PL'` → `'pl'`)
4. `'en'` — hardcoded fallback

This ticket implements level 3 (browser language detection fallback). Level 1 already exists via the
quiz config API. Level 2 already exists.

Additionally, the admin config schema has a gap: `QuizConfig.language` accepts only `'en' | 'pl'`
but the widget supports `'es'`. The `'es'` addition is part of FOLLOW-199 but is noted here as a
dependency check.

## Scope

- `packages/sdk/src/core/config.ts:89–91`: after reading `data-language` attribute — if absent or
  unrecognized (not in `['en', 'pl', 'es']`) — try `navigator.language.slice(0, 2)`. Map detected
  language: if in `['en', 'pl', 'es']` → use it; otherwise → `'en'`.
- Ensure the language resolution order is documented in a JSDoc comment at the relevant config
  resolution point.
- Verify `QuizConfig.language` in `apps/control-plane/src/app/api/quiz/config/route.ts:25,41`
  includes `'es'` (may already be done by FOLLOW-199 — if so, mark as verified).

## Acceptance criteria

- [ ] AC1: SDK with no `data-language` attribute and `navigator.language = 'pl-PL'` → quiz renders
      in Polish. Unit test covers this.
- [ ] AC2: SDK with no `data-language` attribute and `navigator.language = 'de-DE'` (unsupported) →
      quiz renders in English (fallback). Unit test covers this.
- [ ] AC3: SDK with `data-language="en"` ignores `navigator.language` regardless of browser setting.
- [ ] AC4: `QuizConfig.language` schema accepts `'es'` (verified from FOLLOW-199 or added here).
- [ ] AC5: CI green.

## Definition of Done

- [ ] Branch `sdk-engineer/FOLLOW-202-navigator-language-detection`; commits referencing
      [FOLLOW-202]; PR opened; CI green.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [FOLLOW-199 (for 'es' QuizConfig change — can be done in either ticket)] ·
**produces:** [automatic Polish/Spanish quiz for matching-language browsers with no tenant config
required]
