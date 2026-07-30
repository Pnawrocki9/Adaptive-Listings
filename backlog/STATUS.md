# Status — 2026-07-30 (session 80 — PR #642 independently re-validated; FOLLOW-735 stub filed +

dispatched to architect)

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
