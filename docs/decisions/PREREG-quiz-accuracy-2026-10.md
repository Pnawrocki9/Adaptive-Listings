# Pre-registration — quiz archetype accuracy ≥ 90 % (Faza Q, 2026-10)

**Status:** pre-registered 2026-10-19 (CEO decision Q-J, `docs/PLAN-QUIZ-ACCURACY-2026-10-19.md`),
**before any production data exists**. This file is frozen once the first production `quiz_runs` row
lands; later changes are appended as dated amendments, never edited in place. Owner: PM; the
analysis is run once, by the CTO, at checkpoint KQ3 (production), and its verdict goes to
MASTER_DESIGN §Snapshot.0. Localhost proves the pipeline and the arithmetic (golden fixtures), never
the claim.

## 1. Claim under test

"After the buyer's answers, the quiz alone identifies one of the 12 archetypes (+ neutral) with at
least 90 % accuracy." Ground truth = the buyer's own confirmation at the end of the quiz (CEO
decision Q-A). The quiz alone, not quiz + behaviour + chat (Q-B).

## 2. Population and unit

- Unit: one `quiz_runs` row (one quiz shown to one session), production tenant app.estalara.com.
- Eligible ("decided") rows: `status IN ('confirmed','corrected')`,
  `resolved_archetype <> 'neutral'`, one frozen `definition_hash`, staff/ops-key traffic excluded
  (sessions tagged by the control plane as staff or driven by `ADMIN_API_SECRET`), the harness
  tenant excluded.
- A change of `definition_hash` (any edit to questions, answers, weights, traits or confirmation
  texts) restarts the count from zero.
- Language: EN and PL rows pooled for the headline; reported separately.

## 3. Primary metric and pass criterion

- A = confirmed / (confirmed + corrected).
- Fixed sample: **n = 400** decided rows on one hash.
- **PASS** iff the two-sided 95 % Wilson score interval's lower bound on A is ≥ 0.90, i.e. at least
  **372 / 400** confirmed (371 fails). Reference: observed 95 % needs n ≥ 127, 94 % needs 204, 93 %
  needs 362, 92 % needs 830 (`packages/shared/src/stats/wilson.ts` pins these).
- **One analysis only.** Futility looks at n = 130 and n = 200: if the Wilson upper bound is below
  0.90, stop, fix the tree, which changes the hash and restarts the count.
- Validity conditions (reported next to the headline, the claim is void if unmet): response rate =
  decided / completed ≥ 60 %; the pessimistic variant (unconfirmed counted as wrong) is reported;
  the fast-"yes" share (`result_ms` < 1.5 s) is reported, never excluded.

## 4. Secondary metrics (reported, not gated)

Precision per leaf; recall per true class (true = confirmed leaf, or the correction target); macro
recall over classes with ≥ 30 true labels; the confusion matrix with a `none_of_these` column;
accuracy by language and by speed tertile; monthly rows. Per-class claims only where n_true ≥ 100; a
class is flagged when its recall lower bound is < 0.80 (at n = 100: fewer than 88 correct).

## 5. Acquiescence check

A stratified sample of ~60 decided runs (≥ 5 per frequent leaf) is labelled by Estalara agents after
first contact, blind to the quiz result, using the labelling rules of the plan §A. Cohen's κ between
the agent label and the self-confirmation is reported; κ < 0.6 means the self-confirmation is not
trustworthy as ground truth and the claim is downgraded to "self-reported", whatever A says.

## 6. What may NOT be changed after data arrives

The metric, the n, the thresholds, the eligibility rules, the futility rule. Adding a secondary
metric is allowed as a dated amendment below.

## 7. Monitoring after the verdict

Monthly: the backoffice tab `/admin/tenants/[id]/quiz-accuracy` recomputes the rows on read; a
warning fires when a month with ≥ 100 decided runs has a Wilson upper bound < 0.90 or a response
rate < 60 %. Any definition change restarts the series.

## Amendments

### Amendment 1 — 2026-10-20 (pre-data: H002 not applied in production, zero production `quiz_runs` rows)

Written before any production data, after the Opus statistics review of FOLLOW-1363. It specifies
the existing rules; it does not change the metric, n, thresholds or the futility rule.

- A1 Response rate. Denominator = runs on a non-neutral leaf that reached the result screen (status
  completed, confirmed, corrected or unconfirmed). Neutral leaves are never asked to confirm, so
  they are not in it. Numerator = decided runs. Both are computed over the analysis window: runs
  whose decision (or last status) time is at or before the decision time of the 400th decided row. A
  non-neutral run still `completed` at the analysis counts as not responding. The pessimistic
  variant counts both `unconfirmed` runs and such abandoned `completed` runs as wrong.
- A2 Staff/ops exclusion. `quiz_runs` has no staff marker. Harness and ops-key traffic is excluded
  by tenant (the harness tenant). Staff and founders must not take the production quiz on the frozen
  hash. Any production session known to belong to staff is listed here by `session_id` before the
  analysis is run, without looking at its outcome, and is excluded. The residual risk (unlisted
  staff sessions, forged or automated pings) is disclosed next to the verdict.
- A3 Sample order and finality. "First 400 decided rows" means ordered by decision time
  (`updated_at` at the terminal transition), ties broken by `id`. The futility looks use the same
  order. The CTO runs the analysis once, when the 400th decided row exists and no earlier-shown run
  on the hash is still non-terminal or the runs older than the quiz run maximum have aged out. The
  record holds the 400 run ids, the counts and the verdict. Later DSR erasures or late rows do not
  reopen it.
- A4 Binding hash. The verdict binds only for the hash the CTO freezes at KQ3, recorded here before
  its first production row. With the verdict, report how many earlier hashes reached n = 130 and
  their futility outcomes.
- A5 κ. The backoffice tab does not compute §5. Until κ is reported, any PASS is stated as
  "self-reported, κ pending".
