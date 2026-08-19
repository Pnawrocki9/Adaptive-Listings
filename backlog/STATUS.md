# Status — 2026-08-16 (session 121 — eight PRs merged #756-#763, retro-analyst dispatched)

## SESSION 121 (2026-08-16)

**Opened with `main` = `d3a358c0`, clean, 0 open PRs.** State read first: `backlog/ESCALATIONS.md`
has no unresolved blocking entries (ESC-020, ESC-042 item 1, ESC-056, ESC-057, ESC-058 all re-read
in full this session and confirmed still explicitly non-blocking-for-dispatch; ESC-059/060 are
DECIDED, not open). `git log` shows eight further merges since RETRO-273/274/275 (which covered
through `8e759383`): #756 (FOLLOW-988 stage C), #757 (FOLLOW-998), #758 (FOLLOW-999), #759
(FOLLOW-1000), #760 (FOLLOW-1001), #761 (FOLLOW-1002), #762 (FOLLOW-1003), #763 (FOLLOW-1004). All
eight were gated on `scripts/gh-pr-checks-verified.sh` returning `VERIFIER_EXIT=0` per their own
ticket-stub records in `backlog/FOLLOW_UPS.md` (Rule I pre-existing-red only, 0 new each time).

**Actions this session:**

1. **Re-derived next-free counters from the repo, not carried from the prior banner** (FOLLOW-975
   lesson): grepped `FOLLOW-10[0-9]{2}` across all tracked file types for in-source-only allocations
   beyond `backlog/FOLLOW_UPS.md`'s own registry — none found; highest entry in both is FOLLOW-1004.
   Counted `## RETRO-` headers in `backlog/RETROSPECTIVES.md` — 275, confirming next free RETRO
   **276**. Confirmed ESC tail ends at DECIDED ESC-060, next free ESC **061**. Next free FOLLOW
   **1005**.
2. **Refreshed `backlog/QUEUE.md`'s top banner** to a session-121 `START HERE` reflecting true
   `git log` state (eight merges since the last retro pass), the operator actions taken live in prod
   this session (ClickHouse grant, quiz VERSION 3 published, prod + localhost E2E quiz tests
   passed), and the two named-but-unfiled follow-up candidates (SDK completion-ping missing
   `branch`/`q1`-`q3`; `turbo.json` env allowlist) for the retro to evaluate.
3. **Dispatched `retrospective-analyst`** (model **Opus**, per the model-fit table — retrospectives
   are the table's canonical Opus-fit task) over the #756-#763 batch. This is step 6 of the standing
   instructions, not a decision-table pick — no delegation-table row applies. Brief asks it to
   specifically check: (a) FOLLOW-1002's two CI failures (eslint-autofix-vs-tsc cast conflict;
   Route-file const export) — whether a gate or lesson should be codified since both escaped local
   verification; (b) whether FOLLOW-1001's turbo strict-env-stripping mechanism claim is verified or
   hypothesis, and whether the env-allowlist follow-on needs filing as a real ticket; (c) whether
   FOLLOW-1004's grant-gap class (a narrowing enumeration derived from the write-path inventory
   missing read paths) has other instances among CH table read paths not covered by current grants;
   (d) whether the three quiz PRs' `TOTAL_SITES`-constant merge-conflict dance is a recurring
   sequential-bump pattern worth a rule; (e) the SDK completion-ping follow-up candidate named
   above. Told it the re-derived next-free numbers (FOLLOW 1005, RETRO 276, ESC 061).
4. **Did not pick up any new ticket.** 0 tickets IN_PROGRESS, 0 open PRs, and step 6 (retro per
   merge batch) was already overdue for an 8-PR batch — clearing retro debt outranks starting new
   work with the queue otherwise empty of an obvious next pick pending the retro's findings.

**Counters — 0 tickets IN_PROGRESS. 0 open PRs. 1 background retro-analyst dispatch running (batch
of 8 PRs, #756-#763).**

**NEXT:** validate the retro-analyst's output (findings sound, no fabricated RETRO/FOLLOW numbers,
counters correctly re-derived), file/promote any warranted FOLLOW stubs, then resume normal ticket
selection from a clean, retro-current queue.

---

# Status — 2026-08-15 (retro pass — RETRO-273/274/275 filed over sixteen merged PRs; FOLLOW-989…997; no rule promoted)

## RETRO PASS (2026-08-15) — `retrospective-analyst`

`main` = `8e759383`. Sixteen PRs had accumulated with no retrospective since RETRO-272 (which
covered through #738 / `132ed706`). Filed as three entries, grouped by workstream rather than by
merge order.

**Read-only on code.** Wrote `backlog/RETROSPECTIVES.md` (three entries), `backlog/FOLLOW_UPS.md`
(nine stubs), `backlog/QUEUE.md` and this file. `CONVENTIONS_PATCH.md` deliberately untouched — no
candidate reached the two-prior-retro promotion threshold.

| RETRO   | PRs                               | tickets                               |
| ------- | --------------------------------- | ------------------------------------- |
| **273** | #733, #734, #737, #742, #743      | FOLLOW-950, 949, 952, 943             |
| **274** | #741, #744, #745                  | FOLLOW-982, 983, 985                  |
| **275** | #740, #746, #747, #748, #749–#752 | FOLLOW-986, 988 (+ ADR-0022, ESC-060) |

**#753 (FOLLOW-988 stage B) is OPEN, PM-validated, NOT merged — out of scope, mentioned as context
only.**

### Closures verified end-to-end, not one hop

- **FOLLOW-986 — CLOSED, and closed on the trigger that matters.** The nightly E2E is green on a
  `schedule` run: `31861937468`, `main`, `c62cf897`, `2026-08-15T03:29:09Z`, `SUCCESS` — the **first
  schedule-triggered success in 104 runs**; the last of the 103 failures was `31770603657`
  (2026-08-14T04:40, also `schedule`). Not a PR-context green. Every hop has evidence: harness
  starts → workspace packages build → KV seeds → ACK 200 → post-ACK write **registered** →
  ClickHouse reports `written_rows` → rows survive TTL → `SELECT count()` asserts them.
- **FOLLOW-988 (steps 1–5 + stage A) — ESC-060's ordering was HONOURED and the prod column verified
  first-hand.** #750 (migration only) merged `2026-08-14T23:26:20Z`; #751 (writer)
  `2026-08-15T07:59:42Z` — an 8h33m operator window. #751's author re-checked the operator's first
  report and found it **false**, using a `holdout_group` control query to prove the empty result
  meant absence rather than a broken query. Independent live probe for this retro:
  `SELECT name, type FROM system.columns …` → `holdout_pct Float64`, column 19 of
  `default.adaptation_decisions`. **The claim is true.**
- **FOLLOW-982 / FOLLOW-983 — CLOSED**, each finding more than its ticket enumerated (seven sites vs
  four; three bad `relied_on_by` paths vs two), and each naming why the extra ones were invisible to
  a ticket written against a smaller corpus.
- **FOLLOW-943 — CLOSED**, and traced rather than accepted: the propagation, the test file and the
  documented falsification condition all exist, **and** the claim that gating the demo-JWT branch
  would be a regression is checkable and checks out (`demo-jwt-verify.ts:22`,
  `origin-policy.ts:210-216`). Only its advertisement was stale (FOLLOW-989).
- **FOLLOW-949 / FOLLOW-950 — CLOSED, and there is NO registry gap.** The opt-in Map holds exactly
  three `(path, method)` pairs, the coverage registry exactly three `reflects` rows, set-equality is
  machine-checked, and the three tests that asserted the withdrawn `GET /api/adapt` grant are
  **inverted**, so re-adding it fails them.

### The three P1s

1. **FOLLOW-991 — ESC-059's accepted-risk premise is false and was never measured.** _"`main` is not
   a deployment trigger for anything customer-facing that a bad commit could break irreversibly"_ —
   contradicted by `db-migrate.yml:36-42` (push→`main` → `environment: production`, prod migrations,
   no human gate), `modal-deploy.yml:89-92` (push→`main` → prod Modal) and Vercel's auto-deploy of
   `admin.estalara.com`. Rule AT verbatim. **The ruling is not re-opened; the premise goes back for
   confirmation. PM decides.**
2. **FOLLOW-992 — the detached `waitUntil` had THREE post-ACK consumers.** `intent.snapshot`,
   `chat.message.sent` and the ClickHouse write all shared it from PR #429 to #747. All three are
   now fixed; only one was made audible, and the production question was asked only of that one.
   Flagged as a **candidate** second cause for FOLLOW-892 / ESC-042 item 1's unproven `chat_intent`
   traffic axis — hypothesis, with the discriminating measurement written down.
3. **FOLLOW-990 — the measured-premise gate is green while its closing clause is false again.**
   Second consecutive retro, **different mechanism**: RETRO-272 falsified it because the assertion
   matched an empty set; it is false today because a dated prod claim was written under the verb
   `applied`, ~15 hours after the vocabulary was derived from a 198-line corpus enumeration. Three
   of the self-test's seven hand-transcribed "real pre-fix artefacts" now match nothing in the repo.

### Counters

- **Retro debt: CLEARED through `8e759383`.** #753 is the next batch.
- **New stubs:** FOLLOW-989…997 (three P1, six P2), none promoted to a ticket.
- **Rules: 50, unchanged.** `P-52` incremented to count 2 (one prior — RETRO-271 — is not two);
  `P-55` minted at count 1. Rules AT / S / AQ×2 / AI-amendment recorded as **compliance failures**
  against adequate texts → tickets, per the RETRO-258/261 standard.
- **13 controls that worked** named across the three entries — the highest count this loop has
  recorded in one pass.
- **Next free:** FOLLOW **998** · RETRO **276** · ESC **061**.

---

# Status — 2026-08-15 (session 120 — PR #753 (FOLLOW-988 stage B) validated READY_FOR_REVIEW; retrospective-analyst dispatched over 16-PR retro debt)

## SESSION 120 (2026-08-15)

**Opened with PR #753 already open** (branch `backend-engineer/FOLLOW-988-stage-b-control-plane`,
delegated in a prior session), `main` at `8e759383`. State read first: `backlog/ESCALATIONS.md` has
no unresolved blocking entries (ESC-020/042-item-1/056/057/058 all previously ruled non-blocking;
ESC-046's `## OPEN` text is inside a collapsed `<details>` preserving the original filing, the live
entry is `## RESOLVED`; ESC-059/060 are DECIDED). `backlog/QUEUE.md`'s top banner was stale (still
headed "session 119", `main` = `91c902ae`) despite 15 further merges since — named in QUEUE.md,
nothing lost since `git log` is the ground truth, but the banner had stopped tracking reality for
several sessions.

**Actions this session:**

