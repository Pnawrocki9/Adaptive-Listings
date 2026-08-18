-- Migration: 0038_quiz_completions_answer_path
-- FOLLOW-1020: record the walk a buyer actually took through the quiz.
--
-- Background:
--   `quiz_completions` has carried `branch` / `q1_answer` / `q2_answer` / `q3_answer` since
--   0022, but the SDK never sent them: `postQuizCompletionPing` posted only
--   { session_id, resolved_archetype, language }. The staff Quiz Completions viewer renders
--   those columns anyway, so a full Investment→Rental→Steady walk displayed as
--   "neutral (Q1 skip)" and the Branch Split card counted it as a skip. Analytics built on
--   the split were silently wrong (2026-08-17 audit).
--
-- Why a new column and not just the four that exist:
--   Since ADR-0019 the quiz tree is tenant-editable DATA, not code. An answer INDEX is only
--   meaningful against the definition that was live when it was chosen, and the fixed q1/q2/q3
--   columns cannot express a tree deeper than three questions at all. `answer_path` stores the
--   ordered pairs [{question_id, answer_index}, …] so a completion stays reconstructible after
--   an operator reorders or extends the tree. The four legacy columns keep being populated —
--   the viewer's columns and every existing query read them.
--
-- NULL, not '[]': the migration auto-applies to prod on merge (db-migrate.yml), and rows
--   written before this ticket genuinely have no reported path. NULL is what lets the viewer
--   render them as "not reported" and exclude them from the Branch Split instead of
--   flattening them into a Q1 skip — which is the defect being closed. A DEFAULT would erase
--   exactly the distinction this column exists to make.
--
-- Forward-only, purely additive (ADD COLUMN only). No backfill: there is nothing to back-fill
-- with, and inventing a path for a legacy row would re-create the misleading default.

ALTER TABLE quiz_completions
  ADD COLUMN IF NOT EXISTS answer_path jsonb;
