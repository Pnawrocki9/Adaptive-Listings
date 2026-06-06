# FOLLOW-209 — Micro-polls: single yes/no intent prompts as quiz supplement

**Sprint:** 15 **Agent:** sdk-engineer + backend-engineer **Priority:** P2 **Estimated hours:** 6
**Status:** READY **Source:** Audit §3 alternative methods analysis (2026-06-05) **Promoted:**
2026-06-06

---

## Context

The full quiz (FOLLOW-199, 2–3 questions) fires after 30 seconds and requires deliberate engagement.
For sessions that dismiss the quiz, micro-polls offer a less intrusive path: a single yes/no tap
that appears at natural pause points (after first listing view, or after 90s dwell).

Completion rate for micro-polls in real estate UX: ~60–70% vs ~20–30% for multi-question quiz. Each
micro-poll provides one Bayesian update (equivalent to one QUIZ_LIKELIHOODS axis). Used as
complement when quiz is dismissed or not yet shown.

Trigger logic: show micro-poll only if (a) quiz has NOT been completed AND (b) quiz has been
dismissed OR 90s have elapsed since session start AND (c) micro-poll has not yet been shown this
session.

## Scope

- New file `packages/sdk/src/ui/micro-poll.ts`: render a small bottom-of-screen toast (not full
  overlay) with one yes/no question. Shadow DOM, 24h localStorage cooldown.
- Three poll questions (tenant-configurable, default set):
  1. "Czy ta nieruchomość ma być inwestycją?" (yes → purpose_investment prior, no →
     purpose_personal)
  2. "Czy szukasz nieruchomości dla rodziny z dziećmi?" (yes → family_buyer boost)
  3. "Czy planujesz wynajem krótkoterminowy?" (yes → vacation_rental_investor boost)
- Questions shown in sequence: show Q1 first; if answered, show Q2 after next listing view; Q3 after
  another listing view.
- On answer: call `applyBehavioralSignal(state, 'micro_poll.answered', {question, answer})`. Add
  `'micro_poll.answered'` to `SIGNAL_LIKELIHOODS` with appropriate per-answer likelihoods.
- Add `micro_poll_question` and `micro_poll_answer` to `quiz.event` ingest event (reuse existing
  schema with `trigger: 'micro_poll'`).
- New `QuizConfig` field: `micro_polls_enabled: boolean` (default `false`) persisted to
  `tenants.quiz_config` JSONB.
- Admin UI: add micro-polls toggle to `/dashboard/quiz` page (alongside existing `enabled` toggle).

## Acceptance criteria

- [ ] AC1: Micro-poll renders as bottom toast (not full overlay), dismissible
- [ ] AC2: 3 default questions in Polish (tenant-configurable)
- [ ] AC3: `micro_polls_enabled` config field persists to DB
- [ ] AC4: `applyBehavioralSignal` with `micro_poll.answered` updates intent state
- [ ] AC5: Poll not shown if full quiz was completed this session
- [ ] AC6: Tests pass, CI green

## Definition of Done

- [ ] Branch `sdk-engineer/FOLLOW-209-micro-polls`; commits referencing [FOLLOW-209]; PR opened; CI
      green.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [FOLLOW-199] · **produces:** [micro_poll.answered signal in intent engine,
micro_polls_enabled tenant config, quiz.event micro_poll trigger variant]