1. **Validated PR #753 (step 5 in full).** Confirmed current branch matched the PR. Independently
   re-ran `scripts/gh-pr-checks-verified.sh 753` (not trusted from the dispatching context) →
   `VERIFIER_EXIT=0`, 107 check-runs, 97 success / 8 skipped / 2 failing (both `Rule I`, 191/191, 0
   new / 0 fixed against `main`'s dynamic baseline). Ran `tsc --noEmit` clean in both
   `control-plane` and `ingest`; `vitest run src/app/api/adapt` → 34 files / 348 tests;
   `vitest run src/observability-signals.test.ts` → 8/8; `eslint`/`prettier --check` clean on
   touched files. Runtime-wiring grep (5c): zero remaining `lib/ab-events` imports; `holdout_pct`
   producer (`route.ts` `logDecisionAsync` INSERT, #751) / consumer
   (`adaptation_decisions.holdout_pct` column, migration #750) pair confirmed unaffected by this
   diff, still intact. Single-agent ticket, step 5d N/A. Posted the required PM-validated comment on
   the PR with full evidence. Moved to **READY_FOR_REVIEW** in `backlog/QUEUE.md`. Not merged —
   humans merge.
2. **Named the QUEUE.md staleness** rather than silently propagating the session-119 banner, and
   wrote a fresh top section reflecting true `git log` state (15 merges since #737: #740, #733,
   #734, #741-#752).
3. **Dispatched `retrospective-analyst`** (model **Opus** — retrospectives are the table's canonical
   Opus-fit task) over the 16-PR batch merged since RETRO-272 (#740, #733, #734, #737, #741-#752),
   via
   `nohup claude --agent retrospective-analyst --model opus -p "<brief>" --permission-mode acceptEdits`.
   This is step 6 of the standing instructions, not a decision-table pick — no row applies. Brief
   asks it to specifically check (a) whether FOLLOW-988's `holdout_pct` migration→ write sequencing
   actually respected ESC-060's ordering requirement in prod, (b) the #733/#734 CORS opt-in
   merge-order reconciliation for gaps, (c) whether the FOLLOW-986 nightly-E2E fix chain is green on
   an actual scheduled run (not just PR CI), (d) fresh Rule AX stale-anchor instances. PID not yet
   confirmed complete as of this write — background dispatch, watch for its PR
   (`retrospective-analyst/retro-batch-733-752`) next session.
4. **Did not pick up FOLLOW-988 stage C** (ingest Redpanda mirror deletion) despite it being the
   most obvious "next feature ticket" — the ticket's own text says "Not urgent and must not be
   worked as such", and clearing 16 PRs of retro debt (a violated standing instruction — step 6
   fires per merge, not in occasional batches this large) outranks starting new non-urgent work with
   0 blocking escalations otherwise present.
5. **Escalations:** re-read all 5 open entries (ESC-020, ESC-042 item 1, ESC-056, ESC-057, ESC-058)
   — unchanged, all previously ruled non-blocking. Not re-filed. No new escalations.

**Counters — FOLLOW-988 (stage B, PR #753): CI-check counter 1/5, fix-iteration counter 0/3. 0
tickets IN_PROGRESS. 1 open PR (#753, READY_FOR_REVIEW). 1 background retro-analyst dispatch
running.**

**NEXT:** human merges #753. Next PM session: verify the retro-analyst's PR
(`retrospective-analyst/retro-batch-733-752`) landed correctly (CI green, findings sound, no
fabricated RETRO/FOLLOW numbers), validate/merge it, then reassess FOLLOW-988 stage C priority
against whatever the retro surfaces.

---

# Status — 2026-08-14 (session 119 — #736 merged & un-broke `main`; #735 re-verified GREEN and moved to READY_FOR_REVIEW; #737 rebased/retitled; FOLLOW-954 dispatched to architect)

## SESSION 119 (2026-08-14)

**Handed a fully-measured state from the prior (session 118) invocation** — did not re-run
`scripts/gh-pr-checks-verified.sh` on #735 or #736 per explicit instruction (already measured: #736
MERGED as `9c614f8c`; #735 re-verified `VERIFIER_EXIT=0` after rebase onto `9c614f8c`, 104
check-runs, all 52 registered checks present and green where required, `Rule I` 0 new / 0 fixed).

**Actions this session:**

1. Moved **FOLLOW-952 (#735) to READY_FOR_REVIEW** in `backlog/QUEUE.md` on the handed-in evidence;
   posted the required PM-validated comment on the PR itself with the full CI/wiring/AC evidence
   (`gh pr comment 735`).
2. **Rebased PR #737** (session-118 queue bookkeeping) onto `9c614f8c` — clean, no conflicts — and
   rewrote its stale content: #736 MERGED, `main` = `9c614f8c`, #735 verified green, only 3 open PRs
   remain. Retitled/re-bodied the PR via `gh api …pulls/737 -X PATCH` (plain `gh pr edit` hit an
   unrelated GraphQL `projectCards`/Projects-classic deprecation error, not a content problem).
   `commitlint` rejected the first commit header at 107 chars (max 100) — shortened and
   re-committed. #737's own CI was still settling (mixed pass/pending/skipping) at session end —
   **not yet independently re-verified with the full verifier script; do this before treating #737
   itself as READY_FOR_REVIEW.**
3. **#733/#734: stated, not resolved.** Both were last CI-measured before `9c614f8c` existed, so
   their green verdicts are stale (not wrong) — they need a fresh `scripts/gh-pr-checks-verified.sh`
   run once rebased. Did not spend the session's budget re-running either (no input changed since
   their last measurement beyond `main` moving, which the human merge step will need to re-verify
   against anyway). The `isFullyOriginGated` conflict between them from session 117 is unchanged,
   still unresolved, and remains explicitly a human merge-order decision — not re-litigated or
   resolved by this PM session.
4. **Dispatched FOLLOW-954** (MASTER_DESIGN §V.3.4 CORS doc is wrong on every claim; RETRO-267) to
   **architect**, model **Sonnet** — delegation-table row "a contract between two modules, a new
   dependency, an ADR"; well-scoped doc correction against already-established ground truth (the
   FOLLOW-954 stub's own comparison table), escalate to Opus only if the §Y.2 propagation pass
   surfaces a second ambiguous document. Marked IN_PROGRESS in `backlog/QUEUE.md` and
   `promoted_to_queue` in `backlog/FOLLOW_UPS.md`. No blocking `depends_on`; confirmed FOLLOW-951
   (referenced in the AC) is MERGED (PR #719, 2026-08-10).
5. **Escalations:** re-read ESC-020, ESC-042 item 1, ESC-056, ESC-057 — all confirmed still OPEN,
   all still ruled non-blocking by prior sessions. Not re-filed as overdue.
6. **Retro debt unchanged and growing:** still no RETRO entry for #729/#730/#731/#732, now also
   #736. Deferred to a batch pass once #733/#734/#735/#737 settle, per the session-118 plan.

**Counters — FOLLOW-952: CI-check counter 1/5 (the rebase re-run, done in session 118, not
repeated), 0/3 fix-iterations (only ever exit 3 for a cause outside this ticket — does not count per
the gate-exit contract). FOLLOW-954: 0/5, 0/3 (freshly dispatched). 1 ticket IN_PROGRESS
(FOLLOW-954). 4 open PRs (#733, #734, #735, #737).**

**NEXT:** `architect` subagent works FOLLOW-954. Humans re-verify + merge #733/#734/#735 (conflict
between #733/#734 is their call) and #737 once its CI settles. Then retro debt.

---

# Status — 2026-08-13 (session 117 — recovered FOLLOW-949 from a SECOND consecutive crashed session; PR #734 opened, CI verified, READY_FOR_REVIEW)

## SESSION 117 (2026-08-13)

**Opened on stranded work, again.** `backend-engineer/FOLLOW-949-adapt-exclusion-method-scope` had
**zero commits vs `main`** and 5 modified files. The session-116 worker finished FOLLOW-949 and the
session died before a single `git commit` — the implementation was referenced by no git object, so
`git diff main..HEAD` was empty **by construction** and was worth exactly nothing as evidence. The
WORKING TREE was the only record. This is the third session in a row to end in that state (115 →
FOLLOW-950, 116 → FOLLOW-949); FOLLOW-955's Stop hook prints the warning and cannot prevent the
outcome.

**Recovered-work re-verification run independently**, per `docs/AGENT_WORKFLOW.md` — nothing
accepted from the dead session's self-report, because it left none: targeted vitest → 38/38; **full
control-plane suite → 2094 passed, 2 skipped, 183/184 files**; `tsc --noEmit` → exit 0; `eslint` →
exit 0; `prettier --check` re-run AFTER commit (lefthook format/lint race lesson) → clean. The
single non-passing suite, `app/api/adapt/feedback/route.follow450-e2e.test.ts`, is a 30s **hook**
timeout under parallel pglite load, passes in isolation, and does not touch this change — named
rather than rounded away.

**Red-first re-proven by PM, not accepted as a claim.** Three separate reverts, each failing exactly
its own test and nothing else: the method split (3 middleware cases), the trailing-slash arm
(exactly AC(5)), and the registry's `method` field
(`/api/adapt [POST] — registry says 'platform-only', response says https://homes.clientbrand.com`).

**CI verified** with `scripts/gh-pr-checks-verified.sh 734`, exit captured in the same log stream:
**`VERIFIER_EXIT=0`**. Settled after 510s on two consecutive identical fully-completed snapshots.
103 check-runs, 95 success, 6 skipped, 2 failing — both `Rule I`, dynamically compared against
`main`'s own baseline (run `31720403597`, head `e3457906`): 191 vs 191, **0 new, 0 fixed**. All 51
registered required checks present and green where required.

**PR #734 opened, READY_FOR_REVIEW, not merged.** Commit `fcf8e2e4`.

**🚨 #733 and #734 conflict — a human merge-order decision, not a PM one.** Both rewrite
`isFullyOriginGated`. #733 (FOLLOW-950) replaces it with an opt-IN `ORIGIN_REFLECTING_ROUTES` Map
keyed by `(path, method)` and adds no `/api/adapt` row; #734 (FOLLOW-949) makes the existing
function method-aware. If #733 lands first, #734's fix becomes an `['/api/adapt', ['GET']]` Map
entry; if #734 lands first, #733 must not drop the GET/POST split when it inverts the mechanism.
Recorded in #734's own docblock as well as its PR description, so a merge tool resolving the textual
conflict cleanly cannot silently erase the requirement.

**PM error this session, recorded not buried.** Cleaning up after the red-first experiments I ran
`git checkout -- apps/control-plane/src/sdk-cors-coverage.test.ts`, which reverted the **worker's**
uncommitted changes to that file along with my temporary edit. Recovered only because the full
`git diff` was still in context; the restored blob hash (`a4cff526`) matches the original
byte-for-byte, verified against the diff header. Note that session 116 had recorded a neighbouring
version of this same lesson hours earlier and I still hit the variant next door — see
`.claude/agents/pm-orchestrator/lessons.md`.

**Counters — FOLLOW-949: CI-check counter 1/5, fix-iteration counter 0/3. 0 tickets IN_PROGRESS. 2
open PRs (#733, #734), both READY_FOR_REVIEW, both awaiting human merge. Open-escalation ages
unchanged: ESC-020 ~5 weeks, ESC-042 item 1 ~2.5 weeks, ESC-056 ~4 days, ESC-057 ~1 day — all
non-blocking.**

**NEXT:** FOLLOW-952 → 954, then the retro debt — still no RETRO entry for #729/#730/#731/#732;
spawn `retrospective-analyst` across that batch plus #733/#734 once they merge.

---

# Status — 2026-08-13 (session 116 — recovered FOLLOW-950 (PR #733) from a crashed session, PM-validated READY_FOR_REVIEW; closed FOLLOW-948 (PR #732) untracked-merge gap; dispatched FOLLOW-949)

## SESSION 116 (2026-08-13)

**Opening state verified, not inherited.** `main` = `655b43fd` (FOLLOW-948, PR #732, merged
2026-08-13T05:57:38Z). `gh pr list --state open`: exactly one, **#733**
(`backend-engineer/FOLLOW-950-cors-reflection-opt-in`), already pushed by the crashed prior session.
Escalations unchanged from session 115: ESC-020, ESC-042 item 1, ESC-056, ESC-057, all `## OPEN` but
explicitly ruled non-blocking for dispatch in their own filed text.

**Recovered-work re-verification run independently on PR #733**, per the recovered-work checklist —
not trusted from the crashed session's self-report:
`npx vitest run src/middleware.test.ts src/sdk-cors-coverage.test.ts` → 41/41 pass;
`npx tsc --noEmit` → exit 0; `npx eslint` on the 3 touched files → exit 0.

**CI re-verified independently** with `scripts/gh-pr-checks-verified.sh 733` (`VERIFIER_EXIT=0` in
the same log stream as the script's own output, per the verifier-exit-code-masked lesson): 103
check-runs, 95 success, 6 skipped, 2 failing (both `Rule I`, 191=191 against main's own current
baseline, 0 new). All 51 registered required checks present and green where required.

**All 5 FOLLOW-950 AC verified by reading source** (table in QUEUE.md session-116 head): the opt-in
`ORIGIN_REFLECTING_ROUTES` Map is wired producer (`middleware.ts:196`) → consumer (`:377`) in a
non-test file; the two `enforcedIn: null` rows corrected to `wildcard-gated`; a new gating-property
test added alongside (not instead of) the `!s.note` check; an `ADAPT_API_KEY`/`NEXT_PUBLIC_`
residual scan added. PR comment posted with the full evidence trail. **PR #733 marked
READY_FOR_REVIEW — not merged, human review required.**

**FOLLOW-948 closure recorded** — PR #732 had merged (`655b43fd`) without ever getting a QUEUE.md
entry; this is the same untracked-merge gap RETRO-269 flagged for four other tickets last session
and no automated check catches yet (FOLLOW-964).

**Dispatched FOLLOW-949** (P2, backend-engineer, Sonnet, decision-table row "control-plane/auth →
backend-engineer") — the last open P2 code defect on the CORS-reflection axis RETRO-267 opened.
Explicitly flagged in the delegation brief that the stub's own line-number citations predate
FOLLOW-950 and must be re-derived against current HEAD before implementation (the FOLLOW-947 lesson,
applied proactively this time instead of discovered after the fact). Dispatched via
`nohup claude --agent backend-engineer --model sonnet -p ...`; confirmed alive via `ps -p <pid>`
(output buffers until exit — first log lines are just `.claude/settings.json` permission-rule
warnings, not a failure signal, per the standing "PM dispatch looks dead but isn't" lesson).

**Counters — PR #733: CI-check counter 1/5, fix-iteration counter 0/3 (no PM-attributable fix
iteration). FOLLOW-949: 0/5 CI checks, 0/3 fix iterations, 1 ticket IN_PROGRESS. 1 open PR (#733,
READY_FOR_REVIEW, awaiting human merge). Open-escalation ages: ESC-020 ~5 weeks, ESC-042 item 1 ~2.5
weeks, ESC-056 ~4 days, ESC-057 ~1 day — all non-blocking for dispatch.**

**Retro debt named:** no RETRO entry yet exists for the batch of PRs merged since RETRO-269 (#729
FOLLOW-947, #730 FOLLOW-944, #731 FOLLOW-945, #732 FOLLOW-948). Plan: spawn `retrospective-analyst`
for that batch plus #733 once it merges, matching this repo's established batching pattern
(RETRO-269 covered 3 PRs at once).

---

# Status — 2026-08-12 (session 115 — dispatched FOLLOW-965: control-plane Sentry DSN unset in every Vercel env, 96 capture sites are no-ops in prod)

## SESSION 115 (2026-08-12)

**Opening state verified, not inherited.** `git status` on the primary tree: clean, nothing to
commit. `gh pr list --state open`: empty. `main` = `b2ceaf2d`. No recovered-work re-verification
owed.

**Escalations:** three genuinely `## OPEN` (ESC-020, ESC-042 item 1, ESC-056), all explicitly
non-blocking for dispatch per their own filed text. No P0/P1 before-go-live FOLLOW is being closed
this session, so the "never write DONE/closed while one is open" guardrail is not in play yet.

**Bookkeeping gap found:** QUEUE.md's head was 6 commits stale (last session-113 write at
`f8f5fee6`; `main` had moved to `b2ceaf2d`). Verified every intervening commit with
`git show --stat` before treating them as real (not stranded) work — FOLLOW-955/956/959/935/943/957
and RETRO-269, all landed correctly. Backfilled a session-115 QUEUE.md head recording this.

**Dispatched FOLLOW-965** (P1, devops-engineer, Opus) — see QUEUE.md session-115 head for full
delegation brief, decision-table row ("secrets, observability, runbooks → devops-engineer"), and the
explicit AC(1)/(2)-may-be-operator-only scope split following the FOLLOW-937 precedent.

**Counters — FOLLOW-965: 0/5 CI checks, 0/3 fix iterations. 1 ticket IN_PROGRESS. 0 open PRs at
dispatch time. Open-escalation ages: ESC-020 ~5 weeks, ESC-042 item 1 ~2.5 weeks (traffic axis),
ESC-056 ~3 days. All non-blocking by their own filed text.**

---

# Status — 2026-08-08 (session 107 — FOLLOW-915 re-routed to `architect`: the CEO ruling collides with an Accepted ADR; 14 bytes of bundle headroom measured)

## SESSION 107 (2026-08-08)

**Opening state verified, not inherited:** `main` `4b4ffa86`, clean and pushed, `git worktree list`
= main checkout only, `gh pr list --state open` = empty, **0 tickets IN_PROGRESS, 0 open P0, 0
decisions pending**. The two escalations that read `OPEN` on a grep were re-confirmed false
positives **by line number**, not by memory: ESC-046 is `RESOLVED` at `ESCALATIONS.md:105` with its
`OPEN` heading at `:138` inside a `<details>` block closing at `:190`; ESC-020 carries a CEO
resolution dated 2026-06-10.

**Selected FOLLOW-915 (P1, ESC-051 impl), then found it is not dispatchable to the agent its own
stub names.** The ruling requires the consent-notice fetch to be ordered **ahead of** the consent
gate. `docs/adr/ADR-0011-quiz-config-transport.md:310-312` (status **Accepted**, compliance sign-off
2026-06-12) says: _"The fetch MUST run after consent, not before … The consent banner cannot wait
for the fetch."_ The same decision is a 25-line rationale block at
`packages/sdk/src/index.ts:312-336`. An `sdk-engineer` would have met a documented refusal of the
exact ordering the ticket demands and either overridden it silently or stopped — a full round trip
either way. **Re-routed to `architect` (Opus), branch `architect/FOLLOW-915-consent-text-transport`,
row _a contract between two modules … an ADR_.**

**The distinction that keeps it a design question rather than a CEO question:** the ADR's first
sentence forbids fetching **tenant data** pre-consent — banner text is not tenant data. Its second
sentence is a latency claim with **no compliance rationale attached**. Only that one must fall.
**ESC-056 is reserved, not spent**: the architect files it only if "may the SDK fetch its own
consent text pre-consent?" is unanswerable from the existing DPIA.

**Measurement taken at HEAD, and it re-ranked the queue.** Built the SDK and gzipped the artefact
directly: `estalara-sdk.iife.js` = **42,994 bytes** against a 43,008-byte budget — **14 bytes of
headroom**, not the "~10" ESC-051 estimated. `consent-banner.ts` is 14,444 raw / 5,457 gzip
standalone, the largest movable thing in the budget. Consequence written into QUEUE.md: **FOLLOW-913
and FOLLOW-898 are held until 915 lands** — FOLLOW-913's AC(1) mandates a new named constant against
14 bytes, which is a coin flip on a CI gate for reasons unrelated to the ticket, paid out of a
3-iteration cap.

**Retro debt, stated plainly because it is my own skipped step 6:** RETRO-263 is owed **three**
merged PRs — #699, #700, #701 — and #700 changed the merge gate the PM validates with. It lost to
FOLLOW-915 only on blocking (a retro unblocks nothing; 14 bytes blocks two P1s). **Parallel-safe**
with the architect dispatch — different agent types, different worktrees — under this partition:
RETRO-263 owns the `FOLLOW_UPS.md` tail and stubs FOLLOW-918..925; the architect files no stubs and
owns `ESC-056` + `docs/adr/**`.

**Open-escalation ages:** none awaiting a decision (all eight ruled 2026-08-08, age 0d). ESC-042
item 1 remains OPEN on the traffic axis only — owner FOLLOW-820 item 3, by design, age 1d in this
state. **Counters: 0/5 CI checks, 0/3 fix iterations. 1 IN_PROGRESS (FOLLOW-915). 0 open PRs.**

**Still outstanding and still not a ticket:** `MODAL_CHAT_NLP_URL` unset in the prod ingest Worker —
one variable, both sides built and proven, gated behind FOLLOW-820's localhost-first exit by design.

---

## SESSION 106 (2026-08-08)

**Opening state verified, not inherited:** `main` `f28ce99a`, clean, `git worktree list` = main
checkout only, `gh pr list --state open` = empty, 0 tickets IN_PROGRESS, 0 open P0.

**FOLLOW-892 → DONE (PM bookkeeping, no PR).** ESC-042 item 1 now carries **one** state, written
identically in `ESCALATIONS.md` (heading + dated update block), `QUEUE.md`'s session-106 head, and
the stub's close note: **DISCHARGED on the deploy axis, OPEN on the traffic axis.** The stub asked
for `CODE_COMPLETE_OPERATOR_PENDING`; that was **upgraded on evidence the last session produced and
never spent** — the FOLLOW-904 effect probe (run `31256633000`) invoked `process_chat_message` in
the deployed prod app and got our ids echoed with `model_used='haiku-4.5'`, so the deploy axis is
executed-in-production, and it is now a standing daily control (`cron-heartbeat.yml:329`), not a
one-off. AC(2) correction appended, not rewritten. AC(4): the traffic axis has a **named** owner,
FOLLOW-820 item 3 — not "whoever notices".

**Substantive finding from that closure:** chat's prod blocker is now **one unset variable**.
`MODAL_CHAT_NLP_URL` carries a value on exactly one line in `apps/` — `wrangler.toml:97`, the `dev`
env, `http://localhost:8090`. Prod has none, so `chat-nlp-dispatch.ts:104` no-ops. Everything on
both sides of that variable is built, deployed and proven. It stopped being a deploy problem some
time ago and no record said so.

**Non-finding, recorded because it nearly became a false alarm:** tomorrow's 02:00 UTC
`validate_schemas` run **will** write its heartbeat and the 05:00 detector **will** go green —
traced through the post-FOLLOW-902 `config_gap` branch (`schema_validation.py:679-715` → `:601`),
not assumed. So §Snapshot.1 row B.6's flip condition is satisfied by a run that validated nothing.
Whoever flips it must write `coverage ❌ config_gap, 1/1 tenants — ESC-055` beside it, never a bare
`observed ✅`. Filed as a dated addendum on ESC-055 (Rule AN), not a new stub.

**FOLLOW-849 (+FOLLOW-909) → IN_PROGRESS**, `devops-engineer`, **Opus**, branch
`devops-engineer/FOLLOW-849-branch-guard-worktree`. Chosen over RETRO-263 after **disproving my own
urgency premise** for RETRO-263 (see above); chosen over FOLLOW-898 on ratio — six independent
sightings by six workers in one day against a 2h fix. Defect re-confirmed at HEAD:
`pre-edit-branch-guard.sh:56` resolves `REPO_ROOT` from the session cwd, `:63` reads that HEAD.

**Open escalations and ages (all treated non-blocking-for-dispatch per the 2026-07-27 ruling; none
gate a dev-tooling hook):** ESC-020 (59d, deliberate hold, owned by FOLLOW-820), ESC-041 (~11d),
ESC-042 (15d — **narrowed today to the traffic axis only**), ESC-044 (~8d), ESC-045 (~10d), ESC-051
(1d), ESC-054 (1d, CEO-pending, rule with FOLLOW-889), ESC-055 (0d, CEO-pending). **ESC-046 is
RESOLVED** — its `OPEN` heading is inside a preserved `<details>` block and greps as a false
positive.

**Counters: CI checks 0/5, fix iterations 0/3.** No PR was validated this session (none existed).
**RETRO-263 is still NOT written** — pre-routed, no clock.

## SESSION 103 (2026-08-05)

**Resumed from session 102 — which had NOT been interrupted.** Checked with durable signals rather
than a process snapshot (the session-102 retraction says exactly why
`ps -eo … | grep 'claude --agent'` cannot see an Agent-tool subagent): `main` = `origin/main` =
`3bc01b17`, tree clean, the `follow-812` worktree carrying zero uncommitted and zero unpushed work,
no scratchpad log. Session 102 had simply reached its handoff point and stopped there. Nothing was
recovered because nothing was stranded.

**FOLLOW-812 → DONE.** CI re-verified on a fresh `scripts/gh-pr-checks-verified.sh 677` run before
the merge (73 checks / 71 pass / 2 `Rule I` at 192 <= 192 against baseline run `30984103482` — a
newer baseline than session 102's, re-asserted rather than inherited, exit 0). Piotr squash-merged
at 18:09:18Z → `8423c804`. Merged code re-read on `main`: both stdout sites in
`apps/intent-engine/src/nlp.py` — primary-failure and the multilingual-retry Rule S sibling — now
print `type(exc).__name__` only. Worktree removed, branch deleted, `git worktree list` clean.

**Retrospective (RETRO-247) dispatched** to `retrospective-analyst` (Opus) on the merged diff.

**Still open for Piotr, carried from session 102 (unchanged, not re-filed):** user memory
`project_ci_gate_landscape` says 3 pre-existing-red CI gates, merged docs say 1. Whether the 3→1
narrowing is correct is FOLLOW-829 AC(1)'s job — "1" is still not ground truth.

## SESSION 102 (2026-08-05)

Retro-analyst (Opus, PID 112651) exited clean after ~6 min. Verified its commit `8ab98053` on
`retrospective-analyst/RETRO-246-follow-813-retro` touched ONLY the three permitted files (grep-diff
confirmed, not trusted) — `main` untouched, no PR opened. Content landed on `main` via
`git cherry-pick -n` (clean, disjoint from this session's own QUEUE.md/STATUS.md edits, matches
RETRO-238..245 no-PR convention).

**Self-correction:** session-101's closure note mis-cited "Rule AH / Rule S"; RETRO-246 traced the
actual rule texts and corrected it to **Rule AI amendment** (4th sighting, tier 0 added for
executed/loaded instruction corpora incl. `.claude/agents/*.md`) — no new rule letter minted, no
Rule S event (that's about symmetric-set siblings, not write-permission scope). Recorded in full in
`backlog/QUEUE.md` session-102 block.

**Landed the retro's own permission-blocked fragment:**
`.claude/agents/retrospective-analyst/lessons.d/RETRO-246.md` (per Rule AG — never the shared tail).
Same P-30 shape as FOLLOW-813's worker sandbox event; the retro named the intended path + full text
per its own pattern's lesson rather than dropping it, and this session landed it in one copy.

**Operator item flagged, not actioned (agents cannot write user memories):** memory
`project_ci_gate_landscape` says 3 pre-existing-red CI gates; merged docs now say 1 (FOLLOW-829
finding — whether that narrowing is correct is exactly what FOLLOW-829 AC(1) must establish, so "1"
is NOT yet treated as ground truth). For Piotr.

**5 new stubs filed** (all `recommended_agent: devops-engineer`, none promoted to QUEUE this
session, join Track HYGIENE tail per CEO's 813→812→811 sequencing): FOLLOW-827 **P1** (Rule I
classified by COUNT — forbidden by FOLLOW-821's own AC; `blocks: FOLLOW-821`), FOLLOW-828 P2 (5/9
agent defs have zero CI-verification step), FOLLOW-829 P2 (`CONVENTIONS_PATCH.md` still mandates the
retired `--watch`; pre-existing-red set silently 3→1), FOLLOW-830 **P1** (fail-open: non-PCRE grep
host → false "all green"; zero self-test on the new gate), FOLLOW-831 P2 (2nd live mode-bit
instance: `check-rule-i.sh` non-executable against 4 bare-invocation mandates). Two P1s are about
the script this orchestrator's own §5b gate now depends on — flagged for next sprint-planning
prioritization, not escalated (no P0/security/contract-break; neither trigger condition is plausible
for today's docs-only FOLLOW-812 dispatch on this Linux/GNU-grep host).

**Dispatched FOLLOW-812 to compliance-engineer.** Delegation-table row: "DPIA/ROPA/consent/DSR
rules/fair-housing/AI-Act docs → compliance-engineer." Model: **Sonnet** (bounded AC, no ambiguity,
no irreversible/pricing/vendor call — routine assessment-and-record work, not the ambiguous
cross-domain reasoning Opus is for). Branch `compliance-engineer/FOLLOW-812-modal-stdout-chat-leak`.
QUEUE.md updated atomically BEFORE dispatch (status IN_PROGRESS, assigned_to, started_at, branch).
Committed + pushed to `main` before spawning the worker, per "no concurrent git ops while a subagent
runs" — dispatching into a dedicated worktree this time as well, per this session's own lesson.

**CI-check counter (FOLLOW-812): 0/5. Fix-iteration counter: 0/3. 1 ticket IN_PROGRESS. 0 open PRs
at dispatch time.**

**Open-escalation ages (2026-08-05):** ESC-020 60d (filed 2026-06-06), ESC-041 13d (2026-07-23),
ESC-042 12d narrowed (2026-07-24, narrowed 2026-07-27), ESC-044 9d (2026-07-27), ESC-045 7d
(2026-07-29). All unchanged this session, all non-blocking-for-dispatch per the 2026-07-27 standing
ruling.

NEXT: dispatch FOLLOW-812 to compliance-engineer (Sonnet), wait for completion, run full 5a-5g
validation (this is a docs/assessment ticket — "we looked and it's fine" is an acceptable, but must
be _recorded_, outcome for AC(1)/(3); if AC(3) concludes "redact", AC(4)'s new `capsys` test must
actually assert on stdout content, not just call it).

---

# Status — 2026-08-05 (session 101 — FOLLOW-813 closed DONE, retro RETRO-246 dispatched (Opus), FOLLOW-812 next)

## SESSION 101 (2026-08-05)

State verified fresh: `main` = `origin/main` = `1a4233c8`, clean tree, 0 open PRs, no running
`claude --agent` processes, no stranded worktrees. 5 escalations OPEN (ESC-020/041/042/044/045),
unchanged, non-blocking-for-dispatch per the 2026-07-27 standing ruling.

**PR #675 (FOLLOW-813) confirmed merged** by Piotr 2026-08-04T22:59:44Z, squash, branch deleted.
**FOLLOW-813 marked DONE** in `backlog/QUEUE.md` (`completed_at: 2026-08-04`, `merged_pr: 675`,
`merge_commit: 1a4233c8`), with a closure note carrying forward the two validation-stage defects
(both agent defs incl. this orchestrator's own §5b hardcoding `--watch`; script shipped
non-executable) into the retro brief as the primary subject, per Rule AH / Rule S shapes.

**Step 6 — spawned `retrospective-analyst`, model Opus** (justification: judging whether these two
findings clear the ≥2-prior-instance promotion bar for Rule AH/Rule S is ambiguous single-domain
reasoning, not routine bookkeeping). Branch `retrospective-analyst/RETRO-246-follow-813-retro`,
explicitly instructed not to touch `main` and not to open a PR (session-85 collision precedent).

**CI-check counter:** n/a this turn (no code touched). **Fix-iteration counter:** n/a. **Tickets
IN_PROGRESS:** 0 (FOLLOW-812 not yet dispatched — sequencing constraint, see below).

**Sequencing constraint (session-85 collision rule):** FOLLOW-812 (compliance-engineer, Sonnet — see
justification when dispatched) is picked next but withheld until the retro process exits, since both
would touch this one shared working tree concurrently otherwise.

NEXT: wait for the retro-analyst process to exit, verify its branch/no-PR/no-`main`-touch, then
dispatch FOLLOW-812 to compliance-engineer per the CEO's stated order (813 → 812 → 811).

---

# Status — 2026-08-05 (session 100 — FOLLOW-813 dispatched to devops-engineer, Sonnet; CEO-ordered head of Sprint 24 Track HYGIENE)

## SESSION 100 (2026-08-05)

State verified fresh: `main` = `origin/main` = `b69ef8b0`, clean tree, 0 open PRs, no running
`claude --agent` processes, no stranded worktrees. 5 escalations OPEN (ESC-020/041/042/044/045), all
long-standing and non-blocking-for-dispatch per the 2026-07-27 standing ruling — none new.

Bookkeeping fix: `backlog/QUEUE.md`'s `### FOLLOW-782 — status: IN_PROGRESS` marker was stale (PR
#668 merged `5fc557b3`); corrected to DONE in place, no code touched.

**Picked FOLLOW-813** (P2, devops-engineer, Sonnet) — CEO's own explicit dispatch-first ordering
(2026-08-04 ruling) and Sprint 24 Track HYGIENE head placement: it repairs the
`gh pr checks --watch` false-green mechanism this very PM loop depends on for every other ticket's
validation. Delegation-table row: "Terraform, CI/CD, workflows, secrets, observability, runbooks →
devops-engineer." Full brief: ticket path `backlog/FOLLOW_UPS.md` `## FOLLOW-813`,
`docs/MASTER_DESIGN.md` §Snapshot.1, current `CONVENTIONS_PATCH.md` rules, branch
`devops-engineer/FOLLOW-813-ci-checks-false-green`.

**QUEUE.md updated atomically BEFORE dispatch** (FOLLOW-813 status IN_PROGRESS, assigned_to
devops-engineer, model Sonnet, started_at 2026-08-05, branch above). Will commit + push before
spawning the worker, per "no concurrent git ops while a subagent runs."

**CI-check counter (FOLLOW-813): 0/5. Fix-iteration counter: 0/3. 1 ticket IN_PROGRESS. 0 open PRs
at dispatch time.**

NEXT: dispatch FOLLOW-813 to devops-engineer (Sonnet), wait for completion, run full 5a-5g
validation (CI-mechanism change — must self-test by actually watching a real PR's checks through the
new/replaced procedure, not just reading the script), then FOLLOW-812 per the CEO's stated order
(813 → 812 → 811).

---

# Status — 2026-08-02 (session 87 — combined retro dispatched for FOLLOW-757+752; FOLLOW-746 picked next)

## SESSION 87 (2026-08-02) — retro for FOLLOW-757/752, FOLLOW-746 picked next

**State re-verified, not taken on trust:** `main` clean at `5b0b2c98` before bookkeeping, `db52ee32`
after. `gh pr list --state open` → empty. No `claude --agent` worker processes running (the one live
`claude` PID, 1222, is this main-loop session itself — cwd = repo root, no worktree).
`git worktree list` → only the primary tree. 5 escalations OPEN (ESC-020, 041, 042-narrowed, 044,
045 items 2-3), all re-read, none touch the files this session's two actions touch —
non-blocking-for-dispatch per the standing 2026-07-27 ruling.

**Dispatched `retrospective-analyst` (Opus) for ONE combined retro covering FOLLOW-757 (PR #648,
`35ecd80f`) and FOLLOW-752 (PR #649, `a254c0f7`)** — both small, same "evidence-quality of a CI/test
gate" class, merged the same day; a retro on either alone would very likely re-surface the other's
exact defect shape as a "prior pattern," so read together. Expected output: `RETRO-238` in
`backlog/RETROSPECTIVES.md` + any new `FOLLOW-NNN` stubs, on branch
`retrospective-analyst/RETRO-238-follow-757-752-retro` (explicitly instructed not to touch `main`,
not to open a PR).

- Dispatch command:
  `nohup claude --agent retrospective-analyst --model opus -p "<brief, see full text in this session's tool-call log>" --permission-mode acceptEdits > $LOG 2>&1 &`
- **PID:** `196140`. **Log:**
  `/tmp/claude-1000/-home-asipi-Projects-Adaptive-Listings/ff4eb2cc-757f-4543-8412-8d16f102e93c/scratchpad/retro-238-follow757-752.log`

**FOLLOW-746 picked as the next ticket** (P2, devops-engineer, Sonnet — same technique FOLLOW-757
just proved, applied to the sibling script `check-sentry-init-singleton.sh`), **not dispatched this
turn** — one Bash-capable agent at a time into this shared cwd; the session-85 collision is the
reason this rule exists. Full brief in `backlog/QUEUE.md` session-87 header.

**CI-check counter:** n/a (no PR opened this turn). **Fix-iteration counter:** n/a.

NEXT: Wait for the retrospective-analyst (PID 196140) to finish, confirm RETRO-238 landed on its own
branch (not `main`), then dispatch devops-engineer on FOLLOW-746.

---

# Status — 2026-07-31 (session 86 — retro dispatched for FOLLOW-743+744; FOLLOW-752 picked as next

ticket, held pending retro)

## SESSION 86 (2026-07-31) — retro for FOLLOW-743/744, FOLLOW-752 picked next

**State re-verified, not taken on trust:** `main` clean at `66575f5e`. `gh pr list --state open` →
empty. No running `claude --agent` processes, no worktrees. ESC-046 confirmed RESOLVED in the file
(Piotr's ruling). 5 escalations remain OPEN: ESC-020, ESC-041, ESC-042 (narrowed), ESC-044, ESC-045
— all operator-blocked, none affecting FOLLOW-752, standing ruling says non-blocking-for-dispatch.

**Dispatched `retrospective-analyst` (Opus) for a single combined retro covering FOLLOW-743 (PR
#646, `306285f7`) and FOLLOW-744 (PR #647, `5eeb5c40`)** — both small, same subsystem (Sentry
observability), same source retro (RETRO-235), merged in the same session. Expected output:
`RETRO-237` in `backlog/RETROSPECTIVES.md` + any new `FOLLOW-NNN` stubs.

- Dispatch command:
  `nohup claude --agent retrospective-analyst --model opus -p "<brief, see backlog/QUEUE.md session 86 header>" --permission-mode acceptEdits > /tmp/claude-1000/-home-asipi-Projects-Adaptive-Listings/ff4eb2cc-757f-4543-8412-8d16f102e93c/scratchpad/retro-237-follow743-744.log 2>&1 &`
- **PID:** recorded below once launched. **Log:**
  `/tmp/claude-1000/-home-asipi-Projects-Adaptive-Listings/ff4eb2cc-757f-4543-8412-8d16f102e93c/scratchpad/retro-237-follow743-744.log`

**FOLLOW-752 picked as the next ticket** (P2, qa-engineer — extend `redis-shadow-smoke.yml` with two
real-Redis cases proving `nx=` is honoured, not just passed to a `MagicMock`), but **not dispatched
this turn** — my own session-85 NEXT: line required the retro to land first, and dispatching a
second Bash-capable agent into this same cwd while the retro runs would repeat the exact collision
class session 85 just recovered from. Full brief in `backlog/QUEUE.md` session-86 header.

**CI-check counter:** n/a (no PR opened this turn). **Fix-iteration counter:** n/a.

NEXT: Wait for the retrospective-analyst to finish, confirm RETRO-237 landed on its own branch (not
main, not a stray branch — check `git log --all --oneline -5` and `git branch -a` before trusting
it), then dispatch qa-engineer on FOLLOW-752.

---

# Status — 2026-07-31 (session 85 close — collision recovered zero data loss; RETRO-236 on main;

PR #646/#647 PM-validated READY_FOR_REVIEW; 5 ESCALATIONS open, non-blocking-for-dispatch)

## SESSION 85 CLOSE (2026-07-31) — recovery complete, both PRs validated

**Final reconciliation after the shared-worktree collision (full incident above, unchanged).** Once
all three dispatched processes (`122018` retro, `122371` backend, `122776` devops) exited (confirmed
via two background `kill -0` monitors), found ONE more piece of stray damage the in-flight recovery
hadn't caught: retrospective-analyst's own final commit (`af6846f7`, RETRO-236) had landed on
`devops-engineer/FOLLOW-744-sentry-dsn-provisioning` instead of its own
`retrospective-analyst/RETRO-236-follow-736-retro` branch — same root cause, one more instance.
Relocated via `git cherry-pick` onto the correct branch, then `git reset --hard` to strip it back
off the devops branch (safe: devops's branch was already pushed to origin at that exact tip, so the
reset target matched origin exactly, verified via `git diff origin/<branch> <branch>` = empty).

**A second, still-unexplained mechanism:** immediately after that reset (same second, per
`git reflog --date=iso`), a `checkout: moving to main` + `cherry-pick` of the SAME RETRO-236 commit
appeared in the reflog and was already pushed to `origin/main` by the time this was noticed — this
PM did not issue that command in this exact form. Content was verified byte-for-byte correct (825
insertions, docs-only, matches the retrospective's own diff exactly) and `main`/`origin/main` are
confirmed identical with no corruption or stray files, so it was accepted rather than reverted — but
the mechanism is not fully understood and is flagged here rather than silently normalized. Possible
explanation: a detached child process from the retrospective-analyst's own session (mirroring the
"fast-forward merge to main" pattern prior retro sessions describe doing explicitly) outlived the
parent PID `ps` reported as exited. Worth another session's attention if it recurs.

**End-state verification, every ref checked against its own origin counterpart (zero drift):**
`main` = `origin/main` = `1c06d4f1`. `backend-engineer/FOLLOW-743-spend-cap-sentry-init` =
`origin/...` = `5ff39efa` (PR #646, 4 files, clean).
`devops-engineer/FOLLOW-744-sentry-dsn- provisioning` = `origin/...` = `5d3c3275` (PR #647, 6 files,
clean). Redundant local `retrospective-analyst/RETRO-236-follow-736-retro` branch deleted (content
already safely on `main`). Working tree returned to a clean `main` checkout.

**PR #646 (FOLLOW-743) validated:** `gh pr checks 646` all real gates pass; `Rule I` 192 violations
(pulled from the job log directly), matching `main`'s own current baseline — pre-existing-red,
non-blocking. Runtime wiring confirmed by reading the PR branch content directly: `init_sentry`/
`flush_sentry` call site in `generate_description.py:415-439`, new CI gate
`check-sentry-capture-has-init.sh` wired into `ci.yml:699,702` with a working 3-case `--self-test`,
unit test at `test_generate_description.py:1496-1512`. Full evidence posted as a PR comment. Moved
to READY_FOR_REVIEW.

**PR #647 (FOLLOW-744) validated:** `gh pr checks 647` all real gates pass; same `Rule I` 192
baseline. Runtime wiring confirmed: the hardened `init_sentry` try/except body read directly off the
PR branch (matches `flush_sentry`'s existing never-raise shape), mirror-parity confirmed identical
across all 3 files on the branch, 4 non-test consumers named
(`schema_validation.py`/`nlp.py`/`consume_embed_seed_requests.py`/sibling PR's
`generate_description.py`). AC-2/AC-3 (DSN provisioning + live-capture proof) correctly deferred to
Piotr as a dated runbook instruction, not silently skipped. Full evidence posted as a PR comment.
Moved to READY_FOR_REVIEW.

**PR #647 not merged, awaiting Piotr's review as normal.** `backlog/QUEUE.md` FOLLOW-744 entry
updated to READY_FOR_REVIEW with the collision incident recorded in full.

**PR #646 turned out to be ALREADY MERGED by the time this was written — NOT by this PM.**
Immediately after posting the PM-validation comment on #646, a routine `git fetch origin main`
turned up a new tip (`306285f7`) this session never pushed. `gh api repos/.../pulls/646` confirms
**MERGED**, `merged_by: Pnawrocki9` (the shared repo identity every process in this sandbox
authenticates with — not proof of which process ran the merge), `auto_merge: null` (GitHub's native
auto-merge was not the mechanism). The PM never ran `gh pr merge`. Best guess, unproven: the
backend-engineer subagent itself invoked `gh pr merge` after seeing its own CI go green — its
dispatch log's only merge-adjacent line is a `NEXT:`-style suggestion ("merge PR #646, then
FOLLOW-744..."), which does not by itself prove or disprove that it also executed the merge; the
`-p` log only buffers final output, not the full tool-call transcript, so this could not be
confirmed either way from the log alone. **Filed as ESC-046** (`backlog/ESCALATIONS.md`) rather than
silently accepted or silently fixed — the content itself was already independently verified correct
by this PM moments earlier (same CI-green, same wiring-confirmed evidence now sitting in the PR
comment), so there is no code-quality harm, but the "humans merge" boundary was bypassed by
something this PM does not control, which is a governance question for Piotr, not an engineering
one. `backlog/QUEUE.md`'s FOLLOW-743 entry updated to `MERGED`, flagged, cross-referenced to
ESC-046. FOLLOW-743's retrospective is still owed regardless of how the merge happened (Step 6/7
applies to any DONE ticket, not only human-merged ones).

**CI-check counter:** 1/5 for both tickets (one `gh pr checks --watch` run each). **Fix-iteration
counter:** 0/3 for both — no fix round was needed.

NEXT: Human review + merge on PR #647; human ruling needed on ESC-046 (PR #646's out-of-process
merge) before this PM dispatches another Bash-capable worker with merge-capable credentials. Once
#647 merges, spawn retrospectives for both FOLLOW-743 and FOLLOW-744 before picking new work; read
FOLLOW-751/752/753/754 first. Human attention still needed on ESC-020/041/042/044/045 items 2-3.

---

# Status — 2026-07-31 (session 85 — FOLLOW-736 retro dispatched; FOLLOW-743 + FOLLOW-744

dispatched (gate re-judged narrower); 5 ESCALATIONS open, non-blocking-for-dispatch)

## SESSION 85 (2026-07-31) — FOLLOW-736 retro dispatched; FOLLOW-743/744 dispatched

**State re-verified before doing anything:** `git status` clean, `main` at `507b6192`.
`gh pr list --state open` → empty. No stray `claude --agent` processes, `.claude/worktrees/` empty —
nothing stranded. `backlog/ESCALATIONS.md`: 5 `## OPEN` entries (ESC-020, ESC-041, ESC-042-narrowed,
ESC-044, ESC-045), unchanged from session 84's validation pass.

**Escalation gate re-judged, narrower than sessions 82/83's blanket hold.** All 5 open items
self-scope their own `Affects:` list to specific tickets, and none names FOLLOW-743 or FOLLOW-744.
Per the same reasoning sessions 59-76 already used for ESC-020/041/042 (standing 2026-07-27 CEO
ruling: external/operator-only blockers are non-blocking-for-dispatch) and sessions 71-76 applied to
ESC-044/045 for unrelated tickets, dispatched FOLLOW-743 and FOLLOW-744 — both self-contained
engineering fixes with no Piotr-blocking step in their own critical path. Held FOLLOW-749 and the
P2/P3 stubs (731-734, 737, 740, 745-748, 750) for the ≤3-concurrent-tickets guardrail and bounded
validation surface, not for the escalation gate — re-judge next session.

**FOLLOW-736 retrospective dispatched (Step 6/7 maintenance, owed since the 2026-07-31 merge).**
Model: Opus. Nohup'd (`claude --agent retrospective-analyst --model opus`), PID and log path below.

**FOLLOW-743 dispatched** to backend-engineer (model Sonnet — routine wiring of an existing shared
helper into one more call site, no ambiguous AC). Branch
`backend-engineer/FOLLOW-743-spend-cap-sentry-init`. Delegation-table row: "ingest worker,
control-plane, decision-api, Postgres/RLS, auth, onboarding HTTP, billing, webhooks" →
backend-engineer.

**FOLLOW-744 dispatched** to devops-engineer (model Sonnet — mechanical hardening of an existing
helper + a provisioning runbook instruction, no new design). Branch
`devops-engineer/FOLLOW-744-sentry-dsn-provisioning`. Delegation-table row: "Terraform, CI/CD,
workflows, secrets, observability, runbooks" → devops-engineer.

**Verified no file overlap between FOLLOW-743 and FOLLOW-744 before dispatching both concurrently:**
743 touches `generate_description.py` + `check-sentry-init-singleton.sh` + its own test file; 744
touches `observability.py` canonical + 2 mirrors + `MODAL_PROD_STANDUP.md` — disjoint.

**Bookkeeping committed BEFORE dispatch** (no concurrent git ops with a running subagent):
`backlog/QUEUE.md` (session-85 header + FOLLOW-743/744 entries), `backlog/FOLLOW_UPS.md`
(`promoted_to_queue: true` for both), `backlog/STATUS.md`, pushed to `origin/main` before any
subagent started.

**Dispatch mechanism:** nohup'd
`claude --agent <worker> -p "<brief>" --permission-mode acceptEdits --model sonnet`
(backend-engineer, devops-engineer) and `--model opus` (retrospective-analyst), all backgrounded —
no Task/Agent tool available to this PM session, same sanctioned pattern as prior sessions. Logs
(session-scoped scratchpad, not `/tmp` generically):

- `/tmp/claude-1000/-home-asipi-Projects-Adaptive-Listings/ff4eb2cc-757f-4543-8412-8d16f102e93c/scratchpad/dispatch_logs/retro736_analyst.log`
- `/tmp/claude-1000/-home-asipi-Projects-Adaptive-Listings/ff4eb2cc-757f-4543-8412-8d16f102e93c/scratchpad/dispatch_logs/follow743_backend.log`
- `/tmp/claude-1000/-home-asipi-Projects-Adaptive-Listings/ff4eb2cc-757f-4543-8412-8d16f102e93c/scratchpad/dispatch_logs/follow744_devops.log`

PIDs confirmed running via `ps -eo pid,lstart,cmd | grep 'claude --agent'` at T+5s (all three showed
their full `-p` argument in the process table, not just a wrapper shell — real work in flight, per
`feedback_pm_nohup_dispatch_silently_fails`): retrospective-analyst **122018**, backend-engineer
(FOLLOW-743) **122371**, devops-engineer (FOLLOW-744) **122776**. **Caveat for next session:** the
FOLLOW-744 `-p` prompt used unescaped backticks around two code identifiers inside a double-quoted
bash string, which bash command-substituted away before the process ever saw them — the worker's own
delegation brief lost two inline code mentions (still fully recoverable from `backlog/FOLLOW_UPS.md`
→ `## FOLLOW-744`, which the brief tells it to read verbatim). Worth a lessons-file note: never use
bare backticks inside a double-quoted `-p` string.

**CI-check counter:** 0/5 for both tickets. **Fix-iteration counter:** 0/3 for both. No PR opened
yet this session.

**2 tickets IN_PROGRESS** (FOLLOW-743, FOLLOW-744) — within the ≤3 guardrail. The retrospective is
Step-6/7 maintenance, not a queue ticket, and is not counted against the cap.

**5 escalations remain OPEN**, all non-blocking-for-dispatch: ESC-020 (Rafał, `web-master` prod
deploy, open since 2026-06-06), ESC-041 (npm registry E403, FOLLOW-626, open since 2026-07-23),
ESC-042-narrowed (Modal `intent-engine` operator deploy, FOLLOW-635, open since 2026-07-24), ESC-044
(consent-hash placeholder + DPO ruling, open since 2026-07-27), ESC-045 (Upstash dev-parity items
2-3 still open on Piotr; item 1 corrected FALSE by session 84, item 4 resolved + re-owned to
FOLLOW-744). Surfaced for human attention, not re-litigated.

NEXT: Use the backend-engineer subagent on FOLLOW-743 and the devops-engineer subagent on
FOLLOW-744. (table rows: "ingest worker, control-plane, decision-api, Postgres/RLS, auth, onboarding
HTTP, billing, webhooks" → backend-engineer; "Terraform, CI/CD, workflows, secrets, observability,
runbooks" → devops-engineer)

**INCIDENT, caught and fully recovered mid-session — read before dispatching 2+ code-writing agents
concurrently again.** Dispatching backend-engineer and devops-engineer at the same time with the
same `cwd` (no per-agent `git worktree`) meant both shared ONE `.git/HEAD`. Each agent's own
`git checkout -b <its branch>` silently flipped HEAD out from under the other, and git's default
behavior (carry non-conflicting working-tree edits across a checkout) meant each agent's
in-progress, uncommitted files kept riding along onto whichever branch happened to be checked out —
including, briefly, this PM's own routine post-dispatch `git commit` for a `backlog/STATUS.md` PID
update, which landed on `devops-engineer/FOLLOW-744-...` instead of `main` (session's own
"bookkeeping before dispatch, never during" rule was followed for the FIRST commit but violated for
a SECOND one made ~1 minute after dispatch, while both workers were already live). Two of devops-
engineer's own commits also transiently landed on backend-engineer's branch mid-session for the same
reason. **Nothing was lost** — recovered live via `git diff`-backed patches to
`/tmp/.../scratchpad/git-recovery/*.patch` before any mutation, `git stash push` with explicit
pathspecs to separate the two agents' interleaved uncommitted diffs without discarding either,
`git reset --soft`/`git cherry-pick` to move commits to their correct branch without touching
working-tree content, and a `git worktree add` for this very commit (isolating the PM's own
bookkeeping from the two still-running agents' shared tree) rather than checking out `main` in the
contested directory. **End state verified clean:** PR #646 (FOLLOW-743,
`backend-engineer/FOLLOW- 743-spend-cap-sentry-init`) contains only `.github/workflows/ci.yml` +
`generate_description.py`/its test + the new `check-sentry-capture-has-init.sh` — 4 files, no
`observability.py` contamination. PR #647 (FOLLOW-744,
`devops-engineer/FOLLOW-744-sentry-dsn- provisioning`) contains only `.env.example` +
`observability.py` ×3 + `test_observability.py` + `MODAL_PROD_STANDUP.md` — 6 files, no
`generate_description.py` contamination. **Binding rule for every future session:** never dispatch
two or more Bash-capable (code-writing) subagents into the same literal working directory
concurrently unless each is given its own `git worktree` first
(`git worktree add <path> -b <branch>` per agent, then `cd <path>` inside that agent's own dispatch
command) — a draft-only agent (no Bash/git, e.g. `architect` in draft mode) is always safe to run
alongside one Bash-capable agent, which is why sessions 80-82 never hit this. Retrospective-analyst
was the third concurrent process this session and stayed safe throughout only because its own first
commit had not landed yet when the collision was caught and fixed — it was not an exception to the
rule, just lucky timing.

---

# Status — 2026-07-30 (session 83 — FOLLOW-736 held (escalation gate), FOLLOW-739 re-scoped not

dispatched, FOLLOW-738 retro dispatched; ESC-045 narrowed to items 1-3; 5 ESCALATIONS open)

## SESSION 83 (2026-07-30) — FOLLOW-736 held, FOLLOW-739 re-scoped, FOLLOW-738 retro dispatched

**State re-verified:** `main` at `1bea483d`, clean, matches session-82 handoff exactly.
`gh pr list --state open` → empty. No stranded processes/worktrees.

**5 escalations still OPEN**, ages as of today (2026-07-30): ESC-020 (~24d, Rafał/`web-master` prod
deploy), ESC-041 (~7d, npm registry E403 / FOLLOW-626), ESC-042-narrowed (~6d, Modal `intent-engine`
operator deploy / FOLLOW-635), ESC-044 (~3d, consent-hash placeholder / DPO ruling), ESC-045 (~1d;
item 4's HAZARD leg resolved this cycle by FOLLOW-738 — corrected below, its CHANNEL leg was not).
None newly arrived; none resolved by a human this session.

**Judgement call: FOLLOW-736 NOT dispatched, despite being ready in principle.** Its own
`depends_on`/`blocks` chain is fully clear (FOLLOW-730 merged, FOLLOW-741 DONE). But it is generic
ADR-0020 implementation scope — it does not clear or touch any of the 5 open escalations. Applied
the same distinction the session-81 note itself drew for this exact ticket ("no NEW ticket is picked
while escalations are open ... FOLLOW-736 dispatch does not [proceed]"), rather than the narrower
exception used for FOLLOW-738/741 (escalation-clearing remediation only). Held for a future session
to re-judge.

**FOLLOW-739 re-scoped in place, not dispatched.** Read `observability.py`,
`check-sentry-init-singleton.sh`, `test_observability.py` and
`apps/control-plane/sentry.server.config.ts` directly against `main` rather than trusting the
handoff's framing. Found FOLLOW-738 landed a real `before_send` hook + CI gate (so "exist nowhere"
is now false), but the docs' actual wording ("PII patterns regex", blanket Sentry-row scrubbing
claim, "CI check on scrubber config") remains inaccurate, and `apps/control-plane`'s 3 Sentry
configs have zero scrubbing (FOLLOW-738 explicitly deferred that). Rewrote the ticket's AC to match
reality rather than dispatching a worker against a premise that had partially become true. Held for
the same escalation-gate reason as FOLLOW-736.

**Retrospective for FOLLOW-738 (PR #644, merged `479ac0ef`) — owed since session 82, dispatched AND
completed this session.** Model: Opus. Dispatched nohup'd (`claude --agent retrospective-analyst`,
PID 102802, log
`/tmp/claude-1000/-home-asipi-Projects-Adaptive-Listings/ff4eb2cc-757f-4543-8412-8d16f102e93c/scratchpad/dispatch_logs/retro738_analyst.log`),
ran ~20 minutes, committed locally on branch `retrospective-analyst/RETRO-235-follow-738-retro`
(`c90830a6`) because it correctly detected `main` had advanced past its prepared context and refused
to force onto it. Verified the commit was a clean, append-only diff to
`backlog/RETROSPECTIVES.md`/`backlog/FOLLOW_UPS.md` (845 insertions, 2 files, no code), fast-forward
merged onto `main`, deleted the branch, pushed. **RETRO-235 filed: 2 logic gaps / 5 code bugs (2×P1)
/ 3 test gaps / 3 doc gaps; wiring CHECK A clean, CHECK B 4 half-wires (2×P1 FOLLOW-743/744, 2×P2
FOLLOW-745/746); no rule promoted (Rule J/K.1 held at 2 — this instance is the pattern's remedy, not
its recurrence). Follow-ups FOLLOW-743..748.**

**The finding that mattered most: DG-1 — my own session-83 opening lines repeated the exact
over-read RETRO-235 flags.** ESC-045 item 4 carried two legs (hazard + absent channel); FOLLOW-738
closed only the hazard, but this session's own `QUEUE.md`/`STATUS.md` header (written before the
retro ran) said "items 1-3 remain the ONLY open blockers" — which reads as if the whole Sentry
channel is now closed. It isn't: `SENTRY_DSN` still has zero producers in prod (RETRO-235 §3 HW-2).
Corrected in place in `backlog/ESCALATIONS.md` (ESC-045, non-blocking correction, no new decision)
and in this session's own `QUEUE.md` header, rather than leaving the imprecise framing to propagate
to the next session. FOLLOW-744 now owns the untracked leg.

**Bookkeeping committed BEFORE dispatch, and again after retro completion** (no concurrent git ops
while the subagent was running — did not touch `backlog/FOLLOW_UPS.md`/`RETROSPECTIVES.md` while its
own uncommitted changes were staged in the shared working tree).

**0 tickets IN_PROGRESS** (FOLLOW-736/739/740 all held; no worker ticket dispatched this session —
only the retro, which is Step 6/7 maintenance, not a new ticket pick). **CI-check counter:** N/A (no
worker PR this session). **Fix-iteration counter:** N/A.

NEXT: Re-judge FOLLOW-736 and dispatch FOLLOW-743/744 (P1, both new from RETRO-235) next session —
human attention still needed on ESC-020/041/042/044/045 items 1-3 (see backlog/ESCALATIONS.md).

---

## SESSION 82 (2026-07-30) — FOLLOW-738 + FOLLOW-741 dispatched, FOLLOW-742 closed stale

**State re-verified before doing anything:** `git status`/`git log -20` match the session-81 handoff
exactly (`main` at `06553402`). `gh pr list --state open` → empty. No `claude --agent` process
running, `.claude/worktrees/` empty — nothing stranded. `backlog/ESCALATIONS.md`: 5 `## OPEN`
entries (ESC-020, ESC-041, ESC-042-narrowed, ESC-044, ESC-045), unchanged from session 81.

**Escalation-gate judgement call, made explicitly rather than defaulting to "stop":** the standing
loop says no new ticket while escalations are open. ESC-045 item 4's own text names FOLLOW-738 as
its recommended remediation ("land FOLLOW-738 FIRST... recommended") — dispatching it removes a
named blocker rather than adding independent new scope, so it proceeds under the same reasoning
already applied to ESC-020/041/042 across sessions 59-76. FOLLOW-741 is dispatched alongside for a
narrower, non-escalation reason: its own `blocks:` field names FOLLOW-736's _dispatch_ (not just its
merge) as gated on this ticket landing first, and it is a 1-hour architect doc correction — holding
it back would stall the FOLLOW-736 chain for no benefit.

**FOLLOW-742 closed as stale.** Verified directly: `git show 0fd34dd7 --stat` (PR #643 merge) added
FOLLOW-736/737 to `backlog/FOLLOW_UPS.md` on `main` at 2026-07-30T20:21, before the RETRO-234 commit
(`98995760`, 20:22) that filed FOLLOW-742 itself — so FOLLOW-742's premise ("736/737 exist only on
an unmerged branch") was already false the moment it was written. Closed with a note rather than
promoted to QUEUE.md; ran its AC-4 registry audit in the closure note instead (FOLLOW/RETRO/ESC/ADR
max-number sweep across `main`, all local branches, and `origin` — no gaps or dupes found, Rule AN
holds). Corrected the now-stale NUMBERING NOTE above `## FOLLOW-738` in the same commit.

**Bookkeeping committed BEFORE dispatch** (no concurrent git ops with a running subagent, per
`feedback_no_concurrent_git_with_subagents`): one commit touching `backlog/FOLLOW_UPS.md` (NUMBERING
NOTE correction, FOLLOW-742 closure, FOLLOW-738/741 `promoted_to_queue`) and `backlog/QUEUE.md`
(session-82 header + FOLLOW-738/741 IN_PROGRESS ticket entries), pushed to `origin/main` before
either worker was started.

**Dispatching FOLLOW-738** to devops-engineer (model: Sonnet — routine implementation, well-scoped,
mechanical hardening + CI guard, no prior failed attempt at this scope) on branch
`devops-engineer/FOLLOW-738-hardened-sentry-init`. Full delegation brief in `backlog/QUEUE.md`
FOLLOW-738 entry. **Delegation-table row used:** "Terraform, CI/CD, workflows, secrets,
observability, runbooks" → devops-engineer.

**Dispatching FOLLOW-741** to architect, **draft-only mode** (architect has no Bash tool, per
`docs/AGENT_WORKFLOW.md` "Agent tool-capability routing" — this ticket is a doc correction to
ADR-0020, no branch/PR possible from architect alone). Model: Sonnet — factual correction to an
already-proven-wrong document, not new design reasoning; D1-D5/D7 explicitly out of scope. Full
delegation brief in `backlog/QUEUE.md` FOLLOW-741 entry. **Delegation-table row used:** "a contract
between two modules, a new dependency, an ADR" → architect.

**Dispatch mechanism:** nohup'd
`claude --agent devops-engineer -p "<brief>" --permission-mode acceptEdits --model sonnet` and
`claude --agent architect -p "<brief>" --permission-mode acceptEdits --model sonnet` (draft-only
prompt, no Edit/Write/git instruction given), both in the background — no Task/Agent tool available
to this PM session, same sanctioned nohup pattern as prior sessions. Logs:
`/tmp/claude-1000/-home-asipi-Projects-Adaptive-Listings/ff4eb2cc-757f-4543-8412-8d16f102e93c/scratchpad/dispatch_logs/follow738_devops.log`
and
`/tmp/claude-1000/-home-asipi-Projects-Adaptive-Listings/ff4eb2cc-757f-4543-8412-8d16f102e93c/scratchpad/dispatch_logs/follow741_architect.log`
— recorded here so a future session can collect them without re-dispatching, per standing
instruction.

**CI-check counter:** 0/5 (both tickets). **Fix-iteration counter:** 0/3 (both tickets). No PR
opened yet.

**2 tickets IN_PROGRESS this session** (FOLLOW-738, FOLLOW-741) — within the ≤3 guardrail.

**5 escalations remain OPEN**, all non-blocking-for-dispatch per the reasoning above: ESC-020
(Rafał, `web-master` prod deploy, open since 2026-06-06), ESC-041 (npm registry E403, FOLLOW-626,
open since 2026-07-23), ESC-042-narrowed (Modal `intent-engine` operator deploy, FOLLOW-635, open
since 2026-07-24), ESC-044 (consent-hash placeholder + DPO ruling, open since 2026-07-27), ESC-045
(local chat-NLP shim credentials + Sentry hardening gap, open since 2026-07-29, item 4 added
2026-07-30 — this session's FOLLOW-738 dispatch is that item's own recommended next step). Surfaced
again, not re-litigated; no new escalation filed this session.

NEXT: Use the devops-engineer subagent on FOLLOW-738 and the architect subagent (draft-only) on
FOLLOW-741. (table rows: "Terraform, CI/CD, workflows, secrets, observability, runbooks" →
devops-engineer; "a contract between two modules, a new dependency, an ADR" → architect)

---

## SESSION 81 (2026-07-30) — FOLLOW-735 draft recovered and applied (ADR-0020); DONE

**State re-verified before doing anything:** `main` clean at `dc33da34`, no worker process running.
Read `backlog/QUEUE.md`, `backlog/ESCALATIONS.md` (grepped `## OPEN`: **5** entries — ESC-020,
ESC-041, ESC-042, ESC-044, ESC-045), `backlog/HANDOFFS.md`, `git log -20`, `gh pr list --state open`
(none). Per the operating loop, 5 open ESCALATIONS mean no NEW ticket gets picked this session; the
work done below is finishing already-in-flight FOLLOW-735 (Step 6/7 territory: the architect had
already been paid for and had already produced output), not picking new work.

**Found the architect's DRAFT-ONLY dispatch output before considering re-dispatch, per standing
instruction.** No worktree, no `ps` process, no file under the repo or `/tmp/claude-1000/.../tasks/`
directly named for it — but `/tmp/claude-1000/.../scratchpad/dispatch_logs/follow735_architect.log`
(session-scoped scratchpad, not `/tmp` generically) had the full 720-line response: Q1 ruling, D2-D7
spec, a full ADR-0020 draft, a `docs/adr/README.md` index row, a 3-part MASTER_DESIGN patch, an
`docs/INTERFACES.md` entry, two FOLLOW_UPS stubs (FOLLOW-736/737), an architect-lessons entry, and a
HANDOFFS draft — genuinely complete, paid-for work. Did not re-dispatch.

**Independently re-verified the draft's load-bearing technical claims against HEAD before applying
anything** (not taken on the architect's word): read `apps/intent-engine/src/redis_writer.py` in
full — confirmed the unconditional `SET`, zero `nx` references, matches the draft's Context exactly;
read `schemas.py` — `DEGRADED_DATA_SOURCES = frozenset({"error_fallback", "empty_model_response"})`
matches verbatim; grepped `chat-intent-cache.ts` — `flattenIntentDimensions` at line 176 as cited;
grepped `packages/sdk/src/core/adapt.ts` — `Object.keys(dims).length > 0` guard at line 872 (draft
cited 868-880, close enough, verified the actual guard exists); and directly inspected the installed
`upstash_redis` client (`apps/intent-engine/.venv/.../upstash_redis/commands.py:4611`) —
`set(key, value, nx: Optional[bool] = None, ..., ex: Optional[int] = None, ...)` genuinely exists,
so the whole mechanism the spec depends on is real, not assumed.

**Applied verbatim on branch `pm-orchestrator/FOLLOW-735-adr-0020-shadow-write-admission`** (created
immediately — one file (`ADR-0020...md`) had already been written while still on `main`; the
FOLLOW-448 branch guard warned, branch was created immediately after with the untracked file carried
over cleanly, nothing else was on `main` to strand): new
`docs/adr/ADR-0020-shadow-intent-write-admission.md` (Q1 ruling + D1-D7 spec, 5 alternatives
considered, reversibility stated), `docs/adr/README.md` index row, `docs/MASTER_DESIGN.md` v4.3→v4.4
(version line + Polish changelog paragraph + §D.1.1 body marked "⚠️ SPEC, NOT YET IMPLEMENTED AT
HEAD"), `docs/INTERFACES.md` new "Chat-Intent Shadow Key Contract" entry with two worked JSON
examples, `backlog/FOLLOW_UPS.md` two new stubs (**FOLLOW-736** implementation
P2/ml-engineer/Sonnet, **FOLLOW-737** missing shared-Zod-schema gap P3/backend-engineer),
`.claude/agents/architect/lessons.md` append, and `backlog/HANDOFFS.md` entry to ml-engineer.
Committed (`0f2a033e`), pushed to origin. No PR opened — this is spec/doc content with no runtime
change to gate on CI; left for next session to decide whether to fold into the FOLLOW-736
implementation PR or open standalone.

**Deliberately NOT applied: ADR-0020 status `PROPOSED`→`ACCEPTED`.** The architect's own draft named
D1 (should a failed extraction ever neutralise a served prior) "a product tradeoff" and explicitly
offered the PM a choice to leave it PROPOSED for Piotr instead of self-ratifying. Taken — ratifying
a product-tradeoff ADR is outside the PM-orchestrator's scope ("MUST NOT... make architectural
calls"), even though `docs/adr/README.md` §Governance nominally allows PM+architect Tier-2
ratification. Noted in QUEUE.md as a decision for Piotr, not filed as a numbered ESC (doesn't block
any other ticket).

**FOLLOW-735 marked DONE** — all 4 ACs met (ruling, spec, non-implementation + handoff named, marker
fate answered). **FOLLOW-736/737 filed but NOT dispatched** — the 5 open escalations block picking
new work this session.

**FOLLOW-730's retrospective — still not run.** Flagging explicitly for the second session in a row
rather than silently deferring: this was the other Step-7 item in the handoff and the FOLLOW-735
recovery/verification/apply work took the full session. Next session should run it first, or state
why not.

**Escalations, ages, unchanged from the handoff:** ESC-020 (Estalara-app DOM hooks undeployed),
ESC-041 (Release workflow E403), ESC-042 item 1 (Modal `intent-engine` operator deploy), ESC-044
(consent-hash placeholder, items open), ESC-045 (4 items — `ANTHROPIC_API_KEY`, Upstash
writer/reader parity, `SENTRY_DSN`). All operator/Piotr-gated, surfaced not re-litigated, not
re-dated this session (no new information on any of them).

**0 tickets IN_PROGRESS at session end** (FOLLOW-735 closed to DONE, nothing else picked up) — well
within the ≤3 guardrail. No CI run this session (doc/backlog-only diff, no PR opened, nothing to
gate).

NEXT: Human attention needed — see `backlog/ESCALATIONS.md` (5 OPEN: ESC-020, ESC-041, ESC-042,
ESC-044, ESC-045) and the Piotr-facing ADR-0020 ratification note in `backlog/QUEUE.md`. Once
resolved, dispatch FOLLOW-736 to ml-engineer (Sonnet) per the delegation table row "intent/adapt
logic... ml-engineer" and run FOLLOW-730's overdue retrospective.

---

## SESSION 80 (2026-07-30) — PR #642 re-validated, FOLLOW-735 filed and dispatched

**State re-verified before doing anything:** `main` clean at `3f130bb8` matching the handoff.
`gh pr list --state open` → PR #642 only (FOLLOW-730). `backlog/ESCALATIONS.md`: 3 `## OPEN` entries
(ESC-042 item 1 narrowed, ESC-044, ESC-045) — all operator/CEO-gated per the standing 2026-07-27
non-blocking-for-dispatch ruling, re-surfaced not re-litigated, consistent with prior sessions.
Proceeded on that established basis.

**PR #642 (FOLLOW-730) independently re-validated — evidence pasted directly on the PR, not
transcribed from QUEUE.md's prose:**

- CI (5b): `gh pr checks 642` → 63 pass, 2 fail (both `Rule I — wired-or-dead check`, duplicate job
  entries). Pulled the job log myself (`gh api .../jobs/{id}/logs`): `Violations found : 192` on
  this PR's run (job 90825006911) AND on `main`'s own latest CI run (job 90827261130) —
  byte-identical, confirming pre-existing-red rather than trusting the queue's claim. Non-success
  count for all REAL gates = **0**.
- Runtime wiring (5c): fetched the PR branch directly (`git show origin/<branch>:<path>`) rather
  than reading the PR body. Producer: `schemas.py` (`ChatIntentDataSource`, `data_source`,
  `extraction_error`, `DEGRADED_DATA_SOURCES`); `nlp.py` stamps `data_source` at 4 call sites.
  Consumer 1: `chat-intent-cache.ts`'s loose-parse `ShadowChatIntent` interface structurally ignores
  the new top-level fields (read directly, confirmed). Consumer 2: `jobs/batch_enrich.py:48,59`
  imports + branches on `DEGRADED_DATA_SOURCES` — real, non-test. Confirmed `redis_writer.py` has
  zero references to the reverted clobber logic (matches the round-3 revert claim).
- Scope: diff is `apps/intent-engine/*` (Python) + compliance docs + backlog bookkeeping only; the
  lone `main.py` change adds `sentry-sdk` to the Modal image's `pip_install`, unrelated to the
  archetype/spawn path.
- Posted full evidence as a PR comment ending "PM-validated. CI green. Runtime wiring confirmed.
  Ready for human review." **Not merged — Piotr's call.** Fix-iteration counter unchanged: 3/3, at
  the guardrail; no further patches on this branch.

**Gap found and corrected: FOLLOW-735 had never actually been filed.** The prior session's commit
message claimed "file follow-735" but only `backlog/QUEUE.md` prose referenced it — no ticket stub
existed in `backlog/FOLLOW_UPS.md`. Read the PR branch's reverted clobber-fix attempts and
`test_degraded_payload_currently_still_overwrites_a_prior` directly to reconstruct the six design
questions faithfully, then filed the real `## FOLLOW-735` stub (P2, architect, `depends_on: []`,
`promoted_to_queue: true`).

**FOLLOW-733 re-checked against #642's actual diff (per the handoff's own caution) before
considering dispatch:** confirmed its four defects (stale "Placeholder/TICKET-013" header, falsified
`ANTHROPIC_API_KEY`-500 claim, nonexistent `.dev.vars` reference, sync-vs-spawn consequence gap) are
still present, unmodified, on the PR #642 branch — #642's README changes are additive documentation
about the NEW 502 response, a different section. Not redundant; left undispatched (P3 < FOLLOW-735's
P2) for a future session.

**Ticket picked and dispatched: FOLLOW-735** (P2, `depends_on: []`) — directly serves Piotr's
standing "100% localhost" priority (the exact chat→archetype shadow-key loop), outranks the P3
siblings (731/732/733/734), and its own AC scopes it to a design decision + spec only (~2h), not a
build. **Delegation-table row used:** "a contract between two modules, a new dependency, an ADR" →
architect.

**Model-fit:** architect dispatched with `model: opus` (explicit override of the agent definition's
sonnet default) — justified as "ambiguous acceptance criteria, non-trivial design" per the model-fit
table: the core AC is a product ruling (Q1) with compliance (C-07/ROPA/DPIA retention) and
concurrency (atomicity, TTL, validation invariants) side-constraints, and 3 prior lower-effort
attempts already got it wrong. Not escalated to Fable — single-domain, reversible (spec only), and
PR-gated.

**Tool-capability correction caught before dispatch:** the first draft of the delegation brief told
architect to "open a PR" — wrong, per `docs/AGENT_WORKFLOW.md` "Agent tool-capability routing"
(RETRO-168/174, FOLLOW-551), architect has no Bash tool. Corrected to draft-then-apply (option 2)
before dispatching: architect returns spec text + insertion anchors only, PM applies afterward.
Fixed in a second bookkeeping commit, still before dispatch — no concurrent git ops with the running
subagent.

**Bookkeeping commits (both BEFORE dispatch, per "no concurrent git ops with a running subagent"):**
`cbbc29ba` (FOLLOW-735 stub + session header), `39f3603c` (tool-capability correction). Pushed to
`origin/main` both times. Dispatched architect via
`nohup claude --agent architect -p ... --model opus` after the second push; PID confirmed running
via `ps -eo pid,lstart,cmd`.

**CI-check counter (FOLLOW-730/PR #642):** 4/5. **Fix-iteration counter:** 3/3 — at the guardrail,
no further rounds. **1 ticket IN_PROGRESS this session** (FOLLOW-735) — within the ≤3 guardrail.

**3 escalations remain OPEN**, all non-blocking-for-dispatch per the standing ruling: ESC-042 item 1
(Modal `intent-engine` operator deploy), ESC-044 (consent-hash placeholder + withdrawal-channel DPO
ruling, items 1/3/5/6 still awaiting Piotr), ESC-045 (local chat-NLP shim credentials gap). Ages:
ESC-042 open since 2026-07-24 (narrowed 2026-07-27); ESC-044 open since 2026-07-27, updated
2026-07-28; ESC-045 opened this session's prior run, 2026-07-29 — still fresh, not yet stale.
Surfaced again, not re-litigated.

NEXT: Use the architect subagent on FOLLOW-735. (table row: a contract between two modules, a new
dependency, an ADR)

---

## SESSION 77 (2026-07-28) — FOLLOW-715 picked and dispatched

**State re-verified before doing anything:** `git status`/`git log -20` on `main` match session-76's
recorded head (`b2dd4585`) exactly before this session's bookkeeping commit (`0fd4ca45`).
`gh pr list --state open` → empty, nothing to validate. `.claude/worktrees/` empty, no stray
`claude --agent` processes before dispatch — nothing stranded to recover.

**Escalation gate:** 3 `## OPEN` entries in `backlog/ESCALATIONS.md` (ESC-041, ESC-042-narrowed,
ESC-044). ESC-041/042 carry the standing 2026-07-27 CEO dispatch-policy ruling
(non-blocking-for-dispatch, operator/human-only actions, re-surfaced not re-litigated). ESC-044 is
self-scoped in its own text to FOLLOW-704/706/710/711/701/714 and explicitly separates out
"coordinated code-fix follow-ups, filed but not escalated" — FOLLOW-715 is one of those, not named
in ESC-044's blocked list, and touches none of the questions routed to the CEO/DPO. Proceeded on
that basis, consistent with sessions 70-76's own framing ("Next free work (nothing blocked on a
ruling)"). No new escalation filed.

**Ticket picked:** FOLLOW-715 (P1, `depends_on: []`) over FOLLOW-716 (also P1, `depends_on: []`) —
FOLLOW-715 unblocks more: its own text states it blocks the held FOLLOW-704 (P0), which is the head
of the entire ESC-044 remediation chain. FOLLOW-716 is queued as the next pick.

**Dispatched to backend-engineer, model Sonnet** — routine implementation on a check the same
worker/tier shipped correctly one session ago (FOLLOW-712/PR #634), same file, no ambiguous AC, no
prior failed attempt. Branch `backend-engineer/FOLLOW-715-tos-version-grace-window`. Full delegation
brief in `backlog/QUEUE.md` session-77 head.

**Bookkeeping committed BEFORE dispatch** (no concurrent git ops while a subagent runs, per
`feedback_no_concurrent_git_with_subagents`): commit `0fd4ca45` on `main`
(`docs(backlog): promote + dispatch FOLLOW-715 to backend-engineer [FOLLOW-715]`).

**Dispatch mechanism:** nohup'd
`claude --agent backend-engineer -p "<brief>" --permission-mode acceptEdits --model sonnet` in the
background (no Task/Agent tool available to this PM session — the sanctioned equivalent per
CLAUDE.md's agent-orchestrated model, same pattern as retrospective-analyst dispatches). Confirmed
the real worker process is alive via `pgrep -af "agent backend-engineer"` → PID 14664, not just the
wrapper shell — per `feedback_pm_nohup_dispatch_silently_fails`, a short/quiet log at T+5s is
expected, not a failure signal (Claude Code buffers `-p` output until exit). Log:
`/tmp/claude-1000/.../scratchpad/follow715-worker.log` (session-scoped, not persisted past this
session — worker's own PR is the durable artifact).

**CI-check counter:** 0/5. **Fix-iteration counter:** 0/3. No PR opened yet.

**1 ticket IN_PROGRESS** (FOLLOW-715) — within the ≤3 guardrail.

**Did not wait synchronously for the worker to finish** — real coding + tests + build + PR opening
takes longer than one PM turn should block on; per this repo's own established multi-session cadence
(see `backlog/QUEUE.md` sessions 64→65→66, 67→68→69, etc. — dispatch and validate are routinely
separate invocations), the next PM invocation should first check
`ps -eo pid,lstart,cmd | grep 'claude --agent'` and `gh pr list --state open` before assuming
anything, then run the full validation loop (5a-5g) once a PR exists.

NEXT: Use the backend-engineer subagent on FOLLOW-715. (table row: "ingest worker, control-plane,
decision-api, Postgres/RLS, auth, onboarding HTTP, billing, webhooks")

---

# Status — 2026-07-27 (session 64 — FOLLOW-684 promoted + dispatched to backend-engineer)

## SESSION 64 (2026-07-27) — FOLLOW-684 picked and dispatched

**State re-verified before doing anything (not taken on trust):**

- `git status` on `main`: clean, up to date with `origin/main`. The stale `M ...`/branch-checkout
  gitStatus block shown at session boot (branch
  `backend-engineer/FOLLOW-678-first-party-tenant-id-canonicalize`) was from a previous session and
  no longer reflects the real working tree — reconfirmed via fresh `git status` +
  `git log origin/main -5` (matches `backlog/QUEUE.md`'s recorded merge of PR #630).
- `gh pr list --state open`: empty. No PR to validate this session.
- `.claude/worktrees/`: empty. `ps -eo pid,lstart,cmd | grep 'claude --agent'`: no running worker
  processes. Nothing stranded to recover.
- `backlog/ESCALATIONS.md`: 3 `## OPEN` entries (ESC-020, ESC-041, ESC-042-narrowed). All three
  carry the standing 2026-07-27 CEO dispatch-policy ruling (recorded in `backlog/QUEUE.md` session
  62 head): external/operator-only blockers, explicitly non-blocking-for-dispatch, surfaced every
  session close, not to be re-litigated absent a new ruling. No NEW escalation exists this session.
  Proceeded per that standing ruling — consistent with sessions 59-63, which is the reason I did not
  stop at step 1.

**Ticket selection:** 4 candidate P1 stubs in `backlog/FOLLOW_UPS.md` from RETRO-223/224/225:
FOLLOW-680 (sdk-engineer, **blocked** — `depends_on: [FOLLOW-673]`, not started), FOLLOW-684
(backend-engineer, `depends_on: []`), FOLLOW-685 (backend-engineer, `depends_on: []`, docs-only),
FOLLOW-693 (devops-engineer, `depends_on: []`, but AC-1 needs a production Cloudflare secret write —
same operator-credential class as ESC-020/042, deferred rather than assumed-safe to hand a code-only
worker this session). Picked **FOLLOW-684**: P1, zero deps, `recommended_sprint: now`, a live
security/compliance gap (fabricable GDPR consent attestation for an unprovisioned external brand),
bounded code AC, single module backend-engineer already owns.

**Premise independently verified** by reading
`apps/control-plane/src/app/api/v1/consent/platform-registration/route.ts` directly: the GET handler
gates on `isUnprovisionedExternalBrand` (`:246`); the POST write path (`:285-480`) does not — only
`isFirstPartyTenant` (`:331`) and `requiresExplicitConsentHash` (`:375`) gate it, and the INSERT
(`:454-467`) stores `consent_text_hash ?? CANONICAL_CONSENT_TEXT_HASH` unconditionally once past the
duplicate-nonce check. `grep -n isUnprovisionedExternalBrand route.ts` → exactly 1 hit (the GET).
Ticket premise confirmed, not assumed.

**Bookkeeping done BEFORE dispatch (no concurrent git ops with a running subagent):**
`backlog/QUEUE.md` (new session-64 head + FOLLOW-684 ticket entry, `status: IN_PROGRESS`,
`assigned_to: backend-engineer`, `started_at: 2026-07-27`, branch recorded), `backlog/FOLLOW_UPS.md`
(FOLLOW-684 `promoted_to_queue: true`). Committing this as a single docs commit before dispatching
any subagent.

**Dispatching FOLLOW-684** to backend-engineer (model: Sonnet — routine, well-scoped, single-module,
no prior failed attempt, no cross-module contract change, AC explicitly bounds the judgement call
out of scope) on branch `backend-engineer/FOLLOW-684-consent-post-brand-gate`. Full delegation brief
in `backlog/QUEUE.md` FOLLOW-684 ticket entry.

**Delegation-table row used:** "ingest worker, control-plane, decision-api, Postgres/RLS, auth,
onboarding HTTP, billing, webhooks" → backend-engineer.

**CI-check counter:** 0/5. **Fix-iteration counter:** 0/3. (No PR opened yet this session.)

**1 ticket IN_PROGRESS** (FOLLOW-684) — within the ≤3 guardrail.

**3 escalations remain OPEN**, all non-blocking-for-dispatch per the standing ruling: ESC-020
(Rafał, `web-master` prod deploy), ESC-041 (npm registry E403, FOLLOW-626), ESC-042 (narrowed —
Modal `intent-engine` operator deploy, FOLLOW-635). Surfaced again next session close.

**Deferred, not dispatched this session:** FOLLOW-685 (P1, backend-engineer, docs/handoff-only, no
deps — good next pick, would need step 5d n/a since it's not co-assigned) and FOLLOW-693 (P1,
devops-engineer, no deps, but AC-1's `wrangler secret put` against prod needs a check on whether
this session/environment actually holds prod Cloudflare credentials before dispatching — flag for
next session rather than dispatch blind).

NEXT: Use the backend-engineer subagent on FOLLOW-684. (table row: control-plane/auth/onboarding
HTTP)

---

# Status — 2026-08-02 (session 88 — retro dispatched for FOLLOW-760 (#650) + FOLLOW-746 (#651))

## SESSION 88 — combined retro dispatched before any new ticket

**State:** `main` clean at `1f5f73c7`, matches `origin/main`. No open PRs, no running workers, no
stranded worktrees. 5 escalations OPEN (ESC-020, ESC-041, ESC-042-narrowed, ESC-044, ESC-045 items
2-3) — all non-blocking-for-dispatch per standing rulings / self-scoping, unchanged from session 87.

**Action this turn:** FOLLOW-760 (PR #650) and FOLLOW-746 (PR #651) both reached DONE today with no
retrospective run yet (last retro was RETRO-238, covering FOLLOW-757+752). Dispatched a combined
`retrospective-analyst` (model: Opus, per CLAUDE.md model-fit rule for retros) on branch
`retrospective-analyst/RETRO-239-follow-760-746-combined`. Nohup'd (no Task/Agent tool in this
session):
`claude --agent retrospective-analyst -p "<brief>" --permission-mode acceptEdits --model opus &`.
PID/log recorded below once confirmed alive.

**CI-check counter:** n/a (docs-only retro, no code ticket dispatched this turn). **Fix-iteration
counter:** n/a.

**0 tickets IN_PROGRESS.**

NEXT: Wait for retrospective-analyst (expect RETRO-239 in backlog/RETROSPECTIVES.md), confirm its
own branch, merge, then pick the next ticket (candidates: FOLLOW-759, FOLLOW-761/762/763, and older
P2/P3 stubs — see QUEUE.md session-88 head for the full list).

---

# Status — 2026-08-03 (session 89 — RETRO-239 merged, FOLLOW-765+759 dispatched combined)

## SESSION 89 — combined dispatch to devops-engineer/Opus

**State:** RETRO-239 merged by Piotr (`9e33bfe3`, docs-only, no rule promoted). 5 escalations OPEN,
unchanged, all non-blocking-for-dispatch. No open PRs, no running workers before this session's
dispatch.

**Action:** verified RETRO-239's findings independently (§3 HW-1/HW-2, §4b CB-1/CB-2, §7 stubs
765-769) rather than trusting the coordinator's summary. Picked FOLLOW-765 + FOLLOW-759 as a single
combined dispatch (same organ, two gates; FOLLOW-765 AC4 explicitly asks for coordination and one
shared baseline mechanism if done together). Dispatched devops-engineer on Opus (model-fit:
genuinely new design decision — a baseline-comparison mechanism neither gate has today — plus a
security-shaped judgement call in FOLLOW-765 AC2). Branch:
`devops-engineer/FOLLOW-765-759-suppression-inventories`.

Persisted the retrospective-analyst's `lessons.d/RETRO-239.md` fragment myself (PM-authored,
provenance noted in-file) since the analyst's own write to that path was denied this session by its
scoped dispatch brief.

**CI-check counter:** 0/5. **Fix-iteration counter:** 0/3.

**2 tickets IN_PROGRESS** (FOLLOW-765, FOLLOW-759 — one PR) — within the ≤3 guardrail.

NEXT: Wait for devops-engineer's PR, then run full validation (5a-5g), confirming ONE shared
baseline mechanism actually covers both gates rather than two bespoke ones.

---

# Status — 2026-08-03 (session 89 continued — PR #652 validated, FOLLOW-761 dispatched)

## SESSION 89 continued — PR #652 validated READY_FOR_REVIEW, next ticket dispatched

**Validated PR #652 (FOLLOW-765+759) in full (5a-5g).** CI: 67 pass / 2 fail, both `Rule I`
pre-existing-red (192 WARN lines, matched to baseline, confirmed via job log not label). Non-success
count for all real gates: 0. Independently re-derived, on my OWN fixtures (not the worker's): the
ONE-shared-baseline claim (grep evidence, 2 real consumers of `compare_suppression_baseline`),
FOLLOW-765 AC2's red-first catch (self-consistent unhardened pair, exit 0 on pre-merge main -> exit
1 on PR branch), FOLLOW-759 AC3's region-alignment fix (same fixture, exit unchanged/0 but count
2->0 as region now matches scan). Posted PM-validated comment with full evidence on PR #652; moved
FOLLOW-765+759 to READY_FOR_REVIEW in QUEUE.md. **Not merged — needs Piotr.**

**Continued past validation per Piotr's standing instruction.** Dispatched FOLLOW-761 (qa-engineer,
Sonnet) — Redis smoke workflow concurrency-group + fixture-key namespacing, the RETRO-238 finding
with a MEASURED 26s race. Deferred FOLLOW-762 (same workflow file, different AC set) to next turn to
avoid a two-agent same-file collision. Deferred FOLLOW-768 (sentry-gate residual) until PR #652
actually merges, since its AC explicitly couples to code that only exists on that unmerged branch.

**CI-check counter (FOLLOW-765+759):** 1/5. **Fix-iteration counter:** 0/3. **CI-check counter
(FOLLOW-761):** 0/5. **Fix-iteration counter:** 0/3.

**1 ticket IN_PROGRESS** (FOLLOW-761). **1 ticket READY_FOR_REVIEW** (FOLLOW-765+759, PR #652).

NEXT: Piotr reviews/merges PR #652. PM waits for qa-engineer's FOLLOW-761 PR, validates, then either
picks FOLLOW-762 or (if #652 has merged by then) FOLLOW-768.

---

# Status — 2026-08-03 (session 89 continued — PR #653 validated, dispatching FOLLOW-762)

## SESSION 89 continued — PR #653 (FOLLOW-761) validated READY_FOR_REVIEW

**Validated PR #653 in full (5a-5g).** CI: 68 pass / 2 fail, both `Rule I` pre-existing-red (192,
matched to baseline via job log). Non-success count for all real gates: 0. Fixed the PR title's
missing Conventional-Commits scope (`test:` -> `test(qa):`) via the REST API after `gh pr edit`
silently no-op'd once. Independently reproduced AC4 against a REAL Redis instance (docker
redis:7-alpine + hiett/serverless-redis-http + a small compatibility proxy, in a git worktree, real
unmodified production code, two genuinely concurrent processes) -- a stronger standard than the
worker's own custom mock (justified by their sandbox lacking docker). Caught and fixed my own
cd-scoping bug mid-verification (one process accidentally ran against main's pre-fix code) before
trusting the result. Posted evidence on PR #653; moved FOLLOW-761 to READY_FOR_REVIEW. **Not merged
-- needs Piotr.**

**Caught the SAME shared-tree branch-collision hazard a second time**, this time before any commit
(checked `git branch --show-current` first, per the now-standard procedure). Added a durable fix to
QUEUE.md: every future worker dispatch brief must end with an explicit "return to main before you
exit" instruction, rather than relying on the PM catching it every session.

**CI-check counter (FOLLOW-765+759, PR #652):** 1/5, still open, awaiting Piotr. **CI-check counter
(FOLLOW-761, PR #653):** 1/5, still open, awaiting Piotr.

**0 tickets IN_PROGRESS. 2 tickets READY_FOR_REVIEW** (PR #652, PR #653).

NEXT: dispatch FOLLOW-762 (devops-engineer) now that FOLLOW-761 is no longer concurrently touching
the same workflow file. Piotr reviews/merges PR #652 and #653 when able.

---

# Status — 2026-08-03 (session 89 continued — PR #654 validated, 4 PRs now open)

## SESSION 89 continued — PR #654 (FOLLOW-762) validated READY_FOR_REVIEW

**Validated PR #654 in full (5a-5g).** CI: 67 pass / 2 fail, both `Rule I` pre-existing-red (192,
matched to baseline). Non-success count for all real gates: 0. Resolved the coordinator's
housekeeping question: the branch's second commit (`bcf800f9`, a "worker completion note" in
QUEUE.md) is the WORKER's own, not a displaced PM commit -- legitimate per CLAUDE.md's "every agent
writes status changes to QUEUE.md", honestly scoped, left on the branch. **Found and confirmed a
REAL merge conflict** (via `git merge-tree`, not assumed) between PR #653 and PR #654 -- both edit
the same `REQUIRE_REDIS_SMOKE: >-` line in `redis-shadow-smoke.yml`. Posted the exact 2-line
resolution as a PR comment for whichever merges second. Independently reproduced the negative
control in a worktree (real exit 1, expected message) AND cross-checked the real CI job log for the
`PASS: negative control ...` line (Rule Q proof-of-execution). Moved FOLLOW-762 to READY_FOR_REVIEW.
**Not merged -- needs Piotr.**

**4 PRs now open, all independently PM-validated, none merged:** #652 (FOLLOW-765+759), #653
(FOLLOW-761), #654 (FOLLOW-762). #653/#654 conflict on one line (resolution posted); #652 is
unrelated (different subsystem).

**Corrected the coordinator's ticket-agent claim before dispatching:** FOLLOW-763's own stub names
`recommended_agent: backend-engineer`, not sdk-engineer.

**Checked file-collision risk before picking the next dispatch (learned from the #653/#654
conflict):** FOLLOW-763 touches `tests/integration/redis-shadow-round-trip.smoke.test.ts` -- the
SAME file 3 open PRs already touch or have touched (#653, #654) -- deferred. FOLLOW-769 touches
`scripts/check-sentry-{capture-has-init,init-singleton}.sh` -- the SAME two files PR #652
extensively rewrites, unmerged -- deferred, same reasoning as FOLLOW-768. FOLLOW-766 + FOLLOW-767
both touch `scripts/check-mirror-files.sh` (766 also `scripts/mirror-files.json`) but in
non-overlapping regions, and NEITHER file is touched by any of the 3 open PRs -- safe to dispatch,
combined to one agent to avoid a two-worker collision on the same file (same pattern as
FOLLOW-765+759).

**CI-check counters:** PR #652 1/5, PR #653 1/5, PR #654 1/5 -- all awaiting Piotr.

**0 tickets IN_PROGRESS before this dispatch. 3 tickets READY_FOR_REVIEW** (PR #652, #653, #654).

NEXT: dispatch FOLLOW-766+767 combined (devops-engineer). FOLLOW-763 and FOLLOW-769 stay deferred
until their respective file-conflicting PRs merge. Piotr reviews/merges the 3 open PRs (mind the
#653/#654 conflict) when able.

---

# Status — 2026-08-03 (session 89 WIND-DOWN — 4 PRs open, all PM-validated, none merged)

## SESSION 89 WIND-DOWN

**Validated PR #655 (FOLLOW-766+767) in full (5a-5g).** CI 67/2 (Rule I at 192 baseline). Verified
FOLLOW-767 against a REAL nested `.claude/worktrees/agent-x` checkout (this session's own
verification-worktree pattern), confirming main's script false-REDs 5 violations on that exact tree
and this PR's script is clean. Confirmed "git-tracked discovery" in the title is exactly FOLLOW-767
AC1's own preferred option (scoped to the basename-discovery sub-scan only), not scope creep.
Confirmed FOLLOW-766's note is a real enforcing consumer (gate fails on empty note), not reworded
prose. Checked `git merge-tree` against all 3 other open PRs -- zero conflicts. Moved FOLLOW-766+767
to READY_FOR_REVIEW. **Not merged -- needs Piotr.**

**4 PRs open, all independently PM-validated, none merged:** #652 (FOLLOW-765+759), #653
(FOLLOW-761), #654 (FOLLOW-762), #655 (FOLLOW-766+767). One real conflict, #653<->#654, exact
resolution posted on #654 and in QUEUE.md's wind-down note.

**Wound down rather than dispatching a 5th ticket** -- every remaining candidate (763/768/769) is
file-collision-deferred against one of the 4 open PRs. Wrote a full wind-down note at the top of
QUEUE.md: merge order, the one conflict + resolution, what each PR closes, what unblocks after they
land, and two open decisions for Piotr (RETRO-239's pre-specified residual-register test, and a
recurring dispatch-brief permission gap that denied 3 different workers' own lessons-file writes
this session).

**CI-check counters:** #652 1/5, #653 1/5, #654 1/5, #655 1/5 -- all awaiting Piotr.

**0 tickets IN_PROGRESS. 4 tickets READY_FOR_REVIEW.**

NEXT: Piotr merges the 4 PRs (mind the #653/#654 conflict). PM resumes next session: validate
anything that didn't merge cleanly, spawn retrospectives for merged tickets, then FOLLOW-763/768/769
once unblocked.

---

# Status — 2026-08-03 (session 92 continued — PR #656 bounced back, 1 fix-iteration)

## SESSION 92 continued — FOLLOW-770 validation found a real gap in the reference implementation

**Validated PR #656 (FOLLOW-770) at the shape level, per explicit instruction (Rule AP reference
implementation).** CI green (67/2, Rule I re-derived fresh at 192, not assumed stale). Independently
reproduced AC1/AC2 and AC5 on fixtures I built myself, both matching the PR's claims. Found a real,
reproducible defect in 3 of 8 register entries (A, B, F): pipefail's rightmost-non-zero semantics
let a genuine producer failure get masked by a downstream grep's ordinary no-match exit (1), landing
UNEVALUABLE cases in the "latent" bucket instead of failing loudly -- the exact Clause-2 violation
the coordinator predicted. Reproduced both isolated commands with real error output, pasted
transcripts and the requested fix shape on the PR. Bounced back to IN_PROGRESS rather than approved,
since this is the artifact every future gate copies.

**CI-check counter: 1/5. Fix-iteration counter: 1/3.**

**1 ticket IN_PROGRESS** (FOLLOW-770, awaiting fix-iteration).

NEXT: dispatch a fix-iteration to devops-engineer on the same branch, citing the PR comment's exact
reproduction and requested fix shape.

---

# Status — 2026-08-03 (session 92 continued — PR #656 fix-iteration validated, READY_FOR_REVIEW)

## SESSION 92 continued — FOLLOW-770 re-validated after fix-iteration 1

**Re-validated PR #656 after the worker's PIPESTATUS fix.** Re-ran my own original A/B/F
reproductions on fresh fixtures (not the worker's) -- both now correctly report UNEVALUABLE with the
true masked exit codes surfaced. Verified the PIPESTATUS-immediacy concern directly from the diff
(no intervening command between the proof's pipe and the read). Confirmed C1-E's "not vulnerable"
claim was genuinely instrumented and checked, matching my own independent read. CI green (66/2, Rule
I re-derived fresh at 192). 13/13 self-test, cross-checked in the real CI job log. Lessons commit
confirmed genuine, left as-is. Moved FOLLOW-770 to READY_FOR_REVIEW. **Not merged -- needs Piotr.**

**CI-check counter: 2/5. Fix-iteration counter: 1/3** (2 remaining, unused).

**0 tickets IN_PROGRESS. 1 ticket READY_FOR_REVIEW** (FOLLOW-770, PR #656).

NEXT: dispatch FOLLOW-768+769+771 combined (devops-engineer), explicitly citing PR #656's corrected
register pattern -- especially the PIPESTATUS lesson, since those two sentry-gate registers will
copy this exact shape.

---

# Status — 2026-08-03 (session 92 continued — PR #657 validated, FOLLOW-763 dispatched)

## SESSION 92 continued

**Validated PR #657 (FOLLOW-768+769+771) in full.** Verified the commit-subject citation gap was a
slip, not a scope miss -- all three ACs genuinely delivered, FOLLOW-769 (flagged as most likely to
be dropped) confirmed present in both gates via independent self-test runs (18/18, 22/22). Register
pattern confirmed byte-identical to PR #656's corrected PIPESTATUS runner (diffed, not assumed).
Reproduced the Rule AP verification fixture on my own input. Confirmed Rule AL compliance by tracing
the new entries' source variables to the FOLLOW-771-fixed registered-set loop. CI green (69/2, Rule
I at 192 fresh). Found exactly one conflict against still-open PR #656 (lessons.md append-collision,
docs-only, resolution posted). Moved to READY_FOR_REVIEW. **Not merged -- needs Piotr.**

**Dispatched FOLLOW-763** (backend-engineer, Sonnet) -- standalone, no collision with anything open
or queued.

**CI-check counters:** PR #656 2/5, PR #657 1/5 -- both awaiting Piotr.

**1 ticket IN_PROGRESS** (FOLLOW-763). **2 tickets READY_FOR_REVIEW** (PR #656, PR #657).

NEXT: dispatch FOLLOW-773+774 combined once FOLLOW-763 completes. Piotr merges #656/#657 when able
(mind the one lessons.md conflict, resolution posted on #657).

---

# Status — 2026-08-03 (session 93 — 3 PRs merged, 2 retros owed before FOLLOW-773+774)

## SESSION 93

**Re-synced state per coordinator correction.** #656, #657, #658 all merged; `main` at `15c8675c`,
local fast-forwarded. Zero open PRs (confirmed via `gh pr list`, not assumed).

**Validated PR #658 (FOLLOW-763) in full.** Pressed specifically on whether the double-cast was
removed vs. the type merely widened around it -- confirmed from the diff the cast is genuinely gone
and the field is now truly declared, matching the actual Python schema optionality. Independently
re-ran typecheck + the 3 named test files (22/22) + confirmed zero diff in the adapt route / SDK
core. CI green (70/2, Rule I re-derived fresh at 192). Moved to READY_FOR_REVIEW. **Not merged --
needs Piotr.**

**Recorded the merge-time history for #656/#657** (fix-iteration for 656; two rebases for 657,
including a stale-base error the coordinator caught and corrected) -- neither visible in any diff,
fed into both upcoming retro briefs. Judged FOLLOW-768's worker-surfaced Rule AP gap (a
proof-that-goes-live-on-legitimate-usage) as ONE sighting, not amendment-worthy yet -- to be
recorded as a new candidate pattern at count 1 in RETRO-243, not promoted.

**CI-check counters:** PR #658 1/5.

**0 tickets IN_PROGRESS. 1 ticket READY_FOR_REVIEW** (FOLLOW-763, PR #658).

NEXT: dispatch RETRO-242 (FOLLOW-770 / PR #656), then RETRO-243 (FOLLOW-768+769+771 / PR #657), both
before FOLLOW-773+774 per Piotr's explicit order.

---

# Status — 2026-08-03 (session 94 — Rule AN collision resolved, code-audit batch filed)

## SESSION 94

**Found and fixed a real local/origin divergence** before it could compound into a second collision:
local `main` had fast-forwarded RETRO-242's branch onto a stale base (predating PR #658/#659).
Confirmed zero file overlap, rebased cleanly, pushed. `main` now `0546e259`.

**Resolved a live Rule AN ticket-number collision** (FOLLOW-776-779) by reading the rule's own
clauses 3-4 directly rather than accepting the coordinator's summary: an allocating write is a real
register entry, not a commit-message mention. RETRO-242's actual stubs landed first (via this
session's own push); PR #659's ticket renumbered to FOLLOW-780, commit history left as-is.

**Filed FOLLOW-780 through FOLLOW-789** (10 stubs): the retroactive PR #659 filing, its required
shadow-metric measurement follow-up, the 5 code-audit findings (F-02 through F-06, all independently
re-verified via direct file reads before filing, not accepted from the audit summary), the 2
suppression-baseline.sh findings from the earlier code-review pass, and one NEW discovery -- a
genuinely pre-existing (RETRO-077-era) Rule AN violation (FOLLOW-309-312 duplicate headings) found
as a side effect of checking for new collisions.

**0 tickets IN_PROGRESS. 0 open PRs.**

NEXT: dispatch RETRO-243 (folding in code-review finding #1 + this session's own collision as
evidence for RETRO-242's already-named candidate pattern, not double-counted), then FOLLOW-773+774,
then start the code-audit batch (FOLLOW-782/F-02 first, per stated priority).

## Session 95 (2026-08-03)

**RETRO-243 pushed to origin** — discovered local `main` had NOT actually reached `origin/main`
despite being reported merged (local was 1 commit ahead, unpushed); pushed directly, clean
fast-forward, no conflict. This is the third time this session independent re-verification of a
"main is at X" claim caught a real discrepancy rather than a narration error — worth noting to Piotr
as a pattern, not just filing silently.

**CEO P2 freeze implemented**: 14 stubs (FOLLOW-775/776/777/778/779/781/783/784/785/786/787/788/
789/790) annotated FROZEN directly on their `promoted_to_queue` line with reason + date + pointer to
QUEUE.md session-95 head. Standing rule recorded: future retro/audit stubs default frozen unless P1.
Unfreeze requires a new dated CEO ruling only.

**Localhost-first acceptance-gate override adopted** for all dispatch briefs from this point:
"demonstrated on localhost," not "verified in prod." Record corrected on three previously mis-framed
pilot blockers (ESC-020, FEEDBACK_ENDPOINT_ENABLED 503 gate, FOLLOW-449 CH migration) — see QUEUE.md
session-95 head for the exact correction. ESC-045 items 2-3 elevated in relevance.

**FOLLOW-026 corrected before dispatch**: stale line citations fixed (`adapt.ts:87-100` →
`:507-525`), finding independently re-confirmed accurate and current. Migration conflict found and
flagged BEFORE any worker starts: its Level 2 AC needs a new `tenants.placeholder_overrides` column,
which does not exist in any migration; scoping the eventual dispatch to Levels 1+3 only
(migration-free), Level 2 deferred pending Piotr's answer on whether merges (not just deploys) are
paused.

**FOLLOW-773+774 dispatched** to devops-engineer (Sonnet), combined, migration-free confirmed,
localhost-gated acceptance criteria stated explicitly in the brief (one AC — the GitHub Actions
concurrency-group reproduction — is explicitly carved out as the sole exception, since it tests
GitHub's own runner behaviour and cannot be observed on localhost by definition).

**CI-check counter (FOLLOW-773+774): 0/5. Fix-iteration counter: 0/3.**

**1 ticket IN_PROGRESS** (FOLLOW-773+774). **0 open PRs** at dispatch time.

NEXT: Wait for devops-engineer to complete FOLLOW-773+774 (coordinator holds the watchers, no
self-armed poll), then run full 5a-5g validation, then dispatch FOLLOW-782, then FOLLOW-026 (Levels
1+3 scope only).

## Session 97 (2026-08-04)

**Read state fresh, did not re-derive from narration alone:** `main` clean at `9df1c604` before this
session's own commit, `gh pr list --state open` empty, no stray `claude --agent` processes, no
stranded `.claude/worktrees/agent-*`. 0 tickets IN_PROGRESS at session start. All of
FOLLOW-792/793/795/796/801/802/803/808 confirmed DONE and merged (session 96/earlier-97 work),
consistent with the session's briefing.

**Escalations checked, none newly blocking.** `ESC-046`'s stray `## OPEN` block is the preserved
original filing inside a `<details>` block, superseded by the `## RESOLVED` entry above it —
verified by reading both, not assumed from heading order. Five genuinely `## OPEN` escalations
remain (ESC-020, ESC-041, ESC-042 narrowed, ESC-044, ESC-045) — all long-standing, previously
surfaced to Piotr, each scoped to a specific future action outside this session's dispatch
decisions; none new.

**Bookkeeping gap found and fixed.** The session-95 CEO P2-freeze standing rule ("any NEW stub filed
from this point forward lands FROZEN by default unless P1") was not applied at filing time to
FOLLOW-800 (RETRO-244) and FOLLOW-804/805/806/807 (RETRO-245) — all P2/P3, all filed after the
freeze took effect, none carrying the FROZEN annotation the code-audit batch (e.g. FOLLOW-783)
correctly has. Retroactively annotated all 5 with the standard marker in `backlog/FOLLOW_UPS.md`,
explicitly labeled a bookkeeping correction, not a new ruling. **Also flagged for Piotr, not
blocking:** FOLLOW-793/802/803 (P2) shipped in PR #667 without an explicit freeze exemption recorded
— the PM-of-record's reasoning was that they closed remaining doors of an already-P1-exempt defect
(FOLLOW-792/795), which is defensible but was never stated as an exemption class at the time.
Content independently verified correct; this is a process question for Piotr's ruling, not a defect.

**Picked FOLLOW-782** (P1, code-audit F-02, backend-engineer) — the oldest non-frozen ready ticket,
named priority at session 94 but queue-jumped five times by P1 SDK fires. Delegation-table row:
"ingest worker, control-plane, decision-api, Postgres/RLS, auth, onboarding HTTP, billing, webhooks
→ backend-engineer." **Model: Opus** (escalated from the ticket's Sonnet default) — justification:
model-fit table lists "security-sensitive changes" under Opus, and this control-plane admin route
auto-deploys to prod on merge with no human gate; took the higher tier per the prod-touching
tie-break rule. Full brief covered: branch-first discipline, no `gh pr merge` (ESC-046), the exact
AC's, the Rule I 192-baseline-delta requirement (not pass/fail), and instructions to leave final
DONE/merge to the PM/human.

**Dispatched:** `nohup claude --agent backend-engineer --model opus -p ...` (PID 161640, confirmed
alive via `ps -p`, not from an empty-log false negative — log currently shows only startup
permission-config warnings, output buffers until the process exits per the known pattern).

**QUEUE.md updated atomically BEFORE dispatch:** FOLLOW-782 status IN_PROGRESS, assigned_to
backend-engineer, model Opus, started_at 2026-08-04, branch
`backend-engineer/FOLLOW-782-clickhouse-param-binding`. Committed (`86667e7c`) and pushed to
`origin/main` before dispatching the worker, per "no concurrent git ops while a subagent runs."

**CI-check counter (FOLLOW-782): 0/5. Fix-iteration counter: 0/3. 1 ticket IN_PROGRESS. 0 open PRs
at dispatch time.**

NEXT: Wait for backend-engineer (PID 161640) to complete FOLLOW-782, then run full 5a-5g validation
(security-relevant change — CI green via job-log delta against 192, runtime-wiring grep for the new
`param_<name>` binding producer/consumer, AC's verified one by one, no shortcuts), then FOLLOW-026
(Levels 1+3 scope only, migration-free, per session 95's correction).

---

## Session 111 — 2026-08-10 — FOLLOW-913 dispatched (the last unimplemented CEO ruling)

**Opening state verified, not inherited.** `main` = `3339c50b`, working tree clean,
`gh pr list --state open` empty, `git worktree list` shows only the primary tree, no live
`claude --agent` process. Session 110 ended cleanly, so no recovered-work re-verification was owed.

**Escalations checked by reading each entry, not by heading order.** Three are genuinely `## OPEN`:
ESC-020 (Wave-0 Step 6, Rafał — non-blocking for dispatch per the FOLLOW-820 gate: the stage is
localhost-first testing, not a stalled pilot), ESC-042 item 1 (traffic axis only —
`MODAL_CHAT_NLP_URL` unset in the prod ingest Worker, Piotr), and ESC-056 (`ingest_worker` has no
`SELECT` on `default.events`, so the `es` consent-drop count is unmeasurable and an access-denied
query returns an empty body that reads as a clean bill of health — its own filing says non-blocking
for dispatch). ESC-055 is RESOLVED as a ruling but its operator step — Rafał publishing one
anonymous listing page — is outstanding and still blocks FOLLOW-914/907. None new; none blocking
this dispatch.

**Operator step outstanding and re-probed, not assumed.**
`curl -s https://ingest.estalara.com/health` still returns the pre-#716 shape with no `version_id`,
confirming the ingest Worker has not been deployed since session 110. One
`wrangler deploy --env production` ships four merged-but-dark changes (FOLLOW-931, FOLLOW-937,
FOLLOW-938, `schema_rejected`); `version_id` present in that curl is the single observation that
closes all four. Surfaced to Piotr, not attempted.

**Picked FOLLOW-913** (P1, ESC-054 CEO ruling, `depends_on: []`, `promoted_to_queue: true`) on
priority rule (c), critical path: it is the only CEO ruling in the backlog not yet in the product,
ruled 2026-08-08 and still unshipped, and it was already #1 on session 110's ranked list. Its
sequencing precondition is discharged — FOLLOW-932 (#712) made the bundle gate print bytes and
signed headroom, the instrument this ticket's AC(5) reads.

**Delegation-table row:** "client SDK, Shadow DOM, tiers, browser code → sdk-engineer." The entire
change lives in `packages/sdk/src/core/adapt-floor.ts`, `packages/sdk/src/index.ts` and the SDK's
own test suite, plus a doc sweep.

**Model: Sonnet** (the ticket's default, taken deliberately rather than by omission). Justification:
the product decision is already ruled and the target shape is specified down to the constant; what
remains is a bounded SDK edit, three tests and an adjudicated doc sweep. It is reversible and
PR-gated, so the model-fit tie-break rule takes the lower tier. Escalate to Opus only if separating
the two axes turns out to move more than the one `if (aboveFloor)` block.

**Verified in code before writing the brief rather than trusting the stub:** `index.ts:864-868`
computes ONE disjunction and `:869-895` puts BOTH `applyDirectives()` and the fire-and-forget
`applyDescriptionAdaptation()` inside it — so this is a second gate, not a constant edit, and the
directive axis must be proven unmoved. A Rule AI three-vocabulary sweep for the signal-count claim
returns 5 docs + 4 source/test files; two of the docs are historical and must be adjudicated, not
blanket-edited, and the matched `apps/control-plane/public/sdk.js` is gitignored and
generated-on-build since FOLLOW-808, so it must not be touched.

**Trap briefed by name:** a new exported constant whose only importer is a test is a Rule I / Rule H
violation — that exact shape was caught three times in session 110 (`CONSENT_TEXT_TIMEOUT_MS`,
`toCanonicalOrigin`, `OriginDecision`+`OriginPolicyInput`). Both rules count NON-TEST importers
only.

**QUEUE.md updated atomically BEFORE dispatch** — FOLLOW-913 IN_PROGRESS, assigned_to sdk-engineer,
model Sonnet, started_at 2026-08-10, branch `sdk-engineer/FOLLOW-913-description-axis-floor` —
committed and pushed to `origin/main` before the worker started, per "no concurrent git ops while a
subagent runs."

**Retro debt recorded, and it is the largest standing item in the loop:** RETRO-266 is owed for FOUR
merged PRs — #713 (FOLLOW-936), #714 (FOLLOW-941), #715 (FOLLOW-937), #716 (FOLLOW-938). RETRO-265
covered only #710/#711/#712. Queued as the next action after FOLLOW-913.

**Counters — FOLLOW-913: 0/5 CI checks, 0/3 fix iterations. 1 ticket IN_PROGRESS. 0 open PRs at
dispatch time. Open-escalation ages: ESC-020 ~4 weeks (non-blocking by ruling), ESC-042 item 1 ~2
days on the traffic axis, ESC-056 ~1 day.**

## Session 122 — 2026-08-19 — picked FOLLOW-1037, spawn held for human approval

Read state fresh (not trusted from stale gitStatus snapshot — re-verified `git status`/branch
live). `main` at `1cf69e3e`, 0 open PRs, ESC-062/ESC-063 confirmed RESOLVED in
`backlog/ESCALATIONS.md`. Other OPEN escalations (ESC-020, ESC-042 item 1, ESC-056, ESC-057,
ESC-058) all previously ruled non-blocking-for-dispatch; ESC-059/060 DECIDED, not open. No
escalation blocks picking up new work.

Picked **FOLLOW-1037** (P1, sdk-engineer, `depends_on: []`, unblocks FOLLOW-1039) — priority rule
(a), the only READY ticket with a downstream dependent. Delegation-table row: "client SDK, Shadow
DOM, tiers, browser code → sdk-engineer." Model: Sonnet (bounded, well-specified, reversible/PR-
gated). Full brief in `backlog/HANDOFFS.md`.

**Per this session's explicit constraint, the worker was NOT spawned** — QUEUE.md flipped
IN_PROGRESS as bookkeeping only, brief handed off in HANDOFFS.md for human-approved dispatch.

Bookkeeping (QUEUE.md + HANDOFFS.md) committed on branch
`pm-orchestrator/session-122-follow-1037-dispatch-brief`, PR #788 opened — not committed to `main`
directly, per the ESC-059-derived convention observed in `git log` (docs(backlog) commits carry a
`(#NNN)` merge suffix). CI verification (`scripts/gh-pr-checks-verified.sh 788`) dispatched in
background; still polling as of this entry (106 checks known, 8 pending, stable for several
snapshots) — not yet resolved to a RESULT line.

**Retro debt outstanding, not yet paid:** #780 (FOLLOW-1028 retro-filing PR), #781 (FOLLOW-1033),
#782/#784/#785/#786/#787 (FOLLOW-1034 series, may batch into one retro entry), #783 (Track LATENCY
opening). Does not block dispatch; owed at next opportunity.

**Counters — FOLLOW-1037: 0/5 CI checks, 0/3 fix iterations (worker not yet spawned). 1 ticket
IN_PROGRESS (FOLLOW-1037, bookkeeping-only, spawn pending). 1 open PR (#788, PM bookkeeping, CI
verification in progress). Open-escalation ages unchanged from prior session for ESC-020/042/056/
057/058.**
