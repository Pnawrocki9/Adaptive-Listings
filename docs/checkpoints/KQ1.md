# Checkpoint KQ1 — Faza Q on localhost: the quiz confirmation path works end to end (2026-10-21)

**Plan:** `docs/PLAN-QUIZ-ACCURACY-2026-10-19.md` (Faza Q, inserted by the CEO between K3 and Phase
4). **Verdict: GREEN.** **SHA of record:** `main` `8c08deba` (#1073). **Rollback target before Faza
Q:** tag `k3-green`. **Tag:** `kq1-green` on the merge commit of this ledger.

## What Faza Q shipped up to KQ1

| PR                         | Ticket                  | Change                                                                                           |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| #1049, #1050, #1051        | FOLLOW-1355 (Q0)        | MASTER_DESIGN 4.28 §E.4 v3; plan copy, research record, PREREG, ESC-086; ADR-0019 note           |
| #1052                      | FOLLOW-1356 (Q1)        | shared quiz model: traits, v3 schema, walker/lint/diff, Wilson, default v2 EN+PL                 |
| #1055                      | FOLLOW-1357 (Q2)        | SDK widget v2: trait step, confirmation + correction, EN\|PL switcher, run pings                 |
| #1053, #1054               | FOLLOW-1358 (Q3)        | `quiz_runs` (handover SQL H002), `POST /api/quiz/run`, DSR, served v2 + hash; compliance review  |
| #1060                      | FOLLOW-1359 (Q4)        | fold 0.72/0.90, confirmed-leaf anchor, chat τ, drift guards; ESC-087 cap: sent similarity ≤ 0.85 |
| #1064                      | FOLLOW-1360 (Q5)        | traits shape grounded copy; familial-steering refusal on every request (EN/PL/ES)                |
| #1071, #1073               | FOLLOW-1361 (Q6) + 1367 | AC(10) confirmation path, TALLY 8, AC(5) after the quiz card, warm public-config                 |
| #1058, #1059, #1061, #1063 | FOLLOW-1362 (Q7)        | backoffice quiz editor C1–C4                                                                     |
| #1067                      | FOLLOW-1363 (Q8)        | accuracy report (pre-registered verdict), PREREG Amendment 1                                     |
| #1057, #1072               | FOLLOW-1365, 1369       | the served quiz tree reaches the buyer: one config request, 15 s deadline                        |
| #1070                      | FOLLOW-1364             | retention job, 13 months (CEO 2026-10-20)                                                        |
| #1069                      | FOLLOW-1366             | protected-class playbook strings and boosts retired; scan test                                   |

## Control I1 — the series (README §5.33)

Three consecutive `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN`, each `[FRESH]` (harnessSha
`8c08deba`, an ancestor of HEAD, `commitsBehind=0`, `measuredPathsChanged=0`), on one control plane
after one bring-up (public-config warm: 200, served hash `6fce0f72…`). AC(10) in every run: (a)
confirm → `quiz_runs` `confirmed`, SDK state 0.90, the first `/api/adapt` after the fold
`llm_tweaked`, two contrary bookmarks leave the leaf; (b) correct `first_time_buyer → family_buyer`
→ `corrected`, the first request after the correction folded carries the chosen hint and is
`llm_tweaked`; (c) × → `unconfirmed` at 0.72. `quiz_runs` during the series: 6 confirmed, 3
corrected, 3 unconfirmed, 3 shown — all on the served hash. 0 familial-steering refusals.

## Earlier attempts on the way (recorded, not hidden)

- `1d578ba9`: every run crashed — `ReferenceError: configOf is not defined` in the AC(10) session
  (FOLLOW-1369's recorder declared in the chat-arm function). CI's offline pins never execute that
  live path. Fixed in #1073; lesson in memory: eslint `no-undef` + one live run before a series.
- `8c08deba`, first series: runs 1/4/7 GREEN, runs 2/5/6 holdout (neutral), run 3 a harness
  preflight timeout on the control plane — a RED substrate that resets the streak, so it was NOT
  counted as KQ1; the series was re-run on the same SHA and gave the record above.
- Per-PR series of #1060, #1064, #1069: REDs traced to a cold chat shim, ClickHouse/grounding
  transients and control-plane stalls (`next dev` preflights of 6–14 s), never to the PR's diff.

## What KQ1 does NOT prove

That the quiz identifies the buyer's archetype ≥ 90 % of the time: synthetic sessions confirm
themselves. That is KQ3 (production, CTO): ≥ 400 decided runs on one frozen hash, the pre-registered
Wilson analysis (`docs/decisions/PREREG-quiz-accuracy-2026-10.md`), the κ sample.

## Open, by owner

- **CEO (KQ2):** walkthrough of the backoffice editor/simulator/versions/accuracy report and the
  Polish quiz on a listing; PL/ES copy is machine-written; the 616 px quiz card on a 720 px screen.
- **FOLLOW-1368:** the playbook branch only when every slot is grounded (ESC-087 option 3).
- **Compliance follow-ups** (FOLLOW-1366 review): inert `feature_priority`/`listing_rules` proxies;
  runtime steering guard for schools and national origin + scrub of playbook description/signals fed
  to the LLM; expat/retire wording to counsel.
- **SDK bundle:** 43,133 of 43,136 B — any further SDK growth needs an ESC.
- **Harness substrate:** run the series control plane as `next build && next start` (dev-server
  stalls); the cold chat shim (FOLLOW-1233/1246).
