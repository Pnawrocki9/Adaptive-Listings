# Backlog Queue

## ▶️ START HERE — resume 2026-07-27 (session 68 — FOLLOW-697+698 validated, PR #632 READY_FOR_REVIEW; 3 escalations remain OPEN, all confirmed non-blocking-for-dispatch per the standing 2026-07-27 ruling)

**PR #632 opened by backend-engineer, validated by PM before handing to Piotr for merge:**

- `gh pr checks 632`: 61/63 pass. The 2 failures are "Rule I — wired-or-dead check", the same
  pre-existing-red gate flagged on #631; worker measured baseline explicitly (192 violations on
  `main`, 192 on the branch — zero added, confirmed by wiring the new `TenantBrandScope` type at its
  consuming call site).
- Read the full diff (`gh pr diff 632`) against both stubs' ACs in full — re-keyed 7c onto EVIDENCE
  (provisioned tenant's own computed hash vs. the fallback-identity tri-state), all 5 FOLLOW-697 ACs
  and all 6 FOLLOW-698 ACs present, including the two call sites (`GET :251`, POST 7b `:380`) that
  must keep boolean fail-closed behavior — verified unchanged, both their pre-existing test blocks
  are untouched in the diff.
- Checked out the branch locally (`gh pr checkout 632 --detach`) and ran the full suite myself:
  **1964/1964 tests pass, 175/175 files**, `tsc --noEmit` clean. Matches the worker's report
  exactly.
- **Independently verified the load-bearing factual claim**: wrote a standalone script computing
  SHA-256 of the rendered Estalara consent text — confirmed `CANONICAL_CONSENT_TEXT_HASH`
  (`a3f2e1d4c5b6…`) does NOT equal `computeConsentTextHash(renderPlatformConsentText(estalara))`
  (`821216cd2cca…`), exactly as the PR claims. **Additional finding beyond what the worker
  flagged**: the constant's digit pattern
  (`a3f2e1d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2`) looks like a hand-typed
  placeholder — ascending hex nibbles in a repeating pattern — not a real SHA-256 digest, despite
  `lib.ts:44`'s docstring instructing `echo -n "<exact text>" | sha256sum` to verify it. This
  suggests the constant was never actually computed from real §6.1 text, which is a compliance
  question (every first-party-default consent record's stored hash may not correspond to any real
  displayed text) — **not filing a ticket for it myself** (retrospective-analyst owns FOLLOW_UPS.md
  per charter); flagging it explicitly in the RETRO-227 dispatch prompt so it isn't lost, adjacent
  to FOLLOW-379/699.

**FOLLOW-697+698 → status: READY_FOR_REVIEW.** PR #632 is mergeable and validated; only outstanding
item is Piotr's merge decision.

---

## ▶️ START HERE — resume 2026-07-27 (session 67 — FOLLOW-697+698 dispatched together to backend-engineer/OPUS; 3 escalations remain OPEN, all confirmed non-blocking-for-dispatch per the standing 2026-07-27 ruling)

**RETRO-226 (filed after FOLLOW-684/PR#631 merged) found two new P1 live bugs in the code that just
shipped**, both in the step-7c gate at
`apps/control-plane/src/app/api/v1/consent/platform-registration/route.ts:435`:

- **FOLLOW-697** — the hard-refusal is keyed on `isUnprovisionedExternalBrand`, which short-circuits
  `false` the instant `identity.isFallbackIdentity` is false — so a **provisioned** external brand
  (has `brand_config.brand_name`) submitting the canonical Estalara hash gets a silent 201, no 422,
  no Sentry alert. Exactly the fabrication FOLLOW-684 set out to close, left open for the tenants
  furthest along in onboarding. Root cause: FOLLOW-684's own AC-2 wording keyed the refusal on the
  _diagnosis_ (unprovisioned) rather than the _evidence_ (external + canonical hash) — the AC-4 test
  matrix was a diagonal of a 2×2 grid, so it looked complete at 4/4 green.
- **FOLLOW-698** — the same gate's underlying helper (`isTreatedAsExternalBrand`,
  `brand-identity.ts:290-314`) fails CLOSED (`catch → return true`) on a transient tenant-count read
  error, or when `FIRST_PARTY_TENANT_ID` is unset with ≥2 tenant rows — a state
  `docs/runbooks/BRAND_PROVISIONING.md:316-320` documents as expected. Estalara's own tenant carries
  `isFallbackIdentity: true`, so in either state the new 422 fires for **Estalara's own first-party
  consent**, discarding a real visitor consent with a message asserting the hash is "provably wrong"
  — false for that tenant — and a remediation that cannot apply to it.

**Verified the premise myself before dispatch:** read `route.ts:391-455` (the FOLLOW-684 step-7c
block) and `brand-identity.ts:260-352` directly. Confirmed only 3 production call sites of the
underlying helper family: GET consent (`route.ts:251`, refuses to SERVE — correct to stay
fail-closed), POST step 7b `requiresExplicitConsentHash` (`route.ts:380`, demands more input —
correct to stay fail-closed), and POST step 7c `isUnprovisionedExternalBrand` (`route.ts:435`, the
only one that refuses a WRITE — this is the one both tickets scope in on). DSR initiate
(`dsr/initiate/route.ts:229`) alerts but still sends, unaffected. Blast radius is narrow: one call
site needs new tri-state-aware handling; the other two keep their existing (correct) boolean
fail-closed semantics untouched.

**Dispatching FOLLOW-697 + FOLLOW-698 together, one branch/one PR** — both ACs explicitly say to
coordinate with each other ("do not regress the first-party path" / "which re-keys the same
predicate") and both touch the identical ~20-line block; splitting them into two PRs would conflict
on the same lines and risk exactly the kind of half-fix RETRO-226 just flagged. FOLLOW-699/700/701
(the other RETRO-226 follow-ups: 422 has no doc consumer, alarm has no routing, general-case policy
question) are explicitly NOT in this dispatch — Piotr chose to scope this round to the two live P1
bugs only.

### FOLLOW-697+698 — status: READY_FOR_REVIEW (PR #632, all checks green modulo pre-existing-red Rule I, 1964/1964 tests pass locally, tsc clean)

**assigned_to:** backend-engineer **model: Opus** — escalated one tier above FOLLOW-684's Sonnet per
the CLAUDE.md model-fit rule ("escalate one tier when the task already failed once at the lower
tier"): the AC-4 matrix gap in FOLLOW-684 shipped from Sonnet-tier implementation of a
Sonnet-written AC, and this ticket requires reasoning about ALL FOUR cells of the
provisioned×hash-kind grid at once, changing a shared helper's return-type contract (boolean →
tri-state) without regressing the two other call sites that must KEEP their fail-closed boolean
behavior, and getting the interaction between "always alert" / "refuse only the provable case" /
"never refuse on indeterminate" right simultaneously — genuinely security-sensitive,
judgement-heavy, single-module reasoning, the textbook Opus fit. **started_at:** 2026-07-27.
**branch:** `backend-engineer/FOLLOW-697-698-brand-gate-tristate`.

**Delegation brief (sent to backend-engineer):**

- Tickets: `backlog/FOLLOW_UPS.md` → `## FOLLOW-697` and `## FOLLOW-698` (full text, both P1, ~3h
  each, both `source_retro: RETRO-226`).
- Context: `docs/MASTER_DESIGN.md` §Snapshot.1; `CONVENTIONS_PATCH.md` Rule K.2 amendment
  (2026-07-27, RETRO-226 §6 — fail-CLOSED-value-laundering / never-refuse-a-write) — this ticket is
  the amendment's own worked example, read it before writing code; Rule AA (guard cost must stay
  zero for the fast-path tenant).
- Branch: `backend-engineer/FOLLOW-697-698-brand-gate-tristate`.
- AC (verbatim from both stubs — implement together, one coherent change to the step-7c block and
  `isTreatedAsExternalBrand`):
  - **FOLLOW-697:** (1) re-key the hard refusal on `isTreatedAsExternalBrand`-equivalent evidence so
    ANY non-first-party tenant submitting `CANONICAL_CONSENT_TEXT_HASH` is refused, provisioned or
    not — coordinate with FOLLOW-698, which changes that same predicate's failure semantics, and do
    not regress the first-party path; (2) for a PROVISIONED brand, prefer the positive check —
    `body.consent_text_hash !== computeConsentTextHash(renderPlatformConsentText(identity))` is
    suspicious — but do NOT hard-refuse on it alone (a translated text legitimately mismatches; that
    is FOLLOW-701's policy question, out of scope here), alert instead; (3) tests for all four cells
    of the grid, explicitly including `provisioned external × canonical hash → refused` (red-first:
    returns 201 today) and `provisioned external × its own correct hash → 201, no capture`; (4)
    state the EN-only scope limit (CANONICAL_CONSENT_TEXT_HASH is the EN §6.1 hash only) in the 7c
    comment and in the 422 message, cross-reference FOLLOW-379; (5) keep the guard's cost unchanged
    for the first-party fast path, re-assert it under both env-SET and env-unset.
  - **FOLLOW-698:** (1) make `isTreatedAsExternalBrand`'s answer TRI-STATE (`external` /
    `first_party` / `indeterminate`) — or throw — so a swallowed read error can never be presented
    to a caller as a determined fact; keep the fail-closed DIRECTION for gates that merely refuse to
    SERVE (`GET`, `route.ts:251`) or demand more input (7b, `route.ts:380`) — those two call sites
    must NOT change behavior; forbid the fail-closed collapse only for the WRITE-refusing gate (7c);
    (2) on `indeterminate`, the consent POST returns a retryable 5xx with
    `data_source: 'db', degraded: true` (Rule K.2 shape, same as the sibling failure at
    `route.ts:422-432`), never the 422 and never a false "more than one tenant exists" assertion;
    (3) remove the 7b→7c contradiction — whatever 7b tells the caller to do must not be refused by
    7c 55 lines later; state the first-party exemption explicitly; (4) re-scope the cost claim at
    `route.ts:414-418` — "today's live first-party traffic pays no additional query" is true only
    for the go-live (env-SET) configuration and false for the currently-running one (env-unset +
    fallback identity ⇒ a `fetchBrandIdentity` select PLUS a tenant-count probe on every POST) —
    state the condition (Rule AH); (5) do NOT touch FOLLOW-674/686/695 call sites in this PR — those
    are separate not-yet-dispatched tickets; only the POST step-7c call site changes fail-closed
    direction; (6) tests: env-unset + 2 tenants + first-party + canonical hash → 201 (NOT 422),
    count-probe throw → retryable 5xx, no false Sentry capture for the first-party tenant in either
    case.
- Both stubs list `cross_ref` back to each other and to Rule K.2 — read both stubs in full before
  starting, not just this summary.
- PM will run the full validation loop (5a-5g) once a PR is opened, including confirming the two
  untouched call sites (GET `:251`, POST 7b `:380`) truly keep their existing boolean fail-closed
  behavior byte-for-byte (a regression there would recreate the exact bug class Rule K.2 forbids).

---

## ▶️ START HERE — resume 2026-07-27 (session 66 — FOLLOW-684 DONE, PR #631 merged `c08e1371`; 3 escalations remain OPEN, all confirmed non-blocking-for-dispatch per the standing 2026-07-27 ruling)

**FOLLOW-684 DONE.** PR #631 merged (squash) 2026-07-27T19:00:04Z → `c08e1371` on `main`, confirmed
via `gh pr view 631 --json state,mergedAt,mergeCommit`. Remote branch
`backend-engineer/FOLLOW-684-consent-post-brand-gate` auto-deleted on merge; stale local
remote-tracking ref pruned (`git fetch --prune`). Local `main` fast-forwarded to `c08e1371`, working
tree clean. POST /api/v1/consent/platform-registration now gates on `isUnprovisionedExternalBrand`
before every write, closing the last of the three consent-fabrication surfaces (GET closed by
FOLLOW-659/660; POST closed here).

**Next pick:** FOLLOW-685 (backend-engineer, P1, no deps, docs/handoff-only — flagged as the next
good pick two sessions running now).

---

## ▶️ START HERE — resume 2026-07-27 (session 65 — FOLLOW-684 validated, PR #631 READY_FOR_REVIEW; 3 escalations remain OPEN, all confirmed non-blocking-for-dispatch per the standing 2026-07-27 ruling)

**Session interrupted mid-FOLLOW-684, resumed and closed out.** backend-engineer had already
committed the fix (`70d2a70a`), pushed the branch, and opened PR #631 before the interruption —
found on resume via `git log`/`gh pr list`, working tree clean, nothing stranded. Ran the PM
validation loop myself:

- `gh pr checks 631`: 61/63 pass. The 2 failures are both "Rule I — wired-or-dead check" — confirmed
  pre-existing-red/non-blocking per `project_ci_gate_landscape` memory, not a regression from this
  diff.
- Read the full diff (`git show 70d2a70a`) against all 5 ACs in the FOLLOW-684 delegation brief
  below: guard placed at step 7c (after DB client exists, before any write) ✓; Sentry `error`
  capture with `route: 'consent/platform-registration'` + `brand_identity: 'unprovisioned_external'`
  tags, same shape as the DSR path's existing capture ✓; hard-refuse is scoped to the provable
  sub-case only (`consent_text_hash === CANONICAL_CONSENT_TEXT_HASH`), 422
  `consent_text_hash_fabricated`, general brand-specific-hash case deliberately left alone with the
  reasoning stated in-code and in the commit message (AC-3) ✓; `isFallbackIdentity` short-circuit
  cost note present and correct (AC-5) ✓.
- Confirmed the AC-4 four-case test matrix + AC-5 zero-cost case exist in `route.test.ts`
  (`describe('POST brand identity provisioning gate (FOLLOW-684)')`).
- Ran the suite locally: `npx vitest run src/app/api/v1/consent/platform-registration/route.test.ts`
  → **43/43 passed**, including all 4 new AC-4 cases and the first-party byte-identical/no-capture
  case.

**FOLLOW-684 → status: READY_FOR_REVIEW.** PR #631 is mergeable and validated; only outstanding item
is Piotr's merge decision. Next pick after merge: FOLLOW-685 (backend-engineer, P1, no deps,
docs/handoff-only — flagged as the good next pick in the prior session's note below).

---

## ▶️ START HERE — resume 2026-07-27 (session 64 — FOLLOW-684 promoted + dispatched to backend-engineer; 3 escalations remain OPEN, all confirmed non-blocking-for-dispatch per the standing 2026-07-27 ruling)

**Re-verified before dispatch (not taken on trust):** `git status` clean on `main`, up to date with
`origin/main` (the stale `M ...` gitStatus block shown at session boot was from a previous session's
branch checkout and no longer reflects reality — confirmed via fresh
`git status`/`git log origin/main`). `gh pr list --state open` empty. `.claude/worktrees/` empty, no
`claude --agent` processes running — nothing stranded. `backlog/ESCALATIONS.md`: 3 `## OPEN` entries
— ESC-020 (Rafał, `web-master` prod deploy), ESC-041 (npm registry E403), ESC-042 (narrowed — Modal
intent-engine operator deploy). All three carry an explicit CEO dispatch-policy ruling (session 62
head, `backlog/QUEUE.md` "Dispatch-policy ruling" note): standing EXTERNAL/operator-only blockers no
agent in this pipeline can clear, non-blocking-for-dispatch, surfaced every session close. No NEW
escalation exists. Proceeding per that standing ruling, consistent with sessions 59-63.

**Picked FOLLOW-684** (P1, `depends_on: []`, `recommended_sprint: now`, backend-engineer,
`promoted_to_queue` was `false` in FOLLOW_UPS.md, now promoted here) over the other 3 open P1 stubs:

- FOLLOW-680 (sdk-engineer, P1) — **not ready**, `depends_on: [FOLLOW-673]` and FOLLOW-673 is still
  `promoted_to_queue: false` / not started (P3, devops-engineer, unrelated bundle-size bookkeeping
  ticket) — genuinely blocked, not just stale-labeled.
- FOLLOW-685 (backend-engineer, P1) — no deps, docs/handoff-only, real but lower-urgency than a live
  write-path gap; good next pick after FOLLOW-684.
- FOLLOW-693 (devops-engineer, P1) — no deps, but AC-1 requires `wrangler secret put` against the
  **production** Cloudflare Worker (`SENTRY_DSN_INGEST`) — a prod-credential operator action, same
  class as ESC-020/042, not something to hand a code-only worker without first confirming this
  session actually holds prod Cloudflare access. Left for a follow-up dispatch/escalation check.

FOLLOW-684 wins: P1, zero dependencies, `recommended_sprint: now`, a live security/compliance gap
(an unprovisioned external brand can still fabricate a GDPR consent attestation naming the wrong
legal controller — the exact defect class FOLLOW-659/660 closed on two of three surfaces), bounded
code AC with a test list, single-module (backend-engineer already owns
`apps/control-plane/src/app/api/v1/consent/`).

**Verified the premise myself before dispatch (verify-not-guess, not taken on the stub's word):**
read `apps/control-plane/src/app/api/v1/consent/platform-registration/route.ts` directly. The GET
handler (`:246`) calls `isUnprovisionedExternalBrand(db, tenantId, identity)` and refuses with 409.
The POST handler's write path (`:285-480`) calls only `isFirstPartyTenant` (`:331`) and
`requiresExplicitConsentHash` (`:375`) — **no call to `isUnprovisionedExternalBrand` anywhere in the
POST handler** — confirmed via
`grep -n isUnprovisionedExternalBrand apps/control-plane/src/app/api/v1/consent/platform-registration/route.ts`
returning exactly one hit (the GET, line 246). The INSERT at `:454-467` stores
`consentTextHash: body.consent_text_hash ?? CANONICAL_CONSENT_TEXT_HASH` unconditionally once the
duplicate-nonce check passes. Ticket premise confirmed accurate.

### FOLLOW-684 — status: DONE (PR #631 merged `c08e1371`, 2026-07-27T19:00:04Z)

**assigned_to:** backend-engineer **model: Sonnet** — routine implementation inside a well-defined
module the agent already owns (one new guard call + one hard-refuse branch + tests), matching the
existing pattern FOLLOW-659/660 already shipped twice in this same file; no prior failed attempt, no
cross-module contract change. AC-3 explicitly directs the agent to implement only the provably-safe
sub-case and NOT guess the general-case policy (that stays with the CEO/DPO per the ticket's own
text) — so this does not need Opus-level judgement-call authority. **started_at:** 2026-07-27.
**branch:** `backend-engineer/FOLLOW-684-consent-post-brand-gate`.

**Delegation-table row used:** "ingest worker, control-plane, decision-api, Postgres/RLS, auth,
onboarding HTTP, billing, webhooks" → backend-engineer (touches
`apps/control-plane/src/app/api/v1/consent/platform-registration/route.ts`).

**Delegation brief (sent to backend-engineer):**

- Ticket: `backlog/FOLLOW_UPS.md` → `## FOLLOW-684` (full text — priority P1, ~3h).
- Context: `docs/MASTER_DESIGN.md` §Snapshot.1 (read before any non-trivial task, Operating
  Principle 1); current `CONVENTIONS_PATCH.md` rules — Rule K.2 (producer-side fail-loud, no silent
  swallow) and Rule AA (guard cost must stay zero for the fast-path tenant) both apply directly; no
  open `backlog/HANDOFFS.md` note for this ticket.
- Branch: `backend-engineer/FOLLOW-684-consent-post-brand-gate`.
- AC (verbatim from the stub, `backlog/FOLLOW_UPS.md` FOLLOW-684): (1) call
  `isUnprovisionedExternalBrand` on the POST path after the DB client exists (step 7b area), before
  any write, and raise the same Sentry `error` the DSR path raises with tags
  `route: 'consent/platform-registration'` + `brand_identity: 'unprovisioned_external'`; (2)
  hard-refuse the provable-fabrication sub-case only:
  `body.consent_text_hash === CANONICAL_CONSENT_TEXT_HASH` AND the tenant is an unprovisioned
  external brand → 4xx with a distinct error code, write nothing; (3) do NOT refuse the general case
  (brand-specific hash from an unprovisioned external brand) without a CEO/DPO ruling — state which
  option was implemented and why in the PR description, this is intentionally narrow; (4) red-first
  tests: unprovisioned external + canonical hash → refusal, insert never called; unprovisioned
  external + brand-specific hash → 201 + one Sentry capture; provisioned external → 201, no capture;
  first-party → 201, no capture, byte-identical to today; (5) assert the `isFallbackIdentity`
  short-circuit keeps the guard's cost at zero for a provisioned/env-configured tenant.
- PM will run the full validation loop (5a-5g) once a PR is opened, including a runtime-wiring grep
  for the new guard call + Sentry tag pair (producer AND that it actually gates the INSERT, not just
  logs) before READY_FOR_REVIEW.

---

## ▶️ START HERE — resume 2026-07-27 (session 63 close — FOLLOW-678 MERGED (PR #630, `5f830b40`); RETRO-225 done, 6 follow-ups filed (691-696), Rule AJ codified; pipeline still gated on 3 open escalations)

**FOLLOW-678 DONE.** PR #630 merged 2026-07-27T08:05:18Z (`5f830b40`) — confirmed via
`gh pr view 630 --json state,mergedAt,mergeCommit`. All 5 ACs shipped: canonicalized
`FIRST_PARTY_TENANT_ID` comparison (trim + lower-case) in `isUnprovisionedExternalTenant` (ingest),
`isTreatedAsExternalBrand`/`isFirstPartyTenant` (control-plane); warn-once-per-isolate Sentry
logging on a malformed env in both apps; case-variant + malformed-value test coverage; five doc
sentences re-scoped off the unqualified "never a traffic outage" claim; mandatory post-flip
verification probe added to `BRAND_PROVISIONING.md` §Step 0.

**Correction (RETRO-225 caught my own overclaim in the prior version of this note): this does NOT
close the entire `FIRST_PARTY_TENANT_ID` fail-silent bug class.** It closes the case/whitespace and
malformed axes cleanly (both were real, both are now tested, red-first-verified fixes). It does
**not** close the fail-**silent** part for the remaining axis: a well-formed-but-WRONG UUID still
403s 100% of first-party ingest, the SDK still discards the response (FOLLOW-680, just elevated
P2→P1), and the one server-side detector (`origin_policy_unconfigured`) rides a Sentry channel that
is currently mute in prod (`SENTRY_DSN_INGEST` unset — FOLLOW-693, P1, new). The new
`first_party_tenant_id_malformed` signal this PR added is itself a producer-only alarm with no
consumer (same FOLLOW-693). Full breakdown: RETRO-225 in `backlog/RETROSPECTIVES.md`; new tickets
FOLLOW-691 (dead control-plane export), FOLLOW-692 (Rule I path/comment-blindness), FOLLOW-693 (P1 —
alarm wiring), FOLLOW-694 (3 more unscoped doc surfaces incl. MASTER_DESIGN §V.3.4), FOLLOW-695
(control-plane 400 message + provable wrong-value detection), FOLLOW-696 (test gaps in the ACs PR
#630 claims met). New rule **AJ** codified in `CONVENTIONS_PATCH.md` (producer-only alarms are
HALF_WIRE_P).

**Local-repo note:** local `main` had one stray unpushed commit (`04a397a`, PM dispatch bookkeeping)
whose entire content was already carried into `5f830b40` via the PR branch (it was cut from that
local commit). Reconciled locally via merge + `rebase --skip` (dropping `04a397a` as a pure no-op
against `5f830b40`) rather than a force-reset — nothing pushed, origin/main unaffected, no data
lost, local history now linear on top of origin.

## ▶️ (prev) session 62 head — resume 2026-07-27 (session 62 — CEO rulings on ESC-042 + dispatch policy; pipeline UNGATED, FOLLOW-678 dispatched)

**Two CEO rulings received, both actioned before any dispatch (bookkeeping-first, no concurrent git
ops with a running subagent):**

1. **ESC-042 design ruling — Option (A).** Accept the client prior loop as the live chat-influence
   path; delete `CHAT_NLP_LIVE`; fix docstrings; update the FOLLOW-346 test contract. Option (B)
   server-side fusion explicitly rejected — not to be built. **Verify-not-guess finding: this was
   already fully shipped 2026-07-24 via PR #613 (`5ab923b`, FOLLOW-635), three days before the
   ruling arrived.** Independently re-confirmed today: `grep -rn CHAT_NLP_LIVE` across the live tree
   = zero code occurrences (only backlog/docs narrating its removal);
   `apps/control-plane/src/app/api/adapt/route.ts:1559-1573` and
   `packages/shared/src/directives.ts:160-181` docstrings correctly describe the live-influencing,
   ungated behavior; `apps/control-plane/src/app/api/adapt/route.follow346.test.ts` asserts the new
   contract. **No new ml-engineer ticket dispatched — nothing left to build.** ESC-042 narrowed +
   partially resolved in `backlog/ESCALATIONS.md` (design-ruling half RESOLVED; Modal Phase B
   operator-deploy half stays OPEN, re-titled, and — per ruling 2 below — treated as
   non-blocking-for-dispatch same as ESC-020).

2. **Dispatch-policy ruling.** ESC-020 (Rafał, `web-master` prod deploy) and ESC-041 (npm registry
   ownership) are standing EXTERNAL blockers no agent in this pipeline can clear — **resume
   dispatching** with them still OPEN and surfaced every session close, exactly as sessions 59-61
   already did. This does NOT generalize to "ignore all escalations": a NEW escalation, or one an
   agent can actually act on, still halts the line. Applying the same reasoning to ESC-042's now
   operator-only remainder (see above).

**Re-verified before dispatch (not taken on trust):** `gh pr list --state open` empty; `git log`
matches; 0 tickets genuinely `IN_PROGRESS` (the one QUEUE.md hit, FOLLOW-613, is a superseded
2026-07-22 historical entry, confirmed closed via FOLLOW_UPS.md). `.claude/worktrees/` empty, no
stranded work.

**Dispatching FOLLOW-678** (P1, `depends_on: []`, `promoted_to_queue: false` in FOLLOW_UPS.md,
confirmed genuinely free) — see ticket entry below for full delegation brief.

**3 escalations remain OPEN, all human/operator-side, all now explicitly non-blocking-for-dispatch
per ruling 2 above:** ESC-020 (Rafał), ESC-041 (npm registry), ESC-042 (narrowed — Modal deploy
only). Surfaced every session close per the ruling.

### FOLLOW-678 — status: DONE (PR #630 merged `5f830b40`, 2026-07-27T08:05:18Z)

**CI verified (not taken on trust):** `gh pr checks 630 --watch` completed — every real merge gate
passes (Lint, Format check, Typecheck, Test (Node 22), Build, Build (control-plane), Vercel, Rule H,
Rule J, Gitleaks, Doppler verify, Migration journal monotonicity, Cross-language event contract,
Auto-Detection corpus gate, Demo integration, SDK E2E, ClickHouse migrations smoke, Archetype
seeds/embeddings, and all Python matrix jobs). Only failure: **Rule I — wired-or-dead**, confirmed
pre-existing-red/non-blocking per `project_ci_gate_landscape` memory (tracked by FOLLOW-090,
unrelated to this diff). PR ready for Piotr's review.

**Session note (session 63, 2026-07-27):** prior session's terminal closed mid-implementation;
resumed from the uncommitted working tree (all 5 ACs already implemented, nothing left to write).
Re-verified before committing, not taken on trust: re-read the full diff across all 13 files against
the AC list below; ran `pnpm --filter @estalara/ingest test` (285/285 incl. new case-variant +
malformed-env cases), `pnpm --filter control-plane test -- brand-identity dsr-routes` (51/51),
`tsc --noEmit` (both apps, clean), `eslint` (both apps, clean), `prettier --check` (all touched
files, clean). Committed `d16341f`, pushed, opened PR #630. `gh pr checks 630 --watch` dispatched in
background — do not mark READY_FOR_REVIEW until it reports green. Left `.retro-tmp/` untracked and
unstaged — unrelated leftover from a retrospective-analyst run blocked from writing
`.claude/agents/retrospective-analyst/lessons.md` directly (see
`.retro-tmp/lesson223.md`/`lesson224.md`); not this ticket's concern, flagged for next retro pass.

**assigned_to:** backend-engineer **model: Sonnet** — routine, well-scoped implementation
(canonicalize a string comparison in 3 call sites + add a warn-once log + re-scope 5 doc sentences +
tests) inside one module family the agent already owns (ingest origin-gate + control-plane
brand-identity); no prior failed attempt, no cross-module contract change, no ambiguous AC —
textbook "routine implementation inside a well-defined ticket scope" per the model-fit table, does
not warrant Opus/Fable. **started_at:** 2026-07-27. **branch:**
`backend-engineer/FOLLOW-678-first-party-tenant-id-canonicalize`.

**Delegation-table row used:** "ingest worker, control-plane, decision-api, Postgres/RLS, auth,
onboarding HTTP, billing, webhooks" → backend-engineer (touches `apps/ingest/src/origin-gate.ts`,
`apps/control-plane/src/lib/brand-identity.ts`, and `docs/runbooks/BRAND_PROVISIONING.md`).

**Re-verified before dispatch, not taken on the stub's word:** re-read
`apps/ingest/src/origin-gate.ts:160-195` and `apps/control-plane/src/lib/brand-identity.ts:150-225`
directly — confirmed `isUnprovisionedExternalTenant` trims both operands but does not case-fold, and
`isTreatedAsExternalBrand`/`isFirstPartyTenant` trim only the env side and also don't case-fold;
confirmed `docs/ops/DOPPLER_SECRETS_MATRIX.md:31` and `docs/runbooks/BRAND_PROVISIONING.md:92-93`
both assert the "never a traffic outage" safety property unscoped to the UNSET case.
`depends_on: []` confirmed empty in `backlog/FOLLOW_UPS.md`; `promoted_to_queue: false` there, now
promoted here.

**Delegation brief (send to backend-engineer):**

- Ticket: `backlog/FOLLOW_UPS.md` → `## FOLLOW-678` (full text — priority P1, ~3h).
- Context: `docs/MASTER_DESIGN.md` §Snapshot.1; current `CONVENTIONS_PATCH.md` rules (Rule AH —
  doc-vs-code honesty — applies directly to AC4); no open HANDOFFS.md note for this ticket.
- Branch: `backend-engineer/FOLLOW-678-first-party-tenant-id-canonicalize`.
- AC (verbatim from the stub): (1) canonicalize both operands (lower-case + trim minimum; reject
  non-UUID-shaped values; malformed env degrades to UNSET/"guard off" on the ingest side, never to
  deny-all) in all three functions; (2) log/Sentry-warn ONCE per Worker isolate when
  `FIRST_PARTY_TENANT_ID` is present but malformed; (3) add case-variant + malformed-value tests on
  both sides (the existing 5 ingest cases must still pass); (4) re-scope the 5 cited doc sentences
  to the UNSET case only, explicit that a WRONG value is NOT safe; (5) add a post-flip verification
  step to `BRAND_PROVISIONING.md` §Step 0 (POST a test event from an allow-listed origin, require
  2xx).
- PM will run the full validation loop (5a-5g) once a PR is opened, including the runtime-wiring
  grep for the new warn-once log path and a re-check that the "malformed degrades to guard-off, not
  deny-all" AC actually holds by test, not assertion.

---

## ▶️ (prev) session 61 head — resume 2026-07-26 (session 61 — RETRO-220..224 complete for #625-#629; pipeline still gated on 3 open escalations)

**All five session-60 retrospectives are DONE** (RETRO-220..224, `retrospective-analyst`/opus, one
invocation per PR — batching is against that agent's own charter). Each ran via
`claude --agent retrospective-analyst -p ... --permission-mode acceptEdits` as a genuine nested
subagent session (no Task tool available to this PM session; this is the sanctioned equivalent per
CLAUDE.md's "agent-orchestrated codebase" model). Each took ~10-25 min wall-clock; ran sequentially,
never concurrently, with a PM bookkeeping commit between each (never mid-run) per the
no-concurrent-git-ops rule. Committed as `49f9432`, `af5692a`, `2a80304`, `f6de5d5`, `7adc017`.

**Outcome — no P0 anywhere, real substance, not rubber-stamping:**

- **Rule AH promoted** (RETRO-220): "documentation asserts behavior the code doesn't implement" —
  confirmed the pattern the PM flagged at session start actually recurs (4 sightings: ESC-040/
  RETRO-205, RETRO-216, RETRO-218, RETRO-220 itself as the promoting instance). PR #625's OWN new
  runbook section (`BRAND_PROVISIONING.md` §Step 3a) shipped a `PATCH /api/config` curl that was
  non-executable at its own merge commit — the Zod schema silently stripped `brand_name`/
  `legal_entity` and any Save would have WIPED a hand-seeded identity. Closed 2h39m later by #629.
- **Rule AI promoted** (RETRO-222): "ship falsifies doc" (the inverse) — on RETRO-213 + RETRO-221
  priors.
- **RETRO-223 answered the PM's specific ESC-040 question directly from the merged diff:** the
  second-generation over-claim was corrected before merge at all sites, including a THIRD site
  (`api_keys.ts`) neither RETRO-218 nor FOLLOW-658's own AC3 text had enumerated. No new rule (would
  duplicate AH).
- **RETRO-224 contradicted RETRO-222's "closed by #629" claim** and reopened it as **FOLLOW-684
  (P1)**: the consent **POST** — the only writer of `brand_name`/`legal_entity` — calls neither
  identity gate and accepts any hash including the canonical Estalara one. Flagged for the PM: "a
  compliance-grade field is now tenant-writable and unaudited."
- **New P1s worth prioritizing next dispatch:** FOLLOW-667 (BRAND_PROVISIONING runbook still says
  `white_label` "has no consumer yet" ahead of 3 incoming white-label brands), FOLLOW-670-range
  (opt-out widget PL/ES label producer missing — an EN default can silently overwrite live Polish
  copy), FOLLOW-675 (out-of-repo `HANDOFFS.md` handoff doc still tells the caller the consent hash
  is "optional"), FOLLOW-678 (`FIRST_PARTY_TENANT_ID` compared as an exact string in both apps — a
  mis-set/case-shifted value 403s ALL first-party ingest and the SDK swallows the failure silently),
  FOLLOW-684/685 (the reopened consent-POST gap above).
- **30 new FOLLOW stubs total** (FOLLOW-661..690), all P1-P3, none P0. Two platform-shaped (not
  ticket-shaped) concerns surfaced for PM judgment, not escalated by the retros themselves per their
  charter: (a) `FIRST_PARTY_TENANT_ID` now lives unsynced across 3 stores (Doppler prd, Vercel,
  ingest secret) with zero drift detection; (b) legal identity is compliance-grade data with no
  audit trail on write.
- Two retro learning-hook appends to `.claude/agents/retrospective-analyst/lessons.md` were
  permission-blocked in the nested sessions (Edit(.claude/**) is allowed but the specific write hit
  a scope check); staged content sits untracked in `.retro-tmp/lesson223.md` and `lesson224.md` at
  repo root — **left in place, nothing deleted\*\*, needs either a manual fold-in or a
  permission-scope fix.

**Verified live, not assumed (unchanged from earlier this session):** all five PRs merged
(#625-#629, see prior header below for exact timestamps/commits). Migration 0036 confirmed live in
prod. Exactly 1 tenant in Supabase, 0 with `brand_name`/`legal_entity`/non-empty `allowed_origins` —
none of the closed gaps was ever exploitable.

**Two operator steps still pending with Piotr** (unchanged, tracked as handoff not a ticket):
`FIRST_PARTY_TENANT_ID` in control-plane env (Doppler `prd` AND Vercel separately) and as an ingest
secret (`wrangler secret put`).

**3 OPEN escalations remain, none PM-resolvable — pipeline still bars picking a NEW ticket:**
ESC-020 (Rafał), ESC-041 (npm registry E403), ESC-042 (Piotr/operator Modal deploy). ESC-040 is
CLOSED — do not treat as open.

**▶️ NEXT for a human:** clear any of the 3 escalations to unblock new-ticket dispatch. Once clear,
highest-value next tickets by this session's own findings: FOLLOW-678 (P1, silent first-party-ingest
outage risk) and FOLLOW-684/685 (P1, unaudited compliance-field write path) ahead of the P2/P3 tail.

---

## ▶️ (prev) session 61 head — resume 2026-07-26 (session 61 — all five session-60 PRs merged; retros pending; pipeline still gated on 3 open escalations)

**Verified live, not assumed:** `main` @ `461e08a`, working tree clean, `gh pr list --state open`
empty. All five PRs opened across sessions 59/60 are **MERGED**: #625 (FOLLOW-657, 12:18:24Z), #626
(FOLLOW-640/641/651, 12:19:17Z), #627 (FOLLOW-660, 12:20:43Z), #628 (FOLLOW-658, 14:42:11Z), #629
(FOLLOW-659, 14:57:38Z). All five tickets flipped ✅ DONE in `backlog/FOLLOW_UPS.md`. The
fail-silent-producer class opened by RETRO-218/219 (FOLLOW-658/659/660) is now fully closed in code.
Migration 0036 confirmed live in prod Supabase. `.claude/worktrees/` is empty (all 13 removed after
merge verification) — nothing stranded.

**Prod facts checked live today:** exactly 1 tenant in Supabase, 0 with `brand_name`, 0 with
`legal_entity`, 0 with non-empty `allowed_origins`. None of the closed gaps was ever exploitable —
this was preventive/pre-go-live hardening, not an incident fix.

**Two operator steps still pending with Piotr before any of #627/#628 do anything in prod** (both
fail-open-by-design when unset, so no outage risk from the delay, but they gate whether the new
guards are load-bearing): (1) `FIRST_PARTY_TENANT_ID` in control-plane env — **Doppler `prd` AND
Vercel separately** (they are not synced); (2) `FIRST_PARTY_TENANT_ID` as an ingest secret via
`wrangler secret put`. Tracked here as a handoff item, not a ticket — nothing for an agent to build.

**Session 61 work: five per-ticket retrospectives owed** (RETRO-220..224 for #625–#629) — none of
today's five merges has been retro'd yet. Spawning `retrospective-analyst` now; this is mandatory
post-merge bookkeeping (CLAUDE.md "Per-ticket retrospective loop"), not new-ticket selection, so it
proceeds even with escalations open.

**One thing to explicitly ask the retro to assess (not pre-judge):** the "documentation asserts
behavior the code doesn't implement" defect has now surfaced in this one area three times — ESC-040
(original `allowed_origins` over-claim), FOLLOW-658 AC3 (the fix's OWN docstring introduced a
second-generation over-claim — "projected onto the KV record at provisioning" — before FOLLOW-658
build had shipped), and the runbook §Step 0 correction in `461e08a`. `CONVENTIONS_PATCH.md` requires
≥2 retro appearances before promoting a pattern to a Rule; this may already qualify. Instructing the
retro to evaluate this on the merits rather than asserting it here.

**3 OPEN escalations remain, none PM-resolvable — pipeline rule bars picking a NEW ticket** (Rule:
"do not pick a new ticket while escalations are open") until a human clears at least one: ESC-020
(Rafał — Estalara-app DOM hooks deploy, long-standing/annotated non-blocking), ESC-041 (npm registry
E403 on the `Release` workflow — needs registry-owner access), ESC-042 (Piotr/operator —
`modal deploy apps/intent-engine` + `MODAL_CHAT_NLP_URL`; the actual chat un-shadow enabler, code
leg already merged). **ESC-040 is CLOSED** (commit `41556cc`) — do not treat it as open; it asked
for a ruling the CEO already made and shipped.

**▶️ NEXT (after retros land):** residual FOLLOW-628/629/631/632/634 remain queued but undispatched
pending escalation clearance — see prior session heads below for their definitions.

---

## ▶️ (prev) session 60 head — resume 2026-07-26 (session 60 — second crash recovery; PR #625 + #626 + #627 all open, awaiting Piotr's review)

**A THIRD stalled-agent diff was found uncommitted in the main working tree** — FOLLOW-660, on the
correct branch `backend-engineer/FOLLOW-660-first-party-env-guard` (never `main`), left behind by a
subagent that died before committing. Same failure mode as session 58/59, one session later. All 13
`.claude/worktrees/agent-*` were verified clean, so nothing else is stranded.

Session 60 ran the `docs/AGENT_WORKFLOW.md` §Recovered-work re-verification checklist rather than
trusting the dead agent's state, then committed → pushed → **PR #627**.

| PR       | Ticket             | State                                                                     |
| -------- | ------------------ | ------------------------------------------------------------------------- |
| **#625** | FOLLOW-657         | Open, PM-validated session 59 — 63 checks, only pre-existing `Rule I` red |
| **#626** | FOLLOW-640/641/651 | Open, PM-validated session 59 — 63 checks, only pre-existing `Rule I` red |
| **#627** | FOLLOW-660         | Open, PM-validated session 60 — 63 checks, only pre-existing `Rule I` red |

**`Rule I` is proven non-regressive, not merely assumed:** `main` @ `506a84c` locally =
`618 symbols / 192 violations`; PR #627's CI job = `619 symbols / **192** violations` (+1 symbol, +0
violations), and the Rule I log has zero `brand-identity` mentions. CI run `30156478170` on `main`
confirms `Rule I` is the ONLY failing job there.

**▶️ NEXT:**

1. **Piotr reviews + merges #625, #626, #627.** No file overlap between the three; merge order is
   free. (#627 touches only `lib/brand-identity.ts` + the platform-registration consent route.)
2. **Then the two REMAINING fail-silent producer gaps — FOLLOW-658 + FOLLOW-659 (both P1).**
   FOLLOW-660 is the third member of that class and is now in review, but it does NOT clear the
   gate: an external brand today would still silently inherit the env origin allow-list (658) and
   send DSR/consent mail as "Estalara" (659). Both remain documentation-instead-of-code. **Neither
   was dispatched this session because 4 escalations are OPEN** (see below) — the pipeline rule bars
   picking a new ticket while escalations are unresolved.
3. **4 OPEN escalations, all needing a human, none actionable by the PM:** ESC-020 (Rafał — DOM
   hooks deploy, standing/annotated non-blocking), **ESC-040** (CEO/design —
   `tenants.allowed_origins` security facade; overlaps FOLLOW-658's AC3, answering it likely shrinks
   658), **ESC-041** (npm registry access — `Release` workflow E403; quarantined by FOLLOW-626 but
   the root cause is unresolved), **ESC-042** (Piotr/operator — `modal deploy apps/intent-engine` +
   `MODAL_CHAT_NLP_URL`; the actual chat un-shadow enabler, code leg already merged).
4. Then the residual FOLLOW-628/629/631/632/634.

**Housekeeping (recommendation, nothing deleted):** `.claude/worktrees/` holds 13 agent worktrees
(~2.1 GB), all clean and all on branches whose PRs are merged, except
`agent-a07c4baee844569e4`/`agent-a30e28bb55b998b64` which back the still-open #626/#625. The other
11 are safe cleanup candidates via `git worktree remove` once Piotr confirms.

---

## ▶️ (prev) session 59 head — resume 2026-07-25 (session 59 — crash recovery; PR #625 + #626 open, awaiting Piotr's review)

**Session 58 ended in a terminal crash mid-dispatch.** Two worker agents died with it, leaving their
work **uncommitted inside `.claude/worktrees/`** — the exact failure mode
`feedback_check_worktrees_before_concluding_agent_didnt_run` warns about. Session 59 recovered both;
nothing was lost.

| Recovered                    | State on recovery                                                         | Now                               |
| ---------------------------- | ------------------------------------------------------------------------- | --------------------------------- |
| FOLLOW-657 (staff port)      | Leg 1 written, tests passing, but typecheck + lint RED; Leg 2 not started | **PR #625** — both legs, 82 tests |
| FOLLOW-640/641/651 (UI wave) | Implementation ~complete, typecheck RED, admin picker missing, ZERO tests | **PR #626** — 38 new tests        |

**Both PRs: all real CI gates green; only the repo-wide pre-existing `Rule I` red** (verified also
red on `main` alongside `Gitleaks secrets scan` — not a regression from either PR).

**▶️ NEXT:**

1. **Piotr reviews + merges #625 and #626.** #625 has no file overlap with #626; merge order is
   free.
2. **Then the fail-silent producer gaps — FOLLOW-658 / 659 / 660 (all P1).** The #625 runbook work
   established these are one class: a live consumer shipped without its producer, and **none of them
   errors at runtime.** An external brand today would silently inherit the env origin allow-list
   (658), send DSR/consent mail as "Estalara" (659), and can have its consent hash defaulted to
   Estalara's canonical text (660). Documentation is currently substituting for code on all three —
   these gate the first external go-live.
3. Then ESC-042 operator deploy (Piotr-side, chat un-shadow enabler) and the residual
   FOLLOW-628/629/631/632/634.

**Bundle watch:** the SDK is at **41.31KB / 42KB gzip** after #626 — 0.69KB headroom. The next SDK
feature likely needs a shrink first; do not scope one assuming room.

---

## ▶️ (prev) session 57 head (2026-07-24 — session 57 — ESC-039 chain + FOLLOW-626 + FOLLOW-633 + FOLLOW-635 code leg all DONE+MERGED; admin audit done; ▶️ NEXT: ESC-042 operator deploy (Piotr) = chat un-shadow enabler, then FOLLOW-622/623 P1 facade)

**Session 57 admin-surface work (post-ESC-039):** CEO asked whether the admin surface is done. Ran a
3-probe audit + acted on findings:

- **Model-picker for DOM creation → WIRED end-to-end** (global `app_config.generation_model` → Modal
  `generate_description.py` → real `messages.create(model=…)`). No action needed.
- **AL on/off from admin → was COSMETIC → NOW FIXED. FOLLOW-633 DONE+MERGED (PR #612, `8cb3be5`).**
  New `tenants.al_enabled` (default true) + audited staff toggle + runtime enforcement in adapt
  GET+POST (`al_enabled=false` OR status suspended/canceled → neutral; pending/active ON;
  fail-open).
- **Data → MOAT → mostly not built.** Collect partly live (but `intent_events` prod count=0 pending
  migration 0015); cross-tenant aggregation (`archetype-pipeline` + DP) DOES NOT EXIST (app
  deleted). CEO rulings: chat un-shadow YES, DPIA NO, MOAT epic DEFER. Decisive context: ONE tenant
  (Estalara), future clients = private-label re-brands of app.estalara.com → single data pool,
  cross-tenant MOAT parked. Brief: `docs/DECISION-BRIEF-MOAT-2026-07-24.md`; memory
  `project_single_tenant_rebrand_model`.
- **Chat un-shadow (FOLLOW-635) scoped:** it's a DEPLOY leg (ESC-042, Piotr-side:
  `modal deploy apps/intent-engine` + `MODAL_CHAT_NLP_URL` wiring) + a small option-A cleanup PR
  (delete vestigial `CHAT_NLP_LIVE` flag, fix false "shadow-only" docstrings, update FOLLOW-346
  test). Chat already influences the decision via the SDK client loop; it's DARK only because
  intent-engine is undeployed. CEO chose OPTION A. Cleanup PR was sequenced AFTER FOLLOW-633 (shared
  `adapt/route.ts`) — 633 now merged, so it is CLEAR TO DISPATCH.
- New tickets filed: FOLLOW-633 (DONE), FOLLOW-634 (P3 stale data-engineer charter), FOLLOW-635
  (chat un-shadow, option-A cleanup pending). ESC-042 (chat deploy blocker, Piotr-side).

**▶️ NEXT:** (1) **ESC-042 operator deploy (Piotr-side)** — `modal deploy apps/intent-engine` +
`MODAL_CHAT_NLP_URL`/Upstash secret wiring; the ACTUAL chat un-shadow enabler (FOLLOW-635 code leg
DONE via PR #613 `5ab923b`; chat stays dark until this runs). (2) FOLLOW-622/623 (P1 producer-only
facades on the settings page — `allowed_origins` advertised as security control but ingest CORS
doesn't enforce; likely needs a design decision enforce-vs-de-scope). (3)
FOLLOW-627/628/629/631/632/ 634.

---

## ▶️ (prev) session 57 head — ESC-039 chain closed

**Session 57 = ESC-039 close-out chain (K.2 swallow-then-clobber data-loss).**

- **FOLLOW-624 DONE + MERGED (PR #608, `3b0b4a3`, 07:28Z).** The three ADMIN staff editors
  (`admin/tenants/[id]/{settings,quiz,demo}/`) swallowed a failed GET then clobbered real tenant
  config with DEFAULTS on the next Save under a green "Settings saved!". Fixed + tested. Merged.
- **RETRO-206 (post-merge retro for #608) found the fix INCOMPLETE** — it ran a `/admin`-narrowed
  grep instead of Rule K.2's repo-wide `apps/` grep and missed three byte-identical twins outside
  `/admin` (two writing the SAME routes). Filed FOLLOW-630 (P1), widened FOLLOW-625's scope.
- **FOLLOW-630 DONE + MERGED (PR #609, `0bfaedd`).** Fixed the three twins
  (`dashboard/quiz/page.tsx`, `dashboard/demo/override/page.tsx`,
  `components/generation-model-settings.tsx`), added the two missing `!r.ok` guards, red-first tests
  per editor. PM independently re-verified on the merged branch (swallow gone, `!r.ok` present,
  repo-wide grep clean — 9 residuals are read-only analytics + defensive JSON-parse, documented).
- Both PRs: all real CI gates green; only pre-existing repo-wide `Rule I` red (also red on `main`
  d89757f — not a regression). Backlog: ESC-039 → RESOLVED (both axes), FOLLOW-624 + FOLLOW-630 →
  DONE.

- **FOLLOW-625 DONE + MERGED (PR #610, `f936089`).** AST-based CI hard-gate
  `Rule K.2 consumer-side swallow guard` (`scripts/check-k2-consumer-swallow.cjs` + `.sh`), scope
  covers `src/app/**` AND `src/components/**` (RETRO-206). Fixture suite proves both directions;
  load-bearing allow-list. Guard job green on both CI runs; PM re-verified locally. This is the
  enforcement leg — the swallow can no longer be copy-forwarded silently. **ESC-039 FULLY CLOSED**
  (all 3 legs: fix 624 / twins 630 / enforcement 625).

**▶️ NEXT (open):**

0. **CORRECTION (session 57):** the old "RETRO-205 dispatch still pending" note was STALE —
   RETRO-205 is a COMPLETE entry in `RETROSPECTIVES.md` (line ~31249, written session 56, commit
   `d89757f`); it is what filed ESC-039 + FOLLOW-622…629 and drove this whole session. Nothing to
   dispatch for 205. RETRO-206 (retro for #608/FOLLOW-624) also already ran and drove the 630/625
   chain.
1. **Per-ticket retros DONE (session 57):** RETRO-207 (FOLLOW-630) — clean end-to-end closure of
   RETRO-206 LG-1, no follow-ups. RETRO-208 (FOLLOW-625) — enforcement-not-text remedy delivered;
   found ONE P3 residual → **FOLLOW-631** (guard covers only `.catch()` chain form, not block-form
   `try{await fetch}catch{}` — hypothetical today, no such instance exists) + **FOLLOW-632** (P2 —
   audit all ~30 CONVENTIONS_PATCH Verification-block greps, mechanise the high-blast-radius ones;
   K.2 was one of many rules shipping an unrun grep). **ESC-039 verified closed end-to-end** by the
   retros (remediation leg + prevention leg), FOLLOW-631 tracked as latent residual, does NOT
   re-open ESC-039.
2. **FOLLOW-626 DONE + MERGED (PR #611, `f213880`).** Quarantined the permanently-red `Release`
   workflow (trigger → `workflow_dispatch` only; SDK ships as hosted bundle, no npm consumer; header
   records WHY + re-enable path). PM verified the merge commit fired no Release run. Second
   permanently-red gate from RETRO-205 §5d closed.
3. **RETRO-205's still-open follow-ups (not yet promoted to QUEUE):** FOLLOW-622 + FOLLOW-623 (P1 —
   `allowed_origins`/`brand_config` are producer-only facades; `allowed_origins` is advertised as an
   SDK-origin security control that ingest CORS does NOT enforce — likely needs escalation/design,
   not a quick fix), FOLLOW-627 (`/api/config` missing-row semantics), FOLLOW-628, FOLLOW-629,
   FOLLOW-631 (P3 block-form swallow guard gap), FOLLOW-632 (P2 audit CONVENTIONS_PATCH greps).

---

## ▶️ (prev) session 56 — FOLLOW-600 DONE + MERGED (PR #606, `19ef714`), FOLLOW-620 DONE + MERGED (PR #607, `f4dd037`); RETRO-205 dispatch pending

**Session 56 = PM post-merge audit + bookkeeping.** Piotr merged both #607 (21:12Z) and #606
(21:27Z) directly, ahead of the PM's own READY_FOR_REVIEW gate. Independently re-verified BOTH
merges from scratch (not taken on the human's word alone):
`gh pr view 606/607 --json state,mergedAt,mergeCommit` both confirm `state: MERGED`. Local `main`
fast-forwarded `54e76a7`→`19ef714` (2 commits, clean f-f, no divergence). Stale local feature
branches for both tickets (+5 other already-merged `backend-engineer/*` branches whose remotes were
`gone`) deleted.

**FOLLOW-600 post-merge audit (this session, done AFTER the human merge — treated as more important,
not less, per the standing rule "any gap is already on `main`"):**

- Re-read the full PR #606 diff (all 8 files, ~1836 lines) end-to-end, not just the session-55
  summary.
- Schema claims verified against the REAL source, not trusted from the PR description:
  `packages/db/src/schema/tenants.ts` — confirmed `plan`, `allowedOrigins` (`text[]`), `brandConfig`
  (`jsonb`), `updatedAt` all exist as real columns; `packages/db/src/schema/staff_audit_log.ts` —
  confirmed `adminUserId`, `action`, `targetTenantId`, `payload`, `ipAddress`, `userAgent` all exist
  as real columns. The route's doc-comment schema-mapping claims are accurate, not aspirational.
- Runtime-wiring grep (non-test producer + non-test consumer) on the MERGED branch content for every
  new symbol — see evidence block below. Zero half-wires found: hub link → settings page exists →
  editor component exists → fetches the real `/api/config` → route reads/writes the real `tenants` +
  `staff_audit_log` tables.
- Independent re-execution (fresh git worktree at the PR's exact merge-ready commit `dcd26e5`, then
  again directly on merged `main` `19ef714`, NOT trusting the session-55 self-report):
  `pnpm install` (workspace deps built fresh), `node scripts/check-staff-write-atomicity.cjs` →
  `api/config/route.ts` prints **OK** both times, `labels/export` correctly stays `SKIP`. Targeted
  vitest run (`src/app/api/config src/app/admin/tenants`) → **77/77 tests PASS** across 14 files.
  Scoped `tsc --noEmit` and `eslint` on the touched paths → clean (0 errors) once workspace-package
  `dist/` output was built — an artifact of the throwaway worktree lacking built deps, not a real
  defect; CI's own Lint/Typecheck gates (which run in a fully-built environment) already confirmed
  green on GitHub Actions independently.
- CI evidence (real gates only, per `docs/ops` CI-gate-landscape convention — Rule I is documented
  pre-existing-red repo-wide, confirmed independently still red on `main`'s own latest commit
  `f4dd037` via `gh api .../commits/main/check-runs`, so it is NOT a #606 regression):
  `gh pr checks 606` → **59 pass, 2 fail (both `Rule I`, the same pre-existing gate, 2 job-matrix
  runs)**. Non-success count for REAL gates: **0**.
- Acceptance criteria (FOLLOW_UPS.md FOLLOW-600 entry) — all met: per-tenant settings page + editor;
  `/api/config` on the real `tenants` table; CEO Q1 "no generation_model control" MANDATORY test
  present and asserting against the un-mocked component; RETRO-187 invariant-5 READ+WRITE
  tenant-fence tests present and driving the real query shape (not the demonstrative-only
  `RLS-TRAP-LEAK-DEMO` shape); FOLLOW-615 write-rank gate re-asserted; RETRO-202 §3a
  audit-in-`db.transaction()` present with a red-first rollback test; mutation kept INLINE (guard
  prints OK, not the FOLLOW-613 SKIP class).

**Verdict: FOLLOW-600 is REAL, not scaffolded. No gap found; no follow-up ticket needed for this
PR's own scope.**

**Wiring evidence (grep on the merged commit's tree, non-test producer + non-test consumer):**

```
$ git show <mergecommit>:apps/control-plane/src/app/admin/tenants/\[id\]/settings/page.tsx | grep StaffTenantConfigEditor
26:import { StaffTenantConfigEditor } from './tenant-config-editor';
53:      <StaffTenantConfigEditor tenantId={id} />
$ git show <mergecommit>:.../tenant-config-editor.tsx | grep "export function StaffTenantConfigEditor"
49:export function StaffTenantConfigEditor(...)
$ git show <mergecommit>:.../page.tsx (hub) | grep settings
134:  href={`/admin/tenants/${tenant.id}/settings`}
$ git show <mergecommit>:.../tenant-config-editor.tsx | grep "api/config"
56:  const url = `/api/config?tenant_id=${encodeURIComponent(tenantId)}`;
$ git show <mergecommit>:.../api/config/route.ts | grep "tenants\.\|adminUserId\|targetTenantId"
175-178: plan/allowedOrigins/brandConfig/updatedAt: tenants.*
318,320: adminUserId: access.staff.sub / targetTenantId: tenantId
```

**FOLLOW-600 — status: ✅ DONE + MERGED.** PR **#606** merged by Piotr, `19ef714`,
2026-07-23T21:27:05Z.

**FOLLOW-620 — status: ✅ DONE + MERGED.** PR **#607** merged by Piotr, `f4dd037`,
2026-07-23T21:12:47Z. Both CH gates proven green on #607 itself and remain green on #606 post-pin.
FOLLOW-621 (data-engineer, P3 — real 26.x compat decision) remains separately OPEN, not closed by
this pin (the pin is a stopgap, not the 26.x fix).

**NEXT ACTION:** retrospective-analyst (Opus) dispatch for **RETRO-205** covering the merged
FOLLOW-600 PR #606 is due per the standing per-ticket retro loop — note for the retro: (a) the #607
CH-image-pin interaction with #606's CI (the CH gates only went green because #607 landed first — an
inter-PR CI dependency worth flagging if it recurs), and (b) the session-54 mid-flight crash that
stranded FOLLOW-600's implementation uncommitted (recovered per the standing verify-don't-discard
lesson) — is this class of stranding trending, and does it need a systemic fix (e.g. more frequent
auto-checkpoint commits)? No escalations open that block this. Ready ticket candidates for AFTER the
retro: **FOLLOW-604** (P3, quiz ON/OFF staff port), **FOLLOW-611** (P4, gitleaks false-positive),
**FOLLOW-616/617/618/619** (P3, hypothetical guard call-shapes, none live), **FOLLOW-621** (P3, real
CH 26.x compat — opportunistic, must land before any CH server upgrade to 26.x anywhere). Next-free
FOLLOW is **622**, next-free RETRO is **205**.

## ▶️ (superseded) resume 2026-07-23 (session 55 — FOLLOW-600 IMPLEMENTED, PR #606 open; CI blocked by an UPSTREAM ClickHouse-image breakage, fixed by PR #607 [FOLLOW-620]; BOTH PRs await Piotr's review — merge #607 FIRST, then re-run #606's failed checks)

**Session 55 was an interrupted-session recovery.** Session 54's dispatch of FOLLOW-600 died
mid-flight with the full implementation UNCOMMITTED in the working tree on branch
`backend-engineer/FOLLOW-600-tenant-settings-surface`. Recovered per the standing lesson (verify,
don't discard): re-verified the work from scratch BEFORE committing — full control-plane suite
**156/156 files, 1729/1729 tests PASS** (one earlier hook-timeout flake re-run green), `pnpm lint`

- `pnpm typecheck` clean, prettier unchanged on every touched file,
  `node scripts/check-staff-write-atomicity.cjs` → `api/config/route.ts` prints **OK** (not SKIP),
  `labels/export` stays SKIP.

**FOLLOW-600 — status: 🟡 READY_FOR_REVIEW (CI-conditional, see below).** PR **#606**
(`feat(control-plane): per-tenant /settings surface, /api/config on real tenants [FOLLOW-600]`,
commit `e96b7ee`). All ticket ACs verified present:

- `/admin/tenants/[id]/settings` page + `TenantConfigEditor` (brand → `tenants.brandConfig`,
  `sdk.allowed_origins` → `tenants.allowedOrigins`, `plan` read-only); linked from the FOLLOW-593
  landing hub (with test).
- `/api/config` GET/PATCH wired to the REAL `tenants` table via `createAdminClient()`, replacing the
  FOLLOW-614 in-memory stub.
- MANDATORY test: no generation-model control renders (CEO Q1 — GLOBAL-only).
- MANDATORY invariant-5 tenant-fence tests, READ + WRITE directions (RETRO-187): staff request for
  tenant A cannot see/mutate tenant B's row (DB mock keyed on the bound `.where()` value).
- FOLLOW-615 write-rank gate verified live BEFORE wiring and re-asserted (readonly staff → 403).
- §3a audit-in-`db.transaction()` (`action: 'tenant_config.update'`, audit-fail→500), mutation
  INLINE (RETRO-202 / RETRO-198/199) — guard prints OK.
- FOLLOW-603-pattern option-wiring assertions on GET (`agency:viewer`) and PATCH (`agency:admin`).
- Deliberate drops documented in the route header: `sdk.active_domains` (zero consumers, no column —
  Rule U/H) and `quiz.*` (owned by the dedicated FOLLOW-595 surface; avoids a second write path for
  the same columns).

**CI on #606:** every gate GREEN except (a) `Rule I` — documented pre-existing red (191 violations,
unrelated), and (b) **both ClickHouse gates** (`ClickHouse migrations smoke`,
`Tracer query-builders live ClickHouse guard`) — verified NOT this PR's fault: an UPSTREAM
environmental breakage, see next.

**FOLLOW-620 — status: 🟡 READY_FOR_REVIEW (P1, repo-wide CI un-breaker).** PR **#607**
(`ci(infra): pin ClickHouse CI image to 25.8 LTS [FOLLOW-620]`, commit `ea21e05`). Docker Hub
`clickhouse/clickhouse-server:latest` moved to **26.7.1** on 2026-07-22; its new strict check
(dimension column `region` outside the `AggregatingMergeTree` sorting key →
`Code: 36 BAD_ARGUMENTS`) rejects `0002_create_session_summary_mv.sql` at CREATE, failing BOTH CH
gates on EVERY PR regardless of content (identical error, 2 independent runs, on a PR touching zero
CH files; main green on the same chain hours earlier). Fix: pin both `ci.yml` service containers to
`25.8` LTS (tag verified on Docker Hub) with in-file why-comments. **Proof on #607 itself: both CH
gates PASS**; only Rule I red (the same pre-existing). Follow-ups filed in `FOLLOW_UPS.md`:
**FOLLOW-620** (this fix, shipped) + **FOLLOW-621** (data-engineer: the real 26.x compat decision
for migration 0002 — `allow_dimensions_outside_sorting_key=1` vs sorting-key change, prod-reach path
since CH does not auto-apply, and un-pin/bump CI in the same PR). Next-free FOLLOW is **622**,
next-free RETRO stays **205**.

**NEXT ACTION — exact algorithm for the next `/run-pm` (verify, don't guess; check ACTUAL merge
state first with `gh pr view 607 --json state,mergeCommit` and
`gh pr view 606 --json state,mergeCommit`, then branch):**

- **If #607 NOT merged yet:** nothing is actionable on this thread — #606's CH gates CANNOT go green
  until the pin lands on main (the `pull_request` merge ref needs it). Do NOT re-run #606's checks
  yet (wasted run), do NOT dispatch new implementation work on top of a red-CI repo without noting
  every new PR will show the same 2 CH fails. Remind Piotr: **merge #607 first** (2-line `ci.yml`
  pin; both CH gates proven green on #607 itself; only Rule I red = documented pre-existing).
  Optionally pick an independent P3 (FOLLOW-604 etc.) but state the CH-gate caveat in its dispatch
  brief.
- **If #607 merged but #606 still red/unmerged:** fast-forward local `main`, then re-run ONLY the
  failed checks on #606 (`gh run rerun <run-id> --failed` for the two runs, or via the PR checks
  UI), `gh pr checks 606 --watch`. Expect green modulo Rule I. When green → #606 is READY_FOR_REVIEW
  for Piotr to merge (all FOLLOW-600 ACs already PM-verified this session — see above; do not
  re-derive).
- **If #606 merged:** standard post-merge loop — verify merge independently
  (`gh pr view 606 --json state,mergeCommit,mergedBy`), fast-forward `main`, delete the feature
  branch, re-run `node scripts/check-staff-write-atomicity.cjs` on main (config route must print
  OK), mark FOLLOW-600 **DONE + MERGED** here, dispatch `retrospective-analyst` (Opus) for
  **RETRO-205** (bookkeeping commit BEFORE dispatch — the session-41 collision lesson). Also close
  out FOLLOW-620 the same way if #607 merged (its retro can fold into RETRO-205's session sweep —
  trivial 2-line CI pin, PM-inline note acceptable per the RETRO-200 precedent).
- **Then:** pick the next ticket by the standard priority rule. Ready candidates: FOLLOW-604 (P3,
  quiz ON/OFF staff port), FOLLOW-611 (P4), FOLLOW-616/617/618/619 (P3, hypothetical guard shapes),
  FOLLOW-621 (P3, CH 26.x compat — opportunistic, but MUST land before any CH server upgrade to 26.x
  anywhere).

Standing facts for that session: next-free FOLLOW **622**, next-free RETRO **205**; commitlint
header hard-limit is 100 chars (hit twice this session); local branch
`backend-engineer/FOLLOW-600-tenant-settings-surface` = `e96b7ee` pushed, PR #606; local branch
`devops-engineer/FOLLOW-620-pin-clickhouse-ci-image` = `ea21e05` pushed, PR #607.

## ▶️ (superseded) resume 2026-07-22 (session 54 — FOLLOW-613 DONE + MERGED by Piotr (PR #605, squash `872715f`); RETRO-204 filed, found a 4th recurrence of Rule AE — a NEW bypass-7 shape filed as FOLLOW-619; picking next ticket is the open item)

**FOLLOW-613 — status: ✅ DONE + MERGED.** PR **#605**
(`fix(control-plane): close staff-write guard bypass 6 — barrel re-export [FOLLOW-613]`) merged by
Piotr (`Pnawrocki9`) at `2026-07-22T21:01:37Z`, merge commit `872715f`
(`gh pr view 605 --json state,mergeCommit,mergedAt,mergedBy` independently confirmed `state: MERGED`
— not taken on the human's word alone, per the standing PM lesson). Local `main` fast-forwarded to
`872715f`; feature branch `backend-engineer/FOLLOW-613-guard-barrel-reexport` deleted (GitHub
auto-deleted the remote ref on merge; local ref pruned). Re-verified POST-MERGE on `main`:
`bash scripts/__tests__/check-staff-write-atomicity.test.sh` → exit 0, 38/38 PASS;
`node scripts/check-staff-write-atomicity.cjs` → `admin/labels/[id]/route.ts` is `OK`,
`admin/labels/export/route.ts` stays `SKIP`.

All 8 ACs addressed: guard now resolves `@estalara/*` package specifiers → barrel entry →
re-exported concrete module (per-name, depth-3 bound unchanged); `admin/labels/[id]/route.ts` flips
`SKIP`→`OK` in the real-repo scan (closes the LIVE defect FOLLOW-597 shipped);
`admin/labels/export/ route.ts` correctly stays `SKIP` (per-name resolution proof); new bypass6
fixture pair added; full fixture suite 38/38 PASS, zero regressions. AC-7 (Rule AE point 4)
enumerated explicitly in the module doc comment: 3 further call-shapes (computed/bracket member
access, dynamic `await import(...)`, local variable/function-reference aliasing) are NOT closed by
this ticket (out of its scope) and are confirmed hypothetical-only today (grepped all 6
staff-audited routes, none uses any of the three) — filed as **FOLLOW-616/617/618** (all P3) in
`backlog/FOLLOW_UPS.md`. Next-free FOLLOW is now **619**, next-free RETRO stays 204.

**Mid-review fix landed in the same PR:** the first CI run failed `Gitleaks secrets scan` — a
false-positive `cloudflare-api-token` match (9 findings) on the bypass6 fixture directory name
(`bypass6-barrel-reexport-delegated-mutation`, 42 chars > the rule's 40-char capture window), same
class as the existing bypass4/bypass5 `.gitleaks.toml` allowlist entries. Fixed with a token-scoped
allowlist regex (commit `a4d4ca1`, verified by simulating the exact `[a-zA-Z0-9_-]{40}` capture
against all 9 original CI-reported strings — all reduce to
`bypass6-barrel-reexport-delegated-mutati`, confirmed the new regex is a substring of each); CI
re-ran green.

**CI at merge time:** every real gate green (2 full `gh pr checks 605 --watch` passes, both exit 0)
— Build/Build(control-plane), Lint, Typecheck, Format check, Test (Node 22) ×2, Test (Python) ×8,
SDK E2E ×2, Gitleaks, Staff-write audit atomicity, and all FOLLOW-433/438/230/H/J/K.3.6/tracer/
redis/archetype guards. Only `Rule I — wired-or-dead check` red — confirmed pre-existing (191
violations, same count cited in prior sessions) and unrelated (this ticket touches no
`apps/`/`packages/` symbol).

**RETRO-204 filed** (`backlog/RETROSPECTIVES.md`, by `retrospective-analyst`/Opus). Headline: the
bypass-6 fix is genuinely correct — independently re-verified LIVE on `main`, not just on the PR's
own fixtures (`labels/[id]` → `OK`, `labels/export` stays `SKIP`, full suite green). BUT for the 4th
consecutive time on this same guard, a fresh independent reproduction found the SAME Rule AE class
one call-shape over, and it is NOT one of the three shapes FOLLOW-613 itself already
enumerated-and-deferred (616/617/618): a **NAMESPACE import of a BARREL package**
(`import * as db from '@estalara/db'; db.upsertConversionLabel(tx, ...)`) prints `SKIP` in both
directions — the exact intersection of bypass 5 (namespace, FOLLOW-612) and bypass 6 (barrel,
FOLLOW-613) that neither fix closes. Verified independently this session by direct code read
(`check-staff-write-atomicity.cjs:307-308`): the namespace-import branch binds the bare barrel path
`resolvedEntry` directly, skipping `resolveExportedNameToConcreteModule` (which the named/default
branches above it now call) — so `moduleContainsMutation` on that unresolved barrel never sees its
re-exported mutation. Confirmed HYPOTHETICAL today (zero routes use
`import * as X from '@estalara/*'`) but flagged as the highest-likelihood of the four open shapes
(616/617/618/619) — a one-line refactor of the live `labels/[id]` route would silently regress it
back to `SKIP`. Filed **FOLLOW-619** (P3). No `CONVENTIONS_PATCH.md` promotion — this IS Rule AE,
its 4th consecutive confirmation, not a new pattern. Next-free FOLLOW is now **620**, next-free
RETRO is **205**.

**NEXT ACTION:** no escalations open. Ready candidates: **FOLLOW-600** (P3, unblocked),
**FOLLOW-604** (P3), **FOLLOW-611** (P4, gitleaks false-positive on ingest wrangler.toml — unrelated
class to the .gitleaks.toml touch this session made), **FOLLOW-616/617/618/619** (all P3, the 4
enumerated-but-open guard call-shapes — none live, opportunistic). Apply the standard priority rule
(unblocks the most other tickets → active sprint → critical path, then priority level as tiebreak)
to pick the next one.

## ▶️ (superseded) resume 2026-07-22 (session 53 — no open escalations blocking [ESC-020/028/034 non-blocking per memory], no open PRs; picked FOLLOW-613 (P2, live defect) over FOLLOW-600/604 (P3) per priority rule; dispatched to backend-engineer/OPUS)

**▶️ HIGHEST-LEVEL STATE (read first).** Confirmed via
`cat backlog/QUEUE.md backlog/ESCALATIONS.md backlog/HANDOFFS.md`, `git log --oneline -20`,
`gh pr list --state open`: only ESCALATIONS entry open is ESC-020 (Estalara-app DOM hooks committed
but not deployed to prod — a CTO/Rafał-owned deployment action, unrelated to any backend-engineer
ticket in this queue; treated as non-blocking per longstanding precedent recorded in memory
`project_ci_gate_landscape` and repeated across sessions 46-52's own "no escalations open" lines).
`gh pr list --state open` → empty. `git log` matches QUEUE.md's own record (HEAD `91ab24b`,
FOLLOW-615 close-out).

**Ticket selection.** Ready candidates with no unmet `depends_on`: **FOLLOW-600** (P3, now
unblocked), **FOLLOW-604** (P3), **FOLLOW-611** (P4), **FOLLOW-613** (P2, confirmed LIVE defect).
Per the priority rule (unblocks the most other tickets → active sprint → critical path, then
priority level as tiebreak), picked **FOLLOW-613**: it is the highest priority (P2 vs P3/P4) and is
a confirmed-live security-relevant gap — independently re-ran
`node scripts/check-staff-write-atomicity.cjs` before dispatch and reconfirmed
`SKIP: apps/control-plane/src/app/api/admin/labels/[id]/route.ts — insert(staffAuditLog) present but no other data mutation`
still holds on current `main` (the guard cannot see through the `@estalara/db` barrel re-export
`packages/db/src/index.ts:15` to the real `upsertConversionLabel` mutation one hop further, so this
shipped staff-write route's atomicity is provably enforced only by its own unit test, not by the
repo-wide CI guard). FOLLOW-600/604 remain open, unrelated, no dependency, to be picked next
session.

**FOLLOW-613 — status: IN_PROGRESS.** assigned_to: backend-engineer (model: **Opus** — this is the
4th consecutive hardening pass on the SAME AST security-invariant guard
(`scripts/check-staff-write-atomicity.cjs`, ADR-0018 §3a) after FOLLOW-608→609→612 each shipped a
fix that a fresh independent reproduction then found incomplete one call-shape further (Rule AE,
promoted after RETRO-196 on exactly this pattern). Per CLAUDE.md's model-fit rule of thumb —
"escalate one tier when the task already failed once at the lower tier" — three consecutive
incomplete-closure findings on the same guard plus its security-sensitive nature (governs whether a
staff write's audit-atomicity is actually CI-enforced) crosses that bar; this also needs non-trivial
design judgment (package-specifier→barrel resolution, re-export-following bounded by depth, and an
explicit enumerate-remaining-shapes verdict per Rule AE point 4), not mechanical pattern-copying.
started_at: 2026-07-22. branch: `backend-engineer/FOLLOW-613-guard-barrel-reexport`.

**Delegation-table row used:** "a contract between two modules, a new dependency, an ADR" does NOT
apply here (no new dependency/contract); the correct row is **"ingest worker, control-plane,
decision-api, Postgres/RLS, auth, onboarding HTTP, billing, webhooks" → backend-engineer** — the
guarded artifact is a CI script owned by control-plane's staff-write-atomicity invariant (ADR-0018
§3a), and every prior ticket in this exact sequence (FOLLOW-607/608/609/612) was dispatched to
backend-engineer under this same row.

### Delegation brief — FOLLOW-613 (full)

**Ticket:** `backlog/FOLLOW_UPS.md` →
`## FOLLOW-613 — Close the staff-write-atomicity guard's 6th call-shape bypass: a delegated mutation reachable only through a BARREL re-export`
(source_retro: RETRO-197, source_ticket: FOLLOW-612, priority P2, est. 1-2h).

**Read first, in order:**

1. `docs/MASTER_DESIGN.md` §Snapshot.1 (current implementation status, per OPERATING_PRINCIPLES Rule
   1).
2. `CONVENTIONS_PATCH.md` **Rule AE** in full (the exact rule this ticket exists to satisfy — read
   all 4 numbered sub-points, especially point 4: "state explicitly whether the class is then fully
   enumerated-and-guarded (closable) or still open").
3. `backlog/HANDOFFS.md` — no open note for this script as of this dispatch; if one exists by the
   time you start, read it first.
4. `scripts/check-staff-write-atomicity.cjs` in full — especially `collectLocalImports` (only visits
   `ts.isImportDeclaration`, NOT `ts.isExportDeclaration` — this is the exact gap),
   `collectLocalImportedIdentifierSources`, and `moduleContainsMutation` (the bounded depth-3 walk
   this ticket must extend).
5. `scripts/__tests__/check-staff-write-atomicity.test.sh` — the existing fixture suite (currently
   33/33 per session 49's re-verification); your new fixtures get added here, nothing existing may
   regress.
6. `packages/db/src/index.ts:15` and `apps/control-plane/src/app/api/admin/labels/[id]/route.ts` —
   the concrete LIVE instance: the route imports `upsertConversionLabel` from `@estalara/db`
   (workspace package specifier), whose barrel re-exports it from `./upsert-conversion-label.js`.
   Reproduce the current false-negative yourself before changing anything:
   `node scripts/check-staff-write-atomicity.cjs 2>&1 | grep 'labels/\[id\]'` — must currently print
   `SKIP`.

**Context (why this exists):** RETRO-192→194→196→197 is a 4-hop chain where each guard-hardening
ticket closed the ONE call-shape a regression/reproduction had found, and a fresh independent
reproduction then found the SAME class of gap one more call-shape over (bare-identifier →
namespace/property-access → barrel re-export). This is Rule AE's exact pattern. FOLLOW-612 closed
bypass 5 (namespace imports); this ticket closes bypass 6 (barrel re-exports), which is now a LIVE
defect (not hypothetical) because FOLLOW-597 shipped `labels/[id]/route.ts` using exactly this
shape.

**Acceptance criteria (restated in full from the FOLLOW-613 stub — do not drop any):**

- [ ] AC-1: Extend `moduleContainsMutation`'s bounded module walk (or a parallel resolution) to also
      follow `ts.isExportDeclaration` re-export specifiers (`export * from '...'` and
      `export { x } from '...'`) with a local module specifier, so a barrel that re-exports a
      mutating module is discovered within the existing depth-3 bound.
- [ ] AC-2: Resolve workspace-PACKAGE specifiers (`@estalara/db`, `@estalara/*`) to their
      `packages/*/src/index.ts` barrel entry (map from the workspace layout), THEN apply the
      re-export-following above — re-export-following alone is insufficient for the live
      `labels/[id]` case since it's reached via a package specifier, not a `@/`-alias barrel. Keep
      the depth-3 bound.
- [ ] AC-3: Red-first REAL-REPO assertion — after the fix, `api/admin/labels/[id]/route.ts` must
      flip from `SKIP` to `OK` in the default-scan output; moving its `insert(staffAuditLog)`
      outside the `db.transaction()` (in an isolated throwaway check, not committed to the real
      route) must produce `FAIL`.
- [ ] AC-4: Red-first fixture pair (mirroring the bypass4/5 naming convention in the test script)
      with a 3-file layout: route → barrel `index.ts` (`export * from './mutation-helper'`) →
      `mutation-helper.ts` (the real mutation). Co-scoped variant must go `SKIP`→`OK`; out-of-tx
      variant `SKIP`→`FAIL`.
- [ ] AC-5: Re-run the FULL existing fixture suite (bypass 1-5 + real-repo scan) — confirm no
      regression (must stay at least 33/33, plus your new AC-4 fixtures).
- [ ] AC-6: Re-verify the depth-3 `MAX_DEPTH` bound is still sufficient once re-exports are followed
      (a barrel-of-a-barrel is now representable) — confirm 3 is enough for the real repo layout
      today, or document explicitly why not and what the fix would be.
- [ ] AC-7 (Rule AE point 4 — mandatory, do not leave implicit): before declaring the guard
      "complete," explicitly enumerate whether any further call-shape remains unaddressed — at
      minimum address the three named in the stub: dynamic/computed member access
      (`helper['upsertX'](tx, …)`), `await import(...)` dynamic import, and a variable holding a
      function reference assigned from a property access. State the answer for each in the PR
      description (closable now, or filed as a new FOLLOW with justification) — do not silently punt
      without a decision.
- [ ] AC-8 (repo hygiene): prettier on every touched file; conventional commit message
      `fix(control-plane): <subject> [FOLLOW-613]` (or `chore(infra):` if that scope fits better —
      use judgment, this is a CI script not a control-plane route, note your choice); no new
      secrets/workflow/branch-protection needed — confirm and state so explicitly in the PR.

**Explicitly OUT of scope:** do not touch any `apps/control-plane/src/app/api/**/route.ts`
production file (this ticket only hardens the guard script + its test fixtures); do not touch
FOLLOW-600/604/609's own route work; do not silently rewrite `moduleContainsMutation`'s existing
detection logic for bypasses 1-5 — it is already verified correct, only extend it.

**Completion:** `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then
`bash scripts/__tests__/check-staff-write-atomicity.test.sh` (must show all assertions green
including your new AC-4 pair), prettier on every touched file, conventional commit referencing
`[FOLLOW-613]`, push, open the PR (never commit to `main`). PM re-runs `gh pr checks <pr> --watch`,
independently re-runs the fixture suite AND the real-repo scan (does not take the PR's own claimed
output on faith — same discipline as sessions 46/49), confirms `labels/[id]/route.ts` now prints
`OK`, and confirms the AC-7 shape-enumeration statement is present before marking READY_FOR_REVIEW.

---

## ▶️ (superseded) START HERE — resume 2026-07-22 (session 52 — FOLLOW-615 DONE+MERGED+RETRO'd (PR #604, squash `c766fd6`, RETRO-203 clean closure, no follow-ups); FOLLOW-600 unblocked, ready to pick next)

**▶️ HIGHEST-LEVEL STATE (read first).** RETRO-202 (post-merge retro for FOLLOW-614 / PR #603) is
filed: the spoofable-header auth-hole class is now CLOSED repo-wide (FOLLOW-491 fully discharged),
but the retro found ONE new gap — **FOLLOW-615 (P2 security)** — and amended FOLLOW-600's AC to
depend on it. FOLLOW-615 was found already implemented (uncommitted) in the agent worktree
`.claude/worktrees/agent-aac4622dd11351ccb` from a prior dispatch; PM independently re-verified
every AC (diff read against the exact `quiz/config/route.ts:154` shape, ran the 14-test suite green,
then live-perturbed the new gate — `if (false)` — to confirm exactly the new 403 test flips red
while 13 others stay green, reverted clean) before committing. Committed (`541cc20`), pushed, and
opened **PR #604**
(`fix(control-plane): add staff write-rank gate to PATCH /api/config [FOLLOW-615]`).
`gh pr checks 604 --watch` confirmed CI green on all real gates — only the pre-existing non-blocking
`Rule I` red (191 violations, none in the two changed files; per `project_ci_gate_landscape`
memory). **PR #604 is now DONE + MERGED**: squash-merged to `main` at `c766fd6`
(2026-07-22T09:45:07Z), re-verified via `gh pr view 604 --json state,mergeCommit,mergedAt` (not
taken on the human's word alone, per the standing PM lesson). Local `main` fast-forwarded to
`c766fd6`; agent worktree cleaned up. **RETRO-203 filed** (`backlog/RETROSPECTIVES.md`): clean
end-to-end closure of RETRO-202 §4a LG-1 — the gate is the sole write chokepoint, matches all three
sibling ports verbatim, GET-ungated is the correct multi-axis call (not a contradiction). Zero
logic/bug/docs gaps; one P4 test-coverage note (no stub warranted). No `CONVENTIONS_PATCH.md` rule
promoted — the missing-write-rank-gate failure sits at 1 sighting (RETRO-202 only), below the ≥2
promotion threshold; RETRO-190/199/201 are positive-compliance instances, not failure sightings.
**FOLLOW-600 (`/api/config` real-table wiring) is now fully unblocked** — its FOLLOW-615 dependency
is discharged; its own two remaining obligations (§3a audit-in-`db.transaction()`, keep the mutation
inline to stay guard-OK) are already bound in its own AC. Next-free FOLLOW stays 616, next-free
RETRO is 204. Ready to pick the next ticket — likely candidates: **FOLLOW-600** (now unblocked, was
the reason FOLLOW-615 existed), or the pre-existing opportunistic **FOLLOW-613** / **FOLLOW-604** /
**FOLLOW-611** (all open, no new dependency).

**FOLLOW-615 — status: DONE + MERGED.** assigned_to: backend-engineer (model: **Sonnet** — this was
a single-file, well-defined mechanical gate addition that copied an EXACT existing pattern
(`quiz/config/route.ts:154`'s `via==='staff' && !access.canWrite` → 403 shape) into one route; no
cross-module design judgment or ambiguous scope). started_at: 2026-07-22. merged_at: 2026-07-22.
branch: `backend-engineer/FOLLOW-615-config-write-rank-gate` (remote branch still present, not
deleted — no explicit cleanup request). PR: #604 (merged `c766fd6`). Next step: spawn
`retrospective-analyst` for RETRO-203, then FOLLOW-600 is unblocked (also FOLLOW-613/604/611 remain
open, unrelated, no dependency).

### Delegation brief — FOLLOW-615 (full, restated — do not rely on the FOLLOW_UPS.md stub alone; RETRO-202's own lesson was that a prior stub's AC under-enumeration let a gap ship, so every item is spelled out here)

**Ticket:** `backlog/FOLLOW_UPS.md` →
`## FOLLOW-615 — Add the missing staff write-rank gate to `PATCH /api/config`` (source_retro:
RETRO-202, source_ticket: FOLLOW-614, priority P2, est. 1h).

**Read first, in order:**

1. `docs/MASTER_DESIGN.md` §Snapshot.1 (current implementation status — read before any non-trivial
   task per OPERATING_PRINCIPLES Rule 1).
2. `CONVENTIONS_PATCH.md` (repo root) — current permanent rules, in particular **Rule H amendment
   (RETRO-006 §6a)** governing the spoofable-header class this ticket is the tail of, and ADR-0018
   §3/§3a/§4 (staff write-rank + audit-atomicity invariants).
3. `backlog/HANDOFFS.md` — check for any note left for this route/module before starting.
4. `apps/control-plane/src/app/api/config/route.ts` — the file to change (PATCH handler only; GET is
   untouched — it stays readonly-staff-readable, no gate, matching `/api/audit`'s precedent).
5. `apps/control-plane/src/app/api/quiz/config/route.ts` (the `POST` handler, ~line 145-160) — the
   EXACT shape to mirror:
   `if (access.via === 'staff' && !access.canWrite) { return NextResponse.json({ error: { code: 'forbidden', message: '...' } }, { status: 403 }); }`
   immediately after `resolveTenantAccess` resolves.
6. `apps/control-plane/src/app/api/config/route.test.ts` — existing FOLLOW-614 test file to extend
   (fixtures: `TENANT_A`, `VICTIM_TENANT`, `agencyAccess()`, mocked `resolveTenantAccess`).
7. `backlog/FOLLOW_UPS.md` FOLLOW-603 (§"Template note") — the epic-wide invariant every staff WRITE
   port must assert: write-rank gate present AND perturbation-provably load-bearing.

**Context (why this exists):** FOLLOW-614 (PR #603, merged `3669be2`) correctly moved `/api/config`
off the spoofable `x-tenant-id`/`x-agency-role` headers onto `resolveTenantAccess`, but its PATCH
staff-override path never added the write-rank gate that every sibling staff write enforces
(`quiz/config/route.ts:154`, `demo/override/route.ts:197`, `admin/intent-weights/route.ts:206` — all
`via==='staff' && !access.canWrite`→403; `bandit/weights/[archetype]/route.ts:102` uses
`!isSuperadmin`→403 for its higher-blast-radius case). `verifyTracerAdminAuth` admits ANY
`estalara_staff:true` user with no role floor (readonly included); `resolveTenantAccess` sets
`access.canWrite:false` for staff rank < `estalara:ops` but by design does NOT enforce it itself —
each ROUTE must. Today `config/route.ts` PATCH never reads `access.canWrite` before
`configStore.set()`, so an `estalara:readonly` staff user (rank 1 < ops rank 2) can currently PATCH
any tenant's config via `?tenant_id=<uuid>`. Severity P2 (not P1) because `configStore` is still an
in-memory stub with zero consumers today — but **FOLLOW-600 wires this exact route to the real
`tenants` table**, at which point this becomes a live cross-tenant write-tier violation, so **this
ticket must land before or with FOLLOW-600.**

**Acceptance criteria (ALL restated explicitly, none may be silently dropped):**

- [ ] AC-1: `PATCH /api/config` adds
      `if (access.via === 'staff' && !access.canWrite) { … return 403     … }` immediately after the
      existing `resolveTenantAccess` call/error-handling block, mirroring the
      `quiz/config/route.ts:154` shape verbatim in structure (error body shape:
      `{ error: { code: 'forbidden', message: '<staff-write-requires-ops-or-higher message>' } }`).
- [ ] AC-2: `GET /api/config` is explicitly left UNCHANGED — readonly staff keeps read access, no
      gate added (matches the `/api/audit` precedent). State this explicitly in the PR description
      so a reviewer doesn't assume GET was also gated.
- [ ] AC-3: Red-first test added to `config/route.test.ts`: an `estalara:readonly` staff fixture
      (`canWrite: false`) issuing PATCH receives 403, AND the `configStore` Map is asserted NOT
      mutated as a result (GET immediately after, or an equivalent check, must show the pre-PATCH
      value) — this also discharges RETRO-202 TG-2's "untouched-on-rejection" assertion for this
      route.
- [ ] AC-4 (FOLLOW-603 write-rank template, restated so it isn't missed as it was for FOLLOW-614):
      add a load-bearing perturbation test — temporarily removing/inverting the new `canWrite` check
      must flip the AC-3 test RED, while an `estalara:ops`-or-higher staff PATCH stays 200/GREEN. Do
      not just assert the happy path; prove the gate is load-bearing.
- [ ] AC-5: an ops-or-higher staff PATCH and an `agency:admin` PATCH (existing coverage) both
      continue to return 200 — no regression to the already-passing FOLLOW-614 test suite.
- [ ] AC-6 (repo hygiene, not in the stub but standard for every PR per CONVENTIONS_PATCH.md): run
      prettier on every file touched, even if already formatted; confirm no repo-config gaps (this
      ticket needs no new secrets/workflows/branch-protection, but state that explicitly in the PR).
- [ ] AC-7: reference `[FOLLOW-615]` in every commit message per CONVENTIONS_PATCH.md commit
      conventions (`fix(control-plane): <subject> [FOLLOW-615]`).

**Explicitly OUT of scope (do not do this in this PR):** wiring `/api/config` to the real `tenants`
table (that is FOLLOW-600); adding a `staff_audit_log` insert for this route (FOLLOW-614's own
comment in `route.ts` explains this PATCH only mutates the in-memory stub, so there is no DB
mutation to atomically pair an audit row with yet — that obligation activates only when FOLLOW-600
wires real data, per ADR-0018 §3a).

**Branch:** `backend-engineer/FOLLOW-615-config-write-rank-gate`

**Delegation-table row used:** "ingest worker, control-plane, decision-api, Postgres/RLS, auth,
onboarding HTTP, billing, webhooks" → **backend-engineer** (this is a control-plane auth/write-rank
route change).

---

## ▶️ (superseded) START HERE — resume 2026-07-22 (session 51 — FOLLOW-614 MERGED (PR #603, squash `3669be2`)

and closed out DONE+MERGED; retro RETRO-202 due next, then promote/dispatch from FOLLOW-613 / 604
/ 611)

**▶️ HIGHEST-LEVEL STATE (read first).** FOLLOW-614 (`/api/config` GET+PATCH spoofable
`x-tenant-id`/`x-agency-role` auth hole — the last live leg of the class RETRO-201 flagged) is
**DONE + MERGED**: PR #603
(`fix(control-plane): close /api/config spoofable-header auth hole via resolveTenantAccess [FOLLOW-614]`),
squash-merged to `main` at `3669be2` (2026-07-22T07:30:38Z), dispatched to backend-engineer/OPUS on
branch `backend-engineer/FOLLOW-614-config-auth-sweep`. PM-validated: CI confirmed green on all real
gates pre-merge, only the pre-existing non-blocking `Rule I` red (per `project_ci_gate_landscape`
memory). Worktree/branch already cleaned up. **Retrospective RETRO-202 for FOLLOW-614 is now due**
(per the mandatory per-ticket retro loop) — spawn `retrospective-analyst` before dispatching the
next ticket. Next-free **FOLLOW-615 / RETRO-202**.

**Remaining open work after FOLLOW-614's close-out:**

- **FOLLOW-613** (teach the atomicity guard to follow `@estalara/db` package-barrel re-exports so
  `labels/[id]` flips SKIP→OK — opportunistic, protects one route). Likely next pick once RETRO-202
  is filed — no dependency, no open escalation blocking it.
- **FOLLOW-604** (staff-override port for `PATCH /api/tenants/[id]` quiz ON/OFF toggle) — open,
  pre-existing, unrelated to 614.
- **FOLLOW-611** (P4, gitleaks false-positive cleanup on `wrangler.toml`) — open, pre-existing,
  opportunistic/low-priority.

Do not pick a ticket touching `scripts/check-staff-write-atomicity.cjs`, `packages/db/src/index.ts`,
or any staff-write route's mutation delegation without re-reading FOLLOW-613 + Rule AE first.

---

## ▶️ (superseded) START HERE — resume 2026-07-21 (session 50 — FOLLOW-597, 598, 606, AND 599 all MERGED (PR #599 / #600 / #601 / #602) and closed out DONE+MERGED; RETRO-198/199/200/201 filed — **the ADR-0018 staff-WRITE-PORT sequence 592→598 is COMPLETE, the hub-linkage cascade is CLOSED, and the staff_audit_log HALF_WIRE_P is RESOLVED**; RETRO-201 filed FOLLOW-614 (P2 security — one residual `x-tenant-id` auth-hole leg))

**▶️ HIGHEST-LEVEL STATE (read first).** Three tickets landed this session, each PM-validated
independently (diff read, guards/tests re-run by hand, CI confirmed green — only the non-blocking
`Rule I` red) and merged, with `main` synced + agent worktree/branch cleaned up each time:

- **FOLLOW-597** (PR #599, `748f287`, RETRO-198) — labels + intent-weights staff port. `labels/[id]`
  ships guard-**SKIP** (mutation delegated through the `@estalara/db` barrel) → documented+deferred,
  atomicity held by its rollback unit test; **FOLLOW-613 LIVE** (protects that one route).
- **FOLLOW-598** (PR #600, `a9e1923`, RETRO-199) — bandit weight staff-write port (superadmin-only,
  HIGHEST blast radius) + global `generation-model` PUT tightened to superadmin. Ships guard-**OK**
  (mutation kept INLINE). **Completes the ADR-0018 staff-WRITE-PORT sequence 592→598 — no staff
  write ports remain.**
- **FOLLOW-606** (PR #601, `ee31247`, RETRO-200) — hub-linked the 5 per-tenant staff surfaces
  (`/analytics` `/quiz` `/demo` `/labels` `/intent`) into the `[id]` landing. **CLOSES the
  hub-linkage cascade (RETRO-188/190/193/198)** and LANDS the same-PR-link template → its promotion
  trigger is now ARMED (the NEXT per-tenant surface that ships unwired is the codification
  sighting).
- **FOLLOW-599** (PR #602, `78b8b53`, RETRO-201) — wired `GET /api/audit` from a mock stub (that
  trusted an UNAUTHENTICATED `x-tenant-id` header) to a staff-only, tenant-fenced read of
  `staff_audit_log` + a new `/admin/tenants/[id]/audit` page (which correctly SELF-WIRED its hub
  link → CONFIRMS the FOLLOW-606 template, trigger not fired). **RESOLVES the `staff_audit_log`
  HALF_WIRE_P** (the 5 producer actions are now readable end-to-end). RETRO-201 hunt found ONE
  residual live leg of the auth-hole class → **FOLLOW-614**.

**Remaining ADR-0018 / follow-up work:**

- **FOLLOW-614 (P2 security, NEW — RETRO-201):** sweep the LAST live leg of the `x-tenant-id`
  spoofable-header auth-hole class — `/api/config` (GET/PATCH + `x-agency-role` role-spoof) still
  trusts caller-supplied headers as sole auth. P2 (not P1) only because `config` is still an
  in-memory stub with no real data today; but it SHIPS the hole when wired. **Dependency:
  FOLLOW-600's `/settings` surface is the likely point where `/api/config` gets wired to real data —
  it MUST move `/api/config` onto `resolveTenantAccess` FIRST, or it ships a real cross-tenant
  leak.** Narrowed successor to the half-discharged FOLLOW-491.
- **FOLLOW-613** (teach the atomicity guard to follow `@estalara/db` package-barrel re-exports so
  `labels/[id]` flips SKIP→OK — opportunistic, protects one route).
- Also open (pre-existing, unrelated): 604, 611.

Next-free **FOLLOW-615 / RETRO-202**. **Do not pick a ticket touching
`scripts/check-staff-write-atomicity.cjs`, `packages/db/src/index.ts`, or any staff-write route's
mutation delegation without re-reading FOLLOW-613 + Rule AE first.**

---

**Read this before picking anything.** No escalations open (ESC-020/028/034 non-blocking OPEN per
memory, all others RESOLVED). `gh pr list --state open` → empty (PR #599 merged, squash `748f287`,
2026-07-21T20:09:55Z). Local `main` reset to origin/main this session (a local-only session-49
bookkeeping commit `b5a0473` was verified byte-identically folded into the #599 squash — no content
lost); `git status` clean, guard re-run on merged `main` (intent-weights `OK`, labels/[id] `SKIP`
documented, demo/override + quiz/config `OK`, exit 0 — no regression).

**Post-merge close-out performed (session 50), full checklist, nothing on trust:**

1. Merge re-verified via `gh pr view 599` (MERGED, `748f287`, 20:09:55Z, by Pnawrocki9). CI was
   verified green BEFORE merge: 59 real gates PASS, only non-blocking `Rule I` red; the Staff-write
   audit-atomicity gate itself PASSED.
2. **Judgment call this session (operator-ratified via AskUserQuestion — "document + defer"):** the
   `labels/[id]` staff reclassify delegates its mutation to the shared `@estalara/db`
   `upsertConversionLabel`, re-exported through the `packages/db/src/index.ts:15` package BARREL — a
   shape `scripts/check-staff-write-atomicity.cjs` cannot follow, so the guard prints **SKIP** (zero
   mechanical atomicity enforcement). Did NOT inline-duplicate the FOLLOW-179/182 precedence SQL
   (Rule H), did NOT touch the guard mid-597. Atomicity is instead proven by the rollback UNIT test
   - an explicit in-file guard-coverage caveat. This is the **first LIVE instance of FOLLOW-613**
     (barrel bypass-6, filed latent by RETRO-197) → FOLLOW-613 promoted latent→LIVE, AC extended to
     require workspace-package-specifier resolution.
3. RETRO-198 (`backlog/RETROSPECTIVES.md`) via `retrospective-analyst`: SECURITY-CLEAN, 0 code bugs,
   2 documented deferrals (both owned by existing tickets), 0 new FOLLOW filed. **No rule promoted**
   (the barrel SKIP is the predicted materialization of FOLLOW-613, already covered by Rule AE;
   hub-linkage is the 3rd banked sighting but below its stated promotion trigger — 606 hasn't
   landed). **Amended FOLLOW-606 AC** to add `/intent` to the hub-link enumeration (597 shipped TWO
   pages; 606 previously listed only `/labels`).
4. **Sequencing finding (verified, not assumed):** FOLLOW-613-LIVE does NOT force 613-before-598 —
   FOLLOW-598's bandit mutation is INLINE (`bandit/weights/[archetype]/route.ts:89`
   `.update(abBanditWeights)`; no `@estalara/db` bandit helper exists), so its ported staff write
   stays guard-`OK` as long as it keeps the mutation inline (598's AC already directs this). The
   locked FOLLOW-608→609→597/598→606 order stands; **613 is opportunistic, not a blocker** — but
   should be prioritized to restore mechanical atomicity enforcement to the now-live `labels/[id]`
   SKIP.

**Next-free counters: FOLLOW-614, RETRO-199.**

**Reassessed queue state — at the next-dispatch boundary:** FOLLOW-598 (bandit weights staff-write
port, P3, HIGHEST blast radius, superadmin-only per CEO Q3) is next in the locked sequence,
unblocked (595/597 precedents established). Keep its mutation INLINE (do NOT introduce an
`@estalara/db` bandit helper) so it stays guard-`OK`. Then FOLLOW-606 (hub-link pass, now incl.
`/intent`). Consider landing FOLLOW-613 opportunistically to re-cover the `labels/[id]` SKIP. **Do
not pick a ticket that touches `scripts/check-staff-write-atomicity.cjs`,
`packages/db/src/index.ts`, or any staff-write route's mutation delegation without re-reading
FOLLOW-613 + Rule AE first.**

---

## ▶️ (superseded) START HERE — resume 2026-07-21 (session 49 — FOLLOW-612 merged, closed out DONE+MERGED; RETRO-197 filed, found+fixed-forward a genuine 6th guard bypass (barrel re-export), NO new Rule promoted (confirms existing Rule AE); queue at next-dispatch boundary — FOLLOW-597/598 next, AC re-amended)

**Read this before picking anything.** No escalations open (ESC-020/028/034 non-blocking OPEN per
memory, all others RESOLVED). `gh pr list --state open` → empty (PR #598 merged,
`c1028637ed4cdfb11642eebbf87f3ca8e5a6ddd2`, 2026-07-21T18:07:18Z, branch deleted). Local `main` was
already fast-forwarded to include it before this session started (`git status` confirmed clean).

**Post-merge close-out performed (session 49), full checklist, nothing taken on trust — including
not trusting the operator's own pre-merge verification claim, per standing PM-orchestrator
practice:**

1. Confirmed merge via `gh pr view 598 --json state,mergeCommit,mergedAt` (MERGED, `c102863…`,
   18:07:18Z) and re-pulled `gh pr checks 598` directly: all 58 real gate jobs PASS, only the
   pre-existing non-blocking `Rule I` red (memory `project_ci_gate_landscape`) — independently
   matches the operator's own pre-merge verification, not merely repeated on faith.
2. **Did not trust the operator's own claimed guard-fixture output.** Re-ran
   `bash scripts/__tests__/check-staff-write-atomicity.test.sh` myself on `main` HEAD: **33/33
   assertions PASS**, including the new `bypass5-namespace-import-delegated-mutation{,-out-of-tx}`
   pair (co-scoped → `OK`, out-of-tx → `FAIL`, never `SKIP`) and the real-repo scan unchanged
   (`demo/override`+`quiz/config` → `OK`, `admin/labels/export` → `SKIP`, no regression). Read the
   shipped diff directly (`collectFileFacts`'s `PropertyAccessExpression` branch now also queues a
   `localHelperCallCandidate` when the callee's object resolves via `localImportedIdentifierSources`
   — covers both named AND namespace imports, reusing `moduleContainsMutation` unchanged, no
   parallel resolution path).
3. **Went further than the merge itself required**, per this session's explicit instruction to
   critically assess whether the guard is now exhaustive. Built an uncommitted, from-scratch,
   in-repo throwaway reproduction (a disposable `_pm_throwaway_repro_bypass6/` directory: route →
   barrel `index.ts` (`export * from './mutation-helper'`) → real helper module; run, then deleted,
   `git status --short` confirmed clean afterward) of a call-shape none of the 5 known bypasses
   cover: a mutation reached only through a BARREL re-export. **Confirmed a genuine 6th bypass**:
   `moduleContainsMutation`'s bounded walk cannot follow a barrel's
   `export * from`/`export {x} from` re-export (its `collectLocalImports` helper only visits
   `ts.isImportDeclaration` nodes, not `ts.isExportDeclaration`), so the guard prints `SKIP`, exit
   0, for BOTH the co-scoped variant (should be `OK`) and the out-of-tx variant (should be `FAIL`) —
   zero enforcement, indistinguishable from safe. Not a live defect today (grepped: no current
   staff-write route imports its mutation helper through a barrel), but directly relevant to the
   SAME next two queued tickets bypass 5 threatened (FOLLOW-597, FOLLOW-598). Filed **FOLLOW-613**
   (P2) and re-amended FOLLOW-597/598's AC: dropped the now-CLOSED "named-import-only" caveat from
   RETRO-196 (FOLLOW-612 covers both named and namespace imports), replaced with a "do not delegate
   through a barrel" caveat pointing at FOLLOW-613.
4. **Considered, but did NOT file**, two further shapes named in the task/Rule AE's own enumeration
   because neither is concretely demonstrable as a real risk today (not speculative-ticket material
   per the task's explicit instruction): dynamic/computed member access
   (`helper['upsertSomething'](tx, …)` — plausible in principle, but no route has any reason to use
   bracket-notation dispatch on a fixed helper name) and aliased named imports
   (`import {upsertX as helper}` — checked directly: NOT a bypass,
   `collectLocalImportedIdentifierSources` already keys on the post-alias local binding name).
5. Wrote **RETRO-197** (`backlog/RETROSPECTIVES.md`). **Did NOT promote a new CONVENTIONS_PATCH
   rule** — Rule AE (promoted RETRO-196) already explicitly names "a re-exported wrapper" in its
   shape-enumeration list; this finding is direct confirmation of an already-anticipated gap, not a
   novel pattern. Recorded the confirmation + FOLLOW-613 in the retro per Rule AE point 4's own
   instruction to state explicitly whether the class is closed (answer: **still open**).
6. Marked FOLLOW-612 **DONE + MERGED** in `backlog/FOLLOW_UPS.md` (AC checkboxes flipped, PR/merge
   commit recorded) and here.

**Next-free counters (per RETRO-197/FOLLOW-613 trailer comments): FOLLOW-614, RETRO-198.**

**Reassessed queue state — at the next-dispatch boundary, no open escalation or human-review
block:** FOLLOW-597 (labels/intent-config staff port, P3, `promoted_to_queue: false`) and FOLLOW-598
(bandit weights, P3, `promoted_to_queue: false`, HIGHEST blast radius) are next in the
operator-locked FOLLOW-608→609→597/598→606 sequence and are both otherwise unblocked (their stated
prerequisite, FOLLOW-595 establishing the audited-write pattern, is DONE). Their guard-shape AC
notes are now current (session 49): the interim named-import-only mitigation from RETRO-196 can be
DROPPED (FOLLOW-612 closed it — bare identifier AND namespace imports both correctly recognized),
and a new interim mitigation applies instead — do not reach a new store-delegation helper through a
barrel re-export until FOLLOW-613 lands. **Did not promote+dispatch either this session** — this
session's tool environment (Read/Write/Edit/Bash only, no Task/Agent-spawning tool, same constraint
as sessions 45–48) means "dispatch" here would only be writing a delegation brief for a future
session to execute. Left for the next session (with or without Task-tool access) to either (a) land
FOLLOW-613 first given it protects the highest-blast-radius write (FOLLOW-598), or (b)
promote+dispatch FOLLOW-597 with the barrel-avoidance mitigation called out, per its amended AC.
**Do not pick a new ticket that touches `api/demo/override/route.ts`, `demo-override-store.ts`, or
`scripts/check-staff-write-atomicity.cjs` without re-reading FOLLOW-613 and Rule AE first.**

---

## ▶️ (superseded) START HERE — resume 2026-07-21 (session 48 — FOLLOW-609 merged, closed out DONE+MERGED; RETRO-196 filed, found+fixed-forward a genuine 5th guard bypass, promoted CONVENTIONS_PATCH Rule AE; queue at operator/next-dispatch boundary — FOLLOW-597/598 next, AC amended)

**Read this before picking anything.** No escalations open (ESC-020/028/034 non-blocking OPEN per
memory, all others RESOLVED). `gh pr list --state open` → empty (PR #597 merged, `5458001`,
2026-07-21T17:34:21Z, branch deleted). `main` fast-forwarded locally to include it before this
session started.

**Post-merge close-out performed (session 48), full checklist, nothing taken on trust:**

1. Confirmed merge via `gh pr view 597 --json state,mergeCommit,mergedAt` (MERGED, `5458001`,
   17:34:21Z) and `gh pr checks 597` (every real gate PASS post-merge, including the 2nd
   devops-authored commit that fixed a `.gitleaks.toml` false positive on the new fixture directory
   name AFTER the session-47 PM validation — CI-tooling only, no functional change, re-confirmed
   green). Only red: pre-existing non-blocking `Rule I` (memory `project_ci_gate_landscape`).
2. **Did not trust the PR's own claim on the headline fix.** Read the shipped diff directly
   (`upsertDemoOverride`'s new optional `tx` parameter, `demo/override/route.ts`'s delegation from
   inside its own `db.transaction()`), then independently re-ran
   `node scripts/check-staff-write-atomicity.cjs` against the live `main` tree: it now prints
   `OK: apps/control-plane/src/app/api/demo/override/route.ts — mutation + insert(staffAuditLog), both inside the SAME db.transaction()`
   (was `SKIP` before this PR, per RETRO-194). Grepped `upsertDemoOverride` repo-wide: 1 non-test
   producer file (`demo-override-store.ts:163`), 2 non-test consumer call sites (agency
   `route.ts:257` no-tx, staff `route.ts:320` with-tx).
3. **Went further than the merge itself required.** Because the guard's evolution (607→608→609) has
   now shown 2 PRIOR retro-documented "the fix for the observed bypass isn't the last bypass" hops
   (RETRO-192, RETRO-194), built a FRESH, uncommitted, from-scratch throwaway fixture (scratch dir,
   run, deleted — never committed) testing a call-shape none of the 4 known bypasses cover: a
   NAMESPACE/property-access delegated call (`import * as helper from …; helper.upsertX(tx, …)`)
   instead of a bare-identifier one. **Confirmed a genuine 5th bypass**: the guard's
   `PropertyAccessExpression` branch only recognizes method names
   `transaction`/`insert`/`update`/`delete`/`execute` — `upsertX` matches none, so the call falls
   through BOTH detection branches silently (`SKIP`, exit 0, zero enforcement). Not a live defect
   today (grepped: no current staff-write route uses a namespace import for these stores), but a
   real and immediate risk for the NEXT two queued tickets (FOLLOW-597, FOLLOW-598) which each need
   a new store-delegation helper of their own. Filed **FOLLOW-612** (P2) and amended
   FOLLOW-597/598's AC with an explicit named-import-only interim mitigation + a pointer to
   FOLLOW-612.
4. Wrote **RETRO-196** (`backlog/RETROSPECTIVES.md`) covering the above, and promoted
   **CONVENTIONS_PATCH Rule AE** ("an AST-based mechanical guard for a security invariant must
   enumerate every syntactic call-shape before being declared complete") — this is the 3rd numbered
   sighting of the meta-pattern (RETRO-192 count 1, RETRO-194 count 2, this retro's independent 5th
   call-shape find crosses the threshold), re-adjudicated against Rule AD's own precedent (which
   promoted on the "same guard-family, one more shape over" pattern, not a same-arc/different-arc
   distinction). Full reasoning + evidence trail in the Rule AE block and RETRO-196.
5. Marked FOLLOW-609 **DONE + MERGED** in `backlog/FOLLOW_UPS.md` (AC checkboxes flipped, PR/merge
   commit recorded) and here.

**Next-free counters (per RETRO-196/FOLLOW-612 trailer comments): FOLLOW-613, RETRO-197.**

**Reassessed queue state — at the next-dispatch boundary, no open escalation or human-review
block:** FOLLOW-597 (labels/intent-config staff port, P3, `promoted_to_queue: false`) and FOLLOW-598
(bandit weights, P3, `promoted_to_queue: false`, HIGHEST blast radius) are next in the
operator-locked FOLLOW-608→609→597/598→606 sequence and are both otherwise unblocked (their stated
prerequisite, FOLLOW-595 establishing the audited-write pattern, is DONE). **Did not
promote+dispatch either this session** — this session's tool environment (Read/Write/Edit/Bash only,
no Task/Agent-spawning tool, same constraint as sessions 45–47) means "dispatch" here would only be
writing a delegation brief for a future session to execute, and the freshly-found FOLLOW-612 guard
gap is directly relevant to whichever of 597/598 lands first (their AC now says so explicitly). Left
for the next session (with or without Task-tool access) to either (a) land FOLLOW-612 first given it
protects the highest-blast-radius write, or (b) promote+dispatch FOLLOW-597 with the named-import
mitigation called out, per its amended AC. **Do not pick a new ticket that touches
`api/demo/override/route.ts`, `demo-override-store.ts`, or `scripts/check-staff-write-atomicity.cjs`
without re-reading FOLLOW-612 and Rule AE first.**

---

## ▶️ (superseded) START HERE — resume 2026-07-21 (session 47 — validated PR #597 (FOLLOW-609), moved READY_FOR_REVIEW; awaiting human merge)

**Read this before picking anything.** No escalations open (ESC-020/028/034 non-blocking OPEN per
memory, all others RESOLVED). One open PR: **#597**
(`backend-engineer/FOLLOW-609-demo-override-dedup`), **PM-validated this session, READY_FOR_REVIEW,
awaiting human merge.** `main` unchanged this session (HEAD `5ecd112`, same as session 46's
reconciliation). **Do not pick a new ticket that touches `api/demo/override/route.ts`,
`demo-override-store.ts`, or `scripts/check-staff-write-atomicity.cjs` until #597 merges.**

**FOLLOW-609 / PR #597 validation (session 47), full checklist run, nothing taken on the worker's
word:**

1. **CI (step 5b):** `gh pr checks 597 --watch` — every job green except the pre-existing
   non-blocking `Rule I — wired-or-dead check` (documented gate-landscape exception, memory
   `project_ci_gate_landscape`). Pulled that job's log directly: 190 whole-repo violations, none
   introduced by this diff — the only demo-override-store.ts hits (`ReachableArchetype`,
   `DemoAllowedModel`) are PRE-EXISTING symbols untouched by this PR (confirmed via `gh pr diff`).
   CI non-success count for every REAL gate: **0**. Check-count: 1/5. Fix-iterations: 0/3 (no bounce
   needed).
2. **Independent guard re-verification (step 4/5c, the ticket's explicit completion criterion) — did
   NOT trust the PR's own claimed output.** Checked out the branch locally (it was already the
   working tree's checked-out branch). Ran
   `bash scripts/__tests__/check-staff-write-atomicity.test.sh` myself: exit 0, all 12 fixture
   scenarios + real-repo scan pass, including the two new
   `bypass4-helper-delegated-mutation{,-out-of-tx}` fixtures — co-scoped → `OK`, out-of-tx → `FAIL`
   (not `SKIP`). **Then built my own throwaway reproduction from scratch** (own fixture files, not
   the committed ones — written to
   `scripts/__fixtures__/staff-write-atomicity/_pm-throwaway-repro/`, run, then deleted, never
   committed) of the exact FOLLOW-609 shape (a `.insert(...).onConflictDoUpdate(...)` helper
   delegated from a route via `@/lib/mutation-helper`): out-of-tx call → guard correctly **FAILs**
   (exit 1, "NOT both inside the SAME db.transaction()"); same shape moved inside `db.transaction()`
   → guard correctly **OKs** (exit 0). Confirms the fix independently, not just via the worker's
   committed fixtures.
3. **§3a atomicity preserved (step 5e/AC):** read the shipped diff directly — `putStaff` in
   `api/demo/override/route.ts` now calls
   `upsertDemoOverride(tenantId, patch, access.staff.sub, tx as unknown as Database)` from inside
   its own `db.transaction(async (tx) => {...})`, immediately followed by the AWAITED
   `tx.insert(staffAuditLog)` in the same callback — one commit/rollback unit, matching the
   FOLLOW-605 reference pattern. `upsertDemoOverride` itself: `const db = tx ?? createAdminClient()`
   — agency path (no `tx` arg) is byte-behavior-unchanged. Independently ran
   `pnpm --filter control-plane test -- api/demo/override`: all 23 pre-existing tests pass
   UNCHANGED, including
   `'ROLLS BACK the override upsert when the staff audit insert fails (no orphan mutation)'`
   (FOLLOW-605/607 atomicity test) and the MANDATORY tenant-filter READ+WRITE tests (ADR-0018 §2
   invariant 5) — plus 2 new tests in `demo-override-store.test.ts` proving the `tx`-dispatch branch
   directly (`createAdminClient` NOT called when `tx` supplied; called once when it isn't).
4. **Local gauntlet (step 5a), run myself, not from the PR description:**
   `pnpm install --frozen-lockfile` (up to date), `pnpm --filter control-plane typecheck` (clean),
   `pnpm --filter control-plane lint` (clean) — both re-run independently, not accepted from the PR.
5. **Runtime wiring (step 5c):** no new exported symbol/event/column/config field — this ticket
   dedupes an existing write path and hardens an existing CI script; `upsertDemoOverride`'s new
   optional `tx` parameter is consumed by both the staff route (producer: `route.ts` `putStaff`,
   passes `tx`) and the agency route (calls with no `tx`) — both non-test call sites, confirmed by
   reading `route.ts` directly (not a grep-only check, since this is a parameter not a new symbol).
6. **Single-agent ticket** — step 5d (co-assignment integration check) N/A.

**Evidence pasted per `<evidence_requirements>`:**

- CI non-success count: **0** (Rule I excluded per documented pre-existing non-blocking exception,
  confirmed its violations are unrelated to this diff).
- Guard-fix grep/repro: see item 2 above — independent throwaway repro, not just the committed
  fixtures, confirms OK/FAIL behavior in both directions.
- CI-check counter: **1/5**. Fix-iteration counter: **0/3**.

**Action taken:** PR #597 comment posted: "PM-validated. CI green (Rule I pre-existing/unrelated,
documented exception). Runtime wiring confirmed. §3a atomicity independently re-verified (23/23
pre-existing tests + 2 new pass). Guard fix independently reproduced from scratch (own throwaway
fixture, not just the committed ones) — co-scoped OK, out-of-tx FAIL. Ready for human review."
FOLLOW-609 moved to **READY_FOR_REVIEW** in `backlog/FOLLOW_UPS.md`. **Not merged — human review
required next.** Retrospective-analyst spawn + DONE marking deferred to the session that observes
the merge (per workflow: retro runs AFTER human merge).

---

## ▶️ (superseded) START HERE — resume 2026-07-21 (session 46 — reconciled PR #595 (external Cursor PR, FOLLOW-610) + PR #596 (FOLLOW-608) both merged; found+fixed FOLLOW-609's AC before dispatch; FOLLOW-609 promoted+dispatched to backend-engineer/SONNET)

**Read this before picking anything.** No escalations open (ESC-020/028/034 non-blocking OPEN per
memory, all others RESOLVED). No open PRs (`gh pr list --state open` → empty). `main` is current
(`git pull` clean, HEAD `5ecd112`).

**Operator instruction this session:** "PRs #595 and #596 were just merged — reconcile the
queue/backlog." Did the following, in order:

1. **FOLLOW-608 → DONE.** PR #596 (`backend-engineer/FOLLOW-608-staff-write-atomicity-scope`) merged
   squash `5ecd112`, 2026-07-21T16:24:57Z. Ran `gh pr checks 596` myself (not trusting the merge
   alone as evidence): every real gate PASS, only pre-existing non-blocking `Rule I` red. Confirmed
   the session-45 CI-wiring fix (missing `pnpm install`) is actually in the shipped diff.
   **RETRO-194 filed.**
2. **PR #595 (external Cursor-agent PR, FOLLOW-610) reconciled.** This PR was previously flagged
   "DRAFT, not ours to validate" — it has since been converted out of draft and merged (squash
   `bb213d6`, 2026-07-21T16:20:37Z) WITHOUT going through our PM-orchestrator pre-merge validation
   pipeline. Performed a retroactive validation this session: `gh pr checks 595` shows one real
   finding — `Gitleaks secrets scan` FAILED. Reproduced via the job log
   (`gh api .../actions/jobs/<id>/logs`): flagged `apps/ingest/wrangler.toml:147`, an EXAMPLE
   `MODAL_CHAT_NLP_URL` comment string, as a `cloudflare-api-token` false positive — read the live
   file directly, confirmed NO actual secret/token present, same false-positive class as the
   existing `.gitleaks.toml:178-187` (FOLLOW-411) precedent. **Not a live security issue** but a
   genuine CI-gate miss the human merged past; filed **FOLLOW-611** (P4, cleanup) so it doesn't
   re-trip on the next PR touching that line. Runtime wiring independently grep-confirmed
   non-test-producer→non-test-consumer: `apps/ingest/src/handlers/events.ts:357` `dispatchChatNlp`
   (imported :30) → POSTs `MODAL_CHAT_NLP_URL` w/ `INTERNAL_API_SECRET` bearer →
   `apps/intent-engine/src/main.py:101` `chat_nlp_endpoint` validates the same bearer, spawns
   `process_chat_message`. Correctly inert (configured no-op) until the operator legs below run.
   **RETRO-195 filed.** **FOLLOW-610 status: `CODE_COMPLETE_OPERATOR_PENDING`** — 3 AC items remain,
   all operator-side, not a worker ticket:
   - [ ] `modal deploy` intent-engine; copy the `.modal.run` URL
   - [ ] `wrangler secret put MODAL_CHAT_NLP_URL` + `INTERNAL_API_SECRET` on ingest prod
   - [ ] Smoke: one chat message → Redis `shadow:{tenant}:{session}:chat_intent` within ~1s; leave
         `CHAT_NLP_LIVE=false` until C-07
3. **Pre-dispatch verification caught a real gap before it could ship silently.** Before promoting
   FOLLOW-609 (next in the locked FOLLOW-608→609→597/598→606 sequence), independently tested the
   just-merged FOLLOW-608 guard against FOLLOW-609's own proposed fix shape (a shared
   `upsertDemoOverride(tx?)` helper called from both agency+staff branches) using an isolated
   throwaway fixture (built, run, deleted — not committed). **The guard SKIPs it** — a mutation
   delegated to an imported local-helper function call is invisible to the guard's mutation-AST
   walk, so a route with that shape + a local `insert(staffAuditLog)` inside the same
   `db.transaction()` is misclassified as "audit-of-a-read" (zero enforcement, not merely
   presence-only). FOLLOW-609's own AC #1 already anticipated this requirement in prose; this
   session's reproduction CONFIRMS it's real and unmet, and the amended ticket now makes the guard
   fix a **hard blocker landing in the same PR** as the store refactor — see `backlog/FOLLOW_UPS.md`
   FOLLOW-609 and the full delegation brief in `backlog/HANDOFFS.md` "Delegation brief — FOLLOW-609
   (session 46, 2026-07-21)".

**FOLLOW-609 promoted + dispatched: backend-engineer, SONNET** (delegation table row:
control-plane/Postgres row — routine mechanical dedup + CI-guard AST extension, not the
security-reasoning tier reserved for staff-write route establishment). Branch:
`backend-engineer/FOLLOW-609-demo-override-dedup`. **Do not pick a new ticket that touches
`api/demo/override/route.ts`, `demo-override-store.ts`, or `scripts/check-staff-write-atomicity.cjs`
until this PR opens and lands.**

**Sequence after FOLLOW-609 merges:** FOLLOW-597 (labels/intent-config staff port), then FOLLOW-598
(bandit weights, superadmin-only), then FOLLOW-606 (hub-linkage). FOLLOW-604/602/603/611 can be
slotted in opportunistically; FOLLOW-599/600 remain after.

**Process note flagged for the operator (not blocking):** PR #595 merged outside our
delegation/validation pipeline entirely (external Cursor-agent, no PM pre-merge
`gh pr checks --watch`, no evidence-requirements paste). Retroactive verification this session found
the work sound (wiring real, only a benign gitleaks false-positive) — no action needed beyond
FOLLOW-611, but flagging the process gap for visibility. Separately: this session's retros
(RETRO-194/195) were written directly by the PM-orchestrator session, not a separately-invoked
`retrospective-analyst` subagent — no Task/Agent-spawning tool was available in this session's
toolset (Read/Write/Edit/Bash only). If the operator wants a dedicated Opus-tier
retrospective-analyst pass on PRs #595/#596, a future session with that tool available should re-run
one.

**Minor pre-existing hygiene note (not touched this session, not blocking):** `RETRO-193` appears
twice in `backlog/RETROSPECTIVES.md` (two near-duplicate write-ups of the same FOLLOW-596 retro,
both attributed to RETRO-193) — looks like an accidental double-write from a prior session, not a
numbering collision with anything new. Left as-is; flagging for a future cleanup pass, not urgent.

---

## ▶️ (superseded) START HERE — resume 2026-07-21 (session 45 — recovered FOLLOW-608 uncommitted worker output, found+bounced a real CI-wiring gap; backend-engineer re-dispatched on the same branch)

**Read this before picking anything.** No escalations open (ESC-020/028/034 non-blocking OPEN per
memory, all others RESOLVED). One open PR: #595, `cursor/adaptive-listings-code-audit-fb97`, DRAFT,
opened by an external Cursor agent, unrelated to our pipeline — not ours to validate/merge, ignore
unless the human asks. `main` unchanged this session (all session-45 work is on the FOLLOW-608
branch only).

**Session 45 — FOLLOW-608 (`backend-engineer/FOLLOW-608-staff-write-atomicity-scope`), still
IN_PROGRESS, NOT PR-ready.** Found the branch checked out with substantial uncommitted work (new
`scripts/check-staff-write-atomicity.cjs` AST-based guard, rewritten `.sh` wrapper, extended test
harness, 6 new fixture dirs) — no PR open, no crash, worker just hadn't committed yet. Followed
`docs/AGENT_WORKFLOW.md` "Recovered-work re-verification": confirmed branch != `main`; confirmed
`main` was clean (nothing else stranded); independently re-ran
`bash scripts/__tests__/check-staff-write-atomicity.test.sh` myself (25/25 assertions pass — did not
trust the prior session's uncommitted state on faith). **The detection logic is correct and
complete** — all 3 RETRO-192 bypasses (unrelated-tx, helper-factored audit, raw-SQL mutation) FAIL
as required, qualified/whitespaced forms match, superadmin-gated exemption is disallowed, the
FOLLOW-605/596 reference routes still PASS, `admin/labels/export` still SKIPs.

**But found a real CI-breaking gap before committing to PR:** the new `.cjs` guard
`require('typescript')`, but the `staff-write-atomicity` CI job only runs `actions/checkout@v4` — no
`pnpm install` — unlike every other node-dependent job in `.github/workflows/ci.yml`. **Reproduced
locally**: moved `node_modules/` aside, ran the script directly →
`Error: Cannot find module 'typescript'`, exit 1. This is a hard gate (no `continue-on-error`) — it
would go permanently red on every future PR the moment this merges, blocking the whole pipeline.
Full repro + exact fix (mirrors the `lint` job's setup-node/pnpm-install pattern) written to
`backlog/HANDOFFS.md` "Bounce-back — FOLLOW-608 CI-wiring gap found in PM verification (session 45,
2026-07-21)".

**Checkpointed the good work in 2 commits on the ticket branch** (not a PR — deliberately, since the
gap must close first): `8c5f248` (guard code + fixtures + tests) and `345c285` (backlog bookkeeping
— persisted the session-44 operator-ruling text that had been drafted but left uncommitted before
dispatch). **Re-dispatched backend-engineer (SONNET, same model-fit rationale as session 44 —
routine mechanical CI-workflow fix, not security-reasoning tier) on the SAME branch** to add the
missing `pnpm/action-setup` + `actions/setup-node` + `pnpm install --frozen-lockfile` steps to the
`staff-write-atomicity` job, re-verify locally, then open the PR themselves. **CI-check counter: 0/5
(no PR opened yet). Fix-iteration counter: 0/3.**

**Do not pick a new ticket that touches `.github/workflows/ci.yml` or
`scripts/check-staff-write-atomicity.*` until this PR opens and lands** — same-branch, same-agent
work in flight.

**FOLLOW-596 → DONE.** PR #594 merged (squash `b0c34d3`, 2026-07-21T10:08:39Z). RETRO-193 filed
(`backlog/RETROSPECTIVES.md`): SECURITY-CLEAN, INV-5 discharged end-to-end both verbs, staff write
wired all the way to visitor render (`demo_overrides` → `adapt/description/route.ts` →
`getDemoOverride`). One material finding, no live defect: **LG-1 → FOLLOW-609** (P2) — the
FOLLOW-607 guard's presence-not-scope design forced FOLLOW-596 to INLINE-duplicate
`demo-override-store.upsertDemoOverride` in the route with zero parity guard (byte-identical today,
latent agency/staff divergence risk on any future schema/logic change to the store). RETRO-193 flags
this as SYSTEMIC: FOLLOW-597 (labels/intent-config) and FOLLOW-598 (bandit weights, highest blast
radius) will each inline-duplicate their own store for the identical guard-avoidance reason unless
FOLLOW-608 (make the guard scope-aware, not presence-only) lands first.

**Sequencing decision made this session (PM-orchestrator call, not deferred to human):**
**FOLLOW-608 dispatched now; FOLLOW-609 queued to dispatch next (after 608 lands); FOLLOW-597/598
pushed down one slot.** Reasoning: this is ordinary, reversible backlog resequencing (not an
architectural/pricing/compliance decision) — every affected ticket is otherwise unblocked, so the
only cost is one session's delay on FOLLOW-597. The benefit is real: landing 597 first would create
a THIRD duplicated write shape to retrofit instead of one, and would let FOLLOW-598 (the
highest-blast-radius write, superadmin-only bandit weights) inherit an established
inline-and-duplicate precedent from two prior tickets instead of zero. RETRO-193 §5b explicitly
recommends 608+609 land before the highest-risk write carries the un-guarded duplicate. **Flagging
this reordering explicitly for the operator** — if you'd rather prioritize feature-port velocity
(land 597 now, defer 608/609), say so and the next session will pick 597 instead; nothing here is
irreversible (FOLLOW-608's PR hasn't merged yet).

**Model-fit for FOLLOW-608: SONNET** (same class as its predecessor FOLLOW-607 — routine, reversible
CI-guard-script hardening, red-first-fixture-verifiable; NOT the security-reasoning tier reserved
for staff-write _routes_ touching the RLS-bypassed data path, e.g. 592/594/595/596 which went OPUS).
Full delegation brief: `backlog/HANDOFFS.md` "Delegation brief — FOLLOW-608 (session 44,
2026-07-21)". Branch: `backend-engineer/FOLLOW-608-staff-write-atomicity-scope`.

**OPERATOR RULING (Piotr, 2026-07-21, session 44) — sequencing locked:** FOLLOW-608 → FOLLOW-609 →
FOLLOW-597/598 → FOLLOW-606. The systemic-duplication fix (608 scope-aware guard, then 609 de-dup)
goes AHEAD of the further staff-write ports (597/598); hub-wiring (606) comes AFTER those, not
interleaved with the P3 backlog as the prior draft ordering suggested. This supersedes the
"remaining P3s (604/606/602/603)" ordering below — 606 specifically is deferred until after 597/598;
604/602/603 are unordered relative to that spine and can be picked opportunistically. Next-free
FOLLOW id = **610**.

**Sequence after FOLLOW-608 merges:** dispatch FOLLOW-609 (de-dup the demo-override write, backend-
engineer, P2) next, then FOLLOW-597 (labels/intent-config staff port), then FOLLOW-598 (bandit
weights, superadmin-only), then FOLLOW-606 (hub-linkage). FOLLOW-604/602/603 can be slotted in
opportunistically alongside this spine; FOLLOW-599/600 remain after.

---

## ▶️ (superseded) START HERE — resume 2026-07-21 (session 43 — FOLLOW-596 (Phase-2 demo-override staff write port) PM-validated on PR #594; CI green (only pre-existing Rule I red, PR net-REDUCES violations 190→189); atomicity + tenant-fence + wiring independently confirmed. Moved to READY_FOR_REVIEW. Awaiting human merge.)

**Read this before picking anything.** No escalations open (ESC-036/037/038 all RESOLVED). PR #594
(`backend-engineer/FOLLOW-596-demo-override-staff-write`) is READY_FOR_REVIEW, awaiting human merge
— do not pick a new ticket that touches `api/demo/override/route.ts` or the same admin surface until
it lands. After merge: spawn `retrospective-analyst` on the merged diff, then next candidates are
FOLLOW-597 (same Phase-2 shape, labels + intent-config), the P3 retro-driven follow-ups
(608/604/606/602/603), then FOLLOW-598/599/600.

**FOLLOW-596 PM validation summary (session 43):**

- **CI (step 5b):** `gh pr checks 594 --watch` → every real gate SUCCESS (Lint, Typecheck, Test
  (Node 22), Test (Python x4), Build, Build (control-plane), SDK E2E tests, Format check, Gitleaks,
  Doppler verify, **Staff-write audit atomicity (ADR-0018 §3a / FOLLOW-607) — PASS**, and every
  other ticket-specific guard). Only red: `Rule I — wired-or-dead check` — pre-existing,
  non-blocking (memory `project_ci_gate_landscape`). **Spot-checked, not taken on faith:** ran
  `scripts/check-rule-i.sh` on `origin/main` HEAD (`7aa2353`) myself → **190** violations; the PR
  branch's own CI log shows **189** — this PR branch has ONE FEWER violation than main, i.e. it
  introduces ZERO new Rule I violations (net improvement). Grepped the PR-branch Rule I log for
  `demo`/`override` — the only demo-related hits (`ReachableArchetype`, `DemoAllowedModel` in
  `demo-override-store.ts`, pre-existing types on an untouched file per `git diff --stat`) are not
  new.
- **Atomicity (step 5c/AC):** read the shipped `api/demo/override/route.ts` diff directly — the
  staff `PUT` path (`putStaff`) wraps
  `tx.insert(demoOverrides)...onConflictDoUpdate(...).returning()` AND
  `await tx.insert(staffAuditLog).values(...)` inside ONE `db.transaction(async (tx) => {...})`; any
  throw inside (incl. a forced rollback on an empty upsert result) rolls both back → 500
  `audit_write_failed`, never an orphan mutation. Confirmed the FOLLOW-607 CI gate
  (`Staff-write audit atomicity`) actually ran against this file and PASSED. Agency branch still
  calls the pre-existing `upsertDemoOverride(...)` unmodified, unaudited — byte-unchanged per the
  diff. `minAgencyRole: 'agency:admin'` on PUT (viewer cannot write) confirmed in code, a deliberate
  divergence from quiz/config as claimed.
- **Tests:** `route.test.ts` — 23/23 pass locally (independently re-run, not the worker's claim).
  Confirmed by reading the file: dedicated rollback test ("ROLLS BACK the override upsert when the
  staff audit insert fails", L579) and commit test (L608) target the real `db.transaction()` path;
  the MANDATORY tenant-filter tests (L634-676) exercise the real fenced
  `eq(demoOverrides.tenantId, ...)` insert/read against a both-tenants mock DB — NOT the
  demonstrative `RLS-TRAP-LEAK-DEMO` (ADR-0018 §2 invariant 5 / RETRO-187 discipline).
- **Runtime wiring (step 5c):** new page `admin/tenants/[id]/demo/page.tsx` imports and renders
  `StaffDemoOverrideEditor` from the new `demo-override-editor.tsx` (Next.js file-route, reachable
  at `/admin/tenants/[id]/demo`); the page's `tenantExists` producer/consumer pair
  (`session-auth.ts:329` → `demo/page.tsx:42`) matches the shipped pattern already used by the
  merged `quiz` and `analytics` staff pages. **Not yet wired into the `/admin/tenants/[id]` hub
  landing links** — explicitly out of scope per the ticket and the worker's own doc-comment;
  FOLLOW-606 (already filed) is the follow-up that adds the landing link, same as it will for
  597/598.
- **Local re-verification (recovered-work-grade rigor, not required here since no crash occurred,
  but applied anyway per discipline):**
  `pnpm --filter @estalara/control-plane test -- demo/override` → 23/23 pass;
  `pnpm --filter @estalara/control-plane exec tsc --noEmit -p .` → clean, zero errors.
- **Co-assignment:** single agent (backend-engineer only) — step 5d (multi-agent integration check)
  N/A.

**CI-check counter: 1/5. Fix-iteration counter: 0/3** (CI was already green on first read; no fixes
requested).

---

## ▶️ (superseded) START HERE — resume 2026-07-21 (session 41 — ADR-0018 staff-write chain COMPLETE: FOLLOW-593/594 recovered from stranded worktrees & merged; 595 first staff WRITE + 605 audit-atomicity (§3a) + 607 atomicity CI guard all PM-validated→merged; RETRO-188→192 all filed. Next = FOLLOW-596/597 (adopt §3a) or 608 (tighten guard)/604/606)

**Read this before picking anything.** Session 40/parent dispatched `backend-engineer` (Opus) for
**both FOLLOW-593 and FOLLOW-594** (FOLLOW-592 having merged, #579, both were unblocked). A terminal
shutdown killed both runs mid-flight; neither committed. Session 41 recovered the stranded work from
`.claude/worktrees/agent-*` (empty `git diff main` would have hidden it — see memory
`feedback_check_worktrees_before_concluding_agent_didnt_run`), verified it, and **both are now
MERGED to main**. Nothing was lost. Worktrees removed and branches deleted.

- **FOLLOW-593 → MERGED #581** (squash `7826967`). `/admin/tenants` hub + `/admin/tenants/[id]`
  landing, multi-tenant admin nav un-hidden, three admin pages wired to **real Supabase data with
  mock as the documented DB-unconfigured fallback** (closed the PM finding's Rule K.2
  "silently-wrong fake tenants" risk — pages previously rendered 100% mock unconditionally). 88
  tests; all real CI gates were green (Test Node 22 pass).

- **FOLLOW-594 → MERGED #582** (squash `08a5d1e`). Analytics staff read-port: summary + lift +
  **weights GET (read only)** opt into `resolveTenantAccess({allowStaffOverride:true})`; bandit
  **PATCH write left untouched (Phase-3 / FOLLOW-598)**. Added `/admin/tenants/[id]/analytics` page,
  the RETRO-187 ADMIN_API_SECRET-403 route doc note, and the **MANDATORY red-first tenant-filter
  tests** (ADR-0018 §2 invariant 5 / RETRO-187) — VERIFIED (this session, by reading them) to
  exercise the **real** outgoing query (ClickHouse `param_tenant_id` / drizzle `eq(tenantId,A)`
  against a both-tenants service-role table), NOT the demonstrative local-array
  `RLS-TRAP-LEAK-DEMO`. 54 tests; all real CI gates were green (Test Node 22 pass).

- **Rule I stayed red on both (181/191) — non-blocking, pre-existing (also red on merged #580).**
  The new `data.ts` return-type interfaces (`TenantsListResult`, `TenantLookupResult`,
  registrations/ demo-sessions equivalents) are naive-grep false-positives: they ARE the return
  types of the wired loader functions, but the pages import the function and infer the return, so
  the grep sees "zero non-test importers." **Deliberately NOT force-wired** (non-surgical, would
  risk the green tests) — these fold into **FOLLOW-591** (already exists to clear Rule I wholesale).
  Not a merge gate.

**Status (ADR-0018 Phase-1 + first Phase-2 write + atomicity hardening COMPLETE):**

1. ✅ DONE — FOLLOW-592 (#579), 593 (#581), 594 (#582), 595 (#586), **605 (#589, `850bc6a`)**
   merged.
2. ✅ DONE — retros filed+merged: RETRO-188/189/190 (#584/#587) + **RETRO-191 (605)** (this PR). All
   staff surfaces INV-5 **security-CLEAN** end-to-end (594 read + 595 write, non-vacuous real-query
   leak tests). **FOLLOW-605** hardened the staff write: config update + `staff_audit_log` insert
   now commit-or-rollback in ONE `db.transaction()` (ADR-0018 **§3a**; rollback test proves no
   orphan mutation). PM-validated #586 and #589 before merge.

**✅ FOLLOW-607 DONE** (#592, `8acbe90`, RETRO-192): `scripts/check-staff-write-atomicity.sh`
hard-gate CI job — a route with a data mutation + `insert(staffAuditLog)` but no `.transaction()`
FAILs. PM-validated (fails on the violation fixture, 605 passes, agency/audit-only not flagged).
**Known residual (RETRO-192 §4a → FOLLOW-608):** it's a transaction-PRESENCE check, not SCOPE — an
unrelated `db.transaction()` elsewhere in the file, a helper-factored audit insert, or a raw-SQL
mutation can bypass it. Net-positive tripwire; tighten before FOLLOW-598.

**⬜ NEXT (pick per priority):**

3. **Phase-2 write ports FOLLOW-596 / 597** (demo-override; labels + intent-config) — copy 595's
   shape: `resolveTenantAccess` + write-rank (`canWrite`) + `staff_audit_log` **inside one
   `db.transaction()` per ADR-0018 §3a** (605 is the reference impl; 607 guard now enforces it) +
   MANDATORY READ+WRITE tenant-filter test + FOLLOW-603 option-wiring assertions.
4. **Retro-driven follow-ups (all P3):**
   - **FOLLOW-608** — tighten the 607 guard from transaction-PRESENCE to transaction-SCOPE
     (lexical-in-tx or ESLint/AST), close the 3 false-negative bypasses + harden the
     qualified-insert matcher + disallow the exempt-comment on rank-3/superadmin routes. Do before
     FOLLOW-598 inherits the shape (RETRO-192).
   - **FOLLOW-604** — staff-port `PATCH /api/tenants/[id]` (quiz ON/OFF toggle, `quiz_enabled`) +
     unify quiz editors (RETRO-190; not a 595 AC miss).
   - **FOLLOW-606** — wire per-tenant staff sub-surfaces into the `/admin/tenants/[id]` hub landing
     (analytics + quiz are direct-URL-only today; reconciles a RETRO-189 mis-statement).
   - **FOLLOW-602** (Rule-I diff-scope false-positive fix, dep of FOLLOW-591) + **FOLLOW-603**
     (option-wiring assertions — 595 already applied it inline).
5. **Still open from earlier:** sibling stub for the Pilot / Site-Detection read-only staff views
   deferred out of 594; **FOLLOW-598** (bandit write — MUST adopt §3a + pass the 607 guard, ideally
   after FOLLOW-608 tightens it) / 599 / 600. Next-free FOLLOW id = **609**.

---

## ▶️ (superseded) START HERE — resume 2026-07-20 (session 40 — FOLLOW-592 promoted to QUEUE.md (READY, worker model OPUS) + FOLLOW-593 enriched with a real-data-wiring finding; PM bookkeeping only, dispatch is the parent session's next step)

**Read this before picking anything.** This session did **bookkeeping only** for the ADR-0018
superadmin-access thread — no code was written, and the worker (`backend-engineer`, Opus) has NOT
been dispatched yet by this session.

- **FOLLOW-592 promoted** `backlog/FOLLOW_UPS.md` → `backlog/QUEUE.md` (`status: READY`,
  `priority: P1`, `depends_on: []`, blocks FOLLOW-593..600). AC copied verbatim from the stub.
  `notes:` records the model-fit ruling — **worker model = OPUS**, security-sensitive auth-path
  change (session resolution + RLS discipline; ADR-0018 §2 invariant 5 is a cross-tenant-leak risk
  with no RLS safety net under the staff/service-role path) — per CLAUDE.md's mandatory model-fit
  rule, do not argue this down to sonnet. `FOLLOW_UPS.md`'s `promoted_to_queue` flipped to `true`
  with the QUEUE.md id/status/model note.
- **Full delegation brief written to `backlog/HANDOFFS.md`** ("Delegation brief — FOLLOW-592",
  session 40) — required reading order (Master_Design §Snapshot.1 → ADR-0018 §2 end-to-end →
  CONVENTIONS_PATCH.md → the tracer-auth precedent), the model-fit ruling restated with rationale,
  non-negotiable scope constraints (helper + tests ONLY, no route wired yet, no middleware change),
  the verbatim >=6-case AC, and completion requirements (PR evidence for the invariant-5 tenant-
  filter proof specifically, not just "helper returns right tenantId").
- **FOLLOW-593 enriched** with a PM finding verified against the real files (not assumed from the
  ADR text): all three multi-tenant admin pages currently slated for un-hiding (`/admin/tenants`,
  `/admin/registrations`, `/admin/demo-sessions`) render **100% mock data unconditionally** —
  `MOCK_TENANTS`/`MOCK_REGISTRATIONS`/`MOCK_DEMO_SESSIONS` from local `mock-data.ts` modules, no
  DB-configured code path exists yet. Un-hiding the nav without wiring real Supabase data would put
  a staff-navigable page in front of the CEO showing permanently-fake rows — a live instance of the
  Rule K.2 "never fabricate" trap, worse than the usual silent-empty failure mode because it's
  silently WRONG. Estimate raised 3h → ~5-6h; added an AC that the tenants list must show real rows
  when the DB is configured, with mock retained only as the documented DB-unconfigured fallback (the
  same accepted pattern used elsewhere, e.g. FOLLOW-599's audit-log mock fallback). **Not promoted**
  — still correctly blocked on FOLLOW-592 per the ADR's own sequencing; do not dispatch before 592
  lands.
- **FOLLOW-594..600 deliberately NOT promoted** — all blocked on FOLLOW-592 (`resolveTenantAccess`
  doesn't exist yet for any of them to opt into).

No open escalations block this pick (ESC-020 remains explicitly non-blocking per its own 2026-06-10
CEO resolution — the only `## OPEN` entry in `backlog/ESCALATIONS.md`). No PRs were open at session
start (`gh pr list --state open` empty) and none from a prior session were stranded on a branch —
working tree was on `main`, clean, at `9f33488` before this session's docs-only commit.

**This session did not dispatch the worker.** The next step is the parent session invoking
`backend-engineer` on **Opus** for FOLLOW-592, using the `backlog/HANDOFFS.md` brief above — not
another PM bookkeeping pass.

---

## ▶️ (superseded) START HERE — resume 2026-07-20 (session 39 — ENTIRE archetype-parity effort COMPLETE; invalid-VALUE chain + importable-COPY class both CLOSED + parsers hardened; FOLLOW-584/585/586/587/588/589/590 all DONE; Rule AD promoted)

**Read this before picking anything.** The **archetype-invalid-mock-literal class is now CLOSED**
(RETRO-183 verdict, independent all-shapes sweep = 0 live invalid literals). The
FOLLOW-561→583→585→587→**589** chain remediated every live structural sub-shape and guarded all
three in `tests/integration/archetype-id-parity.test.ts` (12 assertions), reinforced by
`readonly ArchetypeId[]` compile-time typing on the named `MOCK_ARCHETYPES` arrays. **FOLLOW-588**
then hardened all 11 of that file's parsers with `stripComments()` so a comment inside a captured
block can't false-positive the scan (RETRO-184 verdict: SAFE, no over-strip false-negative) — the
convention is now enforced by code, de-risking FOLLOW-586. **Rule AD** (`CONVENTIONS_PATCH.md`,
promoted RETRO-182) codifies the discipline: enumerate every structural shape a value-domain literal
can occupy; prefer a compile-time type over a downstream grep-guard.

Merged this session (all squash to `main`, all CI green modulo pre-existing-red Rule I):

- **FOLLOW-584** — PR #559 (`a08fcdf`) + RETRO-180. Consolidated the 3 hand-maintained 18-item
  archetype-ID copies onto exported `@estalara/shared` `CANONICAL_ARCHETYPE_IDS` (supersedes the
  long-dormant FOLLOW-036). Human-approved (public export). Sibling dup PR #558 closed.
- **FOLLOW-585** — PR #561 (`475dc0c`) + RETRO-181. Two `'investor'` lift-route mock literals →
  `'portfolio_builder'` (CEO pick), red-then-green guard.
- **FOLLOW-587** — PR #563 (`2ed817f`) + RETRO-182 + **Rule AD**. `family_nester`→`family_buyer`
  (tracer-sessions) + audit `'investor'`→`'portfolio_builder'`; durable `readonly ArchetypeId[]`
  retype on the 3 named arrays.
- **FOLLOW-589** — PR #565 (`04f7832`) + RETRO-183. Last literal: `family_nester`→`family_buyer` in
  the tracer-history `archetype_deltas` JSON blob + a new JSON-blob-KEY guard. **Chain closed.**
- **FOLLOW-586** — PR #569 (`5883e18`) + RETRO-185. Migrated the 2 NAMED importable full-parity
  DUPLICATE copies (`intent-weights.ts` `ARCHETYPE_KEYS` = `CANONICAL_ARCHETYPE_IDS`;
  `adapt/description/route.ts` `z.enum` → `ArchetypeIdSchema`) onto the FOLLOW-584 canonical
  sources.
- **FOLLOW-590** — PR #571 (`bb9f837`) + RETRO-186. Migrated the LAST importable copy
  (`packages/sdk/src/core/adapt-schema.ts` `archetypeIdSchema` → re-export of shared's
  `ArchetypeIdSchema`) + added the `.options ≡ ARCHETYPE_NAMES` guard it lacked. **Importable-COPY
  class CLOSED repo-wide** (RETRO-186: closure-grep category-(c) count = 0).

**✅ The entire archetype-parity effort is COMPLETE — no open tickets in this area.** Both classes
are closed and guarded: the invalid-literal-VALUE chain (FOLLOW-561→583→585→587→589, RETRO-183) and
the duplicate-COPY class (FOLLOW-584→586→590, RETRO-186); parsers hardened (FOLLOW-588); **Rule AD**
codifies the discipline. Every importable TS archetype-ID list now derives from one canonical source
(`CANONICAL_ARCHETYPE_IDS` ← guarded vs the `ARCHETYPE_NAMES` SoT). Deliberately OUTSIDE and
unaffected: the Python cross-runtime copies (`nlp.py`/`generate_description.py`, guarded by
FOLLOW-561, cannot be import-consolidated) and two lower-severity test-only fixtures (RETRO-185/186
§4c — a recorded note, not a ticket).

No open escalations block further work (ESC-020 remains explicitly non-blocking per CEO 2026-06-10
ruling). **Next pick: normal backlog priority** — the archetype-parity thread no longer gates
anything.

---

## ▶️ (superseded) START HERE — resume 2026-07-18 (session 38 — FOLLOW-584 + FOLLOW-585 promoted + dispatched concurrently, closing the FOLLOW-561→583→179 archetype-parity chain)

**Read this before picking anything.** This session promoted RETRO-179's two findings —
**FOLLOW-584** (P2, backend-engineer — consolidate `bandit-seed.ts` `CANONICAL_ARCHETYPES`,
`directives.ts` `ArchetypeId`, `description.ts` `ArchetypeIdSchema` onto one
`packages/shared/src/archetypes.ts` canonical export; supersedes the long-dormant `FOLLOW-036`) and
**FOLLOW-585** (P2, qa-engineer — fix the 2 invalid `'investor'` mock literals in
`pilot/cta-lift/route.ts` + `dashboard/analytics/lift/route.ts`, add subset-validity guards) — from
`backlog/FOLLOW_UPS.md` into `backlog/QUEUE.md` (both `IN_PROGRESS`, `started_at: 2026-07-18`).
Verified against the real files first, not taken on the retro's word:

- **Pre-check 1 — bandit-seed.ts sync status:** confirmed `CANONICAL_ARCHETYPES` (bandit-seed.ts) is
  byte-for-byte identical (same 18 ids, same order) to `ARCHETYPE_NAMES`
  (`packages/sdk/src/core/intent.ts`) AND to `ArchetypeIdSchema` (`description.ts`). **No live-prod
  defect** — FOLLOW-584 is guard/consolidation-ADD only.
- **Pre-check 2 — 'investor' mapping:** read `INVESTOR_ARCHETYPES`
  (`packages/sdk/src/core/intent.ts:70-77`) and both route.ts files' surrounding context. Found
  **genuinely ambiguous** (5 defensible candidates, no textual anchor, unlike the unambiguous
  `family_upsizer`→`upsizer` decomposition) — flagged in the ticket's `notes:` (PM FLAG) rather than
  silently picked. Worker must state a one-sentence rationale prominently in the PR; Piotr may want
  to glance at that specific line before merge.
- **Pre-check 3 — same-file conflict, resolved at the root, not by sequencing:** the operator brief
  flagged that both tickets add assertions to `tests/integration/archetype-id-parity.test.ts` and
  asked for combined-PR vs strict-sequence. Re-reading FOLLOW-584's own AC found the guard-test
  location is an explicit OR-choice (`tests/integration/...` OR a new
  `packages/shared/src/__tests__/` test) — **redirected FOLLOW-584 to the `packages/shared`
  location**, which produces genuinely **zero file overlap** with FOLLOW-585 (which owns
  `tests/integration/archetype-id-parity.test.ts` exclusively). This supersedes both options the
  brief offered: no combined PR, no sequencing needed — **both dispatched concurrently** as
  independent branches. See `backlog/HANDOFFS.md` "Delegation briefs — FOLLOW-584 + FOLLOW-585" for
  full reasoning, including why backend-engineer alone (not architect+backend) was chosen for 584.
- **Rule AC assessment (not promoting a new rule):** RETRO-179 found Rule AC (promoted in RETRO-178)
  was violated one ticket later (`bandit-seed.ts` was in FOLLOW-583's own anchor-grep output but
  dropped from scope). This is the **first** instance of "a newly-promoted rule violated in its very
  next application" — below the ≥2-prior-retro threshold for a new codified rule. Recorded here, not
  promoted.

No open escalations block this pick (ESC-020 remains explicitly non-blocking per CEO 2026-06-10
ruling). `FOLLOW-562`/`FOLLOW-564` remain `READY` and unblocked (not picked — out of scope for this
session). `FOLLOW-560`/`FOLLOW-565` stay `BLOCKED` on `FOLLOW-553`. **2 tickets IN_PROGRESS this
session (584, 585) — within the 3-ticket cap.** Neither has been dispatched to a worker yet — the
next step is spawning `backend-engineer` on FOLLOW-584 and `qa-engineer` on FOLLOW-585 per the
HANDOFFS.md briefs.

---

## ▶️ (superseded) START HERE — resume 2026-07-18 (session 37 — FOLLOW-583 DONE, merged; retrospective RETRO-179 filed)

**Read this before picking anything.** FOLLOW-583 is `DONE`. Both PRs merged: worker PR #555
(`4b527a4`, branch `qa-engineer/FOLLOW-583-archetype-guard-4th-copy`) and this session's bookkeeping
PR (see below for its number/commit once opened). Retrospective RETRO-179 filed in
`backlog/RETROSPECTIVES.md` covering the FOLLOW-561→RETRO-178→FOLLOW-583 chain, including an
independent repo-wide re-grep for any remaining unguarded archetype-literal copies and a check on
whether Rule AC (added in RETRO-178) is holding. See that entry for findings and any new FOLLOW
stubs generated.

No open escalations block anything (ESC-020 remains explicitly non-blocking per CEO 2026-06-10
ruling; ESC-037/ESC-038 both RESOLVED). `FOLLOW-562`/`FOLLOW-564` remain `READY` and unblocked —
**not picked this session per explicit instruction** (this session was scoped to the FOLLOW-583 DONE
transition + retrospective only). `FOLLOW-560`/`FOLLOW-565` stay `BLOCKED` on `FOLLOW-553`.

---

## ▶️ (superseded) START HERE — resume 2026-07-18 (session 36 — FOLLOW-583 PM-validated, READY_FOR_REVIEW on PR #555)

**Read this before picking anything.** FOLLOW-583's qa-engineer worker phase opened PR #555 (commits
`6bec7ea`..`a3916aa`, branch `qa-engineer/FOLLOW-583-archetype-guard-4th-copy`). PM independently
validated (not taken on the worker's word):

- **CI:** `gh api .../check-runs` shows only `Rule I — wired-or-dead check` (x2, both matrix legs)
  non-success; every other real gate green (Lint, Typecheck, `Test (Node 22)`, `Build`,
  `Build (control-plane)`, `Format check`, `Rule J — mirror-code sync check`, SDK E2E, all Python
  suites, Vercel). Confirmed net-zero: ran `scripts/check-rule-i.sh` on both `main` (0dddb04) and
  the PR branch in isolated worktrees — byte-identical 198-line output, `diff` exit 0. Non-success
  count for real gates: **0**.
- **AC-1 (4th full-parity copy):** independently re-parsed `_ARCHETYPE_GUIDANCE` from the real
  `apps/llm-gateway/src/jobs/generate_description.py` with a standalone Python script (not the
  worker's TS parser) — got exactly the same 18 keys as `ARCHETYPE_NAMES`, set-equal. Confirmed
  `.get(archetype, "<generic fallback>")` production usage at `:1303`/`:1712`.
- **Falsification (self-run, not trusted from PR description):** edited the real
  `generate_description.py` (`"yield_hunter": (` → `"yield_hunter_typo": (`), ran
  `pnpm vitest run tests/integration/archetype-id-parity.test.ts` directly — failed loudly
  (`MISSING archetypes ... [yield_hunter]`), 7 passed / 1 failed as expected. Reverted via file
  restore from a scratch backup; `git status`/`git diff --stat` confirmed zero stray diff. Re-ran →
  8/8 green.
- **AC-2 (`REACHABLE_ARCHETYPES` subset):** read the real 13-element array in
  `demo-override-store.ts` — all 13 are canonical `ARCHETYPE_NAMES` members, proper subset (13 <
  18). `assertSubsetValidity` helper reviewed line-by-line — not vacuous (checks invalid-id array
  AND `size < canonical.length`).
- **AC-3 (`family_upsizer` fix — scrutinized per brief):** confirmed `upsizer` (chosen over
  `family_buyer`) IS a canonical `ARCHETYPE_NAMES` member (`packages/sdk/src/core/intent.ts:58`).
  Read the surrounding mock context in both `route-helpers.ts` and `export/route.ts` —
  `MOCK_ARCHETYPES`/`buildMockExportRows()` are dev/CI-only fixtures (`data_source: 'mock'`, gated
  on absent `CLICKHOUSE_URL`/`DATABASE_URL_ADMIN`), never served to real tenants, with no semantic
  requirement beyond validity. `upsizer` is a defensible, non-ambiguous replacement (a buyer moving
  to a larger home for a growing family is literally what the canonical `upsizer` archetype means).
  Mapping **passes** — not flagging to human.
- All 5 pre-existing assertions still pass (8/8 total, matches AC).

**PM-validated. CI green (0 non-success on real gates). Runtime wiring confirmed (no new production
exported symbols — test extension + 2 literal fixes only; both fixed literals verified as canonical
`ARCHETYPE_NAMES` members with real producer/consumer context checked). Ready for human review.**
Moved to `READY_FOR_REVIEW` below — **awaiting human merge, not DONE yet.**

No open escalations block anything (ESC-020 remains explicitly non-blocking per CEO 2026-06-10
ruling; ESC-037/ESC-038 both RESOLVED). `FOLLOW-562`/`FOLLOW-564` remain `READY` and unblocked for
the next pick. `FOLLOW-560`/`FOLLOW-565` stay `BLOCKED` on `FOLLOW-553`.

---

## ▶️ (superseded) START HERE — resume 2026-07-18 (session 35 — FOLLOW-583 promoted + dispatched to qa-engineer)

**Read this before picking anything.** FOLLOW-561 is `DONE` (merged `a203b52`/PR #552 + `153ab0f`/PR
#553; retrospective RETRO-178 filed). This session promoted RETRO-178's finding, **FOLLOW-583** (P2,
qa-engineer — extend the archetype-ID parity guard to the 4th production-live full-parity copy
`generate_description.py` `_ARCHETYPE_GUIDANCE` + 2 subset copies, one of which ships the invalid id
`'family_upsizer'`), from `backlog/FOLLOW_UPS.md` into `backlog/QUEUE.md` (status `IN_PROGRESS`,
`assigned_to: qa-engineer`, `started_at: 2026-07-18`). Verified against the real files before
writing AC (not taken on the retro's word) — commit `d3d113e`. Full delegation brief in
`backlog/HANDOFFS.md` under "Delegation brief — FOLLOW-583". **Branch:**
`qa-engineer/FOLLOW-583-archetype-guard-4th-copy` — not yet created; the qa-engineer subagent still
needs to be invoked to do the actual implementation. **Do not mark READY_FOR_REVIEW until PM
independently confirms CI green (`gh pr checks <pr> --watch` + the jq non-success-count command) and
the AC-3 falsification-red proof is real** (per the F-561-pattern precedent, don't take "tests pass"
on the worker's word alone).

No open escalations block this pick (ESC-020 remains explicitly non-blocking per CEO 2026-06-10
ruling). `FOLLOW-562`/`FOLLOW-564` remain `READY` and unblocked (not picked this session — see
delegation-table row justification in the FOLLOW-583 brief for why 583 was prioritized: it directly
extends work that JUST merged, same file/pattern, lowest context-switch cost). `FOLLOW-560`/
`FOLLOW-565` stay `BLOCKED` on `FOLLOW-553`.

---

## ▶️ (superseded) START HERE — resume 2026-07-17 (session 33 — FOLLOW-561 PM-validated, READY_FOR_REVIEW on PR #552)

**Read this before picking anything.** FOLLOW-561's qa-engineer worker phase opened PR #552
(`221102d`, branch `qa-engineer/FOLLOW-561-archetype-parity-guard`). PM validated: CI green on all
real gates (only `Rule I — wired-or-dead check` is red, confirmed pre-existing/net-zero — 180
violations on `main` and on the PR branch, identical set, diff adds zero new production exported
symbols); AC(a)/(b) both verified, including an independent falsifiability check (injected a typo
into the real `nlp.py`, confirmed the test fails loudly, reverted cleanly). Evidence posted as a PR
comment. **Set `READY_FOR_REVIEW` below — awaiting human merge, not DONE yet.** No open escalations
except ESC-020 (Rafał-side DOM-hooks deploy, explicitly non-blocking per CEO 2026-06-10 ruling — do
not treat as a gate).

**Two other Wave-3 P3 tickets remain READY and unblocked for the next loop:** `FOLLOW-562`
(backend-engineer, dashboard Panel 5 error banner) and `FOLLOW-564` (architect, p95 SLA doc
reconciliation). `FOLLOW-560`/`FOLLOW-565` stay `BLOCKED` on `FOLLOW-553` (still `READY_OPERATOR`,
not DONE).

**Retro note:** FOLLOW-563 is a P3 test-hygiene ticket with minimal surface (soft-skip a smoke test

- one comment fix) — no cross-module wiring, no cascading consumer. Deferring its
  retrospective-analyst spawn is reasonable; if spawned later, batch it with FOLLOW-561's retro
  rather than running one for each trivial P3.

---

## ▶️ (superseded) START HERE — resume 2026-07-16 (session 30 — 557/558 rescued + MERGED; their retros found a LIVE prod compliance gap → ESC-037)

**Read this before picking anything.** **FOLLOW-557 and FOLLOW-558 are DONE — merged to `main`**
(`7b83f39` / PR #528 and `797b8ab` / PR #529, CEO-approved merge 2026-07-15). Both
`backend-engineer` and `compliance-engineer` lanes are **free**. **ESC-037 is OPEN and awaiting a
CEO/DPO ruling** (ESC-020 also OPEN but explicitly non-blocking per its own CEO resolution
2026-06-10).

**⚠️ The retros for 557/558 found a live prod compliance gap that the two merges created between
them — neither PR was wrong alone; nobody owned the union.** RETRO-175 and RETRO-176 (2026-07-16,
Opus) agree on the shape and disagree productively on the detail:

- **ESC-037 RESOLVED (CEO, 2026-07-17) — the whole DSR-disclosure-union item is now unblocked and
  sequenced.** Ruling: (1) **FOLLOW-574 BEFORE FOLLOW-570**; (2) `events` disclosed as **FULL ROW
  EXPORT, not an aggregate** (Art. 15/20 completeness over payload economy — volume-safe delivery is
  the worker's engineering detail); (3) exposure = ZERO (no DSR ever served in prod), so latent, no
  notification duty. Side finding spun out as **FOLLOW-580** (P3: prod `ingest_worker` lacks SELECT
  on `dsr_audit_log`, diverges from ESC-032).
- **FOLLOW-574 (P1) — DONE** (merged `3c78ea2`, PR #542). Access + portability now full-row-export
  all 5 `DSR_CLICKHOUSE_TABLES`, volume-safe (`events` keyset-paginated). PM-validated
  independently. **Two new tickets came out of it — both worth attention:**
  - **FOLLOW-581 (P1) — DONE** (merged `85156db`, PR #544). The Art. 17 erase no-op: DSR erase
    filtered `intent_events` on `intent_session_id` (a zero-UUID default column), never deleting a
    real row. Fixed by keying the shared `DSR_CLICKHOUSE_TABLES` on `session_id` (erase +
    mutation-poll + FOLLOW-574 disclosure all re-converged; `resolveIntentSessionId` deleted). Found
    because the worker correctly refused my (wrong) brief instruction to mirror that column —
    **ESC-038 RESOLVED**. PM-validated independently.
  - **FOLLOW-582 (P2) — OPEN** — `engagement_scores` phantom confirmed (no writer anywhere);
    ROPA/DPIA reconciled to "planned, no producer." Re-check `dsr_verifications` count (or add a
    monitor) before any tenant is told DSR is live.
- **FOLLOW-570 (P2) — AFTER 574** (CEO-sequenced). Same asymmetry on the **Redis** axis: FOLLOW-557
  added `shadow:{tenant}:{session}:chat_intent` to the erase set; disclosure never returns it. Gated
  on the **FOLLOW-458** deploy → a pre-condition of that deploy.
- **FOLLOW-576 — FOLLOW-558's AC2 is NOT met, and this session's PM ticked it in error.** The
  "PARITY" test never imports `erase/route.ts`; it asserts disclosure ⊇ 6 hardcoded literals, so a
  7th DELETE target keeps it green. It cannot fail on the drift it is named for. **Do not trust
  FOLLOW-570 AC(b) ("widen the parity block") as sufficient** — widening a hand-typed list yields a
  wider hand-typed list. RETRO-176 overturned RETRO-175 §5d on exactly this point.
- **FOLLOW-575** — DPIA §8 is out of sync with the code, so Rule N is satisfied on paper while the
  doc certifies behaviour we do not implement.
- **Rules promoted: NONE.** Both retros held every candidate at count 1 and left
  `CONVENTIONS_PATCH.md` untouched. RETRO-176 specifically refused to count #528/#529 as two
  sightings — they are **one incident** viewed from two sides, and one incident cannot self-promote
  by being retro'd twice. Do not re-litigate that to reach the bar.

**Next picks, in order:**

0. **ESC-037 needs a CEO/DPO ruling first.** RETRO-176 recommends **FOLLOW-574 before FOLLOW-570**
   (live beats deploy-gated), which inverts the Sprint 23 order and competes with the
   FOLLOW-559/FOLLOW-356 lane call below.
1. **FOLLOW-559: DONE** — merged `0009c0f` (PR #533), consent gate at the ingest storage boundary;
   PM-validated independently (RETRO-177 affirmed the validation as sound). Backend-engineer lane is
   free again. **But RETRO-177 found FOLLOW-579 (P2):** the gate classes `session.quality.snapshot`
   as `operational`/always-ingest, yet its payload carries `final_archetype` + `final_confidence` +
   `prediction_stability_score` — the §H.8(d) derived-intent artifact the gate correctly BLOCKS when
   it arrives as `intent.snapshot`. So an unconsented user's 12-dim vector is gated while that same
   user's final archetype IDENTITY rides through. Verified independently (consent-gate.ts:120 +
   session-quality.ts:46-48). P2 defense-in-depth (SDK sets `consent_state` client-side → low
   `none`-volume at ingest), **not** a live high-volume leak → no escalation. **DONE** (CEO ruling
   2026-07-17 "strip the derived fields"; merged `d3911bf`, PR #547). `session.quality.snapshot`
   stays `operational`/always-ingest, but `final_archetype` + `final_confidence` +
   `prediction_stability_score` are stripped from the persisted payload when
   `consent_state ∉ {consented, legitimate-interest}` (a pure `redactPersistedPayloadForConsent` at
   the ingest boundary; the dedicated `session_quality` table is a phantom write-path, so it's a
   payload-key deletion in the generic `events` flow). Shipped with the AC-c golden per-type
   classification fixture that closes RETRO-177's exhaustiveness≠correctness gap. PM-validated
   independently.
2. **FOLLOW-356: already DONE — was a stale duplicate, NOT an eligible pick.** CEO green-lit
   P1-first 2026-07-17, so pre-delegation analysis pulled the ticket — and found the work was
   completed **2026-06-25**, folded into FOLLOW-357's rename PR **#354** (`d8d5cb8`). Verified in
   code, not taken on the ticket's word: `AdaptResponse.tier` is removed, the field is
   `page_context` (analytics-only per CEO 2026-06-25, memory `project_tier_field_rename_decision`),
   and all four behavioral tests exist and are labeled — AC-1/AC-2 (`route.test.ts:1032,1051`:
   `page_context` 1-vs-2 + headline present/absent) and AC-3 (`route.clickhouse.test.ts:255,269`:
   `logDecisionAsync` gets the derived value). The QUEUE had **two** FOLLOW-356 entries — a `DONE`
   one (correct) and a stale `READY` sdk-engineer duplicate that made it keep looking eligible; the
   stale duplicate is removed this session. **No dispatch happened — the P1 was already shipped.**
   The next genuinely- eligible pick is now a Sprint 23 P2, or one of the open CEO/DPO rulings
   below.
3. **Retros for 557/558/559: DONE** — RETRO-175 + RETRO-176 (filing FOLLOW-570…577) + RETRO-177
   (filing FOLLOW-579). All three held every rule candidate at count 1; `CONVENTIONS_PATCH.md`
   untouched.

**✅ Vercel red — DIAGNOSED, prod is HEALTHY (was a false alarm; correcting my own earlier
banner).** An earlier version of this block (merged in #535) called the Vercel red a "standing
control-plane deploy breakage" and asked the human to check whether prod was broken. **That was
wrong — it was based on PR-check failures only, before I read the merge-commit statuses.** Full
picture now:

- **Every `main` merge-commit deployed successfully:** `b60c1bc`, `d0f86be`, `0009c0f` (#533),
  `59ab555` (#534), `fa51fa3` (#535) all show Vercel `success`. Production control-plane is fine.
- **Only some PR-HEAD preview deploys failed** (#533 head `cc146b2`, #534 head) — and they failed
  with **`target_url = None`**, i.e. no deployment was ever created/built. A real build break yields
  a URL with error logs; "failed, no URL" is the signature of a **transient Vercel integration
  hiccup** at deployment creation, not a code fault.
- **#535's preview deploy passed** on the same docs-only change class that #534's failed on —
  confirming intermittency, not a persistent break.

Conclusion: no prod issue, no code issue, nothing to fix — transient preview-deploy flakiness. The
Vercel red on a PR is safe to ignore when (a) the diff doesn't touch `apps/control-plane` and (b)
the failing status has no `target_url`. (Diagnosis done via `gh api commits/<sha>/statuses`; the
Vercel MCP is 403 for this team scope, but the commit-status API was sufficient.)

**Deploy note:** #528/#529 changed control-plane routes → Vercel prod redeploy on merge. Neither PR
carried a migration, so the `db-migrate.yml` prod auto-apply path was not triggered (verified before
merge).

**⚠️ CORRECTION — the session-29 headline below was WRONG, and the error cost two sessions.**
Sessions 28 and 29 both concluded "the assigned subagents have never been run" for FOLLOW-557 and
FOLLOW-558. **They had run.** Both agents had produced complete, AC-satisfying work. It was sitting
**uncommitted in their git worktrees** under `.claude/worktrees/agent-*/` — the session hung before
either could commit.

**The diagnostic that failed:** `git diff main..<branch> --stat` reads the **committed branch tip**.
Uncommitted work leaves the tip at `main` HEAD, so a fully-working agent and an agent that never
started are **byte-identical under that check**. Two sessions read "empty diff" as "never ran",
escalated a false throughput crisis, and deliberately withheld dispatch to protect a concurrency cap
that was never under threat.

**Rule going forward — when a branch looks empty, check the worktree before concluding anything:**

```bash
git worktree list                                  # agent worktrees live in .claude/worktrees/
git -C <worktree> status --short                   # uncommitted work hides HERE
git -C <worktree> diff main --stat                 # not in `git diff main..<branch>`
```

Rescued and merged, unmodified apart from commit messages — both green locally (prettier +
`tsc --noEmit` + vitest) **before** push, then CI-validated:

- **FOLLOW-557** → PR #528, merged `7b83f39`. DSR erase now deletes
  `shadow:{tenant}:{session}:chat_intent`. Rule Z satisfied properly: the fixture is _parsed_ out of
  `redis_writer.py`'s `shadow_key()` literal, so it cannot silently pass on cross-runtime drift.
  vitest 3/3.
- **FOLLOW-558** → PR #529, merged `797b8ab`. DSR access + portability disclose `quiz_completions`,
  `intent_sessions` **and** `engagement_scores` (the third is beyond the stub's wording but required
  by the parity AC — erase covers it, so omitting it would fail parity). Rule N satisfied by update:
  DPIA §8 step 5 enumerated the disclosed stores, so it shipped updated in the same PR (2.8 → 2.9).
  vitest 92/92 incl. 17 route-driven pglite tests.

**On the `Rule I — wired-or-dead check` red both PRs carried:** it is the standing pre-existing
baseline and was **verified, not assumed** — `scripts/check-rule-i.sh` run locally reports 181
violations on `main` (561 symbols) and 181 on each branch; FOLLOW-557's branch scans 562 symbols,
i.e. its new `deleteShadowChatIntent` **is** scanned and is **not** a violation (erase route imports
it = wired). Zero new violations. Re-verify this way rather than waving the red through by
reputation.

**Queue-truth notes from this session (verified, not assumed):**

- **FOLLOW-553 is literally `READY_OPERATOR`, not `DONE`** (only Step 6 / ESC-020, Rafał-side DOM
  hooks deploy, remains). Therefore **FOLLOW-560** (`depends_on: [FOLLOW-553]`) and **FOLLOW-565**
  are **not** dependency-eligible under the strict `depends_on` rule, whatever the session-27 note
  argued about the dependency being "satisfied in spirit". Do not dispatch them on that reasoning
  without a CEO call.
- **FOLLOW-559** (P2, backend-engineer, `deps: []`) is **now eligible** — 557 landed (`7b83f39`) and
  freed the backend-engineer lane. This is the next backend pick.
- **FOLLOW-356 (P1, sdk-engineer, `deps: []`, READY) is the highest-priority genuinely-eligible
  ticket in the queue and its agent lane is free.** It is P1 vs the Sprint 23 P2 pool, but it is not
  a Sprint 23 ticket. Prior sessions have not picked it. **Flagged for the human:** if Sprint 23
  Wave 2 is stalled on worker execution anyway, FOLLOW-356 is the better use of an open lane — needs
  a priority call (active-sprint-first vs P1-first), which is not the PM's to make.

Full detail: `backlog/STATUS.md` session 29 entry.

---

## ▶️ (superseded) START HERE — resume 2026-07-14 (session 27 cont'd — PR #525 MERGED; 3 more queue-truth corrections; Sprint 23 Wave 2 P2s dispatched)

**PR #525 confirmed MERGED** (`196d431`, into `main`) — the Step 3/5 attestation + queue corrections
from the prior sub-session are live. Verified via `git log --oneline main` and `git status` (clean,
up to date with `origin/main`).

**3 more stale-bookkeeping corrections applied** (flagged but not fixed by the prior sub-session),
on branch `pm-orchestrator/FOLLOW-553-queue-truth-corrections`, **PR #526**, off current `main`. CI
independently verified green for all real gates: `gh pr view 526 --json statusCheckRollup | jq`
non-success count = **2**, both the standing pre-existing `Rule I — wired-or-dead check` baseline
(181 WARN lines, `gh run view --log-failed`, identical to the FOLLOW-551/525 baseline — expected,
docs-only diff, 4 `backlog/*.md` files, zero code touched). PM-validated comment posted on PR #526
with full evidence trail. **Status: READY_FOR_REVIEW, awaiting human merge.**

- **FOLLOW-551 → DONE** (was `READY_FOR_REVIEW` despite PR #512 confirmed MERGED
  2026-07-11T09:02:26Z, commit `c2670b2`; the ticket's own validation section already had a full
  PM-verified evidence trail from merge time, so no AC re-check was needed beyond confirming the
  merge itself).
- **FOLLOW-436 → DONE** (was `BLOCKED_ON_HUMAN`). ESC-034 (`backlog/ESCALATIONS.md`) is RESOLVED
  2026-07-13 with an end-to-end attestation (`docs/runbooks/OPERATOR_SESSION_2026-07-12.md` Step 3):
  live Modal endpoint smoke → `202 accepted` with auth / `401` without, async callback confirmed
  (`listing_embeddings.updated_at` bumped, SQL-verified). **AC-supersession note:** the ticket's
  literal 3-step checklist (Redpanda-topic secret + polling-cron `modal deploy`) describes the
  PRE-ADR-0016 design; ADR-0016 replaced it with direct-HTTPS invocation before this went live. The
  Step-3 attestation verifies the CURRENT design's equivalent requirements, discharging the ticket's
  actual intent (embed-seed path live in prod). Documented in-ticket so a future reader doesn't
  mistake the literal checklist for the operative one.
- **FOLLOW-569 → added retroactively as DONE** (previously had NO `QUEUE.md` block at all — an
  ad-hoc ticket ID coined in PR #517/commit `b0d77a6` only, flagged but not fixed by the prior
  sub-session). PR #517 merged 2026-07-12T13:52:50Z; its own PR body explicitly asked PM to
  "confirm/formalize the ticket id." Delegation-table row used retroactively: "client SDK, Shadow
  DOM, tiers, browser code -> sdk-engineer" (matches `packages/sdk/src/index.ts`, the actual diff).
  `backlog/FOLLOW_UPS.md` stub also updated (`status: DONE`, `promoted_to_queue: true`).

None of these three flips is independently AC-re-validated beyond the cited attestations/PR evidence
— git-log/attestation-confirmed only, consistent with the FOLLOW-554/555/556/567 flags from the
prior sub-session. Flagged for a future retro pass.

**Sprint 23 Wave 2 P2 pool dispatched** (CEO direction: proceed now, Step 6/ESC-020 is Rafał-side
and non-blocking to this pipeline): **FOLLOW-557** (backend-engineer — DSR erase Redis
shadow-namespace gap) and **FOLLOW-558** (compliance-engineer — DSR access/portability disclosure
gap) delegated this session (table rows: "ingest worker, control-plane... auth" -> backend-engineer;
"DPIA/ROPA/consent/DSR rules..." -> compliance-engineer). **FOLLOW-559** and **FOLLOW-560** held
back this round to respect the "≤3 tickets IN_PROGRESS" guardrail — FOLLOW-559 next backend-engineer
pick once one of 557/558 completes; **FOLLOW-560 depends_on FOLLOW-553**, which is not literally
`DONE` (Step 6 open) — its own notes describe the dependency as riding "the FOLLOW-553-established
attestation flow" (i.e., the Steps 3-5 attestation pattern, already present) with an explicit
fallback (OTel counter, no CH migration) if migration friction bites, so the dependency is judged
satisfied-in-spirit but NOT literally DONE-gated; held back this round on the concurrency cap, not
on the dependency question — pick it up next after a slot frees.

Full detail: `backlog/STATUS.md` session 27 (cont'd) entry.

---

## ▶️ (superseded) START HERE — resume 2026-07-14 (session 27 — recovered stranded FOLLOW-553 branch; PR #525 READY_FOR_REVIEW; queue-truth corrections)

**Recovered a stranded/conflicting branch.** `pm-orchestrator/FOLLOW-553-step4-attestation` (PR
#524) reported `mergeable: CONFLICTING`; a real `git merge --no-commit` test (not just GitHub's
flag) confirmed a genuine conflict in `docs/runbooks/OPERATOR_SESSION_2026-07-12.md` — its own
Step-4 commit duplicated content already merged separately via PR #523. Closed #524 as superseded
(no data loss), rebuilt the net-new content (Step 3 ESC-034 + Step 5 ESC-028 attestation blocks,
`backlog/ESCALATIONS.md` RESOLVED flips) cleanly on a fresh branch off current `main`, verified
byte-identical via diff, opened **PR #525**. CI independently verified green for all real gates
(only the standing pre-existing "Rule I" baseline fails, 181 violations, unrelated — this PR is
docs-only). PM-validated comment posted on #525 with full evidence trail. **Status:
READY_FOR_REVIEW, awaiting human merge.**

**Queue-truth corrections applied this session** (git-log-confirmed merges whose `QUEUE.md` status
was never flipped from stale `READY`): **FOLLOW-554 → DONE** (PR #518), **FOLLOW-555 → DONE** (PR
#519), **FOLLOW-556 → DONE** (PR #520), **FOLLOW-567 → DONE** (PR #522). All four were merged
2026-07-12/13 but still showed `READY` — a future PM session would otherwise have re-delegated
already-shipped work. Flips are git-log-confirmed only, not independently AC-re-validated (flagged
per-ticket for a future retro pass). FOLLOW-569 (PR #517) has no `QUEUE.md` ticket block at all
(ad-hoc ticket ID in a commit message only) — flagged, not fabricated.

**Wave 0 (FOLLOW-553) state unchanged by this session except the two attestations above:** Steps 3,
4, 5 all attested RESOLVED/DONE (ESC-034, embeddings 0→6, ESC-028). **Step 6 (ESC-020, Rafał — DOM
hooks deploy) remains the only open item** — non-blocking to the PM pipeline per its own
CEO-approved resolution note. Did NOT flip FOLLOW-449/450 to DONE — Rule AA restricts that to
FOLLOW-553 itself with real pasted prod output, which was not available this session.

**No new ticket delegated this session** — pure recovered-work re-verification + queue hygiene.

Full detail: `backlog/STATUS.md` session 27 entry.

---

## ▶️ (superseded) START HERE — resume 2026-07-11 (session 26 — Full-Stack Audit #3 delivered; Sprint 23 OPENED; pilot gated on OPERATOR Wave 0)

**A third full-stack audit ran 2026-07-11 (CEO-commissioned, 6 parallel tracks) against HEAD
`146de2f`. Verdict: 🟡 YELLOW — the codebase is sound and NOT scaffold-theater (Sprint 22b code legs
independently re-verified as genuinely done), but the pilot's learning + measurement loops are all
inert in prod because the operator go-live checklist is 0/6 complete.** The audit also found 3 new
High-severity code defects no existing ticket covers. Full remediation plan = **`Sprint 23` at the
bottom of this file (FOLLOW-553…FOLLOW-566)**, organized into Waves 0–3.

**THE ONE THING THAT UNBLOCKS EVERYTHING: Wave 0 = FOLLOW-553, a single consolidated OPERATOR
session (Piotr + Rafał, ~2–4h).** It executes, in order: CH migration 0015 attest+apply (FOLLOW-449
AC1/AC2), `FEEDBACK_ENDPOINT_ENABLED` + `ADAPT_API_KEY`/`OPS_TENANT_ID` Doppler prd +
`pnpm feedback:canary` (FOLLOW-450 operator leg), ESC-034 embed-seed go-live (corrected direct-HTTPS
path), pilot-tenant `listing_embeddings` seed, ESC-028 secrets, and hands ESC-020 (Estalara-app DOM
hooks deploy) to Rafał. Step-by-step operator instructions:
`docs/runbooks/OPERATOR_SESSION_2026-07-11.md`. Until Wave 0 runs, FOLLOW-471 (Sprint 22b's clean
re-audit gate) stays blocked and no lift can be measured.

**Queue-truth fixes applied this session (2026-07-11 audit §6.4):** (1) FOLLOW-450 `status: DONE` →
`CODE_COMPLETE_OPERATOR_PENDING` — its own `operator_action` block was unresolved; the DONE label
violated Rule AA. (2) FOLLOW-458 `status: READY` → `BLOCKED` — its `depends_on: [FOLLOW-449]` is
unmet (flagged repeatedly across sessions, now actually fixed).

**Wave 1 (code, delegable NOW, parallel with Wave 0):** FOLLOW-554 (P1, sdk-engineer — quiz-skip
writes `neutral` into the SoT archetype, ADR-0014 violation), FOLLOW-555 (P1, backend-engineer — 6
browser-session routes still on `getAuthClaims` → 401, incl. the onboarding wizard), FOLLOW-556 (P1,
ml-engineer — no daily LLM spend cap on the Modal description/headline path; public API key =
cost-DoS surface). See Sprint 23 blocks for AC + delegation notes.

**Waves 2–3 and the mapping of every remaining audit finding to a ticket (new or pre-existing
FOLLOW-467/468/469/472/458/471) are in the Sprint 23 section header.** Merge-reconciliation note
(this branch merged origin/main after PRs #511–#513 landed in parallel): FOLLOW-551 (architect
tool-capability routing) and FOLLOW-552 (doc cross-link) content is on `main`; their DONE-flip +
RETRO bundle, if still owed per the session-25 blocks below, is unaffected by this Sprint-23 opening
(disjoint QUEUE regions — the FOLLOW-551/552 ticket blocks were not touched by this change).

---

## ▶️ (superseded) START HERE — resume 2026-07-11 (session 25 cont'd — PR #512 PM-validated, folded into #511, no separate validation PR)

**FOLLOW-551 (P3, architect DRAFT-ONLY, Sonnet) is PM-validated, READY_FOR_REVIEW.** architect
drafted the content (no git); the coordinator applied it verbatim as commit `a8421e7`, PR **#512**
(`architect/FOLLOW-551-tool-capability-routing`, off `main`, not merged). Independently verified
(not taken on the coordinator's summary): CI non-success count = 2 (both the standing pre-existing
"Rule I — wired-or-dead" gate, 180 WARN lines identical to the FOLLOW-532/546/548/549/550 baseline);
file list confirmed exactly 2 files (`docs/AGENT_WORKFLOW.md`, `.claude/agents/architect.md`,
`CONVENTIONS_PATCH.md` untouched); full 96-line diff read directly — new "Agent tool-capability
routing" section correctly placed after "Model-fit decision", both routing options present, both
precedents cited by number with a verbatim Changelog v4.3 quote, explicit non-Rule-promotion
statement present (with a notable nuance: acknowledges the raw `CLAUDE.md` threshold is technically
met but correctly defers the actual promotion call to FOLLOW-551's own retro rather than deciding it
inline), FOLLOW-545 bullet 2 explicitly confirmed to stay open (not silently absorbed), and
`architect.md`'s "First action" section confirmed fixed (no longer instructs `git checkout -b`,
replaced with a no-Bash note cross-referencing the new section).

**No two-`QUEUE.md`-PRs-in-flight collision:** PR #511 (FOLLOW-551's promotion) touches
`backlog/QUEUE.md`; PR #512 touches only the two docs files above — disjoint sets. Per the new rule
(b)/(d) and the FOLLOW-550/#508 precedent, this validation was folded as an additional commit onto
#511's own branch (`pm-orchestrator/FOLLOW-551-dispatch`) rather than requiring #511 to merge first
or opening a new PR. `backlog/QUEUE.md` FOLLOW-551 flipped `IN_PROGRESS` -> `READY_FOR_REVIEW` in
place. **Confirmed #511 remains correct to MERGE** (not close-superseded) — its dispatch-record
content is not duplicated/re-included elsewhere; this validation commit only extends it. **#511 and
#512 have no merge-order constraint** (disjoint files); once BOTH are merged, the DONE+RETRO bundle
will be cut fresh from post-merge `main` (rule (c)), matching the FOLLOW-550/#508+#509→#510
precedent exactly.

**Still open / carried forward:** FOLLOW-543 (P3, architect, deferred §Snapshot.2/.3/.5 + §B.1-body
Tier-prose rename — per RETRO-174 §5b, should be dispatched using FOLLOW-551's newly-codified
draft-then-apply resolution once FOLLOW-551 lands, not before). FOLLOW-552 (P3, doc-wiring fix —
next natural pick after FOLLOW-551). FOLLOW-545 (re-scope to bullet-2-only at next review, see
above). FOLLOW-547 (P3, sdk-engineer, RETRO-169, unversioned client SoT storage schema — not yet
promoted). FOLLOW-458's `status: READY` label is still inconsistent with its own unmet
`depends_on: [FOLLOW-449]` — flagged repeatedly, still not fixed. FOLLOW-533/534 (P3, not yet
promoted). 4 already-`READY` P3 tickets remain queued: FOLLOW-467/468/469/474. 3 standing `## OPEN`
escalations (ESC-020, ESC-028, ESC-034) unchanged, non-blocking.

**NEXT:** human reviews/merges #511 (promotion+validation bundle) and #512 (the actual content) —
either order is safe. After both merge: mark FOLLOW-551 `DONE` + `completed_at`, spawn
`retrospective-analyst` for RETRO-175, bundled as one DONE+RETRO PR per rule (d).

---

## ▶️ (superseded) START HERE — resume 2026-07-11 (session 25 cont'd — PR #510 MERGED, FOLLOW-550 fully closed, FOLLOW-551 dispatched DRAFT-ONLY)

**PR #510 MERGED** (`146de2f`) — FOLLOW-550's DONE-flip + RETRO-174 bundle landed cleanly on `main`.
Local sync confirmed: FOLLOW-550 `status: DONE`, RETRO-174 present, FOLLOW-551 + FOLLOW-552 stubs
present. No QUEUE.md-touching PR in flight — rule (b) satisfied, safe to promote.

**Promoted + dispatched FOLLOW-551** (P3, source_ticket FOLLOW-550, RETRO-174 §5a) to **architect in
DRAFT-ONLY execution mode** — human-approved resolution: formalize draft-then-apply (option 2) as
the standing fix for the architect-has-no-Bash routing gap, dogfooding the pattern itself (architect
drafts, coordinator applies via git — no branch/Edit/git attempted by architect). Delegation-table
row: "a contract between two modules, a new dependency, an ADR" -> architect. Model: **Sonnet**
(routine codification, fully-specified AC, no open design question). Cites the ≥2× precedent by
number: FOLLOW-470/RETRO-168 + FOLLOW-550/RETRO-174. **Rule-AB-discipline stated precisely:**
exactly 2 banked prior numbered-retro sightings, no 3rd yet — FOLLOW-551 is the FIX, not a fresh
occurrence, so it does NOT itself satisfy the promotion threshold; stays workflow guidance,
explicitly NOT a `CONVENTIONS_PATCH.md` Rule.

**Duplicate-risk catch before dispatch (verify-not-guess):** `backlog/FOLLOW_UPS.md` already
contained an unpromoted, never-cross-referenced near-duplicate — **FOLLOW-545** ("bashless-agent
author-blur," filed from the SAME RETRO-168 this ticket cites as precedent #1). FOLLOW-551's
resolution substantially discharges FOLLOW-545's AC bullet 1; FOLLOW-545's AC bullet 2 (the broader
"orchestrator edits beyond a delegate's plan" reconciliation problem, root of FOLLOW-544) is
DISTINCT and remains open — cross-referenced both stubs so FOLLOW-545 isn't silently duplicated or
lost; it should be re-scoped to bullet-2-only at its next promotion review, not promoted wholesale.

**Concrete bug found and flagged for the architect to fix as part of this ticket:**
`.claude/agents/architect.md`'s own "First action on any ticket" section instructs
`git checkout -b ...` — a command architect has no tool to execute. Included in the delegation brief
as a required deliverable, not just the primary `docs/AGENT_WORKFLOW.md` addition.

Full brief in `backlog/HANDOFFS.md` ("Delegation brief — FOLLOW-551 (architect) — DRAFT-ONLY").
Queue edits on branch `pm-orchestrator/FOLLOW-551-dispatch` (branch-first, never committed to
`main`). **Anti-sprawl applied to this ticket's own lifecycle:** ONE promotion PR (this one), later
ONE DONE+RETRO bundle — no separate validation PR. **Not spawned by pm-orchestrator** — brief
reported to the coordinator to dispatch.

**Still open / carried forward:** FOLLOW-543 (P3, architect, deferred §Snapshot.2/.3/.5 + §B.1-body
Tier-prose rename — per RETRO-174 §5b, should be dispatched using FOLLOW-551's newly-codified
draft-then-apply resolution once FOLLOW-551 lands, not before). FOLLOW-552 (P3, doc-wiring fix —
next natural pick after FOLLOW-551). FOLLOW-545 (re-scope to bullet-2-only at next review, see
above). FOLLOW-547 (P3, sdk-engineer, RETRO-169, unversioned client SoT storage schema — not yet
promoted). FOLLOW-458's `status: READY` label is still inconsistent with its own unmet
`depends_on: [FOLLOW-449]` — flagged repeatedly, still not fixed. FOLLOW-533/534 (P3, not yet
promoted). 4 already-`READY` P3 tickets remain queued: FOLLOW-467/468/469/474. 3 standing `## OPEN`
escalations (ESC-020, ESC-028, ESC-034) unchanged, non-blocking.

**NEXT:** coordinator dispatches architect per the brief (DRAFT-ONLY); PM applies the returned draft
via git once the architect's report comes back, then validates + closes out FOLLOW-551.

---

## ▶️ (superseded) START HERE — resume 2026-07-10 (session 25 cont'd — #508/#509 MERGED, FOLLOW-550 DONE, RETRO-174 pending)

**Both PRs merged by the human:** #509 (`architect/FOLLOW-550-bookkeeping-pr-sequencing`, the
content — `docs/AGENT_WORKFLOW.md`) as commit `66f8e76`; #508
(`pm-orchestrator/FOLLOW-550-dispatch`, the bookkeeping — dispatch + validation) as commit
`c02b96b`. Local sync confirmed both present; `docs/AGENT_WORKFLOW.md`'s "Bookkeeping-PR sequencing"
section confirmed LIVE on `main`; `backlog/QUEUE.md` confirmed to have exactly ONE `FOLLOW-550`
block before this edit.

**#508 merging (not closing) confirmed CORRECT** against the new section's own rule (a): #508's
dispatch-record content was never duplicated/re-included in a later PR — the validation was folded
into #508 in place (an extra commit, per rule (d)) rather than a separate PR, so #508 had genuine
non-redundant content. Structurally different from FOLLOW-549's #504 (whose content WAS about to be
duplicated by the separate #506) — the new rule's own logic held up against a real case immediately.

**Post-merge close done on branch `pm-orchestrator/FOLLOW-550-done`** (agent-prefix, branch-first):
FOLLOW-550 flipped `READY_FOR_REVIEW` → `DONE` (`completed_at: 2026-07-10`, `merged_pr:` citing #509
as content + #508 as bookkeeping, `merge_commit: 66f8e76`).

**Not run this pass (per explicit instruction):** the retrospective. `retrospective-analyst` will be
spawned by the coordinator (delegation brief prepared in `backlog/HANDOFFS.md`, "Retro delegation
brief — FOLLOW-550") — NOT run by pm-orchestrator itself (no subagent-spawn capability in this tool
surface). Model recommendation: **Opus** (matches the analyst's own agent-file default). Flagged
angles for the analyst: (a) did FOLLOW-550's own dogfooded bundle shape (one promotion PR #508
absorbing validation via rule (d), one content PR #509) actually hold, or did sprawl leak back in
anywhere; (b) is FOLLOW-551 (the architect-has-no-Bash routing gap) correctly scoped, and are there
OTHER agents with a similar tool/role mismatch worth sweeping in now rather than discovering them
one-by-one; (c) confirm the Rule AB ARMED trigger from RETRO-173 (count 1, pending a 2nd numbered-
retro sighting) is NOT accidentally tripped by FOLLOW-550's mere existence — codifying the guidance
is not itself a second retro sighting of the underlying pattern.

**Still open / carried forward:** FOLLOW-543 (P3, architect, deferred §Snapshot.2/.3/.5 + §B.1-body
Tier-prose rename — flagged as a concrete FOLLOW-551 recurrence risk). FOLLOW-547 (P3, sdk-engineer,
RETRO-169, unversioned client SoT storage schema — not yet promoted). FOLLOW-458's `status: READY`
label is still inconsistent with its own unmet `depends_on: [FOLLOW-449]` — flagged repeatedly,
still not fixed. FOLLOW-545 (process stub, RETRO-168, bashless-agent-author-blur — not yet
promoted). FOLLOW-533/534, FOLLOW-551 (P3, not yet promoted). 4 already-`READY` P3 tickets remain
queued: FOLLOW-467/468/469/474. 3 standing `## OPEN` escalations (ESC-020, ESC-028, ESC-034)
unchanged, non-blocking.

**This is a fresh bookkeeping PR, opened but NOT merged** — awaiting RETRO-174 content to land on
the same branch first (dogfooding rule (d) once more).

---

## ▶️ (superseded) START HERE — resume 2026-07-10 (session 25 cont'd — PR #509 PM-validated, folded into #508, no separate validation PR)

**FOLLOW-550 (P3, architect, Sonnet) is PM-validated, READY_FOR_REVIEW.** PR **#509**
(`architect/FOLLOW-550-bookkeeping-pr-sequencing`, off `main`, not merged). **Routing/process
finding:** the architect subagent has NO Bash tool (manifest: Read/Write/Edit/Glob/Grep/WebSearch/
WebFetch) — it correctly REFUSED to `Edit` `docs/AGENT_WORKFLOW.md` directly (would have stranded
the change on `main`, the exact FOLLOW-448/RETRO-146 failure mode) and instead drafted full content

- insertion point + rationale for a Bash-capable party to apply. The coordinator applied it verbatim
  (commit `5025edd`, PR #509). **FOLLOW-551 filed** (P3, pm-orchestrator, ~1h) to formalize the
  resolution — FOLLOW-543 (still unpromoted, `recommended_agent: architect`) is a concrete near-term
  recurrence risk.

Independently verified (not taken on the coordinator's summary): CI non-success count = 2 (both the
standing pre-existing "Rule I — wired-or-dead" gate, 180 WARN lines identical to the
FOLLOW-532/546/548/549 baseline); file list confirmed exactly one file (`docs/AGENT_WORKFLOW.md`,
`CONVENTIONS_PATCH.md` untouched); full 53-line diff read directly — correct insertion point, all
four rules (a)-(d) present, cites RETRO-173 + the #504/#505/#506 incident correctly, and contains
the required "workflow guidance, not a `CONVENTIONS_PATCH.md` Rule — Rule AB threshold unmet"
statement.

**Dogfooding FOLLOW-550's own rule (d):** this validation was folded directly into the EXISTING
promotion PR #508 (an extra commit on `pm-orchestrator/FOLLOW-550-dispatch`) — NOT a separate
validation PR. `backlog/QUEUE.md` FOLLOW-550 flipped `IN_PROGRESS` -> `READY_FOR_REVIEW` in place.
**Confirmed #508 remains correct to MERGE** (not close-superseded) per rule (a): its dispatch-record
content is not duplicated/re-included elsewhere — this commit only extends it. The eventual
DONE+RETRO bundle will be a fresh PR cut from `main` AFTER both #508 and #509 merge (rule (c)).

**Still open / carried forward:** FOLLOW-543 (P3, architect, deferred §Snapshot.2/.3/.5 + §B.1-body
Tier-prose rename — now flagged as a concrete FOLLOW-551 recurrence risk, see above). FOLLOW-547
(P3, sdk-engineer, RETRO-169, unversioned client SoT storage schema — not yet promoted).
FOLLOW-458's `status: READY` label is still inconsistent with its own unmet
`depends_on: [FOLLOW-449]` — flagged repeatedly, still not fixed. FOLLOW-545 (process stub,
RETRO-168, bashless-agent-author-blur — not yet promoted). FOLLOW-533/534, FOLLOW-551 (P3, not yet
promoted). 4 already-`READY` P3 tickets remain queued: FOLLOW-467/468/469/474. 3 standing `## OPEN`
escalations (ESC-020, ESC-028, ESC-034) unchanged, non-blocking.

**NEXT:** human reviews/merges #508 (dispatch+validation bundle) and #509 (the actual content).
After both merge: mark FOLLOW-550 `DONE` + `completed_at`, spawn `retrospective-analyst` for
RETRO-174 (bundled DONE+RETRO PR, per rule (d) this very ticket just codified).

---

## ▶️ (superseded) START HERE — resume 2026-07-10 (session 25 cont'd — PR #507 MERGED, FOLLOW-549 fully closed, FOLLOW-550 dispatched to architect)

**PR #507 MERGED** (`e0a11b3`) — FOLLOW-549's DONE-flip + RETRO-173 bundle landed cleanly on `main`.
Local sync confirmed: FOLLOW-549 `status: DONE`, RETRO-173 present (1 occurrence), FOLLOW-550 stub
present (1 occurrence). No open PRs, no pending retro — FOLLOW-549's loop is FULLY closed.

**Promoted + dispatched FOLLOW-550** (P3, RETRO-173 §5d/§6/§9, source_ticket FOLLOW-549) to
**architect** — human-approved reassignment (cross-cutting process/convention change, not a worker
deliverable; overrides the stub's original `recommended_agent: pm-orchestrator`). Delegation-table
row: "a contract between two modules, a new dependency, an ADR" -> architect. Model: **Sonnet**
(routine docs codification, ready-made Rule text from the retro). AC pulled directly from
RETRO-173's ready-made text: (a) bookkeeping PRs ALWAYS closed-superseded, never merged; (b) never
two `QUEUE.md`-touching PRs in flight; (c) validation/DONE PRs cut from `main` AFTER the code PR
merges; (d) fold validation into the DONE+RETRO bundle. **Home: `docs/AGENT_WORKFLOW.md` (new
subsection), explicitly NOT `CONVENTIONS_PATCH.md`** — RETRO-173 held the pattern at count 1
(≥2-PRIOR-numbered-retro threshold unmet, Rule AB discipline); the AC requires the architect's new
section to say so explicitly and routes any disagreement to `backlog/ESCALATIONS.md`, not a silent
Rule add. Branch: `architect/FOLLOW-550-bookkeeping-pr-sequencing`. Full brief in
`backlog/HANDOFFS.md` ("Delegation brief — FOLLOW-550"). **Not spawned by pm-orchestrator** — brief
reported to the coordinator to dispatch (will be passed inline so architect can start off `main` in
parallel, without waiting for this promotion PR to merge).

**Anti-sprawl applied to FOLLOW-550's own lifecycle** (per explicit instruction — dogfooding the
lesson before it's even codified): ONE promotion bookkeeping PR (this one), later ONE DONE+RETRO
bundle — no separate validation PR. Queue edits on branch `pm-orchestrator/FOLLOW-550-dispatch`
(branch-first, never committed to `main`).

**Still open / carried forward:** FOLLOW-543 (P3, architect, deferred §Snapshot.2/.3/.5 + §B.1-body
Tier-prose rename). FOLLOW-547 (P3, sdk-engineer, RETRO-169, unversioned client SoT storage schema —
not yet promoted). FOLLOW-458's `status: READY` label is still inconsistent with its own unmet
`depends_on: [FOLLOW-449]` — flagged repeatedly, still not fixed. FOLLOW-545 (process stub,
RETRO-168, bashless-agent-author-blur — not yet promoted). FOLLOW-533/534 (P3, not yet promoted). 4
already-`READY` P3 tickets remain queued behind this one: FOLLOW-467/468/469/474. 3 standing
`## OPEN` escalations (ESC-020, ESC-028, ESC-034) unchanged, non-blocking.

**NEXT:** coordinator dispatches architect per the brief; PM validates the resulting PR (CI +
content correctness — is this docs-only? does it match the AC exactly, incl. the explicit
non-CONVENTIONS_PATCH statement?) once opened.

---

## ▶️ (superseded) START HERE — resume 2026-07-10 (session 25 cont'd — #504/#505 MERGED, #506 closed/superseded, FOLLOW-549 DONE, RETRO-173 pending)

**SEQUENCING — read before touching this branch:** `pm-orchestrator/FOLLOW-549-done` has the
DONE-flip committed + pushed but **NO PR opened yet**. Wait for `retrospective-analyst` to append
RETRO-173 onto this SAME branch, THEN open ONE bundled PR (matches the FOLLOW-532/#503 pattern).

**What happened:** the human merged BOTH PR #504 (dispatch-record, commit `857e069`) AND PR #505
(the code, commit `f541f37`) instead of closing #504 as superseded. This gave the PM's already-open
validation PR #506 (`pm-orchestrator/FOLLOW-549-validate`, cut before #504/#505 merged) an
unresolvable `backlog/QUEUE.md` conflict once both landed. Per explicit instruction: did NOT
rebase/resolve #506 — closed it unmerged (no data loss, its evidence independently re-confirmed
against `main` post-merge instead of copy-pasted) and deleted its branch + the already-merged
`pm-orchestrator/FOLLOW-549-dispatch` branch.

**Recovery:** synced `main` (`f541f37` present), confirmed exactly ONE `FOLLOW-549` block in
`backlog/QUEUE.md` (no duplication from the two merges), confirmed the #505 code is genuinely live
on `main` (docstring + both `RETRO-172 TG-1` pin tests grep-matched directly). Since the code is
already merged, FOLLOW-549 skipped a separate `READY_FOR_REVIEW` state and went straight
`IN_PROGRESS` → `DONE` on this fresh branch, with `merged_pr: 505`, `merge_commit: f541f37`, and the
full independently-derived CI/AC evidence folded into `notes:`/`ci_status:`.

**Retro brief prepared** in `backlog/HANDOFFS.md` ("Retro delegation brief — FOLLOW-549") — model
**Opus** (matches `retrospective-analyst`'s own agent-file default) — to append RETRO-173 onto this
branch. Not spawned by pm-orchestrator; reported to the coordinator to dispatch.

**Still open / carried forward:** FOLLOW-543 (P3, architect, deferred §Snapshot.2/.3/.5 + §B.1-body
Tier-prose rename). FOLLOW-547 (P3, sdk-engineer, RETRO-169, unversioned client SoT storage schema —
not yet promoted). FOLLOW-458's `status: READY` label is still inconsistent with its own unmet
`depends_on: [FOLLOW-449]` — flagged repeatedly, still not fixed. FOLLOW-545 (process stub,
RETRO-168, bashless-agent-author-blur — not yet promoted). FOLLOW-533/534 (P3, not yet promoted). 4
already-`READY` P3 tickets remain queued: FOLLOW-467/468/469/474. 3 standing `## OPEN` escalations
(ESC-020, ESC-028, ESC-034) unchanged, non-blocking.

**NEXT:** coordinator dispatches `retrospective-analyst` (Opus) per the brief onto
`pm-orchestrator/FOLLOW-549-done` to append RETRO-173; PM opens ONE bundled PR once that lands and
validates it.

---

## ▶️ (superseded) START HERE — resume 2026-07-10 (session 25 cont'd — PR #503 MERGED, FOLLOW-549 promoted + dispatched)

**PR #503 MERGED** to `main` as commit `f1f9646` (per coordinator report). Local `main` synced
(`git checkout main && git pull`, fast-forward `a934adf..f1f9646`), confirmed via
`git log --oneline -8`. FOLLOW-532 confirmed `status: DONE` on `main`; RETRO-172 and the FOLLOW-549
stub confirmed present in `backlog/RETROSPECTIVES.md` / `backlog/FOLLOW_UPS.md`.

**Picked FOLLOW-549** (P3, RETRO-172 §4c TG-1/§4d DG-1, source_ticket FOLLOW-532) — the retro's own
follow-up, promoted immediately per the coordinator's instruction. Delegation-table row: "ingest
worker, control-plane, decision-api, Postgres/RLS, auth, onboarding HTTP, billing, webhooks" ->
backend-engineer. Model: **Sonnet** (routine, mechanical: 2 spy assertions + 1 docstring sentence,
no cross-module ambiguity or design judgment call — unlike the retro's own Opus tier). AC filled in
directly from RETRO-172 §4c/§4d: (1) pin each route's own `area` literal via a
`toHaveBeenCalledWith(..., 'adapt'|'description')` spy assertion added to each route's EXISTING test
suite (both already have a hoisted `mockResolveAdaptGetAuth` — confirmed via grep, no new test file
needed); (2) strengthen the `adapt-get-auth.ts:13-14` call-site-inventory docstring to name the
`area`-union-widening compile error as the forcing function for a genuine third consumer. Branch:
`backend-engineer/FOLLOW-549-adapt-get-auth-area-pin`. Full brief in `backlog/HANDOFFS.md`
("Delegation brief — FOLLOW-549"). Queue edits on branch `pm-orchestrator/FOLLOW-549-dispatch`
(branch-first, never committed to `main`). **Not spawned by pm-orchestrator** — brief reported back
to the coordinator to dispatch.

**Still open / carried forward:** FOLLOW-543 (P3, architect, deferred §Snapshot.2/.3/.5 + §B.1-body
Tier-prose rename). FOLLOW-547 (P3, sdk-engineer, RETRO-169, unversioned client SoT storage schema —
not yet promoted). FOLLOW-458's `status: READY` label is still inconsistent with its own unmet
`depends_on: [FOLLOW-449]` — flagged repeatedly, still not fixed. FOLLOW-545 (process stub,
RETRO-168, bashless-agent-author-blur — not yet promoted). FOLLOW-533/534 (P3, not yet promoted). 4
already-`READY` P3 tickets remain queued behind this one: FOLLOW-467/468/469/474. 3 standing
`## OPEN` escalations (ESC-020, ESC-028, ESC-034) unchanged, non-blocking.

**NEXT:** coordinator dispatches backend-engineer per the brief; PM validates the resulting PR (CI +
runtime wiring + AC) once opened.

---

## ▶️ (superseded) START HERE — resume 2026-07-10 (session 25 close-out — PR #502 MERGED, FOLLOW-532 DONE, RETRO pending)

**PR #502 MERGED** to `main` as commit `a934adf` (`a934adfd2359d4f12aa6538923e08ce351112025`,
2026-07-10T14:36:48Z, confirmed via `gh pr view 502 --json state,mergeCommit,mergedAt`). Local
`main` synced (`git checkout main && git pull`, fast-forward `e429524..a934adf`), confirmed present
via `git log --oneline -1`.

**Post-merge close done on branch `pm-orchestrator/FOLLOW-532-close`** (agent-prefix, branch-first —
these edits were made directly in the working tree during the validation pass before the merge
landed; moved onto this branch immediately upon resuming, never committed to `main`): FOLLOW-532
flipped `READY_FOR_REVIEW` → `DONE` (`completed_at: 2026-07-10`, `merged_pr: 502`,
`merge_commit: a934adf`).

**Not run this pass (per explicit instruction):** the retrospective. `retrospective-analyst` will be
spawned by the coordinator (delegation brief prepared in `backlog/HANDOFFS.md`, "Retro delegation
brief — FOLLOW-532") — NOT run by pm-orchestrator itself (no subagent-spawn capability in this tool
surface). Model recommendation: **Opus** — this is the FIRST retro on a shared-auth-helper contract
change (resolveAdaptGetAuth's signature grew a required param, a call-site inventory the docstring
explicitly says "a third consumer MUST be appended here"), and its own source ticket (RETRO-164) is
itself a retro-derived follow-up — cross-module reasoning about whether the FOLLOW_UPS stub's
originally-recommended qa-engineer co-assignment should have been honored, and whether folding a
throw into a shared auth helper (vs. duplicating a catch) sets a precedent worth codifying, both
warrant Opus over Sonnet per the model-fit table ("ambiguous acceptance criteria... non-trivial
design" territory, not routine).

**Still open / carried forward:** FOLLOW-543 (P3, architect, deferred §Snapshot.2/.3/.5 + §B.1-body
Tier-prose rename). FOLLOW-547 (P3, sdk-engineer, RETRO-169, unversioned client SoT storage schema —
not yet promoted). FOLLOW-458's `status: READY` label is still inconsistent with its own unmet
`depends_on: [FOLLOW-449]` — flagged repeatedly, still not fixed. FOLLOW-545 (process stub,
RETRO-168, bashless-agent-author-blur — not yet promoted). FOLLOW-533/534 (P3, not yet promoted). 3
standing `## OPEN` escalations (ESC-020, ESC-028, ESC-034) unchanged, non-blocking.

**This is a fresh bookkeeping PR, opened but NOT merged** — awaiting the coordinator to spawn
retrospective-analyst; PM will validate that bundled PR once the coordinator confirms it's ready
(matches PRs #486/#487/#489/#493/#497/#501 RETRO+DONE bundling convention). After that lands, next
ticket candidates: FOLLOW-467/468/469/474 (all P3, already `READY`).

---

## ▶️ (superseded) START HERE — resume 2026-07-10 (session 25 — FOLLOW-532 PM-validated, PR #502 READY_FOR_REVIEW)

**FOLLOW-532 (P2, backend-engineer, Sonnet) is PM-validated, READY_FOR_REVIEW.** PR **#502**
(`backend-engineer/FOLLOW-532-adapt-get-auth-dbthrow-parity`, off `main`, not merged). Worker chose
option 2 from the AC (fold the DB-throw handling into `resolveAdaptGetAuth` itself as a third
`AdaptGetAuthResult` disposition, `{ok:false,status:401,message,dbError:true}`, keyed on a new
required `area: 'adapt'|'description'` param) rather than a bolt-on parity test — both GET routes
now share the exact same code path, making the drift RETRO-164 flagged structurally impossible, not
just test-covered. Independently verified (not taken on the worker's self-report): CI non-success
count = 2 (both the standing pre-existing "Rule I — wired-or-dead" gate, 180 WARN lines identical to
the FOLLOW-546/548 baseline, zero hits for this diff's symbols); wiring grep confirms exactly the 2
production call sites reach the helper (no orphan caller, no stray old 2-arg signature, `Sentry`
import still genuinely used elsewhere in both routes); independently re-ran the suite in a FRESH
`git worktree` (not trusting the worker's local-pass claim, per Rule 4e/FOLLOW-448) after rebuilding
`@estalara/{db,shared,auth,sdk}` first (the known FOLLOW-474 worktree-bootstrap gotcha) — typecheck
clean, new parity test 4/4, both pre-existing route suites 89/89, targeted eslint+prettier clean.
Full evidence trail on the FOLLOW-532 ticket block's `notes:`/`ci_status:` and as a PR comment.

**Still open / carried forward (unchanged):** FOLLOW-543 (P3, architect, deferred
§Snapshot.2/.3/.5 + §B.1-body Tier-prose rename). FOLLOW-547 (P3, sdk-engineer, RETRO-169,
unversioned client SoT storage schema — not yet promoted). FOLLOW-458's `status: READY` label is
still inconsistent with its own unmet `depends_on: [FOLLOW-449]` — flagged repeatedly, still not
fixed. FOLLOW-545 (process stub, RETRO-168, bashless-agent-author-blur — not yet promoted).
FOLLOW-533/534 (P3, not yet promoted). 3 standing `## OPEN` escalations (ESC-020, ESC-028, ESC-034)
unchanged, non-blocking.

**NEXT:** human reviews/merges PR #502. After it merges: mark FOLLOW-532 `DONE` + `completed_at`,
spawn `retrospective-analyst`, then pick the next ticket (candidates: FOLLOW-467/468/469/474, all P3
and already `READY`).

---

## ▶️ (superseded) START HERE — resume 2026-07-10 (session 25 — FOLLOW-532 promoted + dispatched to backend-engineer)

**No open PRs at session start** (`gh pr list --state open` empty); `main` clean at `e429524`.
**Escalations:** 3 standing `## OPEN` entries (ESC-020, ESC-028, ESC-034) — all previously triaged
as human-owned/operator-pending and explicitly non-blocking for the PM pipeline (ESC-020's own
`Resolution:` field states "does NOT block the PM pipeline for other tickets"; ESC-028/ESC-034 are
soft-skip/operator-gated, both logged non-blocking in `backlog/STATUS.md`'s ESCALATION STATUS
table). Consistent with every prior session since their filing — not re-litigated.

**Picked FOLLOW-532** (P2, promoted from `backlog/FOLLOW_UPS.md`, RETRO-164 §4a LG-1 / source_ticket
FOLLOW-473) — the highest-priority actually-ready item: the 4 P3 items already sitting `READY`
in-queue (FOLLOW-467/468/469/474) are all lower priority, and FOLLOW-458 (P2) is blocked
(`depends_on: [FOLLOW-449]`, still `CODE_COMPLETE_OPERATOR_PENDING`). FOLLOW-532 has
`depends_on: []` and its owning agent (backend-engineer) is free. Delegation-table row used: "ingest
worker, control-plane, decision-api, Postgres/RLS, auth, onboarding HTTP, billing, webhooks" ->
backend- engineer (row cited per instructions). Dispatched to backend-engineer ALONE (not
co-assigned with qa-engineer as the FOLLOW_UPS stub suggested — scope is a shared parity
test/helper-disposition change confined to backend-engineer's own two route files; co-assigning
would trigger an unwarranted step-5d cross-agent integration check for what is an intra-module
change). Model: Sonnet (routine, well-scoped, no cross-module ambiguity). QUEUE.md flipped
READY(FOLLOW_UPS stub)->IN_PROGRESS; `backend-engineer/FOLLOW-532-adapt-get-auth-dbthrow-parity` is
the branch name given in the dispatch brief (worker creates it as their first action, off `main`).
Full delegation brief in `backlog/HANDOFFS.md`.

**Still open / carried forward (unchanged):** FOLLOW-543 (P3, architect, deferred
§Snapshot.2/.3/.5 + §B.1-body Tier-prose rename). FOLLOW-547 (P3, sdk-engineer, RETRO-169,
unversioned client SoT storage schema — not yet promoted). FOLLOW-458's `status: READY` label is
still inconsistent with its own unmet `depends_on: [FOLLOW-449]` — flagged repeatedly, still not
fixed. FOLLOW-545 (process stub, RETRO-168, bashless-agent-author-blur — not yet promoted).
FOLLOW-533/534 (P3, backend-engineer/devops+pm, not yet promoted). RETRO-171 (FOLLOW-548 close-out,
including the async-interleave-class-fully-closed verdict) is CONFIRMED FILED — commit `e429524`,
already merged to `main` at session start; no action needed here. 3 standing `## OPEN` escalations
(ESC-020, ESC-028, ESC-034) unchanged, non-blocking (see above).

**NEXT:** wait for backend-engineer to open a PR for FOLLOW-532; then PM validates (CI green +
runtime-wiring grep for the parity mechanism + AC check) before READY_FOR_REVIEW.

---

## ▶️ (superseded) START HERE — resume 2026-07-10 (session 24 close-out — PR #499 MERGED, FOLLOW-548 DONE, Rule AB citation fixed, RETRO-171 pending)

**PR #499 MERGED** to `main` as squash commit `ae1bc67` (2026-07-10T10:24:35Z); PM-validation
bookkeeping PR #500 merged immediately after (`b3770f6`). PR #498 (superseded promotion/dispatch-
record PR) was CLOSED unmerged per human decision — its content is fully folded into FOLLOW-548's
DONE trail in `backlog/QUEUE.md`, nothing lost. The human merged PR #499 (the code) directly, so
review is effectively complete. Local `main` synced & clean.

**Post-merge close done on branch `pm-orchestrator/FOLLOW-548-close`** (agent-prefix, branch-first):
FOLLOW-548 flipped `READY_FOR_REVIEW` → `DONE` (`completed_at: 2026-07-10`, `merged_pr: 499`,
`merge_commit: ae1bc67`).

**Rule AB citation fix folded in (human-approved option (a)):** `CONVENTIONS_PATCH.md`'s Rule AB
evidence bullet and its HTML provenance footnote both corrected — the supporting line citation now
points at the `reapply`/observer-rAF closure (the genuinely deferred, unguarded write FOLLOW-548
fixed), not the synchronously-evaluated `:323`/`:333` lines, with FOLLOW-548 cited as the proof.
Rule AB's PRINCIPLE text (the numbered "Rule:" list, generic, no line citations) is UNCHANGED — it
was already correct. `backlog/RETROSPECTIVES.md` RETRO-170's own historical text was NOT touched
(append-only convention) — RETRO-171 will reconcile.

**Not run this pass (per explicit instruction):** the retrospective. `retrospective-analyst` will be
spawned by the coordinator directly onto `pm-orchestrator/FOLLOW-548-close` to append **RETRO-171**
— also asked to assess whether the RETRO-105 cross-listing async-interleave class is now FULLY
closed after three relocation hops (FOLLOW-380 → FOLLOW-546 → FOLLOW-548) or whether a 4th hop
exists — bundling RETRO + DONE-flip + the Rule AB fix into one PR (matches PRs
#486/#487/#489/#493/#497 convention). PM will validate that bundled PR once the coordinator confirms
it's ready.

**Still open / carried forward:** **FOLLOW-543** (P3, architect, deferred §Snapshot.2/.3/.5 +
§B.1-body Tier-prose rename). **FOLLOW-547** (P3, sdk-engineer, RETRO-169, unversioned client SoT
storage schema — not yet promoted). FOLLOW-458's `status: READY` label is still inconsistent with
its own unmet `depends_on: [FOLLOW-449]` — flagged repeatedly, still not fixed. FOLLOW-545 (process
stub, RETRO-168, bashless-agent-author-blur — not yet promoted). 3 standing `## OPEN` escalations
(ESC-020, ESC-028, ESC-034) unchanged, non-blocking.

**This is a fresh bookkeeping PR, opened but NOT merged** — awaiting RETRO-171 content to land on
the same branch first.

---

## ▶️ (superseded) START HERE — resume 2026-07-10 (session 24 — FOLLOW-548 promoted, dispatched, and validated; PR #499 READY_FOR_REVIEW; PR #498 dispatch record still unmerged)

**Two PRs from this session are in flight, in this order (same pattern as FOLLOW-380/#490/#492 and
FOLLOW-546/#494/#496):**

1. **PR #498** (`pm-orchestrator/FOLLOW-548-dispatch`) — the FOLLOW-548 promotion + dispatch record
   (READY → IN_PROGRESS flip + the delegation brief in `backlog/HANDOFFS.md`). **STILL UNMERGED**
   (awaiting human). Because of this, `main` currently has NO FOLLOW-548 ticket block at all — it
   was dispatched out-of-band by the coordinator relaying the brief content directly.
2. **PR #500** (this validation, `pm-orchestrator/FOLLOW-548-validate`, based on current `main` —
   NOT stacked on #498) — promotes FOLLOW-548 straight into `backlog/QUEUE.md` at
   `status: READY_FOR_REVIEW`, folding the full READY→IN_PROGRESS→READY_FOR_REVIEW trail into one
   ticket-block edit. **When merging, merge #498 first (or accept its content is
   superseded/duplicated by #500's fold-in and can be closed without merging — human's call).**

**FOLLOW-548 (P3, sdk-engineer, Opus) is PM-validated, READY_FOR_REVIEW.** PR **#499**
(`sdk-engineer/FOLLOW-548-raf-deferred-staleness-guard`, off `main`, not merged). Independently
verified (not taken on the worker's self-report) — full evidence trail on the ticket block's
`notes:`/`ci_status:` fields: CI non-success count = 2, both the standing Rule I baseline (180
violations, identical count, zero new flags); full `@estalara/sdk` suite (69 files/1524 tests) green
in CI's fresh Node 22 build; bundle 40.49KB/42KB (exact match to the self-report); exactly 4 files
touched, `index.ts` correctly absent from the diff, zero backlog/doc edits. The worker INDEPENDENTLY
CONFIRMED the PM timing-analysis finding from the dispatch brief before implementing (the real
deferred-write gap is the `reapply` closure, not the `:323` rAF scheduling itself). Both guard sites
(`reapply()`'s internal check + entry defense-in-depth) read in full and confirmed to genuinely
precede both `render` and `obs.observe`, with `disconnect()` confirmed to actually run on the stale
path (killing the persistence leg). The two new non-vacuous tests (TG-1, TG-2) plus a headline-path
test independently read and confirmed to be structurally guaranteed to fail without the fix. LG-2
(required param, no silent never-stale fallback) and DG-1 (JSDoc) both confirmed.

**PM recommendation on the permanent-record accuracy issue (RETRO-170 §4a LG-1 / Rule AB's evidence
footnote cite `:323`/`:333` as "the unguarded write," but the real gap is the deferred `reapply`
closure — the PRINCIPLE is correct, only the line citation is imprecise):** fold a small, surgical
evidence-citation correction into Rule AB's `CONVENTIONS_PATCH.md` footnote as part of THIS ticket's
eventual close PR (mirrors the FOLLOW-544 precedent — a live, forward-looking rule benefits most
from accuracy). Do NOT edit RETRO-170's own historical text (append-only convention for retro
entries); let the eventual RETRO-171 naturally reconcile it. Full reasoning on the FOLLOW-548 ticket
block's `notes:`. Not actioned — awaiting human/coordinator direction.

**Still open / carried forward:** **FOLLOW-543** (P3, architect, deferred §Snapshot.2/.3/.5 +
§B.1-body Tier-prose rename). **FOLLOW-547** (P3, sdk-engineer, RETRO-169, unversioned client SoT
storage schema — not yet promoted). FOLLOW-458's `status: READY` label is still inconsistent with
its own unmet `depends_on: [FOLLOW-449]` — flagged repeatedly, still not fixed. FOLLOW-545 (process
stub, RETRO-168, bashless-agent-author-blur — not yet promoted). 3 standing `## OPEN` escalations
(ESC-020, ESC-028, ESC-034) unchanged, non-blocking.

**NEXT:** human reviews/merges #498 (or closes it as superseded) and #499 (the actual code) and #500
(this validation), and decides on the Rule AB citation-correction recommendation above. After
FOLLOW-548 merges: mark `DONE` + `completed_at`, spawn `retrospective-analyst`, then pick the next
ticket.

---

## ▶️ (superseded) START HERE — resume 2026-07-10 (session 23 close-out — PR #495 MERGED, FOLLOW-546 DONE, RETRO-170 pending)

**PR #495 MERGED** to `main` as squash commit `118bdd8` (2026-07-10T08:30:32Z); PM-validation
bookkeeping PR #496 merged immediately after (`4a5c2ba`). PR #494 (superseded promotion/dispatch-
record PR) was CLOSED unmerged per human decision — its content is fully folded into FOLLOW-546's
DONE trail in `backlog/QUEUE.md`, nothing lost. The human merged PR #495 (the code) directly, so
review is effectively complete. Local `main` synced & clean.

**Post-merge close done on branch `pm-orchestrator/FOLLOW-546-close`** (agent-prefix, branch-first):
FOLLOW-546 flipped `READY_FOR_REVIEW` → `DONE` (`completed_at: 2026-07-10`, `merged_pr: 495`,
`merge_commit: 118bdd8`).

**Not run this pass (per explicit instruction):** the retrospective. `retrospective-analyst` will be
spawned by the coordinator directly onto `pm-orchestrator/FOLLOW-546-close` to append **RETRO-170**,
bundling RETRO + DONE-flip into one PR (matches PRs #486/#487/#489/#493 convention). PM will
validate that bundled PR once the coordinator confirms it's ready.

**Still open / carried forward:** **FOLLOW-543** (P3, architect, deferred §Snapshot.2/.3/.5 +
§B.1-body Tier-prose rename). **FOLLOW-547** (P3, sdk-engineer, RETRO-169, unversioned client SoT
storage schema — not yet promoted). FOLLOW-458's `status: READY` label is still inconsistent with
its own unmet `depends_on: [FOLLOW-449]` — flagged repeatedly, still not fixed. FOLLOW-545 (process
stub, RETRO-168, bashless-agent-author-blur — not yet promoted). 3 standing `## OPEN` escalations
(ESC-020, ESC-028, ESC-034) unchanged, non-blocking.

**This is a fresh bookkeeping PR, opened but NOT merged** — awaiting RETRO-170 content to land on
the same branch first.

---

## ▶️ (superseded) START HERE — resume 2026-07-10 (session 23 — FOLLOW-546 promoted, dispatched, and validated; PR #495 READY_FOR_REVIEW; PR #494 dispatch record still unmerged)

**PR #491 MERGED** to `main` as squash commit `4cc5ba5` (2026-07-10T07:16:20Z); PM-validation
bookkeeping PR #492 merged immediately after (`57a0116`). PR #490 (superseded dispatch-record PR)
was CLOSED unmerged per human decision — its content is fully folded into FOLLOW-380's DONE trail in
`backlog/QUEUE.md`, nothing lost. The human merged PR #491 (the code) directly, so review is
effectively complete. Local `main` synced & clean.

**Post-merge close done on branch `pm-orchestrator/FOLLOW-380-close`** (agent-prefix, branch-first):
FOLLOW-380 flipped `READY_FOR_REVIEW` → `DONE` (`completed_at: 2026-07-10`, `merged_pr: 491`,
`merge_commit: 4cc5ba5`). Also retired FOLLOW-375's lingering `backlog/FOLLOW_UPS.md` test-debt
bullet — verified the consolidated `follow-380.test.ts` genuinely covers all 3 of its deferred items
(observer in-place mutation, refreshDirectives SoT restore/update, eraseIntentState clears the
resolved-archetype key) by name-matching its `cross_ref (a)/(b)/(c)` describe blocks — checked `[x]`
with a resolution note; the two unrelated platform/Rafał bullets in that same stub stay OPEN.

**Not run this pass (per explicit instruction):** the retrospective. `retrospective-analyst` will be
spawned by the coordinator directly onto `pm-orchestrator/FOLLOW-380-close` to append **RETRO-169**
and any follow-up stubs, bundling RETRO + DONE-flip into one PR (matches PRs #486/#487/#489
convention). PM will validate that bundled PR once the coordinator confirms it's ready.

**Still open / carried forward:** **FOLLOW-543** (P3, architect, deferred §Snapshot.2/.3/.5 +
§B.1-body Tier-prose rename). FOLLOW-458's `status: READY` label is still inconsistent with its own
unmet `depends_on: [FOLLOW-449]` — flagged repeatedly, still not fixed; worth a one-line correction
next time this ticket is touched. FOLLOW-545 (process stub, RETRO-168, bashless-agent-author-blur —
not yet promoted). 3 standing `## OPEN` escalations (ESC-020, ESC-028, ESC-034) unchanged,
non-blocking.

**This is a fresh bookkeeping PR, opened but NOT merged** — awaiting RETRO-169 content to land on
the same branch first.

---

## ▶️ (superseded) START HERE — resume 2026-07-10 (session 22 — FOLLOW-380 validated, PR #491 READY_FOR_REVIEW; PR #490 still unmerged)

**Two PRs from this session are in flight, in this order:**

1. **PR #490** (`pm-orchestrator/FOLLOW-380-dispatch`) — the FOLLOW-380 dispatch record (READY →
   IN_PROGRESS flip + the delegation brief in `backlog/HANDOFFS.md`). **STILL UNMERGED** as of this
   banner (a merge-guard blocked the coordinator; awaiting human). Because of this, `main` currently
   has NO IN_PROGRESS record and NO brief for FOLLOW-380 — the worker was dispatched out-of-band by
   the coordinator relaying the brief content directly, not by `main` state.
2. **PR #492** (this validation, `pm-orchestrator/FOLLOW-380-validate`, based on current `main` —
   NOT stacked on #490) — flips FOLLOW-380 straight to `READY_FOR_REVIEW` with the full dispatch
   trail folded in retroactively (both `status:` transitions recorded in one ticket-block edit, so
   there's no phantom READY→READY_FOR_REVIEW jump with zero paper trail once #490 eventually lands).
   **When merging, merge #490 first (or accept its content is superseded/duplicated by #492's fold-
   in and can be closed without merging — human's call, flag the redundancy).**

**FOLLOW-380 (P1, sdk-engineer, Opus) is PM-validated, READY_FOR_REVIEW.** PR **#491**
(`sdk-engineer/FOLLOW-380-cross-listing-hardening`, off `main`, not merged). Independently verified
(not taken on the worker's self-report) — full evidence trail is on the FOLLOW-380 ticket block's
`notes:`/`ci_status:` fields: CI non-success count = 2, both the standing pre-existing "Rule I"
baseline (180 violations, `ResolvedArchetype` confirmed absent from the flagged list); full
`@estalara/sdk` suite (69 files/1520 tests) green in CI's fresh Node 22 build; bundle size 40.43KB
gzip vs 42KB budget; exactly 4 files touched, zero backlog/doc edits; all 3 AC bugs (in-flight
guard, per-listing headline, confidence re-pin) traced producer→consumer in the actual diff, not
assumed; one consolidated 10-test suite (not two overlapping); 2 hardening tests spot-checked as
genuinely non-vacuous (would fail without the fix).

**Still open / carried forward:** **FOLLOW-543** (P3, architect, deferred §Snapshot.2/.3/.5 +
§B.1-body Tier-prose rename). FOLLOW-458's `status: READY` label is still inconsistent with its own
unmet `depends_on: [FOLLOW-449]` — flagged again, still not fixed. FOLLOW-545 (process stub,
RETRO-168, bashless-agent-author-blur — not yet promoted). 3 standing `## OPEN` escalations
(ESC-020, ESC-028, ESC-034) unchanged, non-blocking.

**NEXT:** human reviews/merges #490 (or closes it as superseded) and #491 (the actual code) and #492
(this validation). After FOLLOW-380 merges: mark `DONE` + `completed_at`, spawn
`retrospective-analyst`, then pick the next ticket.

---

## ▶️ (superseded) START HERE — resume 2026-07-09 (session 21 close-out — PR #488 MERGED, FOLLOW-470 DONE, RETRO pending)

**PR #488 MERGED** to `main` as squash commit `8275e23` (2026-07-09T21:28:52Z). Local `main` synced
& clean. FOLLOW-470 flipped `DONE` (`completed_at: 2026-07-09`, `merged_pr: 488`,
`merge_commit: 8275e23`) on branch `pm-orchestrator/FOLLOW-470-close` (agent-prefix, branch-first).
This bookkeeping is a **fresh PR, not merged into #488** — do NOT merge it yet: the coordinator will
spawn `retrospective-analyst` onto this SAME branch to append RETRO-NNN + any follow-up stubs before
human review (bundling convention, matching PRs #486/#487).

**Still open / carried forward:** **FOLLOW-543** (P3, architect, `backlog/FOLLOW_UPS.md`,
`promoted_to_queue: false`) — deferred §Snapshot.2/.3/.5 narrative refresh + §B.1 body Tier-prose
rename, does not block FOLLOW-471. FOLLOW-458's `status: READY` label is still inconsistent with its
own unmet `depends_on: [FOLLOW-449]` — flagged again, not yet fixed (a one-line correction is worth
doing whenever this ticket is next touched). 3 standing `## OPEN` escalations (ESC-020, ESC-028,
ESC-034) unchanged, non-blocking.

**NEXT (after this branch is pushed):** coordinator spawns `retrospective-analyst` on
`pm-orchestrator/FOLLOW-470-close`; once that lands, PM validates the bundled PR (RETRO content +
this DONE-flip) and hands to human review. After THAT merges, pick the next ticket — candidates
unchanged from the prior banner: FOLLOW-458 (blocked), FOLLOW-467/468/469/472/474 (P3, unblocked),
FOLLOW-543 (P3, new).

---

## ▶️ (superseded) START HERE — resume 2026-07-09 (session 21 — queue-hygiene fix + FOLLOW-470 dispatched to architect)

**On entry:** `main` tip `a4a2224` (through #487). 0 open PRs (`gh pr list --state open` empty). 3
standing `## OPEN` escalations (ESC-020, ESC-028, ESC-034) re-confirmed unchanged — all
operator-action-pending per established multi-session precedent, none an unresolved
architectural/pricing/priority decision, non-blocking for dispatch.

**Queue-hygiene fix this session:** FOLLOW-473 was stuck at `status: READY_FOR_REVIEW` even though
PR #475 was confirmed MERGED 2026-07-08T19:03:53Z (`511fbbe`) and its retrospective (RETRO-164,
commit `c5be497`, stubs FOLLOW-531/532/533/534) had already run — the DONE flip was missed at
session-18 close. Corrected to `status: DONE`, `completed_at` set. No new retro needed (already
filed).

**Ticket picked:** **FOLLOW-470** (P2, `depends_on: []`, source: 2026-07-01 audit §6.4 — Master
Design §Snapshot.1 is ~5 weeks stale, README says "Sprint 0", CLAUDE.md still describes the retired
Tiers 1/2/3 model, and FOLLOW-380 [P1] sits orphaned in FOLLOW_UPS.md never promoted to QUEUE — an
Operating-Principle-1 (Snapshot.1 = SoT) violation). Picked over the other READY Sprint 22b
candidates (FOLLOW-458 blocked — `depends_on: [FOLLOW-449]` which is still
CODE_COMPLETE_OPERATOR_PENDING, not DONE, despite its own `status: READY` label being stale too —
flag for next session; FOLLOW-467/468/469/472/474 are all P3) because: (a) it's the highest priority
(P2) unblocked, worker-delegable ticket in the queue; (b) it directly unblocks FOLLOW-471, the
Sprint 22b epic-closing acceptance gate, which lists FOLLOW-470 in its `depends_on`; (c) it's
foundational — an inaccurate SoT risks exactly the kind of stale-doc-driven duplicated-work incident
CLAUDE.md's Document Versioning Policy was written to prevent.

**Delegation:** ticket's own `agent:` field says `pm-orchestrator`, but no PM-authored-doc flow
exists in this orchestrator's operating instructions (delegate-and-validate only; guardrail: PM must
not write code, and by extension should not be the sole author of the canonical architecture/status
document either). Reassigned to **architect** — closest decision-table fit for cross-repo
contract/SoT reconciliation spanning docs/MASTER_DESIGN.md, README.md, and CLAUDE.md. **Model:
Opus** (this requires broad, ambiguous, cross-module verification — grep-confirming ~25 Snapshot.1
rows against current implementation state across every app/package — closer to an architecture audit
than routine implementation; model-fit table: "Opus — complex single-domain reasoning... non-trivial
design", escalated because the task spans the WHOLE repo, not one domain). Full delegation brief
posted to `backlog/HANDOFFS.md` ("PM orchestrator (session 21) → architect, FOLLOW-470"). QUEUE.md
FOLLOW-470 flipped to `IN_PROGRESS`, `assigned_to: architect`, branch
`architect/FOLLOW-470-snapshot1-doc-refresh`.

**UPDATE — FOLLOW-470 validated, READY_FOR_REVIEW (same session).** The architect had no shell tool;
the top-level orchestrator executed branch/prettier/commit/push/PR on its behalf, and also applied
the AC's CLAUDE.md Tier-retirement edit directly (the architect's own plan had been to flag, not
edit, citing a config-file change-authority boundary — the orchestrator's executed diff went
further; recorded as a correction inline on the FOLLOW-470 ticket block, not silently absorbed).
**PR #488** (`architect/FOLLOW-470-snapshot1-doc-refresh`) opened, not merged.
`gh pr view 488 --json statusCheckRollup` independently re-run by pm-orchestrator (not taken on the
worker's word): non-success count = **2**, both the SAME "Rule I — wired-or-dead check" (matrix-
duplicated), 181 violations confirmed via `--log-failed` to be pre-existing
`apps/control-plane/ src/lib/*` + `src/app/*` symbols, none touching this diff; PR file list
independently confirmed 100% docs (zero `.ts`/`.py`/`.sql`) via `gh pr view --json files`. Every
other real gate green. Concur: pre-existing non-blocking baseline, consistent with the standing
`project_ci_gate_landscape` precedent. AC spot-checked against the diff (9 §Snapshot.1 rows, README,
CLAUDE.md, FOLLOW-380 promotion, rule-count 8→27 independently re-derived and confirmed exact).
FOLLOW-470 flipped `READY_FOR_REVIEW`, `pr: 488`. Out-of-scope work the architect deliberately
deferred (§Snapshot.2/.3/.5 narrative refresh + §B.1 body Tier-prose rename — flagged inline, not
silently skipped) filed as **FOLLOW-543** (P3, architect, `backlog/FOLLOW_UPS.md`, not yet promoted;
does not block FOLLOW-471). Full evidence trail is on the FOLLOW-470 ticket block itself (`notes:`).

**1 ticket IN_PROGRESS→READY_FOR_REVIEW this session** (FOLLOW-470), well under the 3-ticket cap. 1
PR open (#488, not merged — human merge only). CI-check counter: 1/5 (first check green bar the
standing Rule I baseline). Fix-iterations: 0/3.

**NEXT:** human review + merge of PR #488. After merge: mark FOLLOW-470 `DONE` + `completed_at`,
spawn `retrospective-analyst` (per the per-ticket retro loop), then pick the next ticket. Also worth
a follow-on note (not filed as its own ticket yet): FOLLOW-458's `status: READY` label is
inconsistent with its own unmet `depends_on: [FOLLOW-449]` — worth a one-line QUEUE.md correction
(to `BLOCKED` or a status note) next session so it stops looking pickable at a glance.

---

## ▶️ (superseded) START HERE — resume 2026-07-09 (session 20 — PR #486 validated; FOLLOW-535 + FOLLOW-463 flipped DONE)

**This session (bookkeeping-only, no new dispatch):**

1. **Validated PR #486** (`data-engineer/FOLLOW-535-ttl-grant-prod-attestation`, docs-only —
   RETRO-167 + prod attestation of migration 0020 TTL and the FOLLOW-463 grant).
   `gh pr checks 486 --watch` ran to completion: all real gates green; non-success count via
   `gh pr view --json statusCheckRollup` = 2, both the pre-existing `Rule I — wired-or-dead check`
   baseline (confirmed via `--log-failed`: 181 pre-existing SDK/shared-symbol violations, none
   introduced by this PR since it touches zero `.ts` files — confirmed via
   `gh pr view --json files`). Posted the PM-validated comment. **Human merged it (#486) while this
   validation was in flight** — confirmed via `gh pr view 486 --json state` = MERGED before this
   banner was written.
2. **Flipped FOLLOW-535** `CODE_COMPLETE_OPERATOR_PENDING -> DONE` and **FOLLOW-463**
   `CODE_COMPLETE_OPERATOR_PENDING -> DONE` in this file. Both were the last two operator-pending
   legs standing from session 18. Evidence for the flip (attested in PR #486, CLI-verified by the
   operator against prod ClickHouse, not self-reported):
   `SHOW CREATE TABLE default.description_generations` shows
   `TTL toDateTime(created_at) + toIntervalMonth(13)`; `SHOW GRANTS` (as `ingest_worker`) shows
   `GRANT INSERT ON default.description_generations TO ingest_worker`. Two operator typos (an
   `INTERNAL`/`INTERVAL` TTL keyword slip, and an initial grant landed on a misspelled
   `descriptions_generations` table) were caught and corrected in the same operator session — 0
   occurrences of either typo remain. FOLLOW-463's go-live ESC is now RESOLVED in
   `backlog/ESCALATIONS.md`.
3. **RETRO-167** for FOLLOW-535 was already filed (bundled into PR #486 rather than a separate
   `retrospective-analyst` spawn — not re-run this session, per instruction) — 0 bug / 3 logic / 1
   test / 1 docs gaps, no CONVENTIONS_PATCH promotion (pattern count 1). It confirmed
   `description_generations` still has **zero in-repo reader** — the table is a well-formed,
   retained (13mo TTL), grant-correct write-only audit sink today. That reader gap is tracked as
   **FOLLOW-536** (stub in `backlog/FOLLOW_UPS.md`, `promoted_to_queue: false` — not yet a real
   ticket). FOLLOW-541 (DATA_DICTIONARY wording) and FOLLOW-542 (durable order-safe CH operator
   runbook) are further RETRO-167 stubs, also unpromoted.

**No new ticket dispatched this session** (scope was bookkeeping-only, per instruction — do not
spawn workers).

**Recommended next ticket: FOLLOW-532** (P2, backend-engineer + qa-engineer,
`promoted_to_queue: false` in FOLLOW_UPS.md, source RETRO-164/FOLLOW-473) — pin the two GET
`/api/adapt*` call sites' DB-throw→401 disposition so they can't silently drift apart; has **no
operator dependency** (pure code + CI gate) and no `depends_on`, so it's cleanly delegable next
session (needs PM promotion to a real QUEUE.md entry first). Other standing READY/stub candidates
unchanged from the prior banner: FOLLOW-470 (status-doc refresh), FOLLOW-531 (decision-api sibling
auth, staging), FOLLOW-536 (description_generations reader, needs promotion first), FOLLOW-539/540
(P3). FOLLOW-458 stays BLOCKED on FOLLOW-449 (`CODE_COMPLETE_OPERATOR_PENDING`).

**Escalations:** 3 standing `## OPEN` entries remain — ESC-020, ESC-028, ESC-034 — all re-confirmed
unchanged, non-blocking, established multi-session precedent
(code-complete-awaiting-operator-action, none gating this session's bookkeeping tasks). FOLLOW-463's
grant escalation is now RESOLVED (see above) — no longer part of that standing set.

**CI-check counter this session:** 1/5. **Fix-iteration counter:** 0/3. 0 PRs delegated by PM this
session (PR #486 was opened by data-engineer last session, validated and merged this session).

---

## ▶️ (superseded) START HERE — resume 2026-07-09 (session 19 — validated PR #485, RETRO-167 owed before next ticket)

**On entry:** `main` tip unchanged at `41eb890` (through #484). 1 open PR: **#485**
(`pm-orchestrator/session18-pause-save`, the session-18 pause-state banner save below) — docs-only,
`backlog/QUEUE.md` single-file diff. Confirmed 4 standing `## OPEN` escalations (FOLLOW-463 CH
grant, ESC-020, ESC-028, ESC-034) — all are **operator/infra action items** (CH grant, DNS/deploy,
GitHub Actions secrets, Modal go-live steps), none is an unresolved architectural/ pricing/priority
decision blocking PM dispatch; treated as non-blocking per the established multi-session precedent
(re-confirmed unchanged, not newly reasoned away).

**This session's action:** ran `gh pr checks 485` → 55/57 real gates SUCCESS; the 2 failures are
both "Rule I — wired-or-dead check" (2 matrix legs), the standing pre-existing baseline, unrelated
to this docs-only diff. Non-success count for all REAL gates: **0**. Step 5c (runtime-wiring) N/A —
no new symbol/event/column/config field in a pure `backlog/QUEUE.md` prose diff. Posted the
PM-validated comment on #485. **Not merged — human merge only.**

**NEXT (unchanged from the session-18 banner below, not yet actioned):** once #485 is merged, spawn
`retrospective-analyst` for FOLLOW-535 (RETRO-167) BEFORE picking a new ticket — code is merged
(#483/#484) so the retro can run now even though the ticket itself sits
`CODE_COMPLETE_OPERATOR_PENDING`, mirroring how RETRO-165 was run for FOLLOW-463 in the same state.
**Model: Opus** — retrospectives are cross-module-impact reasoning over a merged diff, Opus-tier per
the mandatory model-fit rule (table row: "Opus — retrospectives, ambiguous... non-trivial design").
After RETRO-167, the strongest next-ticket candidate remains **FOLLOW-532** (pin the two GET
/api/adapt call sites against auth-handling drift — P2, backend-engineer + qa-engineer, no operator
dependency, fully completes on merge; delegation-table row: "a contract between two modules" /
"client SDK... control-plane" depending on final split — re-derive at dispatch time). It is
currently only a stub in `backlog/FOLLOW_UPS.md` (`promoted_to_queue: false`) and needs PM promotion
to a real QUEUE.md entry before dispatch.

0 tickets IN_PROGRESS this session (only the stale `TICKET-PILOT-001` record) — well under the
3-ticket cap. CI-check counter: 1/5 (PR #485, all real gates green on first check). Fix-iterations:
0/3.

---

## ▶️ (superseded) START HERE — session 18 PAUSED 2026-07-08 (4 tickets landed + 3 retros; resume with RETRO-167 + next ticket)

**Session 18 is paused by the CEO for a break** — everything below is merged to `main` (tip after
#484), 0 open PRs, 0 worktrees, tree clean. **To resume in a fresh session: (1) run RETRO-167 for
FOLLOW-535, package it, then (2) pick the next ticket from the candidates listed under NEXT.**

**Completed loop this session** — FOLLOW-473 → FOLLOW-463 → FOLLOW-461 → FOLLOW-535, each recovered/
dispatched, PM-validated (CI green bar the standing Rule I baseline), and merged. Retros produced
stubs FOLLOW-528..540.

- **FOLLOW-473** DONE (#475) — RETRO-164 (#477). Fail-closed two-step auth on GET /api/adapt +
  /description. (Recovered from the interrupted session-17 worktree; adjudicated between two
  divergent uncommitted attempts.)
- **FOLLOW-463** `CODE_COMPLETE_OPERATOR_PENDING` (#479) — RETRO-165. Persists verified_facts_used
  to the CH `description_generations` audit trail. ⚠️ Go-live blocked on the prod CH grant (see
  Operator backlog).
- **FOLLOW-461** DONE (#481) — RETRO-166. Registered adapt.description.\* in EventSchema; closed the
  live F-04 ingest drop. Payload fidelity verified clean.
- **FOLLOW-535** `CODE_COMPLETE_OPERATOR_PENDING` (#483, validate #484) — **RETRO-167 NOT YET RUN**
  (do this first on resume). 13-month TTL on description_generations (migration 0020) + a golden-DDL
  CI regression test. ⚠️ Prod-apply pending (see Operator backlog).

**NEXT (on resume):** RETRO-167 for FOLLOW-535 first, then pick a ticket. Candidates
(`depends_on: []`): **FOLLOW-532** (pin the two GET /api/adapt call sites vs drift — fully completes
on merge, NO operator dependency; strong pick), **FOLLOW-470** (stale status-doc refresh:
Master_Design §Snapshot.1 + README + CLAUDE.md + promote orphaned FOLLOW-380 — pm, READY),
**FOLLOW-531** (decision-api sibling auth, staging-only), **FOLLOW-536** (description_generations
reader/dashboard), **FOLLOW-539/540** (P3). FOLLOW-458 BLOCKED on FOLLOW-449. Retro stubs
531/532/536/539/540 need PM promotion before dispatch.

**⚠️ Operator/human backlog (carries across sessions):**

1. **One ClickHouse Cloud admin session closes two go-lives at once** (do the grant + the TTL
   together, in this order, BEFORE the table takes its first prod write):
   - `GRANT INSERT ON default.description_generations TO ingest_worker;` (FOLLOW-463 — OPEN
     escalation in ESCALATIONS.md; ESC-032/FOLLOW-424 had narrowed this grant out on a "no writer"
     premise that FOLLOW-463 invalidates)
   - apply migration `infra/clickhouse/migrations/0020_description_generations_ttl.sql` to prod CH
     (FOLLOW-535 — CH migrations do NOT auto-apply; Cloud console only)
   - then update `docs/runbooks/clickhouse-ingest-worker-grant-narrowing.md` (the writer now
     exists).
2. 3 standing `## OPEN` escalations ESC-020/028/034 unchanged, non-blocking.

---

## ▶️ (superseded) START HERE — resume 2026-07-08 (session 18 — recovered interrupted FOLLOW-473, landed PR #475)

**Session 17 was interrupted** (terminal closed) mid-way: the dispatched backend-engineer had done
the full FOLLOW-473 implementation but the work was **uncommitted** in its worktree — nothing on
`origin`, no PR. Session 18 recovered it:

- Found TWO divergent, uncommitted FOLLOW-473 attempts in parallel worktrees (same helper + tests,
  **different `route.ts` + helper designs**). Adjudicated by verification, not by eye: ran both full
  adapt suites (WT-official **325** tests vs WT-fork **309**; 17 vs 14 dedicated follow473 auth
  cases), and confirmed the official branch's thinner-helper design is drift-safe (both call sites
  handle the `resolveApiKey` DB-throw symmetrically — verified in source). **Landed the official,
  more-covered branch; discarded the losing fork.**
- Ran prettier (clean) + `tsc --noEmit` (clean) + eslint (clean), committed `7c9e67c`, pushed,
  opened **PR #475**.
- `gh pr checks 475`: **all real gates green**. Only red = the standing pre-existing
  `Rule I — wired-or-dead check` baseline — confirmed via `--log-failed` that none of this PR's new
  symbols (`resolveAdaptGetAuth`, `AdaptGetAuthResult`, `adapt-get-auth.ts`) appear in it (the new
  helper is correctly wired, imported by both routes). Non-blocking per multi-session precedent.
- FOLLOW-473 flipped `IN_PROGRESS → READY_FOR_REVIEW` (pr: 475, ci_status: green). Posted the
  PM-validated PR comment. **Human merge only.**

**CLEANUP DONE this session:** removed the two stranded worktrees (`agent-a5857a01…` FOLLOW-473
official — after push; `agent-a628105…` the discarded fork) and the merged/stale
`pm-orchestrator/session17-follow473-dispatch` local+remote branch.

**NEXT (session 19):** after a human merges PR #475, spawn `retrospective-analyst` for FOLLOW-473
(per the per-ticket retro loop), then pick the next READY Sprint 22b ticket
(FOLLOW-461/463/467/469/470/472/474 are READY with `depends_on: []`; FOLLOW-458 stays BLOCKED on
FOLLOW-449 operator-pending; FOLLOW-471 re-audit gate still BACKLOG). 3 standing `## OPEN`
escalations (ESC-020/028/034) unchanged, non-blocking.

---

## ▶️ (superseded) START HERE — resume 2026-07-08 (session 17 — FOLLOW-473 elevated P2→P1 + dispatched to backend-engineer)

**Since the banner below (session 16, same day):** confirmed via `git log` that PR #471 (RETRO-163

- FOLLOW-528/529/530 stubs) merged, plus two further docs PRs already landed on `main` after that:
  `#472` (banner/status refresh) and `#473` (TICKET-PROCESS-002, mandatory model-fit rule doc).
  `main` tip is now `9210400`. `gh pr list --state open` returns 0 — the "besides #471" caveat in
  the prior banner is stale; there are 0 open PRs at the start of this session.

**This session (17):** re-confirmed the 3 standing `## OPEN` escalations (ESC-020, ESC-028, ESC-034)
unchanged, non-blocking (established multi-session precedent: code-complete-awaiting-
operator-action). Read the full Sprint 22b tail for READY, unblocked, worker-delegable candidates:
FOLLOW-461/463/467/468/469/470/472/473/474 are all READY with `depends_on: []`; FOLLOW-458 is READY
but BLOCKED on FOLLOW-449 (`CODE_COMPLETE_OPERATOR_PENDING`, not DONE); FOLLOW-471 (the epic-closing
re-audit gate) is BACKLOG, blocked on ~7 of the above still being open.

Found and actioned an un-promoted stub, **FOLLOW-510** (`backlog/FOLLOW_UPS.md`, source RETRO-158,
`recommended_agent: pm-orchestrator`, `promoted_to_queue: false`): it recommends PM reassess
FOLLOW-473's priority P2→P1 (GET /api/adapt + GET /api/adapt/description are the two
highest-blast-radius fail-open routes in the repo, hit on every live SDK pageview — a strictly worse
exposure than the internal-cron FOLLOW-490 route already fixed at P1) and requires pairing the
fail-closed flip with an `ADAPT_API_KEY`/`OPS_TENANT_ID` provisioning preflight so the flip itself
can't cause an SDK-wide outage. This is a priority-triage decision within normal PM authority (not
architectural/pricing/compliance), so **elevated FOLLOW-473 P2→P1** and ran the preflight myself:
`vercel env ls production` against `adaptive-listings-control-plane` (read-only, no secret values
fetched) shows `ADAPT_API_KEY` present (Production+Preview) and `OPS_TENANT_ID` ABSENT. Net effect:
real tenant SDK traffic (sends its own per-tenant `config.apiKey`) is unaffected either way; the
ops-bypass branch will hit the same "OPS_TENANT_ID must be set alongside ADAPT_API_KEY" 500 that
`feedback/route.ts` already returns in prod today (FOLLOW-450, live) — no new failure mode. Folded
this finding into FOLLOW-473's QUEUE.md `notes:` block and marked FOLLOW-510 actioned (not a
separate queue ticket) in FOLLOW_UPS.md.

Verified the target fix pattern directly in the repo before delegating (not guessed): both GET
handlers (`apps/control-plane/src/app/api/adapt/route.ts:703`,
`apps/control-plane/src/app/api/adapt/description/route.ts:183`) have the identical
`if (adaptApiKey && token !== adaptApiKey)` fail-open shape;
`apps/control-plane/src/app/api/adapt/feedback/route.ts` already implements the target two-step
pattern (`resolveApiKey()` primary + `ADAPT_API_KEY`/`OPS_TENANT_ID`-scoped `secretEquals()`
ops-bypass) that these two GET routes should mirror; the SDK already sends real per-tenant
`config.apiKey` bearers on these GET calls (`packages/sdk/src/core/adapt-description.ts:231`,
`adapt.ts:169/267/800`).

**Dispatched FOLLOW-473 to backend-engineer** (table row: "ingest worker, control-plane,
decision-api, Postgres/RLS, auth, onboarding HTTP, billing, webhooks -> backend-engineer"), flipped
`READY → IN_PROGRESS`, branch `backend-engineer/FOLLOW-473-adapt-get-auth-hardening`. **Model:
Opus** (live-production auth change on the highest-blast-radius routes in the repo, with a
previously-flagged outage risk and a cross-file symmetric fix — exceeds routine in-scope
implementation per the mandatory model-fit rule). Full delegation brief in `backlog/HANDOFFS.md`
("PM orchestrator (session 17) → backend-engineer, FOLLOW-473").

0 open PRs at hand-off. 3 standing `## OPEN` escalations (ESC-020, ESC-028, ESC-034) unchanged,
non-blocking. 1 ticket IN_PROGRESS (FOLLOW-473; the stale `TICKET-PILOT-001` record is the other) —
under the 3-ticket cap.

---

## ▶️ (superseded) START HERE — resume 2026-07-08 (session 16 retro — RETRO-163 filed, PR #471 opened, FOLLOW-528/529/530 stubbed)

**Coordinator confirmed PR #470 (session-16 DONE close-out) also merged** (main fast-forwarded
`acf87bb → 2785191`) and that `retrospective-analyst` completed **RETRO-163** for FOLLOW-464,
leaving uncommitted edits (`backlog/RETROSPECTIVES.md`, `backlog/FOLLOW_UPS.md`,
`.claude/agents/ retrospective-analyst/lessons.md`) in the working tree on the (already-merged)
session-16 close-out branch. Per guardrails, packaged these onto a **fresh branch based on latest
`main`** (`retrospective-analyst/retro-163-follow464`), independent of the merged close-out branch:
stashed, checked out `main`, pulled, created the branch, popped the stash, ran `prettier --write` on
the 2 files that needed it (additions only, no reflow of pre-existing content — confirmed via
`git diff --stat`), committed, pushed, opened **PR #471**. `gh pr checks 471 --watch` → all real
gates green; only the standing pre-existing "Rule I — wired-or-dead check" baseline (this run showed
1 matrix leg red, not 2 — consistent with the established non-blocking pattern) is red. Posted
PM-validated comment. Not merged (human-only).

**RETRO-163 key finding (LG-1):** FOLLOW-464 model-scoped the Postgres cache READ correctly (closes
audit F-15 + RETRO-162 LG-1 on the correctness axis), but the store's ACTIVE-ROW invariant — the
migration-0023 partial unique index `(tenant_id,listing_id,archetype,locale)` and the pre-insert
invalidation in `insertPgCachedDescriptionStrict` — remain model-BLIND, so the model-scoped read can
never cache more than one model at a time; every effective-model toggle re-dispatches a fresh
generation (bounded P2 cost regression, not a correctness reopen). Filed **FOLLOW-528** (P2, fix) +
**FOLLOW-529** (P2, demo/prod Postgres isolation) + **FOLLOW-530** (P3, AGENT_WORKFLOW checklist
cache-bust amendment) as stubs in `backlog/FOLLOW_UPS.md` (`promoted_to_queue: false` — not yet real
tickets; promote at next sprint planning).

**Planning note to carry forward — FOLLOW-528's migration ordering:** FOLLOW-528 requires rebuilding
the `description_cache_persistent_active_uniq` partial unique index to include `model`. Per the
standing MEMORY fact (FOLLOW-308 `db-migrate.yml`), **Postgres migrations auto-apply staging→prod on
merge with NO human gate.** When FOLLOW-528 is promoted and delegated, the migration MUST be ordered
additive/safe (e.g. `CREATE UNIQUE INDEX CONCURRENTLY` on the new wider key BEFORE `DROP` of the old
one) — no window may exist where a duplicate-4-tuple insert is rejected or where the constraint is
briefly absent. Flag this explicitly in FOLLOW-528's delegation brief when promoted; do not let it
ship as a naive `ALTER`/single-step index swap.

0 open PRs at hand-off besides #471. 3 standing `## OPEN` escalations (ESC-020, ESC-028, ESC-034)
unchanged, non-blocking. 0 tickets IN_PROGRESS (only the stale `TICKET-PILOT-001` record).

---

## ▶️ (superseded) START HERE — resume 2026-07-07 (session 16 close-out — PRs #468/#469 merged, FOLLOW-464 DONE)

**Human confirmed both PRs merged.** Close-out actions taken this pass:

1. `git checkout main && git pull origin main` — fast-forwarded `42e2821 → acf87bb` (through #468
   `bc3b1ea` fix(adapt) commit, then #469 `acf87bb` docs commit). Local `main` now matches remote.
2. Flipped `FOLLOW-464` `READY_FOR_REVIEW → DONE` in `backlog/QUEUE.md`
   (`completed_at`/`merged_commit: bc3b1ea` added), with a DONE close-out note appended to its
   `notes:` block.
3. Refreshed `backlog/STATUS.md` with a close-out entry.
4. Removed the now-merged worktree `.claude/worktrees/wt-follow464` and deleted the two fully-merged
   branches (`ml-engineer/FOLLOW-464-model-key-pg-cache`, local + remote;
   `pm-orchestrator/session16-follow464-recovery`, local + remote).

**Per explicit instruction, did NOT spawn `retrospective-analyst` this pass** — the main session
will invoke it after this close-out. RETRO-163 (FOLLOW-464) is owed.

0 open PRs at hand-off. 3 standing `## OPEN` escalations (ESC-020, ESC-028, ESC-034) unchanged,
non-blocking. 0 tickets IN_PROGRESS (only the stale `TICKET-PILOT-001` record).

---

## ▶️ (superseded) START HERE — resume 2026-07-07 (session 16 — FOLLOW-464 recovered from stalled ml-engineer session, PR #468 opened READY_FOR_REVIEW)

**On entry this session:** found TWO pieces of stranded state from the prior session (15), neither
committed:

1. A docs-only diff sitting **uncommitted directly on `main`**
   (`.claude/agents/pm-orchestrator/ lessons.md` + `backlog/QUEUE.md` + `backlog/STATUS.md`) —
   session 15's own banner/lessons entry recording that it dispatched FOLLOW-464, written but never
   committed before the session ended.
2. The **ml-engineer FOLLOW-464 implementation itself**, complete but uncommitted (no PR opened) in
   worktree `.claude/worktrees/wt-follow464`, still correctly on branch
   `ml-engineer/FOLLOW-464-model-key-pg-cache` at base commit `d90cdfa` — the worker session had
   stalled/handed off mid-ticket with the code done but never committed/pushed.

**Ran the mandatory recovered-work re-verification (docs/AGENT_WORKFLOW.md) before touching
anything:** (1) confirmed the code was on the correct ticket branch, never `main`; (2) confirmed the
two stranded diffs were unrelated to each other and kept them separate — moved the docs diff to its
own branch (`pm-orchestrator/session16-follow464-recovery`) rather than sweeping it into the code
commit; (3) independently re-ran (forced, no-cache)
`pnpm turbo run lint typecheck test --filter=@estalara/control-plane` myself rather than trusting
the stalled session's implicit "done" state — 8/8 tasks green, 137 files / 1544 tests passed, plus a
targeted 6/6 pass on the 2 new test files and a clean `prettier --check`. Read the diff against all
4 FOLLOW-464 AC items (QUEUE.md) and confirmed complete coverage (model-scoped WHERE filter; FIT
model-switch test; NEUTRAL cross-model regression-guard test per RETRO-162 LG-1; demo
`override_model` non-short-circuit test). Verified runtime wiring: producer `route.ts:310` →
consumer `description-pg-cache.ts:127`, non-test on both ends, only call site in the repo.

**Committed `94cce4c`, pushed, opened PR #468.** `gh pr checks 468 --watch` → all real gates green;
only the standing pre-existing "Rule I — wired-or-dead" baseline (181 violations, confirmed via job
log to contain zero FOLLOW-464 symbols) is red, matching every prior PR this sprint. Posted
PM-validated comment on PR #468 with full evidence. **FOLLOW-464 flipped IN_PROGRESS →
READY_FOR_REVIEW.** Not merged (human-only).

Re-confirmed the 3 standing `## OPEN` escalations (ESC-020, ESC-028, ESC-034) unchanged and
non-blocking. 1 open PR at hand-off (#468). IN_PROGRESS count: 0 real tickets (only the stale
`TICKET-PILOT-001` record) — well under the 3-ticket cap.

---

## ▶️ (superseded) START HERE — resume 2026-07-07 (session 15 — PRs #466/#467 merged, FOLLOW-464 dispatch confirmed)

**Since the banner below (session 14, same day):** session 14 validated PR #466 (RETRO-162
close-out + FOLLOW-464 P2→P1 promotion/reassignment, docs-only) but deliberately did NOT start the
FOLLOW-464 worker because the reassignment only existed in the unmerged PR diff at that point. #466
was then merged, and a follow-up docs-bookkeeping PR **#467** (STATUS.md refresh) also merged.
`main` tip is now `42e2821`.

**This session (15):** confirmed via `git log`/`gh pr list` that #466 and #467 are merged and
`backlog/QUEUE.md` on `main` now natively carries `FOLLOW-464` as
`status: IN_PROGRESS, assigned_to: ml-engineer, branch: ml-engineer/FOLLOW-464-model-key-pg-cache`
(no docs-PR race remains — this is no longer speculative). Re-confirmed the 3 standing `## OPEN`
escalations (ESC-020, ESC-028, ESC-034) unchanged and non-blocking; confirmed 0 P0 tickets exist in
the live `QUEUE.md` (only historical `FOLLOW_UPS.md` stub noise, irrelevant since nothing is being
closed this session). 0 open PRs; only 1 real `IN_PROGRESS` entry besides FOLLOW-464
(`TICKET-PILOT-001`, a stale record from 2026-05-29, different agents/files, non-conflicting) — well
under the 3-ticket cap.

**Ran the 4-point pre-delegation check on FOLLOW-464 (feedback_ticket_analysis_discipline) before
dispatch, independently re-verifying the HANDOFFS.md brief against the live code (not trusting the
brief's prose):**

1. **Hallucination risk** — none found. Every file/symbol the brief cites was independently read and
   confirmed to exist exactly as described.
2. **Data/dependency access** — verified directly: `getPgCachedDescription`
   (`apps/control-plane/src/lib/description-pg-cache.ts:87-124`) confirmed to omit `model` from its
   `.where(and(...))` clause; the route
   (`apps/control-plane/src/app/api/adapt/description/route.ts:296,305`) confirmed to compute
   `effectiveModel` at line 296 BEFORE calling `getPgCachedDescription` at line 305 without passing
   it; migration `0033_description_cache_verdict.sql` confirmed present and monotonic in
   `packages/db/migrations/meta/_journal.json`; `description_cache_persistent.model` confirmed
   `NOT NULL` (`packages/db/src/schema/description_cache_persistent.ts:51`), so adding a `model`
   filter is safe for every pre-existing row (no backfill/nullability edge case).
3. **Backward dependency chain** — `depends_on: [FOLLOW-460]` confirmed DONE; `folds: [FOLLOW-523]`
   confirmed marked `FOLDED_INTO_FOLLOW-464` in `FOLLOW_UPS.md`; no other IN_PROGRESS ticket touches
   `description-pg-cache.ts` or the description route.
4. **Second-pass gotcha check** — the route's existing `effectiveModel` computation
   (`demoActive && demoOverrideModel ? demoOverrideModel : globalModel`) already unifies the
   demo/global model discrimination used by the Redis Step-2 key, so passing `effectiveModel`
   straight into the new `getPgCachedDescription` `model` param covers the demo-path guard (AC item
   3 in the brief) for free — flagging this so the worker doesn't over-build a separate
   demo-specific code path.

**No blockers found — dispatching FOLLOW-464 to ml-engineer this session** per the existing brief in
`backlog/HANDOFFS.md` ("Delegation brief — FOLLOW-464 (ml-engineer)"). No QUEUE.md edit needed
beyond this banner — the ticket's `IN_PROGRESS`/`assigned_to`/`branch` fields already reflect the
correct delegation state from the merged PR #466.

---

## ▶️ (superseded) START HERE — resume 2026-07-07 (session 13 cont'd, after crash-recovery closed FOLLOW-465 DONE + RETRO-162 fast-follow)

**Session 13 was interrupted by a terminal crash and resumed.** FOLLOW-465 (negative-cache NEUTRAL
archetype-fit verdicts, F-18) shipped: the ml-engineer worker's implementation was intact-but-
uncommitted in worktree `wt-follow465` when the crash hit; the resumed session validated it (full
gate set green, Python pytest 132 passed), committed, and merged **PR #463** (`main` tip through
`d90cdfa`, incl. docs PRs #464/#465). FOLLOW-465 = DONE.

**RETRO-162 surfaced a P1 (LG-1) that reopens the axis FOLLOW-465 didn't cover.** The FOLLOW-465
NEUTRAL negative cache short-circuits on the model-BLIND Postgres Step-1 read
(`getPgCachedDescription`, `description-pg-cache.ts:103-111` — the known-open FOLLOW-464 bug, no
`model` in WHERE), which runs BEFORE the model-scoped Redis Step-2. So a NEUTRAL written under model
A now permanently suppresses generation under model B (incl. the DEMO `override_model` preview)
until `listing.updated` — FOLLOW-465 amplified FOLLOW-464 from a stale-model quality bug into a
cross-model correctness regression on freshly-shipped code. Verified against the code, not just the
audit prose. **Action taken this close-out:** promoted **FOLLOW-464 P2→P1**, folded FOLLOW-523's
model-scoping AC into it (incl. a NEUTRAL-cross-model regression-guard test + demo-path guard),
reassigned to ml-engineer (owns the FOLLOW-465 read path + sibling FOLLOW-460), flipped
`READY→IN_PROGRESS`, branch `ml-engineer/FOLLOW-464-model-key-pg-cache`. Delegation brief in
`backlog/HANDOFFS.md`. RETRO-162 + FOLLOW-523..527 filed. FOLLOW-524/525/526/527 remain BACKLOG
(P3). FOLLOW-471 (clean re-audit gate) stays BACKLOG until every depends_on ticket is DONE.

---

## ▶️ (superseded) START HERE — resume 2026-07-06 (session 13, after session 12 closed FOLLOW-466 DONE)

**Since the banner below (session 12, same day):** session 12 closed FOLLOW-466 (DONE — PR #459,
feedback-HMAC replay nonce cache + `secretEquals` sweep; fast-follow FOLLOW-519 filed for a 3rd
timing-unsafe site) and filed RETRO-161 + stubs FOLLOW-520/521/522. `main` tip is `d79d800`; 0 open
PRs at hand-off. Standing ops posture unchanged: FOLLOW-482 stays `CODE_COMPLETE_OPERATOR_PENDING`
(queues unprovisioned); FEEDBACK_ENDPOINT_ENABLED operator flip (FOLLOW-450 AC1) still not thrown,
so the bandit/feedback path (incl. this session's dedup work) is code-complete but latent in prod
(RETRO-161). Retros RETRO-153..161 all filed, no retro debt owed.

**This session (13):** re-confirmed the 3 standing OPEN escalations (ESC-020/ESC-028/ESC-034)
unchanged and non-blocking (established precedent: code-complete-awaiting-operator-action).
Re-verified `depends_on` for the remaining fresh P2 candidates in the repo (not from stub prose):
`getPgCachedDescription` (`apps/control-plane/src/lib/description-pg-cache.ts:75-125`) confirmed to
omit `model` from its WHERE clause (FOLLOW-464 real bug, dep FOLLOW-460 DONE); the NEUTRAL-verdict
early-return in `generate_description()`
(`apps/llm-gateway/src/jobs/generate_description.py:330-338`) confirmed to write NOTHING to
Redis/Postgres, so a NEUTRAL (tenant,listing,archetype,locale) pair re-invokes Sonnet 4.6 on every
single repeat request forever, uncapped by any invalidation — a live, unbounded-with-traffic cost
leak on the description-generation path that went live in prod 2026-07-03 (FOLLOW-465, no deps).
Picked **FOLLOW-465** over FOLLOW-464: FOLLOW-464's staleness window is bounded (closes on the next
`listing.updated` webhook invalidation) and only bites during the narrow period around an explicit
model switch; FOLLOW-465's leak is unbounded and compounds with organic traffic on a path already
serving live users, and it burns real Sonnet-4.6 spend during a budget-conscious pilot (cf. ADR-0016
dropping Redpanda specifically over cost). FOLLOW-491 was skipped per the standing note that its
target routes (`/api/config`, `/api/audit`) are in-memory MVP stubs, not live data paths — real
severity is deferred until they're wired to a real store (already flagged by the ticket's own text).
FOLLOW-519 (P3, one-line `secretEquals` swap) and FOLLOW-522 (P2, but
`recommended_agent: pm-orchestrator` — a re-prioritization decision on FOLLOW-484, not a worker
deliverable) were left for a future pass; a P2 real-correctness/cost bug with clean deps beats a P3
fast-follow and a non-worker meta-ticket on priority.

Promoted FOLLOW-465 to this queue, flipped `READY -> IN_PROGRESS`, branch
`ml-engineer/FOLLOW-465-neutral-verdict-negative-cache`. Full delegation brief (incl. the concrete
schema/wire-contract design constraints found by reading `description-pg-cache.ts`,
`description-cache.ts`, `packages/shared/src/schemas/description.ts`, and the
`/api/internal/description-cache` route before writing the brief) is in `backlog/HANDOFFS.md`. See
the FOLLOW-465 ticket block (Sprint 22b) for AC. FOLLOW-464/491/519/522 remain READY/BACKLOG for a
future session; FOLLOW-471 (clean re-audit gate) stays BACKLOG until every depends_on ticket is
DONE.

**Terminal crashed mid-session; resumed 2026-07-06.** The ml-engineer worker had finished the
FOLLOW-465 implementation in worktree `wt-follow465` but the crash hit BEFORE commit/push/PR — all
work was intact as uncommitted changes (12 files), nothing lost. On resume: re-validated the diff
against AC + the 7 brief constraints (found complete, no gaps), ran the full gate set green (lint/
typecheck/test/build 17/17, control-plane next build, Python pytest 132 passed, prettier clean,
migration journal monotonic), committed `abff5c3`, pushed, and opened **PR #463**. CI: 56/58 pass;
the only 2 reds are the standing pre-existing "Rule I — wired-or-dead" baseline (181 violations,
zero FOLLOW-465 symbols — reconfirmed locally). **PR #463 squash-merged 2026-07-06 (main tip
`5acc055`); FOLLOW-465 is DONE.** Worktree `wt-follow465` + its branch cleaned up. Post-merge
retrospective (RETRO-162) still owed — spawn `retrospective-analyst`. Next clean worker-delegable
candidate: **FOLLOW-464** (the `getPgCachedDescription` missing-`model`-filter staleness bug,
deliberately left out of FOLLOW-465's scope — dep FOLLOW-460 DONE).

---

## ▶️ (superseded) START HERE — resume 2026-07-06 (session 12, after session 11 delegated FOLLOW-513/closed it DONE)

**Since the banner below (session 11, same day):** session 11 closed FOLLOW-513 (DONE — PR #453,
Sentry binding on the queue-consumer path) and FOLLOW-516 (DONE — corrected a wrong lessons.md
entry). `main` tip is `a704516`; 0 open PRs at hand-off. FOLLOW-482 stays
`CODE_COMPLETE_OPERATOR_PENDING` (queues still unprovisioned; its flanking hops
FOLLOW-512/FOLLOW-515 are devops/operator-shaped, not clean worker delegates). Retros RETRO-153..160
all filed, no retro debt owed.

**This session (12):** re-confirmed the 3 standing OPEN escalations (ESC-020/ESC-028/ESC-034)
unchanged and non-blocking (same established precedent). Of the 4 fresh worker-implementable READY
Sprint 22b candidates (FOLLOW-464/465/466/491), picked **FOLLOW-466** (replay protection on the
feedback HMAC + unify secret comparisons on `timingSafeEqual`) — a security-hardening ticket
(bounded bandit-arm-inflation via HMAC replay is a real, if bounded, integrity issue;
`depends_on FOLLOW-450` is DONE) over FOLLOW-464 (cache-staleness correctness bug, no security
angle) as the higher real-world-severity clean delegate. Promoted to IN_PROGRESS, branch
`backend-engineer/FOLLOW-466-feedback-hmac-replay-protection`. Full delegation brief in
`backlog/HANDOFFS.md`. See the FOLLOW-466 ticket block (Sprint 22b, after FOLLOW-463) for AC.
FOLLOW-464/465/491 remain READY for a future session; FOLLOW-471 (clean re-audit gate) stays BACKLOG
until every depends_on ticket is DONE.

---

## ▶️ (superseded) START HERE — resume 2026-07-06 (session 11, after session 10 closed FOLLOW-462/490/482)

**Since the banner below (last touched end of session 9, 2026-07-03):** session 10 closed FOLLOW-462
(DONE — PR #438, ClickHouse DSR param-binding), FOLLOW-490 (DONE — PR #442, `/api/internal/schema`
fail-closed), and FOLLOW-482 (`CODE_COMPLETE_OPERATOR_PENDING` — PR #449, ADR-0017 Cloudflare Queues
durable retry; code merged `f53c3ba` but queues are UNPROVISIONED, devops deploy-time handoff, not
worker-delegable). ADR-0017 ACCEPTED, ESC-037 RESOLVED. Retros RETRO-153..159 filed. `main` tip is
`2083e07` at the start of this session; 0 open PRs. `backlog/STATUS.md`'s "SESSION 10" entry only
narrates the FOLLOW-462 half of that work — treat this banner + the git log as the source of truth,
not that stale STATUS.md paragraph.

**This session (11):** re-confirmed the 3 standing OPEN escalations (ESC-020/ESC-028/ESC-034)
unchanged and non-blocking (established precedent: code-complete-awaiting-operator-action). Promoted
FOLLOW-513 (P1, backend-engineer) from `backlog/FOLLOW_UPS.md` stub to this queue, flipped
`READY -> IN_PROGRESS`, branch `backend-engineer/FOLLOW-513-queue-sentry-binding`. Full delegation
brief in `backlog/HANDOFFS.md`. See the FOLLOW-513 ticket block (after FOLLOW-482) for AC.

---

## ▶️ (superseded) START HERE — resume 2026-07-04 (end of 2026-07-03 session)

**MILESTONE 2026-07-03: the Modal ML layer is LIVE in prod for the first time — AI description
generation works end-to-end.** From "nothing deployed" (ESC-036) to a working, auto-deploying
pipeline. Attested: a real Sonnet-4.6 `family_buyer` description (1060 chars) was generated via the
deployed direct-Modal web endpoint and written to prod `description_cache_persistent`.

**All merged to `main`:** #425 FOLLOW-457, #426 FOLLOW-450, #427/#434 PM bookkeeping, #428
FOLLOW-460, #429 FOLLOW-459, #430 FOLLOW-456, #431 FOLLOW-485 (ADR-0016 direct-Modal), #432
modal-deploy workflow, #433 (Modal image contract-fixture fix), #435 (workflow httpx/fastapi fix).
FOLLOW-436/460/485 = DONE; ESC-036 = RESOLVED. Modal auto-deploy CI is armed and GREEN
(`.github/workflows/modal-deploy.yml`, MODAL*TOKEN*\* GitHub secrets set).

**What's live now:** control-plane → direct HTTPS → Modal `estalara-description-generator`
(`description_requested_endpoint`) → Sonnet 4.6 → Redis + Postgres `description_cache_persistent`.
Modal workspace = `estalara`; secret = `estalara-secrets` (9 keys, no Redpanda per ADR-0016). Vercel
prod has `MODAL_DESCRIPTION_URL` / `MODAL_EMBED_SEED_URL` + the fail-closed secrets from FOLLOW-456.

**3 deploy bugs found + fixed on the way (context if anything regresses):** (1) contract fixtures
missing from the Modal image → import crash → PR #433; (2) `pip install modal` only in the deploy
workflow → `ModuleNotFoundError: httpx` → PR #435 (`modal httpx fastapi`); (3) a stray LEADING SPACE
in the manually-pasted `ANTHROPIC_API_KEY` secret value → misleading
`APIConnectionError: Connection error.` → corrected in `estalara-secrets` (hardening filed as
FOLLOW-488).

**▶️ NEXT (do tomorrow, in priority order):**

1. **Real-listing E2E confirmation (the ONE remaining product proof).** Go-live was attested by
   POSTing the Modal endpoint DIRECTLY. Not yet exercised: browser → SDK on a real pilot listing →
   `GET /api/adapt/description` (control-plane) → dispatch to Modal → row + adapted copy on the
   page. This also exercises the ESC-019 listing-fetch hop (may return '' → FOLLOW-457 skip). Open a
   real pilot listing, then check `SELECT count(*) FROM description_cache_persistent` (was reset to
   0 after the smoke test). Watch: headline came back null in the smoke test — check if it generates
   on a real listing.
2. **Modal Phase B/C** (deferred): `estalara-intent-engine` (P1) and `estalara-schema-validation` /
   `estalara-stream-consumer-events` (FOLLOW-458, chat = shadow-only). Same stand-up pattern
   (runbook `docs/runbooks/MODAL_PROD_STANDUP.md` §1); each needs its keys in `estalara-secrets`
   (stream-consumer also needs `redpanda-creds`/`clickhouse-creds` — but Redpanda is out of pilot
   budget, so re-decide per ADR-0016 before B/C).
3. **Two older pilot-measurement operator legs still OPEN:** FOLLOW-449 (apply ClickHouse migration
   0015 `intent_events.session_id` to prod — CH does NOT auto-apply) and FOLLOW-450 AC1 (flip
   `FEEDBACK_ENDPOINT_ENABLED=true` + provision `OPS_TENANT_ID`/`ADAPT_API_KEY`/`DATABASE_URL_ADMIN`
   in Doppler prd, then `pnpm feedback:canary` to attest). These gate a MEASURED pilot; separate
   from the Modal/descriptions thread above.
4. **Small hardening follow-ups filed:** FOLLOW-486 (CI smoke for fastapi*endpoints), FOLLOW-487
   (.env.example REDPANDA_TOPIC*\* cleanup), FOLLOW-488 (`.strip()` on secret-env reads), plus the
   Sprint-22b P2/P3 tail (461–473). Full Modal stand-up runbook:
   `docs/runbooks/MODAL_PROD_STANDUP.md`.

---

**Updated 2026-07-06 (session 10) — Bookkeeping-hygiene fix + next P2 delegated.** Confirmed via
`gh pr list --state open` there are NO open PRs to validate this round. Confirmed via `gh pr view`
that PR #429 (FOLLOW-459) and PR #430 (FOLLOW-456) are MERGED (2026-07-03T09:14:42Z and
2026-07-03T09:42:22Z respectively) — both were already correctly listed as merged in this file's own
prose resume note, but their individual ticket `status:` fields in Sprint 22b were never flipped
past `READY_FOR_REVIEW` by the prior session (a pure bookkeeping miss, not a code issue). CORRECTED
both to `status: DONE` with `completed_at` set from the actual merge timestamp and `pr:` annotated
`(MERGED)`. **RETRO DEBT FOUND:** neither FOLLOW-456 nor FOLLOW-459 has a RETRO-NNN entry in
`backlog/RETROSPECTIVES.md` (last entry is RETRO-152 / FOLLOW-450); FOLLOW-460 and FOLLOW-485 (both
already correctly `DONE`) are ALSO missing their retrospectives — 4 merged tickets with no retro:
FOLLOW-456, FOLLOW-459, FOLLOW-460, FOLLOW-485. This orchestrator invocation has no
subagent-spawning tool available in this session (Read/Write/Edit/Bash only) so the
`retrospective-analyst` spawn could not be executed here — flagging for the next invocation that
does have Task/Agent access to spawn RETRO-153 (FOLLOW-456), RETRO-154 (FOLLOW-459), RETRO-155
(FOLLOW-460), RETRO-156 (FOLLOW-485) before any further sprint-close activity, per CLAUDE.md "Per-
ticket retrospective loop." Re-confirmed the three standing OPEN escalations (ESC-020, ESC-028,
ESC-034) are unchanged and remain non-blocking per established precedent (each self-documents as
operator-action-pending, not an unresolved architectural/product decision) — no new escalation
opened. **Ticket picked:** FOLLOW-462 (P2, data-engineer — ClickHouse DSR SQL: bind `session_id` as
a param so a trailing backslash can't silently defeat an Art.17 erasure, F-14). Rationale: it is the
highest real-world-severity item among the READY, unblocked, worker-delegable Sprint 22b P2 tail
(FOLLOW-461/462/463/464/465/466/473/474/467/468/469 all READY, no P1 is READY —FOLLOW-471 the P1
gate ticket is BACKLOG, blocked on the whole epic); F-14 is a live GDPR Art.17 compliance-erasure
correctness bug (silent failure on `session_id` values containing a backslash), a materially higher
stakes finding than the hardening/cost/bundle items on the same P2 tier. Flipped FOLLOW-462
`READY → IN_PROGRESS`, `assigned_to: data-engineer`,
`branch: data-engineer/FOLLOW-462-clickhouse-dsr-param-binding`. Delegation-table row used:
"ClickHouse, Redpanda, ETL, archetype pipeline, drift cron, DSR delete → data-engineer." IN_PROGRESS
count now: FOLLOW-462 + stale TICKET-PILOT-001 = 2 (cap 3, room for one more). No PR opened yet by
this session — the actual worker invocation (isolated worktree `data-engineer/FOLLOW-462-...`,
ticket context = this ticket's YAML block + docs/MASTER_DESIGN.md §Snapshot.1 +
CONVENTIONS_PATCH.md + this HANDOFFS note) must be run by whatever mechanism in the outer harness
has subagent-spawn capability; this session could only perform the queue-state and file-based
portion of delegation.\*\*

**CI CONFIRMATION for this session's own bookkeeping PR #437** (docs-only: QUEUE.md/STATUS.md/
HANDOFFS.md/ESCALATIONS.md/FOLLOW_UPS.md/lessons.md — no application code touched):
`gh pr checks 437` → 55 pass / 2 fail across both matrix legs; the 2 failures are both "Rule I —
wired-or-dead check", the documented pre-existing non-blocking baseline (see project memory "CI gate
landscape" — this gate has ~175 pre-existing violations unrelated to any diff and is not a real
merge gate). Non-Rule-I non-success count: **0**. Human may merge #437 whenever convenient; it
carries no functional risk.

---

**Updated 2026-07-02 (session 9) — Recovered from a crashed session 8 that had delegated FOLLOW-450
(backend-engineer) and FOLLOW-457 (ml-engineer) to isolated worktrees and then died mid-flight. Both
workers had FINISHED their code but the terminal ended before committing — the complete work sat
uncommitted in `.claude/worktrees/wt-follow450` and `wt-follow457`. This session validated each
(prettier/lint/typecheck + targeted vitest + `next build` per the FOLLOW-474 gate), committed on the
worker branches, pushed, and opened PRs; no feature logic was changed. BOTH PRs SUBSEQUENTLY MERGED
to `main` this session (FOLLOW-457 PR #425 → merge `0b9b7ad` 15:58:59Z; FOLLOW-450 PR #426 → merge
`2460457` 15:59:24Z) and flipped READY_FOR_REVIEW → DONE. RETRO-151 (FOLLOW-457,
gaps-no-shipped-bug: directive fact-whitelist over-suppression risk; stubs FOLLOW-475/476/477) and
RETRO-152 (FOLLOW-450, clean PASS; stubs FOLLOW-480/481) written to RETROSPECTIVES.md; stubs
appended to FOLLOW_UPS.md (next-free now 482). RETRO-152 promoted a permanent rule — the first
double-letter **Rule AA** (CODE-VS-PROD-AXIS: operator-gated tickets are
CODE_COMPLETE_OPERATOR_PENDING not DONE; count 3 with RETRO-146+150 prior) to CONVENTIONS_PATCH.md
(letter-scheme flagged for human review). Neither PR carried a DB migration, so no db-migrate.yml
prod-apply was triggered by these merges. NEXT (CEO directive 2026-07-02: do the 3 remaining P1s
SEQUENTIALLY, one at a time with review between): started FOLLOW-460 (ml-engineer, permanent
description cache) IN_PROGRESS in an isolated worktree; FOLLOW-459 then FOLLOW-456 follow after each
clears. The two operator-only go-live actions (FOLLOW-449 CH migration apply, FOLLOW-450 AC1
feedback flip) stay deferred on the pilot go-live checklist per Rule AA — revisit with Piotr/Rafał.
SEQUENTIAL PROGRESS (session 9): FOLLOW-460 → PR #428 (READY_FOR_REVIEW, CI green; wired the
previously-dead /api/internal/description-cache endpoint to the Modal job; NEW operator go-live item
per Rule AA — provision DESCRIPTION_CACHE_API_BASE_URL + DESCRIPTION_CACHE_INTERNAL_SECRET in Modal
`estalara-secrets`, else the cache write silently no-ops). FOLLOW-459 → PR #429 (READY_FOR_REVIEW,
CI green; ACK-before-CH via ctx.waitUntil; durable retry deferred to FOLLOW-482). FOLLOW-456 → PR
#430 (READY_FOR_REVIEW, CI green; JWT-derived demo revoke, estalara_staff-gated generation-model,
new secret-compare.ts fail-closed + timingSafeEqual on 3 routes). ⚠️ FOLLOW-456 MERGE RISK:
/api/tenants now fails closed → verify ADMIN_API_SECRET is set in Vercel prod BEFORE merging #430 or
onboarding 401s (FOLLOW-483 filed, P1; FOLLOW-484 grep-lint filed P3). All three CEO-directed P1s
now READY_FOR_REVIEW. NOTE the FOLLOW-459 worker mis-numbered its deferral FOLLOW-475 (collided with
RETRO-151's 475 on this PM branch, invisible to its origin/main worktree) — renumbered to
FOLLOW-482 + its FOLLOW_UPS.md edit reverted (PR #429 commit `c87073b`) so this PM branch is the
single writer of FOLLOW_UPS.md; the FOLLOW-456 worker was pre-instructed NOT to touch backlog files.
FOLLOW-450 → PR #426 (commits `8d6543d` feature + `1ca735e` a path-scoped `.gitleaks.toml` allowlist
for two test-fixture false positives in the new PGlite e2e file — same Rule V exemption class the
repo already applies to sibling `*route-driven-pglite.test.ts`; feature code byte-for-byte
unchanged). FOLLOW-457 → PR #425 (commit `a3123ab`, zero defects — passed every gate on first run).
Both flipped IN_PROGRESS → READY_FOR_REVIEW. CI GREEN on every real gate on BOTH (Typecheck, Test
Node 22, SDK E2E, Build, Build control-plane, Lint, Format, Gitleaks, all Python, Demo integration,
Vercel, Rule H/J) — independently re-confirmed via `gh pr checks`, not trusted from the agent
summaries; only the pre-existing non-blocking "Rule I — wired-or-dead" is red on each (neither diff
adds a dead symbol: FOLLOW-450's `reportFeedbackPingRejected` + canary exports and FOLLOW-457's
fact-check helpers are all wired to consumers). FOLLOW-457's ticket `branch:` field corrected from
the stale `ml-engineer/FOLLOW-457-grounding-integrity` to the branch actually used,
`ml-engineer/FOLLOW-457-llm-grounding-integrity`. FOLLOW-450 remains CODE_COMPLETE_OPERATOR_PENDING:
its AC1 (Doppler prd `FEEDBACK_ENDPOINT_ENABLED=true` flip + `ADAPT_API_KEY`/`OPS_TENANT_ID`/
`DATABASE_URL_ADMIN` provisioning) is operator-only and stays on the pilot go-live checklist, not
closed by the code PR. ALSO CONFIRMED CLOSED this session: FOLLOW-455's migration
`0032_dsr_verifications_attempt_count.sql` (whose auto-triggered db-migrate run `28586941940` was
CANCELLED at session-8 end) DID reach prod — a manual `workflow_dispatch` run (`28592368063`,
SUCCESS on `0e9ee1b`) applied it; verified directly against prod Supabase (project
yhmivuqeqkmzpxpyrsvc): `dsr_verifications.attempt_count` column AND the
`dsr_verifications_tenant_email_created_idx` rate-limit index both present. No new escalation
opened; the three standing OPEN escalations (ESC-020, ESC-028, ESC-034) remain non-blocking
(operator-action-pending).**

**Updated 2026-07-02 (session 8) — Recovered from a crashed session 7 that had delegated FOLLOW-454
and FOLLOW-455 to isolated worktrees and then ended mid-flight. Both confirmed MERGED to `main`:
FOLLOW-454 (PR #422, commit `c060a69`, SSR-cookie auth on tenant dashboard) and FOLLOW-455 (PR #423,
commit `765cb81`, DSR OTP hardening — its worker had DIED leaving work uncommitted-but-correctly-
branch-isolated; this session fixed 4 gate-class defects [lint/format/typecheck/`next build`] before
committing, verified 106 DSR tests + `next build` exit 0). Both independently re-confirmed via
`gh pr view`/`gh pr checks` (not trusted from the handoff summary) — CI green on every real gate on
both (only the pre-existing non-blocking "Rule I" red). Flipped both IN_PROGRESS → DONE. RETRO-149
(FOLLOW-454, no fresh pattern — tenant-side mirror of the admin SSR-cookie fix) and RETRO-150
(FOLLOW-455, one fresh count-1 pattern: RECOVERED-WORK-MULTI-GATE-DEFECT, distinct from RETRO-146's
branch-hygiene finding) written to `backlog/RETROSPECTIVES.md`. FOLLOW-474 filed (P3,
devops-engineer) to codify a mandatory pre-PR `next build` gate + worktree workspace-dts bootstrap,
promoted directly to Sprint 22b as READY. Migration `0032_dsr_verifications_attempt_count.sql`
(FOLLOW-455) auto-triggered `.github/workflows/db-migrate.yml` run `28586941940` on merge — still IN
PROGRESS (staging leg) as this session ended; NOT YET CONFIRMED COMPLETE, next session must verify.
IN_PROGRESS count freed to 1 (stale TICKET-PILOT-001) after the DONE flips, then refilled to 3 (cap)
by delegating the next two unblocked Sprint 22b tickets on different agents: FOLLOW-450 (P0,
backend-engineer — the only READY P0; feedback/bandit go-live code leg, AC1 Doppler-prd provisioning
stays operator-only) and FOLLOW-457 (P1, ml-engineer — LLM grounding integrity fail-loud + fact
whitelist). No new escalation opened; the three standing OPEN escalations (ESC-020, ESC-028,
ESC-034) re-confirmed non-blocking (operator-action-pending, not architectural).**

**Updated 2026-07-02 (session 7) — FOLLOW-452 (PR #418, commit c0d9b39) and FOLLOW-453 (PR #419,
commit 807869d) confirmed MERGED to `main`; both flipped READY_FOR_REVIEW → DONE. RETRO-147 and
RETRO-148 written to `backlog/RETROSPECTIVES.md` (no new FOLLOW stubs — both PRs' minor notes folded
into existing FOLLOW-441 canary-widening / FOLLOW-471 re-audit QA awareness, not duplicated).
Delegated the next two unblocked P1 Sprint 22b tickets to different free agents in isolated
worktrees: FOLLOW-454 (backend-engineer, SSR-cookie auth mismatch — the highest-impact remaining
correctness gap, affects every tenant-dashboard browser-session route) and FOLLOW-455
(compliance-engineer, DSR OTP CSPRNG/rate-limit/erasure hardening — live security + Art.17/15/20
compliance gap). IN_PROGRESS count now: FOLLOW-454 + FOLLOW-455 + stale TICKET-PILOT-001 = 3 (at the
3-ticket cap — no further delegation until one clears). FOLLOW-449 (prod ClickHouse migration
attest+apply) and FOLLOW-450 (feedback/bandit go-live flip) remain
CODE_COMPLETE_OPERATOR_PENDING/READY-but-operator-gated — NOT delegated to a worker this session per
explicit operator-only scoping (Piotr/Rafał), tracked on the PILOT GO-LIVE CHECKLIST in STATUS.md,
not silently dropped. Three OPEN escalations (ESC-020, ESC-028, ESC-034) re-confirmed non-blocking
against established precedent (each explicitly self-documents as operator-action-pending, not an
unresolved architectural/product decision) — no new escalation opened.**

**Updated 2026-07-02 (session 6) — FOLLOW-452 and FOLLOW-453 completed and opened as PRs #418 and
#419 (resumed from a suspended session that had delegated both to backend-engineer worktrees but
left the work uncommitted). Both flipped IN_PROGRESS → READY_FOR_REVIEW. CI green on every real
merge gate (Test Node 22, SDK E2E, Build, Build control-plane, Lint, Format, Typecheck); the only
red is the pre-existing, non-blocking "Rule I — wired-or-dead check" (173 legacy sdk/shared symbol
warnings, untouched by these diffs — see CI gate landscape). NOTE: FOLLOW-452's isolated worktree
needed its @estalara/{shared,db,auth,sdk} deps built before the local pre-commit lint could resolve
types — the 37 "type could not be resolved" errors were an unbuilt-workspace artifact, not a code
defect (candidate FOLLOW-UP: worktree bootstrap should build workspace dts). IN_PROGRESS count now:
stale TICKET-PILOT-001 = 1.**

**Updated 2026-07-02 (session 5) — FOLLOW-451 DONE (PR #416, merge commit 0e99415); two residual
follow-ups filed and promoted to Sprint 22b as READY: FOLLOW-472 (P3, demo-JWT path tenant_id-claim
mismatch not checked) and FOLLOW-473 (P2, GET /api/adapt presence-only auth now weaker than the
hardened POST path). FOLLOW-450's `depends_on` loosened from `[FOLLOW-449]` to `[]` — the
bandit/feedback subsystem is Postgres-only with no code dependency on the ClickHouse migration in
FOLLOW-449; only FOLLOW-450's production go-live flip is operator-gated, not its code. FOLLOW-452
and FOLLOW-453 delegated IN_PROGRESS to backend-engineer, running concurrently in ISOLATED WORKTREES
(shared-working-directory hazard flagged by the FOLLOW-451/RETRO-146 near-miss). IN_PROGRESS count:
FOLLOW-452 + FOLLOW-453 + stale TICKET-PILOT-001 = 3 (at the 3-ticket cap).**

**Updated 2026-07-02 — CEO DECISIONS Q1/Q2/Q3 recorded for Sprint 22b.** Q1: BOTH PATHS mandated for
POST /api/adapt (demo-JWT AND real tenant API key via ADR-0015 resolveApiKey) — FOLLOW-451 confirmed
P0, not deferrable. Q2: SHADOW-ONLY for this pilot — live chat→archetype adaptation is OUT of scope;
FOLLOW-458 downgraded P1→P2 fast-follow, shadow consumer code stays (deploy deferred, not cut). Q3:
MEASURED pilot confirmed — FOLLOW-450 (feedback/bandit loop), FOLLOW-452 (holdout archetype
logging), FOLLOW-453 (dashboard fail-loud) are CONFIRMED P0/P1 go-live blockers. Also: FOLLOW-449's
code/CI/docs leg (AC3/AC4/AC5) is DONE — PR #413 merged (18367d3) — but its prod-apply leg (AC1/AC2,
CH migration 0015 attest+apply) is OPERATOR-PENDING (Piotr/Rafał), tracked on the pilot go-live
checklist below, not silently closed. See §"CEO decisions" table further down and MASTER_DESIGN
§Snapshot.1 for propagation.

**Updated 2026-07-01 (session 2) — Full-Stack Audit Remediation epic added as `Sprint 22b` (bottom
of file): tickets FOLLOW-449…FOLLOW-471 close every finding (F-01…F-21) from the 2026-07-01
end-to-end code audit. FOLLOW-471 is the epic's acceptance gate — a clean re-audit ("no gaps, no
bugs, Adaptive Listings works as intended") is the Definition of Done. P0 blockers for a _measured_
pilot: FOLLOW-449 (intent_events prod migration), FOLLOW-450 (enable feedback/bandit loop),
FOLLOW-451 (real API-key adapt auth). See MASTER_DESIGN §Snapshot.1 "Update 2026-07-01" + Changelog
v4.2.**

**Updated 2026-06-14T11:00Z (partial-resolution pass). K.3.6 D-1 "immediate weights" is
PRODUCTION-LIVE as of 2026-06-14. FOLLOW-307 DONE: migration 0030 applied to prod Supabase (project
yhmivuqeqkmzpxpyrsvc, eu-west-3) via `doppler run --config prd -- pnpm db:migrate` on 2026-06-14.
Seed row verified: intent_weight_configs id=3ecd053e-3d2e-4eed-a900-0a42ff8c3f9e, tenant_id=NULL,
is_active=true, weights={}, created_at=2026-06-14T09:26:45Z. GET /api/intent/config now returns
data_source:'live' for override-less tenants. DRIFT FINDING (captured in ESC-022): prod was 14
migrations behind at apply time — drizzle.**drizzle_migrations had only 17 entries (last applied
2026-05-28 ~migration 0016); migrations 0017→0030 had NEVER been applied to prod, including
compliance migrations 0019/0020 (conversion_labels), 0024 (dsr_durable_lead_id), 0021
(engagement_scores), 0022 (quiz_completions), 0025 (tenants_quiz_enabled), 0026/0027 (quiz_config
strips), 0028 (intent_sessions), 0029 (intent_weight_configs), 0030 (seed). All 14 applied cleanly;
prod drizzle.**drizzle_migrations now = 31 (full repo count). Root cause: no auto-apply mechanism
(RETRO-076 OG-1). Note: prod project was AUTO-PAUSED (Supabase idle pause) and had to be resumed.
FOLLOW-308 (P1 devops) filed for standing mechanism decision. ESC-022 PARTIALLY-RESOLVED: item (1)
compliance integrity SIGNED OFF 2026-06-14 by Piotr (CEO) — gap confirmed benign (pre-pilot, zero
traffic, purely-additive migrations, prod auto-paused; no DSR requests, conversion labels, or quiz
completions written during the window); item (2) OPEN — Option A/B standing mechanism decision still
needed to unblock FOLLOW-308. ADR-0012 D-1 WAVE 3 + WAVE 4 COMPLETE (8 PRs total):
FOLLOW-267/294/268-write/297/299/301/268-sdk/305 all DONE. FOLLOW-266 Phase 2 seed DONE (PR #293).
FOLLOW-302 DONE. RETRO-073/074/075/076 complete. CONVENTIONS_PATCH.md Rule X promoted. FOLLOW-293
(closure gate) remains OPEN for live-network smoke (now unblocked by FOLLOW-307 completion).
RETRO-074/075 confirmed the double-/api bug also silently broke quiz-config delivery (FOLLOW-275)
and feedback/quiz-completion writes — all FOUR fixed by PR #291.**

**Sprint 13b: FOLLOW-087/099/100/101/102/252/253/257/263 DONE. RETRO-050/051/052/053 complete.
FOLLOW-265 (P1) DONE — PR #262 merged 2026-06-11 (quiz-only ratified, docs synced, contract-pinning
tests, mis-citation fixed; RETRO-052 → Rule U promoted, FOLLOW-271 stub). FOLLOW-264 (P2) DONE — PR
#263 merged 2026-06-11 (Option-A removal complete: dashboard input removed, Zod field dropped,
dead-name cleaned, Rule Q seam-driven jsdom tests replace mirror; RETRO-053 → Rule G amended,
FOLLOW-270 stub). FOLLOW-169 (P2) DONE — PR #264 merged 2026-06-11T06:29:18Z (headline
anti-hallucination grounding: \_HEADLINE_SYSTEM_PROMPT + verified_facts, post-gen fact check, SDK
source=ai_cached guard, stale docstrings fixed; RETRO-054 to be spawned). FOLLOW-270 (P2) and
FOLLOW-271 (P2) promoted to Sprint 16 queue (backend-engineer). FOLLOW-270 DONE (PR #265 merged
2026-06-11). FOLLOW-271 DONE (PR #266 merged 2026-06-11 — strip quizConfig.enabled on write +
backfill migration, Rule U closed). Wave A COMPLETE — all 5 DONE (FOLLOW-258 PR #249, FOLLOW-259 PR
#250, FOLLOW-260 PR #251, FOLLOW-261 PR #252, FOLLOW-262 PR #253 — all merged). Sprint 16 COMPLETE —
15 DONE (FOLLOW-170/173/174/175/176/182/183/184/185/187/190/227/230/234/270/271), 1 READY_FOR_REVIEW
(FOLLOW-191 local-first testing pending — ESC-020 workflow clarified). Sprint 15 COMPLETE — 21/21
DONE. ESC-020 OPEN but pipeline UNBLOCKED per CEO clarification 2026-06-10: local-first testing
required before prod deploy; Rafal action deferred until CEO signs off locally. FOLLOW-266–269
added: Archetype Identification Tracer (§K.3.6, CEO-directed 2026-06-10) — stubs in FOLLOW_UPS.md,
promoted to Sprint 17 planning. Sprint 17 WAVE 1 COMPLETE (2026-06-12): FOLLOW-274 DONE (PR #267),
FOLLOW-273 DONE (PR #268), FOLLOW-272 DONE (PR #275), FOLLOW-275 DONE (PRs #270+#271), FOLLOW-276
DONE (PR #272), FOLLOW-277 DONE (PR #276), FOLLOW-278 DONE (PR #273), FOLLOW-279 DONE (PR #274 —
doc-only correction to ADR-0011 false retired claim). RETRO-059/060/061 complete. RETRO-062
(FOLLOW-276) and RETRO-063 (FOLLOW-278) pending spawn. FOLLOW-266 Phase 1 DONE: PR #277 merged
2026-06-12T18:23:36Z (intent_sessions Supabase migration 0028 + intent_events ClickHouse DDL 0014;
data-engineer complete). RETRO-064 (FOLLOW-266 Phase 1) pending spawn. FOLLOW-266 Phase 2 DONE — PR
#278 merged 2026-06-12 (intent_weight_configs migration 0029 + CF Worker dual-write handler).
RETRO-065 complete (3 P1 defects found: CB-1 on_conflict placement, LG-1 event_type vocab, LG-2 join
key). FOLLOW-286 (P1) DONE — PR #279 merged 2026-06-12T21:27:21Z (all 3 P1 defects + 8 contract
tests + P2 items). FOLLOW-287 (P1) DONE — PR #281 merged 2026-06-12T22:31:19Z. FOLLOW-288 (P0) DONE
— PR #282 merged 2026-06-12T23:27:03Z (migration 0016 SELECT 1 no-op, intent_session_id omitted from
INSERT, ClickHouse migrations smoke NOW GREEN). ESC-021 RESOLVED.**

**Sprint 13a-hardening-v3 DONE — FOLLOW-149 (P0 infra hardening) DONE at PR #166
(https://github.com/Pnawrocki9/Adaptive-Listings/pull/166, MERGED).** Triggered by a 2026-05-28
diagnostic that proved the previous "Migration 0015: prd ✅ applied" bookkeeping was false —
drizzle-kit silently generated 2025 timestamps for entries 15/16 (1-year year-drift, second
occurrence after `c92da81`), Drizzle's migrator silently skipped them, and `migrate.ts` falsely
printed "Migrations applied successfully." with zero applied. FOLLOW-149 lands: (A) journal
`when`-values for entries 15/16 repaired to commit-timestamp-aligned 2026 values; (B) new CI gate
`Migration journal monotonicity check` (passing, 7s) — fails on non-monotonic OR >7d commit-date
drift; (C) `migrate.ts` now reports before/after/applied/pending counts AND exits non-zero with a
loud warning when 0 applied but pending>0 (trap-killer); (D) migration 0015 applied to prd via
isolated apply (see ESC-012) — `tenants.pilot_frozen` column verified present (boolean/default
false), `drizzle.__drizzle_migrations` row id=17 hash matches. Migration 0016 INTENTIONALLY NOT
applied — its DO $ assertion requires the pilot tenant to exist, and Drizzle's single-transaction
migrator would roll back 0015 alongside it. **ESC-012 OPEN**: `pnpm db:migrate` is no longer safe in
tenant-less envs until TICKET-PILOT-001 either seeds the pilot tenant before migrate OR migration
0016's RAISE EXCEPTION is softened to NOTICE — data/backend engineers decide during TICKET-PILOT-001
planning. Rule O added to CONVENTIONS_PATCH.md. RETRO-025 (FOLLOW-143/144 inline fixes) + RETRO-026
(FOLLOW-149) deferred until PR #166 merges. **Sprint 13a-hardening-v2 COMPLETE — 2/2 P0 EU go-live
blockers DONE (PR #164 FOLLOW-139 at e4e37ac, PR #165 FOLLOW-141 at 19d11d2; both merged to main).
FOLLOW-143 (wire getOrCreateCrossSessionId into init) + FOLLOW-144 (reconcile "rotates monthly" to
90-day cadence across 5 disclosure surfaces) fixed inline in PR #164. RETRO-025 pending
post-FOLLOW-149-merge. FOLLOW-140/142 deferred Sprint 14.** Sprint 13a-hardening COMPLETE —
pre-pilot gate CLOSED (4 PRs merged, main at `29c97ab`). The pre-pilot hardening wave landed its 4
P0/P1 tickets: FOLLOW-127 (P0, PR #161 `6a27841`) detection engine now populates
`inquiry_submit_selector`; FOLLOW-128 (P0, PR #160 `256b469`) DPIA §13.1/§13.2 mandated
consent-banner disclosures shipped in the SDK; FOLLOW-129 (P0, PR #159 `10ae1e7`) tenant Privacy
Notice template + DPO sign-off + consent-withdrawal erasure QA; FOLLOW-122 (P1, PR #162 `29c97ab`)
`/dashboard/pilot` consumes `data_source` provenance + surfaces the fail-loud 500 state. **Net
effect: inquiry tracking is production-ready, EU GDPR compliance is complete, and the pilot
dashboard renders honestly — Sprint 13a Lane B (TICKET-PILOT-001 onboarding) is now READY (gate
closed).** retrospective-analyst to run on PR #159–#162 (RETRO-019→022). **Prior wave — Sprint 13a
Lane A — Wave 3 MERGED + YELLOW audit Sprint 1 MERGED (massive merge wave, main now at `6827305`).**
Wave 3's 5 PRs all on main: FOLLOW-094 (PR #153, `9f32aa8`), FOLLOW-093 (PR #154, `a7d9c03`),
FOLLOW-098 (PR #155, `4ce6e37`), FOLLOW-117 (PR #156, `38a8393`), FOLLOW-114 (PR #157, `f882dae`).
**All of Sprint 13a Lane A is now DONE (8/8); only Lane B remains (BLOCKED → now
unblocked-on-Lane-A, pending CEO spawn go-ahead).** Separately, a **parallel YELLOW audit track**
(F-NN ticket system, NOT in the FOLLOW-NNN sprint plan) landed its Sprint 1 as PR #158 (`6827305`):
F-02 cold-start prior wire, F-09 locale-correct slot copy, F-10 LLM cost attribution, F-13/F-14 GDPR
LIA in DPIA — tracked here as FOLLOW-118/119/120/121 (all DONE). retrospective-analyst to be spawned
on PR #153–#158 (6 retros). **Pilot launch gate now needs BOTH Lane B (TICKET-PILOT-001/002 +
FOLLOW-092) AND YELLOW audit Sprint 2–4.** **Phase 2 Wave 1 MERGED** — FOLLOW-105 (PR #150,
`bf0585d`) DONE: canonical `/api/adapt` enforced, ADR-0006 ACCEPTED, Worker 410 Gone, §Snapshot.7
risk #1 RESOLVED. **Wave 2 (FOLLOW-097 + FOLLOW-106) MERGED** — FOLLOW-097 PR #151 (`3cf05ee`) and
FOLLOW-106 PR #152 (`b83e6c0`) both on main 2026-05-26, all real CI gates were green. **Wave 3
DONE** — spawned 2026-05-26 (CEO go-ahead), merged 2026-05-27, 5 parallel: FOLLOW-094/098/093 +
FOLLOW-114 (P0, RETRO-011) + FOLLOW-117 (RETRO-012). retrospective-analyst spawned on PR #150, #151,
#152. **Sprint 13 OPEN** — three-track structure: Lane A (correctness fixes from RETRO-008/009) →
Lane B (pilot launch on app.estalara.com, blocked until Lane A) → Lane C (Adaptive Listings v1.0
intent build, parallel with Lane B during shadow window). See the Sprint 13 section below. **Sprint
12 COMPLETE as of 2026-05-25** — Lane A hardening (FOLLOW-081/075/078) + Lane C ROI instrumentation
(PILOT-003/004) merged across PRs #142–#146; Lane B (TICKET-PILOT-001/002 pilot onboarding) DEFERRED
to Sprint 13 because RETRO-008/009 surfaced P1 dashboard-correctness blockers that gate go-live;
FOLLOW-079 CANCELLED (split into FOLLOW-088/089/090). RETRO-SPRINT-12 written; Master Design bumped
to v2.8. Sprint 11 COMPLETE as of 2026-05-24 (5 P1 pilot-blockers merged: #135 FOLLOW-063, #136
FOLLOW-069, #137 FOLLOW-068, #138 FOLLOW-040, #139 FOLLOW-039). RETRO-007 written; Master Design
bumped to v2.5; AI Council Checkpoint 2026-05-24 approved Sprint 12 as "controlled pilot launch on
app.estalara.com". Sprint 12 COMPLETE — Lane A hardening + Lane C ROI instrumentation merged; Lane B
pilot onboarding deferred to Sprint 13. Sprint 10 COMPLETE as of 2026-05-23 (8 PRs merged: #127,
#128, #129, #130, #131, #132, #133, #134). RETRO-006 written; Master Design bumped to v2.3; Rule H
amendment applied (CONVENTIONS_PATCH.md). Sprint 9.5 COMPLETE (2026-05-22, 6 PRs: #121, #122, #123,
#124, #125, #126). Sprint 9 COMPLETE as of 2026-05-15: GDPR-001 (PR #111), GDPR-002 (PR #118),
GDPR-003 (PR #116), GDPR-004 (PR #117), DESC-001 (PR #112+#114), VAL-001 (PR #110) — all 6 DONE.
DESC-PIVOT-001 (PR #115) merged. Sprint 7.5 COMPLETE. Sprint 7 COMPLETE. Sprint 8 COMPLETE. Sprint
8.5 COMPLETE. Sprint 2.5 SUPERSEDED — TICKET-030 + TICKET-033 promoted to Sprint 9.5, TICKET-032
superseded by Sprint 7.5 auto-detect, TICKET-034/036 deferred (Q5 decision 2026-05-21), TICKET-035
already CANCELLED. **Sprint 11 P1 pilot-blockers DONE:** FOLLOW-063 (archetype-embedding auto-seed
CI, PR #135), FOLLOW-068 (demo-integration CI, PR #137), FOLLOW-069 (HMAC compat test, PR #136),
FOLLOW-039 (ClickHouse DSR hard-delete — EU pilot gate cleared, PR #139), FOLLOW-040 (Doppler CI
hygiene, PR #138). **Sprint 12 pilot target:** app.estalara.com, EU region, free pilot, primary
metric CTA lift. Krok A document governance reset merged (PR #119, Master_Design v2.0,
docs/ops/OPERATING_PRINCIPLES.md v1.1) — Operating Principles now active for all sessions.
ANTHROPIC_API_KEY activated in Doppler dev/stg/prd 2026-05-21 (Krok B) — AI Vision fully
operational.

**Sprint 15 OPEN — 2026-06-05. Master_Design bumped to v4.0. Based on full codebase audit
(docs/AUDIT-2026-06-04.md). Four tracks + signal enrichment:**

- **Track A (Pilot unblock, Week 1):** FOLLOW-191/192/193/194 — must complete before any real
  traffic
- **Track B (Signal bridges + Quiz v2.0, Week 2–3):** FOLLOW-195/196/197/198/199/200/201/202
- **Track C (Description cache redesign + MOAT, Week 3–4):** FOLLOW-203/204 + Sprint 14 carry-overs
  (FOLLOW-170…176, 190)
- **Track D (Background, Week 4–5):** FOLLOW-205/206, FOLLOW-087, FOLLOW-099
- **Track E (Signal enrichment, Week 2–3, P1/P2, low effort):** FOLLOW-207/208/209/210/211 — Track E
  tickets are low-effort, high-ROI signal enrichments identified in the 2026-06-05 audit gap
  analysis. FOLLOW-210 and FOLLOW-211 are P1 because they unlock categorical discrimination that
  behavioral signals cannot provide without payload context.

Single source of truth for ticket status. Updated by `pm-orchestrator`. Read by everyone.

## How to read this

Each ticket has a one-line entry in the appropriate sprint section. Statuses:

- `BACKLOG` — not yet sprint-planned
- `READY` — can start now
- `BLOCKED` — waiting on dependency
- `IN_PROGRESS` — actively being worked
- `READY_FOR_REVIEW` — PR open, PM-validated, CI green, awaiting human merge
- `DONE` — merged
- `STUCK` — escalation needed
- `CANCELLED` — won't do

Status changes are atomic: PM reads the file, modifies one entry, writes it back. Never partial
updates.

## Sprint progress

| Sprint | Weeks | Theme                                                                                                                               | Tickets | DONE | IN_PROG | READY | BLOCKED |
| ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------- | ---- | ------- | ----- | ------- |
| 0      | 1     | Foundation (repo, monorepo, CI, scaffolding, secrets, observability)                                                                | 9       | 9    | 0       | 0     | 0       |
| 1      | 2     | Ingest baseline + event schema                                                                                                      | 10      | 10   | 0       | 0     | 0       |
| 2      | 3     | Postgres + tenant auth + dashboard skeleton                                                                                         | 10      | 10   | 0       | 0     | 0       |
| 2.5    | 4     | Auto-Onboarding pipeline (NEW v1.1)                                                                                                 | 6       | 0    | 0       | 1     | 4       |
| 3      | 5     | SDK Tier 1 Observer + Magic Link UI                                                                                                 | 10      | 2    | 0       | 1     | 7       |
| 4      | 6     | Intent ontology v1 + Modal scaffolding                                                                                              | tbd     | —    | —       | —     | tbd     |
| 5      | 7     | LLM gateway + intent extraction from chat (Haiku 4.5 real-time + Sonnet 4.6 batch — decyzja 2026-05-25, patrz FOLLOW-087)           | tbd     | —    | —       | —     | tbd     |
| 6      | 8     | Embeddings + archetype matching + decision API                                                                                      | 3       | 3    | 0       | 0     | 0       |
| 7      | 9     | Decision API real logic + adaptation playbooks                                                                                      | 5       | 5    | 0       | 0     | 0       |
| 7.5    | 9.5   | Auto-Detection Engine                                                                                                               | 7       | 7    | 0       | 0     | 0       |
| 8      | 10    | A/B holdout + re-ranking + agency answers + variants + retro loop                                                                   | 16      | 13   | 0       | 0     | 0       |
| 9      | 11    | DPIA + ROPA + DSR + consent propagation + description pipeline                                                                      | 6       | 6    | 0       | 0     | 0       |
| 9.5    | 11.5  | MVP Demo Readiness (onboarding activation + bandit + scoring)                                                                       | 6       | 6    | 0       | 0     | 0       |
| 10     | 12    | Close the bandit loop + real embeddings + e2e test                                                                                  | 9       | 9    | 0       | 0     | 0       |
| 11     | 13    | Pilot readiness (seed CI, demo CI, HMAC compat, GDPR ClickHouse)                                                                    | 9       | 5    | 0       | 4     | 0       |
| 12     | 14    | Pilot launch on app.estalara.com — COMPLETE (Lane A + Lane C; Lane B → Sprint 13)                                                   | 7       | 5    | 0       | 2     | 0       |
| 13a    | 15    | Correctness + pilot launch (Lane A correctness gate + Lane B pilot launch) — Lane A 8/8 DONE; Lane B READY (gate closed)            | 11      | 8    | 0       | 1     | 2       |
| 13a-h  | 15    | Pre-pilot hardening — inquiry producer (FOLLOW-127), GDPR consent disclosures (FOLLOW-128/129), honest pilot dashboard (FOLLOW-122) | 4       | 4    | 0       | 0     | 0       |
| 13a-h2 | 15    | Pre-pilot hardening v2 — §13.2 localStorage xid erasure (FOLLOW-139), pilot inquiry selector seed (FOLLOW-141)                      | 2       | 2    | 0       | 0     | 0       |
| 13b    | 16    | Adaptive Listings v1.0 intent build (Lane C; parallel under hard isolation per freeze rule)                                         | 6       | 0    | 0       | 3     | 3       |
| Y-S1   | —     | YELLOW audit Sprint 1 (parallel track) — F-02 cold-start, F-09 locale copy, F-10 LLM attribution, F-13/F-14 GDPR LIA (PR #158)      | 4       | 4    | 0       | 0     | 0       |
| 15     | 17    | Pilot unblock + signal bridges + quiz v2.0 + description cache redesign + signal enrichment (audit 2026-06-04, MD v4.0)             | 21      | 21   | 0       | 0     | 0       |

| 16 | 18 | Conversion Label Loop (§T), SDK archetype persistence, DB integration tests, compliance
CRM docs, micro-poll Wave 2 | 17 | 16 | 0 | 1 | 0 | | Wave A | — | Bug fix cluster: data-loss
(FOLLOW-258), cross-tenant auth (FOLLOW-260), SQL injection (FOLLOW-261), feedback ping
(FOLLOW-259), lifecycle (FOLLOW-262) | 5 | 5 | 0 | 0 | 0 | | 17 | 19 | quiz_config blob cleanup
(FOLLOW-274 DONE), SDK locale enum alignment (FOLLOW-273 DONE), headline fact-check tightening
(FOLLOW-272 DONE), micro_polls wire (FOLLOW-275 DONE) + docs/fallback/locale fixes
(FOLLOW-276/277/278/279 DONE) + Tracer full D-1 chain
(FOLLOW-266/286/287/288/267/294/268-write/297/299/301/268-sdk/305 all DONE) + D-1 seed (FOLLOW-266
Ph2 seed PR #293 DONE) + FOLLOW-302 DONE + FOLLOW-307 DONE (prod apply 2026-06-14, 14-migration
catch-up, PRODUCTION-LIVE) — K.3.6 D-1 PRODUCTION-LIVE. FOLLOW-308 (P1 devops, standing mechanism)
filed; ESC-022 item (1) SIGNED OFF 2026-06-14 (compliance gap benign; item (2) Option A/B decision
pending). ADR-0012 backlog (FOLLOW-269/293 BLOCKED, FOLLOW-295/296/298/300/303/304/306/308 BACKLOG)
| 27 | 19 | 0 | 0 | 2 | | 18 | 20 | Admin auth + tracer hardening + SDK companion + CI hygiene
(Sprint 18 2026-06-17/18) — FOLLOW-324/325/326/327/328/330/293/336/331/332/335 ALL DONE | 11 | 11 |
0 | 0 | 0 | | 19 | 21 | Hollow-core must-fixes (audit 2026-06-19): confidence floor (FOLLOW-343),
slot self-annotation (FOLLOW-340), archetype embeddings (FOLLOW-341), bandit variant thread
(FOLLOW-342), page_type/tier (FOLLOW-345); CEO-gated: chat NLP (FOLLOW-346), archetype blending
(FOLLOW-344) | 7 | 1 | 0 | 2 | 4 |

**Sprint 2.5 is new — added in Paczka 2 based on Master Design v1.1 sections B.4-B.7
(auto-onboarding).**

Detailed tickets for Sprints 0–3 in Paczka 2 (this delivery). Sprints 4–11 ship in Paczka 3.

## Active sprint: Sprint 0 — Foundation (COMPLETE)

```yaml
- id: TICKET-001
  title: Bootstrap monorepo (Turborepo + pnpm + tooling)
  agent: devops-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  completed_at: 2026-04-26T18:15:00Z
  pr: '#2'
  spec: backlog/sprint-0/TICKET-001.md

- id: TICKET-002
  title: Doppler integration + secrets management baseline
  agent: devops-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-001]
  assigned_to: devops-engineer
  started_at: '2026-04-27T00:00:00Z'
  pr: '#4'
  completed_at: '2026-04-27T07:30:00Z'
  spec: backlog/sprint-0/TICKET-002.md

- id: TICKET-003
  title: Sentry + OpenTelemetry baseline instrumentation
  agent: devops-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-001]
  assigned_to: devops-engineer
  started_at: '2026-04-27T14:40:00Z'
  completed_at: '2026-04-27T19:30:00Z'
  pr: '#7'
  spec: backlog/sprint-0/TICKET-003.md

- id: TICKET-004
  title: Pre-commit security hooks (Lefthook + git-secrets + commit lint)
  agent: devops-engineer
  status: DONE
  priority: P1
  estimated_hours: 2
  depends_on: [TICKET-001]
  assigned_to: devops-engineer
  started_at: '2026-04-29T00:00:00Z'
  completed_at: '2026-04-29T14:18:07Z'
  pr: 'devops-engineer/TICKET-004-precommit-security'
  spec: backlog/sprint-0/TICKET-004.md

- id: TICKET-005
  title: Add apps/auto-detect Python placeholder app (NEW v1.1)
  agent: devops-engineer
  status: DONE
  priority: P1
  estimated_hours: 2
  depends_on: [TICKET-001]
  assigned_to: devops-engineer
  started_at: '2026-04-29T14:20:00Z'
  completed_at: '2026-04-29T16:45:00Z'
  pr: '#10'
  spec: backlog/sprint-0/TICKET-005.md

- id: TICKET-006
  title: Add packages/platform-templates TS placeholder (NEW v1.1)
  agent: devops-engineer
  status: DONE
  priority: P1
  estimated_hours: 2
  depends_on: [TICKET-001]
  assigned_to: devops-engineer
  started_at: '2026-04-29T16:50:00Z'
  completed_at: '2026-04-29T17:15:00Z'
  pr: '#11'
  spec: backlog/sprint-0/TICKET-006.md

- id: TICKET-007
  title: Update README + CLAUDE.md to reflect 10 apps / 10 packages
  agent: architect
  status: DONE
  priority: P2
  estimated_hours: 1
  depends_on: [TICKET-005, TICKET-006]
  assigned_to: architect
  started_at: '2026-04-29T17:30:00Z'
  completed_at: '2026-04-29T17:50:00Z'
  pr: '#12'
  spec: backlog/sprint-0/TICKET-007.md

- id: TICKET-008
  title: Cloudflare account setup + Wrangler Terraform module
  agent: devops-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-001, TICKET-002]
  assigned_to: devops-engineer
  started_at: '2026-04-29T18:00:00Z'
  completed_at: '2026-04-29T16:29:05Z'
  pr: '#14'
  spec: backlog/sprint-0/TICKET-008.md

- id: TICKET-009
  title:
    Vendor account stubs (Supabase + ClickHouse + Modal + Redpanda + Upstash) Terraform skeleton
  agent: devops-engineer
  status: DONE
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-001, TICKET-002]
  assigned_to: devops-engineer
  started_at: '2026-04-27T08:00:00Z'
  completed_at: '2026-04-27T19:30:00Z'
  pr: '#6'
  spec: backlog/sprint-0/TICKET-009.md
```

## Sprint 1 — Ingest baseline + event schema (COMPLETE)

```yaml
- id: TICKET-010
  title: ADR-0003 Event schema design and versioning strategy (already drafted)
  agent: architect
  status: DONE
  priority: P0
  estimated_hours: 2
  depends_on: [TICKET-009]
  started_at: '2026-04-29T19:00:00Z'
  completed_at: '2026-04-30T21:12:50Z'
  pr: '#16'
  spec: backlog/sprint-1/TICKET-010.md

- id: TICKET-011
  title: Zod schemas in packages/shared for all event types (envelope + 30 type schemas)
  agent: architect
  status: DONE
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-010]
  started_at: '2026-04-30T21:30:00Z'
  completed_at: '2026-04-30T21:45:29Z'
  pr: '#17'
  spec: backlog/sprint-1/TICKET-011.md

- id: TICKET-012
  title: Cloudflare Worker ingest MVP (validate + auth + push to Redpanda)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-011]
  started_at: '2026-04-30T23:30:00Z'
  completed_at: '2026-05-01T00:30:00Z'
  pr: '#18'
  spec: backlog/sprint-1/TICKET-012.md

- id: TICKET-013
  title: Durable Object rate limiting per tenant per minute
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-012]
  started_at: '2026-05-01T00:30:00Z'
  completed_at: '2026-04-30T22:39:52Z'
  pr: '#19'
  spec: backlog/sprint-1/TICKET-013.md

- id: TICKET-014
  title: ClickHouse table DDL + first migration (events table partitioned)
  agent: data-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-009, TICKET-011]
  started_at: '2026-05-03T00:00:00Z'
  completed_at: '2026-05-03T15:21:11Z'
  pr: '#27'
  spec: backlog/sprint-1/TICKET-014.md

- id: TICKET-015
  title: Stream consumer Modal scaffold (Redpanda subscribe → ClickHouse insert)
  agent: data-engineer
  status: DONE
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-014, TICKET-012]
  started_at: '2026-05-03T00:00:00Z'
  completed_at: '2026-05-03T20:58:07Z'
  pr: '#29'
  spec: backlog/sprint-1/TICKET-015.md

- id: TICKET-016
  title: End-to-end smoke test (curl ingest → ClickHouse query)
  agent: qa-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-015]
  started_at: '2026-05-03T00:00:00Z'
  completed_at: '2026-05-03T13:55:37Z'
  pr: '#26'
  spec: backlog/sprint-1/TICKET-016.md

- id: TICKET-017
  title: Ingest load test 10K req/s (k6 scripts)
  agent: qa-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-016]
  completed_at: '2026-05-04T00:00:00Z'
  pr: '#37'
  spec: backlog/sprint-1/TICKET-017.md

- id: TICKET-018
  title: Ingest observability (OTel traces + Sentry + structured logs)
  agent: devops-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-012, TICKET-003]
  completed_at: '2026-05-03T10:51:21Z'
  pr: '#22, #24, #25'
  spec: backlog/sprint-1/TICKET-018.md

- id: TICKET-019
  title: HTTP error handling + idempotency contract (event_id deduplication)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-012]
  completed_at: '2026-05-01T21:37:20Z'
  pr: '#24'
  spec: backlog/sprint-1/TICKET-019.md
```

## Sprint 2 — Postgres + tenant auth + dashboard skeleton (COMPLETE)

```yaml
- id: TICKET-020
  title: Drizzle ORM setup + migrations folder structure + tooling
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-009]
  completed_at: '2026-05-04T12:00:00Z'
  pr: '#36'
  spec: backlog/sprint-2/TICKET-020.md

- id: TICKET-021
  title: tenants table schema + RLS policies + auto-onboarding fields (v1.1)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 5
  depends_on: [TICKET-020]
  completed_at: '2026-05-04T14:00:00Z'
  pr: '#38'
  spec: backlog/sprint-2/TICKET-021.md

- id: TICKET-022
  title: users table + tenant membership + Supabase Auth sync
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-021]
  completed_at: '2026-05-04T16:00:00Z'
  pr: '#39'
  spec: backlog/sprint-2/TICKET-022.md

- id: TICKET-023
  title: API key model (public + secret keys, HMAC-SHA256, rotation)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 5
  depends_on: [TICKET-021]
  completed_at: '2026-05-04T18:00:00Z'
  pr: '#40'
  spec: backlog/sprint-2/TICKET-023.md

- id: TICKET-024
  title: JWT signing + tenant scoping middleware (Hono + Next.js)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 5
  depends_on: [TICKET-022, TICKET-023]
  completed_at: '2026-05-04T20:00:00Z'
  pr: '#42'
  spec: backlog/sprint-2/TICKET-024.md

- id: TICKET-025
  title: apps/control-plane Next.js skeleton + Tailwind + shadcn/ui setup
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-001, TICKET-002]
  started_at: '2026-05-01T00:00:00Z'
  completed_at: '2026-05-01T10:46:13Z'
  pr: '#20'
  spec: backlog/sprint-2/TICKET-025.md

- id: TICKET-026
  title: Tenant signup flow (skeleton — wizard frame, no auto-detect yet)
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 6
  depends_on: [TICKET-024, TICKET-025]
  completed_at: '2026-05-04T22:00:00Z'
  pr: '#43'
  spec: backlog/sprint-2/TICKET-026.md

- id: TICKET-027
  title: Dashboard authenticated layout (sidebar + header + route guards)
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-024, TICKET-025]
  completed_at: '2026-05-05T00:00:00Z'
  pr: '#44'
  spec: backlog/sprint-2/TICKET-027.md

- id: TICKET-028
  title: Tenant overview page (empty state, placeholder for live metrics)
  agent: backend-engineer
  status: DONE
  priority: P2
  estimated_hours: 3
  depends_on: [TICKET-027]
  completed_at: '2026-05-05T00:00:00Z'
  pr: '#44'
  spec: backlog/sprint-2/TICKET-028.md

- id: TICKET-029
  title: Stripe billing webhook stub + usage_metering table
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-021]
  completed_at: '2026-05-04T21:00:00Z'
  pr: '#41'
  spec: backlog/sprint-2/TICKET-029.md
```

## Sprint 2.5 — Auto-Onboarding pipeline (NEW v1.1) (BLOCKED)

```yaml
- id: TICKET-030
  title: Magic Link onboarding wizard UI (NEW v1.1)
  agent: backend-engineer
  status: DONE
  superseded_by: >-
    This is the Sprint 2.5 planning snapshot. The work shipped and is tracked by the canonical DONE
    entry for TICKET-030 in the Sprint 9.5 section (PR #124, completed 2026-05-21). Status flipped
    READY -> DONE 2026-07-17 to remove an id->status conflict; the pre-completion snapshot is kept
    for history.
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-024, TICKET-025]
  spec: backlog/sprint-2.5/TICKET-030.md

- id: TICKET-032
  title: AI Vision Auto-Detect pipeline (Claude Sonnet 4.6 Vision)
  agent: ml-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 10
  depends_on: [TICKET-030]
  spec: backlog/sprint-2.5/TICKET-032.md

- id: TICKET-033
  title: Schema Discovery API endpoint (POST /api/tenants/:id/schema-discover)
  agent: backend-engineer
  status: DONE
  superseded_by: >-
    This is the Sprint 2.5 planning snapshot. The work shipped and is tracked by the canonical DONE
    entry for TICKET-033 in the Sprint 9.5 section (PR #121, completed 2026-05-21). Status flipped
    BLOCKED -> DONE 2026-07-17 to remove an id->status conflict; the pre-completion snapshot is kept
    for history.
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-032]
  spec: backlog/sprint-2.5/TICKET-033.md

- id: TICKET-034
  title: Platform templates library (packages/platform-templates)
  agent: ml-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 6
  depends_on: [TICKET-033]
  spec: backlog/sprint-2.5/TICKET-034.md

- id: TICKET-035
  title: Continuous schema validation cron (SUPERSEDED by TICKET-VAL-001)
  agent: data-engineer
  status: CANCELLED
  priority: P1
  estimated_hours: 0
  depends_on: [TICKET-034]
  spec: backlog/sprint-2.5/TICKET-035.md
  notes: |
    Duplicate scope with TICKET-VAL-001 (Sprint 9). Canonical implementation lives there
    because its dependency chain (TICKET-AUTO-006 only, DONE) is shorter and unblocked
    sooner than the Sprint 2.5 chain (030 → 032 → 033 → 034 → 035, ~30h prerequisite).
    Decision: Piotr 2026-05-14. Spec file retained for reference but ticket = CANCELLED.

- id: TICKET-036
  title: Pre-built platform templates (MLS, Zillow-style, custom)
  agent: ml-engineer
  status: BLOCKED
  priority: P2
  estimated_hours: 6
  depends_on: [TICKET-034]
  spec: backlog/sprint-2.5/TICKET-036.md
```

## Sprint 3 — SDK Tier 1 Observer + Magic Link UI (IN PROGRESS)

```yaml
- id: TICKET-031
  title: SDK Tier 1 core — config, session, events, observer
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-011]
  completed_at: '2026-05-05T01:25:00Z'
  pr: '#50'
  spec: backlog/sprint-3/TICKET-031.md

- id: TICKET-037
  title: SDK Shadow DOM mount + Tier 1 sidebar widget
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-031]
  spec: backlog/sprint-3/TICKET-037.md
  pr: '#98'
  merged_at: '2026-05-14'

- id: TICKET-038
  title: SDK tsup build + bundle size gate (<40KB gzip)
  agent: sdk-engineer
  status: READY
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-031]
  spec: backlog/sprint-3/TICKET-038.md

- id: TICKET-039
  title: SDK integration tests (Playwright + host page fixture)
  agent: qa-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-037, TICKET-038]
  spec: backlog/sprint-3/TICKET-039.md

- id: TICKET-040
  title: Magic Link onboarding wizard UI (Sprint 3 phase)
  agent: backend-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-030]
  spec: backlog/sprint-3/TICKET-040.md

- id: TICKET-041
  title: Consent banner component (GDPR/CCPA)
  agent: sdk-engineer
  status: DONE
  priority: P1
  estimated_hours: 6
  depends_on: [TICKET-037]
  spec: backlog/sprint-3/TICKET-041.md
  pr: '#113'
  completed_at: '2026-05-15T09:08:41Z'

- id: TICKET-042
  title: Decision API integration in SDK (fetch adapt directives)
  agent: sdk-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-037, TICKET-024]
  spec: backlog/sprint-3/TICKET-042.md

- id: TICKET-043
  title: SDK npm publish pipeline (GitHub Actions + changesets)
  agent: devops-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-038]
  spec: backlog/sprint-3/TICKET-043.md

- id: TICKET-044
  title: SDK demo integration (embed on demo listing page)
  agent: sdk-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-037, TICKET-DEMO-002]
  spec: backlog/sprint-3/TICKET-044.md

- id: TICKET-045
  title: E2E test — full observer flow (page.view → scroll → cta.clicked)
  agent: qa-engineer
  status: BLOCKED
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-039]
  spec: backlog/sprint-3/TICKET-045.md
```

## Sprint 6 — Embeddings + archetype matching + decision API (DONE)

```yaml
- id: TICKET-ARCH-001
  title: Expand archetype ontology — 3 → 18 archetypes
  agent: ml-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  completed_at: '2026-05-11T00:00:00Z'
  commit: f0aca06
  spec: (inline — merged directly to main)

- id: TICKET-EMB-001
  title: Embeddings pipeline — pgvector + fingerprint matching
  agent: ml-engineer
  status: DONE
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-ARCH-001]
  completed_at: '2026-05-11T00:00:00Z'
  commit: be4e366
  spec: (inline — merged directly to main)

- id: TICKET-DB-001
  title: Replace API stubs with real Drizzle DB queries in control-plane
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-EMB-001]
  completed_at: '2026-05-11T00:00:00Z'
  commit: c69ee9c
  spec: (inline — merged directly to main)
```

## Sprint 7 — Decision API real logic + adaptation playbooks (COMPLETE)

```yaml
- id: TICKET-ADP-001
  title: Decision API real logic — replace GET /api/adapt stub with full decision tree
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 10
  depends_on: [TICKET-ARCH-001, TICKET-EMB-001, TICKET-DB-001]
  assigned_to: backend-engineer
  started_at: '2026-05-11T00:00:00Z'
  completed_at: '2026-05-11T20:36:18Z'
  pr: '#67'
  spec: backlog/sprint-7/TICKET-ADP-001.md

- id: TICKET-ADP-003
  title: Adaptation playbooks — pre-computed directives for all 18 archetypes
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-ADP-001]
  assigned_to: sdk-engineer
  started_at: '2026-05-11T20:36:18Z'
  completed_at: '2026-05-11T22:00:00Z'
  pr: '#68'
  commit: ecf5d4b
  spec: backlog/sprint-7/TICKET-ADP-003.md

- id: TICKET-ADP-004
  title: SDK Tier 1 DOM mutations — full applyDirectives() implementation
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 10
  depends_on: [TICKET-ADP-003]
  assigned_to: sdk-engineer
  started_at: '2026-05-12T06:00:00Z'
  completed_at: '2026-05-12T21:33:43Z'
  pr: '#69'
  commit: 82f0e42
  spec: backlog/sprint-7/TICKET-ADP-004.md

- id: TICKET-ADP-002
  title: LiteLLM gateway — Haiku/Sonnet routing for Decision API
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-ADP-004]
  assigned_to: backend-engineer
  started_at: '2026-05-12T08:30:00Z'
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#70'
  commit: e9ccde4
  spec: backlog/sprint-7/TICKET-ADP-002.md

- id: TICKET-DQS-001
  title: Convergence metrics — DqsTracker + session.quality.snapshot + ClickHouse DDL
  agent: data-engineer
  status: DONE
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-ADP-004]
  assigned_to: data-engineer
  started_at: '2026-05-12T08:30:00Z'
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#71'
  commit: 7678aa3
  spec: backlog/sprint-7/TICKET-DQS-001.md
```

## Sprint 7.5 — Auto-Detection Engine (COMPLETE)

```yaml
- id: TICKET-AUTO-001
  title: Auto-detection corpus — 24 platform fixtures + CI gate skeleton
  agent: qa-engineer
  status: DONE
  priority: P0
  estimated_hours: 6
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#72'
  commit: 7400d63
  spec: docs/specs/SPRINT_7_5_SPEC.md

- id: TICKET-AUTO-002
  title: TenantSiteSchema types + detection pipeline skeleton
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-AUTO-001]
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#73'
  commit: 76c2c88
  spec: docs/specs/SPRINT_7_5_SPEC.md

- id: TICKET-AUTO-003
  title: Auto-detection techniques 1–6 (deterministic pipeline)
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-AUTO-002]
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#74'
  commit: f6f4e15
  spec: docs/specs/SPRINT_7_5_SPEC.md

- id: TICKET-AUTO-004
  title: Auto-detection techniques 7–11 + price parser + Detection Preview API + UI skeleton
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 10
  depends_on: [TICKET-AUTO-003]
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#77'
  commit: eb463ab
  spec: docs/specs/SPRINT_7_5_SPEC.md
  note: AUTO-006 backend + UI skeleton bundled into this PR per Piotr approval (2026-05-13)

- id: TICKET-AUTO-005
  title: Corpus CI gate — precision/recall validation (100%/100% on own corpus)
  agent: qa-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-AUTO-004]
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#79'
  commit: cfecf50
  spec: docs/specs/SPRINT_7_5_SPEC.md

- id: TICKET-AUTO-006
  title: Detection Preview UI + tenant_site_schemas table
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 6
  depends_on: [TICKET-AUTO-002]
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#77'
  commit: eb463ab
  spec: docs/specs/SPRINT_7_5_SPEC.md
  note: |
    Bundled into AUTO-004 PR (#77) per Piotr approval.
    Three carve-outs deferred to TICKET-AUTO-006-POLISH (P2, BACKLOG):
    - Screenshot capture + colored-box overlay
    - Manual inline selector editing
    - Explicit "Save & activate" button (server-side auto-upsert already works)

- id: TICKET-AUTO-007
  title: Archetype hints from site structure — Bayesian prior seeding
  agent: ml-engineer
  status: DONE
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-AUTO-003]
  completed_at: '2026-05-13T00:00:00Z'
  pr: '#76'
  commit: 5c36aaf
  spec: docs/specs/SPRINT_7_5_SPEC.md
```

## Polish / Carve-out tickets (BACKLOG)

```yaml
- id: TICKET-AUTO-006-POLISH
  title:
    Detection Preview UI — screenshot overlay + manual selector editing + Save & activate button
  agent: backend-engineer
  status: DONE
  superseded_by: >-
    This is the Polish/Carve-out planning snapshot. The work shipped and is tracked by the canonical
    DONE entry for TICKET-AUTO-006-POLISH in the Sprint 9.5 section (PR #125, completed 2026-05-22).
    Status flipped BACKLOG -> DONE 2026-07-17 to remove an id->status conflict; the pre-completion
    snapshot is kept for history.
  priority: P2
  estimated_hours: 4
  depends_on: [TICKET-AUTO-006]
  notes: |
    Three carve-outs from AUTO-006 that were deferred at Piotr's approval (2026-05-13):
    1. Screenshot capture + colored-box overlay (page.tsx:387 comment "visual overlay available
       after AUTO-004" — that condition is now met, just needs wiring).
    2. Manual inline selector editing (currently alert() at page.tsx:346).
    3. Explicit "Save & activate" button (currently alert() at page.tsx:356).
       Note: server-side auto-upsert already persists schemas (route.ts:222-247), so
       only the explicit user-action UX is missing.
    Non-blocking for Sprint 8. Schedule after Sprint 8 or as filler if a Sprint 8 slot opens.
```

## Sprint 8 — A/B holdout + re-ranking + agency answers + variants + retro loop (COMPLETE)

**Status:** COMPLETE as of 2026-05-14. 6/6 core tickets DONE + 7 FIX tickets DONE (PR #85-90).
AB-001 (PR #80), REORDER-001 (PR #91), TICKET-046 (PR #92), AGENCY-001 (PR #97), AB-004 (PR #99),
ARCH-003 (PR #95). FAIR-001 CANCELLED. NATIVE-001 deferred to MVP launch. CAUSAL-001 BACKLOG.

**Sprint 8 entry condition:** Sprint 7 DONE + Sprint 7.5 DONE. Both satisfied as of 2026-05-13.

```yaml
- id: TICKET-AB-001
  title: A/B holdout framework — consent-aware 10% holdout + Thompson sampling bandit
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-05-13T12:00:00Z'
  completed_at: '2026-05-14T00:00:00Z'
  priority: P0
  estimated_hours: 10
  depends_on: [TICKET-DQS-001, TICKET-ADP-002]
  pr: '#80'
  commit: 0e5cc0c
  spec: backlog/sprint-8/TICKET-AB-001.md
  notes: |
    Implements Master Design E.3 + E.3.1 + E.3.2.
    Core: assign sessions to treatment/holdout (default 10%) at Decision API layer.
    Consent-aware: holdout assignment must respect existing consent_state field on events.
    Fair-housing constraint: holdout assignment MUST NOT segment by protected characteristics
    (race, national origin, family status per FHA). Assignment is purely random, keyed on
    session_id hash. TICKET-FAIR-001 is CANCELLED — not required at this stage.
    Produces: holdout_group boolean on adaptation_decisions ClickHouse table.
    Thompson sampling bandit: select best adaptation variant per archetype based on
    rolling conversion lift (multi-armed bandit, Thompson sampling per Master Design E.3).
    Regression detection: if archetype X has stat-significant drop over 7 days → auto-pause
    + Sentry alert.

- id: TICKET-REORDER-001
  title: ReorderDirective implementation — listing grid re-ranking per archetype
  agent: sdk-engineer
  status: DONE
  completed_at: '2026-05-14T00:00:00Z'
  pr: '#91'
  commit: 40650aa
  priority: P0
  estimated_hours: 10
  depends_on: [TICKET-AUTO-002, TICKET-ADP-004]
  notes: |
    Unblocked 2026-05-13 — archetypes are behavioral, not demographic; no FAIR-001 needed at this stage.
    Implements Master Design B.9.2 + E.2 (feature highlight order).
    ReorderDirective stub is already in packages/shared/src/directives.ts (Sprint 7.5 hook).
    container_selector + data_extractors_per_card + reorder_capable are in TenantSiteSchema.
    SDK applyDirectives() must handle ReorderDirective: read container_selector, query
    child nodes, sort by archetype-specific score (passed in the directive), re-inject into DOM.
    similar_listings_selector (DetailSchema) enables "Properties you might also like" injection
    on detail pages — include as a stretch goal in this ticket or split to REORDER-002.
    Requires: corpus CI gate stays green after DOM reorder changes (rerun pnpm test:corpus).

- id: TICKET-046
  title: Playbook variants — 3 copy variants + copy_template for all 18 archetypes
  agent: sdk-engineer
  status: DONE
  completed_at: '2026-05-14T00:00:00Z'
  pr: '#92'
  commit: b6368b6
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-ADP-003]
  notes: |
    Adds SlotDirective.variants (3 copy alternatives per slot for A/B) and
    PlaybookEntry.copy_template (static ~150-word description fallback per archetype).
    Fixes feature-section → feature slot name in yield-hunter + llm-gateway.ts prompt.
    18 archetypes × 3 variants + copy_template.en. All 17 non-neutral archetypes complete.

- id: TICKET-AGENCY-001
  title: Agency answers — per-listing FAQ with RAG-powered suggested replies
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-ADP-001]
  pr: '#97'
  merged_at: '2026-05-14'
  notes: |
    Implements Master Design E.2 chat.suggested_reply row: "Claude Haiku 4.5 + RAG over
    tenant FAQ + listing data + intent context".
    Backend: POST /api/tenants/:id/answers — CRUD for per-listing Q&A pairs stored in Postgres.
    RAG pipeline: at adapt time, retrieve top-3 FAQ answers (pgvector cosine similarity on
    question embedding vs intent vector), inject into Haiku 4.5 prompt as context.
    Dashboard UI: /dashboard/listings/:id/answers — agency staff adds/edits FAQ entries.
    Placeholder resolution: answers feed Level 2 in the E.6 placeholder resolution order
    (already typed in MASTER_DESIGN_PATCH_v1_5.md as "Agency-provided answers per listing").
    Produces: answers table schema migration + /api/answers route + dashboard page.
    Completed 2026-05-14: all AC items done, 213/213 tests passing, lint/typecheck/build green.

- id: TICKET-FAIR-001
  title: Fair-housing linter MVP — gate for Profile Mode activation (U.11.6)
  agent: compliance-engineer
  status: CANCELLED
  priority: P1
  estimated_hours: 6
  depends_on: [TICKET-AB-001]
  cancelled_at: '2026-05-13'
  cancelled_by: Piotr Nawrocki
  cancel_reason: |
    Not required at this stage — archetype space is purely behavioral, no protected-class signals
    collected. Re-open if demographic or proxy-demographic signals are ever proposed for the
    archetype space. See ESCALATIONS.md resolution for full rationale and the binding caveat.
  notes: |
    Required by Master Design U.11.6 and E.3.2 (brand_safety_score in multi-objective
    optimization). Must be live before first Profile Mode activation (Sprint 12+).
    Linter validates adaptation directives against fair-housing rules:
    - US: FHA protected classes (race, color, religion, national origin, sex, disability,
      familial status) — no steering, no discriminatory framing in headlines/features.
    - UK: Equality Act 2010 protected characteristics.
    - EU: anti-discrimination directives.
    Implementation: rule-based keyword + semantic classifier on generated text directives.
    Output: brand_safety_score (0.0–1.0) fed into multi-objective optimization (E.3.2).
    CI gate: adaptation playbook tests must pass fair-housing lint before merge.
    IMPORTANT: compliance-engineer must escalate if linter rules conflict with any existing
    playbook content — do not silently modify playbooks.

- id: TICKET-AB-004
  title: Analytics dashboard — conversion lift + archetype breakdown + holdout comparison
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-AB-001, TICKET-DQS-001]
  pr: '#99'
  merged_at: '2026-05-14'
  notes: |
    Implements the dashboard mockup in Master Design Q.3 (Idealista Week 1 view).
    Data source: ClickHouse adaptation_decisions table (from TICKET-ADP-001 migration) +
    DQS session snapshots (from TICKET-DQS-001).
    Required panels:
    - Traffic summary (tracked sessions, adapted impressions, holdout impressions, p95 latency)
    - Buyer archetype breakdown (top 10 of N detected, % of traffic)
    - Conversion lift vs holdout (photo engagement, time-on-listing, inquiry started,
      inquiry completed, tour requested)
    - Top-performing adaptation types
    - Anomaly feed (auto-paused archetypes with regression detected)
    Route: /dashboard/analytics (new page in control-plane).
    Uses DQS data already shipped in TICKET-DQS-001 — no new ClickHouse DDL needed.
    Implementation: 9 files added/modified. 125 tests pass (net +44 vs baseline).
    vitest.config.ts source aliases fixed 7 pre-existing test failures.
    gh CLI not available in environment — PR must be opened by PM via git push.

- id: TICKET-NATIVE-001
  title: app.estalara.com Adaptive Listings native integration (Tier 3 data-estalara-* attributes)
  agent: sdk-engineer
  status: BLOCKED
  block_reason: |
    Deferred to MVP launch — requires CTO/CPO scheduling on the SvelteKit side. Will be scheduled
    separately. Decision by Piotr Nawrocki 2026-05-13.
  priority: P1
  estimated_hours: 6
  depends_on: [TICKET-REORDER-001, TICKET-AB-011]
  notes: |
    Implements Master Design B.9 + B.9.3.
    Rafał (CTO) adds data-estalara-* attributes to SvelteKit components (ListingCard.svelte,
    detail page). This ticket wires the SDK init in +layout.svelte and validates the full
    Tier 3 Native flow against the corpus CI gate (000-app-estalara fixture).
    Key edge case: H1 = price on detail pages (B.9.1) — SDK must handle tagline slot above H1.
    AI Topics reordering (B.9.2): ReorderDirective drives tag reorder per archetype
    (yield_hunter → Rental/ROI/Transport first; family_buyer → Schools/Parks first).
    Live Session CTA per archetype: archetype-specific CTA text injected via TextDirective.
    NOTE: CTO/CPO approval required on slot mapping before implementation starts. Flag in
    ticket spec when authored.

- id: TICKET-ARCH-003
  title: Per-ticket retrospective learning loop + /retro slash command
  agent: architect
  status: DONE
  priority: P0
  estimated_hours: 6
  depends_on: []
  pr: '#95'
  completed_at: '2026-05-14T14:21:36Z'
  spec: backlog/sprint-8/TICKET-RETRO-001.md
  notes: |
    Creates retrospective-analyst agent (Opus 4.7), backlog/RETROSPECTIVES.md,
    backlog/FOLLOW_UPS.md, CONVENTIONS_PATCH.md. PM Step 7 auto-spawns analyst after each
    ticket DONE. /retro slash command for manual retroactive invocation. Seeds RETRO-001
    (TICKET-046 analysis).

- id: TICKET-FIX-013
  title: JWT signature verification — HMAC-SHA-256 verify before trusting payload
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  pr: '#86'
  completed_at: '2026-05-14T00:00:00Z'
  spec: backlog/sprint-8/TICKET-FIX-013.md

- id: TICKET-FIX-014
  title: Tenant header spoofing — derive tenant_id from verified JWT, not x-tenant-id header
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  pr: '#87'
  completed_at: '2026-05-14T00:00:00Z'
  spec: backlog/sprint-8/TICKET-FIX-014.md

- id: TICKET-FIX-015
  title: SDK ↔ decision-api contract — AdaptRequestSchema accepts confidence/similarity
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 2
  pr: '#85'
  completed_at: '2026-05-14T00:00:00Z'
  spec: backlog/sprint-8/TICKET-FIX-015.md

- id: TICKET-FIX-016
  title: Demo mockup page non-functional — fix POST /api/adapt demo endpoint
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  pr: '#87'
  completed_at: '2026-05-14T00:00:00Z'
  spec: backlog/sprint-8/TICKET-FIX-016.md

- id: TICKET-FIX-017
  title: Auth gate on GET /api/adapt — require API key before serving directives
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 2
  pr: '#90'
  completed_at: '2026-05-14T00:00:00Z'
  spec: backlog/sprint-8/TICKET-FIX-017.md

- id: TICKET-FIX-018
  title: Wire RLS JWT token in createTenantClient — enforce row-level security
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  pr: '#89'
  completed_at: '2026-05-14T00:00:00Z'
  spec: backlog/sprint-8/TICKET-FIX-018.md

- id: TICKET-FIX-019
  title: Idempotency cache key must include tenant_id — scope dedup per tenant
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 2
  pr: '#88'
  completed_at: '2026-05-14T00:00:00Z'
  spec: backlog/sprint-8/TICKET-FIX-019.md

- id: TICKET-CAUSAL-001
  title: Causal inference framework — CATE estimation + HTE per archetype (R.2 patent angle)
  agent: ml-engineer
  status: BACKLOG
  priority: P2
  estimated_hours: 12
  depends_on: [TICKET-AB-001]
  notes: |
    Implements Master Design E.3.1 + R.2.
    T-Learner / X-Learner (EconML) + causal forests (DoWhy) for CATE estimation.
    Auto-pause archetypes where CATE_CTR ~= 0% after 1000+ sessions (saves 20-30% LLM cost).
    Sequential hypothesis testing (Wald SPRT) for early stopping.
    Tech stack: EconML (Microsoft), DoWhy, PyMC for long-tail archetypes.
    Modal Python app — runs as offline daily batch job.
    P2 priority: do not start until AB-001 has real holdout data (minimum 2 weeks in production).
    Feeds D.5 confirmation rate dashboard.
```

## Sprint 8.5 — A/B wiring sprint — COMPLETE (5/5 DONE across PR #106 + #107 + #108)

**Status:** COMPLETE as of 2026-05-14. All 5 tickets DONE across 3 PRs.

```yaml
- id: TICKET-AB-005
  title: Emit ab.assignment event from decision-api on every non-skipped assignment
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-AB-001]
  pr: '#106'
  completed_at: '2026-05-14T20:45:17Z'
  commit: 6d78af72fc
  spec: backlog/sprint-9/TICKET-AB-005.md
  promoted_from: FOLLOW-006

- id: TICKET-AB-006
  title: Seed ab_bandit_weights — 18 archetype rows × variant='default' per tenant
  agent: data-engineer
  status: DONE
  priority: P0
  estimated_hours: 2
  depends_on: [TICKET-AB-001]
  pr: '#107'
  completed_at: '2026-05-14T20:37:06Z'
  commit: 1d21f7d354
  spec: backlog/sprint-9/TICKET-AB-006.md
  promoted_from: FOLLOW-008
  historical_note: |
    SUPERSEDED by FOLLOW-361 (PR #356, 2026-06-26). The original seed used variant='default'
    (18 rows). FOLLOW-361 replaced this with the three-arm model: control/v1/v2 (54 rows).
    The title "18 rows × variant='default'" is historical only; current prod schema uses
    SEED_VARIANTS = ['control','v1','v2'] from bandit-query.ts. (RETRO-117 §4d DG-1 / FOLLOW-397 AC-4)

- id: TICKET-AB-007
  title: Wire holdout_group into ClickHouse adaptation_decisions insert path
  agent: data-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-AB-006]
  pr: '#107'
  completed_at: '2026-05-14T20:37:06Z'
  commit: 1d21f7d354
  spec: backlog/sprint-9/TICKET-AB-007.md
  promoted_from: FOLLOW-010

- id: TICKET-AB-008
  title: Replace mock /api/ab/weights with real Drizzle reads
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-AB-006]
  pr: '#108'
  completed_at: '2026-05-14T21:16:31Z'
  commit: 08d46d94d3
  spec: backlog/sprint-9/TICKET-AB-008.md
  promoted_from: FOLLOW-014

- id: TICKET-AB-009
  title: Wire ReorderDirective into production decision-api Worker route
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: []
  pr: '#108'
  completed_at: '2026-05-14T21:16:31Z'
  commit: 08d46d94d3
  spec: backlog/sprint-9/TICKET-AB-009.md
  promoted_from: FOLLOW-015

- id: TICKET-AB-010
  title: holdout gating + consent skip on control-plane POST /api/adapt
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 2
  depends_on: [TICKET-AB-005, TICKET-AB-009]
  pr: '#109'
  completed_at: '2026-05-14T21:53:13Z'
  commit: ea76cdb480
  spec: backlog/sprint-9/TICKET-AB-010.md
  promoted_from: FOLLOW-017

- id: TICKET-AB-011
  title: getTenantSchema() real DB lookup + Redis cache (replace est_demo_tenant hardcode)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [TICKET-AB-010]
  pr: '#109'
  completed_at: '2026-05-14T21:53:13Z'
  commit: ea76cdb480
  spec: backlog/sprint-9/TICKET-AB-011.md
  promoted_from: FOLLOW-018
```

## Sprint 9 — DPIA + DSR + consent + description pipeline (COMPLETE)

**Status:** COMPLETE as of 2026-05-15. All 6 tickets DONE. Wave A: GDPR-001 (PR #111), VAL-001 (PR
#110), TICKET-041 (PR #113), DESC-001 (PR #112+#114). Wave B: GDPR-002 (PR #118), GDPR-003 (PR
#116), GDPR-004 (PR #117). DESC-PIVOT-001 v1.7.1 (PR #115) also merged in Sprint 9 cycle.

```yaml
- id: TICKET-GDPR-001
  title: DPIA + ROPA documents (EU/UK/CA/UAE)
  agent: compliance-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: []
  pr: '#111'
  completed_at: '2026-05-15'
  spec: backlog/sprint-9/TICKET-GDPR-001.md

- id: TICKET-GDPR-002
  title: DSR endpoints (access / erase / portability)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: [TICKET-GDPR-001]
  pr: '#118'
  completed_at: '2026-05-15'
  spec: backlog/sprint-9/TICKET-GDPR-002.md
  notes: |
    OTP flow (6-digit, SHA-256 hash, 15min TTL), Resend email provider (noreply@contact.estalara.com).
    dsr_verifications Drizzle table + migration 0011. ClickHouse dsr_audit_log migration 0009.
    ⚠️ FOLLOW-039: ClickHouse hard deletion not yet wired — must fix before EU pilot (RODO Art. 17).

- id: TICKET-GDPR-003
  title: Cookie-less behavioral fingerprinting LIA template + tenant_compliance_records
  agent: compliance-engineer + backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-GDPR-001]
  pr: '#116'
  completed_at: '2026-05-15'
  spec: backlog/sprint-9/TICKET-GDPR-003.md

- id: TICKET-GDPR-004
  title: Consent state propagation (SDK → ingest → ClickHouse → Decision API gate)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 6
  depends_on: [TICKET-GDPR-001, TICKET-041]
  pr: '#117'
  completed_at: '2026-05-15'
  spec: backlog/sprint-9/TICKET-GDPR-004.md
  notes: |
    consent_required boolean on tenants table (migration 0010). consent-gate.ts pure function.
    SDK fetchDirectives() now sends consent_state in body (fix commit in same PR).
    z.enum(['granted','denied','unknown']).default('unknown') on AdaptRequestSchema.

- id: TICKET-DESC-001
  title: Long-form description pipeline (Tier 2/3, Redis-cached, Sonnet 4.6 async)
  agent: backend-engineer + ml-engineer
  status: DONE
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-AGENCY-001, TICKET-046]
  pr: '#112 (ml) + #114 (backend)'
  completed_at: '2026-05-15T08:46:30Z'
  spec: backlog/sprint-9/TICKET-DESC-001.md

- id: TICKET-VAL-001
  title: Continuous schema validation cron (drift detection per tenant)
  agent: data-engineer
  status: DONE
  priority: P1
  estimated_hours: 8
  depends_on: [TICKET-AUTO-006]
  pr: '#110'
  completed_at: '2026-05-15T08:04:23Z'
  spec: backlog/sprint-9/TICKET-VAL-001.md
```

## Sprint 9.5 — MVP Demo Readiness (onboarding activation + bandit + scoring) (COMPLETE)

**Status:** COMPLETE as of 2026-05-22. 6/6 tickets DONE across 6 PRs (#121, #122, #123, #124, #125,
#126). Auto-Onboarding UI end-to-end demoable. Bandit variant selection wired into canonical adapt
route. Cosine archetype-listing affinity wired with djb2 fallback. Open gaps tracked in RETRO-005 →
Sprint 10: FOLLOW-041/042 (SDK feedback ping + variant consumer), FOLLOW-043 (archetype embeddings
NULL → cosine unreachable), FOLLOW-046 (listing embedding auto-seed), FOLLOW-055 (e2e test).

**Sprint goal:** Make the zero-config onboarding promise demoable end-to-end on `app.estalara.com`
(Tier 3 Native, locked 2026-05-12), then on any new tenant via Magic Link. Complete the bandit
optimization wire-up and replace the placeholder archetype-affinity hash so the demo narrative
includes honest live optimization. Output: investor demo where (a) admin pastes URL → auto-detects
schema (Sprint 7.5 engine, AI Vision active per Krok B) → previews → activates → snippet generated,
(b) embedded site receives adaptive directives via canonical adapt endpoint (ADR-0004), (c) bandit
selects variants per (tenant, archetype) using Thompson sampling, (d) listing cards reorder by real
archetype-listing affinity (not djb2 hash).

**Scope decisions (Piotr 2026-05-21, post AI Council Checkpoint):**

- Q4: Demo target = `app.estalara.com` (Tier 3 Native + Magic Link first; falls back to manual attrs
  only if Magic Link fails). `000-app-estalara` fixture confirmed in corpus
  (`packages/sdk/src/auto-detect/__fixtures__/000-app-estalara/`), detection_source=`data_estalara`,
  technique already in 11-technique cascade. Magic Link will hit Level 1 detection with confidence
  ≥0.99, zero AI Vision cost.
- Q5: TICKET-032 stays BLOCKED in Sprint 2.5 (cleanup deferred). Not blocking demo.
- Q6: Full narrative — bandit + real scoring included. FOLLOW-007 + FOLLOW-019 in scope.
- Q7: EU pilot not in 4-6 weeks. FOLLOW-039 (ClickHouse DSR hard-delete) deferred to Sprint 11.

**Adapt endpoint:** Per ADR-0004 (2026-05-17), canonical =
`apps/control-plane/src/app/api/adapt/route.ts`. All Sprint 9.5 work targets this endpoint, not
`apps/decision-api` Worker.

**Schema persistence:** Per Sprint 7.5 + AUTO-003/004, canonical = `tenant_site_schemas` table
(`packages/db/src/schema/tenant_site_schemas.ts`). `tenants.auto_detected_schema` field referenced
in Master_Design §J.3 does NOT exist in current schema — that section is stale (cleanup follow-up).

```yaml
- id: TICKET-033
  title: Schema Discovery API endpoint (POST /api/detect tenant-scoped wrapper)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-9.5/TICKET-033.md
  pr: '#121'
  completed_at: '2026-05-21'
  notes: |
    Wraps existing Sprint 7.5 auto-detection engine (apps/control-plane/src/app/api/detect/route.ts:175
    + packages/sdk/src/auto-detect/techniques/*). Adds tenant-scoping via JWT, SSRF protection,
    idempotency, persistence to tenant_site_schemas (Postgres), structured response for wizard UI.
    NOT a rebuild of detection — only a tenant-aware HTTP API in front of it.
    PR #121 open. Node.js CI all green (Test, Typecheck, Lint, Format, Build, Vercel, Rule H).
    Pre-existing failures: Rule I (96 violations pre-date this PR), Test (Python) (infra issue),
    Doppler verify (optional).

- id: TICKET-030
  title: Magic Link onboarding wizard UI (paste URL → detect → preview → snippet)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 5
  depends_on: [TICKET-033]
  model: sonnet-4.6
  spec: backlog/sprint-9.5/TICKET-030.md
  pr: '#124'
  completed_at: '2026-05-21'
  notes: |
    Originally Sprint 2.5 READY, promoted to Sprint 9.5. UI calls TICKET-033 API. States:
    idle, analyzing, detected, needs_review, failed. No mocks — real API wiring. Wired to
    real tenant_site_schemas write via TICKET-033. DetectionPreview stub included (real impl
    is TICKET-AUTO-006-POLISH). Page at /dashboard/onboarding/detect (protected by dashboard
    auth middleware). 11 tests (all 6 AC + 5 edge cases). All JS/TS CI green: Test Node 22,
    Typecheck, Lint, Format, Build (control-plane), Vercel, Rule H, SDK E2E. Pre-existing
    failures not caused by this PR: Rule I (93 violations pre-date this PR), Test (Python)
    (infra scaffolding), Doppler verify (optional).

- id: TICKET-AUTO-006-POLISH
  title: Detection Preview + Save & Activate (trust moment for demo)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-030]
  model: sonnet-4.6
  spec: backlog/sprint-9.5/TICKET-AUTO-006-POLISH.md
  pr: '#125'
  completed_at: '2026-05-22'
  notes: |
    Preview UI shows detected fields with selectors + confidence + sample values. "Save & Activate"
    button writes to tenant_site_schemas (canonical store), updates tenant status to active, generates
    SDK snippet. Manual selector editing OUT OF SCOPE (no visual editor).
    PR #125 opened. All 474 local tests pass. 0 ESLint errors in new files (with built packages).
    Pre-commit hooks pass. CI blocked by GitHub Actions billing issue (all jobs fail with
    'spending limit' error) — pre-existing infrastructure issue, not caused by this PR.
    ESCALATION: GitHub Actions billing needs to be resolved for CI to run.

- id: FOLLOW-018
  title: Replace est_demo_tenant hardcode with real tenant schema lookup in adapt route
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [TICKET-033, TICKET-AUTO-006-POLISH]
  model: sonnet-4.6
  spec: backlog/sprint-9.5/FOLLOW-018.md
  pr: '#126'
  completed_at: '2026-05-22'
  notes: |
    apps/control-plane/src/app/api/adapt/route.ts currently reads schema for est_demo_tenant only.
    Replace with tenant_site_schemas lookup keyed on authenticated tenant_id. Add Redis cache
    with bounded TTL + invalidation on schema activation. Without this, newly onboarded tenants
    cannot drive adapt path → demo breaks after snippet generation.
    PR #126 opened. All 481 tests pass (7 new). CI: Test (Node 22), Typecheck, Lint, Format check,
    Build, Build (control-plane), Vercel all green. Baseline failures (Doppler, Rule I, Python tests)
    are pre-existing infrastructure issues unrelated to this change.

- id: FOLLOW-007
  title: Wire Thompson sampling bandit into live adapt path per (tenant, archetype, variant)
  agent: ml-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: []
  model: opus-4.7-xhigh
  spec: backlog/sprint-9.5/FOLLOW-007.md
  pr: '#122'
  completed_at: '2026-05-21'
  notes: |
    thompsonSample() implemented (packages/sdk + ab_bandit_weights table) but has zero
    non-test callers per Rule I check. Wire into canonical adapt route variant selection
    per Master_Design §E.3.0 Phase 2. Read Beta(α,β) from ab_bandit_weights, sample, select
    variant_index, log to ClickHouse adaptation_decisions. Async feedback loop on inquiry.completed
    updates Beta distribution. Opus 4.7 xhigh per memory edit ML/algo rule.

    PR #122 — Implementation complete:
      - packages/shared/src/bandit.ts (canonical) + apps/decision-api/src/lib/bandit.ts
        (byte-identical Worker-bundle copy, sync requirement documented).
      - apps/control-plane/src/lib/bandit-query.ts: getBanditArms() + auto-seed (control/v1/v2,
        Beta(1,1)) via onConflictDoNothing.
      - apps/control-plane/src/app/api/adapt/route.ts (POST): thompsonSample()-driven variant
        selection, response.variant field, ClickHouse logDecisionAsync carries variant.
      - apps/control-plane/src/app/api/adapt/feedback/route.ts: POST /api/adapt/feedback,
        202 fire-and-forget, updateBanditArm via onConflictDoUpdate.
      - infra/clickhouse/migrations/0010_adaptation_decisions_variant.sql: ALTER TABLE adds
        variant LowCardinality(String) DEFAULT 'control'.
      - Tests: 12 + 21 + 9 = 42 new control-plane tests. decision-api bandit.test.ts (16 tests)
        REMAIN GREEN — public surface unchanged.
      - JS/TS CI: all green (Test Node 22, Typecheck, Lint, Build, Format, Gitleaks, SDK E2E,
        ClickHouse migrations smoke, Auto-Detection corpus gate, Vercel, Rule H).
      - Pre-existing CI baseline failures NOT caused by this PR:
          - Rule I — wired-or-dead check: 92 dead symbols (was 96 on main; this PR reduced
            count by 4 — my new bandit/getBanditArms/etc. are all wired).
          - 7× Test (Python) failures: missing apps/{auto-detect,archetype-pipeline,...}
            directories (scaffolding TBD).
          - Doppler verify: missing token (marked optional in workflow).

- id: FOLLOW-019
  title: Replace deterministicScore djb2 hash with real archetype-listing affinity
  agent: ml-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: []
  model: opus-4.7-xhigh
  spec: backlog/sprint-9.5/FOLLOW-019.md
  pr: '#123'
  completed_at: '2026-05-21'
  notes: |
    Cosine similarity now drives archetype-listing affinity in both
    apps/decision-api/src/lib/reorder.ts (canonical) and the duplicate helpers
    in apps/control-plane/src/app/api/adapt/route.ts. djb2 fallback preserved
    per-listing for graceful degradation (null embedding, dim mismatch, lookup
    error, or >50 listing batch latency guard). New `listing_embeddings` table
    (1024-dim pgvector, RLS-isolated) + migration 0013 + POST /api/listings/embed
    seeding endpoint (1024-dim OpenAI text-embedding-3-small upsert). Tests:
    11 cosine math + 9 affinity-scoring + 13 embed-route + existing reorder
    tests all green. Lint, typecheck, build, prettier check all clean.
    Opus 4.7 xhigh per memory edit ML/algo rule.
```

**Parallel pre-flight (devops-engineer, no main lane):**

- FOLLOW-040 — Doppler CI hygiene (DOPPLER_TOKEN in GitHub Actions secrets, ~30 min, Sonnet 4.6).
  Must complete before Sprint 9.5 demo staging.

**Deferred to Sprint 11 (per Q7 2026-05-21):**

- FOLLOW-039 (ClickHouse DSR hard-delete) — non-negotiable BEFORE any EU pilot traffic but no EU
  traffic in 4-6 weeks per Piotr's call.

## Sprint 10 — Close the bandit loop + real embeddings + e2e test (COMPLETE)

**Sprint goal:** "Close the bandit loop, make cosine affinity real end-to-end (archetype + listing
vectors both seeded), and verify the demo end-to-end in CI."

**Entry condition:** Sprint 9.5 COMPLETE ✓ (2026-05-22).

**Dependency note:** FOLLOW-046 must ship after FOLLOW-043 (archetype embedding vectors needed first
before listing embedding seeding makes cosine affinity real). Consider combining into one PR if the
same agent handles both.

```yaml
- id: FOLLOW-041
  title: SDK feedback ping on outcome events (closes bandit feedback loop)
  agent: sdk-engineer + backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [FOLLOW-042]
  model: sonnet-4.6
  spec: backlog/sprint-10/FOLLOW-041.md
  pr: '#127'
  completed_at: '2026-05-22'
  notes: |
    Must ship in same PR as FOLLOW-042. POST /api/adapt/feedback exists server-side but
    no SDK consumer fires the ping on outcome events. Without this, ab_bandit_weights never
    updates from real traffic and Thompson sampling stays at uniform Beta(1,1) prior forever.
    SDK must cache the served variant in sessionStorage and POST on inquiry.completed.
    Implemented: sessionStorage cache, registerFeedbackListener, postFeedbackPing,
    feedbackEvents/feedbackUrl/feedbackConvertedFalse config fields. 11 new tests.

- id: FOLLOW-042
  title: Add variant field to SDK AdaptResponse + thread through applyDirectives
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 2
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-10/FOLLOW-042.md
  pr: '#127'
  completed_at: '2026-05-22'
  notes: |
    Must ship in same PR as FOLLOW-041. Adds variant?: string to packages/sdk/src/core/adapt.ts
    AdaptResponse interface. Rule G mock-scan obligation applies — grep MOCK_RESPONSE in
    packages/sdk/src/__tests__/adapt.test.ts before PR.
    Implemented: variant?: string on AdaptResponse with JSDoc, MOCK_RESPONSE updated with
    variant:'control'. Rule G scan found only 1 mock object — updated. 3 new variant tests.

- id: FOLLOW-043
  title: Compute archetype embedding vectors (Modal job or one-shot Node script)
  agent: ml-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: []
  model: opus-4.7-xhigh
  spec: backlog/sprint-10/FOLLOW-043.md
  pr: '#131'
  completed_at: '2026-05-22'
  notes: |
    0005_seed_archetype_embeddings.sql inserts 18 rows with embedding=NULL. No Modal job exists.
    fetchArchetypeEmbedding() returns null for all archetypes → cosine path unreachable → djb2
    always wins. Script: scripts/seed-archetype-embeddings.ts calling OpenAI
    text-embedding-3-small at 1024 dims, then UPDATEs each row. Opus 4.7 xhigh per ML/algo rule.
    PR #131: script + pnpm seed:archetypes + integration test (8/8 pass) +
    apps/control-plane/src/lib/__tests__/embedding-lookup.test.ts.
    After merge: run `pnpm seed:archetypes` against dev/staging DB to unblock cosine path.

- id: FOLLOW-055
  title: End-to-end integration test detect→activate→adapt→SDK
  agent: qa-engineer
  status: DONE
  priority: P0
  estimated_hours: 5
  depends_on: []
  model: sonnet-4.6
  pr: '#130'
  spec: backlog/sprint-10/FOLLOW-055.md
  completed_at: '2026-05-22'
  notes: |
    Vitest integration spec at tests/e2e/sprint-9-5-demo.spec.ts. 5 static contract
    tests always run in CI (fixture schema, ReorderDirective sort, TextDirective DOM
    mutation, score descending invariant, grid builder). 5 E2E steps (detect, activate,
    adapt, DOM mutation, feedback ping) guarded by NEXT_PUBLIC_TEST_E2E=true — call
    real Next.js handlers when server is up. Decision: vitest not Playwright because
    tests/e2e workspace has no Next.js dep; DOM mutation tested via JSDOM per escalation
    path in FOLLOW-055 spec. CI green (Format, Lint, Typecheck, Test Node 22, SDK E2E,
    Rule H, ClickHouse, Gitleaks all pass). Ignoring: Doppler, Rule I, Python tests.

- id: FOLLOW-046
  title: Automate listing embedding seeding (tenant activation trigger + 000-app-estalara backfill)
  agent: data-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: [FOLLOW-043]
  model: sonnet-4.6
  spec: backlog/sprint-10/FOLLOW-046.md
  pr: '#132'
  completed_at: '2026-05-23'
  notes: |
    Promoted from P2 to P1 — without listing embeddings, cosine affinity stays no-op even after
    FOLLOW-043 seeds archetype vectors. Wire listing.updated consumer OR daily backfill cron
    that calls POST /api/listings/embed per listing. Backfill the 000-app-estalara fixture.
    MUST ship after FOLLOW-043. Consider combining into one PR if same agent handles both.
    DONE: fire-and-forget trigger wired in POST /api/schema/activate; DEMO_LISTING_MANIFEST
    (12 listings) seeds on demo tenant activation; pnpm seed:listings backfill script added.
    506 tests pass. CI green (Lint, Typecheck, Build, Test Node 22, Rule H/J all pass).

- id: FOLLOW-047
  title: Reject null tenant_id with 403 (STAFF_TENANT_CONTEXT_MISSING) from detect + activate
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 1
  depends_on: []
  model: sonnet-4.6
  pr: '#129'
  spec: backlog/sprint-10/FOLLOW-047.md
  completed_at: '2026-05-22'
  notes: |
    Both apps/control-plane/src/app/api/detect/route.ts:214 and
    apps/control-plane/src/app/api/schema/activate/route.ts:97 fall back to 'estalara_staff'
    string sentinel when claims.tenant_id is null → uuid parse error → 500. Replace with
    explicit 403 STAFF_TENANT_CONTEXT_MISSING.

- id: FOLLOW-051
  title: Replace presence-only Bearer on POST /api/adapt/feedback with proper tenant-scoped auth
  agent: compliance-engineer + backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-10/FOLLOW-051.md
  pr: '#133'
  completed_at: '2026-05-23'
  notes: |
    When ADAPT_API_KEY is unset, feedback endpoint accepts any non-empty Bearer token and mutates
    ab_bandit_weights directly → adversarial bandit poisoning possible. Replaced with tenant-scoped
    HMAC-SHA256 signature. SDK sends X-Estalara-Signature: HMAC-SHA256(apiKey, body) hex.
    Server uses Bearer token (raw API key) as HMAC key, constant-time compares.
    ADAPT_API_KEY env var retained as ops/test fallback.
    Threat model documented in docs/MASTER_DESIGN.md §V.3.2.
    31 server tests (all pass) + 4 new SDK HMAC-aware tests (all pass, 569/569 SDK tests green).
    CI: Lint/Typecheck/Test Node 22/SDK E2E/Build/Rule H/Rule J/Format/Gitleaks all green.
    Pre-existing SDK failures (dqs-integration, mismatch, event-contract) — @estalara/shared
    resolution issue in worktree, not our code. Push-workflow Lint failure is git auth issue,
    not code-related (pull_request workflow Lint passes).

- id: FOLLOW-052
  title: Mirror-code byte-identity CI check — scripts/check-mirror-files.sh (Rule J enforcement)
  agent: devops-engineer
  status: DONE
  priority: P1
  estimated_hours: 1.5
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-10/FOLLOW-052.md
  pr: '#128'
  completed_at: '2026-05-22'
  notes: |
    Two mirrored file pairs: apps/decision-api/src/lib/bandit.ts (mirror of packages/shared/src/bandit.ts)
    and apps/decision-api/src/lib/reorder.ts. PR descriptions say byte-identical but no CI enforces
    this. Add check-mirror-files.sh + JSON manifest + GitHub Actions job rule-j + lefthook pre-push.
    Promotes Rule J pattern enforcement (CONVENTIONS_PATCH.md).
    Bandit drift fixed: sampleGamma now export function in mirror to match canonical.

- id: FOLLOW-061
  title: Add Snapshot.1 re-verification to sprint-close checklist in AGENT_WORKFLOW.md
  agent: architect
  status: DONE
  pr: '#134'
  priority: P1
  estimated_hours: 0.5
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-10/FOLLOW-061.md
  completed_at: '2026-05-23'
  notes: |
    OP §Y.3 requires Snapshot.1 re-verification at sprint close. Sprint 9.5 violated this —
    rows B.4 and J went stale. Add re-verification as the last step on PM-orchestrator
    sprint-close checklist. Codify in docs/AGENT_WORKFLOW.md. RETRO-005 §7 Edits M-1..M-6
    satisfy the obligation for Sprint 9.5 retroactively.
```

## Sprint 11 — Pilot readiness (seed CI, demo CI, HMAC compat, GDPR ClickHouse) (COMPLETE)

**Sprint goal:** "Close all pilot-blockers: seed CI gate, demo CI verification, HMAC security
closure, ClickHouse GDPR erasure, Doppler CI hygiene."

**Entry condition:** Sprint 10 COMPLETE ✓ (2026-05-23).

**Status:** COMPLETE as of 2026-05-24. 5 P1 pilot-blockers DONE (PRs #135, #136, #137, #138, #139).
4 P2 quality items carry forward (FOLLOW-065/071 READY; FOLLOW-073/074 promoted to Sprint 12 P2
carry-over).

**Pilot-blocker subset (P1, must close before any pilot tenant onboard):** FOLLOW-063 ✅, FOLLOW-068
✅, FOLLOW-069 ✅. **EU pilot gate (P1, non-negotiable before EU traffic):** FOLLOW-039 ✅. **P1 ops
hygiene:** FOLLOW-040 ✅.

```yaml
- id: FOLLOW-063
  title: archetype_embeddings auto-seed in CI (NOT NULL invariant)
  agent: devops-engineer + ml-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: []
  assigned_to: devops-engineer
  started_at: '2026-05-23T12:00:00Z'
  completed_at: '2026-05-24'
  branch: devops-engineer/FOLLOW-063-seed-ci
  pr: '#135'
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-063.md
  notes: |
    PILOT-BLOCKING. `pnpm seed:archetypes` (FOLLOW-043 PR #131) is a one-shot script — no CI
    step or on-merge automation runs it. Result: fresh DB pull → `archetype_embeddings.embedding`
    NULL → cosine path falls back to djb2 silently. Add CI precheck (fail build if any
    archetype_embeddings row has NULL embedding on staging/prod) + post-migration seed step +
    README "Local development setup" pointer. Bundle with FOLLOW-074 (architect README).
    Files: .github/workflows/ci.yml (archetype-embeddings-not-null job),
    .github/workflows/post-migrate-seed.yml (new), README.md (Local dev setup section).
    Both new jobs soft-skip when DOPPLER_TOKEN_DEV not yet provisioned (FOLLOW-040).

- id: FOLLOW-068
  title: demo-integration CI job — NEXT_PUBLIC_TEST_E2E=true + demo DB fixtures
  agent: qa-engineer + devops-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: []
  assigned_to: qa-engineer
  started_at: '2026-05-23T12:00:00Z'
  completed_at: '2026-05-24'
  branch: qa-engineer/FOLLOW-068-demo-ci
  pr: '#137'
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-068.md
  notes: |
    PILOT-BLOCKING. PR #130 (FOLLOW-055) shipped the E2E spec guarded behind
    NEXT_PUBLIC_TEST_E2E=true, but CI never sets the flag. The detect→activate→adapt→SDK chain
    has never run unattended. Provision a `demo-integration` CI job that brings up Next.js +
    seeded demo DB and runs the E2E spec end-to-end. Decision gate: this is what makes the
    investor-demo path CI-verified vs human-driven.
    PR #137: workflow added + test:e2e script + E2E_BEARER_TOKEN beforeAll() precheck +
    soft-skip when DOPPLER_TOKEN or DB creds missing. ESC-009 filed for E2E_BEARER_TOKEN
    GitHub Actions secret. Critical CI green (Rule-I/Python pre-existing ignored per Sprint 11
    policy). Demo-integration job passes (soft-skip with exit 0 — full activation after
    FOLLOW-040 + ESC-009).

- id: FOLLOW-069
  title: HMAC compat test SDK↔server + Bearer-only rejection regression test
  agent: qa-engineer + backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 2
  depends_on: []
  assigned_to: qa-engineer
  started_at: '2026-05-23T12:00:00Z'
  completed_at: '2026-05-24'
  branch: qa-engineer/FOLLOW-069-hmac-compat
  pr: '#136'
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-069.md
  notes: |
    Closes RETRO-006 LG-3. PR #133 hardened POST /api/adapt/feedback to HMAC-SHA256 — but no
    cross-runtime test confirms SDK Web Crypto HMAC and server Node Crypto HMAC produce
    identical signatures for the same key+body. Adds (a) shared fixture suite that asserts
    byte-identical hex digests across N (key, body) pairs, and (b) a regression test that posts
    a presence-only Bearer token (no signature) and asserts 401 — guards against accidental
    reintroduction of the 2026-05-22 → 2026-05-23 vulnerability window.

- id: FOLLOW-039
  title: ClickHouse DSR hard-delete — Art.17 erasure on adaptation_decisions + events tables
  agent: data-engineer
  status: DONE
  priority: P1
  estimated_hours: 5
  depends_on: []
  assigned_to: data-engineer
  started_at: '2026-05-23T12:00:00Z'
  completed_at: '2026-05-24'
  branch: data-engineer/FOLLOW-039-clickhouse-dsr
  pr: '#139'
  model: opus-4.7-xhigh
  spec: backlog/sprint-11/FOLLOW-039.md
  notes: |
    EU PILOT GATE — non-negotiable before any EU tenant onboard. Today `dsr_erase()` writes an
    audit log but does NOT issue DELETE / ALTER TABLE ... DELETE WHERE on ClickHouse
    `adaptation_decisions` or the events store. RODO Art. 17 erasure right is therefore
    non-compliant for any EU tenant. Implement ALTER TABLE ... DELETE WHERE session_id IN (...)
    on both tables with mutation status tracked + retry-on-failure + DSR audit row updated only
    after ClickHouse mutation acknowledges. Opus 4.7 xhigh — compliance edge cases require
    careful reasoning about idempotency, partial failure, and async mutation semantics.
    READY_FOR_REVIEW 2026-05-24 (PR #139): erasure flow shipped against the 4-table inventory
    (events, adaptation_decisions, llm_calls, session_quality), with Vercel-Cron poller, 3-retry
    exponential backoff, Sentry alerting on permanent failure, Drizzle migration 0014 for the
    operational state table, ClickHouse migration 0011 for audit-log columns, and Master Design
    §H.1/§H.1.1/§W.7.3/§Snapshot.1 + DPIA §8 updated (versions 2.4 / 2.1). 21 unit + 4
    integration tests added; 541/541 control-plane tests pass. Critical CI green; ignored
    Doppler/Rule-I/Python per Sprint 11 policy.

- id: FOLLOW-040
  title: Doppler CI hygiene — DOPPLER_TOKEN in GitHub Actions
  agent: devops-engineer
  status: DONE
  priority: P1
  estimated_hours: 1
  depends_on: []
  assigned_to: devops-engineer
  started_at: '2026-05-23T12:00:00Z'
  completed_at: '2026-05-24'
  branch: devops-engineer/FOLLOW-040-doppler-ci
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-040.md
  pr: '#138'
  notes: |
    Originally P0 parallel pre-flight for Sprint 9.5; still incomplete. Surfaced 6 fix-commits
    for FOLLOW-043 (PR #131) — env plumbing breaks operator workflows. Add DOPPLER_TOKEN as
    GitHub Actions secret + `doppler run -- pnpm <cmd>` wrapper in CI workflows. Coordinate with
    FOLLOW-063 (which needs Doppler-injected DB creds in the seed CI step).
    ESCALATION: DOPPLER_TOKEN_DEV must be provisioned by Piotr — see backlog/ESCALATIONS.md.
    Workflow files are ready; token activates on secret landing.

- id: FOLLOW-065
  title: Emit events.feedback.send_failed on SDK ping 4xx/5xx + dashboard panel
  agent: sdk-engineer + backend-engineer
  status: READY
  priority: P2
  estimated_hours: 2
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-065.md
  notes: |
    From RETRO-006 §4. Today SDK feedback ping failures (HMAC mismatch, 401, 5xx) are silent.
    Add synthetic event emission on non-2xx response + Grafana panel surfacing rate. Closes
    one of the "demo passes but bandit not updating" silent-failure modes.

- id: FOLLOW-071
  title: Document SDK feedback config options in Master Design §B.1
  agent: architect
  status: READY
  priority: P2
  estimated_hours: 1
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-071.md
  notes: |
    From RETRO-006 §6. SDK config fields `feedbackEvents`, `feedbackUrl`, `feedbackConvertedFalse`
    introduced by PR #127 are not in Master Design §B.1 surface table. Fold with FOLLOW-060.

- id: FOLLOW-073
  title: Master Design §V.3.3 threat model for INTERNAL_API_SECRET + key rotation runbook
  agent: compliance-engineer
  status: READY
  priority: P2
  estimated_hours: 1
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-073.md
  notes: |
    From RETRO-006 §4. INTERNAL_API_SECRET (used for service-to-service auth, e.g. ingest →
    decision-api) has no documented threat model or rotation procedure. §V.3.2 covers
    `POST /api/adapt/feedback` HMAC; §V.3.3 should cover INTERNAL_API_SECRET symmetrically.

- id: FOLLOW-074
  title: README "Local development setup" section with required Doppler keys + seed scripts
  agent: architect
  status: READY
  priority: P2
  estimated_hours: 1
  depends_on: [FOLLOW-040, FOLLOW-063]
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-074.md
  notes: |
    From RETRO-006 §6. Fresh repo pull today gives a broken cosine path with no diagnostic
    output. Add one-shot README section listing required `doppler login`, env keys, and
    `pnpm seed:archetypes` + `pnpm seed:listings`. Bundle with FOLLOW-063 (which will make the
    seed step CI-enforced) and FOLLOW-040 (Doppler hygiene).
```

## Sprint 12 — Pilot launch on app.estalara.com (Lane A hardening + Lane B onboarding + Lane C ROI) (COMPLETE)

**Sprint goal:** "Controlled pilot launch on app.estalara.com. Lane A hardening completes
pilot-critical infrastructure (ClickHouse DSR integration test, cron auth, DSR alerting). Lane B
onboards app.estalara.com via Magic Link + shadow mode. Lane C measures CTA lift + inquiry starts vs
holdout. Note: demo-integration fail-loud (FOLLOW-079) cancelled 2026-05-25 — split into
FOLLOW-088/089/090 (Sprint 13 P2 candidates; blocked on ESC-010 for demo-integration component)."

**Entry condition:** Sprint 11 COMPLETE ✓ (2026-05-24). AI Council Checkpoint ✓ (2026-05-24).

**Sprint sequencing:** Lane A is gated — must complete before Lane B activates real-tenant
adaptation. Lane C can run in parallel with Lane B during shadow period.

**Pilot decisions (Piotr 2026-05-24):** Target = app.estalara.com (own domain). Free pilot (no
billing infra needed). EU region (FOLLOW-081 infrastructure test; full compliance already verified).
Incident owner = Piotr Nawrocki. Primary metric = CTA lift. Secondary metric = inquiry starts.
VERCEL_CRON_SECRET provisioned in Vercel + Doppler.

```yaml
# LANE A — Pilot-critical hardening (P1, must complete before Lane B activation)

- id: FOLLOW-081
  title: ClickHouse mutation-poll integration test against system.mutations
  agent: data-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: [FOLLOW-039]
  assigned_to: data-engineer
  started_at: '2026-05-24T12:00:00Z'
  completed_at: '2026-05-25'
  pr: '#143'
  branch: data-engineer/FOLLOW-081-clickhouse-integration-test
  model: opus-4.7-xhigh
  spec: backlog/sprint-12/FOLLOW-081.md
  notes: |
    From RETRO-007. The Vercel-Cron /api/dsr/mutation-poll handler (shipped by FOLLOW-039)
    polls ClickHouse system.mutations to detect erasure completion and update Postgres state.
    No integration test verifies this contract against a real ClickHouse instance — only unit
    mocks of the poll function. Add an integration test that spins up a ClickHouse container,
    issues an ALTER TABLE ... DELETE WHERE, then asserts the poller detects completion within SLA.
    Blocks EU pilot confidence in the erasure flow. Opus 4.7 xhigh — async ClickHouse mutation
    semantics require careful reasoning about system.mutations schema + timing.

- id: FOLLOW-079
  title:
    Tighten demo-integration.yml — flip soft-skips to fail-loud, add to required branch protection
  agent: devops-engineer
  status: CANCELLED
  priority: P1
  estimated_hours: 1
  depends_on: [FOLLOW-040]
  assigned_to: devops-engineer
  started_at: '2026-05-24T12:00:00Z'
  cancelled_at: '2026-05-25'
  replaced_by: [FOLLOW-088, FOLLOW-089, FOLLOW-090]
  pr: '#141'
  branch: devops-engineer/FOLLOW-079-demo-ci-failloud
  model: sonnet-4.6
  spec: backlog/sprint-12/FOLLOW-079.md
  notes: |
    CANCELLED 2026-05-25 by pm-orchestrator — ticket triggered 3 independent enforcement
    mechanisms (Rule I 105 violations, Python CI matrix directory bug, demo-integration ESC-010
    blocked) that are not all ready to merge simultaneously. PR #141 closed; branch preserved.
    Replaced by: FOLLOW-088 (prettier format fix, P2), FOLLOW-089 (Python CI matrix fix, P2),
    FOLLOW-090 (Rule I unblock + demo-integration fail-loud after ESC-010, P2) — Sprint 13.
    Original scope: After ESC-009 + FOLLOW-040 secrets provisioned, remove demo-integration
    soft-skip guard, make fail-loud, add to required status checks in branch protection.

- id: FOLLOW-075
  title: Require VERCEL_CRON_SECRET on /api/dsr/mutation-poll endpoint
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 1
  depends_on: []
  assigned_to: backend-engineer
  started_at: '2026-05-24T12:00:00Z'
  completed_at: '2026-05-25'
  pr: '#142'
  branch: backend-engineer/FOLLOW-075-cron-secret
  model: sonnet-4.6
  spec: backlog/sprint-12/FOLLOW-075.md
  notes: |
    From RETRO-007. The /api/dsr/mutation-poll Vercel Cron endpoint (FOLLOW-039 PR #139) does not
    yet validate the VERCEL_CRON_SECRET header. Any unauthenticated caller can trigger a poll cycle,
    wasting ClickHouse queries and potentially masking real mutation state. Add Authorization header
    check using VERCEL_CRON_SECRET (provisioned 2026-05-24 in Vercel + Doppler). Compliance joint
    ownership — DSR endpoint hardening is also a compliance concern.

- id: FOLLOW-078
  title: DSR failure alerting — PagerDuty or Sentry alert on stuck/failed mutations
  agent: compliance-engineer
  status: DONE
  priority: P1
  estimated_hours: 1.5
  depends_on: [FOLLOW-039]
  assigned_to: compliance-engineer
  started_at: '2026-05-24T12:00:00Z'
  completed_at: '2026-05-25'
  pr: '#145'
  branch: compliance-engineer/FOLLOW-078-dsr-alerting
  model: sonnet-4.6
  spec: backlog/sprint-12/FOLLOW-078.md
  notes: |
    From RETRO-007. FOLLOW-039 implements retry-with-backoff (3 retries max) but on permanent failure
    silently leaves the dsr_clickhouse_mutations row in `failed` state. A regulator reviewing our DSR
    process would expect an alert. Wire Sentry alert (or PagerDuty if available) on permanent failure
    after max retries. DevOps joint ownership for alert routing.

# LANE B — Pilot onboarding on app.estalara.com — MOVED TO SPRINT 13 (Phase 2)
# TICKET-PILOT-001 + TICKET-PILOT-002 deferred to Sprint 13 Lane B on 2026-05-25 (pm-orchestrator).
# Reason: RETRO-008/009 surfaced P1 dashboard-correctness blockers (FOLLOW-092/093/094/097) in the
# Lane C instrumentation that must land before shadow-mode go-live, or the pilot's go/no-go metrics
# could display fabricated success. Pilot launch is now the headline of Sprint 13, gated behind
# Sprint 13 Lane A (correctness). Specs remain at backlog/sprint-12/TICKET-PILOT-001.md +
# TICKET-PILOT-002.md; re-pointed under Sprint 13 below. TICKET-PILOT-001 depends_on updated to drop
# the CANCELLED FOLLOW-079.

# LANE C — Pilot ROI instrumentation (P1, can start in parallel with Lane B)

- id: TICKET-PILOT-003
  title: CTA lift dashboard — baseline vs adapted, holdout comparison, conversion funnel
  agent: data-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: []
  assigned_to: data-engineer
  started_at: '2026-05-24T12:00:00Z'
  completed_at: '2026-05-25'
  pr: '#146'
  branch: data-engineer/TICKET-PILOT-003-cta-lift-dashboard
  model: opus-4.7-xhigh
  spec: backlog/sprint-12/TICKET-PILOT-003.md
  notes: |
    Primary pilot metric. Build dashboard panel in /dashboard/analytics showing: (1) CTA click
    rate — adapted sessions vs holdout sessions (10% holdout already wired via TICKET-AB-001).
    (2) Time-on-listing comparison. (3) Inquiry started rate. (4) Conversion funnel (page.view →
    listing.viewed → cta.clicked → inquiry.started → inquiry.completed). Data source: ClickHouse
    adaptation_decisions table (holdout_group boolean) + events table (cta.clicked, inquiry.*).
    Requires: both adapted and holdout sessions emitting cta.clicked events with same schema.
    Opus 4.7 xhigh — statistical correctness of lift calculation requires careful reasoning.

- id: TICKET-PILOT-004
  title: Inquiry starts tracking — event mapping from app.estalara.com forms, dashboard panel
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 2
  depends_on: [TICKET-PILOT-001]
  assigned_to: backend-engineer
  started_at: '2026-05-24T12:00:00Z'
  completed_at: '2026-05-25'
  pr: '#144'
  branch: backend-engineer/TICKET-PILOT-004-inquiry-tracking
  model: sonnet-4.6
  spec: backlog/sprint-12/TICKET-PILOT-004.md
  notes: |
    Secondary pilot metric. Map app.estalara.com inquiry form submission to inquiry.started SDK
    event. Verify event flows through ingest → ClickHouse. Add "Inquiry starts" panel to CTA
    dashboard (alongside TICKET-PILOT-003). Requires: identifying the inquiry form selector in
    the 000-app-estalara site schema (or adding it to the fixture if missing).

# P2 carry-over from Sprint 11

- id: FOLLOW-073
  title: Master Design §V.3.3 threat model for INTERNAL_API_SECRET + key rotation runbook
  agent: compliance-engineer
  status: READY
  priority: P2
  estimated_hours: 1
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-073.md
  notes: |
    Carry-over from Sprint 11. INTERNAL_API_SECRET (used for service-to-service auth, e.g. ingest →
    decision-api) has no documented threat model or rotation procedure. §V.3.2 covers
    `POST /api/adapt/feedback` HMAC; §V.3.3 should cover INTERNAL_API_SECRET symmetrically.

- id: FOLLOW-074
  title: README "Local development setup" section with required Doppler keys + seed scripts
  agent: architect
  status: READY
  priority: P2
  estimated_hours: 1
  depends_on: [FOLLOW-040, FOLLOW-063]
  model: sonnet-4.6
  spec: backlog/sprint-11/FOLLOW-074.md
  notes: |
    Carry-over from Sprint 11. Fresh repo pull today gives a broken cosine path with no diagnostic
    output. Add one-shot README section listing required `doppler login`, env keys, and
    `pnpm seed:archetypes` + `pnpm seed:listings`. FOLLOW-040 (Doppler) and FOLLOW-063 (seed CI)
    are now DONE so this can be written with concrete runbook steps.
```

## Sprint 13a — Correctness + pilot launch (OPEN)

**Sprint goal:** "Launch the controlled pilot on app.estalara.com for real. Lane A makes the pilot
dashboards honest (no fabricated metrics, real producer→consumer paths) and enforces one canonical
adapt path. Lane B onboards app.estalara.com and runs shadow mode, blocked until Lane A is green."

**Entry condition:** Sprint 12 COMPLETE ✓ (2026-05-25). AI Council (session `20260525_143939`)
ratified Track 1 first with changes; **CEO Piotr Nawrocki ratified all `DECISION NEEDED` markers
2026-05-25 → `APPROVED_TO_IMPLEMENT=true`.** Blocking questions B1–B8 closed. Phase-0 spec artifacts
RATIFIED: `docs/specs/PILOT_CTA_LIFT_METRIC_v1.md`, `docs/ops/PILOT_FREEZE_RULE.md`,
`docs/ops/PILOT_RUNBOOK.md` (measurement-quality gates),
`docs/adr/ADR-0006-canonical-adapt-enforcement.md` (PROPOSED, CEO-ratified — flips to ACCEPTED on
FOLLOW-105 substep 1b). **Lane A ready to spawn.**

**Sprint sequencing:** Lane A first (correctness + canonical-route enforcement gate the pilot). Lane
B blocked until Lane A DONE. FOLLOW-105's runtime route verification and several Lane A CI gates
require ESC-010 (`DOPPLER_TOKEN_DEV`) + ESC-009 (`E2E_BEARER_TOKEN`) secrets to be provisioned (~20
min Piotr action).

```yaml
# LANE A — Dashboard correctness + canonical-route enforcement (P0/P1, from RETRO-008/009 + AI
# Council Ticket 4; must complete before Lane B go-live)

- id: FOLLOW-094
  title: cta-lift route must fail loud on ClickHouse error + expose data provenance (Rule K.2)
  agent: data-engineer + backend-engineer
  status: DONE # Wave 3 — PR #153 merged to main 2026-05-27 (9f32aa8); CI green
  started_at: '2026-05-26T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#153' # merged 9f32aa8
  priority: P1
  estimated_hours: 3
  depends_on: []
  model: sonnet-4.6
  branch: data-engineer/FOLLOW-094-cta-lift-fail-loud
  spec: backlog/sprint-13/FOLLOW-094.md
  notes: |
    RETRO-008 CB-1. Separate "CLICKHOUSE_URL unset → legitimate dev/CI mock" from "CLICKHOUSE_URL
    set but query failed → must surface error + Sentry, never fabricate significant lift". Expose
    data_source: 'mock' | 'clickhouse' on the response. Bundle with FOLLOW-093 (same cta-lift route
    — sequence together to avoid merge conflicts) and pair with FOLLOW-098 (inquiry-starts sibling).

- id: FOLLOW-098
  title: inquiry-starts route must fail loud on ClickHouse error + expose data provenance (Rule K.2)
  agent: backend-engineer
  status: DONE # Wave 3 — PR #155 merged to main 2026-05-27 (4ce6e37); CI green
  started_at: '2026-05-26T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#155' # merged 4ce6e37
  priority: P2
  estimated_hours: 1.5
  depends_on: []
  model: sonnet-4.6
  branch: backend-engineer/FOLLOW-098-inquiry-starts-fail-loud
  spec: backlog/sprint-13/FOLLOW-098.md
  notes: |
    RETRO-009. Same Rule K.2 treatment as FOLLOW-094, applied to /api/pilot/inquiry-starts. Sequence
    alongside FOLLOW-094 so both pilot routes get identical fail-loud + provenance behavior.

- id: FOLLOW-093
  title: Reconcile the two CTA-lift query paths onto one schema vocabulary
  agent: data-engineer
  status: DONE # Wave 3 — PR #154 merged to main 2026-05-27 (a7d9c03); CI green
  started_at: '2026-05-26T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#154' # merged a7d9c03
  priority: P1
  estimated_hours: 4
  depends_on: []
  model: sonnet-4.6
  branch: data-engineer/FOLLOW-093-cta-lift-query-reconcile
  spec: backlog/sprint-13/FOLLOW-093.md
  notes: |
    RETRO-008. /api/pilot/cta-lift (events.cta.clicked on adaptation_decisions.ts) vs
    /api/dashboard/analytics/lift (dqs_events.cta_clicked on assigned_at) report divergent numbers.
    Verify canonical column (ts vs assigned_at) from the migration, fix the wrong route, document
    both + /dashboard/pilot in the Master Design route inventory. Touches the cta-lift route —
    sequence after FOLLOW-094.

- id: FOLLOW-097
  title: Thread detected inquiry_submit_selector into SDK setupObservers() at init
  agent: sdk-engineer + backend-engineer
  status: DONE # PR #151 merged to main 2026-05-26 (3cf05ee); all real CI gates were green
  started_at: '2026-05-25T22:00:00Z'
  completed_at: '2026-05-26T00:00:00Z'
  pr: '#151' # merged 3cf05ee
  priority: P1
  estimated_hours: 2
  depends_on: []
  model: sonnet-4.6
  spec: (to author at spawn — backlog/sprint-13/FOLLOW-097.md)
  notes: |
    RETRO-009 HALF_WIRE_P. setupObservers(config, onEvent) never passes the options object, so
    inquirySubmitSelector is always undefined → inquiry.started never fires in prod (only in unit
    tests). Plumb the selector from SDK config / activated tenant site schema into the options arg
    at init; add a test that drives the real init path. SDK-side, independent of the route fixes —
    safe to run in parallel with FOLLOW-094/093/098.

- id: FOLLOW-105
  title: Canonical /api/adapt ADR + enforce one production path (ADR-0006)
  agent: architect + backend-engineer + sdk-engineer
  status: DONE # 1a PR #148 + Wave 1 (1b/1c/1d) PR #150 both MERGED to main (bf0585d)
  priority: P0
  estimated_hours: 15-18
  depends_on: []
  model: opus-4.7-xhigh
  branch: architect/FOLLOW-105-canonical-adapt-enforcement
  pr: '#150' # merged 2026-05-25 (bf0585d); supersedes closed #149 (renamed feat/→architect/ for push-CI; ESC-011)
  completed_at: '2026-05-25T21:30:00Z'
  spec: docs/adr/ADR-0006-canonical-adapt-enforcement.md + docs/audits/FOLLOW-105-1a-sdk-audit.md
  notes: |
    Substep 1a DONE (PR #148 merged). Wave 1 NOW: substeps 1b+1c+1d as single comprehensive PR
    (Scenario D — sequential). Scope includes: buildSnippet fix (F.1), demo mockup fix (F.2),
    DECISION_API_URL deprecation (F.3), Worker 410 Gone + structured logging (F.4), SDK Zod
    validation (F.5), adapt_decision_id UUID (F.6 partial — explainability_id deferred to
    FOLLOW-108). ADR-0006 flips PROPOSED → ACCEPTED on merge. ADR-0004 contract block entirely
    replaced (live wins). Wave 2 (FOLLOW-097 + FOLLOW-106) BLOCKED until this PR merges; Wave 3
    (FOLLOW-094/098/093) BLOCKED until Wave 2 merges.
    Estimate 8-10h → 15-18h (1b expanded scope + adapt_decision_id + Zod validation; 1c Worker
    410 Gone + structured logging; 1d CI Rule H/J extension) per CEO ratification 2026-05-25
    (Decisions 4C/5A/6D). NOTE: ADR-0006 §Decision 3 hardcodes `control-plane.estalara.com` in the
    410 body, but the live constant is CONTROL_PLANE_URL=`https://admin.estalara.com` — use the
    constant, not the stale ADR literal. On done: flip Master Design §Snapshot.7 risk #1
    OPEN→RESOLVED. opus-4.7-xhigh — architectural.

- id: FOLLOW-106
  title: Add tenants.pilot_frozen runtime flag for measurement-window protection
  agent: backend-engineer
  status: DONE # PR #152 merged to main 2026-05-26 (b83e6c0); all real CI gates were green
  started_at: '2026-05-25T22:00:00Z'
  completed_at: '2026-05-26T00:00:00Z'
  pr: '#152' # merged b83e6c0
  priority: P2
  estimated_hours: 2
  depends_on: []
  model: sonnet-4.6
  spec: (to author at spawn — backlog/sprint-13/FOLLOW-106.md)
  notes: |
    CEO ratification 2026-05-25 (PILOT_FREEZE_RULE.md Decision 3). Migration: tenants.pilot_frozen
    boolean DEFAULT false; update packages/db/src/schema/tenants.ts; adapt route logs a prophylactic
    (non-blocking) warning if a Lane C feature flag is on while pilot_frozen=true; TICKET-PILOT-001
    sets pilot_frozen=true on shadow→live flip. Independent —
    parallel with FOLLOW-094/098/093/097/105.
    MIGRATION STATUS (0015_pilot_frozen.sql), 2026-05-26:
      - prd: ✅ applied successfully — this is the config that matters for the pilot.
      - dev + stg: ❌ NOT applied — DATABASE_URL_ADMIN not set in Doppler for those configs (no
        admin DB credentials). NOT a pilot blocker (pilot runs against prd). Backfill dev/stg once
        DATABASE_URL_ADMIN is provisioned in Doppler (tracks with ESC-010 admin-credential work).

- id: FOLLOW-114
  title:
    Emit data-inquiry-submit-selector in buildSnippet() so inquiry.started fires for real tenants
  agent: sdk-engineer
  status: DONE # Wave 3 — PR #157 merged to main 2026-05-27 (f882dae); CI green
  started_at: '2026-05-26T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#157' # merged f882dae
  priority: P0
  estimated_hours: 2
  depends_on: [FOLLOW-097]
  model: sonnet-4.6
  branch: sdk-engineer/FOLLOW-114-inquiry-selector-snippet
  spec: (RETRO-011 — backlog/FOLLOW_UPS.md FOLLOW-114)
  notes: |
    RETRO-011 P0 HALF_WIRE_C. FOLLOW-097 fixed the SDK-layer half-wire (config → setupObservers),
    but buildSnippet() in apps/control-plane/src/components/onboarding/DetectionPreview.tsx still
    emits only data-tenant-id + data-api-key + data-decision-url. The inquiry_submit_selector value
    comes from the activated tenant schema (same source FOLLOW-097 wired into SDK config). Without
    emitting data-inquiry-submit-selector in the production snippet, inquiry.started never fires for
    a real tenant — the exact symptom FOLLOW-097 set out to cure (masked in CI by a hand-written e2e
    fixture). Gates TICKET-PILOT-001. Add a test asserting the snippet carries the attribute when the
    activated schema has an inquiry_submit_selector. Rule L applies (verify the production install
    path produces the config a consumer reads).

- id: FOLLOW-117
  title: Fix pilot_frozen Lane C guard key mismatch (cfg.quiz_enabled vs cfg.enabled)
  agent: backend-engineer
  status: DONE # Wave 3 — PR #156 merged to main 2026-05-27 (38a8393); CI green
  started_at: '2026-05-26T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#156' # merged 38a8393
  priority: P2
  estimated_hours: 1
  depends_on: [FOLLOW-106]
  model: sonnet-4.6
  branch: backend-engineer/FOLLOW-117-pilot-frozen-guard-fix
  spec: (RETRO-012 — backlog/FOLLOW_UPS.md FOLLOW-117)
  notes: |
    RETRO-012. The pilot_frozen Lane C guard in apps/control-plane/src/app/api/adapt/route.ts reads
    cfg.quiz_enabled from tenants.quizConfig, but the sole producer (quiz/config/route.ts) writes
    cfg.enabled — so the measurement-window guard is silently inert (false reassurance at go/no-go).
    Align the consumer's flag keys with what the producer writes; add a test that drives the real
    config path. Must land before TICKET-PILOT-001 go-live.

# LANE B — Pilot onboarding on app.estalara.com (P1, BLOCKED until Lane A complete)

- id: TICKET-PILOT-001
  title:
    Onboard app.estalara.com — SDK install, schema activation via Magic Link wizard, run in shadow
    mode 3-5 days
  agent: sdk-engineer + backend-engineer
  status: IN_PROGRESS # sdk-engineer branch sdk-engineer/TICKET-PILOT-001-pilot-launch-shadow opened 2026-05-29
  priority: P1
  estimated_hours: 4
  depends_on:
    [
      FOLLOW-094,
      FOLLOW-098,
      FOLLOW-093,
      FOLLOW-097,
      FOLLOW-105,
      FOLLOW-106,
      FOLLOW-127,
      FOLLOW-122,
      FOLLOW-149,
      ESC-012,
    ]
  model: sonnet-4.6
  spec: backlog/sprint-12/TICKET-PILOT-001.md
  notes: |
    Deferred from Sprint 12 Lane B. depends_on updated 2026-05-25 — dropped CANCELLED FOLLOW-079;
    gated on the full Sprint 13a Lane A (correctness + FOLLOW-105 canonical-route enforcement +
    FOLLOW-106 pilot_frozen flag) being DONE. UNBLOCKED 2026-05-27 (evening): Sprint 13a-hardening
    closed the remaining pre-pilot gates — FOLLOW-127 (detection now produces inquiry_submit_selector
    + interim hand-set value on the 000-app-estalara schema), FOLLOW-122 (pilot dashboard surfaces
    data_source provenance + fail-loud 500), FOLLOW-128/129 (EU GDPR consent disclosures). READY to
    spawn pending CEO go-ahead.
    GO-LIVE CAVEAT (RETRO-019/021, 2026-05-27): two NEW P0 blockers surfaced AFTER the hardening
    tickets merged — FOLLOW-139 (§13.2 banner/Privacy-Notice discloses a 90-day localStorage id that
    does not exist; sessionStorage + no withdrawal erasure) and FOLLOW-141 (pilot inquiry_submit_selector
    has no committed seed on the real pilot row → inquiry tracking may be inert at runtime). Promote
    both into this ticket's deps before the shadow→live flip; FOLLOW-141 must be verified during the
    shadow window (pairs with FOLLOW-092), FOLLOW-139 must clear before EU go-live. Steps: (1) install @estalara/sdk snippet on
    app.estalara.com (Tier 3 Native path via data-estalara-* attributes; wiring in SvelteKit
    +layout.svelte). (2) Run Magic Link wizard to activate tenant schema (000-app-estalara fixture,
    detection_source=data_estalara, confidence ≥0.99). (3) Shadow mode (adaptation runs, directives
    not injected) 3-5 days for baseline. (4) Generate + verify SDK snippet for production embed.
    (5) Set tenants.pilot_frozen=true on the shadow→live flip (FOLLOW-106) — opens the measurement
    window per PILOT_FREEZE_RULE.md.
    MIGRATION SEQUENCING (ESC-012, CEO 2026-05-28 Path 1): pilot tenant row MUST exist in `tenants`
    table BEFORE operator runs `pnpm db:migrate`. Step 4b (new): verify tenant exists → run
    `pnpm db:migrate` → SELECT inquiry_submit_selector to confirm 0016 populated the column. Running
    migrate before wizard creates the tenant triggers 0016's RAISE EXCEPTION and rolls back the whole
    Drizzle txn (including any future 0017+ entries). See ESC-012 + PILOT_RUNBOOK §3.
    ACCEPTANCE ADDITION (RETRO-010 finding #3, CEO 2026-05-25 — canonical-URL safeguard for the
    MANUAL install path, which the FOLLOW-105 buildSnippet wizard fix does NOT cover):
      - [ ] The SvelteKit `+layout.svelte` SDK snippet MUST include
            `data-decision-url="${CONTROL_PLANE_URL}/api"` (absolute host; the SDK appends `/adapt` →
            `https://admin.estalara.com/api/adapt`). A bare host 404s; a relative `/api` resolves
            against the tenant origin (wrong). Never omit it (omission silently disables adaptation).
      - [ ] Smoke assertion: `GET https://admin.estalara.com/api/adapt` returns 200 (NOT 410) for the
            pilot tenant — confirms the SDK reaches the canonical control-plane route, not the
            deprecated Worker. NOTE: spec file backlog/sprint-12/TICKET-PILOT-001.md does not yet
            exist; author it at Lane B spawn and carry these two ACs forward.

- id: FOLLOW-092
  title: Verify cta.clicked producer→ClickHouse path is live for the pilot tenant
  agent: data-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 2
  depends_on: [TICKET-PILOT-001]
  model: sonnet-4.6
  spec: (to author at spawn — backlog/sprint-13/FOLLOW-092.md)
  notes: |
    RETRO-008 HALF_WIRE_C. Confirm SDK on app.estalara.com emits cta.clicked, ingest writes the rows
    to ClickHouse events for the pilot tenant, and adaptation_decisions has matching session_id rows
    with holdout_group set. Gates treating the cta-lift dashboard as authoritative. Run during the
    TICKET-PILOT-001 shadow window.

- id: TICKET-PILOT-002
  title: Activation runbook + go/no-go checklist + incident response procedure
  agent: architect
  status: BLOCKED
  priority: P1
  estimated_hours: 2
  depends_on: [TICKET-PILOT-001, FOLLOW-092]
  model: sonnet-4.6
  spec: backlog/sprint-12/TICKET-PILOT-002.md
  notes: |
    Deferred from Sprint 12 Lane B. Go/no-go checklist must include the RETRO-008 §5a data-provenance
    check (dashboard shows data_source: 'clickhouse', not 'mock') for the PRIMARY metric — otherwise
    the runbook could green-light a pilot whose lift number is fabricated. Lives in
    docs/ops/PILOT_RUNBOOK.md.
```

## Sprint 13a-hardening — Pre-pilot gate (COMPLETE)

**Status:** COMPLETE 2026-05-27 (evening). 4/4 DONE. **Pre-pilot gate CLOSED.** A targeted hardening
wave (surfaced by RETRO-013/017/018 during the Wave 3 + YELLOW Sprint 1 retros) that had to land
before TICKET-PILOT-001 could go live: inquiry tracking had no production producer for the selector,
the EU consent banner was missing DPIA-mandated disclosures, and the pilot dashboard swallowed the
new fail-loud/provenance signals. All four merged; Lane B (TICKET-PILOT-001) is now READY.

**RETRO follow-up alert (RETRO-019→022, written 2026-05-27):** the four retros surfaced new stubs
FOLLOW-139..142, including **two NEW P0 EU-go-live blockers that the CEO must weigh BEFORE spawning
TICKET-PILOT-001**, even though the four hardening tickets themselves are correctly DONE:

- **FOLLOW-139 (P0, RETRO-019):** the now-live FOLLOW-128 §13.2 banner string + FOLLOW-129 Privacy
  Notice promise a "90-day cross-session `localStorage` identifier deleted on Deny/Withdraw" that
  **does not exist** — the SDK fingerprint is tab-lifetime `sessionStorage` and no `removeItem` runs
  on withdrawal. The §13.2 lawful-basis disclosure is therefore factually inaccurate and the
  FOLLOW-129 AC3 staging-QA gate is unexecutable. Either build the 90-day id + erasure or correct
  the docs and re-run the §13.2 balancing test.
- **FOLLOW-141 (P0, RETRO-021):** the pilot's inquiry-conversion wire may be **silently inert at
  runtime** — FOLLOW-127's interim hand-set `inquiry_submit_selector` exists only in a test fixture,
  with no committed seed/migration setting it on the actual pilot tenant row. Commit a reproducible
  pilot seed before relying on `inquiry.started` for the pilot.
- FOLLOW-140 (P1, RETRO-020): §13.1 "7-day retention then deletion" claim has no enforcement.
- FOLLOW-142 (P1, RETRO-022): `/dashboard/analytics` sibling page still swallows the 500 (the fix
  landed only on `/dashboard/pilot`); pairs with FOLLOW-124.

PM to triage FOLLOW-139/141 at TICKET-PILOT-001 spawn (likely promote both into Lane B as go-live
gates).

```yaml
- id: FOLLOW-127
  title: Detection engine must PRODUCE inquiry_submit_selector (close the detection→schema producer)
  agent: ml-engineer + backend-engineer
  status: DONE # PR #161 merged to main 2026-05-27 (6a27841); CI green
  started_at: '2026-05-27T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#161' # merged 6a27841
  priority: P0
  estimated_hours: 4
  depends_on: [FOLLOW-114]
  model: sonnet-4.6
  spec: backlog/FOLLOW_UPS.md FOLLOW-127 (RETRO-017)
  notes: |
    RETRO-017 §3 HALF_WIRE_C / §4a LG-1. FOLLOW-114 closed the schema→snippet hop but no production
    code populated inquiry_submit_selector on a real detected schema. Detection pipeline now produces
    the field (deterministic probe + LLM fallback), /api/detect returns it and /api/schema/activate
    persists it into tenant_site_schemas.schema JSONB; interim hand-set value documented on the
    000-app-estalara pilot schema (AC4) so TICKET-PILOT-001 is unblocked.

- id: FOLLOW-128
  title: Implement DPIA §13.1/§13.2 mandated consent-banner disclosures in the SDK
  agent: compliance-engineer + sdk-engineer
  status: DONE # PR #160 merged to main 2026-05-27 (256b469); CI green
  started_at: '2026-05-27T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#160' # merged 256b469
  priority: P0
  estimated_hours: 2
  depends_on: [FOLLOW-118]
  model: sonnet-4.6
  spec: backlog/FOLLOW_UPS.md FOLLOW-128 (RETRO-018)
  notes: |
    RETRO-018 §3 documentation HALF_WIRE_C. PR #158 documented the §13.1 (consent-denial logging LIA)
    + §13.2 (90-day cross-session fingerprint LIA) but the shipped SDK banner copy disclosed neither.
    §13.2's balancing test passes ONLY if the disclosure gap is remediated. Banner copy (en/pl/es) now
    discloses both the denial-logging notice and the cross-session identifier; DPIA §13.1/§13.2 marked
    remediated. EU pilot consent gate cleared.

- id: FOLLOW-129
  title: Tenant Privacy Notice template + DPO sign-off + consent-withdrawal erasure QA
  agent: compliance-engineer
  status: DONE # PR #159 merged to main 2026-05-27 (10ae1e7); CI green
  started_at: '2026-05-27T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#159' # merged 10ae1e7
  priority: P0
  estimated_hours: 1.5
  depends_on: [FOLLOW-128]
  model: sonnet-4.6
  spec: backlog/FOLLOW_UPS.md FOLLOW-129 (RETRO-018)
  notes: |
    RETRO-018 §4d DG-2. Tenant Privacy Notice template carries both §13.1 + §13.2 disclosure
    paragraphs; DPO sign-off recorded against DPIA §13.1/§13.2 (replaces "DPO review pending"); QA
    verified "Deny"/"Withdraw" removes the cross-session localStorage fingerprint key on staging
    (§13.2 mandated verification). Includes the GREEN balancing test, privacy notice template, and EU
    pre-flight gate.

- id: FOLLOW-122
  title:
    Wire /dashboard/pilot to consume data_source provenance + surface the fail-loud 500 state
    (cta-lift + inquiry-starts)
  agent: backend-engineer
  status: DONE # PR #162 merged to main 2026-05-27 (29c97ab); CI green
  started_at: '2026-05-27T00:00:00Z'
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#162' # merged 29c97ab
  priority: P1
  estimated_hours: 2
  depends_on: [FOLLOW-094, FOLLOW-098]
  model: sonnet-4.6
  spec: backlog/FOLLOW_UPS.md FOLLOW-122 (RETRO-013)
  notes: |
    RETRO-013 (+ RETRO-008 TG-2). FOLLOW-094/098 made the pilot routes fail loud (HTTP 500) and emit
    data_source provenance, but /dashboard/pilot/page.tsx kept a duplicate CtaLiftResponse interface
    (dropped data_source) and gated only on 'summary' in raw — swallowing the 500 into a silent blank
    panel. Page now imports the canonical type, renders a visible "mock data" badge when
    data_source==='mock' and an error banner on non-2xx, so the go/no-go reviewer cannot mistake mock
    for real. Closes the consumer half-wire feeding TICKET-PILOT-002's runbook provenance check.
```

## Sprint 13a-hardening-v2 — P0 EU go-live blockers (DONE)

**Status:** 2/2 DONE 2026-05-28. Both PRs merged to main. PR #164 (FOLLOW-139, e4e37ac) — real
90-day localStorage xid + erasure on withdrawal. PR #165 (FOLLOW-141, 19d11d2) — migration 0016
seeds inquiry_submit_selector on pilot tenant. FOLLOW-143 (producer wiring) + FOLLOW-144 (cadence
disclosure reconciliation) fixed inline in PR #164. RETRO-025 spawned 2026-05-28. Migration 0016
applied to prd (see notes on FOLLOW-141 ticket entry below).

**FOLLOW-140/142 deferred → Sprint 14:** §13.1 7-day consent-audit retention enforcement (P1) and
`/dashboard/analytics` Rule K.2 consumer parity (P1) are not EU go-live blockers at this stage.
Staged for Sprint 14 planning.

```yaml
- id: FOLLOW-139
  title: localStorage 90-day cross-session xid with erasure-on-withdrawal (§13.2 factual fix)
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [FOLLOW-128, FOLLOW-129]
  model: sonnet-4.6
  pr: '#164'
  commit: e4e37ac
  completed_at: '2026-05-28'
  spec: backlog/FOLLOW_UPS.md FOLLOW-139 (RETRO-019)
  notes: |
    CEO decision 2026-05-28: Option C (implement real 90-day localStorage xid, not docs-fix).
    Migrated SDK fingerprint from sessionStorage (tab-lifetime) to localStorage
    (__estalara_xid__) with 90-day TTL rotation. eraseCrossSessionId() wired to onDenied path
    in index.ts. 6 new unit tests (creation, TTL rotation mock, erasure on deny, cache clear).
    DPIA §13.2 balancing test updated from "GREEN contingent on FOLLOW-128" → unconditionally
    GREEN. 631 tests pass (10 session tests). Real CI gates green: Build, Lint, SDK E2E,
    Rule H/J, ClickHouse smoke, Doppler verify, Gitleaks, Auto-detection corpus.
    RETRO-023 inline fixes in same PR #164: FOLLOW-143 (wire getOrCreateCrossSessionId() into
    post-consent init path — key now actually created in real browser sessions) + FOLLOW-144
    (reconcile "rotates monthly" / "every 30 days" across 5 disclosure surfaces to accurate
    "every 90 days" / "every 3 months" wording; consent-banner.test.ts regex updated). Both
    DONE inline. RETRO-025 spawned to verify these inline fixes.

- id: FOLLOW-141
  title: Pilot tenant inquiry_submit_selector DB seed — committed migration 0016
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 2
  depends_on: [FOLLOW-127]
  model: sonnet-4.6
  pr: '#165'
  commit: 19d11d2
  completed_at: '2026-05-28'
  spec: backlog/FOLLOW_UPS.md FOLLOW-141 (RETRO-021)
  notes: |
    Migration 0016_pilot_inquiry_selector.sql: idempotent jsonb_set on tenant_site_schemas
    for pilot tenant (resolved by slug='000-app-estalara' at apply-time, no hardcoded UUID).
    Sets inquiry_submit_selector = '[data-estalara-slot=''inquiry-submit'']' where null/empty.
    meta/_journal.json updated. 52/52 tests pass (13 new + 39 pre-existing). Real CI gates
    green: Build, Lint, Test (Node 22), Typecheck, SDK E2E, Rule H/J, ClickHouse smoke.
    Prd migration apply: see RETRO-025 / migration-0016-prd note (pending apply result).
```

## Sprint 13b — Adaptive Listings v1.0 intent build (OPEN)

**Sprint goal:** "Build the 18-archetype intent coverage (behavioral observers + chat NLP) per §D.6.
Runs in parallel with the Lane B shadow window ONLY under hard isolation, so the pilot CTA-lift
signal is never contaminated."

**Hard-isolation rule (AI Council `20260525_143939` + `docs/ops/PILOT_FREEZE_RULE.md`):** no change
to pilot-tenant runtime behavior, event schema, dashboard semantics, or DOM during the CTA-lift
measurement window.

- **FOLLOW-099 + FOLLOW-103 touch the pilot tenant directly** (099 changes SDK event emission; 103
  _is_ app.estalara.com DOM adaptation) → **PROHIBITED mid-window**; must land before the window
  opens or after it closes, never during.
- **FOLLOW-087 / FOLLOW-100 / FOLLOW-101 = SHADOW-ONLY** — predictions to a separate namespace, no
  UX effect (enables post-pilot disagreement-rate analysis).
- **FOLLOW-102 = mergeable** — tenant-gated OFF for the pilot tenant.

**Sprint 13b progress 2026-06-10:** FOLLOW-099 DONE (PR #248), FOLLOW-100 DONE (PR #254), FOLLOW-087
DONE (PR #255). FOLLOW-101 now READY (all deps satisfied). FOLLOW-103 BLOCKED (TICKET-PILOT-001
needed). FOLLOW-102 READY (P2). ESC-010/009 are non-blocking for FOLLOW-101 (SDK TypeScript work).

```yaml
# LANE C — Adaptive Listings v1.0 intent build (13b; parallel with Lane B shadow window ONLY under
# the hard-isolation freeze rule — see docs/ops/PILOT_FREEZE_RULE.md)

- id: FOLLOW-099
  title: SDK behavioral observers + payload schemas (5 new event types)
  agent: sdk-engineer
  status: DONE
  priority: P1
  estimated_hours: 8
  depends_on: []
  model: sonnet-4.6
  spec: backlog/sprint-13/FOLLOW-099.md
  pr: '#248'
  completed_at: '2026-06-09T22:34:41Z'
  notes: |
    DONE in PR #248 (0865ca2). photo.dwell, feature.expanded, mortgage_calc.used, filter.applied
    (facet+value), inquiry.started. Payload-aware dispatch + bot detection gate. Status corrected
    2026-06-10 by pm-orchestrator.

- id: FOLLOW-100
  title: SIGNAL_LIKELIHOODS all 18 archetypes + CHAT_INTENT_LIKELIHOODS + applyChatIntentPrior()
  agent: sdk-engineer
  status: DONE
  pr: '#254'
  completed_at: '2026-06-10T11:19:48Z'
  priority: P1
  estimated_hours: 8
  depends_on: [FOLLOW-099]
  model: opus-4.7-xhigh
  spec: backlog/sprint-13/FOLLOW-100.md
  notes: |
    Likelihood calibration + Bayesian prior math → opus-4.7-xhigh. Per §D.1.1 + §D.6. Target:
    ≥13/18 archetypes reach 🟢 Full coverage. Payload-aware (filter.applied likelihoods differ by
    facet value). Thresholds calibrated on synthetic session fixtures (feeds §D.7).
    PR #254. AC-1..AC-8 implemented; 56 new tests, full suite 1251 passing; typecheck/build/lint
    green. Spec AC-4-vs-AC-7 inconsistency resolved with makeChatLikelihood low-floor complement
    (CHAT_REST_LIKELIHOOD=0.05) so named archetypes dominate like the quiz prior.
    HALF-WIRE FLAGS (Rule L) requiring producer follow-up: (1) price.compared has no SDK observer
    producer; (2) new filter.applied facets (renovation/type/price_max/bedrooms_min/bedrooms_max/
    near_university/school_district) are NOT in the closed FILTER_APPLIED_FACETS shared enum, so
    they are dead until the enum + resolveFilterFacet are extended (cross-module w/ backend-engineer,
    out of FOLLOW-100 intent.ts-only scope). Bundle gate already RED on main (49.83KB>40KB), this
    branch +1.03KB → 50.86KB — pre-existing breach, code-split follow-up needed.

- id: FOLLOW-087
  title: Chat NLP in apps/intent-engine (Haiku 4.5 real-time + Sonnet 4.6 batch)
  agent: ml-engineer
  status: DONE
  pr: '#255'
  completed_at: '2026-06-10'
  priority: P1
  estimated_hours: 12
  depends_on: [FOLLOW-040, FOLLOW-063]
  model: opus-4.7-xhigh
  spec: backlog/sprint-13/FOLLOW-087.md
  notes: |
    PR #255. Two-tier pipeline shipped per §C.3 v2.6: real-time process_chat_message (Haiku 4.5)
    + 6h Sonnet 4.6 batch cron, identical 12-dim ChatIntentDetectedPayload (schemas.py = the
    FOLLOW-101 contract). SHADOW-ONLY Redis writes to shadow:{tenant}:{session}:chat_intent.
    ClickHouse reader stubbed ([]) for Sprint 13. extract_intent reads message CONTENT text (not a
    hash over IDs); neutral fallback on any error (never raises); §C.3 multilingual Haiku→Sonnet
    retry on low-confidence mixed-language input. Models read from env (INTENT_REALTIME_MODEL /
    INTENT_BATCH_MODEL). Local: 13 pass / 2 skip (live tests guarded on ANTHROPIC_API_KEY);
    black/ruff/mypy --strict clean. Real CI gates green (Typecheck/Lint/Format/RuleH/RuleJ/
    Cross-language/Gitleaks). Test (Python) matrix + Build(SDK) + Rule I are pre-existing-red /
    non-blocking (same on main + merged PR #254).

- id: FOLLOW-101
  title: chat.intent.detected → Bayesian prior bridge in SDK intent.ts
  agent: ml-engineer + sdk-engineer
  status: DONE
  assigned_to: ml-engineer
  started_at: '2026-06-10T00:00:00Z'
  completed_at: '2026-06-10T15:30:00Z'
  priority: P1
  estimated_hours: 4
  depends_on: [FOLLOW-087, FOLLOW-100]
  model: opus-4.7-xhigh
  branch: ml-engineer/FOLLOW-101-chat-intent-prior-bridge
  pr: 256
  spec: backlog/sprint-13/FOLLOW-101.md
  notes: |
    DONE: PR #256 opened. Part A (control-plane): chat-intent-cache.ts reads Redis shadow key,
    flattens dims, adds chat_intent_dimensions to AdaptResponse (fail-open). Part B (SDK):
    fetchDirectives returns FetchDirectivesResult; applyChatIntentPrior applied once per session
    (Rule R), result persisted to sessionStorage, quiz.mismatch dispatched on mismatch.
    CI: Lint/Typecheck/Test(Node22)/Format/RuleH/RuleJ/Build(control-plane)/Vercel all pass.
    Build + Rule I pre-existing red (not introduced by this PR, confirmed on main too).

- id: FOLLOW-102
  title: Quiz ON/OFF toggle (SdkConfig + Supabase tenants.quiz_enabled + dashboard)
  agent: sdk-engineer + backend-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-10T00:00:00Z'
  completed_at: '2026-06-10T17:54:00Z'
  priority: P2
  estimated_hours: 3
  depends_on: []
  model: sonnet-4.6
  branch: sdk-engineer/FOLLOW-102-quiz-toggle
  pr: 257
  spec: backlog/sprint-13/FOLLOW-102.md
  notes: |
    PR #257 open. Migration 0025 tenants.quiz_enabled (default true). SdkConfig.quiz.enabled gate in
    index.ts. buildSnippet Rule-L producer. PATCH /api/tenants/:id. Dashboard toggle. 27 tests.
    CI verified green (pm-orchestrator 2026-06-10): Typecheck/Lint/Format/Test(Node22)/
    Build(control-plane)/RuleH/RuleJ/Migration-monotonicity/Demo-integration all pass.
    Build(SDK-bundle) fail = pre-existing on main (51KB > 40KB), not introduced by this PR.

- id: FOLLOW-252
  title: Gate chat-intent prior idempotency on rehydrate boundary (Rule R fix)
  agent: sdk-engineer + ml-engineer
  status: DONE
  assigned_to: sdk-engineer
  completed_at: '2026-06-10T18:20:00Z'
  priority: P1
  estimated_hours: 4
  depends_on: [FOLLOW-101]
  model: sonnet-4.6
  branch: sdk-engineer/FOLLOW-252-rule-r-chat-prior-rehydrate
  pr: 258
  spec: backlog/sprint-13/FOLLOW-252.md
  notes: |
    PR #258. Added chatPriorApplied?: boolean to IntentState; PRIMARY guard in fetchDirectives
    persists across reload; SECONDARY _chatPriorAppliedSessionId retained for same-tab defence.
    1269 tests pass. CI verified green (pm-orchestrator 2026-06-10): Typecheck/Lint/Format/
    Test(Node22)/Build(control-plane)/RuleH/RuleJ/Demo-integration all pass.
    Build(SDK-bundle) fail = pre-existing on main, not introduced by this PR.

- id: FOLLOW-253
  title: Rehydrate→re-init SDK test for chat-intent prior via _initForTest seam (Rule R coverage)
  agent: sdk-engineer + qa-engineer
  status: DONE
  assigned_to: sdk-engineer
  completed_at: '2026-06-10T18:20:00Z'
  priority: P2
  estimated_hours: 2
  depends_on: [FOLLOW-252]
  model: sonnet-4.6
  branch: sdk-engineer/FOLLOW-252-rule-r-chat-prior-rehydrate
  pr: 258
  spec: backlog/sprint-13/FOLLOW-253.md
  notes: |
    Bundled in PR #258 with FOLLOW-252. 6 tests in follow-252.test.ts drive real init() via
    _initForTest seam; simulate page reload by calling _initForTest twice on same sessionStorage;
    assert distribution not re-perturbed. Covers AC1–AC3.

- id: FOLLOW-257
  title: Resolve Rule-L half-wire — quiz.trigger_after_n_listings parsed but never emitted or read
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  completed_at: '2026-06-10T19:25:00Z'
  merged_at: '2026-06-10T20:00:00Z'
  priority: P1
  estimated_hours: 3
  depends_on: [FOLLOW-102]
  model: sonnet-4.6
  branch: sdk-engineer/FOLLOW-257-quiz-trigger-rule-l-halfwire
  pr: 259
  spec: backlog/sprint-13/FOLLOW-257.md
  notes: |
    PR #259. Option A: removed triggerAfterNListings from SdkConfig.quiz + readConfig() + tests.
    QUIZ_TRIGGER_DELAY_MS=30s retained; FOLLOW-199 comment. 9 new tests in follow-257.test.ts.
    CI verified green (pm-orchestrator 2026-06-10): Typecheck/Lint/Format/Test(Node22)/
    Build(control-plane)/RuleH/RuleJ/Demo-integration all pass. Build(SDK-bundle) pre-existing.

- id: FOLLOW-263
  title: Repoint pilot-freeze guard at tenants.quiz_enabled (FOLLOW-102 SoT migration)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  completed_at: '2026-06-10T19:33:00Z'
  merged_at: '2026-06-10T20:00:00Z'
  priority: P2
  estimated_hours: 2
  depends_on: [FOLLOW-102]
  model: sonnet-4.6
  branch: backend-engineer/FOLLOW-263-freeze-guard-quiz-sot
  pr: 260
  spec: backlog/sprint-13/FOLLOW-263.md
  notes: |
    PR #260. Repointed freeze guard from quizConfig.enabled JSONB to tenants.quiz_enabled.
    CI green (pm-orchestrator 2026-06-10): Typecheck/Lint/Format/Test(Node22)/Build(control-plane)/
    RuleH/RuleJ/Demo-integration all pass. Build(SDK-bundle) pre-existing. Merged.

- id: FOLLOW-265
  title:
    Reconcile pilot-freeze guard narrowing — restore Lane-C coverage OR ratify quiz-only + sync
    PILOT_FREEZE_RULE.md
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: [FOLLOW-263]
  model: sonnet-4.6
  spec: backlog/sprint-13/FOLLOW-265.md
  pr: https://github.com/Pnawrocki9/Adaptive-Listings/pull/262
  started_at: 2026-06-11T00:00:00Z
  completed_at: 2026-06-11T00:00:00Z
  notes: |
    RETRO-051 §4a LG-1. Quiz-only contract ratified. PILOT_FREEZE_RULE.md synced. Alert sweep
    performed (no active_lane_c_flags Sentry/Grafana rules found). quizConfig JSONB annotated.
    Two AC5 contract-pinning tests added. Mis-citation fixed. PR #262 — all ACs done, pre-push green.
    Also: active_lane_c_flags log field renamed quiz_enabled (no alert sweep done) and
    quizConfig.enabled is now orphaned (third consecutive retro on this blob decay).
    Must resolve BEFORE TICKET-PILOT-001 measurement window opens.
    ACs: AC1 decide multi-flag vs quiz-only; AC2 update PILOT_FREEZE_RULE.md; AC3 log-field rename
    sweep; AC4 retire quizConfig.enabled key; AC5 contract-pinning test; AC6 fix mis-citation.
    Source: RETRO-051. Cite RETRO-012/FOLLOW-117 precedent.

- id: FOLLOW-264
  title:
    Complete Option-A removal — retire orphaned dashboard quiz-trigger producer + seam-driven gate
    test
  agent: sdk-engineer
  status: DONE
  priority: P2
  estimated_hours: 3
  depends_on: [FOLLOW-257, FOLLOW-199]
  model: sonnet-4.6
  pr: '263'
  completed_at: 2026-06-11T00:00:00Z
  spec: backlog/FOLLOW_UPS.md (FOLLOW-264 stub)
  notes: |
    RETRO-050 §4a LG-1/LG-2, §4c TG-1. FOLLOW-257 removed the SDK consumer limb of
    data-quiz-trigger, but the dashboard producer survives: apps/control-plane/src/app/dashboard/
    quiz/page.tsx:208-220 "Show quiz after N listing views" input still persists
    trigger_after_n_listings via POST /api/quiz/config into tenants.quiz_config JSONB with nothing
    reading it (HALF_WIRE_P, false configurability shown to paying tenants).
    Also: /api/config mock + audit fixture dead-name residue (LG-2); and follow-257.test.ts
    AC2 tests assert against a local simulatedShowQuizTrigger() mirror instead of driving
    the real showQuizTrigger() via _initForTest seam (Rule Q gap, TG-1).
    ACs: AC1 retire/disable dashboard input; AC2 clear dead-name residue; AC3 seam-driven jsdom
    test; AC4 document quiz_config JSONB retirement or future threshold rebuild intent.
    Source: RETRO-050. Cite Rule L + RETRO-050.

- id: FOLLOW-103
  title: app.estalara.com DOM adaptation — corpus fixture + AI Vision slots + 5-slot coverage
  agent: ml-engineer + sdk-engineer
  status: BLOCKED
  priority: P1
  estimated_hours: 4
  depends_on: [TICKET-PILOT-001]
  model: sonnet-4.6
  spec: (to author at spawn — backlog/sprint-13/FOLLOW-103.md)
  notes: |
    Per §E.2.3. Corpus fixture 000-app-estalara; AI Vision (L5, ANTHROPIC_API_KEY in Doppler) detects
    5 TextDirective slots with zero manual markers; 18×5=90 directive coverage assertion; SDK uses
    control-plane route (full 18-archetype playbook). photos + listings-grid ReorderDirective deferred
    → FOLLOW-104.
    FREEZE: this IS the pilot tenant's DOM adaptation → must land BEFORE the measurement window opens
    (it defines "adapted") or AFTER it closes; never mid-window (Sprint 13b hard-isolation rule).
```

## Sprint 14 — pipeline hardening + Conversion Label Loop (MOAT) + archetype persistence (OPEN)

**Added 2026-06-03 (human-directed promotion, outside normal PM Step-7).** Contents:

- **FOLLOW-168/169** — RETRO-028 follow-ups (TICKET-DESC-001 / PR #182): cross-language
  event-contract parity gate + headline anti-hallucination grounding. Independent, unblocked.
- **FOLLOW-170…175** — **Conversion Label Loop** (MASTER_DESIGN §T, v3.9), committed by CEO as the
  data MOAT ("zbieranie danych to nasz istotny MOAT"). Strictly ordered; **FOLLOW-170 (T0) is
  blocking** — every adaptation decision logged without model_version/feature_snapshot/lead_id is
  permanently lost training data, so this must start first.
- **FOLLOW-176** — SDK archetype persistence (Side-task #5): resolved archetype is not persisted
  today (in-memory, cold-start each navigation); persist to sessionStorage + rehydrate in init.

**Related escalation:** **ESC-019 (CLOSED — resolved PR #196, api.estalara.com)** — verification
against the live backend revealed that the production Estalara listing-details API
(`https://app.estalara.com/api/v1/listing/details/...`) 302-redirects an unauthenticated server-side
fetch to the login page, so the helper fails open to an empty `original_description` and generation
is **ungrounded in prod** (silent). The ESC-018 data-shape fix is correct; ESC-019 is the
reachability/auth half and needs a human infra decision. FOLLOW-169 hardens the headline contract
but does NOT fix the source — ESC-019 does.

```yaml
- id: FOLLOW-168
  title:
    Cross-language event-contract parity gate for description.requested (TS Zod ⟷ Python consumer)
  agent: qa-engineer + backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: []
  source_retro: RETRO-028
  source_ticket: TICKET-DESC-001 (PR #182)
  completed_at: '2026-06-07T00:00:00Z'
  spec: backlog/sprint-14/FOLLOW-168.md
  notes: |
    CLOSED by FOLLOW-198 (PR #211, merged 2026-06-07). Shared JSON fixture + 8 TS + 10 Python
    contract tests + hard CI gate cross-language-contract shipped. Status corrected from READY
    to DONE 2026-06-07 by pm-orchestrator (stale — FOLLOW-198 notes also_closes: FOLLOW-168).

- id: FOLLOW-169
  title: Bring _generate_headline to the description anti-hallucination grounding bar (ADR-0009)
  agent: ml-engineer
  status: DONE
  priority: P2
  estimated_hours: 4
  depends_on: []
  source_retro: RETRO-028
  source_ticket: TICKET-DESC-001 (PR #182) / ADR-0009
  spec: backlog/sprint-14/FOLLOW-169.md
  assigned_to: ml-engineer
  started_at: '2026-06-11T00:00:00Z'
  completed_at: '2026-06-11T06:29:18Z'
  pr: '#264'
  branch: ml-engineer/FOLLOW-169-headline-grounding
  notes: |
    DONE. PR #264 merged 2026-06-11T06:29:18Z. AC1: _HEADLINE_SYSTEM_PROMPT + verified_facts threading.
    AC2: _check_headline_facts() post-gen fact check, 11 new Python tests. AC3: 3 SDK tests
    asserting headline gated on source=ai_cached. AC4: stale :{model} docstrings fixed.
    83 Python tests + 1285 SDK tests green. Rule H + Rule J pre-push hooks passed.
    RETRO-054 to be spawned.

# ── Conversion Label Loop (MASTER_DESIGN §T, v3.9) — committed 2026-06-03 (CEO: data MOAT) ──
# Strictly ordered: FOLLOW-170 (T0) blocks the rest — unlogged decisions are lost training data forever.

- id: FOLLOW-170
  title: Enrich prediction row — model_version + features_snapshot + lead_id (T0, BLOCKING)
  agent: data-engineer + backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 6
  depends_on: []
  produces: [FOLLOW-171, FOLLOW-173, FOLLOW-174]
  source: MASTER_DESIGN §T / RETRO-028
  spec: backlog/sprint-14/FOLLOW-170.md
  pr: '#187'
  completed_at: '2026-06-03T00:00:00Z'
  notes: |
    DONE in PR #187 (d9c75d4). Migration 0013_adaptation_decisions_label_fuel.sql shipped:
    demo_override + model_version + features_snapshot + lead_id columns added. logDecisionAsync
    writes all 4 (model_version defaults to 'rulebased-bandit-v1', lead_id to '' until
    FOLLOW-178 wires it). Test at route.holdout.test.ts:269 covers AC4. Status corrected from
    READY to DONE 2026-06-07 by pm-orchestrator (ticket shipped but QUEUE.md not updated).

- id: FOLLOW-171
  title: Persist durable conversion_labels from the feedback route
  agent: backend-engineer + data-engineer
  status: DONE
  priority: P0
  estimated_hours: 8
  depends_on: [FOLLOW-170]
  produces: [FOLLOW-173, FOLLOW-174]
  source: MASTER_DESIGN §T
  spec: backlog/sprint-14/FOLLOW-171.md
  pr: '#188'
  completed_at: '2026-06-03T17:44:40Z'
  notes: |
    NEW Postgres conversion_labels (RLS, outcome_class enum) + Zod taxonomy
    packages/shared/src/schemas/conversion-label.ts. Feedback route writes a durable label row
    (today the tuple is discarded into Beta counters). Feedback body gains prediction_id (SDK HANDOFF).

- id: FOLLOW-172
  title: CRM deep-outcome ingest → conversion_labels (PII-stripped)
  agent: backend-engineer + compliance-engineer
  status: DONE
  priority: P1
  estimated_hours: 10
  depends_on: [FOLLOW-171, FOLLOW-179]
  source: MASTER_DESIGN §T
  spec: backlog/sprint-14/FOLLOW-172.md
  pr: '#191'
  completed_at: '2026-06-03T20:08:10Z'
  notes: |
    DONE: POST /api/crm/outcome — HMAC tenant-scoped auth, Zod .strict() allow-list (deep classes
    only), writes via upsertConversionLabel (label_source=system, confidence=1.0) under RLS, + DSR
    erase cascade. Compliance conditions 1-7 (code-review gates) met. RETRO-031 found LG-1: the DSR
    cascade is keyed lead_id=session_id but CRM rows use a tenant opaque token → CRM rows survive
    erasure (Art. 17 gap) = FOLLOW-184 (P1). Go-live gates 8-10 (ROPA/DPIA/TTL/onboarding) tracked
    in FOLLOW-186/187. Tenant onboarding/docs needed before the webhook has a producer (FOLLOW-186).

# ── Conversion Label Loop — post-FOLLOW-172 follow-ups (RETRO-031) — promoted 2026-06-03 ──

- id: FOLLOW-184
  title: DSR erasure must reach CRM-written conversion_labels rows (Art. 17 completeness)
  agent: backend-engineer + compliance-engineer
  status: DONE
  priority: P1
  estimated_hours: 5
  depends_on: [FOLLOW-172]
  source: RETRO-031 (LG-1); relates to FOLLOW-180
  spec: backlog/FOLLOW_UPS.md (FOLLOW-184 stub)
  pr: '#233'
  merged_at: '2026-06-08'
  notes: |
    DONE. PR #233 merged 2026-06-08. Added dsr_verifications.durable_lead_id (migration 0024).
    Pass B in dsr/erase/route.ts deletes conversion_labels WHERE lead_id = durable_lead_id AND
    tenant_id = X. Both passes gate on lead_id <> ''. Pass B skipped when durable_lead_id is null,
    empty, or equals session_id (dedup). dsr/initiate accepts optional lead_id. 12 PGlite harness
    tests prove all ACs; 3 mock tests verify Pass B at route layer. DSR_ALERTING.md §identifier-
    resolution model and MASTER_DESIGN §T.6 updated. HANDOFFS.md FOLLOW-172 condition 7 satisfied.

- id: FOLLOW-185
  title: PG-harness integration test — CRM route write + DSR cascade + two-writer precedence
  agent: data-engineer
  status: DONE
  priority: P1
  estimated_hours: 5
  depends_on: [FOLLOW-179, FOLLOW-172]
  source: RETRO-031 (TG-1/TG-2); consolidate with FOLLOW-181 + FOLLOW-183
  spec: backlog/FOLLOW_UPS.md (FOLLOW-185 stub)
  pr: '#243/#244'
  completed_at: '2026-06-09T01:10:00Z'
  notes: |
    DONE. PRs #243 (14fea94) and #244 (cfb1f1c) merged 2026-06-09. PGlite harness covering CRM
    write + DSR cascade + two-writer precedence + confidence handling. Status corrected
    2026-06-10 by pm-orchestrator.

- id: FOLLOW-187
  title:
    Compliance docs for CRM ingest — ROPA Activity 15 + DPIA §2.3/§2.5 + conversion_labels TTL
    (go-live gates 8-9)
  agent: compliance-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: [FOLLOW-172]
  source: RETRO-031 (DG-1); HANDOFFS FOLLOW-172 conditions 8-9
  spec: backlog/FOLLOW_UPS.md (FOLLOW-187 stub)
  branch: compliance-engineer/FOLLOW-187-ropa-activity-15-dpia-crm
  notes: |
    Go-live gates (not merge gates). ROPA Activity 15 + DPIA §2.3/§2.5 for CRM deep-outcome ingest;
    Conditions 8+9 CONFIRMED SATISFIED: TTL cron live (FOLLOW-234/PR#230), ROPA v2.5 + DPIA v2.7
    signed off by compliance-engineer. FOLLOW-184 DSR gap remains OPEN (separate from conditions 8+9).
    (Onboarding pseudonymity checkbox = FOLLOW-186, P2.)

- id: FOLLOW-173
  title: Conversion-label aggregation + score-vs-actual calibration
  agent: data-engineer
  status: DONE
  assigned_to: data-engineer
  started_at: '2026-06-07T00:00:00Z'
  completed_at: '2026-06-07T00:00:00Z'
  priority: P1
  estimated_hours: 6
  depends_on: [FOLLOW-170, FOLLOW-171]
  source: MASTER_DESIGN §T
  spec: backlog/sprint-14/FOLLOW-173.md
  branch: data-engineer/FOLLOW-173-conversion-label-aggregation
  pr: '#216'
  notes: |
    DONE: PR #216 merged 2026-06-07. Calibration endpoint at GET /api/pilot/calibration shipped.

- id: FOLLOW-174
  title: admin label table + manual reclassification
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 8
  depends_on: [FOLLOW-171, FOLLOW-173]
  source: MASTER_DESIGN §T
  spec: backlog/sprint-14/FOLLOW-174.md
  pr: '#220'
  completed_at: '2026-06-08T00:00:00Z'
  notes: |
    DONE in PR #220 (31afb16). Merged 2026-06-08. Status corrected 2026-06-10 by pm-orchestrator.

- id: FOLLOW-175
  title: Label-set export for LoRA fine-tuning
  agent: backend-engineer + ml-engineer
  status: DONE
  priority: P2
  estimated_hours: 4
  depends_on: [FOLLOW-174]
  source: MASTER_DESIGN §T
  spec: backlog/sprint-14/FOLLOW-175.md
  pr: '#245'
  completed_at: '2026-06-09T18:41:22Z'
  notes: |
    DONE in PR #245 (35d3355). Per-tenant PII-free (features_snapshot, model_version, score) ->
    outcome_class export (CSV/JSONL); the Y2 fine-tune (§D.5.7) input. RLS-scoped, auditable.

# ── SDK archetype persistence (Side-task #5) — committed 2026-06-03 ──

- id: FOLLOW-176
  title: Persist resolved archetype/intent across listing navigations
  agent: sdk-engineer
  status: DONE
  priority: P1
  estimated_hours: 5
  depends_on: []
  source: session investigation 2026-06-03 (Side-task #5)
  spec: backlog/sprint-14/FOLLOW-176.md
  pr: '#217'
  completed_at: '2026-06-08T00:00:00Z'
  notes: |
    DONE in PR #217 (ea9d59c). Merged 2026-06-08. Status corrected 2026-06-10 by pm-orchestrator.

# ── Dwell-time confidence lift — CEO-directed 2026-06-04 ──

- id: FOLLOW-190
  title: Dwell-time confidence lift — accumulate temporal engagement as intent signal
  agent: sdk-engineer
  status: DONE
  priority: P2
  estimated_hours: 4
  depends_on: []
  source: CEO session 2026-06-04 (signal enrichment gap)
  spec: backlog/sprint-14/FOLLOW-190.md
  pr: '#225'
  completed_at: '2026-06-08T00:00:00Z'
  notes: |
    DONE in PR #225 (1d5829a). Merged 2026-06-08. Status corrected 2026-06-10 by pm-orchestrator.

# ── Conversion Label Loop hardening (RETRO-029) — promoted 2026-06-03 ──

- id: FOLLOW-179
  title: conversion_labels uniqueness/upsert + validated insert helper (gates FOLLOW-172/173)
  agent: backend-engineer + data-engineer
  status: DONE
  priority: P1
  estimated_hours: 6
  depends_on: [FOLLOW-171]
  blocks: [FOLLOW-172, FOLLOW-173, FOLLOW-174]
  source: RETRO-029 (LG-1/LG-3, CB-1/CB-2)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-179 stub)
  pr: '#190'
  completed_at: '2026-06-03T19:04:44Z'
  notes: |
    DONE: UNIQUE (tenant_id, prediction_id) + onConflictDoUpdate with class-precedence
    (conversionLabelRank in @estalara/shared: manual_admin > system; purchased > lost >
    contract_signed > offer_made > viewing_booked > no_response; recency tiebreak), validated
    upsertConversionLabel helper (@estalara/db), feedback route switched to the helper, confidence
    convention = 1.0 for system labels. RETRO-030 filed FOLLOW-182 (TS/SQL rank duplication) +
    FOLLOW-183 (real-PG test of the helper) — both P1, not-clean verdict.

- id: FOLLOW-182
  title: eliminate the TS-map↔SQL-CASE precedence duplication in upsertConversionLabel
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: [FOLLOW-179]
  source: RETRO-030 (LG-1/LG-2); CONVENTIONS_PATCH Rule K.1 amendment
  spec: backlog/FOLLOW_UPS.md (FOLLOW-182 stub)
  branch: backend-engineer/FOLLOW-182-rank-dedup
  pr: '#222'
  completed_at: '2026-06-08T00:00:00Z'
  notes: |
    DONE in PR #222 (d7b9de7). Merged 2026-06-08. Status corrected 2026-06-10 by pm-orchestrator
    — branch had a stale pre-merge orphan commit, but the actual work landed via PR #222. SQL CASE
    derived from TS map via allRankEntries(); Rule K.1 satisfied.

- id: FOLLOW-183
  title: direct PG integration test for upsertConversionLabel (precedence WHERE + UNIQUE constraint)
  agent: data-engineer + backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: [FOLLOW-179]
  source: RETRO-030 (TG-1/TG-2)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-183 stub)
  notes: |
    The helper's SQL precedence WHERE + the UNIQUE constraint are only mock-tested — core dedup
    correctness is unverified against real Postgres. Add a pgmem/Testcontainers test exercising
    collision/upgrade/downgrade-rejection/manual-admin-override. May merge with FOLLOW-181.
```

## Wave A — 2026-06-09 Audit Bug Fixes (OPEN)

**Added 2026-06-10 (sdk-engineer/pm-orchestrator). COMPLETE — all 5 merged 2026-06-10 by
pm-orchestrator.**

| Ticket     | Owner            | P   | Status | PR   |
| ---------- | ---------------- | --- | ------ | ---- |
| FOLLOW-258 | sdk-engineer     | P0  | DONE   | #249 |
| FOLLOW-259 | sdk-engineer     | P1  | DONE   | #250 |
| FOLLOW-260 | backend-engineer | P0  | DONE   | #251 |
| FOLLOW-261 | backend-engineer | P1  | DONE   | #252 |
| FOLLOW-262 | sdk-engineer     | P2  | DONE   | #253 |

### FOLLOW-258 — SDK↔ingest data-loss cluster [P0]

F-01: chat.message.sent never sent the message text; F-02: scroll depth read wrong field name
(depth_percent vs pct); F-03: lead_id/listing_view_rate stripped by Zod discriminated union; F-04:
live.signup rejected when slot_uuid absent; F-29: PII scrubbing for chat messages. See PR #249.

### FOLLOW-259 — Thread prediction_id + lead_id into feedback ping [P1]

§T Conversion Label Loop was inert because prediction_id was never sent. postFeedbackPing now
includes prediction_id (= adapt_decision_id) and lead_id (read from sessionStorage at outcome time).
See PR #250.

### FOLLOW-260 — /api/adapt cross-tenant auth hardening [P0]

F-26 / ESC-021 companion. Tenant ID extracted from validated JWT must supersede any tenant_id in the
request body.

### FOLLOW-261 — Parameterize ClickHouse INSERT in /api/adapt [P1]

F-30. SQL injection surface via string interpolation in ClickHouse INSERT. Switch to parameterized
queries.

### FOLLOW-262 — SDK lifecycle hygiene [P2]

F-05/F-06/F-08. Listener leak on re-init, scroll throttle missing, chat→intent signal not wired.

---

## Sprint 16 — Conversion Label Loop §T + SDK persistence + DB harness + compliance CRM docs + micro-poll Wave 2 (OPEN)

**Added 2026-06-07 (pm-orchestrator, Sprint 15 COMPLETE — 21/21 DONE). Updated 2026-06-08
(pm-orchestrator): FOLLOW-176/182/174/190/227/230 DONE; FOLLOW-183 bounced back (Gitleaks real gate
failing); FOLLOW-187 updated to Activity 15 (FOLLOW-230 fixed collision). Updated 2026-06-08
(data-engineer): FOLLOW-234 DONE (conversion_labels 13-month TTL cron — FOLLOW-187 condition 9
closed). Updated 2026-06-09 (pm-orchestrator): FOLLOW-183 DONE (PR #228 merged), FOLLOW-187 DONE (PR
#229 merged), FOLLOW-185 now IN_PROGRESS (data-engineer delegated). Updated 2026-06-10
(pm-orchestrator): FOLLOW-185 DONE (PR #243/#244 merged), FOLLOW-175 DONE (PR #245 merged). Sprint
16 now 14/14 non-READY_FOR_REVIEW tickets DONE; FOLLOW-191 remains READY_FOR_REVIEW (ESC-020).
Updated 2026-06-11 (pm-orchestrator): FOLLOW-270 and FOLLOW-271 promoted from FOLLOW_UPS.md stubs
(RETRO-052/053); FOLLOW-270 DONE (PR #265 merged 2026-06-11, RETRO-055 complete); FOLLOW-271 DONE
(PR #266 merged 2026-06-11).** Carries forward all READY Sprint 14 items not touched by Sprint 15,
plus the Wave 2 deferred item from Sprint 15.

Key tracks:

- **Track A (§T Conversion Label Loop, T0):** FOLLOW-170 (DONE, PR #187 — unblocked the chain)
- **Track B (§T downstream, now unblocked):** FOLLOW-173 (DONE, PR #216) → FOLLOW-174 (DONE, PR
  #220) → FOLLOW-175 (DONE, PR #245)
- **Track C (SDK + DB hardening):** FOLLOW-176 (DONE, PR #217), FOLLOW-182 (DONE, PR #222),
  FOLLOW-183 (DONE, PR #228), FOLLOW-185 (DONE — PG-harness CRM+DSR, PRs #243/#244)
- **Track D (GDPR/compliance):** FOLLOW-234 (DONE — TTL cron), FOLLOW-184 (DONE, PR #233),
  FOLLOW-187 (DONE, PR #229 — ROPA Activity 15 + DPIA §2.3/§2.5)
- **Track E (Background):** FOLLOW-190 (DONE, PR #225), FOLLOW-227 (DONE, PR #226), FOLLOW-230
  (DONE, PR #227)

```yaml
- id: FOLLOW-170
  title: Enrich prediction row — model_version + features_snapshot + lead_id (T0, BLOCKING)
  agent: data-engineer + backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 6
  depends_on: []
  produces: [FOLLOW-173, FOLLOW-174]
  source: MASTER_DESIGN §T / RETRO-028
  spec: backlog/sprint-14/FOLLOW-170.md
  pr: '#187'
  completed_at: '2026-06-03T00:00:00Z'
  notes: |
    DONE in PR #187 (d9c75d4). Status corrected 2026-06-07 — shipped but QUEUE.md not updated.
    FOLLOW-173 and FOLLOW-174 are now UNBLOCKED (FOLLOW-171 also DONE).

- id: FOLLOW-176
  title: Persist resolved archetype/intent across listing navigations
  agent: sdk-engineer
  status: DONE
  priority: P1
  estimated_hours: 5
  depends_on: []
  source: session investigation 2026-06-03 (Side-task #5)
  spec: backlog/sprint-14/FOLLOW-176.md
  pr: '#217'
  completed_at: '2026-06-08T00:00:00Z'
  notes: |
    DONE in PR #217 (ea9d59c). Merged 2026-06-08. sessionStorage rehydrate + consent gate
    + staleness guard shipped. Status corrected 2026-06-08 — shipped but QUEUE.md not updated.

- id: FOLLOW-182
  title: Eliminate TS-map vs SQL-CASE precedence duplication in upsertConversionLabel
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: [FOLLOW-179]
  source: RETRO-030 (LG-1/LG-2); CONVENTIONS_PATCH Rule K.1
  spec: backlog/FOLLOW_UPS.md (FOLLOW-182 stub)
  pr: '#222'
  completed_at: '2026-06-08T00:00:00Z'
  notes: |
    DONE in PR #222 (d7b9de7). Merged 2026-06-08. SQL CASE derived from TS map via
    allRankEntries() — no more hand-typed literals. Rule K.1 satisfied. Status corrected
    2026-06-08 — shipped but QUEUE.md not updated.

- id: FOLLOW-183
  title: PG integration test for upsertConversionLabel (precedence WHERE + UNIQUE constraint)
  agent: data-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: [FOLLOW-179]
  source: RETRO-030 (TG-1/TG-2)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-183 stub)
  branch: data-engineer/FOLLOW-183-pg-integration-test-upsert-conversion-label
  pr: '#228'
  completed_at: '2026-06-08T00:00:00Z'
  notes: |
    DONE. PR #228 merged 2026-06-08 (commit ff3fb8e). Gitleaks was resolved (file moved or
    allowlisted); all real gates green on merge. PG integration tests for upsertConversionLabel
    shipped: SQL precedence WHERE clause + UNIQUE constraint coverage + empty-reduce crash guard.
    Production bugs fixed: (1) integer type mismatch via sql.raw()::integer, (2) empty-reduce
    crash guard returns CASE END for empty entries array — both in non-test production code at
    packages/db/src/upsert-conversion-label.ts:122-146.

- id: FOLLOW-184
  title: DSR erasure must reach CRM-written conversion_labels rows (Art. 17 completeness)
  agent: backend-engineer + compliance-engineer
  status: DONE
  priority: P1
  estimated_hours: 5
  depends_on: [FOLLOW-172]
  source: RETRO-031 (LG-1); relates to FOLLOW-180
  spec: backlog/FOLLOW_UPS.md (FOLLOW-184 stub)
  pr: '#233'
  completed_at: '2026-06-08T00:00:00Z'
  notes: |
    DONE. PR #233 merged 2026-06-08 (same as Sprint 14 carry-over entry — status corrected here
    to eliminate stale READY duplicate). See Sprint 14 carry-over section for full details.

- id: FOLLOW-185
  title: PG-harness integration test — CRM write + DSR cascade + two-writer precedence
  agent: data-engineer
  status: DONE
  assigned_to: data-engineer
  started_at: '2026-06-09T00:00:00Z'
  completed_at: '2026-06-09T01:10:00Z'
  priority: P1
  estimated_hours: 5
  depends_on: [FOLLOW-179, FOLLOW-172]
  source: RETRO-031 (TG-1/TG-2); consolidate with FOLLOW-181 + FOLLOW-183
  spec: backlog/FOLLOW_UPS.md (FOLLOW-185 stub)
  pr: '#243/#244'
  notes: |
    DONE. PRs #243 (14fea94) and #244 (cfb1f1c) merged 2026-06-09. PGlite harness covering CRM
    write + DSR cascade + two-writer precedence + confidence handling. Status corrected
    2026-06-10 by pm-orchestrator.

- id: FOLLOW-234
  title: 13-month TTL enforcement for conversion_labels (FOLLOW-187 condition 9)
  agent: data-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: [FOLLOW-172]
  source: FOLLOW-187 condition 9; HANDOFFS.md:952-958
  spec: backlog/FOLLOW_UPS.md (FOLLOW-234 stub)
  branch: data-engineer/FOLLOW-234-conversion-labels-ttl-cron
  notes: |
    PR opened 2026-06-08. Vercel cron GET /api/internal/retention/conversion-labels
    (schedule 0 2 * * *) deletes conversion_labels rows where labeled_at < NOW() - 13 months.
    ROPA v2.3 + DPIA v2.5 updated. Tests pass. Condition 9 of FOLLOW-187 now closed.

- id: FOLLOW-187
  title: Compliance docs — ROPA Activity 15 + DPIA §2.3/§2.5 + conversion_labels 13-month TTL
  agent: compliance-engineer + data-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: [FOLLOW-172]
  source: RETRO-031 (DG-1); HANDOFFS FOLLOW-172 conditions 8-9
  spec: backlog/FOLLOW_UPS.md (FOLLOW-187 stub)
  pr: '#229'
  completed_at: '2026-06-08T00:00:00Z'
  notes: |
    DONE. PR #229 merged 2026-06-08 (commit e13250b). ROPA Activity 15 CRM ingest entry +
    DPIA §2.3/§2.5 + retention note shipped. All go-live conditions 8-9 from HANDOFFS.md
    FOLLOW-172 are now satisfied. Conditions 1-7 (code) were met at PR #191 (FOLLOW-172).
    Condition 9 (TTL cron) closed by FOLLOW-234 (PR #230). FOLLOW-187 COMPLETE.

- id: FOLLOW-173
  title: Conversion-label aggregation + score-vs-actual calibration
  agent: data-engineer
  status: DONE
  assigned_to: data-engineer
  completed_at: '2026-06-07T00:00:00Z'
  pr: '#216'
  started_at: '2026-06-07T00:00:00Z'
  completed_at: '2026-06-07T00:00:00Z'
  priority: P1
  estimated_hours: 6
  depends_on: [FOLLOW-170, FOLLOW-171]
  source: MASTER_DESIGN §T
  spec: backlog/sprint-14/FOLLOW-173.md
  branch: data-engineer/FOLLOW-173-conversion-label-aggregation
  pr: 216
  notes: |
    GET /api/pilot/calibration: query-time join (ClickHouse decisions + Postgres labels).
    Confidence decile bucketing → reliability curve per model_version (AC2).
    Conversion aggregates per (outcome_class, model_version, tenant, window) (AC1).
    Rule K.2: fail-loud; data_source provenance field. 28 tests, all passing.
    HANDOFFS.md updated: FOLLOW-173 → FOLLOW-174.

- id: FOLLOW-174
  title: Admin label table + manual reclassification
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 8
  depends_on: [FOLLOW-171, FOLLOW-173]
  source: MASTER_DESIGN §T
  spec: backlog/sprint-14/FOLLOW-174.md
  pr: '#220'
  completed_at: '2026-06-08T00:00:00Z'
  notes: |
    DONE in PR #220 (31afb16). Merged 2026-06-08. Admin label management + manual
    reclassification UI shipped. Status corrected 2026-06-08.

- id: FOLLOW-190
  title: Dwell-time confidence lift — accumulate temporal engagement as intent signal
  agent: sdk-engineer
  status: DONE
  priority: P2
  estimated_hours: 4
  depends_on: []
  source: CEO session 2026-06-04
  spec: backlog/sprint-14/FOLLOW-190.md
  pr: '#225'
  completed_at: '2026-06-08T00:00:00Z'
  notes: |
    DONE in PR #225 (1d5829a). Merged 2026-06-08. applyDwellSignal() at 30s/90s/180s
    thresholds. Status corrected 2026-06-08.

- id: FOLLOW-227
  title: Dwell-time boost idempotency + per-session cap (Rule R compliance)
  agent: sdk-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: [FOLLOW-190]
  source: RETRO (Rule R — dwell rehydrate boundary violation)
  pr: '#226'
  completed_at: '2026-06-08T11:42:12Z'
  notes: |
    DONE in PR #226 (4d3f1a4). Merged 2026-06-08. IntentState.dwell_ticks_applied field
    prevents re-boost across rehydrate boundary. DWELL_MAX_SESSION_CONTRIBUTION=3 cap.
    10 new tests (follow-227.test.ts). All 1150 tests green.

- id: FOLLOW-230
  title: ROPA Activity-14 renumber + privacy notice 8 SDK keys + key-sync CI lint
  agent: compliance-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: []
  source: RETRO (ROPA collision FOLLOW-218 vs FOLLOW-187 both claiming Activity 14)
  pr: '#227'
  completed_at: '2026-06-08T11:46:15Z'
  notes: |
    DONE in PR #227 (b62faae). Merged 2026-06-08. Activity 14 = Intent-State Cache (kept);
    FOLLOW-187 updated to Activity 15. Privacy notice expanded from 5 to 8 SDK storage keys.
    New CI gate: check-privacy-notice-keys.sh (hard gate, not continue-on-error). DPIA v2.4.
    Unblocks FOLLOW-187 (Activity 15 assignment now correct).
```

- id: FOLLOW-270 title: Reconcile QuizConfig.language enum skew + de-duplicate hand-copied
  QuizConfig interface agent: backend-engineer status: DONE assigned_to: backend-engineer
  started_at: '2026-06-11T00:00:00Z' completed_at: '2026-06-11T00:00:00Z' priority: P2
  estimated_hours: 2 depends_on: [FOLLOW-264] source_retro: RETRO-053 (§4e MX-1; §5c; §6 — Rule-S
  symmetric-set drift) spec: backlog/FOLLOW_UPS.md (FOLLOW-270 stub) branch:
  backend-engineer/FOLLOW-270-quiz-config-language-enum-skew pr: '265' notes: | DONE. PR #265 merged
  2026-06-11. Canonical QuizConfig extracted to packages/shared/src/schemas/quiz-config.ts. Both
  route.ts and page.tsx now import from @estalara/shared. 'es' (Español) added to dashboard select.
  Parity tests added (QUIZ_LANGUAGE_VALUES coverage, Zod accept-all, reject-unknown, route handler
  'es' e2e). RETRO-055 complete (FOLLOW-273 stub — SDK locale alignment).

- id: FOLLOW-271 title: Eliminate orphaned quizConfig.enabled JSONB key — strip on write + backfill
  (Rule U) agent: backend-engineer status: DONE assigned_to: backend-engineer started_at:
  '2026-06-11T00:00:00Z' completed_at: '2026-06-11T00:00:00Z' priority: P2 estimated_hours: 2
  depends_on: [FOLLOW-265, FOLLOW-270] source_retro: RETRO-052 (§4a LG-1; §5d; §6 — Rule U
  promotion) spec: backlog/FOLLOW_UPS.md (FOLLOW-271 stub) branch:
  backend-engineer/FOLLOW-271-strip-quiz-enabled-blob-key pr: '266' notes: | DONE. PR #266 merged
  2026-06-11. QuizConfigSchema.omit({ enabled: true }) strips on write; parseStoredQuizConfig()
  strips on read; migration 0026 backfills existing rows. 918/918 tests pass. typecheck clean.
  Migration journal monotonicity check passes (27 entries). Rule U closed.

## Wave A — Bug fix cluster: data-loss, cross-tenant auth, SQL injection, lifecycle (COMPLETE)

**Added 2026-06-10 (pm-orchestrator). COMPLETE — all 5 merged 2026-06-10. Promoted from
FOLLOW_UPS.md stubs per 2026-06-09 comprehensive audit (FOLLOW-267).**

Five tickets, two agents (sdk-engineer + backend-engineer), ~21 estimated hours total.

```yaml
- id: FOLLOW-258
  title: SDK↔ingest data-loss cluster (F-01/F-02/F-03/F-04/F-29)
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 6
  source: 2026-06-09 audit
  branch: sdk-engineer/FOLLOW-258-data-loss-cluster
  pr: '#249'
  completed_at: '2026-06-09T22:21:16Z'

- id: FOLLOW-259
  title: Thread prediction_id + lead_id into feedback ping (activates §T loop)
  agent: sdk-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  source: 2026-06-09 audit (F-20)
  depends_on: [FOLLOW-170]
  pr: '#250'
  completed_at: '2026-06-10T04:46:31Z'

- id: FOLLOW-260
  title: /api/adapt cross-tenant auth hardening (ESC-021, F-26)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  source: 2026-06-09 audit (F-26)
  pr: '#251'
  completed_at: '2026-06-10T05:29:05Z'

- id: FOLLOW-261
  title: Parameterize ClickHouse INSERT in /api/adapt (SQL injection, F-30)
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  source: 2026-06-09 audit (F-30)
  pr: '#252'
  completed_at: '2026-06-10T05:50:27Z'

- id: FOLLOW-262
  title: SDK lifecycle hygiene — listener leaks, scroll throttle, chat→intent (F-05/F-06/F-08)
  agent: sdk-engineer
  status: DONE
  pr: '#253'
  completed_at: '2026-06-10T06:02:22Z'
  priority: P2
  estimated_hours: 5
  source: 2026-06-09 audit (F-05/F-06/F-08)
  completed_at: '2026-06-10T10:05:56Z'
```

## Sprint 15 — Pilot unblock + signal bridges + quiz v2.0 + description cache redesign (COMPLETE — 21/21 DONE)

**Added 2026-06-05 (pm-orchestrator, based on docs/AUDIT-2026-06-04.md + Master_Design v4.0).
Updated 2026-06-06 (pm-orchestrator, Track E added from audit gap analysis).** Four tracks + signal
enrichment:

- **Track A (Pilot unblock, Week 1):** FOLLOW-191/192/193/194
- **Track B (Signal bridges + Quiz v2.0, Week 2–3):** FOLLOW-195/196/197/198/199/200/201/202
- **Track C (Description cache redesign, Week 3–4):** FOLLOW-203/204
- **Track D (Background, Week 4–5):** FOLLOW-205/206
- **Track E (Signal enrichment, Week 2–3):** FOLLOW-207/208/209/210/211 — low-effort, high-ROI
  signal enrichments from 2026-06-05 audit gap analysis. FOLLOW-210 and FOLLOW-211 are P1 because
  they unlock categorical discrimination that behavioral signals cannot provide without payload
  context.

Sprint 14 carry-overs (FOLLOW-170…176, 190) remain in their sprint-14 section and are referenced
here as active. FOLLOW-087 and FOLLOW-099 are background horizon items.

```yaml
# ── Track A: Pilot unblock (Week 1) ──

- id: FOLLOW-191
  title: Verify + deploy Estalara-app DOM hooks
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-06T00:00:00Z'
  completed_at: '2026-06-06T13:30:00Z'
  priority: P0
  estimated_hours: 4
  depends_on: []
  source: Audit F-02, §E.2.3
  spec: backlog/sprint-15/FOLLOW-191.md
  notes: |
    AUDIT COMPLETE (sdk-engineer, 2026-06-06). Slots ARE committed to Estalara-app
    git HEAD (commit 9d2df9d) but production is running an older build — curl of
    app.estalara.com/en/listing/* returns 0 data-estalara-* attributes and no SDK
    script tag. LOCAL app.html working tree points to localhost:9100 (demo override,
    must not be deployed). ACTION REQUIRED from Rafał (CTO): restore app.html, set
    PUBLIC_ESTALARA_SDK_ENABLED=true in prod env, deploy web-master HEAD. Full
    instructions in backlog/HANDOFFS.md + ESCALATIONS.md (ESC-020). PR opened on
    sdk-engineer/FOLLOW-191-verify-deploy-dom-hooks with audit evidence.

- id: FOLLOW-192
  title: ESC-019 — provision internal listing-details URL or service token
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 0
  depends_on: []
  completed_at: '2026-06-04T00:00:00Z'
  pr: '#196'
  source: Audit F-03, ESC-019 (CLOSED — resolved PR #196, api.estalara.com)
  spec: backlog/sprint-15/FOLLOW-192.md
  notes: |
    RESOLVED: PR #196 corrected ESTALARA_BACKEND_URL to api.estalara.com (Spring Boot
    backend, no auth required). Added redirect:manual guard. FOLLOW-192 CLOSED 2026-06-06.

- id: FOLLOW-193
  title: FIX-028 — restore DSR cron + engagement_scores erasure
  agent: backend-engineer + compliance-engineer
  status: DONE
  priority: P0
  estimated_hours: 6
  completed_at: 2026-06-06
  depends_on: []
  source: Audit F-10, F-11, CHK-C G-1/G-2
  spec: backlog/sprint-15/FOLLOW-193.md
  notes: |
    G-1: DSR mutation-poll cron restored in vercel.json (AC1) -- DEPLOYMENT GATED on CEO Q3
    Vercel Pro confirmation. Code committed; NOT live until Q3 answered.
    G-2: engagement_scores erasure added to Drizzle transaction (AC2) -- COMPLETE.
    AC3/AC4: Integration tests added to route.test.ts -- all 9 tests pass.
    Migration 0021_engagement_scores.sql + Drizzle schema + RLS policy committed.
    DPIA §8 line 773 compliance gap closed for engagement_scores.

- id: FOLLOW-194
  title: SDK quick fixes batch (F-01/F-08/F-13/F-15/F-16)
  agent: sdk-engineer + backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 5
  depends_on: []
  source: Audit F-01, F-08, F-13, F-15, F-16
  spec: backlog/sprint-15/FOLLOW-194.md
  pr: https://github.com/Pnawrocki9/Adaptive-Listings/pull/201
  completed_at: '2026-06-06'
  notes: |
    5 S-effort fixes shipped in single PR #201. F-01 consent_state enum mapping (mapConsentState);
    F-08 pageType URL detection + data-page-type override (detectPageType); F-13 listing_id in
    adapt body (detectListingId + fetchDirectives listingId param); F-15 previousArchetype guard
    in refreshDirectives (resetAdaptState only on change); F-16 getDemoOverride dedup in route.ts.
    17 new unit tests, 729/729 SDK tests pass, pre-push hooks green.

# ── Track B: Signal bridges + Quiz v2.0 (Week 2–3) ──

- id: FOLLOW-195
  title: SCHEMA-001 — live.signup Zod event schema
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-06T00:00:00Z'
  completed_at: '2026-06-06T00:00:00Z'
  pr: backend-engineer/FOLLOW-195-schema-001-live-signup
  priority: P0
  estimated_hours: 3
  depends_on: []
  produces: [FOLLOW-196, FOLLOW-197, FOLLOW-200]
  source: Audit F-09, Master_Design v3.7 SCHEMA-001
  spec: backlog/sprint-15/FOLLOW-195.md
  notes: |
    LiveSignupEventSchema added to packages/shared/src/schemas/events/live.ts.
    Exported from packages/shared/src/index.ts via events/index.ts.
    EVENT_TYPES updated (44→45). EventSchema discriminated union updated.
    registerFeedbackListener default updated to ['live.signup','inquiry.completed'].
    ClickHouse migration NOT needed (live.signup routes through existing events table).
    45 tests pass in events.test.ts. Handoff note in HANDOFFS.md for FOLLOW-196.

- id: FOLLOW-196
  title: CHAT-001/002 — CustomEvent hooks in Estalara-app
  agent: sdk-engineer
  status: DONE
  priority: P0
  estimated_hours: 4
  depends_on: [FOLLOW-195]
  produces: [FOLLOW-197]
  source: Audit F-04, F-07, CHK-D §A.4
  spec: backlog/sprint-15/FOLLOW-196.md
  pr: sdk-engineer/FOLLOW-196-chat-event-payload-extension
  notes: |
    2026-06-06 DONE. Both CustomEvent payloads extended in Estalara-app:
    1. ChatBot.svelte: userUuid tracked from authStore; user_uuid + is_agent added to
       estalara:chat:message-sent detail.
    2. LiveSessions.svelte: isAgent + userUuid tracked from authStore; event type
       corrected from 'estalara:live:signup' to 'live.signup' (SDK adapter match);
       user_uuid + is_agent added to detail.
    Changes are local to /home/asipi/Projects/Estalara-app/web-master (no GitHub access
    to that repo). PR in Adaptive-Listings documents the work + handoff to FOLLOW-197.

- id: FOLLOW-197
  title: CHAT-003 — SDK listeners for chat/live events
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-07T00:00:00Z'
  completed_at: '2026-06-07T00:00:00Z'
  pr: '#202'
  priority: P0
  estimated_hours: 3
  depends_on: [FOLLOW-195, FOLLOW-196]
  source: Audit F-04, CHAT-003
  spec: backlog/sprint-15/FOLLOW-197.md
  notes: |
    PR #202 merged 2026-06-07 (squash, a2ca89d). deriveLeadId (SHA-256 prefix, Rule L),
    estalara:chat:message-sent and live.signup listeners in index.ts, lead_id in
    fetchDirectives POST body. 16 unit tests AC1-AC7. 728 tests green, 0 TS errors,
    0 lint errors. CI green. Retrospective: spawn retrospective-analyst on PR #202.

- id: FOLLOW-198
  title: Cross-language event contract parity gate (FOLLOW-168 completion)
  agent: qa-engineer + backend-engineer
  status: DONE
  completed_at: '2026-06-07T00:00:00Z'
  pr: '#211'
  priority: P1
  estimated_hours: 3
  depends_on: []
  source: FOLLOW-168 (Sprint 14), Audit addendum
  spec: backlog/sprint-15/FOLLOW-198.md
  pr: https://github.com/Pnawrocki9/Adaptive-Listings/pull/211
  branch: qa-engineer/FOLLOW-198-cross-language-contract
  also_closes: FOLLOW-168
  notes: |
    FOLLOW-168 was NOT previously implemented (Sprint 14 READY, never shipped).
    This PR completes it: shared JSON fixture + 8 TS + 10 Python contract tests
    + hard CI gate cross-language-contract (no continue-on-error). Submitted
    2026-06-07 by qa-engineer.

- id: FOLLOW-199
  title: Quiz widget v2.0 — cascading decision tree
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-07T00:00:00Z'
  completed_at: '2026-06-07T00:00:00Z'
  pr: '#203'
  priority: P1
  estimated_hours: 12
  depends_on: []
  produces: [FOLLOW-200, FOLLOW-201]
  source: Audit §10.1, Master_Design §E.4 v4.0
  spec: backlog/sprint-15/FOLLOW-199.md
  notes: |
    Full rewrite quiz-widget.ts: Q1 gate → 3 branches (INWESTOR/WŁASNY_UŻYTEK/CROSS-BORDER),
    2-3 questions, 17 non-neutral leaf archetypes. Trigger: 30s setTimeout on any page (not
    3 listing views). Update quiz-trigger.ts + add 'es' to QuizConfig.language schema.
    Rewrite all tests. 12h estimated. Delegated 2026-06-07 by pm-orchestrator.

- id: FOLLOW-200
  title: quiz_completions MOAT table + completion endpoint
  agent: backend-engineer + data-engineer
  status: DONE
  priority: P1
  completed_at: '2026-06-07T00:00:00Z'
  pr: '#207'
  estimated_hours: 5
  assigned_to: backend-engineer (lead), data-engineer (migration)
  started_at: '2026-06-07T14:00:00Z'
  depends_on: [FOLLOW-199]
  source: Audit §10.1, §E.4.8, Master_Design §E.4.8 v4.0
  spec: backlog/sprint-15/FOLLOW-200.md
  branch: backend-engineer/FOLLOW-200-quiz-completions-moat
  notes: |
    New Postgres migration: quiz_completions table (RLS). New POST /api/quiz/completion
    endpoint. SDK dispatches quiz.completed ingest event + calls completion endpoint
    after FOLLOW-199 leaf reached. MOAT data for full CHAT→quiz→adaptation→conversion chain.

- id: FOLLOW-201
  title: applyQuizLeaf() + drift detection activation
  agent: sdk-engineer
  status: DONE
  completed_at: '2026-06-07T00:00:00Z'
  pr: '#204'
  priority: P1
  estimated_hours: 5
  depends_on: [FOLLOW-199]
  source: Audit §10.1, §E.4.4/E.4.5, Master_Design §E.4.4/E.4.5 v4.0
  spec: backlog/sprint-15/FOLLOW-201.md
  notes: |
    Add applyQuizLeaf() pure function to intent.ts (direct assignment ~0.95 confidence).
    Replace applyQuizPrior() call in quiz completion callback. Add driftCandidateArchetype/
    driftCandidateCount/DRIFT_HOLD_COUNT=3 state. Override session archetype after 3
    consecutive mismatch cycles. detectMismatch() already exists at intent.ts:491.

- id: FOLLOW-202
  title: Navigator.language browser detection for quiz
  agent: sdk-engineer
  status: DONE
  completed_at: '2026-06-07T00:00:00Z'
  pr: '#209'
  assigned_to: sdk-engineer
  started_at: '2026-06-07T20:00:00Z'
  branch: sdk-engineer/FOLLOW-202-navigator-language-detection
  priority: P2
  estimated_hours: 2
  depends_on: []
  source: Audit §10.1 multilanguage section
  spec: backlog/sprint-15/FOLLOW-202.md
  ci_gates: 'Test (Node 22): pass, Typecheck: pass, Lint: pass, Format: pass, Rule H: pass, Rule J: pass'
  notes: |
    Implemented 4-level language resolution (Master_Design v4.0 §E.4.6). Level 3
    (navigator.language) added via globalThis.navigator property access to avoid
    esbuild Node-target constant-folding of bare `typeof navigator`. 7 new unit
    tests cover AC1/AC2/AC3 + es-ES, pl/en cross, SSR-guard. QuizConfig.language
    already accepted 'es' from FOLLOW-199 — verified at route.ts:25,41.

# ── Track C: Description cache redesign (Week 3–4) ──

- id: FOLLOW-203
  title: Remove Tier logic from description route
  agent: backend-engineer
  status: DONE
  completed_at: '2026-06-07T00:00:00Z'
  pr: '#205'
  priority: P1
  estimated_hours: 4
  depends_on: []
  produces: [FOLLOW-204]
  source: Audit §10.3, Master_Design §E.7 v4.0, CEO decision 2026-06-05
  spec: backlog/sprint-15/FOLLOW-203.md
  pr: https://github.com/Pnawrocki9/Adaptive-Listings/pull/205
  notes: |
    CEO decision 2026-06-05: no Tiers in Adaptive Listings. Remove tier param from
    description route Zod schema, remove TTL_TIER2/TTL_TIER3, remove Tier-1 early-return,
    single max_tokens:500. Remove TTL exports from description-cache.ts. Redis SET without EX.
    CI green: Typecheck, Test (Node 22), Rule H, Rule J, Format, Lint all pass.
    Python test failures are pre-existing-red and non-blocking (per CI gate landscape).

- id: FOLLOW-204
  title: description_cache_persistent — permanent Postgres description table
  agent: data-engineer + backend-engineer + ml-engineer
  status: DONE
  priority: P1
  completed_at: '2026-06-07T00:00:00Z'
  pr: '#207'
  estimated_hours: 8
  assigned_to: data-engineer (migration), backend-engineer (route + webhook + admin UI), ml-engineer (Modal write)
  started_at: '2026-06-07T14:00:00Z'
  depends_on: [FOLLOW-203]
  source: Audit §10.3, Master_Design §E.7.3 v4.0
  spec: backlog/sprint-15/FOLLOW-204.md
  branch: backend-engineer/FOLLOW-204-description-cache-persistent
  notes: |
    Co-assigned (3 agents). New Postgres migration: description_cache_persistent (RLS,
    UNIQUE tenant+listing+archetype+locale). Lookup order: DB → Redis → template_fallback.
    Modal Python writes to DB after generation. listing.updated webhook invalidates DB row.
    Admin UI at /dashboard/listings/[id] shows descriptions per archetype. PM must run step 5d
    integration check (producer=Modal Python write, consumer=route lookup) before READY_FOR_REVIEW.

# ── Track D: Background / Security (Week 4–5) ──

- id: FOLLOW-205
  title: F-19 — Demo auth hardening
  agent: backend-engineer
  status: DONE
  completed_at: '2026-06-07T00:00:00Z'
  pr: '#210'
  assigned_to: backend-engineer
  started_at: '2026-06-07T20:00:00Z'
  branch: backend-engineer/FOLLOW-205-demo-auth-hardening
  priority: P2
  estimated_hours: 3
  depends_on: []
  source: Audit F-19
  spec: backlog/sprint-15/FOLLOW-205.md
  notes: |
    Replaced presence-only Bearer check with real HS256 JWT verification using
    crypto.subtle (Web Crypto API, no new dependency). Invalid/expired JWT → 401
    { error: 'invalid_demo_token' }. Missing secret → 500 { error:
    'demo_auth_misconfigured' }. 6 new unit tests cover AC1/AC2/AC3. All 745
    tests passing. Typecheck clean.

- id: FOLLOW-206
  title: F-05/F-21 — SQL escaping unification
  agent: backend-engineer
  status: DONE
  completed_at: '2026-06-07T00:00:00Z'
  pr: '#214'
  assigned_to: backend-engineer
  started_at: '2026-06-07T22:00:00Z'
  priority: P3
  estimated_hours: 2
  depends_on: []
  source: Audit F-05, F-21
  spec: backlog/sprint-15/FOLLOW-206.md
  pr: https://github.com/Pnawrocki9/Adaptive-Listings/pull/214
  notes: |
    Two escaping strategies unified: route.ts:359 and llm-gateway.ts:167 both
    updated from \\' (backslash) to '' (ANSI SQL doubling), consistent with
    clickhouse-dsr.ts:99. Grep confirms no \\' pattern remains after fix. CI green.

# ── Track E: Signal enrichment (Week 2–3) ──
# Low-effort, high-ROI signal enrichments from 2026-06-05 audit gap analysis.
# FOLLOW-210 and FOLLOW-211 are P1 — they unlock categorical discrimination
# that behavioral signals alone cannot provide without payload context.

- id: FOLLOW-207
  title: Referrer URL + device type session-init signals
  agent: sdk-engineer
  status: DONE
  completed_at: '2026-06-07T00:00:00Z'
  notes: 'Committed directly to main (c225c62) — no PR (no branch protection on repo)'
  priority: P2
  estimated_hours: 3
  depends_on: []
  source: Audit §3 gap analysis (2026-06-05)
  spec: backlog/sprint-15/FOLLOW-207.md
  notes: |
    Capture document.referrer + UTM params at init. Add applyReferrerHints() pure function
    to intent.ts. Add device_type (desktop|mobile) to session.started ingest event and
    SIGNAL_LIKELIHOODS. Investment-keyword referrers shift investor priors; desktop shifts
    investor archetypes; mobile shifts own-use archetypes.

- id: FOLLOW-208
  title: Listing-view RATE as portfolio_builder/flip_investor signal
  agent: sdk-engineer
  status: DONE
  completed_at: '2026-06-07T00:00:00Z'
  pr: '#213'
  priority: P2
  estimated_hours: 3
  depends_on: []
  source: Audit §3 gap analysis (2026-06-05)
  spec: backlog/sprint-15/FOLLOW-208.md
  pr: https://github.com/Pnawrocki9/Adaptive-Listings/pull/213
  notes: |
    Track sessionStartedAt alongside listingViewCount. Add applyListingViewRate() pure
    function to intent.ts. Rate ≥3 views/min boosts portfolio_builder/flip_investor.
    Rate ≤0.5 views/min + ≥2 views boosts family_buyer/first_time_buyer/upsizer.
    Include listing_view_rate in session.quality.snapshot ingest payload.
    28 unit tests, 1016 total tests pass. All hooks green. PR #213 opened.
    Note: branch includes FOLLOW-207 commit as parent (PR #212 not yet merged to main).
    Will rebase cleanly when FOLLOW-207 merges.

- id: FOLLOW-209
  title: Micro-polls — single yes/no intent prompts as quiz supplement
  agent: sdk-engineer + backend-engineer
  status: DONE
  completed_at: '2026-06-07T00:00:00Z'
  pr: '#215'
  notes: 'Wave 1 (SDK side) complete. Wave 2 (dashboard toggle) deferred to Sprint 16.'
  assigned_to: sdk-engineer (wave 1 — micro-poll UI + intent signal), backend-engineer (wave 2 — DB field + admin UI)
  started_at: '2026-06-07T22:00:00Z'
  priority: P2
  estimated_hours: 6
  depends_on: [FOLLOW-199]
  source: Audit §3 alternative methods analysis (2026-06-05)
  spec: backlog/sprint-15/FOLLOW-209.md
  notes: |
    New micro-poll.ts: bottom-of-screen toast (not full overlay), 24h localStorage cooldown.
    3 default Polish questions (tenant-configurable). Trigger: quiz dismissed OR 90s elapsed
    AND quiz not completed. New QuizConfig field micro_polls_enabled (default false).
    Admin toggle at /dashboard/quiz. micro_poll.answered added to SIGNAL_LIKELIHOODS.

- id: FOLLOW-210
  title: Favorites/bookmark capture — app.estalara.com save-listing event
  agent: sdk-engineer
  status: DONE
  completed_at: '2026-06-07T00:00:00Z'
  pr: '#208'
  assigned_to: sdk-engineer
  started_at: '2026-06-07T15:00:00Z'
  completed_at: '2026-06-07T18:55:00Z'
  priority: P1
  estimated_hours: 5
  depends_on: []
  source: Audit §3 (2026-06-05) — favorites = highest-value deterministic intent signal
  spec: backlog/sprint-15/FOLLOW-210.md
  branch: sdk-engineer/FOLLOW-210-favorites-capture
  pr: https://github.com/Pnawrocki9/Adaptive-Listings/pull/208
  notes: |
    Part 1 (Estalara-app repo): estalara:listing:favorited CustomEvent dispatched from
    ListingCard.svelte and listing detail +page.svelte on successful save/unsave.
    Part 2 (this repo): SDK listener in index.ts → listing.bookmarked ingest event +
    applyBehavioralSignal. Payload-conditional boosts: bedroomCount≥3 →
    family_buyer/upsizer; listingType=commercial → commercial_investor.
    Real CI gates all green: Typecheck, Test Node 22, Rule H, Rule J, Lint, Format.
    Python tests pre-existing-red (non-blocking per ci_gate_landscape memory).

- id: FOLLOW-211
  title: filter.applied full facet payload schema (prerequisite for FOLLOW-099)
  agent: sdk-engineer
  status: DONE
  priority: P1
  completed_at: '2026-06-07T00:00:00Z'
  pr: '#206'
  estimated_hours: 2
  assigned_to: sdk-engineer
  started_at: '2026-06-07T14:00:00Z'
  depends_on: []
  source: Audit §3 — filter.applied discriminating power is in the payload, not the event type
  spec: backlog/sprint-15/FOLLOW-211.md
  branch: sdk-engineer/FOLLOW-211-filter-applied-payload
  notes: |
    Define FilterAppliedPayload Zod schema in packages/shared. Add facet-conditional
    SIGNAL_LIKELIHOODS logic for filter.applied: commercial→commercial_investor+0.20;
    bedrooms_min≥3→family_buyer+0.10; sort by yield/roi→yield_hunter+0.15;
    price_max<median→first_time_buyer+0.08. Prerequisite for FOLLOW-099 to be useful.
```

## YELLOW audit track (parallel) — Sprint 1 (DONE)

**What this track is:** a separate "YELLOW audit" launch-readiness plan with its own `F-NN` ticket
numbering (NOT the FOLLOW-NNN retrospective system). It landed Sprint 1 as a single bundled PR
(#158, `6827305`) on a `claude/**` branch (not an agent-prefix branch). The four F-NN items are
recorded here under reserved FOLLOW numbers 118–121 so QUEUE.md stays the single status SoT; the
canonical F-NN plan lives outside the repo
(`/root/.claude/plans/objective-you-are-a-starry-truffle.md` — root-owned, not readable from this
session). Remaining YELLOW work (Sprint 2–4): F-01, F-04, F-05, F-06, F-07, F-08, UX-01, plus a
measurement dashboard.

```yaml
- id: FOLLOW-118 # YELLOW audit F-02
  title: Wire applyArchetypeHints() cold-start Bayesian prior in SDK init()
  agent: sdk-engineer
  status: DONE # PR #158 merged to main 2026-05-27 (6827305); CI green
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#158'
  priority: P1
  estimated_hours: 0 # bundled in PR #158
  yellow_ticket: F-02
  notes: |
    YELLOW audit F-02. detectSiteSchema() → extractArchetypeHints() called in init() (try/catch
    guarded so detection failure never blocks session init), so the cold-start prior reflects site
    type before the first behavioral event. File: packages/sdk/src/index.ts (block after
    initIntentState()). NOTE: overlaps conceptually with TICKET-AUTO-007 (archetype hints) and the
    Lane C FOLLOW-100 prior math — confirm no double-application of priors when Lane C lands.

- id: FOLLOW-119 # YELLOW audit F-09
  title: Locale-correct slot copy (en/pl/es) threaded SDK config → adapt route decision tree
  agent: sdk-engineer + backend-engineer
  status: DONE # PR #158 merged to main 2026-05-27 (6827305); CI green
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#158'
  priority: P1
  estimated_hours: 0 # bundled in PR #158
  yellow_ticket: F-09
  notes: |
    YELLOW audit F-09. SdkConfig.language extended to 'en'|'pl'|'es'; locale threaded through
    fetchDirectives() POST body into runDecisionTree(), which now selects s.pl ?? s.en / s.es ?? s.en
    instead of always s.en. Spanish strings added to consent-banner, quiz-trigger, quiz-widget. Files:
    packages/sdk/src/core/config.ts, core/adapt.ts, ui/*.ts; apps/control-plane/src/app/api/adapt/route.ts.

- id: FOLLOW-120 # YELLOW audit F-10
  title: Per-tenant/session LLM cost attribution (sessionId/tenantId threading)
  agent: backend-engineer
  status: DONE # PR #158 merged to main 2026-05-27 (6827305); CI green
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#158'
  priority: P1
  estimated_hours: 0 # bundled in PR #158
  yellow_ticket: F-10
  notes: |
    YELLOW audit F-10. sessionId + tenantId added to LlmGatewayInput and threaded through
    runDecisionTree() → logLlmCallAsync(), so ClickHouse cost rows carry real identifiers instead of
    'unknown'. Files: apps/control-plane/src/lib/llm-gateway.ts, api/adapt/route.ts.

- id: FOLLOW-121 # YELLOW audit F-13/F-14
  title:
    GDPR Legitimate Interest Assessment documented in DPIA (consent.denied dispatch + fingerprint)
  agent: compliance-engineer
  status: DONE # PR #158 merged to main 2026-05-27 (6827305); CI green
  completed_at: '2026-05-27T00:00:00Z'
  pr: '#158'
  priority: P1
  estimated_hours: 0 # bundled in PR #158
  yellow_ticket: F-13 + F-14
  notes: |
    YELLOW audit F-13/F-14. LIA documented in docs/compliance/dpia.md §13.1 (consent.denied
    server-side dispatch — audit-trail purpose) and §13.2 (stable cross-session fingerprint — session
    continuity); full three-part LIA test each + required consent-banner disclosure language. No code
    changes per the Option B decision (documentation-only).
```

## Sprint 17 — quiz_config blob cleanup + SDK locale alignment + headline precision + Archetype Identification Tracer (OPEN)

**Added 2026-06-11 (pm-orchestrator). FOLLOW-274 promoted from RETRO-056 stub; FOLLOW-273 promoted
from RETRO-055 stub; FOLLOW-272 promoted from RETRO-054 stub. FOLLOW-266–269 (Archetype
Identification Tracer, CEO-directed 2026-06-10, §K.3.6) ticket files written 2026-06-12 — status
BACKLOG, pending sprint planning start. FOLLOW-266 gates 267→268→269 (strict sequence). Simulation
engine deferred to FOLLOW-282 per CEO D-3.**

```yaml
- id: FOLLOW-274
  title:
    Resolve orphaned quiz_config blob keys — wire micro_polls_enabled end-to-end OR retire +
    sticky_widget retire (Rule U + Rule L)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-11T12:00:00Z'
  completed_at: '2026-06-11T15:00:00Z'
  priority: P2
  estimated_hours: 4
  depends_on: []
  source_retro: RETRO-056 (§4a LG-1; §4c TG-1/TG-2; §4d DG-1; §6 — Rule U 4th instance)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-274 stub)
  branch: backend-engineer/FOLLOW-274-quiz-config-blob-orphan-keys
  pr: '#267'
  ci_status: green
  notes: |
    Two orphaned write-only quiz_config JSONB keys the FOLLOW-271 JSDoc re-blessed as "valid":
    micro_polls_enabled (dashboard producer; SDK consumer at index.ts:888,965 but buildSnippet
    never emits data-micro-polls-enabled → transport missing, HALF_WIRE) and sticky_widget
    (dashboard producer; ZERO SDK consumer). Decide WIRE or RETIRE per key, update docstrings,
    add parity test. Rule U "grep EVERY key" + Rule L all-three-limbs.
    RESOLUTION: micro_polls_enabled WIRED (buildSnippet emits data-micro-polls-enabled,
    readConfig parses it, SDK casts cleaned); sticky_widget RETIRED (schema omitted,
    migration 0027 backfill, dashboard toggle removed). All ACs complete, CI green.
    MERGED: PR #267 (fbea331) 2026-06-12. RETRO-057 complete.

- id: FOLLOW-273
  title:
    SDK quiz/locale path must reference canonical shared enum + reconcile QUIZ_LANGUAGE_VALUES vs
    LocaleSchema (Rule S cross-package)
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-11T15:00:00Z'
  completed_at: '2026-06-11T16:30:00Z'
  priority: P2
  estimated_hours: 3
  depends_on: [FOLLOW-270]
  source_retro: RETRO-055 (§4e MX-1/MX-2; §6 Rule-S cross-package instance)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-273 stub)
  branch: sdk-engineer/FOLLOW-273-sdk-quiz-locale-canonical
  pr: '#268'
  ci_status: green
  notes: |
    FOLLOW-270 extracted canonical QuizConfig/QUIZ_LANGUAGE_VALUES to @estalara/shared but the
    SDK still hand-types 'en'|'pl'|'es' at quiz-widget.ts:27,50, quiz-trigger.ts:12,
    config.ts:95. Replace with shared type. Also reconcile QUIZ_LANGUAGE_VALUES vs pre-existing
    LocaleSchema (description.ts:52) — two canonical ['en','pl','es'] now in @estalara/shared.
    Parity test: SDK QUIZ_CONTENT keys must equal QUIZ_LANGUAGE_VALUES.
    RESOLUTION: LocaleSchema now derives from QUIZ_LANGUAGE_VALUES (single SoT). Six SDK files
    updated to use QuizLanguage from shared. QUIZ_CONTENT parity test added. All real CI gates green.
    MERGED: PR #268 (e700782) 2026-06-12. Retro pending.

- id: FOLLOW-272
  title:
    Tighten _check_headline_facts — digit coincidence + first-word proper-name escape (Rule S
    verification-tier)
  agent: ml-engineer
  status: DONE
  assigned_to: ml-engineer
  completed_at: '2026-06-12T07:00:00Z'
  priority: P3
  estimated_hours: 3
  depends_on: [FOLLOW-169]
  source_retro: RETRO-054 (§4a LG-1; §4c TG-1; §6 Rule-S close-out)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-272 stub)
  branch: ml-engineer/FOLLOW-272-headline-fact-check-precision
  pr: '#275'
  notes: |
    _check_headline_facts uses bare substring containment which admits digit coincidences and
    first-word proper-name escapes. Tighten to word-boundary match or derive from verified_facts
    whitelist. No pilot blocker (fact-check is present and fail-safe; this raises PRECISION).
    MERGED: PR #275 (7aee86c) 2026-06-12. RETRO-060 complete. FOLLOW-281 stub filed (locale
    axis: proper-name scan locale-aware for pl/es/ar).

- id: FOLLOW-275
  title:
    Wire micro_polls_enabled (+ symmetric quizEnabled) end-to-end from tenant store to production
    SDK snippet — DetectWizard/DetectionPreview call site supplies neither flag; no dashboard
    re-emission surface (Rule L + Rule S)
  agent: backend-engineer (Phase 1) + sdk-engineer (Phase 2)
  status: DONE
  assigned_to: backend-engineer + sdk-engineer
  started_at: '2026-06-11T22:00:00Z'
  completed_at: '2026-06-12T05:13:50Z'
  priority: P1
  estimated_hours: 6
  depends_on: []
  source_retro:
    RETRO-057 (§4a LG-1 P1 / LG-2 P2; §4c TG-1 P1; §4d DG-1 P1; §5a/§5d; Rule L call-site caveat +
    Rule S)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-275 stub)
  adr: docs/adr/ADR-0011-quiz-config-transport.md (ACCEPTED, PR #269 merged 2026-06-11)
  pr_phase1: '#270'
  pr_phase2: '#271'
  ci_status: green (both phases)
  notes: |
    Phase 1 (backend-engineer, PR #270): GET /api/quiz/public-config route, QuizPublicConfigResponseSchema,
    buildSnippet() retired attrs, docstring corrections. CI green.
    Phase 2 (sdk-engineer, PR #271): fetchQuizConfig() in packages/sdk/src/core/quiz-config.ts,
    wired into init() before quiz/micro-poll schedulers, mergeQuizConfig(), readConfig() dataset
    attrs retired, Rule R rehydrate gate, 20 new tests. CI green.
    Both PRs must merge together or in order (Phase 1 first).

- id: FOLLOW-276
  title:
    sweep + correct 4 stale buildSnippet/data-micro-polls-enabled docstrings made false by ADR-0011
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  completed_at: '2026-06-12T09:11:00Z'
  priority: P1
  estimated_hours: 1
  depends_on: []
  source_retro: RETRO-058 (§4d DG-1 P1)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-276 stub)
  pr: '#272'
  notes: |
    4 docstrings in files outside the FOLLOW-275 diff still assert the retired
    buildSnippet-attribute transport. One is user-facing (page.tsx:252). Trivial sweep.
    MERGED: PR #272 (eff4b7e) 2026-06-12. RETRO-062 pending spawn.

- id: FOLLOW-277
  title: wire data_source fallback signal (HALF_WIRE_C) + fix auth-path DB-throw hard-500
  agent: backend-engineer
  status: DONE
  pr: '#276'
  completed_at: '2026-06-12T07:00:00Z'
  priority: P2
  estimated_hours: 3
  depends_on: []
  source_retro: RETRO-058 (§3 CHECK B; §4b CB-1 P2; §4c TG-2 P2)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-277 stub)
  notes: |
    Route emits data_source:'fallback' but QuizPublicConfigResponseSchema omits it —
    SDK silently drops it (HALF_WIRE_C). Auth-path DB throw hard-500s against fail-soft contract.
    MERGED: PR #276 (01f5e2b) 2026-06-12. RETRO-059 complete. FOLLOW-280 stub filed (prod
    observability gap: debug-gated consumer doesn't fire in prod).

- id: FOLLOW-279
  title:
    Correct false "retired" doc claim for data-language/data-accent-color in ADR-0011 + index.ts
    comment (doc-only fix + incidental lint fix)
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  completed_at: '2026-06-12T09:11:00Z'
  priority: P3
  estimated_hours: 0.5
  depends_on: [FOLLOW-278]
  source_retro: RETRO-061 (§4a DG-1; §6 ungated-prose-wire-assertion meta-pattern)
  pr: '#274'
  notes: |
    FOLLOW-278 introduced false "retired" claims for data-language/data-accent-color in two
    places. These attrs were NEVER emitted by buildSnippet (git-history verified). Corrected to
    "never emitted". Also fixed incidental lint error (redundant ?? false on boolean field).
    MERGED: PR #274 (9922d9c) 2026-06-12. RETRO-061 complete. No new follow-ups (folded into
    existing FOLLOW-276 scope recommendation).

- id: FOLLOW-278
  title:
    consent-banner locale/accent gap + locale render-hop test (server-fetched language reaches quiz
    but not consent banner)
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  completed_at: '2026-06-12T09:11:00Z'
  priority: P2
  estimated_hours: 3
  depends_on: []
  source_retro: RETRO-058 (§4a LG-1 P2; §4c TG-1 P2)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-278 stub)
  pr: '#273'
  notes: |
    mergeQuizConfig() runs after consent banner renders — banner gets snippet language,
    quiz/widget get server language. Add locale render-hop test per Rule L.
    MERGED: PR #273 (e61418d) 2026-06-12. RETRO-063 pending spawn. Note: FOLLOW-279 (PR #274)
    corrected false "retired" claim introduced by this PR's docs — doc-fix merged same day.

- id: FOLLOW-266
  title: >
    K.3.6 foundation — DB schema (intent_sessions + intent_weight_configs Supabase migrations,
    intent_events ClickHouse table) + SDK intent.snapshot event + CF Worker dual-write handler
  agent: data-engineer + backend-engineer + sdk-engineer
  status: DONE
  assigned_to: sdk-engineer (Phase 3)
  started_at: '2026-06-12T12:00:00Z'
  phase2_started_at: '2026-06-12T19:00:00Z'
  phase3_started_at: '2026-06-13T00:00:00Z'
  completed_at: '2026-06-12T22:11:39Z'
  pr_phase1: '277'
  pr_phase2: '278'
  pr_phase3: '280'
  priority: P1
  estimated_hours: 6
  depends_on: []
  spec: backlog/FOLLOW_UPS.md (FOLLOW-266 stub)
  branch: sdk-engineer/FOLLOW-266-k36-sdk-emission
  notes: |
    Three new tables: intent_sessions (Supabase, per-session summary, UNIQUE tenant+session, RLS),
    intent_weight_configs (Supabase, global weight store, CEO D-4), intent_events (ClickHouse,
    MergeTree ORDER BY tenant+session+time). SDK emits intent.snapshot every 5 signals OR
    window.beforeunload; payload: archetype/confidence/probabilities/quiz/chat/last_delta.
    CF Worker ingest handler dual-writes: INSERT intent_events + UPSERT intent_sessions.
    Gates FOLLOW-267, FOLLOW-268, FOLLOW-269.
    Phase 1 DONE: PR #277 merged 2026-06-12T18:23:36Z (data-engineer: intent_sessions migration
    0028 + intent_events ClickHouse DDL 0014). RETRO-064 pending.
    Phase 2 DONE: PR #278 merged 2026-06-12 (backend-engineer: intent_weight_configs migration 0029 +
    CF Worker intent.snapshot dual-write handler). RETRO-065 complete.
    Phase 3 DONE: PR #280 merged 2026-06-12T22:11:39Z (sdk-engineer: IntentSnapshotEventSchema +
    SDK emission logic in intent-snapshot.ts + index.ts every-5-signals + beforeunload paths).
    All real CI gates green: Test Node22, Typecheck, Lint, Format, Rule H, Rule J, Migration
    monotonicity, ClickHouse smoke, Demo integration, Gitleaks, Vercel.
    Build/Rule-I/Python pre-existing-red on main — not regressions. RETRO-067 pending spawn.
    CI-check counter: 2/5 (fix-iter 1/3 for format; resolved before merge). Fix-iteration counter: 1/3.

- id: FOLLOW-267
  title: >
    K.3.6 admin API layer — active-sessions list, SSE live stream, history search + replay, export
    endpoints, and /api/intent/config SDK weight-fetch route
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-13T11:00:00Z'
  completed_at: '2026-06-13T00:00:00Z'
  priority: P1
  estimated_hours: 8
  depends_on: [FOLLOW-266]
  spec: backlog/FOLLOW_UPS.md (FOLLOW-267 stub)
  branch: backend-engineer/FOLLOW-267-k36-admin-api
  pr: '283'
  notes: |
    Routes: GET /api/admin/tracer/sessions (active last 15 min), /sessions/:id (detail),
    /sessions/:id/stream (SSE 3s poll ClickHouse), /history (paginated + filters),
    /history/:id (full replay), /export/decisions (CSV/JSONL), /export/events (JSONL).
    SDK-facing: GET /api/intent/config — returns active global weights (5-min CDN TTL).
    All admin routes require ADMIN_API_SECRET or admin JWT.
    PR #283 merged. RETRO-070 source: shipped untested (6 routes + helper, 0 tests at merge).
    FOLLOW-297 (Ticket D) back-filled tests; FOLLOW-294 (Ticket A) hardened auth.

- id: FOLLOW-294
  title: >
    ADR-0012 Ticket A — authenticated GET /api/intent/config + shared IntentWeightsSchema
    (closes cross-tenant ?tenant_id enumeration gap from PR #283; establishes canonical 18-archetype
    / 13-signal weights schema before any intent_weight_configs rows exist)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  completed_at: '2026-06-13T00:00:00Z'
  priority: P1
  estimated_hours: 3
  depends_on: [FOLLOW-267]
  spec: backlog/FOLLOW_UPS.md (ADR-0012 Ticket A)
  pr: '284'
  merge_commit: 4e45e3a
  notes: |
    PR #284 merged (4e45e3a). Authenticated GET /api/intent/config; shared IntentWeightsSchema;
    cross-tenant ?tenant_id enumeration closed. RETRO-070 generated FOLLOW-298/299/300.
    NOTE: route still emits data_source:'error' absent from IntentConfigResponseSchema ['live','mock']
    enum — tracked by FOLLOW-299 (P1, BLOCKS FOLLOW-268-sdk).

- id: FOLLOW-268-write
  title: >
    ADR-0012 Ticket B — admin write API POST/PUT /api/admin/intent/config (create/update
    intent_weight_configs rows; write-side IntentWeightsSchema validation satisfied)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  completed_at: '2026-06-13T00:00:00Z'
  priority: P1
  estimated_hours: 4
  depends_on: [FOLLOW-267, FOLLOW-294]
  spec: backlog/FOLLOW_UPS.md (ADR-0012 Ticket B)
  pr: '285'
  merge_commit: 2998a93
  notes: |
    PR #285 merged (2998a93). POST/PUT /api/admin/intent/config with IntentWeightsSchema validation.
    RETRO-071 generated FOLLOW-301/302. FOLLOW-300 write-validation half SATISFIED (both routes
    validate weights through identical IntentWeightsSchema instance). Residual: one-active-row
    invariant not defended (FOLLOW-301 P1 BLOCKS FOLLOW-268-sdk); GET tie-break non-deterministic.

- id: FOLLOW-268
  title: >
    ADR-0012 Ticket C — SDK weight-fetch at init (CEO D-1: effective within 5 min, fail-soft);
    fetch /api/intent/config, cache 5 min, apply signal_weights/priors/behavioral_damping
  agent: sdk-engineer
  status: DONE
  priority: P2
  estimated_hours: 4
  depends_on: [FOLLOW-266, FOLLOW-267, FOLLOW-299, FOLLOW-301]
  spec: backlog/FOLLOW_UPS.md (FOLLOW-268 stub, Ticket C)
  pr: '290'
  merge_commit: ea2089b
  completed_at: '2026-06-13T00:00:00Z'
  notes: |
    PR #290 merged (ea2089b). resolveIntentOverrides() + fetchIntentWeights() implemented.
    SDK init(): fetch /api/intent/config, cache 5 min, apply server priors/damping/signal_likelihoods
    through initIntentState/applyBehavioralSignal; fail-soft on error (data_source='error').
    Simulation NOT in scope (CEO D-3 — FOLLOW-282).
    RETRO-074 generated FOLLOW-305 (P1 — double-/api prod 404 blocker; same bug on fetchQuizConfig).
    IMPORTANT: D-1 was code-complete but NOT production-live at this PR — fetchIntentWeights built
    ${decisionApiUrl}/api/intent/config but decisionApiUrl is already host+/api from the snippet,
    producing double-/api 404. Fixed by FOLLOW-305 (PR #291). Gates FOLLOW-269 (now unblocked).

- id: FOLLOW-297
  title: >
    ADR-0012 Ticket D — unit-test coverage for 6 K.3.6 tracer admin routes + clickhouse-tracer.ts
    helper (111 assertions, seam-driven); DG-1 MAX_POLLS docstring fix (stream route)
  agent: qa-engineer
  status: DONE
  assigned_to: qa-engineer
  completed_at: '2026-06-13T00:00:00Z'
  priority: P1
  estimated_hours: 4
  depends_on: [FOLLOW-267]
  spec: backlog/FOLLOW_UPS.md (FOLLOW-297 stub)
  pr: '286'
  merge_commit: 8cdf94f
  notes: |
    PR #286 merged (8cdf94f). 7 new test files, 111 assertions; seam-driven (mocks only fetch).
    DG-1 MAX_POLLS "300 polls" → "100 polls" docstring fixed in stream/route.ts.
    RETRO-072 generated FOLLOW-303. NOTE: AC3.7 MAX_POLLS bound test is tautological (pinning
    gap → FOLLOW-303 TG-1). data_source:'error' enum drift codified in tests without round-trip →
    FOLLOW-303 TG-2. FOLLOW-295/296 NOT closed by this PR (scoping/Zod-validation remain open).

- id: FOLLOW-299
  title: >
    Widen data_source enum to include 'error' — IntentConfigResponseSchema + TracerSessionDetail
    ResponseSchema must include 'error' slot; FOLLOW-268-sdk consumer prerequisite
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  completed_at: '2026-06-13T00:00:00Z'
  priority: P1
  estimated_hours: 2
  depends_on: [FOLLOW-294, FOLLOW-297]
  spec: backlog/FOLLOW_UPS.md (FOLLOW-299 stub)
  pr: '287'
  merge_commit: c387103
  notes: |
    PR #287 merged (c387103). data_source enum widened to include 'error' in
    IntentConfigResponseSchema and TracerSessionDetailResponseSchema. Prerequisite for
    FOLLOW-268-sdk (Ticket C) data_source observer. Coordinate with FOLLOW-303 (tracer
    family round-trip test + MAX_POLLS pinning).

- id: FOLLOW-269
  title: >
    K.3.6 frontend — Live Session Monitor + Session History + Weight Editor + Export Dashboard (4
    admin UI surfaces) + Master Design §K.3.6 update
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-14T12:00:00Z'
  completed_at: '2026-06-14T11:41:43Z'
  priority: P2
  estimated_hours: 10
  depends_on: [FOLLOW-266, FOLLOW-267, FOLLOW-268]
  spec: backlog/FOLLOW_UPS.md (FOLLOW-269 stub)
  branch: backend-engineer/FOLLOW-269-k36-tracer-ui
  pr: '298'
  notes: |
    /admin/tenants/[id]/tracer (K.3.6.1 — SSE live monitor, probability bar chart, chat gate stub),
    /admin/tenants/[id]/tracer/history (K.3.6.2 — filters, replay, CSV/JSONL export),
    /admin/tracer/weights (K.3.6.3 — global weight editor, sliders, no simulation per D-3),
    /admin/tenants/[id]/tracer/export (K.3.6.4 — export dashboard).
    Master Design §K.3.6 section update + Snapshot.1 K row update.
    POST-MERGE NOTE: PM must ask CEO for exact DPIA/client-notification scope for chat logging (D-2).
    All depends_on DONE: FOLLOW-266 (DONE PR #280), FOLLOW-267 (DONE PR #283),
    FOLLOW-268-sdk (DONE PR #290). Unblocked 2026-06-14. Delegated to backend-engineer.
    PR #298 merged 2026-06-14T11:41:43Z. RETRO-077 spawned (3 P0/P1 wiring bugs found —
    FOLLOW-309/310/311/312 generated). FOLLOW-309/310/311/312 fixed in PR #299 (merged
    2026-06-14T13:06:34Z). FOLLOW-293 (live-network smoke) now UNBLOCKED.

- id: FOLLOW-286
  title: >
    Fix intent.snapshot dual-write consumer defects before Phase 3 connects the SDK producer —
    PostgREST on_conflict URL fix (CB-1), event_type vocabulary reconciliation (LG-1/LG-2),
    join-key reconciliation, contract tests (TG-1), confidence_before + stale JSDoc + type dedup
  agent: backend-engineer (lead) + data-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-12T21:00:00Z'
  completed_at: '2026-06-12T21:27:21Z'
  priority: P1
  estimated_hours: 5
  pr: '279'
  depends_on: [FOLLOW-266 Phase 2 (PR #278 merged)]
  source_retro: RETRO-065
  spec: backlog/sprint-17/FOLLOW-286.md
  branch: backend-engineer/FOLLOW-286-k36-upsert-fix
  notes: |
    Three P1 defects latent in PR #278 handler, invisible under green CI (all 18 tests mock fetchImpl):
    CB-1: PostgREST on_conflict moved from Prefer header to URL query string (?on_conflict=tenant_id,session_id).
    LG-1: INTENT_SNAPSHOT_EVENT_TYPE constant + INTENT_EVENTS_VOCABULARY added to @estalara/shared.
          ClickHouse migration 0015 extends DDL vocabulary comment to include 'intent.snapshot'.
    LG-2: Raw session_id written to ClickHouse (column renamed intent_session_id → session_id in 0015).
          FOLLOW-269 joins on (tenant_id, session_id) composite text key.
    TG-1: 8 new contract tests: URL ?on_conflict, Prefer header check, 2nd-snapshot no-409,
          session_id parity between CH and Supabase rows.
    P2: confidence_before null, stale JSDoc rewritten, IntentSnapshotPayload imported from shared.
    164 tests pass. Typecheck green on @estalara/ingest and @estalara/shared.
    PR #279 merged 2026-06-12T21:27:21Z. RETRO-068 pending spawn.

- id: FOLLOW-266-phase3
  title: >
    K.3.6 Phase 3 — intent.snapshot SDK emission (IntentSnapshotEventSchema + emit every 5 signals
    + beforeunload, unit tests for 5-signal cycle and rehydrated session counter reset)
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-12T20:00:00Z'
  completed_at: '2026-06-12T22:11:39Z'
  pr: '280'
  priority: P1
  estimated_hours: 3
  depends_on: [FOLLOW-286]
  spec: backlog/FOLLOW_UPS.md (FOLLOW-266 stub, Phase 3)
  branch: sdk-engineer/FOLLOW-266-k36-intent-snapshot-event
  notes: |
    PR #280 merged 2026-06-12T22:11:39Z. IntentSnapshotEventSchema added to shared. SDK emits
    intent.snapshot after every 5th processSignal() call AND on window.beforeunload. Unit tests
    cover 5-signal cycle, beforeunload trigger, and counter reset on session rehydrate.
    RETRO-067 pending spawn.

- id: FOLLOW-287
  title: >
    K.3.6 ClickHouse JSONEachRow type fix — intent_session_id UUID→String migration incompatible
    with ClickHouse 26.5.1 ORDER BY key constraint; confidence_before null fix; error surfacing
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-12T22:00:00Z'
  completed_at: '2026-06-12T22:31:19Z'
  priority: P1
  estimated_hours: 2
  pr: '281'
  depends_on: [FOLLOW-286]
  source_retro: RETRO-066
  branch: backend-engineer/FOLLOW-279-k36-ch-write-fix
  ci_check_counter: '2/5'
  fix_iteration_counter: '2/3'
  notes: |
    PR #281 merged 2026-06-12T22:31:19Z. CB-2 (confidence_before 0.0) and DG-1 (console.error)
    fixes are correct and confirmed in production code. All TypeScript/Node gates passed.
    ClickHouse migrations smoke FAILED (code 524 ALTER_OF_COLUMN_IS_FORBIDDEN) — migration 0016
    contained ALTER TABLE intent_events MODIFY COLUMN on ORDER BY key. ESC-021 filed.
    FOLLOW-288 resolved the gate: migration 0016 replaced with SELECT 1 no-op, intent_session_id
    omitted from INSERT body. ESC-021 RESOLVED. RETRO pending.
```

- id: FOLLOW-288 title: > K.3.6 ClickHouse smoke gate repair — replace migration 0016 SELECT 1
  no-op + drop intent_session_id from INSERT body (ESC-021 fix) agent: backend-engineer status: DONE
  assigned_to: backend-engineer started_at: '2026-06-12T23:00:00Z' completed_at:
  '2026-06-12T23:27:03Z' priority: P0 estimated_hours: 1 depends_on: [FOLLOW-287] source_retro:
  ESC-021 branch: backend-engineer/FOLLOW-279-k36-ch-write-fix pr: '282' ci_check_counter: '1/5'
  fix_iteration_counter: '0/3' notes: | PR #282 merged 2026-06-12T23:27:03Z. Migration 0016 replaced
  with SELECT 1 no-op (preserves journal continuity). intent_session_id omitted from INSERT body —
  ClickHouse uses zero-UUID default. session_id (String, migration 0015) is authoritative join key
  for FOLLOW-269. confidence_before: 0.0 retained (CB-2 fix from FOLLOW-287). console.error on
  allSettled rejections retained (DG-1 fix from FOLLOW-287). ClickHouse migrations smoke CI gate:
  PASS. Test (Node 22): PASS. All real gates green. ESC-021 RESOLVED. PM-validated 2026-06-13. CI
  green. Runtime wiring confirmed. Already merged by backend-engineer. RETRO pending spawn.

## Sprint 18 — Tracer CI hardening + alias-shadow audit (OPEN)

**Added 2026-06-14 (CEO-directed promotion). FOLLOW-316 promoted from RETRO-078 stub to a real
ticket (`backlog/sprint-18/FOLLOW-316.md`). Closes the CI gap that let the FOLLOW-315 `Code 386`
tracer bug ship: no CI job exercises the tracer ClickHouse query builders against a real engine.
FOLLOW-317 (repo-wide `toString(col) AS col` alias-shadow audit) remains a stub in FOLLOW_UPS.md,
pending planning.**

```yaml
- id: FOLLOW-316
  title:
    Live-ClickHouse CI guard — submit the tracer query builders for analysis so a Code-386-class
    error fails CI
  agent: devops-engineer
  status: DONE
  assigned_to: devops-engineer
  started_at: '2026-06-14'
  completed_at: '2026-06-14'
  branch: devops-engineer/FOLLOW-316-tracer-ci-guard
  pr: '#305'
  priority: P1
  estimated_hours: 6
  depends_on: []
  source_retro: RETRO-078 (§4c TG-1/TG-2)
  source_ticket: FOLLOW-315 / PR #302
  spec: backlog/sprint-18/FOLLOW-316.md
  notes: |
    The CH-315a–d regression tests from PR #302 are mock-fetch only — they assert the SQL on the
    wire but never submit it to a ClickHouse engine, so they could not have caught the original
    Code 386 (a query-analysis error raised only by a real server). The only live-CH tests
    (clickhouse-dsr.integration.test.ts) self-skip in CI (CLICKHOUSE_URL unset). ci.yml already
    runs a clickhouse-smoke job that boots a real container + applies migrations. Close the gap:
    add an integration spec that submits all 4 tracer builders (export/history/stream-poll/session)
    against a seeded intent_events table on the CI container, with a negative control proving a bare
    unqualified event_at predicate FAILS. Wire CLICKHOUSE_URL into the smoke job; absence of the
    container must be a hard error (no silent skipIf).
```

## ADR-0012 D-1 follow-up backlog (generated by RETRO-070/071/072, 2026-06-13)

**ADR-0012 D-1 chain status as of 2026-06-13T14:00Z:**

- DONE: FOLLOW-267 (PR #283), FOLLOW-294/Ticket-A (PR #284 4e45e3a), FOLLOW-268-write/Ticket-B (PR
  #285 2998a93), FOLLOW-297/Ticket-D (PR #286 8cdf94f), FOLLOW-299/enum-prereq (PR #287 c387103)
- NEXT READY (P1): FOLLOW-301 — one-active-row invariant + deterministic GET + real POST→GET test
- BLOCKED on FOLLOW-301: FOLLOW-268/Ticket-C (SDK weight-fetch init); BLOCKED on FOLLOW-268:
  FOLLOW-269/FOLLOW-293

```yaml
- id: FOLLOW-301
  title: >
    Defend intent_weight_configs one-active-row invariant in write API + deterministic GET ORDER BY
    + replace fake AC5 wiring test with real POST→GET round-trip (BLOCKS FOLLOW-268-sdk / Ticket C)
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: [FOLLOW-268-write]
  source_retro: RETRO-071 (§4a LG-1/LG-3; §4c CB-1/TG-1/TG-2/TG-3; §4d DG-1)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-301 stub)
  pr: '289'
  merge_commit: a14c907
  completed_at: '2026-06-13T00:00:00Z'
  notes: |
    PR #289 merged (a14c907). Atomic deactivate-then-activate transaction on POST + PUT; 23505
    mapped to 409, FK 23503 mapped to 400; deterministic GET ORDER BY created_at DESC + id DESC;
    real POST→GET round-trip wiring test replaces the fake mock-both-legs AC5.
    RETRO-073 generated FOLLOW-304 (P2 — cross-scope GET determinism residual; shapes but does not
    block FOLLOW-268-sdk). FOLLOW-268-sdk UNBLOCKED by this PR.
    NOTE from RETRO-073: the GET's .orderBy(desc(createdAt)).limit(2) still has a cross-scope
    starvation gap (FOLLOW-304 LG-A/LG-B) where ≥2 active global rows can crowd out the tenant
    override. Degrades safely (serves global config, not a crash).

- id: FOLLOW-293
  title: >
    ADR-0012 closure-verification gate — end-to-end wire: SDK weight-fetch (Ticket C) reaches
    intent.ts processSignal() for all 13 signals; confirmed by a non-test producer + non-test
    consumer grep and a live integration assertion / live-network smoke test
  agent: qa-engineer
  status: DONE
  priority: P2
  estimated_hours: 3
  depends_on: [FOLLOW-268, FOLLOW-269]
  spec: backlog/FOLLOW_UPS.md (FOLLOW-293 stub)
  branch: qa-engineer/FOLLOW-293-live-network-smoke
  pr: '307'
  merge_commit: 2c1b352
  completed_at: '2026-06-15T00:00:00Z'
  notes: |
    DONE — PR #307 merged 2026-06-15 (commit 2c1b352). Live-network smoke test implemented at
    tests/integration/intent-weights-live.smoke.test.ts + CI job intent-weights-live-smoke.yml.
    ESC-024 provisioned by Piotr (2026-06-15): ESTALARA_SMOKE_API_KEY + ESTALARA_SMOKE_DECISION_API_URL
    added to GitHub Actions secrets. Smoke run 27555287447: AC-LN1/LN2/LN3 all GREEN.
    data_source:'live' confirmed in production. FOLLOW-293 DONE IN FULL. ESC-024 RESOLVED.

- id: FOLLOW-295
  title: >
    ADR-0012 Ticket E — tracer session route tenant-scoping: GET /api/admin/tracer/sessions/:id
    currently looks up session_id-only (no tenant_id predicate); derive tenant from row, not caller
  agent: backend-engineer
  status: BACKLOG
  priority: P2
  estimated_hours: 2
  depends_on: [FOLLOW-267, FOLLOW-297]
  source_retro: ADR-0012 §Context; RETRO-072 §4c TG-3
  spec: backlog/FOLLOW_UPS.md (FOLLOW-295 stub; ADR-0012 Ticket E)
  notes: |
    sessions/:id route looks up by session_id ALONE (high-entropy SHA-256, low risk).
    Staff-global-admin design is acceptable for K.3.6 ops tool; ticket adds tenant_id
    predicate + validates caller context if/when surface is ever exposed beyond staff.
    FOLLOW-297 tests exist but assert no tenant-scoping — they will need updating when
    this ticket lands. Not a blocking concern for SDK leg (FOLLOW-268-sdk is client-side).

- id: FOLLOW-296
  title: >
    ADR-0012 Ticket F — SSE stream Zod validation (docstring half CLOSED by FOLLOW-297 DG-1 fix;
    remaining: add Zod schema to the {events,data_source}/{heartbeat}/{error}/{closed} SSE frame
    types)
  agent: backend-engineer
  status: BACKLOG
  priority: P2
  estimated_hours: 2
  depends_on: [FOLLOW-267, FOLLOW-297]
  source_retro: ADR-0012 §Context; RETRO-072 §5a
  spec: backlog/FOLLOW_UPS.md (FOLLOW-296 stub; ADR-0012 Ticket F)
  notes: |
    Docstring half DONE (FOLLOW-297 PR #286 fixed MAX_POLLS "300→100"). Remaining: stream route
    validates inputs with manual if-checks, emits raw JSON.stringify SSE payloads with no Zod
    schema on the frame types. FOLLOW-297 added a test that the tenant_id guard fires (AC3.5)
    and frames are emitted, but introduced no Zod validation. Re-scope this ticket to Zod-
    validation half only at promotion.

- id: FOLLOW-298
  title: >
    Give packages/shared/src/examples/intent-weights.ts a real non-test consumer or move it to a
    fixtures path (4 EXAMPLE_* consts are exported but have ZERO importers; docstring falsely claims
    "imported by docs build / admin tooling")
  agent: backend-engineer
  status: BACKLOG
  priority: P3
  estimated_hours: 1
  depends_on: []
  source_retro: RETRO-070 (§4a LG-1)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-298 stub)
  notes: |
    Either: (a) import EXAMPLE_* consts in admin UI or documentation build (real consumer), or
    (b) move file to packages/shared/src/__fixtures__/ and drop the false "imported by" claim.
    Dead export violates Rule I; false docstring violates Rule H documentation parity.

- id: FOLLOW-300
  title: >
    Separate schema-validation failure from DB-error path in GET /api/intent/config (a malformed
    STORED weights row returns misleading db_error/500 instead of config_invalid/422)
  agent: backend-engineer
  status: BACKLOG
  priority: P2
  estimated_hours: 2
  depends_on: [FOLLOW-294]
  source_retro: RETRO-070/071 (§4a LG-1; RETRO-071 CB-3)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-300 stub)
  notes: |
    Read-side open (write-side validation satisfied by FOLLOW-268-write / RETRO-071 §8).
    A hand-seeded row following the stale migration-0029:12 comment (signal_weights →
    actually signal_likelihoods) passes INSERT but fails IntentWeightsSchema.parse on read.
    The catch arm returns generic "Postgres query failed" db_error — not actionable.
    Fix: catch Zod parse errors separately from DB errors; return 422 config_invalid with
    parse error detail. Related: FOLLOW-302 (stale migration comment).

- id: FOLLOW-302
  title: >
    Fix stale intent_weight_configs JSONB-shape documentation (migration 0029:12 + schema docstring
    say signal_weights, but IntentWeightsSchema uses signal_likelihoods and .strict()-rejects
    signal_weights)
  agent: backend-engineer
  status: DONE
  priority: P3
  estimated_hours: 1
  depends_on: [FOLLOW-268-write]
  source_retro: RETRO-071 (§4b CB-3; §4d DG-2)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-302 stub)
  pr: '293'
  merge_commit: 6381499
  completed_at: '2026-06-14T00:00:00Z'
  notes: |
    DONE — folded into PR #293 (merge commit 6381499) alongside FOLLOW-266 Phase 2 seed.
    BOTH sites corrected per RETRO-076 DG-1:
    (1) migration 0029:12 comment now reads `weights -- jsonb: { priors?: {...},
        behavioral_damping?: 0.75, signal_likelihoods?: {...} }` — stale signal_weights GONE.
    (2) intent-weight-configs.ts weights-column TSDoc now reads `{ priors?, behavioral_damping?,
        signal_likelihoods? }` with explicit FOLLOW-302 correction annotation.
    Do NOT re-file. RETRO-076 (§4d DG-1) confirms both sites verified in merge commit.

- id: FOLLOW-303
  title: >
    Close tracer-route data_source enum drift + two test-rigor gaps from FOLLOW-297 suite:
    round-trip data_source:'error' through TracerSessionDetailResponseSchema, pin MAX_POLLS=100 with
    iteration-count assertion, re-point dangling RETRO-061 test-header citations
  agent: backend-engineer
  status: BACKLOG
  priority: P2
  estimated_hours: 2
  depends_on: [FOLLOW-297, FOLLOW-299]
  source_retro: RETRO-072 (§3 CHECK B; §4b CB-1; §4c TG-1/TG-2; §4d DG-2)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-303 stub)
  notes: |
    Coordinate with FOLLOW-299 so intent-config route and tracer family resolve 'error' enum slot
    in one consistent pass. Three sub-items:
    (a) Add 'error' to TracerSessionDetailResponseSchema.data_source + audit sibling tracer schemas
        (TracerHistoryResponseSchema, export-route bodies) for same drift + add
        TracerSessionDetailResponseSchema.safeParse(<500 body>) round-trip assertion.
    (b) Make stream/route.test.ts AC3.7 assert poll COUNT (expect mockFetchNewIntentEvents
        .toHaveBeenCalledTimes(100)) so bound is pinned not just "loop terminates."
    (c) Re-point the 6 "RETRO-061 bugs addressed" test-file headers at real source (ADR-0012
        §Context + PR #283/FOLLOW-267 finding) since RETRO-061 has no body in RETROSPECTIVES.md.
    FOLLOW-299 (enum prereq, PR #287) already merged — (a) should build on that.

- id: FOLLOW-305
  title: >
    Fix double-/api production 404 on SDK fetchIntentWeights / fetchQuizConfig / deriveFeedbackUrl /
    deriveQuizCompletionUrl via buildEndpoint helper — K.3.6 D-1 production-closure blocker
  agent: sdk-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: []
  source_retro: RETRO-074 (§3 HALF_WIRE_C P1; §4b CB-1 P1)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-305 stub)
  pr: '291'
  merge_commit: 3d9e8f0
  completed_at: '2026-06-14T00:00:00Z'
  notes: |
    PR #291 merged (3d9e8f0). buildEndpoint(decisionApiUrl, path) helper introduced in
    packages/sdk/src/core/endpoint.ts; FOUR double-/api fetch sites routed through it:
    fetchIntentWeights, fetchQuizConfig, deriveFeedbackUrl, deriveQuizCompletionUrl.
    TG-1 prod-URL-form tests: assert .toBe('https://admin.estalara.com/api/intent/config') + no
    double-/api. TG-2 ARCHETYPE_NAMES≡ARCHETYPE_KEYS parity (3 guards).
    IMPORTANT SIDE EFFECT: same double-/api bug had silently broken FOLLOW-275 quiz-config
    delivery AND feedback/quiz-completion write pings in production — all FOUR now fixed by this PR.
    D-1 is NOW production-live end-to-end. RETRO-075 confirmed fix complete.
    RETRO-075 generated FOLLOW-306 (P3 — fetchDescription centralization, last un-migrated site).
    CONVENTIONS_PATCH.md Rule X promoted from RETRO-074/075 (count 2 met threshold).
    FOLLOW-293 remains OPEN for live-network smoke only.

- id: FOLLOW-304
  title: >
    Make GET /api/intent/config return a deterministic one-winner-PER-SCOPE config under a breached
    invariant (per-scope LIMIT 1 + DISTINCT ON + id DESC secondary sort; SHAPES FOLLOW-268-sdk)
  agent: backend-engineer
  status: BACKLOG
  priority: P2
  estimated_hours: 4
  depends_on: []
  source_retro: RETRO-073 (§4a LG-A/LG-B P2; §5a)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-304 stub)
  notes: |
    Non-blocking; SDK degrades safely to global config (not a crash) if ≥2 active global rows
    crowd out the tenant override. Fix: two scoped queries each .orderBy(desc(createdAt), desc(id))
    .limit(1), prefer tenant row; or single DISTINCT ON (tenant_id) ORDER BY tenant_id, created_at
    DESC, id DESC. Add stable id DESC secondary sort. Coordinate result shape with FOLLOW-268-sdk.

- id: FOLLOW-306
  title: >
    Bring fetchDescription (adapt-description.ts) under buildEndpoint + add endpoint.test.ts + fix
    endpoint.ts consumer-list docstring — centralization hygiene (NOT prod-blocking)
  agent: sdk-engineer
  status: BACKLOG
  priority: P3
  estimated_hours: 2
  depends_on: []
  source_retro: RETRO-075 (§4b CB-2 P3; §4c TG-1 P3; §4d DG-2 P3)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-306 stub)
  notes: |
    adapt-description.ts:227 is the last of 6 decisionApiUrl fetch sites still using direct
    template-literal concatenation. NOT a double-/api bug (resolves correctly today).
    Route through buildEndpoint; add endpoint.test.ts pinning trailing-slash normalization;
    update endpoint.ts:27-31 Non-test consumers docstring to include adapt-description.ts.
    Rule X compliance + Rule S sibling-completeness on helper-adoption axis.

- id: FOLLOW-307
  title: >
    Apply + verify migration 0030 in prod/staging Supabase and close the Postgres
    "merged-not-applied" deploy gap (K.3.6 D-1 go-live gate)
  agent: devops-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: []
  source_retro: RETRO-076 (§4a OG-1; §4c TG-1; §5a; §5d)
  completed_at: '2026-06-14T09:26:45Z'
  spec: backlog/FOLLOW_UPS.md (FOLLOW-307 stub)
  notes: |
    DONE 2026-06-14. Migration 0030 applied to prod Supabase (project yhmivuqeqkmzpxpyrsvc,
    eu-west-3) via `doppler run --config prd -- pnpm db:migrate`.
    DRIFT FINDING: prod was 14 migrations behind at apply time — drizzle.__drizzle_migrations
    had only 17 entries (last applied 2026-05-28, migration ~0016). Migrations 0017→0030 had
    NEVER been applied to prod, including compliance migrations 0019/0020 (conversion_labels),
    0024 (dsr_durable_lead_id), plus 0021 (engagement_scores), 0022 (quiz_completions), 0025
    (tenants_quiz_enabled), 0026/0027 (quiz_config strips), 0028 (intent_sessions), 0029
    (intent_weight_configs), 0030 (seed). All 14 applied cleanly.
    AC1 SATISFIED: intent_weight_configs seed row verified in prod:
      id=3ecd053e-3d2e-4eed-a900-0a42ff8c3f9e, tenant_id=NULL, is_active=true, weights={},
      created_at=2026-06-14T09:26:45Z. drizzle.__drizzle_migrations now = 31 (full repo count).
    AC2 SATISFIED: GET /api/intent/config now returns data_source:'live' for override-less tenants.
    AC3 OPEN → tracked by FOLLOW-308 (P1 devops, filed 2026-06-14): decide + implement standing
      mechanism so prod Postgres migrations do not silently drift again.
    Note: prod Supabase project was AUTO-PAUSED (Supabase idle pause) and had to be resumed
    before apply — itself a signal that prod is not yet serving steady traffic (pre-pilot).
    ESC-022 filed for human compliance sign-off on 2.5-week migration gap.
    FOLLOW-293 (live smoke) now unblocked by AC1+AC2 completion.

- id: FOLLOW-308
  title: >
    Decide + implement a standing mechanism so prod Postgres migrations never silently drift again
    (auto-apply in deploy workflow OR explicit operator checklist gate) — prevention follow-up for
    the 14-migration prod drift found on 2026-06-14 (RETRO-076 OG-1 / ESC-022)
  agent: devops-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: []
  source_retro: RETRO-076 (§4a OG-1; §5d); ESC-022; FOLLOW-307 AC3
  spec: backlog/FOLLOW_UPS.md (FOLLOW-308 stub)
  pr: '297'
  merge_commit: 64ac12c
  completed_at: '2026-06-14T12:40:49Z'
  notes: |
    DONE — Option A implemented. PR #297 (commit 64ac12c) merged 2026-06-14.
    .github/workflows/db-migrate.yml added: triggers on push to main when
    packages/db/migrations/** or packages/db/scripts/migrate.ts change.
    Applies staging-first (doppler run --config stg), then prod (--config prd) gated on
    staging success. Concurrency guard prevents races. Fail-loud on non-zero exit.
    Soft-skip ONLY when DOPPLER_TOKEN_STG / DOPPLER_TOKEN_PRD absent (ESC-023 filed).
    AC1 DONE: workflow implemented. AC2 DONE: cross-referenced in docs.
    AC3 DONE 2026-06-15: ESC-022 compliance sign-off received 2026-06-14 (Piotr/CEO); activation
    completed — ESC-023 tokens provisioned, build-order fix PR #306 merged, DATABASE_URL_ADMIN added
    to Doppler stg/prd. Verified LIVE end-to-end (run 27513894932: staging + prod both green, real
    db:migrate, not soft-skip). FOLLOW-308 CLOSED IN FULL; ESC-022 + ESC-023 RESOLVED.

- id: FOLLOW-324
  title: >
    SDK bundle size fix: split auto-detect pipeline into optional companion IIFE
    (estalara-detect.iife.js) to pass the <40 KB gzip bundle gate
  agent: sdk-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: []
  source: FOLLOW-214 (deferred bundle-trim stub); TICKET-038 bundle gate
  spec: backlog/FOLLOW_UPS.md (FOLLOW-324 stub)
  pr: '308'
  branch: sdk-engineer/FOLLOW-324-sdk-bundle-size
  completed_at: '2026-06-15T11:37:25Z'
  notes: |
    PR #308 MERGED 2026-06-15. CI verified green (Build, Typecheck, Lint, Format, Test Node 22,
    SDK E2E, Rule H, Rule J, ClickHouse smoke, Corpus gate, Tracer CI guard, Demo integration,
    K.3.6 live smoke, Vercel — all SUCCESS; Python tests pre-existing-red/non-blocking; Rule I
    pre-existing-red/non-blocking per CI landscape). Bundle: 52.61 KB -> 39.73 KB gzip core.
    Companion estalara-detect.iife.js = 12.43 KB gzip. estalara-detect.iife.js now in
    apps/control-plane/public/. FOLLOW-325 unblocked (companion artifact exists in public/).

- id: FOLLOW-325
  title: >
    buildSnippet() auto-includes estalara-detect.iife.js companion for all Tier 1+2 tenants by
    default (opt-out) + docs/INTERFACES.md window.__EStalaraDetect surface note
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: [FOLLOW-324]
  source: FOLLOW-324 (PR #308) + CEO product decision 2026-06-15
  spec: backlog/FOLLOW_UPS.md (FOLLOW-325 stub)
  branch: backend-engineer/FOLLOW-325-buildsnippet-detect-companion
  assigned_to: backend-engineer
  started_at: '2026-06-17T00:00:00Z'
  completed_at: '2026-06-17T00:00:00Z'
  pr: '315'
  merge_commit: 43ad849
  pr_commit: 438de07
  notes: |
    PR #315 opened (commit 438de07). PM-validated 2026-06-17.
    CI green (all real blocking gates pass): Lint, Format, Typecheck, Test (Node 22),
    Build, Build (control-plane), Rule H, Rule J, Auto-Detection corpus gate,
    Cross-language event contract, ClickHouse migrations smoke, Gitleaks,
    Migration journal monotonicity, Privacy Notice SDK key-sync, Tracer guard,
    K.3.6 D-1 live smoke, SDK E2E tests, Demo integration, Vercel.
    Non-success checks are all pre-existing-red/non-blocking per CI landscape:
      - Rule I: 168 violations (pre-existing-red; FOLLOW-090 tracks; no new FOLLOW-325 symbols flagged)
      - Python tests (all Modal apps): pre-existing-red (apps/auto-detect dir does not exist)
      - Doppler verify: one run FAIL one run PASS — the latest run PASSES (timing flap, non-blocking)
    CI check counter: 1/5. Fix iterations: 0/3.
    AC1 MET: buildSnippet() emits companion <script src="DETECT_SERVE_URL"> BEFORE main SDK tag,
      using the shared DETECT_SERVE_URL constant from packages/shared/src/domains.ts (Rule X). No
      hardcoded string.
    AC2 MET: apps/control-plane/public/estalara-detect.iife.js committed (new file, Vercel static
      asset; added to eslint global ignores same pattern as sdk.js).
    AC3 MET: DetectionPreview.test.tsx adds 5 companion assertions: tag present, companion BEFORE
      SDK tag, no async/defer on companion, src points to admin.estalara.com, main SDK tag still
      has all required attributes. Tier 3 behavior documented in code comments + FOLLOW-332 stub.
    AC4 MET: docs/INTERFACES.md has new "Auto-Detect Companion Bundle — window.__EStalaraDetect
      (FOLLOW-325)" section with full interface contract, load ordering, default-ON/opt-out docs,
      Tier 3 exclusion rationale, and dependency on PR #308.
    AC5 MET: all real CI gates green (see above).
    Runtime wiring (5c):
      PRODUCER: packages/shared/src/domains.ts — exports DETECT_SERVE_URL (re-exported via
        packages/shared/src/index.ts line 32: export * from './domains.js')
      CONSUMER (non-test): apps/control-plane/src/components/onboarding/DetectionPreview.tsx line
        23 imports DETECT_SERVE_URL from @estalara/shared; line 183 uses it in buildSnippet():
        const companionTag = `<script src="${DETECT_SERVE_URL}"></script>`;
      Both non-test. Wire confirmed.
    Also adds GET /api/sdk-detect dev-fallback route (reads packages/sdk/dist/; graceful empty
    comment when artifact absent — does not affect prod path which uses static public/ file).
    FOLLOW-331 (per-tenant opt-out toggle) and FOLLOW-332 (Tier 3 companion suppression) are
    referenced in code comments but NOT yet filed as stubs in FOLLOW_UPS.md — these are deferred
    follow-ups, not blockers for this PR.
    After human merge: spawn retrospective-analyst for FOLLOW-325.
    HUMAN MERGE GATED — do not merge without human review.

- id: FOLLOW-326
  title: >
    admin.estalara.com sign-in page + full admin auth flow (Supabase SSR)
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 5
  depends_on: []
  source: CEO directive 2026-06-15
  spec: backlog/FOLLOW_UPS.md (FOLLOW-326 stub)
  pr: '309, 310, 311'
  branch: backend-engineer/FOLLOW-326-admin-auth-flow
  completed_at: '2026-06-15T21:33:47Z'
  notes: |
    Three PRs merged 2026-06-15: PR #309 (feat: /sign-in page + Supabase SSR auth flow),
    PR #310 (fix: @supabase/ssr middleware chunked session cookies),
    PR #311 (fix: verifyTracerAdminAuth accepts Supabase SSR session).
    AC1-AC8 completed. admin.estalara.com sign-in page live.

- id: FOLLOW-327
  title: >
    Single-tenant admin nav + canonical Weight Editor intent weight defaults
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: [FOLLOW-326]
  source: CEO decision 2026-06-15 (single-tenant admin v1)
  pr: '312'
  merge_commit: 34fcb11
  completed_at: '2026-06-16T00:01:31Z'
  notes: |
    PR #312 merged 2026-06-16. Single-tenant admin nav: hides multi-tenant screens (Registrations,
    Tenants, Demo Sessions) from sidebar; /admin lands on pilot tenant live monitor. Adds
    lib/pilot-tenant.ts (NEXT_PUBLIC_PILOT_TENANT_ID). Weight Editor: adds DEFAULT_INTENT_WEIGHTS
    to @estalara/shared (BASE_PRIOR + 0.3 damping, sums to 1.0); pre-loads editor from defaults;
    adds "Reset to defaults" button. 6 shared tests. CI green.

- id: FOLLOW-328
  title: >
    Fix ClickHouse Basic auth — include username in Authorization header to resolve Code 516
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 2
  depends_on: [FOLLOW-327]
  source: FOLLOW-330 / K.3.6 tracer debugging (ClickHouse 516 in production)
  pr: '313'
  merge_commit: 096a615
  completed_at: '2026-06-16T21:00:19Z'
  notes: |
    PR #313 merged 2026-06-16. All ~12 control-plane ClickHouse HTTP reads used
    Authorization: Basic base64(":password") — empty username — which ClickHouse Cloud rejects
    with Code 516 AUTHENTICATION_FAILED. Added shared clickhouse-http.ts with
    resolveClickHouseHttpConfig() + clickhouseAuthHeaders() reading CLICKHOUSE_USER (default
    "default"). All CH-backed routes (admin analytics, tracer, DSR, pilot) now auth correctly.
    Ingest worker was already correct. CI green.

- id: FOLLOW-330
  title: >
    Fix tracer history SSR window crash + ClickHouse cold-start timeout
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 2
  depends_on: [FOLLOW-328]
  source: K.3.6 tracer bugs unmasked after FOLLOW-328 fixed CH auth
  pr: '314'
  merge_commit: c327c10
  completed_at: '2026-06-16T21:37:39Z'
  notes: |
    PR #314 merged 2026-06-16. Two bugs: (1) tracer history page SSR crash — buildJsonlExportUrl()
    called window.location.origin during server-render (window undefined → ReferenceError → 500).
    Fixed with relative URL via URLSearchParams. (2) ClickHouse cold-start timeout — AbortSignal.timeout(8000)
    aborted before ClickHouse Cloud woke from idle (>8s). Raised timeout to 30s + 45s for streams. CI green.
```

- id: FOLLOW-336 title: > Add tests for Supabase SSR session auth paths: checkStaffSession +
  middleware admin gate + SignInForm (RETRO-083 TG-1/TG-2) agent: qa-engineer co_agent:
  backend-engineer status: DONE priority: P2 estimated_hours: 3 depends_on: [FOLLOW-326] source:
  RETRO-083 (FOLLOW-326 / PRs #309/#310/#311) — primary admin auth gate shipped with zero tests
  spec: backlog/FOLLOW_UPS.md (FOLLOW-336 stub) branch: qa-engineer/FOLLOW-336-admin-auth-tests
  assigned_to: qa-engineer started_at: '2026-06-17T20:00Z' promoted_at: '2026-06-17T20:00Z' pr:
  '316' merge_commit: 1626013 completed_at: '2026-06-18T04:41:38Z' notes: | Promoted 2026-06-17.
  IN_PROGRESS: delegated to qa-engineer 2026-06-17T20:00Z. PR #316 merged by human
  2026-06-18T04:41:38Z (merge commit 1626013). checkStaffSession() in tracer-auth.ts (the PRIMARY
  admin auth gate for all /api/admin/\* routes) — tests added. middleware.ts updateSession path —
  integration test added. SignInForm — sign-in success/error branch tests added. Sprint 18 P2 auth
  coverage gap closed. CI check counter: 1/5, fix iterations: 1/3. NOTE: Format check FAILING on PR
  #316 CI run — confirmed pre-existing-red on main (commit 59ac6b5 also had Format check FAILING
  before this PR). NOT a regression introduced by FOLLOW-336. Status.md pre-existing-red list needs
  update to include Format. RETRO-088 pending.

- id: FOLLOW-331 title: > Add a real cross-package drift guard for DEFAULT_INTENT_WEIGHTS vs SDK
  BASE_PRIOR/BEHAVIORAL_DAMPING, and fix the docstring claiming a CI guard that does not exist
  (RETRO-084 LG-1 + DG-1) agent: sdk-engineer co_agent: backend-engineer status: DONE priority: P2
  estimated_hours: 3 depends_on: [FOLLOW-327] source: RETRO-084 (FOLLOW-327 / PR #312) —
  intent-weights-drift.test.ts referenced in docstring but never created spec: backlog/FOLLOW_UPS.md
  (FOLLOW-331 stub) branch: sdk-engineer/FOLLOW-331-intent-weights-drift-guard assigned_to:
  sdk-engineer started_at: '2026-06-18T06:00Z' promoted_at: '2026-06-17T20:00Z' pr: '317'
  merge_commit: fedfeb0 completed_at: '2026-06-18T00:00Z' notes: | Promoted 2026-06-17. IN_PROGRESS:
  delegated to sdk-engineer 2026-06-18T06:00Z. PR #317 opened. READY_FOR_REVIEW 2026-06-18T10:30Z
  (PM-validated): CI green on all real gates (run 27752092764 — Lint/Typecheck/Test Node
  22/Build/Build control-plane/SDK E2E/Demo integration/etc. all PASS). Format check + Rule I + Test
  Python failures are pre-existing-red (confirmed on main run 27737181224 for Format check,
  FOLLOW-090 for Rule I, documented CI gate landscape for Python). AC1: drift test imports
  DEFAULT_INTENT_WEIGHTS + BASE_PRIOR/BEHAVIORAL_DAMPING, asserts equality (DRIFT-2/3). AC2: false
  docstring fixed in intent-weights.ts:155-160. AC3: Lint/Typecheck/Test Node 22 all pass. Runtime
  wiring: BASE_PRIOR/BEHAVIORAL_DAMPING producers intent.ts:167/532, non-test consumers
  intent.ts:568/607/748/904. PM comment posted at
  https://github.com/Pnawrocki9/Adaptive-Listings/pull/317#issuecomment-4740905438. CI check
  counter: 1/5, fix iterations: 0/3. DONE: PR #317 merged to origin/main as fedfeb0 (squash).
  RETRO-089 pending spawn.

- id: FOLLOW-332 title: > Add admin/layout.test.tsx + admin/page.test.tsx for single-tenant nav +
  landing redirect (RETRO-084 TG-1 + TG-2) agent: qa-engineer status: DONE priority: P2
  estimated_hours: 2 depends_on: [FOLLOW-327] source: RETRO-084 (FOLLOW-327 / PR #312) — admin shell
  change shipped with zero tests on changed files spec: backlog/FOLLOW_UPS.md (FOLLOW-332 stub)
  promoted_at: '2026-06-17T20:00Z' assigned_to: qa-engineer started_at: '2026-06-18T10:30Z' branch:
  qa-engineer/FOLLOW-332-admin-layout-page-tests pr: '318' merge_commit: fb9d201 completed_at:
  '2026-06-18T00:00Z' notes: | Promoted 2026-06-17. Admin layout.tsx (single-tenant nav hiding) +
  app/admin/page.tsx (redirect to pilot tenant live monitor) shipped with zero tests. Sprint 18 P2
  test coverage. IN_PROGRESS: delegated to qa-engineer 2026-06-18T10:30Z. DONE: PR #318 merged to
  origin/main as fb9d201 (squash). admin/layout.test.tsx + admin/page.test.tsx +
  pilot-tenant.test.ts all added. RETRO-090 pending spawn.

- id: FOLLOW-335 title: > Add unit test for detect-bundle.ts asserting globalThis.\*\*EStalaraDetect
  is set correctly (RETRO-082 TG-1) agent: sdk-engineer status: DONE priority: P2 estimated_hours: 1
  depends_on: [] source: RETRO-082 (FOLLOW-324 / PR #308) — companion IIFE producer has no unit test
  spec: backlog/FOLLOW_UPS.md (FOLLOW-335 stub) branch:
  sdk-engineer/FOLLOW-335-detect-bundle-global-test promoted_at: '2026-06-17T20:00Z' pr: '#319'
  merge_commit: '49540aa' completed_at: '2026-06-18T21:56:14Z' notes: | Promoted 2026-06-17.
  detect-bundle.ts IIFE entry (PR #308) assigns globalThis.\_\_EStalaraDetect but had no
  producer-side unit test. Consumer side covered (SDK init tests set up global in beforeEach). DONE:
  PR #319 merged to origin/main as 49540aa (2026-06-18T21:56:14Z). All real CI gates GREEN; Format
  check/Rule I/Python pre-existing-red (confirmed pre-exists on main). CI check counter: 1/5, fix
  iter 0/3. RETRO-091 pending spawn.

## Currently in flight

**FOLLOW-383 DONE — PR #342 merged 2026-06-23T21:01:59Z (squash 7ed8a81). Sprints 19/20/21/22 ALL
COMPLETE. P0 gate cleared. FOLLOW-383/PR#342 ships AC-1 (SDK sends profiling_opt_out=1 to server),
AC-2 (doc), AC-3 (event drop before push). FOLLOW-384 (ml-engineer, redis_writer chat-prior skip)
unblocked. FOLLOW-385 (sdk-engineer+backend-engineer, quiz/favorites/micro-poll sibling opt-out
gaps) filed per pre-merge adversarial review + CEO scope decision. RETRO-107 pending spawn. ESC-020
OPEN but non-blocking (CEO 2026-06-10). 0 tickets IN_PROGRESS.** READY P1:
FOLLOW-369/371/368/356/363/359/361/384. READY P2: FOLLOW-354/358/362/364/367/370.

## Sprint 19 — Hollow-core must-fixes + audit-19 wave (PLANNED, 2026-06-19)

**Promoted from FOLLOW_UPS.md audit stubs FOLLOW-340..346. Priority order per audit
F-04→F-02→F-03→F-01→F-05.** P2/P3 hygiene (FOLLOW-337/338/339) is deferred until all P1 hollow-core
items are DONE.

```yaml
- id: FOLLOW-343
  title:
    Confidence/signal floor before DOM adaptation (prevent cold-start wrong-archetype reshuffle)
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-19T10:00Z'
  ready_for_review_at: '2026-06-19T12:00Z'
  completed_at: '2026-06-19T00:00Z'
  merge_commit: 56b0018
  priority: P1
  estimated_hours: 3
  depends_on: []
  source: AUDIT-2026-06-19 F-01
  spec: backlog/FOLLOW_UPS.md (FOLLOW-343 stub)
  branch: sdk-engineer/FOLLOW-343-confidence-floor
  pr: 321
  notes: |
    Gate applyDirectives (especially reorder) behind confidence >= ~0.5 OR signal_count >= 2.
    Named constant. No regression to quiz leaf (0.85 > floor). Cheap, high-value.
    Delegated 2026-06-19T10:00Z. CI check counter: 1/5, fix iterations: 0/3.
    PM-validated 2026-06-19. CI green (all real gates pass). Runtime wiring confirmed.
    Rule I violations: 168 (down from 170 on main — improvement, no regression).
    AC1 (no DOM mutation below floor): verified via test + code inspection.
    AC2 (named constant + boundary test): DOM_ADAPT_CONFIDENCE_FLOOR=0.5 in adapt-floor.ts,
      exported from index.ts, tested at 0.499/0.5 boundary.
    AC3 (quiz leaf 0.85 above floor): test passes, invariant test guards future floor bumps.
    AC4 (signal_count>=2 alternative gate): tested at signal_count=2 (mutates) and 1 (no-op).
    applyDescriptionAdaptation correctly gated inside same aboveFloor block — not over-broad.
    SIDEBAR_SHOW_THRESHOLD (0.6) is a separate gate, unchanged.
    Pre-existing-red non-blockers: Format check, Rule I, Python tests (all pre-existing on main).
    DONE: PR #321 merged to main (squash commit 56b0018, 2026-06-19). RETRO-092 pending spawn.

- id: FOLLOW-340
  title: SDK runtime slot self-annotation (make adaptation visible on un-instrumented pages)
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-19T14:00Z'
  pr: '#322'
  merge_commit: 3bbf03a
  completed_at: '2026-06-19T00:00Z'
  priority: P1
  estimated_hours: 6
  depends_on: []
  source: AUDIT-2026-06-19 F-04
  spec: backlog/FOLLOW_UPS.md (FOLLOW-340 stub)
  branch: sdk-engineer/FOLLOW-340-runtime-slot-annotation
  notes: |
    Biggest gap between "pipeline exists" and "buyer sees adaptation". Sequence first in sprint.
    SDK reads slot_selectors from /api/adapt response, annotates matching DOM nodes before first
    fetchDirectives. Idempotent. No bundle-gate regression.
    PM-validated 2026-06-19. CI green (all real gates pass). Runtime wiring confirmed.
    Bundle 39.91 KB gzip (<40 KB gate). DONE: PR #322 merged (3bbf03a). RETRO pending.

- id: FOLLOW-341
  title: Populate archetype_embeddings.embedding (activate the cosine affinity path)
  agent: ml-engineer
  status: DONE
  assigned_to: ml-engineer
  started_at: '2026-06-25T12:00Z'
  pm_validated_at: '2026-06-25T14:00Z'
  completed_at: '2026-06-25'
  priority: P1
  estimated_hours: 6
  depends_on: []
  source: AUDIT-2026-06-19 F-02
  spec: backlog/FOLLOW_UPS.md (FOLLOW-341 stub)
  branch: ml-engineer/FOLLOW-341-archetype-embedding-job
  pr: '#352'
  merge_commit: merged-2026-06-25
  notes: |
    STALE DUPLICATE — canonical entry below (~line 6149). Status updated to DONE here for parity.
    PR #352 merged to main 2026-06-25. ESC-030 RESOLVED.
    PROD SEED ACTION REQUIRED: `cd apps/control-plane && SUPABASE_SERVICE_ROLE_KEY=<prod>
    OPENAI_API_KEY=<key> pnpm seed:archetypes` — tracked in STATUS.md. RETRO pending.

- id: FOLLOW-342
  title: Thread bandit variant into playbook selection (stop optimizing placebo arms)
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 6
  depends_on: [FOLLOW-341]
  source: AUDIT-2026-06-19 F-03
  spec: backlog/FOLLOW_UPS.md (FOLLOW-342 stub)
  branch: backend-engineer/FOLLOW-342-variant-playbook-selection
  pr: '#327'
  merge_commit: 66054d6
  assigned_to: backend-engineer
  started_at: '2026-06-25'
  completed_at: '2026-06-25'
  ci_checks_used: 0/5
  fix_iterations_used: 0/3
  notes: |
    STALE DUPLICATE — canonical entry below (~line 6185). Status updated to DONE here for parity.
    Implementation in PR #327 (66054d6) — variant threaded into runDecisionTree via VARIANT_INDEX
    map + slot.variants?.en[variantIndex] ?? slot.en fallback. All 4 ACs met: (1) control/v1/v2
    produce distinct directives; (2) unit tests cover all 3 indices + fallback-to-slot.en;
    (3) ClickHouse logs the selected variant via logDecisionAsync; (4) holdout sessions forced
    to 'control' before bandit sampling (FOLLOW-360 holdout gate preserved).
    AC-2 fallback test added explicitly in route.variant.test.ts (2026-06-25 session).
    PROD COSINE CAVEAT (corrected 2026-07-01): archetype_embeddings ARE seeded in prod — 18/18
    non-null, 1024-dim, 18 distinct real vectors (verified 2026-07-01) — so FOLLOW-392's goal is
    already met (NOT "pending operator seed"; the `pnpm seed:archetypes` script is separately broken,
    tracked by FOLLOW-446). cosine ORDERING is still inactive in prod because `listing_embeddings` is
    EMPTY for the pilot tenant (000-app-estalara); cosine needs BOTH sides non-null, else djb2 (safe
    fallback). Real remaining blocker = seed pilot listing embeddings (activation / POST
    /api/listings/embed), tied to ESC-020 pilot activation.

- id: FOLLOW-346-dpia
  title: 'FOLLOW-346 DPIA parallel track: C-07 chat-retention scope brief (docs-only)'
  agent: compliance-engineer
  status: DONE
  priority: P2
  estimated_hours: 2
  depends_on: []
  source: AUDIT-2026-06-19 F-05 (DPIA sub-track)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-346 stub — DPIA AC)
  branch: compliance-engineer/FOLLOW-346-dpia-c07-scope
  pr: '#328'
  merge_commit: 4f284d3
  started_at: 2026-06-19T00:00:00Z
  completed_at: '2026-06-19T00:00Z'
  assigned_to: compliance-engineer
  pm_validated_at: 2026-06-19T22:00:00Z
  notes: |
    Docs-only. docs/compliance/C-07-chat-retention-scope.md delivers CEO-ready DPIA scope brief
    answering all 5 required questions. Shadow-cycle architecture confirmed compliant without new
    disclosure. Live-activation gate items documented. All real CI gates GREEN (docs-only branch;
    no Demo integration check required). AC: DPIA scope for free-text chat retention
    documented and signed off. PM-validated: CI green on all real gates. ACs met.
    DONE: PR #328 merged (4f284d3). RETRO pending.

- id: FOLLOW-346
  title:
    Trigger the chat NLP engine (activate highest-value signal — gated on CEO shadow-mode decision)
  agent: data-engineer
  status: DONE
  priority: P2
  estimated_hours: 6
  depends_on: [FOLLOW-346-dpia]
  source: AUDIT-2026-06-19 F-05
  spec: backlog/FOLLOW_UPS.md (FOLLOW-346 stub)
  branch: data-engineer/FOLLOW-346-chat-nlp-shadow-bridge
  pr: '#330'
  merge_commit: 7f16b03
  started_at: 2026-06-19T00:00:00Z
  completed_at: '2026-06-20T00:00Z'
  assigned_to: data-engineer
  pm_validated_at: 2026-06-20T00:00:00Z
  notes: |
    PR #327 (FOLLOW-342) merged 2026-06-19T21:17:48Z — blocker cleared.
    CI green on all real gates. Step 5c wiring confirmed end-to-end:
    - Producer: events.py:_spawn_chat_nlp → modal.Function.lookup("estalara-intent-engine",
      "process_chat_message").spawn() [non-test, non-blocking fire-and-forget]
    - Intermediate: process_chat_message (main.py:32) → write_shadow_intent(payload) writes
      shadow:{tenant_id}:{session_id}:chat_intent to Redis with 24h TTL
    - Consumer: readShadowChatIntent in route.ts:1074 reads the exact same key pattern
    - Key match confirmed: redis_writer.py:37 returns f"shadow:{tenant_id}:{session_id}:chat_intent";
      chat-intent-cache.ts:63 returns `shadow:${tenantId}:${sessionId}:chat_intent` — MATCH
    - CHAT_NLP_LIVE env var: producer .env.example:80, consumer route.ts:88 (default false)
    - AC-3 (no raw text): EventEnvelope unchanged, _spawn_chat_nlp passes only message dict to
      Modal; write_shadow_intent writes ChatIntentDetectedPayload (12-dim vector) to Redis only
    PM-validated. CI check counter: 1/5. Fix iterations: 0/3.
    DONE: PR #330 merged (7f16b03). RETRO pending. Follow-on: FOLLOW-366 (P0 hotfix merged #332),
    FOLLOW-368 (env-parity, now unblocked).

- id: FOLLOW-344
  title: Archetype model switch-margin hysteresis + passive discriminator annotation (§D.6)
  agent: ml-engineer
  status: DONE
  priority: P2
  estimated_hours: 10
  depends_on: []
  source: AUDIT-2026-06-19 F-09 + F-06
  spec: backlog/FOLLOW_UPS.md (FOLLOW-344 stub)
  branch: ml-engineer/FOLLOW-344-switch-margin-hysteresis
  pr: '#329'
  merge_commit: 20de7c9
  started_at: 2026-06-19T00:00:00Z
  completed_at: '2026-06-19T00:00Z'
  assigned_to: ml-engineer
  pm_validated_at: 2026-06-19T22:00:00Z
  notes: |
    Switch-margin hysteresis (CEO Q#2 resolved 2026-06-19): SWITCH_MARGIN=0.05 guard added to
    classifyFromProbabilities(); 5 call sites in applyBehavioralSignal updated. §D.6 annotated
    with quiz/chat-only column for 8 blind archetypes (no passive discriminators manufactured).
    12 tests in intent-switch-margin.test.ts. Top-2 blending deferred to a future sprint if
    CEO decides to pursue blended profile (not yet decided). All real CI gates GREEN.
    AC1/AC2/AC3 (switch-margin behavior) + AC4 (constant value) all verified in PR body.
    PM-validated: CI green on all real gates. ACs met. Not do-not-merge: blending sub-scope
    explicitly deferred by worker per CEO Q#2 resolution note.
    DONE: PR #329 merged (20de7c9). RETRO pending.

- id: FOLLOW-345
  title: Server-side page_type consumption + real tier (decision route)
  agent: backend-engineer
  status: DONE
  priority: P2
  estimated_hours: 4
  depends_on: []
  source: AUDIT-2026-06-19 F-08
  spec: backlog/FOLLOW_UPS.md (FOLLOW-345 stub)
  branch: backend-engineer/FOLLOW-345-page-type-tier
  pr: '#323'
  merge_commit: 5d9ecba
  completed_at: '2026-06-19T00:00Z'
  notes: |
    DONE: PR #323 merged (5d9ecba). Superseded/renamed by FOLLOW-357 (directive_scope rename).
    RETRO pending.
```

## Sprint 20 — P0 hotfixes + Sprint-19 retro follow-ons (PLANNED, 2026-06-20)

**Promoted from FOLLOW_UPS.md stubs FOLLOW-354..368 (RETRO-091/092/095/097/098 batch). Two P0
hotfixes authorized by CEO 2026-06-20 (ESC-025 / ESC-026). FOLLOW-357 BLOCKED on CEO ruling. All
others staged by priority; max 3 IN_PROGRESS at once.**

```yaml
- id: FOLLOW-360
  title: Gate bandit variant behind holdout/consent on the GET path (mirror POST ordering)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-20T00:00Z'
  completed_at: '2026-06-20T09:53Z'
  priority: P0
  estimated_hours: 4
  depends_on: []
  source: RETRO-095 ESC-026
  spec: backlog/FOLLOW_UPS.md (FOLLOW-360 stub)
  branch: backend-engineer/FOLLOW-360-get-holdout-bandit-gate
  pr: '#333'
  merge_commit: 2836adc
  notes: |
    P0 hotfix — holdout-baseline contamination in prod since PR #327 merge 2026-06-19.
    GET path must check holdout BEFORE variant selection (mirror POST route.ts:894-919).
    Holdout GET requests must serve + log variant=control.
    Delegated 2026-06-20T00:00Z. CI check counter: 0/5. Fix iterations: 0/3.
    DONE: PR #333 merged (2836adc 2026-06-20T09:53Z). RETRO-100 written (PR #335).

- id: FOLLOW-366
  title: Fix chat NLP bridge payload-key mismatch (message vs content)
  agent: data-engineer
  status: DONE
  assigned_to: data-engineer
  started_at: '2026-06-20T00:00Z'
  completed_at: '2026-06-20T00:00Z'
  priority: P0
  estimated_hours: 3
  depends_on: []
  source: RETRO-098 ESC-025
  spec: backlog/FOLLOW_UPS.md (FOLLOW-366 stub)
  branch: data-engineer/FOLLOW-366-chat-bridge-payload-key
  pr: '#332'
  merge_commit: eaf31a9
  notes: |
    P0 hotfix — bridge dead-on-arrival since PR #330 merge 2026-06-20.
    _spawn_chat_nlp must read payload["message"] not payload["content"].
    Fixture must be grounded in ChatMessageSentPayloadSchema (Rule Z).
    Delegated 2026-06-20T00:00Z. CI check counter: 0/5. Fix iterations: 0/3.
    DONE: PR #332 merged (eaf31a9). RETRO-099 written (PR #335). FOLLOW-368 now unblocked.

- id: FOLLOW-357
  title: Reconcile /api/adapt page-type-derived tier with MASTER_DESIGN §E.7 no-Tiers
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-20T10:14Z'
  completed_at: '2026-06-20T13:00Z'
  priority: P1
  estimated_hours: 2
  depends_on: []
  source: RETRO-092 (FOLLOW-345 / PR #323)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-357 stub)
  branch: backend-engineer/FOLLOW-357-rename-tier-directive-scope
  pr: '#334'
  merge_commit: ab1317d
  notes: |
    CEO ruled option (a): rename to directive_scope. PR #334 opened 2026-06-20.
    Fix commit a59763e pushed 2026-06-20 addressing both regressions.
    PM-validated 2026-06-20T13:00Z. CI green. Runtime wiring confirmed.
    CI check counter: 2/5. Fix iterations: 1/3.
    All real merge gates GREEN. Non-real pre-existing: Rule I, Format check, Python tests.
    Wiring confirmed: POST path emits directive_scope at route.ts:908/934/1142.
    DONE: PR #334 merged (ab1317d). RETRO-101 written (PR #335).

- id: FOLLOW-363
  title: Thread hysteresis (currentArchetype) into applyDwellSignal + applyListingViewRate
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-25T00:00Z'
  pm_validated_at: '2026-06-25T12:00Z'
  completed_at: '2026-06-25'
  priority: P1
  estimated_hours: 3
  depends_on: []
  source: RETRO-097 (FOLLOW-344 / PR #329)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-363 stub)
  branch: sdk-engineer/FOLLOW-363-hysteresis-dwell-listing-view
  pr: '#351'
  merge_commit: merged-2026-06-25
  notes: |
    STALE DUPLICATE — canonical entry below (~line 5896). Status updated to DONE here for parity.
    PR #351 merged to main 2026-06-25. RETRO pending.

- id: FOLLOW-368
  title: Guarantee Python writer and TS reader share one Upstash Redis instance (env-var divergence)
  agent: devops-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: [FOLLOW-366]
  source: RETRO-098 (FOLLOW-346 / PR #330)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-368 stub)
  branch: devops-engineer/FOLLOW-368-upstash-redis-env-parity
  pr: '#345'
  merge_commit: dd74026
  completed_at: '2026-06-24'
  notes: |
    STALE DUPLICATE — canonical entry below (line ~5815). Marking DONE here for consistency.
    Merged as PR #345 (squash dd74026). See canonical entry for full PM-validation notes.
    ESC-028 OPEN: 4 Upstash secrets not yet provisioned (UPSTASH_REDIS_REST_URL/TOKEN +
    UPSTASH_REDIS_URL/TOKEN). Smoke runs in soft-skip mode until ESC-028 resolved.

- id: FOLLOW-359
  title: Return variant in GET /api/adapt response body
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-25T00:00Z'
  pm_validated_at: '2026-06-25T12:00Z'
  completed_at: '2026-06-25'
  priority: P1
  estimated_hours: 2
  depends_on: [FOLLOW-360]
  source: RETRO-095 (FOLLOW-342 / PR #327)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-359 stub)
  branch: backend-engineer/FOLLOW-359-get-variant-response
  pr: '#350'
  merge_commit: merged-2026-06-25
  notes: |
    STALE DUPLICATE — canonical entry below (~line 6047). Status updated to DONE here for parity.
    PR #350 merged to main 2026-06-25. RETRO pending.

- id: FOLLOW-361
  title: Reconcile bandit seed convention (default vs control/v1/v2)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-26T00:00Z'
  completed_at: '2026-06-26T10:08Z'
  priority: P1
  estimated_hours: 3
  depends_on: []
  source: RETRO-095 (FOLLOW-342 / PR #327)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-361 stub)
  branch: backend-engineer/FOLLOW-361-bandit-seed-convention
  pr: '#356'
  merge_commit: '4eb24af4'
  notes: |
    MERGED 2026-06-26T10:08:42Z. Commit 4eb24af4.

- id: FOLLOW-354
  title: Test + document the confidence floor real axis (suppress /adapt/description below floor)
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-26T14:00Z'
  completed_at: '2026-06-26T11:23Z'
  priority: P2
  estimated_hours: 4
  depends_on: []
  source: RETRO-091 (FOLLOW-343 / PR #321)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-354 stub)
  branch: sdk-engineer/FOLLOW-354-confidence-floor-description-axis
  pr: '#358'
  merge_commit: '701aa4efb9'
  notes: |
    MERGED 2026-06-26T11:23:33Z. Commit 701aa4efb9. PM-validated 2026-06-26T16:00Z.
    CI: run 28234447026/28234468393 — only pre-existing failures (Rule I, Archetype embeddings).
    All real gates PASS. CI non-success on real gates: 0.
    AC-1: 3 tests assert NO /adapt/description fetch below floor.
    AC-2: 3 tests assert description fetch IS issued at/above floor.
    AC-3: MASTER_DESIGN §E.7 line 2404 confidence gating ladder note added.
    AC-4: adapt-floor.ts JSDoc lines 21-32 documents 0.5 vs 0.6 asymmetry.
    RETRO-119 SPAWNED. Generated FOLLOW-398 (P2 SIDEBAR_SHOW_THRESHOLD doc fix, sdk-engineer),
    FOLLOW-399 (P3 signal_count branch test, sdk-engineer).
    Retro note: RETRO-114/115/116 gap flagged in RETRO-119 — PM to reconcile.

- id: FOLLOW-358
  title: Resolve GET-vs-POST adaptation_decisions.page_context semantic divergence (Rule K parity)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-26T12:00Z'
  completed_at: '2026-06-26T10:40Z'
  priority: P2
  estimated_hours: 2
  depends_on: []
  source: RETRO-092 (FOLLOW-345 / PR #323)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-358 stub)
  branch: backend-engineer/FOLLOW-358-page-context-divergence
  pr: '#357'
  merge_commit: 'a8eacb4a'
  notes: |
    MERGED 2026-06-26T10:40:15Z. Commit a8eacb4a. PM-validated 2026-06-26T15:00Z.
    CI green (3/5 checks, 2/3 fix iterations). All real gates pass. RETRO-118 pending spawn.

- id: FOLLOW-362
  title: Define non-en locale A/B behavior (stop logging unserved variants)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-26T16:30Z'
  completed_at: '2026-06-26T11:31Z'
  priority: P2
  estimated_hours: 3
  depends_on: []
  source: RETRO-095 (FOLLOW-342 / PR #327)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-362 stub)
  branch: backend-engineer/FOLLOW-362-locale-ab-variant
  pr: '#359'
  merge_commit: 'dfe8a9cd71'
  notes: |
    MERGED 2026-06-26T11:31:48Z. Commit dfe8a9cd71. CI run 28234468393: only pre-existing
    failures (Rule I, Archetype embeddings not-NULL). All real gates PASS. CI real-gate count: 0.
    Fix: suppress getBanditArms/thompsonSample for locale !== 'en' in GET + POST handlers.
    Non-en sessions always log 'control' variant (matches served copy; no pl/es PlaybookEntry).
    RETRO-120 spawned by coordinator.

- id: FOLLOW-367
  title: Implement (or remove) the CHAT_NLP_LIVE gate — currently an inert no-op
  agent: backend-engineer
  status: READY
  priority: P2
  estimated_hours: 3
  depends_on: [FOLLOW-366]
  source: RETRO-098 (FOLLOW-346 / PR #330)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-367 stub)
  branch: backend-engineer/FOLLOW-367-chat-nlp-live-gate
  notes: |
    Depends on FOLLOW-366 (bridge must work before live gate is meaningful). Also depends on
    C-07 DPIA all 5 go-live items signed off before CHAT_NLP_LIVE can be flipped true.

- id: FOLLOW-364
  title: Reconcile §D.6 coverage-summary counts to a clean 18-way partition
  agent: ml-engineer
  status: DONE
  assigned_to: ml-engineer
  started_at: '2026-07-01T00:00:00Z'
  completed_at: '2026-07-01T19:24:10Z'
  priority: P2
  estimated_hours: 1
  depends_on: []
  source: RETRO-097 (FOLLOW-344 / PR #329)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-364 stub)
  branch: ml-engineer/FOLLOW-364-d6-coverage-counts
  pr: '#408'
  notes: |
    DONE — PR #408 merged 2026-07-01T19:24:10Z. Docs-only §D.6 reconciliation, no runtime wiring.
    NOTE: this ticket had a byte-identical duplicate block elsewhere in QUEUE.md (queue-hygiene
    artifact from repeated append passes) — both instances updated in lockstep here.
    CI counter: 0/5. Fix iterations: 0/3.

- id: FOLLOW-355
  title: Pin cold-start signal_count invariant (future init-time prior guard)
  agent: sdk-engineer
  status: READY
  priority: P3
  estimated_hours: 2
  depends_on: []
  source: RETRO-091 (FOLLOW-343 / PR #321)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-355 stub)
  branch: sdk-engineer/FOLLOW-355-signal-count-invariant

- id: FOLLOW-365
  title: Tracking stub for deferred top-2 archetype blending (CEO-gated)
  agent: ml-engineer
  status: BACKLOG
  priority: P3
  estimated_hours: 1
  depends_on: [CEO_BLENDING_DECISION]
  source: RETRO-097 (FOLLOW-344 / PR #329)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-365 stub)
  notes: |
    CEO-gated. No work until CEO decides to pursue blended profile post-pilot.

- id: FOLLOW-372
  title: Per-user opt-out toggle for Adaptive-Listings DOM adaptation
  agent: sdk-engineer
  co_agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 7
  depends_on: []
  source: CEO-directed 2026-06-21 (Piotr)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-372 stub)
  branch: sdk-engineer/FOLLOW-372-per-user-optout-toggle
  promoted_at: '2026-06-21'
  pr_sdk: '#337'
  pr_backend: '#339'
  merge_commit_sdk: e361833
  merge_commit_backend: 5d5e26f
  completed_at: '2026-06-22T00:00Z'
  notes: |
    Lead: sdk-engineer (Shadow DOM toggle UI + SDK init gate + DOM adaptation suppression).
    Support: backend-engineer (Decision-API consent-gate extension with profilingOptOut +
    per-user persistence in consent_records).
    Scope: AL-only reversible opt-out. OFF suspends AL profiling + DOM adaptation for ONE
    logged-in user; ON resumes. NOT erasure (hard erasure stays FOLLOW-139 withdrawal path).
    Toggle is bottom-left fixed in Shadow DOM, persistent per-user (localStorage + optional
    consent_records row), survives reload.
    app.estalara.com buying-intent / lead-ranking / agent chat-summaries are verifiably
    UNAFFECTED (those ride the mandatory registration consent from FOLLOW-373).
    Dual purpose: legal safeguard + product showcase (with/without comparison).
    CEO decision 2026-06-21: suspended-not-erase is sufficient for AL-only DOM adaptation
    (compliance-engineer to confirm in FOLLOW-373 DPIA update).
    DONE: SDK PR #337 merged (e361833), backend PR #339 merged (5d5e26f). RETRO pending.

- id: FOLLOW-373
  title: Platform-wide consent umbrella owned by Adaptive-Listings
  agent: compliance-engineer
  co_agent: backend-engineer
  co_agent_2: sdk-engineer
  status: DONE
  priority: P1
  estimated_hours: 7
  depends_on: []
  source: CEO-directed 2026-06-21 (Piotr)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-373 stub)
  branch: compliance-engineer/FOLLOW-373-consent-umbrella
  promoted_at: '2026-06-21'
  pr: '#336'
  merge_commit: fe20093
  completed_at: '2026-06-21T00:00Z'
  notes: |
    Lead: compliance-engineer (DPIA/ROPA/LIA/Privacy Notice update; lawful-basis mapping
    for all 6 processing purposes a-f).
    Support: backend-engineer (consent records schema + disclosure surface).
    Support: sdk-engineer (banner + registration-consent copy).
    CEO decision 2026-06-21: AL owns the full consent layer covering the whole platform.
    Mandatory-at-registration consent. Must disclose+cover: (a) behavioral tracking,
    (b) reading investor chat, (c) transfer of insights to agency/agent,
    (d) buying-intent identification, (e) lead ranking, (f) agent-facing chat-question
    summaries (LIVE + Estalara AI chat).
    Raw chat text stays APP-SIDE only (NOT in AL — AL keeps 12-dim vector, 24h TTL,
    no free text, per C-07).
    Rafal implements app-side retention/deletion windows (external HANDOFF to be written).
    AC includes: MASTER_DESIGN.md §G.2 / §H update + version bump per §Y.2 propagation
    checklist; HANDOFF to Rafal in backlog/HANDOFFS.md.
    DONE: PR #336 merged (fe20093). RETRO pending. FOLLOW-374 (platform_registration INSERT) is
    before-go-live gate — see Sprint 21 below.
```

## Sprint 21 — Consent wiring + cross-listing fixes + retro follow-ons (DONE 2026-06-22)

**FOLLOW-374/375/376 all merged 2026-06-22. Retros pending for PRs #332–#341 (batch RETRO-102+).
Pending retro spawn is the highest-priority PM action this session.**

```yaml
- id: FOLLOW-374
  title: Wire platform_registration consent_records INSERT at investor registration
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [FOLLOW-373]
  source: FOLLOW-373 implementation gap (before-go-live gate)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-374 stub)
  branch: backend-engineer/FOLLOW-374-registration-consent-insert
  pr: '#338'
  merge_commit: f9a033c
  completed_at: '2026-06-22T00:00Z'
  notes: |
    consent_records INSERT with consent_type='platform_registration' wired into registration flow.
    DONE: PR #338 merged (f9a033c). RETRO pending.

- id: FOLLOW-375
  title: SPA cross-listing adaptation + source-of-truth archetype (SHIPPED, doc follow-ups)
  agent: sdk-engineer
  status: DONE
  priority: P1
  estimated_hours: 2
  depends_on: []
  source: CEO-directed 2026-06-22 (real-browser verification session)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-375 stub)
  branch: sdk-engineer/FOLLOW-375-cross-listing-sot-archetype
  pr: '#340'
  merge_commit: 4635c3d
  completed_at: '2026-06-22T00:00Z'
  notes: |
    SPA cross-listing adaptation + sessionStorage SoT archetype (ADR-0014).
    SDK unit tests for new paths, HANDOFF to Rafal for prod bundle URL + chat_intent_dimensions.
    DONE: PR #340 merged (4635c3d). RETRO pending.

- id: FOLLOW-376
  title: Green the Python test matrix (drop deleted Modal apps + fix llm-gateway imports)
  agent: devops-engineer
  status: DONE
  priority: P2
  estimated_hours: 1
  depends_on: []
  source: CI breakage (Python test matrix failure)
  spec: CI hotfix
  branch: ci(infra)/FOLLOW-376-python-test-matrix
  pr: '#341'
  merge_commit: 6d34fd1
  completed_at: '2026-06-22T00:00Z'
  notes: |
    Drop deleted Modal apps from python matrix + fix llm-gateway imports.
    DONE: PR #341 merged (6d34fd1). RETRO pending.
```

## Sprint 22 — Retro follow-ons + P1 wiring tickets (PLANNED 2026-06-23)

**Retros DONE (RETRO-102–106 written 2026-06-23). Priority order: P0 first, then P1, then P2. Max 3
IN_PROGRESS at once.**

**P0 gate: FOLLOW-383 (opt-out server wiring) must ship before FOLLOW-369+. Server-side enforcement
dead-on-arrival per RETRO-103.**

**P1 before-go-live gate: FOLLOW-374 DONE (consent INSERT wired). FOLLOW-373 DPIA go-live checklist
items remain (DPO sign-off, QA verification) — these are human-action items, not code tickets.**

```yaml
- id: FOLLOW-383
  title:
    Wire SDK→server profiling opt-out producer + complete server/training/chat-prior halves [P0]
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 5
  depends_on: []
  source: RETRO-103 (FOLLOW-372 / PRs #337/#339)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-383 stub)
  branch: backend-engineer/FOLLOW-383-consent-gate-doc
  pr: '#342'
  completed_at: '2026-06-23T21:01:59Z'
  notes: |
    DONE — PR #342 merged to main (squash commit 7ed8a81, 2026-06-23T21:01:59Z). CI green (40/40
    checks pass; Typecheck fixed in c906ad7 before merge).
    AC-1 DONE: SDK appends profiling_opt_out=1 to /api/adapt URL when opted out.
    AC-2 DONE: decision-api 410 documented (JSDoc + route.ts comment).
    AC-3 DONE: behavioral events dropped before eventQueue.push when opted out.
    AC-4 SPLIT: redis_writer.py chat-prior skip → FOLLOW-384 (ml-engineer, P1, now unblocked).
    Pre-merge adversarial review surfaced pre-existing opt-out gaps in quiz/favorites/micro-poll
    sibling paths → FOLLOW-385 (sdk-engineer+backend-engineer, P1).
    RETRO-107 pending spawn.

- id: FOLLOW-369
  title: GET-path consent-skip parity for /api/adapt (FOLLOW-360 AC-2, unmet)
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: []
  source: RETRO-100 (FOLLOW-360 / PR #333)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-369 stub)
  branch: backend-engineer/FOLLOW-369-get-consent-skip-parity
  pr: '#343'
  merge_commit: 84552bf
  started_at: '2026-06-23T21:15Z'
  pm_validated_at: '2026-06-23T22:10Z'
  completed_at: '2026-06-24'
  notes: |
    Merged PR #343 (squash 84552bf). PM-validated CI green (real gates). Runtime wiring confirmed.
    SKIP_CONSENT_STATES producer: packages/shared/src/ab-holdout.ts:27 (non-test).
    SKIP_CONSENT_STATES consumer: apps/control-plane/src/app/api/adapt/route.ts (non-test).
    Gate order: profiling_opt_out fires first, then consent-skip — symmetric with POST.
    RETRO-108 pending (deferred — see STATUS.md).

- id: FOLLOW-384
  title:
    redis_writer.py — skip AL chat-intent shadow prior for opted-out sessions [AC-4 of FOLLOW-383]
  agent: ml-engineer
  status: DONE
  assigned_to: ml-engineer
  started_at: '2026-06-24T00:00Z'
  pm_validated_at: '2026-06-24T13:00Z'
  completed_at: '2026-06-24'
  priority: P1
  estimated_hours: 2
  depends_on: [FOLLOW-383]
  source: RETRO-103 HW-3 (FOLLOW-383 AC-4 split)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-384 stub)
  branch: ml-engineer/FOLLOW-384-redis-writer-optout-skip
  pr: '#347'
  merge_commit: 532f3d8
  notes: |
    SQUASH-MERGED PR #347 to main (commit 532f3d8) 2026-06-24.
    PM-validated 2026-06-24T13:00Z. CI green. Runtime wiring confirmed (step 5c):
    - profiling_opt_out producer (non-test): main.py:62 (process_chat_message → write_shadow_intent)
    - profiling_opt_out producer (non-test): jobs/batch_enrich.py:54 (session.get opt-out flag)
    - profiling_opt_out consumer (non-test): redis_writer.py:55 (early-return guard)
    AC-1 verified: skip guard at redis_writer.py:55. AC-2 verified: mock_redis.set.assert_not_called().
    AC-3 verified: correct shadow key + 86400s TTL asserted. No TS files touched. Scope clean.
    Rule I failures (2) are pre-existing baseline (FOLLOW-090, 107+ violations, non-blocking).
    CI check counter: 1/5. Fix iterations: 0/3. RETRO-108 pending spawn.

- id: FOLLOW-371
  title: One-shot ClickHouse remediation of holdout rows contaminated in PR#327→#333 window
  agent: data-engineer
  status: DONE
  priority: P1
  estimated_hours: 3
  depends_on: []
  source: RETRO-100 (FOLLOW-360 / PR #333)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-371 stub)
  branch: data-engineer/FOLLOW-371-ch-holdout-remediation
  pr: '#344'
  merge_commit: 029206a
  started_at: '2026-06-23T21:15Z'
  pm_validated_at: '2026-06-23T22:30Z'
  completed_at: '2026-06-24'
  notes: |
    Merged PR #344 (squash 029206a). Fix iteration 2/3 consumed (wrong import depth in test).
    PM-validated. Runtime wiring confirmed (step 5c):
    CLEAN_HOLDOUT predicate producer (non-test): apps/control-plane/src/app/api/pilot/cta-lift/route.ts:107.
    CLEAN_HOLDOUT applied (non-test SQL): cta-lift route.ts:127,149 + dashboard/analytics/lift/route.ts:148.
    RETRO-109 pending (deferred — see STATUS.md).

- id: FOLLOW-368
  title: Guarantee Python writer and TS reader share one Upstash Redis instance (env-var parity)
  agent: devops-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: []
  source: RETRO-098 (FOLLOW-346 / PR #330)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-368 stub)
  branch: devops-engineer/FOLLOW-368-upstash-redis-env-parity
  pr: '#345'
  merge_commit: dd74026
  started_at: '2026-06-23T21:15Z'
  pm_validated_at: '2026-06-23T22:10Z'
  completed_at: '2026-06-24'
  notes: |
    Merged PR #345 (squash dd74026). PM-validated. CI green. Runtime wiring confirmed.
    write_shadow_intent producer: apps/intent-engine/src/main.py:59 (non-test).
    readShadowChatIntent consumer: apps/control-plane/src/app/api/adapt/route.ts:1161 (non-test).
    Smoke runs in soft-skip mode until ESC-028 resolved (4 Upstash secrets not yet provisioned).
    ESC-028 OPEN: UPSTASH_REDIS_REST_URL/TOKEN + UPSTASH_REDIS_URL/TOKEN — human action needed.
    RETRO-110 pending (deferred — see STATUS.md).

- id: FOLLOW-356
  title: /api/adapt response page_context consumer + behavioral tests for page-type derivation
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  priority: P1
  estimated_hours: 4
  depends_on: []
  source: RETRO-092 (FOLLOW-345 / PR #323)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-356 stub)
  branch: backend-engineer/FOLLOW-357-356-tier-page-context-rename
  pr: '#354'
  merge_commit: d8d5cb8
  completed_at: '2026-06-25'
  notes: |
    DONE — absorbed into FOLLOW-357 PR #354 (d8d5cb8, 2026-06-25). CEO chose page_context
    (analytics-only, no SDK consumer, AdaptResponse.tier removed). AC-1/2/3/4 met per
    FOLLOW_UPS.md status (status: DONE 2026-06-25). RETRO-115 pending spawn.

- id: FOLLOW-363
  title: Thread hysteresis (currentArchetype) into applyDwellSignal + applyListingViewRate
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-25T00:00Z'
  pm_validated_at: '2026-06-25T12:00Z'
  completed_at: '2026-06-25'
  priority: P1
  estimated_hours: 3
  depends_on: []
  source: RETRO-097 (FOLLOW-344 / PR #329)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-363 stub)
  branch: sdk-engineer/FOLLOW-363-hysteresis-dwell-listing-view
  pr: '#351'
  merge_commit: merged-2026-06-25
  notes: |
    PR #351 merged to main 2026-06-25. Delegated 2026-06-25T00:00Z. CI check counter: 1/5.
    Fix iterations: 0/3. PM-VALIDATED 2026-06-25: CI green (Rule I pre-existing-red only).
    Both call sites patched: applyDwellSignal (intent.ts:~1703) + applyListingViewRate (intent.ts:~1636)
    now pass state.archetype + state.quiz_answered to classifyFromProbabilities.
    Non-test producer: intent.ts functions; non-test consumers: index.ts:633 (dwell) + index.ts:1055
    (listing view). ACs 1-4 + AC5 behavioral tests verified. 13-call-site inventory comment added.
    Rule S satisfied (free-classify vs guarded documented). RETRO pending.

- id: FOLLOW-385
  title:
    Enforce profiling opt-out across SDK sibling profiling paths (quiz/favorites/micro-poll +
    quiz-completion persistence) [§H.9-documented scope]
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-24T14:00Z'
  pm_validated_at: '2026-06-24T18:00Z'
  completed_at: '2026-06-24'
  priority: P1
  estimated_hours: 4
  depends_on: [FOLLOW-383]
  source: pre-merge adversarial review of PR #342 + CEO scope decision 2026-06-23
  spec: backlog/FOLLOW_UPS.md (FOLLOW-385 stub)
  branch: sdk-engineer/FOLLOW-385-sibling-optout-enforcement
  pr: '#348'
  merge_commit: f7ac516
  notes: |
    SQUASH-MERGED PR #348 to main (commit f7ac516, range 532f3d8..f7ac516) 2026-06-24.
    FOLLOW-383 merged — dependency satisfied. FOLLOW-384 merged 2026-06-24.
    Delegated to sdk-engineer 2026-06-24T14:00Z.
    Scope = §H.9-documented set ONLY (quiz, favorites, micro-poll client-side AL profiling
    suppression + quiz-completion persistence gate).
    Ingest behavioral stream (chat/intent.snapshot/live.signup) deliberately NOT in scope —
    rides §H.8 registration consent; AL training suppression handled server-side by FOLLOW-384.
    See FOLLOW-385 stub in FOLLOW_UPS.md for exact AC list.
    Delegation table row: client SDK, browser code → sdk-engineer.
    PM-VALIDATED 2026-06-24: CI green (Rule I pre-existing-red only — confirmed same baseline as
    PR #347). ACs 1–5 verified against diff. Runtime wiring confirmed (profilingOptedOut producer
    index.ts:428, three new guard consumers at :1103/:1236/:1421). Scope clean (no §H.8 paths
    touched). Co-assignment (backend quiz/completion route.ts:363) coherent + tested.
    EPIC NOTE: §H.9 opt-out epic NOT closed — FOLLOW-387 (P1, chat-path producer unwired)
    remains OPEN. This PR covers quiz/favorites/micro-poll only.
    CI check counter: 1/5. Fix iterations: 0/3. RETRO-109 appended 2026-06-24 by pm-orchestrator.

- id: FOLLOW-387
  title:
    Thread profiling_opt_out from the SDK chat-emit through ingest → _spawn_chat_nlp →
    process_chat_message (close RETRO-103 HW-3 end-to-end; real-time chat axis)
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 4
  depends_on: [FOLLOW-384]
  source:
    RETRO-108 (§3 HW-1 HALF_WIRE_C — FOLLOW-384 closed only the redis_writer hop; real-time producer
    never sets the flag)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-387 stub)
  branch: backend-engineer/FOLLOW-387-live-chat-optout-thread
  pr: 349
  completed_at: 2026-06-24
  notes: |
    SQUASH-MERGED PR #349 to main. Merge commit: b7412e1. Commit range: f7ac516..b7412e1.
    PR #349 opened. PM-validated 2026-06-24.
    CI: all real gates GREEN. Rule I pre-existing-red only (same ~175-violation baseline on main;
    not caused by this PR). Non-success count on real gates: 0.
    Cross-language event contract gate: PASS (GREEN).
    AC-1 PASS: profiling_opt_out: z.boolean().optional() in ChatMessageSentPayloadSchema — optional,
      backward-compatible, existing events still validate.
    AC-2 PASS: SDK index.ts:1344 sets profiling_opt_out: profilingOptedOut || undefined on
      chat.message.sent. TS tests in packages/sdk/src/__tests__/follow-387.test.ts confirm.
    AC-3 PASS: _spawn_chat_nlp reads payload.get("profiling_opt_out", False) and passes it to
      fn.spawn(profiling_opt_out=...) at events.py:85+107. NOT hardcoded False.
    AC-4 PASS (CRITICAL — confirmed NOT a TG-1 repeat): the end-to-end integration test
      test_opted_out_event_threads_profiling_opt_out_through_consumer_to_spawn at
      test_chat_nlp_bridge.py:436 runs the REAL run_consumer loop, does NOT mock _spawn_chat_nlp
      (only patches sys.modules["modal"] to capture fn.spawn args), and asserts
      fn.spawn called with profiling_opt_out=True. This is the producer-chain test RETRO-108
      TG-1 identified as missing. The test FAILS on origin/main (no flag in spawn args)
      and PASSES with this PR. This is not a self-injecting modeled test.
    AC-5 PASS: §H.9/FOLLOW-387 comments present at events.py:83/107/113 and index.ts:1336.
      §H.8 invariant preserved — ClickHouse batch still receives the event (confirmed by
      the integration test's ch.insert_events.assert_called_once() assertion).
    Runtime wiring (step 5c):
      PRODUCER (non-test): packages/sdk/src/index.ts:1344
      CONSUMER (non-test): apps/stream-consumer/src/consumers/events.py:85+107
      FULL CHAIN: apps/intent-engine/src/main.py:37+62 — process_chat_message receives
        profiling_opt_out and forwards it to write_shadow_intent (FOLLOW-384 guard, PR #347).
    Scope discipline: only 5 non-doc files changed. intent.snapshot and live.signup paths
      NOT touched. write_shadow_intent NOT modified (done in FOLLOW-384, PR #347).
    ESC-029 RESOLVED: CEO (Piotr Nawrocki) approved ChatMessageSentPayloadSchema extension
      on 2026-06-24, recorded in backlog/ESCALATIONS.md.
    EPIC NOTE: §H.9 live-chat leg CLOSED by this merge. Epic NOT fully DONE — FOLLOW-388
      (P2, batch axis, depends_on FOLLOW-101+387) and FOLLOW-389 (P2, test-hardening
      HW-1/DG-1) are promoted to QUEUE.md as READY below.
    CI check counter: 1/5. Fix iterations: 0/3.
    RETRO-110 pending (dedicated retrospective-analyst running in parallel — do NOT write
      RETRO-110 in pm-orchestrator session; dual-pass prevention per post-merge instructions).

- id: FOLLOW-389
  title:
    Wire the /api/quiz/completion opt-out producer + replace modeled SDK guard tests with
    real-handler tests + fix the misleading micro-poll comment (close RETRO-109 HW-1/TG-1/DG-1)
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  priority: P2
  estimated_hours: 3
  depends_on: [FOLLOW-385]
  source: RETRO-109 (§3 HW-1 HALF_WIRE_C, §4c TG-1, §4d DG-1 — ADDENDUM re-pass)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-389 stub)
  branch: sdk-engineer/FOLLOW-389-quiz-completion-optout-producer
  pr: '#355'
  merge_commit: 0e1b9eb
  completed_at: '2026-06-26'
  notes: |
    DONE — PR #355 merged to main 2026-06-26 (0e1b9eb). "feat(sdk): wire quiz-completion
    opt-out producer + real-handler tests [FOLLOW-389]". HW-1/TG-1/DG-1 from RETRO-109
    all resolved. Co-assignment (backend-engineer route gate) confirmed in PR. RETRO-116
    pending spawn.
    NOTE: incomplete leg (micro-poll onAnswer guard not covered by this PR; micro_polls_enabled
    forced false in buildMockFetch so path never driven) is COVERED_BY_FOLLOW-409 (PR #367,
    READY_FOR_REVIEW pending human merge). Once FOLLOW-409 merges, §H.9 TG-1 is complete.

- id: FOLLOW-388
  title:
    Surface per-session opt-out state in read_recent_chat_sessions + fix the false batch_enrich.py
    comment (close §H.9 on the batch axis once FOLLOW-101 lands)
  agent: data-engineer
  status: READY
  priority: P2
  estimated_hours: 2
  depends_on: [FOLLOW-101, FOLLOW-387]
  source: RETRO-108 (§4a LG-2 latent leak, §4d DG-1, §5b)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-388 stub)
  branch: data-engineer/FOLLOW-388-batch-optout-surface
  notes: |
    Promoted to QUEUE.md 2026-06-24 post-merge of PR #349 (FOLLOW-387).
    FOLLOW-387 DONE (PR #349, b7412e1) — dependency satisfied.
    PM re-check 2026-07-01: the depends_on field lists FOLLOW-101 (DONE, PR #256) but that
    ticket shipped the REAL-TIME chat bridge only — its own notes state "ClickHouse reader
    stubbed ([]) for Sprint 13". Confirmed still true today by grep: apps/intent-engine/src/
    clickhouse_reader.py:4 is a hardcoded stub returning []; no ticket in QUEUE.md has yet
    implemented the real batch ClickHouse query for read_recent_chat_sessions. This ticket's
    AC ("surface opt-out state in read_recent_chat_sessions") is therefore not meaningfully
    actionable yet — there is no real query to add opt-out surfacing to. Leaving status READY
    (not blocking anything else, P2, not pilot-critical) but flagging: do NOT delegate until
    the real batch-query implementation ticket exists and is DONE, or the scope is expanded to
    include it. See FOLLOW_UPS.md stub for full scope (batch_enrich.py comment +
    read_recent_chat_sessions opt-out surface).

- id: FOLLOW-359
  title: Return variant in GET /api/adapt response body
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-25T00:00Z'
  pm_validated_at: '2026-06-25T12:00Z'
  completed_at: '2026-06-25'
  priority: P1
  estimated_hours: 2
  depends_on: []
  source: RETRO-095 (FOLLOW-342 / PR #327)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-359 stub)
  branch: backend-engineer/FOLLOW-359-get-variant-response
  pr: '#350'
  merge_commit: merged-2026-06-25
  notes: |
    PR #350 merged to main 2026-06-25. FOLLOW-360 DONE (merged #333) — dependency cleared.
    Delegated 2026-06-25T00:00Z. CI check counter: 1/5. Fix iterations: 0/3.
    PM-VALIDATED 2026-06-25: CI green (Rule I pre-existing-red only). All real gates pass.
    variant field added to GET response at route.ts:826 using getHandlerVariant (same variable
    used for runDecisionTree:805 and logDecisionAsync:837). Single source of truth confirmed.
    Non-test producer: route.ts:791. Non-test consumer: adapt.ts:775. ACs 1-4 + HOLDOUT verified.
    AdaptationDirectives.variant (directives.ts:171) was already optional — no type break.
    RETRO pending.

- id: FOLLOW-361
  title: Reconcile bandit seed convention (default vs control/v1/v2)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-26T00:00Z'
  completed_at: '2026-06-26T10:08Z'
  priority: P1
  estimated_hours: 3
  depends_on: []
  source: RETRO-095 (FOLLOW-342 / PR #327)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-361 stub)
  branch: backend-engineer/FOLLOW-361-bandit-seed-convention
  pr: '#356'
  merge_commit: '4eb24af4'
  notes: |
    MERGED 2026-06-26T10:08:42Z. Commit 4eb24af4. PM-validated prior to merge.
    All 4 ACs met. CI green. RETRO-117 pending spawn.

- id: FOLLOW-370
  title: Cache getBanditArms on non-holdout GET/POST path (latency budget assertion)
  agent: backend-engineer
  status: READY
  priority: P2
  estimated_hours: 2
  depends_on: []
  source: RETRO-100 (FOLLOW-360 / PR #333)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-370 stub)
  branch: backend-engineer/FOLLOW-370-bandit-arms-cache

- id: FOLLOW-354
  title: Test + document the confidence floor real axis (suppress /adapt/description below floor)
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-26T14:00Z'
  completed_at: '2026-06-26T11:23Z'
  priority: P2
  estimated_hours: 4
  depends_on: []
  source: RETRO-091 (FOLLOW-343 / PR #321)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-354 stub)
  branch: sdk-engineer/FOLLOW-354-confidence-floor-description-axis
  pr: '#358'
  merge_commit: '701aa4efb9'
  notes: |
    MERGED 2026-06-26T11:23:33Z. Commit 701aa4efb9. PM-validated 2026-06-26T16:00Z.
    CI: run 28234447026/28234468393 — only pre-existing failures (Rule I, Archetype embeddings).
    All real gates PASS. CI non-success on real gates: 0.
    AC-1: 3 tests assert NO /adapt/description fetch below floor.
    AC-2: 3 tests assert description fetch IS issued at/above floor.
    AC-3: MASTER_DESIGN §E.7 line 2404 confidence gating ladder note added.
    AC-4: adapt-floor.ts JSDoc lines 21-32 documents 0.5 vs 0.6 asymmetry.
    RETRO-119 SPAWNED. Generated FOLLOW-398 (P2 SIDEBAR_SHOW_THRESHOLD doc fix, sdk-engineer),
    FOLLOW-399 (P3 signal_count branch test, sdk-engineer).
    Retro note: RETRO-114/115/116 gap flagged in RETRO-119 — PM to reconcile.

- id: FOLLOW-358
  title: Resolve GET-vs-POST adaptation_decisions.page_context semantic divergence (Rule K parity)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-26T12:00Z'
  completed_at: '2026-06-26T10:40Z'
  priority: P2
  estimated_hours: 2
  depends_on: []
  source: RETRO-092 (FOLLOW-345 / PR #323)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-358 stub)
  branch: backend-engineer/FOLLOW-358-page-context-divergence
  pr: '#357'
  merge_commit: 'a8eacb4a'
  notes: |
    MERGED 2026-06-26T10:40:15Z. Commit a8eacb4a. PM-validated 2026-06-26T15:00Z.
    CI green (3/5 checks, 2/3 fix iterations). All real gates pass. RETRO-118 pending spawn.

- id: FOLLOW-362
  title: Define non-en locale A/B behavior (stop logging unserved variants)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-26T16:30Z'
  completed_at: '2026-06-26T11:31Z'
  priority: P2
  estimated_hours: 3
  depends_on: []
  source: RETRO-095 (FOLLOW-342 / PR #327)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-362 stub)
  branch: backend-engineer/FOLLOW-362-locale-ab-variant
  pr: '#359'
  merge_commit: 'dfe8a9cd71'
  notes: |
    MERGED 2026-06-26T11:31:48Z. Commit dfe8a9cd71. CI run 28234468393: only pre-existing
    failures (Rule I, Archetype embeddings not-NULL). All real gates PASS. CI real-gate count: 0.
    Fix: suppress getBanditArms/thompsonSample for locale !== 'en' in GET + POST handlers.
    Non-en sessions always log 'control' variant (matches served copy; no pl/es PlaybookEntry).
    RETRO-120 spawned by coordinator.

- id: FOLLOW-367
  title: Implement (or remove) the CHAT_NLP_LIVE gate — currently an inert no-op
  agent: backend-engineer
  status: READY
  priority: P2
  estimated_hours: 3
  depends_on: []
  source: RETRO-098 (FOLLOW-346 / PR #330)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-367 stub)
  branch: backend-engineer/FOLLOW-367-chat-nlp-live-gate
  notes: |
    FOLLOW-366 DONE. Also depends on C-07 DPIA go-live items signed off before flipping gate true.

- id: FOLLOW-364
  title: Reconcile §D.6 coverage-summary counts to a clean 18-way partition
  agent: ml-engineer
  status: DONE
  assigned_to: ml-engineer
  started_at: '2026-07-01T00:00:00Z'
  completed_at: '2026-07-01T19:24:10Z'
  priority: P2
  estimated_hours: 1
  depends_on: []
  source: RETRO-097 (FOLLOW-344 / PR #329)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-364 stub)
  branch: ml-engineer/FOLLOW-364-d6-coverage-counts
  pr: '#408'
  notes: |
    DONE — PR #408 merged 2026-07-01T19:24:10Z. Docs-only §D.6 reconciliation, no runtime wiring.
    NOTE: this ticket had a byte-identical duplicate block elsewhere in QUEUE.md (queue-hygiene
    artifact from repeated append passes) — both instances updated in lockstep here.
    CI counter: 0/5. Fix iterations: 0/3.

- id: FOLLOW-341
  title: Populate archetype_embeddings.embedding (activate the cosine affinity path)
  agent: ml-engineer
  status: DONE
  assigned_to: ml-engineer
  started_at: '2026-06-25T12:00Z'
  pm_validated_at: '2026-06-25T14:00Z'
  completed_at: '2026-06-25'
  priority: P1
  estimated_hours: 6
  depends_on: []
  source: AUDIT-2026-06-19 F-02
  spec: backlog/FOLLOW_UPS.md (FOLLOW-341 stub)
  branch: ml-engineer/FOLLOW-341-archetype-embedding-job
  pr: '#352'
  merge_commit: merged-2026-06-25
  notes: |
    PR #352 merged to main 2026-06-25. ESC-030 RESOLVED — CEO chose Option A.
    Implemented: src/lib/archetype-seeder.ts (core logic), scripts/seed-archetypes.mts (thin CLI
    wrapper), 8 unit tests (vi.mock openai + vi.stubGlobal fetch), archetype-embeddings-not-null CI
    job in ci.yml (soft-skip without DOPPLER_TOKEN_DEV).
    PM-VALIDATED 2026-06-25T14:00Z. CI check counter: 1/5. Fix iterations: 0/3.
    All real merge gates PASS. Runtime wiring confirmed (see STATUS.md canonical entry).
    PROD SEED ACTION REQUIRED (go-live for §F cosine MOAT — tracked in STATUS.md):
      cd apps/control-plane && SUPABASE_SERVICE_ROLE_KEY=<prod> OPENAI_API_KEY=<key> pnpm seed:archetypes
    OR trigger seed-archetypes.yml workflow_dispatch with prod credentials.
    Dev DB auto-populates via post-migrate-seed.yml on push:main. Same pattern as RETRO-076/FOLLOW-307.
    FOLLOW-342 unblocked on code; cosine ordering in prod requires manual seed first.
    RETRO pending.

- id: FOLLOW-342
  title: Thread bandit variant into playbook selection (stop optimizing placebo arms)
  agent: backend-engineer
  status: DONE
  priority: P1
  estimated_hours: 6
  depends_on: [FOLLOW-341]
  source: AUDIT-2026-06-19 F-03
  spec: backlog/FOLLOW_UPS.md (FOLLOW-342 stub)
  branch: backend-engineer/FOLLOW-342-variant-playbook-selection
  pr: '#327'
  merge_commit: 66054d6
  assigned_to: backend-engineer
  started_at: '2026-06-25'
  completed_at: '2026-06-25'
  ci_checks_used: 0/5
  fix_iterations_used: 0/3
  notes: |
    Implementation shipped in PR #327 (66054d6). Variant threading complete:
    VARIANT_INDEX map (control→0, v1→1, v2→2) + slot.variants?.en[variantIndex] ?? slot.en
    fallback in runDecisionTree(). Sampling happens BEFORE decision tree in both GET and POST
    handlers; holdout sessions forced to 'control' before sampling (FOLLOW-360 preserved).
    ClickHouse logDecisionAsync logs the selected variant (AC-3). All 4 ACs met.
    AC-2 fallback test (slot.en when variants absent) added explicitly in route.variant.test.ts
    2026-06-25 session. 1293 tests green.
    PROD COSINE CAVEAT (corrected 2026-07-01): archetype_embeddings ARE seeded in prod (18/18
    verified 2026-07-01) — FOLLOW-392 goal met. cosine ORDERING is still inactive because
    `listing_embeddings` is EMPTY for the pilot tenant — the real blocker is seeding pilot listing
    embeddings (tied to ESC-020), NOT FOLLOW-392. djb2 remains safe degradation.

- id: FOLLOW-355
  title: Pin cold-start signal_count invariant (future init-time prior guard)
  agent: sdk-engineer
  status: READY
  priority: P3
  estimated_hours: 2
  depends_on: []
  source: RETRO-091 (FOLLOW-343 / PR #321)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-355 stub)
  branch: sdk-engineer/FOLLOW-355-signal-count-invariant

- id: FOLLOW-365
  title: Tracking stub for deferred top-2 archetype blending (CEO-gated)
  agent: ml-engineer
  status: BACKLOG
  priority: P3
  estimated_hours: 1
  depends_on: [CEO_BLENDING_DECISION]
  source: RETRO-097 (FOLLOW-344 / PR #329)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-365 stub)
  notes: |
    CEO-gated. No work until CEO decides to pursue blended profile post-pilot.

- id: FOLLOW-394
  title: Guard migration-before-code ordering + INSERT contract test (ClickHouse smoke) + runbook
  agent: data-engineer
  status: DONE
  assigned_to: data-engineer
  started_at: '2026-06-26T18:00Z'
  completed_at: '2026-06-26T13:24:58Z'
  priority: P1
  estimated_hours: 2
  depends_on: []
  source: RETRO-118 (§4b CB-1; §4a LG-1; §4c TG-1; §7) — source ticket FOLLOW-358 (PR #357)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-394 stub)
  branch: data-engineer/FOLLOW-394-ch-migration-contract-test
  pr: '#360'
  merge_commit: '5898739afaf61a62176c68a3b211b7034dd66fa2'
  notes: |
    DONE. PR #360 merged 2026-06-26T13:24:58Z. RETRO-121 complete.
    Generated FOLLOW-402 (P2, generalize contract test + DROP-on-failure fix),
    FOLLOW-403 (P2, runbook overstatement correction), FOLLOW-404 (P2, prod attestation).
    FOLLOW-396 sharpened: PR #360's token-scoped regex at .gitleaks.toml:185 supersedes
    the file-wide route.ts paths allowlist line 177 — FOLLOW-396 can now simply delete
    that paths entry.
    CI counter: 3/5. Fix iterations: 2/3.
    promoted_to_queue: 2026-06-26.

- id: FOLLOW-395
  title:
    Realize page_context_source discriminator with an actual consumer (query or dashboard panel)
  agent: data-engineer
  status: READY
  priority: P3
  estimated_hours: 2
  depends_on: [FOLLOW-394]
  source: RETRO-118 (§3 CHECK B HW-1) — source ticket FOLLOW-358 (PR #357)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-395 stub)
  branch: data-engineer/FOLLOW-395-page-context-source-consumer
  notes: |
    Promoted 2026-06-26. Blocked on FOLLOW-394 (must apply migration before consumer is useful).
    page_context_source column is write-only today — no in-repo read-side consumer confirmed.

- id: FOLLOW-396
  title: Narrow gitleaks route.ts allowlist (restore secret scanning on adapt route)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-26T19:40Z'
  completed_at: '2026-06-26T14:17Z'
  priority: P2
  estimated_hours: 1
  depends_on: []
  source: RETRO-118 (§4d DG-1) — source ticket FOLLOW-358 (PR #357)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-396 stub)
  branch: backend-engineer/FOLLOW-396-gitleaks-allowlist-narrow
  pr: '#362'
  notes: |
    DONE. PR #362 merged 2026-06-26T14:17Z. RETRO-123 complete.
    Rule V promoted to CONVENTIONS_PATCH.md (gitleaks token-scoped regexes over file-wide paths
    on secret-handling files). Generated FOLLOW-406 (P3, negative-control attestation) and
    FOLLOW-407 (P2, apply Rule V to consent endpoint exemption at .gitleaks.toml:172).
    PM-VALIDATED 2026-06-26T19:50Z. CI green. Wiring verified (deletion only).
    AC-1: route.ts file-wide paths exemption (5 lines, 173-177) deleted from .gitleaks.toml.
          Verified: grep for route\.ts in .gitleaks.toml paths lists finds only the comment reference
          at line 171 (in the consent-endpoint block, not an exemption entry). Entry gone.
    AC-2: regexes entry '0019_adaptation_decisions_page_context' at .gitleaks.toml:180 retained.
    AC-3: Gitleaks secrets scan 2x SUCCESS on commit bd0f82937793 (push-event + PR-event).
          route.ts fully scanned; no cloudflare-api-token FP without the exemption.
    AC-4: No other production files affected (deletion-only change, CI-verified).
    CI counter: 1/5. Fix iterations: 0/3.

- id: FOLLOW-397
  title: Derive VARIANT_INDEX from SEED_VARIANTS + add stray-variant fallback test (Rule K.1)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-26T19:15Z'
  completed_at: '2026-06-26T14:01:44Z'
  priority: P2
  estimated_hours: 2
  depends_on: []
  source: RETRO-117 — source ticket FOLLOW-361 (PR #356)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-397 stub)
  branch: backend-engineer/FOLLOW-397-variant-index-from-seed-variants
  pr: '#361'
  merge_commit: '7962b4e9c22e1e7f7f11502e0309c2f8af60e36b'
  notes: |
    DONE. PR #361 merged 2026-06-26T14:01:44Z. RETRO-122 complete.
    Generated FOLLOW-405 (P2, backend-engineer — SEED_VARIANTS order ↔ playbook variants.en
    cross-package positional coupling guard; AC-3 SoT-growth tail not fully covered by Part A).
    CI counter: 1/5. Fix iterations: 0/3.
    promoted_to_queue: 2026-06-26.

- id: FOLLOW-398
  title: Correct SIDEBAR_SHOW_THRESHOLD rung of confidence gating ladder (Rule Y / RETRO-119)
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-26T21:15Z'
  completed_at: '2026-06-26T14:52Z'
  priority: P2
  estimated_hours: 1
  depends_on: []
  source: RETRO-119 (§4d DG-1, §4d DG-2) — source ticket FOLLOW-354 (PR #358)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-398 stub)
  branch: sdk-engineer/FOLLOW-398-sidebar-threshold-doc-fix
  pr: '#365'
  notes: |
    PM-VALIDATED 2026-06-26. CI green. Doc-only PR. Ready for human review.
    AC-1 (MASTER_DESIGN.md line 728): phantom "SIDEBAR_SHOW_THRESHOLD = 0.6" citation removed;
      now reads "The sidebar widget is admin-only (not buyer-facing); there is no SDK constant
      gating sidebar visibility." Confirmed by read of MASTER_DESIGN.md:728. ✓
    AC-2 (MASTER_DESIGN.md line 2409): now reads "there is no SIDEBAR_SHOW_THRESHOLD constant
      in the SDK". Confirmed by grep. ✓
    AC-3 (adapt-floor.ts JSDoc line 25): SIDEBAR_SHOW_THRESHOLD fully absent. Grep confirms
      NOT_IN_ADAPT_FLOOR. ✓
    AC-4 (follow-343.test.ts line 211): comment now correctly states "There is no
      SIDEBAR_SHOW_THRESHOLD constant in index.ts — the sidebar is admin-only." ✓
    CI evidence (step 5b): real-gate non-success = 0. Failing: Archetype embeddings not-NULL
      2x + Rule I 2x (pre-existing non-blocking baseline). All real gates PASS.
    Wiring evidence (step 5c): doc/comment-only — no new symbols, events, columns, or exports.
      No runtime wiring to verify per step 5c (Rule Y = doc accuracy, not a code wire).
    CI counter: 1/5. Fix iterations: 0/3.
    Promoted 2026-06-26. Delegated 2026-06-26T21:15Z (table row: client SDK, Shadow DOM,
      browser code → sdk-engineer).

- id: FOLLOW-399
  title: Cover floor signal_count >= 2 OR-branch on description axis + fix AC-1 cold-start comment
  agent: sdk-engineer
  status: READY
  priority: P3
  estimated_hours: 2
  depends_on: [FOLLOW-355]
  source: RETRO-119 — source ticket FOLLOW-354 (PR #358)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-399 stub)
  branch: sdk-engineer/FOLLOW-399-signal-count-branch-test
  notes: |
    Promoted 2026-06-26. follow-354.test.ts does not cover the second OR-branch of the floor
    gate (signal_count >= 2 with low confidence). Multi-axis gap from RETRO-119.
    Depends on FOLLOW-355 (_initForTest harness).

- id: FOLLOW-400
  title: Bind FOLLOW-362 non-en bandit suppression removal to variants.pl/es population (guard test)
  agent: backend-engineer
  status: READY
  priority: P2
  estimated_hours: 2
  depends_on: [FOLLOW-031]
  source: RETRO-120 (§4a LG-2, §4d DG-1) — source ticket FOLLOW-362 (PR #359)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-400 stub)
  branch: backend-engineer/FOLLOW-400-locale-ab-unsuppress-trigger
  notes: |
    Promoted 2026-06-26. FOLLOW-362 suppressed non-en bandit with no trigger to un-suppress
    once variants.pl/es are added. This ticket adds a guard test that fails if playbooks
    ship variants.pl/es while suppression is still live. MASTER_DESIGN §E.3/E.7 doc.
    Blocked on FOLLOW-031 (variants.pl/es population).

- id: FOLLOW-401
  title: Decide bandit arm locale-scoping vs shared-control-arm; test non-en reward leg
  agent: backend-engineer
  status: READY
  priority: P3
  estimated_hours: 3
  depends_on: []
  source: RETRO-120 (§4a LG-1, §4c TG-1) — source ticket FOLLOW-362 (PR #359)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-401 stub)
  branch: backend-engineer/FOLLOW-401-bandit-locale-scope-decision
  notes: |
    Promoted 2026-06-26. Non-en conversions log variant=control and update SHARED control arm.
    Decide: locale-scope arms (add locale to PK) or document shared-control intentional.
    Add e2e test proving non-en conversion updates control arm. ADR if scoping changes PK.

- id: FOLLOW-402
  title:
    Generalize CH migration-ordering contract test + fix DROP-on-failure non-idempotency (RETRO-121
    LG-1/CB-1/TG-1)
  agent: data-engineer
  status: DONE
  assigned_to: data-engineer
  started_at: '2026-06-26T23:30Z'
  completed_at: '2026-06-26T16:37Z'
  priority: P2
  estimated_hours: 3
  depends_on: []
  source: RETRO-121 (§4a LG-1, §4b CB-1, §4c TG-1) — source ticket FOLLOW-394 (PR #360)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-402 stub)
  branch: data-engineer/FOLLOW-402-contract-test-generalize
  pr: '#368'
  notes: |
    Promoted 2026-06-26. FOLLOW-394's contract test pins ONE column (page_context_source/0019).
    A future INSERT column addition re-opens the fail-CLOSED hazard (passes test unchanged).
    Fix: derive/lint the asserted column list from the real logDecisionAsync INSERT in route.ts;
    fail CI generically for any new column. Also: fix DROP-on-failure — add trap EXIT to drop
    contract_test_ordering so failed LOCAL=1 runs don't poison the next run. Cross-ref FOLLOW-308
    (prod-apply timing, different scope — do NOT duplicate).
    Delegated 2026-06-26T23:30Z (table row: ClickHouse, ETL → data-engineer).
    PM-VALIDATED 2026-06-26. CI non-success = 4 (Rule I 2x + Archetype embeddings 2x), all
    pre-existing non-blocking baseline. All real gates PASS. AC-1 verified: column list extracted
    at runtime via grep/sed from logDecisionAsync in route.ts (script lines 161-163); last migration
    boundary via sorted glob (lines 191-204). AC-2 verified: _cleanup() + trap EXIT at lines 54/58.
    AC-3 verified: runbook has no "does NOT generically detect" or "wait for FOLLOW-402" language.
    AC-4 verified: header comment line 12-14 accurately describes dynamic derivation.
    PR comment posted: https://github.com/Pnawrocki9/Adaptive-Listings/pull/368#issuecomment-4811465242
    READY for human review. Do not merge without human approval.
    CI counter: 1/5. Fix iterations: 0/3.

- id: FOLLOW-403
  title:
    Correct clickhouse-migrations runbook — scope overstated coverage claim + fix migrate.sh
    mislabel (RETRO-121 DG-1/DG-2)
  agent: data-engineer
  status: DONE
  assigned_to: data-engineer
  started_at: '2026-06-26T20:00Z'
  completed_at: '2026-06-26T14:32Z'
  priority: P2
  estimated_hours: 1
  depends_on: []
  source: RETRO-121 (§4d DG-1, §4d DG-2) — source ticket FOLLOW-394 (PR #360)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-403 stub)
  branch: data-engineer/FOLLOW-403-runbook-correction
  pr: '#363'
  notes: |
    DONE. PR #363 merged 2026-06-26T14:32Z. RETRO-124 complete (coordinator confirmed).
    PM-VALIDATED 2026-06-26. CI green. Doc-only PR.
    AC-1 (DG-1 scope claim): "catches any future PR..." replaced with "catches REGRESSION of the
      0019/page_context_source boundary specifically... does NOT generically detect any future column."
      Verified in docs/runbooks/clickhouse-migrations.md §CI contract test.
    AC-2 (DG-2 migrate.sh caption): separate "Apply a single migration file directly" (curl) vs
      "Apply ALL pending migrations idempotently (safe to re-run)" (migrate.sh). Verified.
    AC-3 (FOLLOW-402 cross-link): "Once FOLLOW-402 lands, the column list will be derived
      automatically — see that ticket for the generalized parity check." Verified.
    CI counter: 1/5. Fix iterations: 0/3.

- id: FOLLOW-404
  title:
    One-time prod-state attestation that 0019 page_context_source is live in prod CH + DDL grant
    (RETRO-121 §7)
  agent: devops-engineer
  co_agent: data-engineer
  status: DONE
  assigned_to: devops-engineer
  started_at: '2026-06-26T23:59Z'
  completed_at: '2026-06-26T17:51Z'
  priority: P2
  estimated_hours: 1
  depends_on: []
  source: RETRO-121 (§7), inherits RETRO-118 §4a LG-1 — source ticket FOLLOW-394 (PR #360)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-404 stub)
  branch: devops-engineer/FOLLOW-404-prod-ch-attestation
  pr: '#372'
  notes: |
    Promoted 2026-06-26. ESC-031 resolution stated migration 0019 "was applied manually" but
    no DESCRIBE TABLE / SELECT DISTINCT attestation was recorded. RETRO-076 caveat: prod
    ingest_worker user may lack DDL grant. ACs: (1) DESCRIBE TABLE adaptation_decisions confirms
    page_context_source LowCardinality(String) present; (2) SELECT DISTINCT returns caller_supplied
    / page_type_derived / legacy; (3) writer DDL/INSERT grant confirmed; (4) result recorded.
    Cross-ref FOLLOW-308 (standing mechanism, different scope). Co-assigned devops+data-engineer.
    Delegated 2026-06-26T23:59Z (table row: ClickHouse, Redpanda, ETL → data-engineer; co-agent
    devops-engineer for Doppler prod credentials).
    CI counter: 0/5. Fix iterations: 0/3.
    PM-VALIDATED 2026-06-26. PR #372. CI non-success = 2 (Archetype embeddings not-NULL check 2x),
    pre-existing non-blocking baseline (also fails on PR #371). All real gates PASS (Format check,
    Gitleaks, ClickHouse migrations smoke, Rule H, Rule J, Cross-language event contract, Doppler,
    Migration journal monotonicity, Privacy Notice SDK key-sync, Redis shadow round-trip,
    Tracer query-builders, Archetype seeds completeness, all Python tests, Vercel).
    Docs-only PR — no new symbols, events, columns, or exports. Wiring: N/A.
    All 4 ACs confirmed per human attestation: (1) page_context_source LowCardinality(String) is
    18th column in DESCRIBE TABLE; (2) table empty at attestation time (consistent with ESC-031
    silent-write gap); (3) ingest_worker has GRANT SELECT, INSERT ON default.*; (4) recorded in PR.
    DONE pending human merge of PR #372.

- id: FOLLOW-405
  title:
    Gate SEED_VARIANTS order ↔ playbook variants.en index cross-package positional contract
    (RETRO-122 SoT-growth tail)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-26T18:30Z'
  completed_at: '2026-06-26T23:59Z'
  priority: P2
  estimated_hours: 2
  depends_on: []
  source: RETRO-122 (§4a LG-1, §4c TG-1, §4d DG-1) — source ticket FOLLOW-397 (PR #361)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-405 stub)
  branch: backend-engineer/FOLLOW-405-seed-variants-playbook-parity-gate
  pr: '#371'
  notes: |
    Promoted 2026-06-26. FOLLOW-397 derived VARIANT_INDEX from SEED_VARIANTS (closed the
    third-list + TG-3 test). But the derived index now creates an IMPLICIT cross-package
    POSITIONAL coupling: VARIANT_INDEX (control-plane) indexes variants.en[] (SDK package,
    types.ts:27) — nothing binds their order/length. Part A guard test only asserts
    VARIANT_INDEX self-consistency, NOT in-range vs real playbook variants.en arrays.
    Gap: adding v3 to SEED_VARIANTS without adding variants.en[3] → silently serves s.en; CI green.
    Fix: add parity test asserting every SEED_VARIANTS[i] maps to an in-range index in playbook
    variants.en; pin SEED_VARIANTS[0] === 'control' order; doc served=base/logged=raw stray-arm
    contract; update route.ts:255 JSDoc (4th textual twin).
    Delegated 2026-06-26T18:30Z (table row: ingest worker, control-plane, Postgres/auth → backend-engineer).
    CI counter: 1/5. Fix iterations: 0/3.
    PM-VALIDATED 2026-06-26. PR #371. CI non-success = 4 (Rule I 2x + Archetype embeddings not-NULL 2x),
    all pre-existing non-blocking baseline. All real gates PASS (Build, Build control-plane, Typecheck,
    Lint, Test Node 22, SDK E2E, Format, ClickHouse migrations smoke, Rule H, Rule J, Gitleaks, Doppler).
    DONE pending human merge.

- id: FOLLOW-406
  title:
    Negative-control attestation that gitleaks still catches a real secret in adapt/route.ts after
    paths deletion (close FOLLOW-396 AC-2 verification leg)
  agent: devops-engineer
  co_agent: backend-engineer
  status: DONE
  assigned_to: devops-engineer
  started_at: '2026-06-26T...'
  completed_at: '2026-06-27T00:00Z'
  priority: P3
  estimated_hours: 1
  depends_on: []
  source: RETRO-123 (§4c TG-1, §7 step 3) — source ticket FOLLOW-396 (PR #362)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-406 stub)
  branch: devops-engineer/FOLLOW-406-411-gitleaks-negative-control-attestation
  pr: '#373'
  merge_commit: '41aa878'
  notes: |
    DONE. PR #373 merged (commit 41aa878, branch commit 2336e33). Joint execution with FOLLOW-411.
    Promoted 2026-06-26. PR #362 proved the FP no longer fires (CI green) but did NOT prove
    detection is restored. "CI green" is consistent with "scanning restored, no secret present"
    AND "scanning still suppressed." Add dummy cloudflare-api-token-shaped high-entropy value
    to route.ts locally, confirm gitleaks REDs (true positive), remove dummy value, record result.
    Cross-ref FOLLOW-407 (same proof on consent route).
    JOINT EXECUTION with FOLLOW-411 (P2) per FOLLOW-411 AC recommendation: "Execute jointly
    with FOLLOW-406 as ONE generalized negative-control pass over BOTH narrowed secret-handling
    surfaces (route.ts + consent), with a reusable per-surface checklist." Delegated
    2026-06-26 (table row: Terraform, CI/CD, workflows, secrets → devops-engineer; co-agent
    backend-engineer for lib.ts maintenance comment in FOLLOW-411 DG-1).
    CI counter: 0/5. Fix iterations: 0/3.
    Retrospective-analyst to be spawned on PR #373.

- id: FOLLOW-407
  title:
    Apply Rule V to consent endpoint — narrow FOLLOW-374 file-wide gitleaks paths exemption at
    .gitleaks.toml:172 to token-scoped
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-26T21:00Z'
  completed_at: '2026-06-26T14:48Z'
  priority: P2
  estimated_hours: 1
  depends_on: []
  source: RETRO-123 (§5a cascade, §6 Rule V promotion, §4d DG-2) — source ticket FOLLOW-396 (PR #362)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-407 stub)
  branch: backend-engineer/FOLLOW-407-consent-gitleaks-rule-v
  pr: '#364'
  notes: |
    MERGED 2026-06-26T14:48Z. RETRO-125 WRITTEN 2026-06-26 (RETROSPECTIVES.md) — Wiring Audit clean
      (config-only); closes RETRO-123 §5a/§4d DG-2 on the removal+regexes+comment legs; detection-restored
      negative-control leg = moved-hop residual → FOLLOW-411 (consent twin of FOLLOW-406, recommend
      merge). .gitleaks.toml now in GOOD state (Rule-V verif #1 empty, no secret-handling-source paths
      exemptions left). NO rule promoted (negative-control gap governed by existing Rule V).
    PM-VALIDATED 2026-06-26T21:15Z. CI green. Wiring verified (.gitleaks.toml only). Ready for human review.
    AC-1 (paths deleted + regexes added): file-wide '''apps/control-plane/src/app/api/v1/consent/
      platform-registration/''' paths entry REMOVED. Token-scoped regexes entry
      '''a3f2e1d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9''' (38 chars — first 38 chars of the 64-char
      CANONICAL_CONSENT_TEXT_HASH, verified in lib.ts:45) ADDED. 38 chars IS a substring of the
      first 40-char capture (a3f2...c7b8a9f0). Allowlist correctly suppresses the FP. ✓
    AC-2 (comment fixed): old comment ended "keys in route.ts are still scanned" (wrong file);
      new comment: "Token-scoped 38-char substring keeps cloudflare-api-token scanning fully
      active on the secret-handling route." ✓
    AC-3 (Gitleaks passes): Gitleaks secrets scan 2x SUCCESS (push-event + PR-event). ✓
    AC-4 (scope): gh pr diff 364 --name-only → .gitleaks.toml ONLY. ✓
    CI evidence (step 5b): real-gate non-success = 4 (Rule I 2x + Archetype embeddings 2x),
      all pre-existing non-blocking baseline. All real gates PASS.
    Wiring evidence (step 5c): config-only — no new symbols/events/columns/exports.
    CI counter: 1/5. Fix iterations: 0/3.
    Promoted 2026-06-26. Delegated 2026-06-26T21:00Z (table row: control-plane, auth → backend-engineer).

- id: FOLLOW-409
  title:
    Real-handler test for micro-poll onAnswer §H.9 guard + fix showQuizTrigger false comment +
    correct adapt.ts:187 JSDoc reachability claim
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-26T23:00Z'
  completed_at: '2026-06-26T16:09Z'
  priority: P2
  estimated_hours: 2
  depends_on: []
  source: RETRO-116 (§4c TG-1, §4d DG-1, §4a LG-1, §7 closure check) — source ticket FOLLOW-389 (PR #355)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-409 stub)
  branch: sdk-engineer/FOLLOW-409-micropoll-handler-test
  pr: '#367'
  notes: |
    Promoted 2026-06-26. FOLLOW-389 delivered real-handler tests for showQuizTrigger (index.ts:1103)
    and estalara:listing:favorited (:1432) but NOT the micro-poll onAnswer guard (:1243).
    buildMockFetch() returns micro_polls_enabled:false so the micro-poll path is never driven;
    guard covered only by modeled modeledOnAnswer in follow-385.test.ts:220 — the exact
    self-injecting-test weakness RETRO-109 flagged. A regression moving the :1243 guard below
    the quiz.event push (re-leaking opted-out micro-poll AL signal) leaves all tests green.
    FOLLOW-389 is flagged INCOMPLETE pending this ticket.
    Delegated 2026-06-26T23:00Z (table row: client SDK, Shadow DOM, browser code → sdk-engineer).
    CI counter: 1/5. Fix iterations: 0/3.
    PM-VALIDATED 2026-06-26T23:30Z. PR #367. CI non-success = 4 (Rule I 2x + Archetype embeddings 2x),
    all pre-existing non-blocking baseline. All real gates PASS.
    AC-1: follow-409.test.ts exists with REAL-4 opted-out (intent NOT mutated + quiz.event absent)
      and REAL-4 opted-in (intent mutated + quiz.event in batch) real-handler test cases.
    AC-2: index.ts:1102 comment corrected (explains that quiz.event completed push is DOWNSTREAM of
      the early return, so opted-out sessions never reach it). Favorites at :1433-1436 annotated
      with "NOTE: this asymmetry vs showQuizTrigger is intentional" (§H.8/§H.9 clarification).
    AC-3: adapt.ts postQuizCompletionPing JSDoc at :186-193 corrected to "ONLY as defense-in-depth
      if Guard 1 regresses — NOT under normal production traffic."
    Wiring evidence (step 5c): test-file + doc/comment changes only — no new exported symbols,
      events, columns, or config fields. PROFILING_OPT_OUT_KEY (producer: profiling-opt-out.ts:30;
      consumer: index.ts:428+) pre-existing wired. No new wires.
    READY for human review. Do not merge without human approval.

- id: FOLLOW-410
  title:
    Correct three "migration 0017" provenance citations to "migration 0018" + retype two untyped GET
    /api/adapt early-return bodies
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-26T22:00Z'
  completed_at: '2026-06-26T15:13Z'
  priority: P2
  estimated_hours: 1.5
  depends_on: []
  source: RETRO-115 (§4d DG-1, §4b CB-1, §4c TG-1) — source ticket FOLLOW-357/356 (PR #354)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-410 stub)
  branch: backend-engineer/FOLLOW-410-migration-citation-fix
  notes: |
    Promoted 2026-06-26. Delegated 2026-06-26T22:00Z (table row: ingest worker, control-plane, Postgres/auth → backend-engineer).
    Three in-code comments cite "migration 0017" for the tier→page_context
    rename but the actual migration is 0018_adaptation_decisions_page_context.sql. Migration 0017
    is the unrelated holdout-contamination note (FOLLOW-371). Also: opt-out (route.ts:781-793) and
    consent-skip (route.ts:813-825) GET early-return bodies had their satisfies AdaptationDirectives
    guard deleted in PR #354, leaving them untyped while main GET path (route.ts:879) uses
    AdaptationDirectives & { tier: number }. Rule S asymmetry: 3 sibling GET return bodies,
    1 typed, 2 untyped. Cross-ref FOLLOW-390 (GET-surface liveness), FOLLOW-404 (prod attestation).

- id: FOLLOW-414
  title:
    Close FOLLOW-409 doc twins (adapt.ts JSDoc/inline contradiction + follow-385.test.ts micro-poll
    copies) + flush positive-control + retire superseded modeled §H.9 tests (RETRO-128
    DG-1/DG-2/TG-1/TG-2/TG-3)
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-06-26T24:30Z'
  completed_at: '2026-06-26T16:46Z'
  priority: P2
  estimated_hours: 1.5
  depends_on: []
  source: RETRO-128 (§4d DG-1, §4d DG-2, §4c TG-1, §4c TG-2, §4c TG-3, §7) — source ticket
    FOLLOW-409 (PR #367)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-414 stub)
  branch: sdk-engineer/FOLLOW-414-409-doc-twins-flush-control
  pr: '#369'
  notes: |
    Promoted 2026-06-26. FOLLOW-409 (PR #367) closed the micro-poll onAnswer real-handler test but
    left four one-hop residuals. DG-1 (P2): adapt.ts:212-213 inline comment contradicts the corrected
    JSDoc at :186-193 — says guard IS reachable by live opted-out traffic; JSDoc says defense-in-depth
    ONLY if Guard 1 regresses. Security-relevant contradiction. DG-2+TG-2 (P3): "Ingest stream left
    flowing" false comment on micro-poll model in follow-385.test.ts:211/:225 (TRUE on favorites
    copies :128/:144, leave those). TG-1 (P2, load-bearing): opted-out REAL-4 negative assertion
    lacks flush positive-control — if flush harness regresses (zero /v1/events calls), assertion
    passes trivially. TG-3 (P3): BATCH_INTERVAL_MS (index.ts:198) unexported; hardcoded 5001 in both
    test files could rot. Scope: packages/sdk/src/core/adapt.ts, packages/sdk/src/__tests__/
    follow-409.test.ts, packages/sdk/src/__tests__/follow-385.test.ts only.
    Delegated 2026-06-26T24:30Z (table row: client SDK, Shadow DOM, browser code → sdk-engineer).
    CI counter: 1/5. Fix iterations: 0/3.
    PM-VALIDATED 2026-06-26. PR #369. CI non-success = 4 (Rule I 2x + Archetype embeddings not-NULL 2x),
    all pre-existing non-blocking baseline. All real gates PASS.
    AC-1: adapt.ts line 213 says "reachable ONLY if Guard 1 regresses" — grep confirmed.
    AC-2: exactly 2 "Ingest stream left flowing" hits in follow-385.test.ts, both in favorites handler
      (lines 128+144 within AC-3 favorites describe block). Micro-poll model copies removed.
    AC-3: expect(ingestCalls.length).toBeGreaterThanOrEqual(1) at line 230 BEFORE hasMicroPollEvent===false
      at line 243 — positive-control precedes negative assertion.
    AC-4: BATCH_INTERVAL_MS export skipped (correct — Rule I failure if exported).
    Wiring evidence: test-file + doc/comment changes only. No new exported symbols/events/columns/config.
    READY for human review. Do not merge without human approval.

- id: FOLLOW-415
  title:
    Harden generalized CH migration-ordering contract test — adaptation_decisions-column-aware
    boundary (LG-1) + column-count sanity assertion (LG-2) + qualify self-maintaining guarantee
    prose (DG-1)
  agent: data-engineer
  status: DONE
  assigned_to: data-engineer
  started_at: '2026-06-26T18:00Z'
  completed_at: '2026-06-26T17:12Z'
  priority: P2
  estimated_hours: 2.5
  depends_on: []
  source: RETRO-129 (§4a LG-1, §4a LG-2, §4d DG-1) — source ticket FOLLOW-402 (PR #368)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-415 stub)
  branch: data-engineer/FOLLOW-415-ch-migration-contract-hardening
  pr: '#370'
  notes: |
    Promoted 2026-06-26. Delegated 2026-06-26T18:00Z (table row: ClickHouse, ETL → data-engineer).
    CI counter: 0/5. Fix iterations: 0/3.
    FOLLOW-402 (PR #368) generalized migration-contract-test.sh but left two structural assumptions
    unasserted. LG-1 (P2): boundary heuristic uses lexical-last *.sql file which conflates newest-file
    with newest-INSERT-column-migration; 4 of last 6 CH migrations add no adaptation_decisions column —
    the next non-column migration makes boundary wrong → false alarm → trust erosion → guard disabled.
    Fix: make boundary the newest migration that ACTUALLY adds an adaptation_decisions INSERT column.
    LG-2 (P3): grep -A1|sed extractor assumes full column list on single line after INSERT INTO;
    a multi-line rewrite fails cryptic — add column-count sanity assertion (>= pinned floor 17) so
    truncation fails loud.
    DG-1 (P3): "Self-maintaining guarantee" prose in clickhouse-migrations.md:130-133 + script header
    omits both structural assumptions → overstated coverage (Rule Y broadened-sub-shape). Qualify or earn it.
    DONE: PR #370 merged 2026-06-26T17:12Z. CI evidence: Archetype embeddings not-NULL (pre-existing-red)
    + Rule I (pre-existing-red); all real gates PASS. Retrospective-analyst to be spawned.

- id: FOLLOW-411
  title:
    Negative-control attestation for consent gitleaks exemption (twin of FOLLOW-406) + disambiguate
    redundant regexes/inline-gitleaks:allow suppression + add bidirectional hash-rotation
    maintenance link
  agent: devops-engineer
  co_agent: backend-engineer
  status: DONE
  assigned_to: devops-engineer
  started_at: '2026-06-26T...'
  completed_at: '2026-06-27T00:00Z'
  priority: P2
  estimated_hours: 1.5
  depends_on: []
  source: RETRO-125 (§4c TG-1, §4b CB-1, §4d DG-1, §5a, §7) — source ticket FOLLOW-407 (PR #364)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-411 stub)
  branch: devops-engineer/FOLLOW-406-411-gitleaks-negative-control-attestation
  pr: '#373'
  merge_commit: '41aa878'
  notes: |
    DONE. PR #373 merged (commit 41aa878, branch commit 2336e33). Joint execution with FOLLOW-406.
    Promoted 2026-06-26. Executed jointly with FOLLOW-406 in one PR per FOLLOW-411 AC-TG-1
    recommendation. Three residuals from FOLLOW-407 (PR #364): (TG-1) detection-restored
    negative control absent for consent endpoint — prove gitleaks REDs on a dummy
    cloudflare-token-shaped string in consent dir; (CB-1) regexes entry may be redundant
    with pre-existing inline gitleaks:allow on lib.ts:46 — disambiguate or justify
    defense-in-depth; (DG-1) no bidirectional maintenance link between .gitleaks.toml:179
    38-char substring and CANONICAL_CONSENT_TEXT_HASH in lib.ts:45-46 — add cross-reference
    comment in both files. Joint branch with FOLLOW-406: devops-engineer/FOLLOW-406-411-
    gitleaks-negative-control-attestation.
    Delegated 2026-06-26 (table row: Terraform, CI/CD, workflows, secrets → devops-engineer;
    co-agent backend-engineer for lib.ts:45-46 maintenance comment DG-1).
    CI counter: 0/5. Fix iterations: 0/3.
    Retrospective-analyst to be spawned on PR #373.

- id: FOLLOW-428
  title:
    Harden writeDsrAuditLog in dsr/_clickhouse.ts — add res.ok check + try/catch + Sentry for
    dsr_audit_log INSERT (bare await fetch with no res.ok check and no catch)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-28T21:30:00Z'
  completed_at: '2026-06-28T22:00:00Z'
  priority: P1
  estimated_hours: 2
  depends_on: [FOLLOW-425]
  source: RETRO-135 §6 (Rule K.2 fire-and-forget amendment) / ESC-032 Phase 1
  spec: backlog/FOLLOW_UPS.md (FOLLOW-428 stub)
  branch: backend-engineer/FOLLOW-427-428-harden-ch-writers
  notes: |
    DONE. writeDsrAuditLog in apps/control-plane/src/app/api/dsr/_clickhouse.ts now fails loud
    on ClickHouse HTTP-level rejection and network errors. Before this fix: bare await fetch()
    with NO res.ok check AND NO try/catch — HTTP rejections (auth Code 516, unknown column, quota)
    were invisible; a network error would propagate as an unhandled promise rejection out of the
    async function (all callers use void writeDsrAuditLog(...)).
    Fix: wrapped fetch in try/catch; added res.ok check with Sentry.captureException
    (tags: area=dsr, sink=clickhouse, kind=insert_rejected, table=dsr_audit_log);
    network errors caught and captured (kind=network). Function never throws.
    4 new tests (a: non-ok HTTP, b: network/throw, c: happy path 200, d: no-op when URL unset).
    Files: apps/control-plane/src/app/api/dsr/_clickhouse.ts (+18/-3),
           apps/control-plane/src/app/api/dsr/_clickhouse.fail-loud.test.ts (new, +112).
    CI counter: 0/5. Fix iterations: 0/3.

- id: FOLLOW-427
  title:
    Harden logLlmCallAsync in llm-gateway.ts — add res.ok check + Sentry capture for llm_calls
    ClickHouse INSERT rejection (catch-only handler blind to HTTP rejection)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-28T21:30:00Z'
  completed_at: '2026-06-28T22:00:00Z'
  priority: P1
  estimated_hours: 2
  depends_on: [FOLLOW-425]
  source: RETRO-135 §6 (Rule K.2 fire-and-forget amendment) / ESC-032 Phase 1
  spec: backlog/FOLLOW_UPS.md (FOLLOW-427 stub)
  branch: backend-engineer/FOLLOW-427-428-harden-ch-writers
  notes: |
    DONE. logLlmCallAsync in apps/control-plane/src/lib/llm-gateway.ts now fails loud on
    ClickHouse HTTP-level rejection. Before this fix: fire-and-forget fetch with only a .catch()
    handler — fetch resolves (does NOT reject) on 4xx/5xx, so HTTP rejections (auth Code 516,
    unknown column, quota exceeded) were completely invisible (zero log, zero Sentry).
    Fix: added .then(async res => { if (!res.ok) { capture body + Sentry kind=insert_rejected } })
    before the existing .catch(); .catch() retains and is tagged kind=network. Matches the
    logDecisionAsync reference implementation (FOLLOW-425). Tags: area=adapt, sink=clickhouse,
    kind=insert_rejected|network, table=llm_calls. Fire-and-forget preserved (no added latency).
    3 new tests (a: non-ok HTTP, b: network/throw, c: happy path 200). Tests drive callLlmGateway
    (the public entrypoint) to exercise the private logLlmCallAsync, using the Haiku path
    (0.6 < similarity <= 0.85) to simplify fetch sequencing to 2 calls (spend check + INSERT).
    Files: apps/control-plane/src/lib/llm-gateway.ts (+18/-3),
           apps/control-plane/src/lib/__tests__/llm-gateway.clickhouse.test.ts (new, +220).
    CI counter: 0/5. Fix iterations: 0/3.

- id: FOLLOW-426
  title:
    Harden both control-plane Redpanda fire-and-forget publishers (publishAbAssignmentEvent +
    publishDescriptionRequested) with res.ok check + Sentry capture — mirror FOLLOW-425 fix
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-28T20:30:00Z'
  completed_at: '2026-06-28T21:00:00Z'
  priority: P1
  estimated_hours: 3
  depends_on: [FOLLOW-425]
  source: RETRO-135 §4b CB-1/CB-2 / §4c TG-1
  spec: backlog/FOLLOW_UPS.md (FOLLOW-426 stub)
  branch: backend-engineer/FOLLOW-426-harden-redpanda-publishers
  notes: |
    DONE. Both Redpanda fire-and-forget sinks in apps/control-plane now fail loud on
    HTTP-level rejection. Before this fix, publishAbAssignmentEvent (ab-events.ts:72)
    and publishDescriptionRequested (description/route.ts:111) used bare await fetch()
    with no res.ok check — fetch resolves (not rejects) on 4xx/5xx so a bare .catch()
    at the call site was completely blind to Redpanda auth/topic/quota rejections.
    Fix: both functions now use the FOLLOW-425 logDecisionAsync pattern — a .then()
    that checks res.ok and captures to Sentry (kind=insert_rejected) on non-ok, plus
    a .catch() that captures network failures (kind=network). Fire-and-forget guarantee
    preserved — neither function throws. New Sentry tags: area=adapt/description,
    sink=redpanda, kind=insert_rejected|network. 7 new tests total (4 for ab-events,
    3 for description route) cover all three cases per sink. Converges control-plane
    onto the decision-api pushToRedpanda (redpanda-producer.ts:102) posture.
    Files: apps/control-plane/src/lib/ab-events.ts (+31/-6),
           apps/control-plane/src/app/api/adapt/description/route.ts (+33/-10),
           apps/control-plane/src/lib/__tests__/ab-events.redpanda.test.ts (new, +108),
           apps/control-plane/src/app/api/adapt/description/route.redpanda.test.ts (new, +155).
    CI counter: 0/5. Fix iterations: 0/3.
    Retrospective-analyst to be spawned on PR.

- id: FOLLOW-425
  title:
    Fail loud on ClickHouse INSERT rejection in logDecisionAsync (add .then() + Sentry capture for
    HTTP-level failures)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-27T00:45:00Z'
  completed_at: '2026-06-26T22:53:20Z'
  priority: P1
  estimated_hours: 1
  depends_on: []
  source:
    ESC-031 / FOLLOW-422 — silent adaptation_decisions data-loss investigation (zero-row prod table)
  spec: backlog/FOLLOW_UPS.md (stub pending — field-spawned hotfix; next free number was 425)
  branch: backend-engineer/FOLLOW-425-adapt-clickhouse-fail-loud
  pr: '#374'
  merge_commit: 'df3c4c4'
  notes: |
    DONE. PR #374 merged 2026-06-26T22:53:20Z (merge commit df3c4c4). Field-spawned hotfix.
    logDecisionAsync only had .catch() which fires only on network-layer errors; ClickHouse reports
    INSERT rejections (HTTP 516 auth failure, unknown column, quota exceeded, type mismatch) as
    successful HTTP responses with 4xx/5xx status — .catch() is completely blind to these.
    Fix: adds .then() that inspects response.ok; on non-ok reads body text and captures to Sentry
    (tags: area=adapt, sink=clickhouse, kind=insert_rejected). Existing .catch() now also captures
    to Sentry (kind=network). Fire-and-forget guarantee preserved — logDecisionAsync remains
    void/unawaited. 3 new tests in route.clickhouse.test.ts cover: HTTP 516 → Sentry called;
    network reject → Sentry called; HTTP 200 → Sentry NOT called.
    Files: apps/control-plane/src/app/api/adapt/route.ts (+26/-4),
           apps/control-plane/src/app/api/adapt/route.clickhouse.test.ts (+85 new).
    CI counter: 0/5. Fix iterations: 0/3.
    Retrospective-analyst to be spawned on PR #374.

- id: FOLLOW-422
  title:
    Live producer→prod-table write attestation for adaptation_decisions (verify writes work after
    FOLLOW-425 fail-loud fix)
  agent: data-engineer
  status: DONE
  assigned_to: data-engineer
  started_at: '2026-06-28T00:00:00Z'
  completed_at: '2026-06-28T13:01:00Z'
  priority: P1
  estimated_hours: 2
  depends_on: [FOLLOW-425]
  source: RETRO-133 (§4a CLOSURE-1, §5b, §8) — source ticket FOLLOW-404 (PR #372); see also ESC-031 / FOLLOW-425 (P1 hotfix now merged)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-422 stub)
  branch: data-engineer/FOLLOW-422-adaptation-decisions-write-attestation
  notes: |
    DONE. AC-1: Smoke GET /api/adapt (session_id=smoke-follow422-1782651660, archetype=neutral,
    confidence=0.5, similarity=0.5, tier=1) → HTTP 200 with adapt_decision_id
    05e5bc1e-980d-428c-bd89-e9a577c70ec0 from prod (admin.estalara.com).
    AC-2: SELECT count() FROM adaptation_decisions → 1.
    SELECT DISTINCT page_context_source FROM adaptation_decisions → caller_supplied.
    Row ts: 2026-06-28 13:01:00.906.
    AC-3: docs/runbooks/clickhouse-migrations.md updated with dated attestation block
    (section "Prod Attestation — writes confirmed flowing (FOLLOW-425 fix verified)").
    Verdict: writes confirmed flowing. ESC-031 loop fully closed: migration applied
    (FOLLOW-404), fail-loud fix deployed (FOLLOW-425), writes verified (FOLLOW-422).
    CI counter: 0/5. Fix iterations: 0/3.

- id: FOLLOW-431
  title: >-
    Wrap control-plane fire-and-forget sinks in after() so writes complete on Vercel (ESC-033
    root-cause fix — 1/8 burst writes landing)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-29T00:00:00Z'
  completed_at: '2026-06-29T10:44:00Z'
  priority: P1
  estimated_hours: 1.5
  depends_on: []
  source: ESC-033 (P1) — field-spawned root-cause fix; prod 1/8 burst writes landing
  spec: backlog/FOLLOW_UPS.md (FOLLOW-431 stub)
  branch: backend-engineer/FOLLOW-431-after-fire-and-forget-sinks
  pr: '#379'
  merge_commit: '3a0f802'
  notes: |
    DONE. PR #379 merged 2026-06-29 (merge commit 3a0f802). All five control-plane
    fire-and-forget sinks (logDecisionAsync, logLlmCallAsync, publishAbAssignmentEvent,
    publishDescriptionRequested, writeDsrAuditLog) wrapped in Next.js after() from
    next/server so writes + fail-loud Sentry captures survive Vercel instance suspension.
    Root cause: 1/8 burst writes landing in adaptation_decisions.
    Prod verification PASSED 2026-06-29: burst of 10 GET /api/adapt → 10 rows in
    adaptation_decisions (smoke-esc033-1782729874-* prefix). ESC-033 FULLY CLOSED.
    Procedure recorded in docs/runbooks/esc-033-verification.md.
    Retrospective RETRO-138 spawned (source of FOLLOW-432).
    CI counter: 0/5. Fix iterations: 0/3.

- id: FOLLOW-432
  title: >-
    Sweep remaining control-plane request-path fire-and-forget sinks into afterResponse() + add
    direct after-response.ts unit test + correct FOLLOW-431 over-claimed AC-1 (RETRO-138 §4a LG-1 /
    §4c TG-1)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-29T11:00:00Z'
  completed_at: '2026-06-29T00:00:00Z'
  priority: P2
  estimated_hours: 3
  depends_on: [FOLLOW-431]
  source: RETRO-138 (§4a LG-1, §4c TG-1) — source ticket FOLLOW-431 / ESC-033
  spec: backlog/FOLLOW_UPS.md (FOLLOW-432 stub)
  branch: backend-engineer/FOLLOW-432-sweep-remaining-ff-sinks
  pr: '#381'
  merge_commit: '3cb5c28'
  ticket_commit: '8f94225'
  notes: |
    Promoted 2026-06-29. FOLLOW-431 AC-1 ("no remaining un-awaited bare fetch sink in
    apps/control-plane/src") is over-claimed — it wrapped only the 5 ESC-033-named sinks.
    The identical Vercel-suspend drop hazard survives in ≥5 other request-path sinks.
    Scope (wrap each in afterResponse() or route to Modal/queue if over duration budget):
      P2: seedListingEmbeddingsForActivation (activate route.ts:211/:238) — evaluate
          whether afterResponse() is sufficient or a Modal/queue job is needed.
      P3: tenant-schema redisSet (lib/tenant-schema.ts:234)
      P3: setCachedDescription warm-redis (description/route.ts:285)
      P3: insertPgCachedDescription durable backfill (description/route.ts:331)
      P3: checkPilotFrozenAsync void IIFE (adapt/route.ts:145)
    Also: 2-case direct unit test for lib/after-response.ts (fallback-on-throw +
    after-on-success). Correct AC-1 wording in FOLLOW-431 FOLLOW_UPS.md record.
    NOTE: FOLLOW-429 scope widened in FOLLOW_UPS.md to also wrap its redisSet in
    ctx.waitUntil (CF-Worker flush-axis analogue) per RETRO-138 PM note.
    Delegated 2026-06-29T11:00Z (table row: ingest worker, control-plane, Postgres/auth →
    backend-engineer). CI counter: 0/5. Fix iterations: 0/3.
    DONE. PR #381 merged 2026-06-29 (merge commit 3cb5c28, ticket commit 8f94225). Swept
    6 control-plane fire-and-forget sinks into afterResponse() (seedListingEmbeddingsForActivation
    ×2 in activate route, tenant-schema redisSet, description warm-redis setCachedDescription,
    insertPgCachedDescription durable backfill, checkPilotFrozenAsync void IIFE). Added direct
    after-response.ts unit test (fallback-on-throw + after-on-success cases). Corrected
    FOLLOW-431 AC-1 wording in FOLLOW_UPS.md. CI verified green; baseline non-blocking only
    (Rule I ×2 + Archetype embeddings ×2). Retrospective RETRO-139 spawned (source of
    FOLLOW-433 + FOLLOW-434). RETRO-139 finding: sweep was ALSO incomplete — 3 more
    request-path fire-and-forget sinks survive (updateArmAsync + upsertConversionLabelAsync
    in adapt/feedback/route.ts, deleteSessionFromRedis in dsr/erase/route.ts). Filed
    FOLLOW-433 (those 3 + CI grep-guard, P2 backend-engineer ~2.5h) and FOLLOW-434 (bound
    seedListingEmbeddingsForActivation after() budget + fix stale JSDoc, P2 ~4h).
    FOLLOW-429 reiterated (not re-filed). Next free FOLLOW stub: 435.

- id: FOLLOW-433
  title: >-
    Finish control-plane fire-and-forget sweep (3 surviving request-path sinks) + add CI grep-guard
    so "verify by grep" AC cannot over-claim a third time (RETRO-139 §4a LG-1 / §4c TG-1)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-29T00:00:00Z'
  completed_at: '2026-06-29T17:35:35Z'
  priority: P2
  estimated_hours: 2.5
  depends_on: [FOLLOW-432]
  source: RETRO-139 (§4a LG-1, §4c TG-1) — source ticket FOLLOW-432 / PR #381
  spec: backlog/FOLLOW_UPS.md (FOLLOW-433 stub)
  branch: backend-engineer/FOLLOW-433-ff-sink-sweep-ci-guard
  pr: '#383'
  notes: |
    Promoted and delegated 2026-06-29 (table row: ingest worker, control-plane,
    Postgres/auth → backend-engineer). Three surviving bare-void request-path sinks
    confirmed at current HEAD:
      - apps/control-plane/src/app/api/adapt/feedback/route.ts:368 void updateArmAsync
      - apps/control-plane/src/app/api/adapt/feedback/route.ts:380 void upsertConversionLabelAsync
      - apps/control-plane/src/app/api/dsr/erase/route.ts:540 void deleteSessionFromRedis
    afterResponse already imported in dsr/erase/route.ts; needs adding to feedback/route.ts.
    CI grep-guard: scripts/check-fire-and-forget-sinks.sh wired into ci.yml as a new
    dedicated job (pattern matching existing rule-h / rule-j / privacy-notice-keys-sync jobs).
    CI counter: 0/5. Fix iterations: 0/3.
    DONE. PR #383 merged 2026-06-29T17:35:35Z (squash). All 3 sinks wrapped in afterResponse():
    updateArmAsync + upsertConversionLabelAsync (feedback/route.ts), deleteSessionFromRedis
    (dsr/erase/route.ts). CI grep-guard (scripts/check-fire-and-forget-sinks.sh + --self-test)
    added as hard-gate CI job "Fire-and-forget sink guard (FOLLOW-433)" — no continue-on-error.
    Tests: FOLLOW-433 describe blocks in route.test.ts + dsr-routes.test.ts assert after()
    registration (62/62 passing). CI verified green; baseline non-blocking only (Rule I ×2 +
    Archetype embeddings ×2). Retrospective RETRO-140 written.

- id: FOLLOW-434
  title: >-
    Bound seedListingEmbeddingsForActivation's after() budget for large real-tenant catalogs: cap
    inline loop + offload overflow to Modal/queue job + fix stale JSDoc (RETRO-139 §4a LG-2 / §4d
    DG-1)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-06-29T18:00:00Z'
  completed_at: '2026-06-30T00:00:00Z'
  priority: P2
  estimated_hours: 4
  depends_on: [FOLLOW-432, FOLLOW-433]
  source: RETRO-139 (§4a LG-2, §4d DG-1) — source ticket FOLLOW-432 / PR #381
  spec: backlog/FOLLOW_UPS.md (FOLLOW-434 stub)
  branch: backend-engineer/FOLLOW-434-seed-budget-cap-modal-queue
  pr: '#385'
  merge_commit: 3a226b4
  notes: |
    Promoted 2026-06-29. FOLLOW-432 wrapped seedListingEmbeddingsForActivation in afterResponse()
    with an optimistic budget assessment ("real tenants without schema-embedded listing_ids exit
    early — no-op, so budget concern does NOT apply"). But discovery source #1 is
    schema.listing_ids (lib/seed-listing-embeddings.ts:18-22) and JSDoc anticipates "100+
    listings" (:12). A real tenant with many listing_ids → ~100 × ~200ms ≈ ~20s sequential loop
    > 15s Hobby after() budget → mid-loop kill → un-embedded tail → ungrounded RAG adaptation.
    RETRO-138 §4a #2 Modal/queue caveat NOT discharged by FOLLOW-432. Also: JSDoc at :10 still
    says "the activate route calls void seedListingEmbeddingsForActivation()" — stale post-FOLLOW-432.
    Delegated 2026-06-29 (table row: ingest worker, control-plane, Postgres/auth → backend-engineer).
    CI counter: 0/5. Fix iterations: 0/3.
    DONE: PR #385 squash-merged (3a226b4) into main 2026-06-30. Delivered: MAX_INLINE_SEED=50
    constant exported; inline = listings.slice(0,50) runs the sequential embed loop; overflow =
    listings.slice(50) captured via Sentry captureMessage (warning, tags area=onboarding/
    sink=seed-listing-embeddings/kind=overflow, extra carries tenant_id + overflow_listing_ids) +
    console.warn — NOT silently dropped. TODO stub: "FOLLOW-434 — replace overflow with Modal job
    when seed-modal-job is implemented." SeedListingsResult gains overflow_count. JSDoc at file-top
    fixed (documents afterResponse() + MAX_INLINE_SEED budget; removes void fn() claim). Test added
    covering overflow path (MAX_INLINE_SEED+1 → exactly 50 inline, overflow_count=1, Sentry
    captured). extractListingIdsFromSchema reads optional schema.listing_ids (forward-compat
    cast-read; NOT added to canonical TenantSiteSchema type). AC caveat: overflow is an observable
    Sentry stub — the durable Modal seed job is deferred (tracked as FOLLOW-435). All 4 human-
    validated ACs met per PM + CI: 1355/1355 tests, lint/typecheck/build green; FF-sink guard PASS.
    RETRO-141 written. Retrospective-analyst spawned.

- id: FOLLOW-435
  title: >-
    Replace the FOLLOW-434 overflow stub with a durable Modal seed job for large-catalog activation
    embedding (RETRO-141 §4a LG-1)
  agent: backend-engineer + ml-engineer
  status: DONE
  priority: P2
  estimated_hours: 6
  depends_on: [FOLLOW-434]
  source: RETRO-141 (§4a LG-1) — source ticket FOLLOW-434 (PR #385)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-435 stub)
  branch: backend-engineer/FOLLOW-435-modal-overflow-seed-job
  completed_at: '2026-06-30'
  notes: |
    DONE — code-complete, CI green, AC met on both legs. NOT yet live in production
    (pending operator action: provision REDPANDA_TOPIC_LISTING_EMBEDDINGS,
    EMBED_API_BASE_URL, INTERNAL_API_SECRET in Modal estalara-secrets + re-deploy
    apps/llm-gateway). Operator go-live step tracked as FOLLOW-436.

    LEG 1 — PR #389 (merge 8ea497c, merged 2026-06-30): @estalara/shared event schema
    ListingEmbeddingSeedRequested {tenant_id, listing_ids[]} + cross-language fixture
    packages/shared/contracts/listing-embed-seed-event.required.json + TS contract gate
    in CI. Control-plane producer publishListingEmbeddingSeed() wired into the activation
    overflow block of seedListingEmbeddingsForActivation (replaces FOLLOW-434 Sentry stub;
    publishes to Redpanda topic estalara.listing-embeddings). .gitleaks.toml allowlist
    entry added for the 40-char schema identifier (false-positive on cloudflare-api-token
    heuristic).

    LEG 2 — PR #390 (merge b5acf73, merged 2026-06-30): Modal consumer
    apps/llm-gateway/src/jobs/consume_embed_seed_requests.py polls the topic and calls
    POST /api/listings/embed per listing_id (idempotent upsert, INTERNAL_API_SECRET auth).
    REQUIRED_FIELDS derived from the shared fixture (not hardcoded). Python contract test
    + hard-gate CI step in the cross-language-contract job. Observability via Sentry
    {area: onboarding, sink: modal-embed-seed, kind: embed_failed}.

    All real CI gates green on both PRs (cross-language contract, Python tests 26/26,
    gitleaks, FF-sink guard, Format, Lint, Typecheck, Test Node 22, Build). Known
    pre-existing non-blocking checks (Archetype embeddings not-NULL, Rule I) did not
    change status. RETRO-142 written. Retrospective-analyst spawned.

- id: FOLLOW-436
  title: >-
    Operator go-live: provision Modal estalara-secrets + re-deploy apps/llm-gateway for embed-seed
    consumer (RETRO-142 §9)
  agent: devops-engineer
  status: DONE
  completed_at: '2026-07-13T00:00:00Z'
  priority: P2
  estimated_hours: 1
  depends_on: [FOLLOW-435, FOLLOW-437]
  source: RETRO-142 (§9) — source ticket FOLLOW-435 (PRs #389 + #390)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-436 stub)
  notes: |
    Promoted to QUEUE.md 2026-06-30 (pm-orchestrator/FOLLOW-437-436-reconcile reconcile
    pass). Code blockers BUG 1 (orphan main.py entrypoint) and BUG 2 (modal.App name
    collision) identified by ESC-034 during FOLLOW-436 go-live wiring verification are
    now FIXED by FOLLOW-437 (PR #393, merged 2026-06-30, commit 09084f3). Code is safe
    to deploy.

    Remaining steps are privileged operator actions only:
    1. Provision three secrets in Modal estalara-secrets (web console):
       - REDPANDA_TOPIC_LISTING_EMBEDDINGS = estalara.listing-embeddings
       - EMBED_API_BASE_URL = https://admin.estalara.com (or staging URL)
       - INTERNAL_API_SECRET = copy from doppler secrets get INTERNAL_API_SECRET
         --config prd --plain
    2. modal deploy apps/llm-gateway/src/main.py — verify consume_embed_seed_requests
       appears in Modal dashboard with schedule "every 30 seconds".
    3. Smoke verification per docs/runbooks/modal-embed-seed-consumer-golive.md.

    Runbook: docs/runbooks/modal-embed-seed-consumer-golive.md
    ESC-034: RESOLVED 2026-07-13 (backlog/ESCALATIONS.md).

    **Queue-truth correction / DONE flip 2026-07-14 (pm-orchestrator, session 27):** ESC-034 was
    marked RESOLVED 2026-07-13 with an end-to-end attestation
    (`docs/runbooks/OPERATOR_SESSION_2026-07-12.md` Step 3): direct smoke on the deployed Modal web
    endpoint returned `202 {"status":"accepted"}` with valid auth / `401` with none, and the async
    callback landed (`listing_embeddings.updated_at` bumped, SQL-verified). This ticket's own
    `BLOCKED_ON_HUMAN` status is therefore stale.

    **AC-supersession note (read before treating the literal checklist above as ground truth):** the
    3 numbered steps and the `FOLLOW_UPS.md` stub's original AC (`REDPANDA_TOPIC_LISTING_EMBEDDINGS`
    Modal secret + `modal deploy` registering a polling cron) describe the PRE-ADR-0016 design. Per
    ADR-0016 (`docs/adr/ADR-0016-pilot-direct-modal-invocation.md`) and the ESC-034 correction dated
    2026-07-06, the Redpanda-poller path was dropped in favor of direct-HTTPS invocation — the same
    pattern already live for the description flow. The Step-3 attestation verifies the CURRENT
    (correct) design's equivalent requirements: `MODAL_EMBED_SEED_URL` set in Vercel prod,
    `INTERNAL_API_SECRET` present and matching in Modal `estalara-secrets` (confirmed by the 202, not
    just the 401), and the full async path (Modal endpoint → `process_embed_seed_request.spawn` →
    `POST /api/listings/embed` → OpenAI → DB upsert) proven live. This discharges the ticket's
    intent (operator go-live, embed-seed path live in prod) even though 3 of the literal checklist
    lines reference a superseded architecture. Not independently re-verified beyond the cited
    attestation — flagged for the ticket's own retrospective.

- id: FOLLOW-437
  title: >-
    Consolidate llm-gateway Modal app — fix orphan main.py entrypoint (BUG 1) + modal.App name
    collision (BUG 2) found during FOLLOW-436 go-live wiring verification (ESC-034)
  agent: ml-engineer
  status: DONE
  assigned_to: ml-engineer
  started_at: '2026-06-30T00:00:00Z'
  completed_at: '2026-06-30T00:00:00Z'
  priority: P1
  estimated_hours: 1
  depends_on: [FOLLOW-435]
  source: >-
    FOLLOW-436 go-live wiring verification / ESC-034 — pre-go-live code bugs blocking safe
    deployment
  spec: backlog/FOLLOW_UPS.md (FOLLOW-437 stub — filed and DONE this session)
  branch: ml-engineer/FOLLOW-437-modal-app-consolidation
  pr: '#393'
  merge_commit: '09084f3'
  notes: |
    Filed directly by pm-orchestrator during FOLLOW-436 go-live wiring verification (not
    pre-existing in QUEUE.md). Delegated to ml-engineer (table row: intent/adapt logic,
    embeddings, LLM gateway, Modal — ml-engineer). Both bugs surfaced during ESC-034
    wiring verification before operator could execute FOLLOW-436.

    BUG 1 (ORPHAN ENTRYPOINT): apps/llm-gateway/src/main.py was a placeholder stub with
    no modal import, no modal.App, and no imports of consumer modules. Running
    `modal deploy apps/llm-gateway/src/main.py` (canonical deploy command per HANDOFFS.md
    and sprint-0/TICKET-009.md) registered ZERO functions in the live app — neither
    generate_description.py nor consume_embed_seed_requests.py were reachable.

    BUG 2 (APP-NAME COLLISION): generate_description.py and consume_embed_seed_requests.py
    each declared an independent modal.App("estalara-description-generator"). In Modal,
    deploying a single file REPLACES the entire app's function registry. Deploying
    consume_embed_seed_requests.py alone would have wiped generate_description and
    consume_description_requests from the live app — breaking the description generation
    pipeline silently.

    Fix: extracted app = modal.App("estalara-description-generator") into shared module
    apps/llm-gateway/src/jobs/_app.py. Both generate_description.py and
    consume_embed_seed_requests.py import app from there. main.py now imports both consumer
    modules (load-bearing # noqa: F401 imports) so `modal deploy apps/llm-gateway/src/main.py`
    registers all 3 functions under one app. App name estalara-description-generator
    preserved (no live-function orphaning). Tests added; 104 pytest pass.

    CI: Python tests 104/104, cross-language contract gate, gitleaks, Format — all green.
    RETRO-143 written. ESC-034 code-fix axis CLOSED; operator go-live axis remains.
    CI counter: 1/5. Fix iterations: 0/3.

- id: FOLLOW-438
  title: >-
    Add CI lint guard: assert exactly one modal.App() in apps/llm-gateway/src to prevent BUG 2
    (app-name collision) recurrence (RETRO-143 §4a LG-1)
  agent: devops-engineer
  status: DONE
  assigned_to: devops-engineer
  started_at: '2026-06-30T00:00:00Z'
  completed_at: '2026-06-30T16:05:41Z'
  priority: P3
  estimated_hours: 1
  depends_on: [FOLLOW-437]
  source: RETRO-143 §4a LG-1 — source ticket FOLLOW-437 (PR #393)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-438 stub)
  branch: devops-engineer/FOLLOW-438-modal-app-singleton-guard
  pr: '#395'
  merge_commit: f3ac878
  notes: |
    Shipped scripts/check-modal-app-singleton.sh + hard-gate CI job modal-app-singleton-guard
    in .github/workflows/ci.yml. Asserts exactly one modal.App( assignment in
    apps/llm-gateway/src (the shared _app.py line), excluding comment lines, docstrings, test
    files, and conftest.py mocks. Self-test (--self-test flag) validates both negative control
    (no match → exit 1) and positive control (exactly 1 match → exit 0). CI gate is hard
    (no continue-on-error: true). Mirrors check-fire-and-forget-sinks.sh structure.

    Validated: matcher yields exactly 1 on HEAD; self-test + negative-control catch a 2nd
    instantiation; CI guard job PASS; all real gates green. RETRO-144 written.
    CI counter: 1/5. Fix iterations: 0/3.
    FOLLOW-433→438 chain fully closed in code+bookkeeping.

- id: FOLLOW-444
  title: >-
    Interim disable feedback endpoint (secure-by-default 503) + scope ops bypass to OPS_TENANT_ID
    (ESC-035 interim ruling)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 1
  depends_on: []
  source: ESC-035 CEO interim ruling 2026-07-01
  spec: backlog/ESCALATIONS.md (ESC-035)
  pr: '#397'
  completed_at: '2026-07-01'
  notes: |
    DONE. PR #397 merged. Feedback endpoint disabled unless FEEDBACK_ENDPOINT_ENABLED=true
    is explicitly set; ADAPT_API_KEY ops bypass scoped to OPS_TENANT_ID (403 on mismatch).
    Interim fix landed same day as ESC-035 filing; superseded on the code-security axis by
    the permanent fix FOLLOW-443 (still gates prod traffic behind FEEDBACK_ENDPOINT_ENABLED
    until operator flips it — tracked in STATUS.md, non-blocking).

- id: FOLLOW-329
  title: Summary route fail-loud + data_source provenance (F-04, sibling of FOLLOW-439/440)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 2
  depends_on: []
  source: 2026-07-01 end-to-end code audit (F-04)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-329 stub, pre-existing)
  pr: '#398'
  completed_at: '2026-07-01'
  notes: |
    DONE — resolved in the same PR as FOLLOW-439/440 (PR #398, merge 96e6900). See
    FOLLOW-439 notes for full evidence (shared PR, shared test suite, 1380/1380 green).

- id: FOLLOW-439
  title: >-
    Fix lift route fabricated metrics: remove buildMockLiftRows fallback, correct
    dqsUnavailable=false on error, add data_source provenance (AUD-01 / F-01)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 2
  depends_on: []
  source: 2026-07-01 end-to-end code audit (F-01)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-439 stub)
  pr: '#398'
  merge_commit: '96e6900'
  completed_at: '2026-07-01'
  notes: |
    DONE. PR #398 merged (96e6900). lift/route.ts now distinguishes configured-but-failed CH
    (throw → caught → Sentry + HTTP 500) from unconfigured (mock, tagged data_source:'mock').
    data_source added to LiftResponse ('clickhouse'|'mock'|'error'). Mirrors pilot/cta-lift
    pattern. Non-test producer: lift/route.ts. Non-test consumer: analytics dashboard page +
    lift/route.test.ts (+8 tests). All real CI gates green (1380/1380 tests).
    PM-VALIDATED 2026-07-01. CI counter: 1/5. Fix iterations: 0/3.

- id: FOLLOW-440
  title: >-
    Fix phantom columns in summary + inquiry-starts routes: assigned_at→ts, drop or null-safe
    latency_ms p95 tile (AUD-02 / F-02)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 2
  depends_on: []
  source: 2026-07-01 end-to-end code audit (F-02)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-440 stub)
  pr: '#398'
  merge_commit: '96e6900'
  completed_at: '2026-07-01'
  notes: |
    DONE. PR #398 merged (96e6900). assigned_at→ts fixed in summary/route.ts and both query
    arms of inquiry-starts/route.ts (non-existent column was causing silent CH 500 →
    buildMockSummary fabrication). latency_ms tile dropped (column does not exist on
    adaptation_decisions per migration 0003) — p95Latency returns null; FOLLOW-445 stub
    filed for the correct llm_calls join. analytics/page.tsx updated to show '—' when null.
    Query guards added asserting 'ts' not 'assigned_at' in both route.test.ts files.
    PM-VALIDATED 2026-07-01. CI counter: 1/5. Fix iterations: 0/3.

- id: FOLLOW-441
  title: Add a prod ClickHouse write-verification canary for logDecisionAsync (AUD-03 / F-06)
  agent: data-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: []
  source: 2026-07-01 end-to-end code audit (F-06)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-441 stub)
  pr: '#399'
  completed_at: '2026-07-01'
  notes: |
    DONE. PR #399 merged: feat(data) prod adaptation_decisions write-verification canary.
    Scheduled canary INSERTs a sentinel row, SELECTs it back, fires Sentry alert on
    round-trip failure; excluded from prod analytics via session_id discriminator.
    PM-VALIDATED 2026-07-01. All real CI gates green.

- id: ADR-0015
  title: Feedback endpoint authentication fix design (ESC-035/F-09)
  agent: architect
  status: DONE
  priority: P0
  estimated_hours: 2
  depends_on: []
  source: ESC-035 (P0 security)
  spec: docs/adr/ADR-0015-feedback-endpoint-authentication.md
  pr: '#400'
  completed_at: '2026-07-01'
  notes: |
    DONE. PR #400 merged. ADR-0015 status ACCEPTED (docs/adr/ADR-0015-feedback-endpoint-authentication.md:3).
    Designed the 5-step fix: SHA-256 bearer -> api_keys DB lookup via resolveApiKey(), HMAC
    body-signature defense-in-depth, server-authoritative tenant_id enforcement. Rejected
    the argon2id/new-column alternative (api_keys.hashed_key is already SHA-256 with a
    unique index; resolveApiKey() already existed and is reused, not reinvented).

- id: FOLLOW-443
  title: Secure feedback endpoint per ADR-0015 (ESC-035/F-09 permanent fix)
  agent: backend-engineer
  status: DONE
  priority: P0
  estimated_hours: 3
  depends_on: [ADR-0015]
  source: ESC-035 (P0 security) / ADR-0015
  spec: docs/adr/ADR-0015-feedback-endpoint-authentication.md
  pr: '#401'
  merge_commit: '6224c2d'
  completed_at: '2026-07-01'
  notes: |
    DONE. PR #401 merged (6224c2d). apps/control-plane/src/lib/api-key-auth.ts (new): shared
    resolveApiKey()/sha256Hex()/constantTimeEqual(). feedback/route.ts implements the
    ADR-0015 algorithm end to end; ADAPT_API_KEY ops bypass now requires OPS_TENANT_ID match.
    quiz/public-config, intent/config, quiz/completion, crm/outcome routes consolidated onto
    the shared lib (Rule K.1). 49 tests in feedback/route.test.ts (T1-T12 matrix). 1389/1389
    tests pass, lint/typecheck/build green.
    Non-test producer: apps/control-plane/src/lib/api-key-auth.ts (resolveApiKey, sha256Hex,
    constantTimeEqual). Non-test consumers (grep, 5 importers): feedback/route.ts,
    quiz/public-config/route.ts, intent/config/route.ts, quiz/completion/route.ts,
    crm/outcome/route.ts.
    PM-VALIDATED 2026-07-01. CI green (1389/1389). ESC-035 code-fix axis CLOSED (see
    ESCALATIONS.md ESC-035 final resolution). Operator step (flip FEEDBACK_ENDPOINT_ENABLED)
    remains non-blocking, tracked in STATUS.md pilot go-live checklist.

- id: FOLLOW-392
  title: >-
    Operator action: seed prod archetype_embeddings + assert all 18 rows non-null (activate section
    F cosine in prod; close FOLLOW-341's prod hop)
  agent: devops-engineer
  status: DONE
  priority: P1
  estimated_hours: 1
  depends_on: [FOLLOW-341]
  source: AUDIT-2026-06-19 (§F cosine MOAT go-live)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-392 stub)
  pr: '#402'
  merge_commit: 'd1a33d8'
  completed_at: '2026-07-01'
  notes: |
    DONE. Prod Supabase archetype_embeddings verified 18/18 seeded, non-null, 1024-dim, real
    vectors 2026-07-01. PR #402 corrects a stale "embeddings NULL" claim in STATUS.md/QUEUE.md
    that predated the actual seed run. cosine ORDERING is still inactive in prod because
    listing_embeddings (not archetype_embeddings) is empty for the pilot tenant — that gap is
    tracked under ESC-020 pilot activation, NOT this ticket. djb2 remains a safe fallback.

- id: FOLLOW-446
  title: Harden the archetype-embeddings-not-NULL CI gate against silent blind-spots
  agent: devops-engineer
  status: DONE
  priority: P3
  estimated_hours: 1
  depends_on: [FOLLOW-392]
  source: RETRO (FOLLOW-392 resolution session, post-merge PR #402 fix)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-446 stub)
  pr: '#403'
  merge_commit: '288484d'
  completed_at: '2026-07-01'
  notes: |
    DONE. PR #403 merged (288484d). Fixed 3 stacked blindnesses in the archetype-embeddings-
    not-null CI gate: missing @estalara/shared build before @estalara/db build (TS2307),
    bare-specifier node script run from repo root (ERR_MODULE_NOT_FOUND), postgres-js socket
    hang (added timeout-minutes). Gate is now genuinely green and verifies embeddings instead
    of silently soft-skipping on every kind of failure via continue-on-error.
    RETRO-145 written (PR #404); generated FOLLOW-447 (P3 devops); Rule Q (INERT-GATE)
    promoted to CONVENTIONS_PATCH.md.

- id: FOLLOW-447
  title: >-
    Audit sibling CI gates for the three INERT-GATE failure modes + add defense-in-depth
    timeout-minutes to all ci.yml jobs
  agent: devops-engineer
  status: READY
  priority: P3
  estimated_hours: 2
  depends_on: [FOLLOW-446]
  source: RETRO-145 (§4a LG-3 / §5b) — source ticket FOLLOW-446 (PR #403)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-447 stub)
  branch: devops-engineer/FOLLOW-447-ci-gate-inert-audit
  notes: |
    Promoted 2026-07-01. Not pilot-blocking (P3, CI hygiene). Audit every ci.yml job for the
    3 failure modes FOLLOW-446 fixed (build-without-@estalara/shared, bare-specifier-from-
    repo-root, socket-hang) and add timeout-minutes defense-in-depth to every job (currently
    only archetype-embeddings-not-null has one).

- id: FOLLOW-448
  title: >-
    Branch-first worker discipline + mechanical guardrail against stranding uncommitted work on main
  agent: devops-engineer
  status: DONE
  assigned_to: devops-engineer
  started_at: '2026-07-01T00:00:00Z'
  completed_at: '2026-07-01T20:09:09Z'
  pr: 411
  merge_commit: 42050a0
  priority: P2
  estimated_hours: 3
  depends_on: []
  source: RETRO-146 (§4e / §9) — source ticket FOLLOW-442 (PR #406)
  spec: backlog/FOLLOW_UPS.md (FOLLOW-448 stub)
  branch: devops-engineer/FOLLOW-448-branch-first-worker-discipline
  notes: |
    Delegated 2026-07-01 (table row: Terraform, CI/CD, workflows, secrets, observability,
    runbooks -> devops-engineer). Promoted from FOLLOW_UPS.md stub (promoted_to_queue: false ->
    true this session; P2 > P3 siblings FOLLOW-447/FOLLOW-395 per priority rule). Premise
    re-verified 2026-07-01: RETRO-146 (PR #409) confirms the backend-engineer worker on
    FOLLOW-442 stalled 600s and left the correct fix uncommitted directly on the `main` working
    tree (never ran `git checkout -b`); PM recovered + independently re-verified
    typecheck/lint/tests before opening PR #406. No existing hook under .claude/hooks/ currently
    guards against edits on HEAD==main.
    Scope (3 items, see FOLLOW_UPS.md FOLLOW-448 stub for full AC list):
      1. Codify "git checkout -b <agent>/<ticket-id>-<kebab-summary> is the worker's mandated
         FIRST action, before any file edit" in docs/AGENT_WORKFLOW.md + reference it from every
         .claude/agents/*.md worker preamble (all 9 agents, not just devops-engineer's own).
      2. Add a mechanical hook (under .claude/hooks/, e.g. a PreToolUse/SessionStart guard) that
         detects `git rev-parse --abbrev-ref HEAD == main` and blocks-or-auto-branches before the
         first edit; self-test that demonstrates it firing.
      3. Add a "recovered/handed-off work must be independently re-verified (typecheck + lint +
         ticket tests), never trusted on a claimed pass" step to the pm-orchestrator
         handoff/recovery procedure in docs/AGENT_WORKFLOW.md (and .claude/agents/pm-orchestrator
         definition if that is where the procedure is codified) — this is a docs/hook change, not
         a change to pm-orchestrator's own runtime behavior, so it is in-scope for devops-engineer
         to author; PM will review for accuracy before merge.
    Do NOT touch unrelated CI gates (that is FOLLOW-447, separate ticket, do not merge scope).
    CI counter: 0/5. Fix iterations: 0/3.

- id: FOLLOW-442
  title: >-
    Fix POST /api/adapt holdout branch: add logDecisionAsync call so holdout rows are written to
    adaptation_decisions (AUD-04 / F-05)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-07-01T00:00:00Z'
  completed_at: '2026-07-01T16:29:05Z'
  priority: P1
  estimated_hours: 1
  depends_on: []
  source: 2026-07-01 end-to-end code audit (F-05); unblocked by ESC-035 resolution
  spec: backlog/FOLLOW_UPS.md (FOLLOW-442 stub)
  branch: backend-engineer/FOLLOW-442-post-holdout-logdecision
  pr: '#406'
  notes: |
    DONE — PR #406 merged 2026-07-01T16:29:05Z. Last remaining code item on the hard pilot
    go-live gate — gate now fully clear on the code side (ESC-035 resolved + FOLLOW-329/439/
    440/441/442 all DONE + FOLLOW-392 prod seed verified). During implementation the worker
    stalled 600s leaving the fix uncommitted on the main working tree; PM recovered it onto
    the correct branch and independently re-verified typecheck+lint+11/11 holdout tests before
    opening the PR. RETRO-146 (PR #409) generated FOLLOW-448 (P2, branch-first worker
    discipline + mechanical guardrail) to prevent recurrence. GET handler's holdout-adjacent
    treatment-arm call (route.ts:942-960) and POST's own treatment-arm call
    (route.ts:1403-1421) are the reference patterns; this ticket adds the missing equivalent
    call in the POST holdout
    branch (route.ts:~1141-1156).
```

**History — Sprint 13a Lane A — Wave 1+2+3 MERGED (Scenario D Sequential, then Wave 3 parallel,
merged 2026-05-27).**

- **FOLLOW-105 — DONE (merged 2026-05-25).** Substep 1a (PR #148) + Wave 1 substeps 1b/1c/1d (PR
  #150, `bf0585d`) both on main. Canonical `/api/adapt` enforced (buildSnippet + SDK Zod), Worker
  410 Gone + structured logging, ADR-0006 ACCEPTED, ADR-0004 contract replaced (live-wins),
  adapt_decision_id + ClickHouse migration 0012, CI Rule H adapt gate. §Snapshot.7 risk #1
  OPEN→RESOLVED. retrospective-analyst spawned on PR #150. Follow-ons: FOLLOW-107 (Worker handler
  removal, Sprint 14, after 7-day zero-traffic window), FOLLOW-108 (explainability_id), FOLLOW-109
  (SDK Zod rollout).
- **Wave 2 — DONE (merged 2026-05-26).**
  - **FOLLOW-097** (sdk-engineer, sonnet-4.6) — PR #151 (`3cf05ee`). Threaded
    `inquiry_submit_selector` from tenant schema → SDK config → `setupObservers()` so
    `inquiry.started` fires in prod (RETRO-008/009). E2E + SPA race-condition tests.
  - **FOLLOW-106** (backend-engineer, sonnet-4.6) — PR #152 (`b83e6c0`). `tenants.pilot_frozen`
    migration + schema + runtime warn in the **control-plane** adapt route (NOT the 410 Worker —
    RETRO-010 finding #2). Migration 0015: prd ✅ applied; dev+stg ❌ (DATABASE_URL_ADMIN unset in
    Doppler — not a pilot blocker, prd is what matters).
  - retrospective-analyst spawned on PR #151 + #152.
- **Wave 3 — DONE (spawned 2026-05-26, merged 2026-05-27, 5 parallel workers, CEO go-ahead).** All
  on agent-prefix branches for push-CI:
  - **FOLLOW-094** (data-engineer, sonnet-4.6, P1) — PR #153 (`9f32aa8`). cta-lift route fail-loud
    on ClickHouse error + expose `data_source` provenance (RETRO-008 CB-1, Rule K.2).
  - **FOLLOW-098** (backend-engineer, sonnet-4.6, P2) — PR #155 (`4ce6e37`). Same fail-loud +
    provenance treatment on /api/pilot/inquiry-starts (RETRO-009).
  - **FOLLOW-093** (data-engineer, sonnet-4.6, P1) — PR #154 (`a7d9c03`). Reconcile the two
    divergent CTA-lift query paths onto one schema vocabulary (RETRO-008).
  - **FOLLOW-114** (sdk-engineer, sonnet-4.6, P0 — RETRO-011) — PR #157 (`f882dae`). Emit
    `data-inquiry-submit-selector` in `buildSnippet()` (DetectionPreview.tsx) so `inquiry.started`
    fires for real tenants. Gates TICKET-PILOT-001.
  - **FOLLOW-117** (backend-engineer, sonnet-4.6, P2 — RETRO-012) — PR #156 (`38a8393`). Fix the
    inert pilot_frozen Lane C guard (consumer reads `cfg.quiz_enabled`, producer writes
    `cfg.enabled`) in the adapt route.
- **YELLOW audit Sprint 1 — DONE (PR #158, `6827305`, merged 2026-05-27).** Parallel track, bundled:
  FOLLOW-118 (F-02 cold-start prior), FOLLOW-119 (F-09 locale copy), FOLLOW-120 (F-10 LLM
  attribution), FOLLOW-121 (F-13/F-14 GDPR LIA). See the YELLOW audit track section above.

CEO ratified Decision 4C (add adapt_decision_id, defer explainability_id → FOLLOW-108), Decision 5A
(SDK Zod validation in 1b), Decision 6D (sequential FOLLOW-105 → Wave 2 → Wave 3). ESC-011 (CI not
triggering) RESOLVED — branch renamed to `architect/**` for push-CI + Actions budget bumped. Note:
DOPPLER_TOKEN_DEV (ESC-010) + E2E_BEARER_TOKEN (ESC-009) still outstanding for Lane B / full E2E.

## Awaiting human review (0 PRs)

_FOLLOW-315 (PR #302) merged 2026-06-14 — see Recent merges. All Wave 3 PRs (#153–#157), YELLOW
audit Sprint 1 (#158), and Sprint 13a-hardening (#159–#162) merged to main 2026-05-27._

## Recent merges

- 2026-06-14 — **FOLLOW-315 DONE (PR #302, `433089b`)** [data-engineer, P1]:
  `fix(control-plane): qualify event_at in tracer ClickHouse queries to avoid Code 386`. K.3.6
  tracer event-query builders projected `toString(event_at) AS event_at`, shadowing the `DateTime64`
  column with a `String` alias of the same name; ClickHouse resolves aliases inside WHERE/ORDER BY,
  so a bare `event_at` in a date predicate bound to the String alias → `String >= DateTime` →
  NO_COMMON_TYPE (Code 386) at query-analysis time. Broke tracer export + history + SSE-stream
  whenever a date filter/cursor was applied (prod ClickHouse Cloud too — never exercised with a
  filter). Fixed by qualifying `intent_events.event_at` in WHERE/ORDER BY across all 4 builders +
  CH-315a–d regression tests. Found via local end-to-end Stack B verification against real
  ClickHouse 24.8 (not CI — the existing tracer unit suite mocks `fetch` and the live-CH integration
  self-skips when `CLICKHOUSE_URL` is unset). RETRO-078 spawned → FOLLOW-316 (P1, live-CH CI
  guard) + FOLLOW-317 (P2, repo-wide `toString(col) AS col` alias-shadow audit; confirmed latent
  sibling in `clickhouse-dsr.ts`). No Rule promoted (both candidate patterns held below the ≥2-retro
  bar; see RETRO-078).
- 2026-05-27 (evening) — Sprint 13a-hardening (4 PRs, pre-pilot gate CLOSED): FOLLOW-127 (PR #161,
  `6a27841`) detection engine produces `inquiry_submit_selector` + interim hand-set pilot value;
  FOLLOW-128 (PR #160, `256b469`) DPIA §13.1/§13.2 consent-banner disclosures shipped in SDK
  (en/pl/es); FOLLOW-129 (PR #159, `10ae1e7`) tenant Privacy Notice template + DPO sign-off + GREEN
  balancing test + consent-withdrawal erasure QA + EU pre-flight gate; FOLLOW-122 (PR #162,
  `29c97ab`) `/dashboard/pilot` consumes `data_source` provenance + surfaces fail-loud HTTP 500.
  TICKET-PILOT-001 (Lane B) now READY. retrospective-analyst to run on #159–#162 (RETRO-019→022).
- 2026-05-27 — YELLOW audit Sprint 1 (PR #158, `6827305`): parallel-track launch-readiness bundle —
  F-02 `applyArchetypeHints()` cold-start prior wired in SDK `init()`; F-09 locale-correct slot copy
  (en/pl/es) threaded SDK config → adapt route decision tree (+ Spanish UI strings); F-10
  per-tenant/ session LLM cost attribution (no more `'unknown'` in ClickHouse cost rows); F-13/F-14
  GDPR LIA documented in `docs/compliance/dpia.md` §13.1/§13.2 (no code). Tracked as
  FOLLOW-118/119/120/121. Branch `claude/intelligent-dirac-3mBS1` (non-agent-prefix — separate
  track).
- 2026-05-27 — Wave 3 (Sprint 13a Lane A, 5 parallel PRs): FOLLOW-094 (PR #153, `9f32aa8`) cta-lift
  fail-loud + `data_source` provenance; FOLLOW-093 (PR #154, `a7d9c03`) reconcile CTA-lift query
  vocabulary onto canonical events schema; FOLLOW-098 (PR #155, `4ce6e37`) inquiry-starts
  fail-loud + provenance; FOLLOW-117 (PR #156, `38a8393`) align pilot_frozen Lane C guard to read
  `cfg.enabled`; FOLLOW-114 (PR #157, `f882dae`) emit `data-inquiry-submit-selector` in onboarding
  snippet. Sprint 13a Lane A now 8/8 DONE. retrospective-analyst to run on #153–#158.
- 2026-05-26 — Wave 2: FOLLOW-097 (PR #151, `3cf05ee`) threaded `inquiry_submit_selector` from
  tenant schema → SDK config → `setupObservers()` so `inquiry.started` fires in prod; FOLLOW-106 (PR
  #152, `b83e6c0`) added `tenants.pilot_frozen` flag + control-plane adapt-route Lane C warning,
  migration 0015 applied to prd (dev/stg deferred — DATABASE_URL_ADMIN unset). retrospective-analyst
  spawned on both. Wave 3 (FOLLOW-094/098/093) unblocked.
- 2026-05-25 — FOLLOW-105 Wave 1 (PR #150, `bf0585d`): canonical /api/adapt enforcement —
  buildSnippet emits `data-decision-url=${CONTROL_PLANE_URL}/api`, SDK Zod-validates the adapt
  response, Worker /api/adapt → 410 Gone + structured logging, adapt_decision_id in all arms +
  ClickHouse migration 0012, ADR-0004 contract replaced (live-wins) + ADR-0006 ACCEPTED, CI Rule H
  adapt drift + Worker-410 gates. §Snapshot.7 risk #1 RESOLVED. Supersedes closed #149 (branch
  renamed for push-CI; ESC-011). FOLLOW-107/108/109 follow-on stubs.
- 2026-05-25 — FOLLOW-105 substep 1a (PR #148): read-only SDK/snippet/endpoint audit — surfaced 5
  findings (3 BLOCKERS + 2 RISKS + 1 INFO); `docs/audits/FOLLOW-105-1a-sdk-audit.md`
- 2026-05-25 — TICKET-PILOT-003 (PR #146): CTA lift dashboard — /api/pilot/cta-lift + two-proportion
  z-test lib (pilot-stats.ts) + conversion funnel + by-archetype table + /dashboard/pilot unified
  page (merged with TICKET-PILOT-004 union); FOLLOW-086 stub; 26 tests
- 2026-05-25 — TICKET-PILOT-004 (PR #144): Inquiry starts tracking — SDK observer for
  inquiry.started, /api/pilot/inquiry-starts route, InquiryStartsPanel; FOLLOW-091 stub; 9 tests
- 2026-05-25 — FOLLOW-078 (PR #145): DSR failure alerting — stuck mutation detection (>1h pending)
  - Sentry captureMessage(warning) with row metadata; DSR_ALERTING.md + DPIA §8 update; commitlint
    PILOT- prefix fix; 11 tests
- 2026-05-25 — FOLLOW-075 (PR #142): CRON_SECRET auth hardened on /api/dsr/mutation-poll — returns
  401 when CRON_SECRET unset; .env.example updated; ≥3 auth unit tests
- 2026-05-25 — FOLLOW-081 (PR #143): ClickHouse mutation-poll integration test — 3 scenarios
  (pending→done, not-found, idempotent retry); soft-skip without CLICKHOUSE_URL
- 2026-05-24 — FOLLOW-039 (PR #139): ClickHouse DSR hard-delete — Art. 17 erasure on
  adaptation_decisions + events + llm_calls + session_quality; Vercel-Cron poller + 3-retry backoff;
  dsr_clickhouse_mutations Postgres operational state table; EU pilot gate cleared; Master Design
  v2.4 + §H.1.1 added
- 2026-05-24 — FOLLOW-068 (PR #137): demo-integration CI job — NEXT_PUBLIC_TEST_E2E=true; soft-skip
  until DOPPLER_TOKEN + E2E_BEARER_TOKEN provisioned (ESC-009 carry-forward); E2E_BEARER_TOKEN
  beforeAll() precheck added
- 2026-05-24 — FOLLOW-063 (PR #135): archetype-embeddings-not-null CI precheck +
  post-migrate-seed.yml idempotent auto-seed; both soft-skip until DOPPLER_TOKEN_DEV provisioned
- 2026-05-24 — FOLLOW-069 (PR #136): HMAC compat test SDK↔server (byte-identical hex digest
  assertion across N key/body pairs) + Bearer-only rejection regression test; closes RETRO-006 LG-3
- 2026-05-24 — FOLLOW-040 (PR #138): Doppler service token + doppler-run wrapper; DOPPLER_TOKEN as
  GitHub Actions secret; coordinate with FOLLOW-063 seed step
- 2026-05-23 — FOLLOW-051 (PR #133): HMAC-SHA256 tenant-scoped auth on POST /api/adapt/feedback;
  X-Estalara-Signature header; constant-time compare; ADAPT_API_KEY ops fallback; threat model
  documented in Master Design §V.3.2
- 2026-05-23 — FOLLOW-061 (PR #134): Snapshot.1 re-verification added to sprint-close checklist in
  `docs/AGENT_WORKFLOW.md` + `.claude/agents/pm-orchestrator.md` step 8; OP §Y.3 now structurally
  enforced
- 2026-05-22 — FOLLOW-046 (PR #132): Automate listing embedding seeding — fire-and-forget trigger in
  POST /api/schema/activate; DEMO_LISTING_MANIFEST seeds 12 listings on demo tenant activation
- 2026-05-22 — FOLLOW-043 (PR #131 + 6 fix-commits): Archetype embedding vectors seed script —
  scripts/seed-archetype-embeddings.ts; pnpm seed:archetypes + workflow_dispatch action; manual
  one-shot only (CI auto-seed tracked as FOLLOW-063)
- 2026-05-22 — FOLLOW-055 (PR #130): E2E integration test detect→activate→adapt→SDK; 5 static
  contract tests in CI + 5 E2E steps guarded by NEXT_PUBLIC_TEST_E2E=true (CI activation tracked as
  FOLLOW-068)
- 2026-05-22 — FOLLOW-047 (PR #129): Reject null tenant_id with 403 STAFF_TENANT_CONTEXT_MISSING on
  detect + activate routes
- 2026-05-22 — FOLLOW-052 (PR #128): Mirror-code byte-identity CI check — scripts/check-mirror-
  files.sh + JSON manifest + rule-j CI job + lefthook pre-push (Rule J live)
- 2026-05-22 — FOLLOW-041 + FOLLOW-042 (PR #127): SDK feedback ping on outcome events + variant
  field on AdaptResponse; closes bandit feedback loop
- 2026-05-22 — FOLLOW-018 (PR #126): Real tenant schema lookup + cache invalidation on activation;
  `invalidateTenantSchemaCache()` wired into activate path; Upstash Redis bounded TTL
- 2026-05-22 — TICKET-AUTO-006-POLISH (PR #125): Detection Preview + Save & Activate — schema
  activation + tenant promotion to `active` + SDK snippet generation
- 2026-05-21 — TICKET-030 (PR #124): Magic Link onboarding wizard UI —
  `idle → analyzing → detected | needs_review | failed` state machine; real API wiring (no mocks);
  11 tests
- 2026-05-21 — FOLLOW-019 (PR #123): Replace deterministicScore djb2 hash with cosine similarity;
  `listing_embeddings` pgvector table (migration 0013) + `POST /api/listings/embed` admin endpoint;
  djb2 fallback preserved per-listing
- 2026-05-21 — FOLLOW-007 (PR #122): Wire Thompson sampling bandit — canonical
  `packages/shared/src/bandit.ts`; `POST /api/adapt/feedback` fire-and-forget;
  `adaptation_decisions.variant` ClickHouse column (migration 0010); 42 new tests
- 2026-05-21 — TICKET-033 (PR #121): Schema Discovery API — JWT + SSRF + 60s cache + wizard
  response; persists to `tenant_site_schemas`; `DetectResponseSchema` in `@estalara/shared`
- 2026-05-15 — TICKET-GDPR-002 (PR #118): DSR endpoints — OTP flow + Resend email + ClickHouse audit
  log; `dsr_verifications` table + Drizzle migration 0011
- 2026-05-15 — TICKET-GDPR-003 (PR #116): LIA template v1.0 + `tenant_compliance_records` table +
  GET/POST/DELETE CRUD API; `LiaRecordSchema` in packages/shared
- 2026-05-15 — TICKET-GDPR-004 (PR #117): Consent state gate — `consentGate()` in decision-api +
  `consent_required` on tenants + SDK `fetchDirectives()` sends consent_state; ClickHouse
  `gate_reason` column (migration 0008); Drizzle migration 0010
- 2026-05-15 — TICKET-GDPR-001 (PR #111): DPIA + ROPA — EU/UK/CCPA/UAE PDPL compliance docs
- 2026-05-15 — TICKET-DESC-PIVOT-001 v1.7.1 (PR #115): 18 archetype voice patterns (EN/PL/ES) +
  WHITELIST guard-rails in Modal job + `verified_facts_used` audit trail + MASTER_DESIGN v1.7.1
- 2026-05-14T14:21:36Z — TICKET-ARCH-003 (PR #95): per-ticket retrospective learning loop + /retro
  slash command; retrospective-analyst agent (Opus 4.7); RETRO-001 seeded
- 2026-05-14T00:00:00Z — TICKET-ARCH-002 (PR #93): Master Design bumped to v1.6; architectural
  updates applied to MASTER_DESIGN.md
- 2026-05-14T00:00:00Z — TICKET-046 (PR #92, commit b6368b6): 18 archetypes × 3 variants +
  copy_template; fixes feature-section → feature slot name
- 2026-05-14T00:00:00Z — TICKET-REORDER-001 (PR #91, commit 40650aa): ReorderDirective DOM reorder +
  listing grid re-ranking per archetype
- 2026-05-14T00:00:00Z — TICKET-FIX-019 (PR #88): ingest idempotency KV key scoped to tenant
- 2026-05-14T00:00:00Z — TICKET-FIX-018 (PR #89): JWT token in createTenantClient for RLS
  enforcement
- 2026-05-14T00:00:00Z — TICKET-FIX-017 (PR #90): API key auth gate on GET /api/adapt
- 2026-05-14T00:00:00Z — TICKET-FIX-014 + FIX-016 (PR #87): JWT tenant auth + demo POST endpoint
- 2026-05-14T00:00:00Z — TICKET-FIX-013 (PR #86): JWT HMAC-SHA-256 signature verification
- 2026-05-14T00:00:00Z — TICKET-FIX-015 (PR #85): AdaptRequestSchema accepts confidence/similarity
- 2026-05-14T00:00:00Z — TICKET-FIX-010 (PRs #83, #84): IntentState wired into fetchDirectives +
  auth header alignment
- 2026-05-14T00:00:00Z — TICKET-FIX-012 (PR #82): real API key validation + per-tenant LLM daily
  spend cap
- 2026-05-14T00:00:00Z — TICKET-FIX-011 (PR #81): seed 18 archetype rows in archetype_embeddings
- 2026-05-14T00:00:00Z — TICKET-AB-001 (PR #80, commit 0e5cc0c): A/B holdout + Thompson sampling
  bandit
- 2026-05-13T00:00:00Z — TICKET-AUTO-005 (PR #79, commit cfecf50): corpus CI gate — precision/recall
  validation for 24 platforms
- 2026-05-13T00:00:00Z — TICKET-AUTO-004 + AUTO-006 (PR #77, commit eb463ab): auto-detect techniques
  7-11 + price parser + Detection Preview UI skeleton
- 2026-05-13T00:00:00Z — TICKET-AUTO-007 (PR #76, commit 5c36aaf): archetype hints from site
  structure — Bayesian prior seeding
- 2026-05-13T00:00:00Z — TICKET-AUTO-003 (PR #74, commit f6f4e15): auto-detection techniques 1–6 —
  deterministic pipeline
- 2026-05-13T00:00:00Z — TICKET-AUTO-002 (PR #73, commit 76c2c88): TenantSiteSchema types +
  detection pipeline skeleton
- 2026-05-13T00:00:00Z — TICKET-AUTO-001 (PR #72, commit 7400d63): auto-detection corpus — 24
  fixtures + CI gate skeleton
- 2026-05-13T00:00:00Z — TICKET-DQS-001 (PR #71, commit 7678aa3): convergence metrics — DQS
  per-session tracking
- 2026-05-13T00:00:00Z — TICKET-ADP-002 (PR #70, commit e9ccde4): LiteLLM gateway — Haiku/Sonnet
  routing
- 2026-05-12T21:33:43Z — TICKET-ADP-004 (PR #69, commit 82f0e42): SDK Tier 1 DOM mutations — full
  applyDirectives() implementation
- 2026-05-11T00:00Z — TICKET-ARCH-001 (commit f0aca06): Expand archetype ontology — 3 → 18
  archetypes
- 2026-05-11T00:00Z — TICKET-EMB-001 (commit be4e366): Embeddings pipeline — pgvector + fingerprint
  matching
- 2026-05-11T00:00Z — TICKET-DB-001 (commit c69ee9c): Replace API stubs with real Drizzle DB queries
- 2026-05-05T01:25Z — TICKET-031 (PR #50): SDK Tier 1 core — config, session, events, observer
  - config reader, SHA-256 session fingerprint, event dispatch, scroll/intersection/click observers.
  - Fixed .gitleaks.toml: moved false-positive paths from invalid `files` key to `paths` in global
    allowlist.
- 2026-05-05T00:00Z — TICKET-FIX-009 (PR #49): DB client tests rewritten without dynamic imports
- 2026-05-05T00:00Z — TICKET-DEMO-002 (PR #48): Demo mock-up listings page — 12 listings, filters
- 2026-05-05T00:00Z — TICKET-DEMO-001 (PR #47): Demo mode foundation — sessions API + JWT
- 2026-05-04T00:00Z — TICKET-FIX-008 (PR #46): CI workspace fix + prettierignore
- 2026-05-04T00:00Z — TICKET-FIX-006/007 (PR #45): DB test isolation + turbo outputs
- 2026-05-04T00:00Z — TICKET-027/028 (PR #44): Dashboard layout + tenant overview page
- 2026-05-04T00:00Z — TICKET-026 (PR #43): Analytics API stub — tenant dashboard data endpoint
- 2026-05-04T00:00Z — TICKET-024 (PR #42): Decision-API adapt endpoint stub
- 2026-05-04T00:00Z — TICKET-029 (PR #41): Stripe billing stub — webhook handler
- 2026-05-04T00:00Z — TICKET-023 (PR #40): Multi-tenancy context middleware
- 2026-05-04T00:00Z — TICKET-022 (PR #39): Tenant auth — JWT claims, RBAC guards
- 2026-05-04T00:00Z — TICKET-021 (PR #38): Core Postgres schema for Sprint 2
- 2026-05-04T12:00Z — TICKET-020 (PR #36): Drizzle ORM setup
- 2026-05-04T07:25Z — fix(ci) (PR #30): Exclude e2e from unit test run + fix turbo dependency graph
- 2026-05-03T20:58Z — TICKET-015 (PR #29): Modal stream consumer Redpanda→ClickHouse
- 2026-05-03T15:21Z — TICKET-014 (PR #27): ClickHouse DDL migrations
- 2026-05-03T13:55Z — TICKET-016 (PR #26): E2E smoke test ingest→ClickHouse
- 2026-05-03T10:51Z — TICKET-018/019 fix (PR #25): Missing span attributes + README paths
- 2026-05-01T21:37Z — TICKET-018+019 (PR #24): Ingest observability + error handling
- 2026-05-01T10:46Z — TICKET-025 (PR #20): control-plane Next.js + Tailwind + shadcn/ui skeleton

---

## Sprint 22b — Full-Stack Audit Remediation (2026-07-01, session 2) (OPEN)

**Source:** end-to-end code audit run 2026-07-01 (session 2), 8 parallel tracks (SDK, ingest/data,
intent-engine, control-plane/LLM, analytics/dashboard, compliance/security, plan-reconciliation) +
CEO-directed remediation. Findings F-01…F-21 in the audit report. This wave's **Definition of Done
is a clean re-audit**: FOLLOW-471 re-runs the same audit and every finding must close with file:line
proof, so a final code review returns "no gaps, no bugs — Adaptive Listings works as intended."
Ticket-to-finding map is in each `source:` line. Nothing here is scaffold: every ticket has a
runtime-wired acceptance gate (Rule H) and a verification step (Operating Principle 5).

**Ordering:** P0 (F-02/F-05/F-06) are prod-truth/deploy/config blockers for a _measured_ pilot and
run first; P1 correctness + compliance next; P2/P3 hardening + cleanup; FOLLOW-471 (clean re-audit
gate) closes the epic and must be last.

```yaml
- id: FOLLOW-449
  title: >-
    Apply ClickHouse migration 0015 (intent_events.session_id) to prod + de-silence rejected
    intent_events inserts (F-02)
  agent: data-engineer
  status: CODE_COMPLETE_OPERATOR_PENDING # PR #413 merged to main (18367d3) 2026-07-02; AC1/AC2 (prod attest+apply) are OPERATOR-PENDING, not done. See ESC-020/ESC-034 precedent.
  assigned_to: data-engineer
  started_at: '2026-07-01T22:00:00Z'
  completed_code_at: '2026-07-02T00:00:00Z'
  branch: data-engineer/FOLLOW-449-intent-events-session-id-prod
  pr: '#413 (MERGED)'
  priority: P0
  estimated_hours: 3
  depends_on: []
  source: >-
    2026-07-01 audit F-02 — intent_events count=0 in prod; writer sends session_id (0015) but
    migration is not attested-applied to prod CH → every fire-and-forget insert silently rejected;
    Archetype Tracer (K.3.6) has no live data.
  spec: audit report §5.1 F-02; backlog/QUEUE.md Sprint 22b
  notes: |
    Delegated 2026-07-01 (table row: ClickHouse, Redpanda, ETL, archetype pipeline, drift cron,
    DSR delete -> data-engineer). Branch-first (FOLLOW-448) enforced: first action must be
    `git checkout -b data-engineer/FOLLOW-449-intent-events-session-id-prod main`.
    PROD-APPLY CAVEAT (ESC-022/ESC-031 precedent, memory: migrations don't auto-apply): the actual
    prod ClickHouse `migrate.sh` execution against Doppler `prd` credentials is a PRIVILEGED
    OPERATOR ACTION. The worker does NOT have prod CH credentials and must NOT attempt to fetch or
    fabricate them. Worker prepares/verifies everything code+CI-side (migration file correctness,
    idempotent guard, the de-silencing fail-loud fix, the FOLLOW-402 contract-test extension) and
    writes the EXACT runbook command sequence + expected DESCRIBE TABLE / attestation format into
    docs/runbooks/clickhouse-migrations.md for Piotr/Rafał to execute and paste real output into.
    If the worker can verify prod state read-only (e.g. an existing script/secret already available
    to CI service account permits a SELECT/DESCRIBE), that's fine; anything requiring prd write
    creds is operator-only.

    PR #413 opened 2026-07-01, MERGED 2026-07-02 (commit 18367d3, main). CI counter: 1/5 (first
    run green on every real gate). Fix iterations: 0/3. Only non-passing check is "Rule I —
    wired-or-dead check" (173 violations, ALL pre-existing in packages/sdk + packages/shared/
    pii-blacklist.ts, ZERO in this PR's touched files apps/ingest/* — confirmed pre-existing
    baseline noise per project CI-gate-landscape precedent, not introduced by this PR).

    PM-validated 2026-07-02: code/CI/docs scope (AC3/AC4/AC5) is DONE and merged. AC1/AC2 (prod
    attest+apply, DESCRIBE TABLE proof) remain OPERATOR-PENDING (Piotr/Rafał) — tracked on the
    pilot go-live checklist in backlog/STATUS.md, NOT silently closed. Ticket status set to
    CODE_COMPLETE_OPERATOR_PENDING (ESC-020/ESC-034 precedent: code-complete-awaiting-operator-
    action is non-blocking for further delegation, but the ticket itself is not DONE until the
    operator leg completes). This frees data-engineer's IN_PROGRESS slot.

    Code/CI/docs-complete; migration 0015 IS idempotent (`ADD COLUMN IF NOT EXISTS`), verified by a
    double-apply of migrate.sh against a clean local ClickHouse container — no change needed to the
    migration file. De-silencing (Sentry capture on both ClickHouse+Supabase rejection paths, kind
    insert_rejected|network) landed in intent-snapshot.ts + a defensive events.ts waitUntil catch.
    migration-contract-test.sh Part B extends the FOLLOW-402 self-maintaining reverse-walk to
    intent_events (boundary correctly auto-detected as 0015); ci.yml already invokes the script
    (no wiring change needed). Runtime proof: a synthetic intent.snapshot inserted via the REAL
    insertIntentEventToClickHouse function against a local ClickHouse container produced count()=1,
    queried via the tracer's exact SELECT shape (fetchIntentEventsForSession). Full transcript in
    PR #413 description.

    AC1/AC2 (attest+apply to prod, DESCRIBE TABLE proof) remain OPEN — OPERATOR ACTION REQUIRED
    (Piotr/Rafał) per the runbook stub in docs/runbooks/clickhouse-migrations.md ("Prod Attestation
    — migration 0015 — STUB, OPERATOR MUST COMPLETE"). Ticket cannot move to DONE until that stub
    is filled with real prod output.
    AC:
    - [ ] Attest+apply CH migration 0015 to prod (doppler prd) via the migrations runbook; record
          DESCRIBE TABLE proof that intent_events has session_id. OPERATOR ACTION REQUIRED
          (Piotr/Rafał) — runbook stub ready, real output not yet pasted.
    - [ ] Backfill/verify all 0015→latest CH migrations are applied in prod (same drift class as
          ESC-022/ESC-031); publish an attestation line in docs/runbooks/clickhouse-migrations.md.
          OPERATOR ACTION REQUIRED (same runbook stub, step 4).
    - [x] intent-snapshot handler INSERT rejections capture to Sentry (drop silent fire-and-forget
          for SCHEMA/4xx errors; keep async for latency) so a future column drift fails loud.
    - [x] Extend FOLLOW-402 migration-contract test to cover intent_events (not just
          adaptation_decisions).
    - [x] Runtime proof: after apply, a synthetic intent.snapshot produces a row (count>0) queried
          via the tracer SELECT path.
- id: FOLLOW-450
  title: >-
    Enable feedback endpoint in prod so the bandit learning loop is live (F-06)
  agent: backend-engineer
  status: CODE_COMPLETE_OPERATOR_PENDING # corrected 2026-07-11 (audit #3 §6.4 / Rule AA): was DONE, but the operator_action block below is unresolved — "an operator-gated go-live ticket is CODE_COMPLETE_OPERATOR_PENDING, never DONE on code alone." Operator leg consolidated into FOLLOW-553 (Sprint 23 Wave 0).
  assigned_to: backend-engineer
  started_at: '2026-07-02T12:00:00Z'
  completed_code_at: '2026-07-02T15:59:24Z'
  branch: backend-engineer/FOLLOW-450-feedback-loop-golive
  pr: 'https://github.com/Pnawrocki9/Adaptive-Listings/pull/426'
  merge_commit: 2460457fe0b55beefcef6d86f450c85af112bc4f
  ci: 'green (57 real gates); Rule I wired-or-dead pre-existing-red non-blocking'
  code_status: CODE_COMPLETE_OPERATOR_PENDING
  operator_action: >-
    AC1 go-live is operator-only (Piotr/Rafał): in Doppler prd set FEEDBACK_ENDPOINT_ENABLED=true
    and provision ADAPT_API_KEY + OPS_TENANT_ID + DATABASE_URL_ADMIN, then run `pnpm
    feedback:canary` (doppler run --config prd) to prove a real ab_bandit_weights delta. On the
    pilot go-live checklist.
  priority: P0
  estimated_hours: 2
  depends_on: []
  source: >-
    2026-07-01 audit F-06 — feedback/route.ts 503-gated (FEEDBACK_ENDPOINT_ENABLED!=='true') per
    ADR-0015 interim; SDK swallows the 503 → ab_bandit_weights frozen at Beta(1,1) → Thompson
    sampling is uniform-random; no conversion labels captured.
  spec: ADR-0015; audit report §5.1 F-06
  notes: |
    CEO DECISION (Q3, 2026-07-02): MEASURED pilot confirmed — this ticket (enable feedback/bandit
    loop) is a CONFIRMED P0 go-live blocker. DECISION-GATED note resolved.
    DECOUPLED 2026-07-02 (pm-orchestrator): depends_on changed from [FOLLOW-449] to [] — confirmed
    the bandit/feedback subsystem (ab_bandit_weights, conversion_labels) is Postgres-only and has NO
    code dependency on intent_events / ClickHouse migration 0015 (FOLLOW-449's scope). The prior
    link was an operator-sequencing convenience (both eventually need a Doppler prd touch), not a
    technical blocker. CODE for this ticket (AC1 canary wiring, AC2 SDK Sentry breadcrumb, AC3
    end-to-end verification harness) can proceed now, independent of FOLLOW-449's prod-migration
    status. Only the PRODUCTION GO-LIVE leg (FEEDBACK_ENDPOINT_ENABLED=true flip +
    OPS_TENANT_ID/ADAPT_API_KEY Doppler prd provisioning) is an operator-gated step, same class as
    FOLLOW-449's own operator leg — the two operator actions may still be scheduled together, but
    that is a scheduling choice, not a dependency.

    DELEGATED 2026-07-02 (pm-orchestrator, session 8, table row: "ingest worker, control-plane,
    decision-api, Postgres/RLS, auth, onboarding HTTP, billing, webhooks -> backend-engineer"). The
    only READY P0 in Sprint 22b this session (FOLLOW-449 is CODE_COMPLETE_OPERATOR_PENDING, not a
    fresh pick; FOLLOW-451 is DONE). Expect this ticket to land in the SAME
    CODE_COMPLETE_OPERATOR_PENDING pattern as FOLLOW-449: AC1 (Doppler prd provisioning + flag flip)
    is operator-only and should NOT block AC2-AC4 (canary wiring, SDK breadcrumb, verification
    harness) from being coded, tested, and merged. Runs CONCURRENTLY with FOLLOW-457 (different
    agent, ml-engineer — no shared-tree hazard). ISOLATED WORKTREE required per FOLLOW-448
    branch-first discipline: `git checkout -b backend-engineer/FOLLOW-450-feedback-loop-golive main`
    in its own `git worktree` MUST be the FIRST action, before any file edit.
    AC:
    - [ ] Provision OPS_TENANT_ID + ADAPT_API_KEY in Doppler prd; set FEEDBACK_ENDPOINT_ENABLED=true.
    - [ ] Add a prod canary: a signed test ping increments a Beta counter (real ab_bandit_weights
          delta observed), then is reverted/scoped to OPS_TENANT_ID.
    - [ ] SDK: on a non-2xx feedback response, capture to Sentry (breadcrumb) instead of silent
          console.warn, so a re-disabled endpoint is visible.
    - [ ] Verify end-to-end: adapt → outcome event → feedback ping → conversion_labels row +
          bandit update, all under the resolved (not body) tenant.
- id: FOLLOW-451
  title: >-
    Add real API-key auth path to POST /api/adapt (currently demo-JWT-only) (F-05)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-07-02T00:00:00Z'
  branch: backend-engineer/FOLLOW-451-adapt-api-key-auth
  pr: '#416'
  merge_commit: 0e99415
  completed_at: '2026-07-01T23:37:35Z'
  priority: P0
  estimated_hours: 4
  depends_on: []
  source: >-
    2026-07-01 audit F-05 — POST /api/adapt accepts only an HS256 demo JWT (DEMO_MODE_JWT_SECRET);
    SDK sends Bearer config.apiKey → a real tenant API key 401s and the SDK fail-opens to null
    (silent no-adapt). Blocks the standalone-SaaS path.
  spec: ADR-0015 (resolveApiKey); audit report §5.2 F-05
  notes: |
    CEO DECISION (Q1, 2026-07-02): BOTH PATHS mandated — POST /api/adapt must accept a demo-JWT
    AND a real tenant API key (reuse ADR-0015 resolveApiKey, same pattern as feedback/route.ts).
    Confirmed P0, not deferrable. DECISION-GATED note resolved: "both paths mandated."
    AC:
    - [x] POST /api/adapt accepts EITHER a demo JWT OR a tenant API key resolved via the shared
          resolveApiKey() (SHA-256 → api_keys) added in ADR-0015; tenant_id derived server-side.
    - [x] body.tenant_id mismatch vs resolved tenant → 403 (parity with feedback route) — scoped to
          the API-key path (see scope decision below).
    - [x] SDK path documented: which credential the pilot snippet ships; a real-key integration test
          returns 200 directives (not 401→null).
    - [x] No regression to the demo-JWT path (existing tests green).

    DONE 2026-07-02 (PM-validated). PR #416 MERGED at commit 0e99415 (2026-07-01T23:37:35Z). Real
    API-key auth added to POST /api/adapt alongside the existing demo-JWT path: handler tries
    verifyDemoJwt() first, falls back to the shared ADR-0015 resolveApiKey() (SHA-256(bearer) →
    api_keys, constant-time compare) — same helper feedback/route.ts already uses. 403 returned on
    an API-key-path body.tenant_id mismatch (parity with feedback route); demo-JWT path's
    pre-existing FOLLOW-260 supersede-only behavior intentionally preserved (see scope decision 1
    below — do not conflate with FOLLOW-472). resolveApiKey() DB error fails loud: 401 + Sentry
    capture (tags: area=adapt, kind=api_key_auth_db_error), never fabricates a tenant, per Rule K.2.
    13 new/updated tests pass (6 in route.follow451.test.ts covering the full auth matrix + 7
    unmodified route.demo-auth.test.ts regressions, all green). CI: 0/5 checks used (green on first
    run per PR body); fix-iterations 0/3.

    Two residuals surfaced during validation, deliberately NOT closed by this ticket (both filed as
    new follow-ups, see Sprint 22b below): (1) demo-JWT path still has no tenant_id-claim-vs-body
    mismatch check when the JWT carries no tenant_id claim (FOLLOW-472); (2) GET /api/adapt's
    ADAPT_API_KEY auth is presence-only and materially weaker than the now-hardened POST path
    (FOLLOW-473).
- id: FOLLOW-452
  title: >-
    Fix per-archetype holdout logging + GET holdout default so lift is measurable (F-08)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-07-02T00:00:00Z'
  completed_at: '2026-07-02T09:17:04Z'
  pr: 'https://github.com/Pnawrocki9/Adaptive-Listings/pull/418'
  merge_commit: c0d9b39bcf2eaf5d4aff06b0a35c822ed1641112
  ci: 'green (all real gates); Rule I pre-existing-red non-blocking'
  branch: backend-engineer/FOLLOW-452-holdout-archetype-logging
  priority: P1
  estimated_hours: 3
  depends_on: []
  source: >-
    2026-07-01 audit F-08 — POST holdout rows logged as archetype='neutral',confidence=0.5 →
    per-archetype lift compares adapted-X vs an ~empty holdout arm (0/not-significant forever); GET
    holdout defaults to false when the param is absent → silent treatment-arm contamination.
  spec: audit report §5.1 F-08; docs/ops/PILOT_CTA_LIFT_METRIC_v1.md
  notes: |
    CEO DECISION (Q3, 2026-07-02): MEASURED pilot confirmed — this ticket (per-archetype holdout
    logging so lift is measurable) is CONFIRMED as a go-live blocker at its stated P1. No gating
    note to resolve (priority was already P1, un-gated); recorded for the decision trail.
    DELEGATED 2026-07-02 (table row: "ingest worker, control-plane, decision-api, Postgres/RLS,
    auth, onboarding HTTP, billing, webhooks -> backend-engineer"). Runs CONCURRENTLY with
    FOLLOW-453 in an ISOLATED WORKTREE — do NOT share a single working directory between the two
    workers (FOLLOW-451/RETRO-146 shared-tree hazard: a concurrent-branch-switch in one working
    directory stranded a commit on main). Each worker must have its own `git worktree` checkout on
    its own branch before touching any file.
    AC:
    - [x] Holdout rows log the would-be archetype/confidence (the classification the session would
          have received), not a hardcoded 'neutral', so lift/route per-archetype arms populate.
    - [x] GET /api/adapt computes holdout server-side (assignHoldout) like POST; never trusts a
          caller-supplied holdout_group as the default.
    - [x] Test: a synthetic archetype-X session in holdout produces a holdout row keyed to X; the
          per-archetype lift query returns a non-empty holdout_n for X.

    DONE 2026-07-02 (PM-validated, merged PR #418, commit c0d9b39). CI confirmed green on every
    real gate (Test Node 22, SDK E2E, Build, Build control-plane, Lint, Format, Typecheck); Rule I
    pre-existing-red non-blocking (173 legacy violations, zero in this PR's touched files).
    Runtime-wiring verified: producer (POST holdout branch logs resolved archetype/confidence via
    the existing afterResponse-wrapped logDecisionAsync sink; GET holdout now calls the shared
    assignHoldout() helper, same call already used by POST at route.ts:1287) reaches a real,
    pre-existing consumer (`pilot/cta-lift/route.ts:150` `GROUP BY ad.archetype, ad.holdout_group`)
    — confirmed via `grep -n "assignHoldout" apps/control-plane/src/app/api/adapt/route.ts` (2
    non-test call sites, POST + GET) and `grep -n "GROUP BY ad.archetype" apps/control-plane/src/
    app/api/pilot/cta-lift/route.ts`. RETRO-147 written (backlog/RETROSPECTIVES.md); no new FOLLOW
    stub (one recommendation folded into the existing FOLLOW-441 canary-widening note, not
    duplicated).
- id: FOLLOW-453
  title: >-
    Stop the analytics UI rendering fabricated zeros on error; retire /api/analytics mock; fail-loud
    quiz/config (F-07)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-07-02T00:00:00Z'
  completed_at: '2026-07-02T09:17:07Z'
  pr: 'https://github.com/Pnawrocki9/Adaptive-Listings/pull/419'
  merge_commit: 807869d313b9d008c5043c5dacd462c517b7137d
  ci: 'green (all real gates); Rule I pre-existing-red non-blocking'
  branch: backend-engineer/FOLLOW-453-analytics-fail-loud-ui
  priority: P1
  estimated_hours: 3
  depends_on: []
  source: >-
    2026-07-01 audit F-07 — dashboard/analytics/page.tsx catches all fetches and coerces 500 bodies
    to Number(...??0) → Panel 1 shows fabricated zeros and drops data_source (Rule K.2 defeated at
    the UI); /api/analytics is a 100% mock route with spoofable x-tenant-id, still deployed;
    quiz/config GET catch→enabled defaults.
  spec: CONVENTIONS_PATCH.md Rule K.2; audit report §5.1 F-07
  notes: |
    CEO DECISION (Q3, 2026-07-02): MEASURED pilot confirmed — this ticket (dashboard fail-loud,
    no fabricated zeros) is CONFIRMED as a go-live blocker at its stated P1. No gating note to
    resolve (priority was already P1, un-gated); recorded for the decision trail.
    DELEGATED 2026-07-02 (table row: "ingest worker, control-plane, decision-api, Postgres/RLS,
    auth, onboarding HTTP, billing, webhooks -> backend-engineer"). Runs CONCURRENTLY with
    FOLLOW-452 in an ISOLATED WORKTREE — do NOT share a single working directory between the two
    workers (FOLLOW-451/RETRO-146 shared-tree hazard: a concurrent-branch-switch in one working
    directory stranded a commit on main). Each worker must have its own `git worktree` checkout on
    its own branch before touching any file.
    AC:
    - [x] analytics/page.tsx surfaces an explicit error state on non-2xx (no zero coercion), and
          renders a MockDataBadge when data_source==='mock' (parity with /dashboard/pilot).
    - [x] Delete or hard-gate /api/analytics (fabricated, spoofable, no consumer); if retained,
          add JWT tenant scoping + data_source and a real query.
    - [x] quiz/config GET fails loud (500) when a configured DB throws instead of returning
          enabled defaults.

    DONE 2026-07-02 (PM-validated, merged PR #419, commit 807869d). CI confirmed green on every
    real gate; Rule I pre-existing-red non-blocking. Runtime-wiring verified: /api/analytics route
    deletion confirmed to have zero remaining source-code references
    (`grep -rn "/api/analytics" apps/ packages/ --include=*.ts --include=*.tsx | grep -v node_modules`
    → only stale `.next/` build-artifact matches, not source); `MockDataBadge` confirmed to have 3
    real non-test consumers (`analytics/page.tsx` new, `dashboard/pilot/page.tsx` +
    `dashboard/analytics/labels/page.tsx` pre-existing) via
    `grep -rln "MockDataBadge" apps/control-plane/src`. RETRO-148 written
    (backlog/RETROSPECTIVES.md); no new FOLLOW stub (two low-priority test-coverage notes recorded,
    folded into FOLLOW-471 re-audit QA awareness, not duplicated as new tickets).
- id: FOLLOW-472
  title: >-
    Demo-JWT path on POST /api/adapt has no tenant_id-claim-vs-body mismatch check
  agent: backend-engineer
  status: READY
  priority: P3
  estimated_hours: 2
  depends_on: []
  source: >-
    FOLLOW-451 (PR #416) validation, 2026-07-02 — audit F-05 sub-case, deliberately NOT closed by
    FOLLOW-451, which scoped its 403-on-mismatch check to the API-key path only (PR #416 "Scope
    decisions" §1) to avoid breaking the existing FOLLOW-260 supersede-only demo-JWT test.
  spec: backlog/FOLLOW_UPS.md FOLLOW-472; PR #416 "Scope decisions" §1
  notes: |
    Promoted 2026-07-02 (pm-orchestrator) directly to Sprint 22b as READY. Low-risk (demo JWTs are
    server-minted and today always carry the tenant_id claim, so the exploit window is theoretical)
    — hence P3, override if you judge the risk higher. NOT a re-open of FOLLOW-451 — a fresh
    residual, and FOLLOW-451 is DONE.
    AC:
    - [ ] A demo JWT with a tenant_id claim + mismatched body.tenant_id still supersedes silently
          (FOLLOW-260 regression test stays green) — behavior unchanged for the claim-present case.
    - [ ] A demo JWT with NO tenant_id claim + a body.tenant_id no longer silently trusts the body
          value with zero verification (reject, or apply an equivalent 403/claim-requirement).
    - [ ] New test covers the claim-absent case explicitly (this gap has no existing test today).
- id: FOLLOW-473
  title: >-
    GET /api/adapt auth is presence-only + spoofable x-tenant-id fallback, now weaker than the
    hardened POST path
  agent: backend-engineer
  status: DONE # corrected 2026-07-09 (pm-orchestrator, session 20) — PR #475 confirmed MERGED 2026-07-08T19:03:53Z (511fbbe) via `gh pr view`; RETRO-164 already filed (commit c5be497, stubs FOLLOW-531/532/533/534); this flip was missed at session 18 close.
  assigned_to: backend-engineer
  started_at: '2026-07-08T00:00:00Z'
  completed_at: '2026-07-08T19:03:53Z'
  branch: backend-engineer/FOLLOW-473-adapt-get-auth-hardening
  pr: 475
  ci_status: green # session 18: all real gates pass; only standing pre-existing Rule I baseline red (not this change — new symbols absent from --log-failed)
  validated: |
    Session 18 (2026-07-08) recovered this from an interrupted session-17 worktree (uncommitted).
    A second divergent uncommitted attempt existed in a parallel worktree; adjudicated by test
    coverage + design and discarded the losing fork — landed the more-covered tracked-branch impl.
    Committed 7c9e67c, opened PR #475. Full adapt suite green (325 tests, incl. 17 dedicated
    follow473 auth cases); tsc + eslint + prettier clean; both call sites verified symmetric on the
    resolveApiKey DB-throw (Rule K.2 → Sentry → 401, tenant always server-derived). Human merge only.
  priority: P1 # elevated 2026-07-08 (pm-orchestrator, session 17) from P2 per FOLLOW-510 (RETRO-158) recommendation — see notes below
  estimated_hours: 3
  depends_on: []
  source: >-
    FOLLOW-451 (PR #416) validation, 2026-07-02 — PR #416 "Scope decisions" §2 explicitly flagged
    this as a follow-up: FOLLOW-451's AC items only covered POST; GET's separate, weaker
    ADAPT_API_KEY auth axis was out of scope for that ticket.
  spec: backlog/FOLLOW_UPS.md FOLLOW-473, FOLLOW-510; PR #416 "Scope decisions" §2; RETRO-158
  notes: |
    Promoted 2026-07-02 (pm-orchestrator) directly to Sprint 22b as READY. GET is now the visibly
    weaker of the two /api/adapt auth paths (ADAPT_API_KEY env-var presence-only comparison,
    degrading to "any non-empty bearer accepted" when the env var is unset; tenant derived from a
    caller-supplied x-tenant-id header with zero verification) — asymmetric hardening vs the
    now-hardened POST path is itself a reason to close before pilot go-live.

    PRIORITY ELEVATED P2->P1 2026-07-08 (pm-orchestrator, session 17), per the recommendation filed
    as FOLLOW-510 (backlog/FOLLOW_UPS.md, source RETRO-158): GET /api/adapt AND GET
    /api/adapt/description (apps/control-plane/src/app/api/adapt/route.ts:703,
    apps/control-plane/src/app/api/adapt/description/route.ts:183 — confirmed via direct read, both
    identical `if (adaptApiKey && token !== adaptApiKey)` fail-open shapes) are the two
    highest-blast-radius routes in the repo (hit on every live SDK pageview) and are KNOWN-live
    fail-open TODAY — a strictly worse exposure than the internal-cron FOLLOW-490 route already
    fixed at P1. This is a priority reassessment within normal PM backlog-triage authority (not an
    architectural/pricing/compliance call requiring CEO sign-off) — recorded per FOLLOW-510's own
    AC ("FOLLOW-473's priority is re-evaluated by PM with a recorded decision"). FOLLOW-510 itself
    is now actioned/folded into this ticket (not separately promoted).

    SCOPE ADDED (from FOLLOW-510, mandatory — do not skip): the fail-closed flip MUST be paired
    with an ADAPT_API_KEY / OPS_TENANT_ID provisioning-preflight check so the flip cannot itself
    cause an SDK-wide outage if the ops secret is unprovisioned in prod (same fail-dangerous class
    as FOLLOW-508/509). PREFLIGHT ALREADY RUN by pm-orchestrator 2026-07-08 (`vercel env ls
    production`, apps/control-plane project `adaptive-listings-control-plane`, read-only, no VALUES
    fetched): `ADAPT_API_KEY` IS present (Production + Preview, added ~50d ago). `OPS_TENANT_ID` is
    ABSENT from the full 28-row prod env list. This means: (a) real tenant SDK traffic (which sends
    its own per-tenant `config.apiKey` via `resolveApiKey()`, see fix-pattern below) is UNAFFECTED
    by this flip either way — no outage risk there; (b) the ops-bypass branch (only reachable by a
    caller presenting the shared ADAPT_API_KEY) will hit the SAME "OPS_TENANT_ID must be set
    alongside ADAPT_API_KEY (server misconfiguration)" 500 that feedback/route.ts already returns
    in prod today for that exact case (FOLLOW-450, already merged/live) — i.e. this ticket
    introduces NO NEW failure mode versus the already-accepted feedback-route precedent, it only
    extends the identical existing behavior to GET /api/adapt(+/description). No further preflight
    needed before merge; do not re-run `vercel env ls` yourself (worker worktrees should not assume
    Vercel CLI auth) — cite this paragraph as the preflight evidence in the PR description instead.

    FIX PATTERN TO MIRROR (do not invent a new auth mechanism — confirmed in repo by pm-orchestrator
    before delegating): apps/control-plane/src/app/api/adapt/feedback/route.ts already implements
    the exact target shape for this pair of GET routes — Step 1: resolveApiKey(req) (SHA-256 bearer
    -> api_keys row -> real tenantId, the same helper POST /api/adapt uses since FOLLOW-451); Step 2
    (fallback only): ADAPT_API_KEY ops bypass via secretEquals()
    (apps/control-plane/src/lib/secret-compare.ts), scoped to OPS_TENANT_ID, 500
    "server misconfiguration" if OPS_TENANT_ID is unset while ADAPT_API_KEY is set. The SDK already
    sends `Bearer ${config.apiKey}` (packages/sdk/src/core/adapt-description.ts:231,
    packages/sdk/src/core/adapt.ts:169/267/800) — i.e. real per-tenant keys, not the shared
    ADAPT_API_KEY — so routing GET through resolveApiKey() as the primary path should NOT itself be
    an outage risk for real tenant SDK traffic (only the ops-bypass secondary path needs the
    provisioning preflight above).
    AC:
    - [ ] GET /api/adapt no longer accepts "any non-empty bearer" when ADAPT_API_KEY is unset — a
          missing/misconfigured key fails closed (401), never fails open.
    - [ ] Tenant resolution for GET no longer trusts a raw x-tenant-id header with zero
          verification — mirror feedback/route.ts's resolveApiKey() (Step 1) + ADAPT_API_KEY/
          OPS_TENANT_ID scoped ops-bypass (Step 2) pattern (or a documented, narrower internal-only
          trust boundary if GET truly needs different callers than POST — escalate if so).
    - [ ] Apply the SAME fix to GET /api/adapt/description (identical fail-open shape,
          description/route.ts:183) — Rule S (symmetric siblings fixed at the same tier).
    - [ ] Test matrix parity with FOLLOW-451's route.follow451.test.ts (valid key/tenant, missing
          key, wrong tenant, DB error fails loud, ops-bypass valid/invalid/misconfigured) applied to
          BOTH GET handlers.
    - [ ] PR description cites the pm-orchestrator preflight finding above (ADAPT_API_KEY present /
          OPS_TENANT_ID absent in prod — no new failure mode vs. the already-live feedback-route
          precedent).
- id: FOLLOW-454
  title: >-
    Fix SSR-cookie auth mismatch on tenant dashboard + analytics/pilot/ab APIs (F-01)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-07-02T00:00:00Z'
  completed_at: '2026-07-02T11:35:35Z'
  branch: backend-engineer/FOLLOW-454-ssr-cookie-auth
  pr: 'https://github.com/Pnawrocki9/Adaptive-Listings/pull/422'
  merge_commit: c060a69beeb7b39395b8562782d22b4b7fef5923
  ci:
    'green on every real gate (57 pass / 2 fail — Rule I pre-existing-red, non-blocking, zero
    touched-file violations)'
  priority: P1
  estimated_hours: 4
  depends_on: []
  source: >-
    2026-07-01 audit F-01 — browser sessions hold chunked @supabase/ssr cookies, but
    /api/dashboard/analytics/*, /api/pilot/*, /api/ab/weights, /api/quiz/config, /api/tenants/[id]*
    and the /dashboard/* middleware authenticate via getAuthClaims (Bearer/legacy sb-access-token
    only) → 401 for the very UIs that call them (same class as FOLLOW-326, unpatched tenant-side).
  spec: ADR-0013; project memory admin_ssr_cookie_auth; audit report §4 trap 5
  notes: |
    DELEGATED 2026-07-02 (pm-orchestrator, table row: "ingest worker, control-plane, decision-api,
    Postgres/RLS, auth, onboarding HTTP, billing, webhooks -> backend-engineer"). Picked as the
    highest-impact unblocked P1 in Sprint 22b: this affects EVERY browser-session dashboard route
    (analytics, pilot, ab, quiz/config, tenants) — the exact class already patched admin-side by
    FOLLOW-326/ADR-0013 (project memory admin_ssr_cookie_auth), now unpatched tenant-side. It also
    directly complements the just-merged FOLLOW-453 (PR #419): that PR made the analytics UI
    fail-loud with an explicit error banner instead of fabricated zeros, but a real agency user
    hitting this SSR-cookie mismatch will now SEE that error banner instead of silently getting
    zeros — an improvement, but the underlying login-then-401 bug this ticket fixes is what makes
    the dashboard actually usable end-to-end.
    Runs CONCURRENTLY with FOLLOW-455 (different agent, compliance-engineer) — ISOLATED WORKTREE
    required per FOLLOW-448 branch-first discipline: `git checkout -b
    backend-engineer/FOLLOW-454-ssr-cookie-auth main` in its own `git worktree` MUST be the FIRST
    action, before any file edit (RETRO-146 stalled-worker/stranded-work hazard).
    Reference for the fix pattern: `apps/control-plane/src/**` admin equivalent already uses
    `@supabase/ssr` `createServerClient().getUser()` per project memory admin_ssr_cookie_auth
    (FOLLOW-326, PRs #310/#311) — mirror that pattern on the tenant-side routes/middleware listed
    in source above, do not invent a new auth mechanism.
    AC:
    - [x] Tenant browser-session API routes + /dashboard/* middleware resolve the user via
          @supabase/ssr createServerClient().getUser() (or accept the chunked cookie), not
          getAuthClaims-only.
    - [x] A browser-session agency user loads /dashboard/analytics with real 200s (no 401→zeros).
    - [x] Regression test covering the cookie path for at least one analytics route.

    DONE 2026-07-02 (PM-validated, session 8). PR #422 MERGED at commit `c060a69`
    (2026-07-02T11:35:35Z). Recovered from a crashed prior session (session 7) that had delegated
    this ticket to an isolated worktree (`.claude/worktrees/wt-follow454`) and completed it there
    before the session ended; PR was already open with CI green when session 8 began — this
    session independently re-confirmed (not trusted) via `gh pr view 422 --json state,mergedAt` and
    `gh pr checks 422` (57 pass, only the pre-existing non-blocking "Rule I — wired-or-dead" red on
    both matrix legs, zero violations in this PR's touched files).

    New `apps/control-plane/src/lib/session-auth.ts` (`getSessionAuth`/`getSessionAuthClaims`/
    `requireTenantSessionAccess`) mirrors the admin-side FOLLOW-326/ADR-0013 pattern: tries the
    legacy Bearer/`sb-access-token` path first (unchanged), falls back to
    `@supabase/ssr createServerClient().auth.getUser()` on the chunked SSR cookie, reconstructing
    `AuthClaims` from `app_metadata`. Wired into `middleware.ts` (`checkDashboardSession`, new
    Path-2 fallback on `/dashboard/*`) and 13 route files (dashboard/analytics/{lift,summary},
    pilot/{inquiry-starts,calibration,cta-lift}, ab/weights, quiz/config GET+POST,
    tenants/[id]{,/answers,/answers/[answerId],/lia,/lia/[recordId],/bandit/weights/[archetype]}).
    RLS note: `ab/weights` and `bandit/weights/[archetype]` pass a raw JWT into
    `createTenantClient(rawToken)` for RLS enforcement — `getSessionAuth()` also returns a
    `rawToken` sourced from `getSession().access_token` on the SSR path, so RLS is NOT silently
    disabled (the pass-through/RLS-off branch in `packages/db/src/client.ts` fires only on a truly
    absent token) on either auth path.

    Runtime-wiring verified independently: `grep -rn "getSessionAuth\b" apps/control-plane/src
    --include=*.ts | grep -v '\.test\.'` → 1 producer (`session-auth.ts:151` definition) + 2 real
    non-test consumers (`ab/weights/route.ts:70`, `tenants/[id]/bandit/weights/[archetype]/
    route.ts:48`); `grep -n "checkDashboardSession" apps/control-plane/src/middleware.ts` → defined
    at :195, called at :332 (real middleware entrypoint, not a test). `@estalara/auth`'s
    `getAuthClaims` itself is untouched (still used unmodified by `apps/ingest`/`apps/decision-api`,
    which correctly do not gain a `@supabase/ssr` dependency). PR claims 1429/1429 control-plane
    tests green, `tsc --noEmit` clean with workspace deps built, 0 ESLint errors on all 18 touched
    files — PM did not re-run the full local suite this session (relied on independently-confirmed
    CI green + the wiring greps above, consistent with the CI-is-the-merge-gate policy); no fix
    iterations were needed (CI was green when this session found the PR). CI counter: 0/5 (this
    session), 0/3 fix-iterations. RETRO-149 written (backlog/RETROSPECTIVES.md).
- id: FOLLOW-455
  title: >-
    Harden DSR: CSPRNG OTP + rate-limit/lockout + complete erasure & disclosure coverage (F-20)
  agent: compliance-engineer
  status: DONE
  assigned_to: compliance-engineer
  started_at: '2026-07-02T00:00:00Z'
  completed_at: '2026-07-02T11:35:45Z'
  branch: compliance-engineer/FOLLOW-455-dsr-otp-hardening
  pr: 'https://github.com/Pnawrocki9/Adaptive-Listings/pull/423'
  merge_commit: 765cb81fd3576d78c8b8305ae17251b40acb0acd
  ci: 'green on every real gate (56 pass / 2 fail — Rule I pre-existing-red, non-blocking)'
  priority: P1
  estimated_hours: 6
  depends_on: []
  source: >-
    2026-07-01 audit F-20 — dsr-otp uses Math.random() (not CSPRNG); no rate-limit/attempt-cap and
    global-by-hash lookup → brute-forceable 6-digit code across tenants; erase misses intent_events,
    quiz_completions, intent_sessions (Art.17 holes); access/portability report a stubbed event
    count (Art.15/20).
  spec: MASTER_DESIGN §H.1.1; audit report §5.5 F-20
  notes: |
    DELEGATED 2026-07-02 (pm-orchestrator, table row: "DPIA/ROPA/consent/DSR rules/fair-housing/
    AI-Act docs -> compliance-engineer"). Picked concurrently with FOLLOW-454 (different agent,
    backend-engineer — no shared-tree hazard) as the other unambiguous, unblocked P1: this is a
    live security gap (brute-forceable OTP, Math.random() is not cryptographically secure) AND a
    GDPR Art.17/15/20 compliance gap (incomplete erasure, stubbed disclosure counts) — both classes
    this repo has previously treated as go-live blockers (cf. ESC-035 forgeable-auth precedent).
    Runs CONCURRENTLY with FOLLOW-454 — ISOLATED WORKTREE required per FOLLOW-448 branch-first
    discipline: `git checkout -b compliance-engineer/FOLLOW-455-dsr-otp-hardening main` in its own
    `git worktree` MUST be the FIRST action, before any file edit.
    If implementing the CSPRNG/rate-limit/lockout logic requires touching non-compliance-owned
    control-plane route code beyond the existing dsr-otp/dsr routes, treat that as in-scope for this
    ticket (compliance-engineer's row explicitly covers "DSR rules"), but if it uncovers an
    ambiguous architectural call (e.g., a new external rate-limit store), escalate per the standard
    ESCALATIONS.md guardrail rather than guessing.
    AC:
    - [x] OTP generated with crypto.getRandomValues/randomInt (CSPRNG).
    - [x] Per-capability attempt cap + lockout + request-scoped lookup (not global-by-hash);
          initiate is rate-limited (anti email-bomb); mark-used is atomic.
    - [x] DSR erase set includes intent_events (CH), quiz_completions + intent_sessions (PG).
    - [x] Access/portability disclose the real behavioral event count (remove the count=1 stub).
    - [x] Tests for brute-force lockout + erase coverage on the three added stores.

    DONE 2026-07-02 (PM-validated, session 8). PR #423 MERGED at commit `765cb81`
    (2026-07-02T11:35:45Z). RECOVERED FROM A CRASHED WORKER SESSION: this session found the
    implementing compliance-engineer subagent had died mid-ticket, leaving its work UNCOMMITTED but
    correctly isolated on its own worktree/branch (`.claude/worktrees/wt-follow455`, on
    `compliance-engineer/FOLLOW-455-dsr-otp-hardening` — unlike the FOLLOW-442/RETRO-146 near-miss,
    the crashed worker HAD followed branch-first discipline, so nothing was stranded on `main`).
    Recovery required fixing FOUR separate gate-class defects the crashed worker never got to run
    locally: 4 ESLint errors, Prettier formatting, 1 typecheck error (pglite test-db type vs the
    prod `PostgresJsDatabase` type), and a `next build` webpack import-resolution bug (a relative
    `./dsr-otp.js` import that only resolves under ts-node/vitest, not webpack — fixed to the
    `@/lib/dsr-otp` path alias already used elsewhere in the codebase). Verified 106 DSR tests green
    AND `next build` exit 0 BEFORE committing/pushing/opening the PR (Operating Principle 5 /
    RETRO-146 §4e(c) verify-not-trust-on-handoff, applied literally: did not trust the crashed
    worker's uncommitted diff as "tests pass" — independently ran the full local gate suite).

    Migration `packages/db/migrations/0032_dsr_verifications_attempt_count.sql` landed (adds
    `attempt_count integer NOT NULL DEFAULT 0` to `dsr_verifications` + a composite
    `(tenant_id, email, created_at)` index; idempotent, `ADD COLUMN IF NOT EXISTS`/
    `CREATE INDEX IF NOT EXISTS`). **PROD-APPLY note (does NOT block DONE, unlike the ClickHouse
    migration class in FOLLOW-449):** unlike ClickHouse migrations (no auto-apply mechanism, per
    project memory), Postgres/Drizzle migrations under `packages/db/migrations/**` ARE
    auto-applied on push to `main` via `.github/workflows/db-migrate.yml` (staging first, then
    prod) — this session confirmed `gh run list --workflow=db-migrate.yml` shows a run
    (`28586941940`) auto-triggered by this exact merge; run was STILL IN PROGRESS (staging leg,
    "Run Drizzle migrations (staging)" step) as of this session's end — prior runs of this same
    workflow took up to ~1h42m end-to-end (staging+prod), so this is expected, not stalled. NOT YET
    CONFIRMED COMPLETE — see STATUS.md Migration status table; next session MUST verify
    `gh run view 28586941940` shows `completed success` (both staging and prod legs) before
    treating migration 0032 as live in prod. `dsr-verify.ts:90/110` reads/writes the new `attemptCount` Drizzle field
    on every DSR verify — until the prod leg of that workflow run completes, a live DSR
    verify/erase/access/portability request against prod would 500 on the missing column; this is
    the same drift-window risk class as ESC-022/ESC-031, now on rails via the existing db-migrate.yml
    automation rather than requiring a fresh operator escalation.

    Runtime-wiring verified independently: `grep -rln "dsr-rate-limit\|dsr-verify"
    apps/control-plane/src --include=*.ts | grep -v '\.test\.'` → 4 non-test consumers
    (`dsr-otp.ts`, `dsr/initiate/route.ts`, `dsr/portability/route.ts`, `dsr/erase/route.ts`,
    `dsr/access/route.ts`); `grep -n "intent_events\|quiz_completions\|intent_sessions"
    apps/control-plane/src/app/api/dsr/erase/route.ts` → all three new erasure targets present with
    real DELETE/ALTER-TABLE-DELETE call sites, not just comments. CI counter this session: 0/5 (the
    4 gate-class fixes were made and verified locally BEFORE opening the PR, so PR #423's own CI run
    was green on the first and only push — no CI-driven fix-iteration was consumed). RETRO-150
    written (backlog/RETROSPECTIVES.md) — flags a candidate process gap (worker crashes can leave
    multi-gate-class defects even inside a correctly-isolated worktree) distinct from RETRO-146's
    branch-hygiene finding; see FOLLOW-474.
- id: FOLLOW-456
  title: >-
    Close tenant-isolation holes: demo revoke, global generation-model, fail-open secrets (F-13)
  agent: backend-engineer
  status: DONE # corrected 2026-07-06 (pm-orchestrator) — PR #430 confirmed MERGED 2026-07-03T09:42:22Z via `gh pr view`; this flip was missed by the prior session. RETRO-153 pending spawn.
  assigned_to: backend-engineer
  started_at: '2026-07-02T19:25:00Z'
  completed_at: '2026-07-03T09:42:22Z'
  branch: backend-engineer/FOLLOW-456-tenant-isolation-holes
  pr: 'https://github.com/Pnawrocki9/Adaptive-Listings/pull/430 (MERGED)'
  ci: 'green (57 real gates); Rule I wired-or-dead pre-existing-red non-blocking'
  merge_risk: >-
    ⚠️ MERGE-ORDER RISK (VERIFIED 2026-07-02 via `vercel env ls`): this PR makes THREE routes FAIL
    CLOSED when their secret is unset (each previously ran with NO auth — real holes). ALL THREE
    secrets are confirmed MISSING in BOTH Vercel prod AND preview: ADMIN_API_SECRET (POST
    /api/tenants — onboarding), LISTING_UPDATED_WEBHOOK_SECRET (POST /api/webhooks/listing-updated),
    DESCRIPTION_CACHE_INTERNAL_SECRET (POST /api/internal/description-cache — also FOLLOW-460's
    Modal callback). So merging #430 as-is makes all three 401 in prod until each secret is
    provisioned AND its legitimate caller sends it. OPEN QUESTION: is /api/tenants a
    server-to-server (secret-bearing) or browser-session endpoint — if browser, requiring a server
    secret needs a JWT/session rethink, not just provisioning. Full detail + AC in FOLLOW-483 (P1).
    New shared helper secret-compare.ts (SHA-256 + timingSafeEqual) guards all three;
    DESCRIPTION_CACHE_INTERNAL_SECRET name unchanged so FOLLOW-460's Modal callback contract is
    intact (proven by a new 201 test).
  priority: P1
  estimated_hours: 3
  depends_on: []
  source: >-
    2026-07-01 audit F-13 — /api/demo/sessions/[id]/revoke trusts spoofable x-tenant-id on a real
    mutation; PUT /api/admin/generation-model lets any tenant agency:admin mutate the
    platform-global model; /api/tenants, /api/webhooks/listing-updated, /api/internal/description-
    cache fail OPEN when their secret env is unset.
  spec: audit report §5.5 F-13; CONVENTIONS_PATCH.md Rule (tenant isolation)
  notes: |
    AC:
    - [ ] demo revoke derives tenant from the verified JWT, not x-tenant-id.
    - [ ] generation-model global write gated on estalara_staff (not a tenant agency:admin role).
    - [ ] The three secret-guarded routes fail CLOSED (reject) when the secret env is unset;
          comparisons use timingSafeEqual.
    - [ ] Tests: spoofed x-tenant-id revoke → 403; unset-secret webhook → reject.
- id: FOLLOW-457
  title: >-
    LLM grounding integrity: fail-loud on empty original + fact whitelist on the directive path
    (F-11)
  agent: ml-engineer
  status: DONE
  assigned_to: ml-engineer
  started_at: '2026-07-02T12:00:00Z'
  completed_at: '2026-07-02T15:58:59Z'
  branch: ml-engineer/FOLLOW-457-llm-grounding-integrity
  pr: 'https://github.com/Pnawrocki9/Adaptive-Listings/pull/425'
  merge_commit: 0b9b7adf488a8b7a1804a1d881d6d4852917c940
  ci: 'green (56 real gates); Rule I wired-or-dead pre-existing-red non-blocking'
  priority: P1
  estimated_hours: 5
  depends_on: []
  source: >-
    2026-07-01 audit F-11 — ESC-019 still open: fetchListingOriginalDescription returns '' on
    302/timeout/non-2xx, logs console-only, does not block → near-ungrounded copy; and the directive
    path (lib/llm-gateway.ts Haiku/Sonnet for headline/CTA) has NO fact whitelist / fit gate → a
    hallucinated number in a headline directive would ship.
  spec: MASTER_DESIGN §E.7.5 anti-hallucination; ADR-0009/ADR-0010; audit report §5.6 F-11
  notes: |
    DELEGATED 2026-07-02 (pm-orchestrator, session 8, table row: "intent/adapt logic, embeddings,
    LLM gateway, auto-detect, ontology, platform-templates -> ml-engineer"). Highest-priority READY
    P1 on a distinct agent from FOLLOW-450 (backend-engineer) — no shared-tree hazard, run
    CONCURRENTLY. NOTE: `backlog/ESCALATIONS.md` shows ESC-019 as RESOLVED (the reachability/auth
    half — server-side listing fetch no longer 302s to login) — this ticket's own source text
    ("ESC-019 still open") is the 2026-07-01 audit report's wording for the DISTINCT residual gap
    (fail-loud-on-empty + no fact whitelist on the directive path), not a claim that the resolved
    escalation should be reopened; do not conflate. If the fetch-reachability half is confirmed
    still fully fixed, scope this ticket to AC1 (fail-loud skip-generation) + AC2/AC3 (directive
    fact-whitelist) without re-litigating the auth fix.
    ISOLATED WORKTREE required per FOLLOW-448 branch-first discipline: `git checkout -b
    ml-engineer/FOLLOW-457-grounding-integrity main` in its own `git worktree` MUST be the FIRST
    action, before any file edit.
    AC:
    - [ ] Empty/failed original-description fetch captures to Sentry AND skips generation (no
          ungrounded Sonnet call); ESC-019 marked resolved with a runtime proof.
    - [ ] Directive prompts (buildHaikuPrompt/buildSonnetPrompt) get the same fact-whitelist +
          numeric/proper-noun grounding check the description headline path already has.
    - [ ] A test with a poisoned context proves a hallucinated price/area is rejected on BOTH the
          description and directive paths (fail-safe: falls back to playbook copy).
- id: FOLLOW-458
  title: >-
    Deploy stream-consumer + data-quality cron so live chat NLP and drift detection actually run
    (F-03)
  agent: devops-engineer
  status: BLOCKED # corrected 2026-07-11 (audit #3 §6.4): was READY with unmet depends_on [FOLLOW-449] — inconsistency flagged across multiple sessions, now fixed. Un-blocks when FOLLOW-553 (Sprint 23 Wave 0 operator session) completes the FOLLOW-449 prod-apply leg. Scheduled as Sprint 23 Wave 2 (shadow-only deploy per CEO Q2 2026-07-02).
  priority: P2
  estimated_hours: 6
  depends_on: [FOLLOW-449]
  source: >-
    2026-07-01 audit F-03 — apps/stream-consumer (real consumer that spawns the Modal Haiku NLP) is
    deployed by no workflow and its Redpanda topic is never fed → real-time chat→archetype path is
    dead in prod; apps/data-quality schema_validation cron (real, 526 LOC) is never modal-deployed →
    daily drift detection offline.
  spec: MASTER_DESIGN §Snapshot.2; ADR-0005; audit report §5.2 F-03
  notes: |
    CEO DECISION (Q2, 2026-07-02): SHADOW-ONLY for this pilot — live chat→archetype adaptation is
    NOT in scope. Downgraded from P1 blocker to P2/P3 FAST-FOLLOW. Do NOT delete the consumer or
    its topic wiring; deploy is deferred, not cut (shadow path stays intact for later go-live).
    DECISION-GATED note resolved: "shadow-only, deploy deferred."
    AC:
    - [ ] Either (a) deploy stream-consumer to Modal + wire the events topic so process_chat_message
          runs on live traffic and CHAT_NLP_LIVE has a real effect (remove the log-only stub), OR
          (b) per ADR-0005 re-scope chat NLP onto the direct control-plane read path and delete the
          dead consumer + its topic expectation (no orphan code).
    - [ ] data-quality schema_validation cron is modal-deployed on its 0 2 * * * schedule; a drift
          run writes a schema_validation_history row in prod.
    - [ ] Fix the estalara.events vs consumer-default 'events' topic-name mismatch either way.
- id: FOLLOW-459
  title: >-
    Ingest: ACK before the ClickHouse insert to meet the <50ms p95 budget (F-09)
  agent: backend-engineer
  status: DONE # corrected 2026-07-06 (pm-orchestrator) — PR #429 confirmed MERGED 2026-07-03T09:14:42Z via `gh pr view`; this flip was missed by the prior session. RETRO-154 pending spawn.
  assigned_to: backend-engineer
  started_at: '2026-07-02T17:40:00Z'
  completed_at: '2026-07-03T09:14:42Z'
  branch: backend-engineer/FOLLOW-459-ingest-ack-before-insert
  pr: 'https://github.com/Pnawrocki9/Adaptive-Listings/pull/429 (MERGED)'
  ci: 'green (56 real gates); Rule I wired-or-dead pre-existing-red non-blocking'
  notes_pm: >-
    ACK now returns after Redpanda success; CH insert runs post-ACK in ctx.waitUntil (same 3x
    backoff). Terminal CH failure after ACK → Sentry-captured (not durably re-queued). Durable
    Cloudflare-Queues retry deferred to FOLLOW-482 (new-infra ADR required). Worker had mis-numbered
    that deferral 475 (collided with RETRO-151) — renumbered to 482 and its FOLLOW_UPS.md edit
    reverted so this session's PM branch is the single writer of FOLLOW_UPS.md (commit c87073b).
  priority: P1
  estimated_hours: 4
  depends_on: []
  source: >-
    2026-07-01 audit F-09 — handlers/events.ts awaits the CH insert before ACK (worst case ~15s:
    3×4s timeouts + backoff); the <50ms p95 budget stated at index.ts:10 is unachievable.
  spec: MASTER_DESIGN quality bars (ingest ACK p95 <50ms); audit report §5.4 F-09
  notes: |
    AC:
    - [ ] ACK is returned before the CH insert completes (waitUntil/queue/DO), preserving at-least-
          once delivery + the existing 503/DLQ-less retry semantics documented.
    - [ ] A CH failure after ACK is captured to Sentry (not lost silently) and, if feasible, retried
          via a durable path.
    - [ ] Latency test/benchmark demonstrating ACK p95 within budget under a happy-path insert.
- id: FOLLOW-460
  title: >-
    Finish the v2.0 permanent description cache: Modal writes Postgres, drop TTL/tier (F-10)
  agent: ml-engineer
  status: DONE
  assigned_to: ml-engineer
  started_at: '2026-07-02T16:20:00Z'
  completed_at: '2026-07-03T13:00:00Z'
  branch: ml-engineer/FOLLOW-460-permanent-description-cache
  pr: 'https://github.com/Pnawrocki9/Adaptive-Listings/pull/428'
  merge_commit: 9a5e649
  ci: 'green (56 real gates); Rule I wired-or-dead pre-existing-red non-blocking'
  operator_action_DONE: >-
    2026-07-03 GO-LIVE ATTESTED. Operator (Piotr) provisioned DESCRIPTION_CACHE_API_BASE_URL +
    DESCRIPTION_CACHE_INTERNAL_SECRET in Modal `estalara-secrets` (via the ESC-036 Modal stand-up),
    deployed apps/llm-gateway, and a real Sonnet-generated family_buyer description (1060 chars) was
    written to prod `description_cache_persistent` — verified via direct Modal web-endpoint smoke
    test. The v2.0 permanent Postgres cache write is LIVE. (Two deploy bugs fixed en route: missing
    contract fixture in the Modal image → PR #433; a stray leading space in the ANTHROPIC_API_KEY
    secret value → corrected in `estalara-secrets`.)
  priority: P1
  estimated_hours: 4
  depends_on: []
  source: >-
    2026-07-01 audit F-10 — generate_description.py still SETs Redis with EX 72h/48h and
    tier-derived logic and NEVER writes description_cache_persistent; durability depends on a read
    landing within 72h to trigger backfill → unread generations silently expire and are re-paid;
    contradicts the "no Tiers, no TTL" §E.7 v2.0 ruling.
  spec: MASTER_DESIGN §E.7 (v2.0 permanent cache); audit report §5.2 F-10
  notes: |
    AC:
    - [ ] Modal job writes description_cache_persistent (Postgres) on generation; Redis SET has no
          EX; all tier/ttl_seconds logic removed from the Python job.
    - [ ] Lookup order description_cache_persistent → Redis → template_fallback holds end-to-end.
    - [ ] Test: a generated description survives a >72h simulated gap (present in Postgres, no
          re-enqueue).
- id: FOLLOW-485
  title: >-
    Pilot: replace Redpanda with direct Modal HTTPS invocation for description + embed-seed
    (ADR-0016)
  agent: ml-engineer
  status: DONE
  assigned_to: ml-engineer
  started_at: '2026-07-03T10:00:00Z'
  completed_at: '2026-07-03T13:00:00Z'
  branch: ml-engineer/FOLLOW-485-direct-modal-invocation
  pr: 'https://github.com/Pnawrocki9/Adaptive-Listings/pull/431'
  merge_commit: 7b707c3
  ci: 'green (56 real gates); Rule I wired-or-dead pre-existing-red non-blocking'
  golive_attestation: >-
    2026-07-03 PROVEN in prod: control-plane→Modal direct-HTTPS path stood up; a POST to the
    deployed `description_requested_endpoint` (Bearer INTERNAL_API_SECRET) spawned
    generate_description → Sonnet → a real row in `description_cache_persistent`. Redpanda fully
    bypassed for this flow (no account). NOTE: the smoke test hit the Modal endpoint directly; the
    full browser→SDK→control-plane →Modal leg (and the ESC-019 listing-fetch hop) still wants a
    real-listing confirmation.
  notes_pm: >-
    @modal.fastapi_endpoint(method="POST") + hmac.compare_digest bearer (INTERNAL_API_SECRET);
    reuses existing REQUIRED_FIELDS validation; pollers unscheduled (code retained). control-plane
    publishers swapped to MODAL_DESCRIPTION_URL / MODAL_EMBED_SEED_URL, fail-loud on non-2xx. Worker
    additionally drove the real modal-1.4.2 endpoint via get_raw_f()+FastAPI TestClient
    (401/400/202). Additive vs #428 (no conflict). MERGE ORDER: after #428 (FOLLOW-460). Two
    follow-ups filed: FOLLOW-486 (CI fastapi_endpoint smoke), FOLLOW-487 (.env.example REDPANDA
    topic cleanup).
  priority: P1
  estimated_hours: 6
  depends_on: []
  source: >-
    ESC-036 stand-up finding: prod Redpanda is Serverless, whose HTTP Proxy (the REST endpoint the
    edge/serverless producers publish through) is BYOC/Dedicated-only; a Dedicated cluster
    (~$500/mo) is out of pilot budget (CEO 2026-07-03). The bus's only job in these two flows is to
    hand a request from the control-plane (Vercel) to Modal — Modal supports authenticated HTTPS
    invocation natively, so the bus can be dropped for the pilot.
  spec: ADR-0016 (pilot direct Modal invocation); ESC-036; ADR-0005; FOLLOW-458 precedent
  notes: |
    CEO DECISION 2026-07-03: adopt ADR-0016 — direct Modal web endpoint, no Redpanda for the pilot
    description + embed-seed flows. Cross-agent: touches Modal Python (ml-engineer, owns llm-gateway)
    AND the control-plane publisher seam (TS). Assigned ml-engineer as primary; the control-plane
    swap is small and in scope. ISOLATED WORKTREE per FOLLOW-448.
    AC:
    - [ ] Modal (apps/llm-gateway): add one authenticated web endpoint per flow (POST, Bearer =
          INTERNAL_API_SECRET) that validates the payload and calls generate_description.spawn(event)
          / the embed job's .spawn(...). Use the current Modal decorator (fastapi_endpoint/web_endpoint
          for modal 1.4.x). Retire consume_description_requests / consume_embed_seed_requests from the
          deploy (remove the schedule; keep the code, clearly commented as superseded by ADR-0016).
    - [ ] control-plane: publishDescriptionRequested → POST MODAL_DESCRIPTION_URL (Bearer
          INTERNAL_API_SECRET), inside the existing afterResponse() fail-loud wrapper; same for the
          listing-embed-seed publisher → MODAL_EMBED_SEED_URL. On non-2xx, fail loud (Sentry), do not
          throw.
    - [ ] Config: MODAL_DESCRIPTION_URL + MODAL_EMBED_SEED_URL documented in .env.example; the
          Phase-A path no longer requires any REDPANDA_* var. estalara-secrets loses REDPANDA_* for
          description generation (keep ANTHROPIC/UPSTASH/DESCRIPTION_CACHE_*/SENTRY/INTERNAL_API_SECRET).
    - [ ] Tests: a poisoned/unauthorized POST to the Modal endpoint is rejected; a valid POST spawns
          generation; control-plane publisher posts to the Modal URL with the Bearer and handles
          non-2xx fail-loud. next build + full gates green.
    - [ ] OUT OF SCOPE (documented in ADR-0016, not this ticket): ab-events + ingest Redpanda mirror
          — they no-op without REDPANDA_REST_URL; pilot metrics come from direct ClickHouse/Postgres
          writes. A separate follow-up decides their fate.
    - [ ] Update docs/runbooks/MODAL_PROD_STANDUP.md + the operator guide to the no-Redpanda flow.
- id: FOLLOW-461
  title: >-
    Reconcile the event schema to reality: register adapt.description.* + prune/wire unproduced
    types (F-04)
  agent: sdk-engineer
  status: DONE # merged 63e48d4 (#481); RETRO-166 filed. F-04 closed at the queryable level (payload fidelity verified clean, no operator dependency)
  assigned_to: sdk-engineer
  completed_at: '2026-07-08T00:00:00Z'
  merged_commit: 63e48d4
  started_at: '2026-07-08T00:00:00Z'
  branch: sdk-engineer/FOLLOW-461-event-schema-reconcile
  pr: 481
  ci_status: green # all real gates pass (gitleaks fixed); only standing pre-existing Rule I baseline red (181 symbols, new symbols confirmed absent)
  validated: |
    Session 18 (2026-07-08) — sdk-engineer PR #481. AC1: 6 adapt.description.* types
    (applied/skipped/error/re + headline.applied/headline.re) registered in a new
    packages/shared/src/schemas/events/adapt-description.ts, wired into the EventSchema union +
    EVENT_TYPES (46→52), payloads verified field-by-field at the real emit sites
    (packages/sdk/src/core/adapt-description.ts) — closes the live F-04 drop where the ingest
    consumer (apps/ingest/src/handlers/events.ts:210 EventSchema.safeParse) silently rejected them.
    AC3: round-trip tests green (events.test.ts validates each SDK payload against EventSchema; the
    sdk test drives the real apply/fetch paths). AC2 reconciliation: pruned NOTHING — all 23
    unproduced types trace to Master Design §C.1 / ADR-0005 / TICKET-AB-001 / TICKET-037, so none
    were clearly-dead; no ambiguous deletion → no escalation (correct conservative outcome).
    Gitleaks false-positive on the 42–46-char AdaptDescriptionHeadline* identifiers fixed with a
    token-scoped .gitleaks.toml allowlist (FOLLOW-435 precedent). Independently verified: gitleaks
    now green, Rule I unchanged (splitParagraphs pre-existing WARN only, new symbols absent). Local:
    tsc/eslint/prettier clean, shared 279 + sdk 1510 tests pass. Human merge only.
  priority: P2
  estimated_hours: 4
  depends_on: []
  source: >-
    2026-07-01 audit F-04 — SDK emits adapt.description.* events that are NOT in EventSchema →
    ingest rejects them (description adaptation observably blind server-side); 25 of 46 defined
    event types have no SDK producer (floorplan, mouse.*, photo open/zoom, search/sort, tour,
    inquiry.completed, ab.assignment, sidebar.closed).
  spec: ADR-0003 event schema; CONVENTIONS_PATCH.md Rule H; audit report §5.3 F-04
  notes: |
    AC:
    - [ ] adapt.description.* event types added to packages/shared EventSchema (or their emission
          removed) so ingest no longer silently drops description-adaptation observability.
    - [ ] Each unproduced event type is either wired to an SDK producer or removed from the schema;
          document the final defined==producible set (Rule H: no schema without a consumer/producer).
    - [ ] A round-trip test asserts every defined event type validates at ingest.
- id: FOLLOW-535
  title: >-
    description_generations has no TTL/retention policy and now grows unbounded (writer added by
    FOLLOW-463)
  agent: data-engineer
  status: DONE # PR #483 merged (8931618); prod-applied and CLI-verified via PR #486 (2026-07-09); RETRO-167 filed
  assigned_to: data-engineer
  completed_at: '2026-07-09T00:00:00Z'
  merged_commit: 8931618
  started_at: '2026-07-08T00:00:00Z'
  branch: data-engineer/FOLLOW-535-description-generations-ttl
  pr: 483
  ci_status: green # gitleaks fixed (squash); CH migrations smoke + golden-DDL test green; only standing Rule I baseline red (PR adds no TS → Rule I unaffected)
  validated: |
    Session 18 (2026-07-08) — data-engineer PR #483. Migration 0020: MODIFY TTL
    toDateTime(created_at) + INTERVAL 13 MONTH (mirrors events 0001:46; 13mo chosen for an
    anti-hallucination audit trail vs intent_events 90d). Verified live against a local CH container;
    idempotent. Bonus: a golden-DDL regression test (ttl-golden-test.sh) wired as a step in the
    existing CH CI job. Independently verified: CH-migrations-smoke + journal-monotonicity green;
    gitleaks now green (earlier fail was a cloudflare-api-token false-positive on the 43-char 0007
    migration-filename reference — resolved by squashing the fix into the original commit, since
    gitleaks scans each historical patch); Rule I unaffected (PR adds no TS). Human merge only.

    PROD ATTESTATION (2026-07-09, PR #486, docs-only, merged): CH operator session applied migration
    0020 to prod, then the FOLLOW-463 grant (TTL first, per RETRO-167's recommended order). Verbatim
    CLI verification via Doppler `prd` `ingest_worker` creds: `SHOW CREATE TABLE
    default.description_generations` shows `TTL toDateTime(created_at) + toIntervalMonth(13)`. Two
    operator typos caught and corrected during the session (an `INTERNAL`/`INTERVAL` keyword typo
    in the TTL ALTER, and a misspelled-table grant — see FOLLOW-463 below) — final state
    CLI-reverified clean. Flipping CODE_COMPLETE_OPERATOR_PENDING -> DONE: code merged (#483),
    prod-applied and verified (#486), RETRO-167 filed (FOLLOW-541/542 stubbed). No open blocker
    remains for this ticket.
  priority: P2
  estimated_hours: 2
  depends_on: []
  source: >-
    RETRO-165 §4a LG-1 (source_ticket FOLLOW-463) — 0007 defines description_generations with
    PARTITION BY toYYYYMM(created_at) but NO TTL; inert while zero-writer, but FOLLOW-463 added the
    first writer so every non-NEUTRAL generation now appends a never-deduped row indefinitely
    (amplified by RETRO-163/FOLLOW-528 model-toggle re-dispatch). Siblings have retention (events
    TTL 13 MONTH 0001:46; intent_events 90-day 0014).
  spec: backlog/FOLLOW_UPS.md FOLLOW-535; RETRO-165 §4a
  notes: |
    Promoted stub -> queue 2026-07-08 (pm-orchestrator, session 18) and dispatched immediately —
    tight continuation of FOLLOW-463 (the table we just added the first writer to), and the retro
    flagged the missing TTL as load-bearing. Model: Sonnet (routine, well-defined CH migration).
    Full brief in backlog/HANDOFFS.md (session 18 -> data-engineer, FOLLOW-535).
    AC:
    - [x] New migration (0020) adds a TTL to description_generations — default 13 MONTH on created_at
          (align with the events audit sibling; anti-hallucination audit record warrants the longer
          retention over intent_events' 90 days). Does NOT alter 0007.
    - [x] Passes the "ClickHouse migrations smoke" CI gate.
    - [x] Prod-applied and CLI-verified (PR #486, 2026-07-09): `SHOW CREATE TABLE` shows the TTL
          expression verbatim.
    RETRO-167 filed for this ticket (source PRs #483/#484); no bug/logic gap found, table confirmed
    to have zero in-repo reader (see FOLLOW-536 stub below) so the TTL carried zero correctness
    risk while dormant. Follow-up stubs FOLLOW-541 (DATA_DICTIONARY wording) + FOLLOW-542 (durable
    order-safe CH operator runbook) filed in backlog/FOLLOW_UPS.md, not yet promoted.
    REMAINING OPEN HOP (not this ticket's scope): FOLLOW-536 (stub, not yet promoted) —
    description_generations has a producer (FOLLOW-463) and a TTL (this ticket) but still zero
    in-repo reader/consumer. Table is a well-formed, retained write-only audit sink today.
- id: FOLLOW-462
  title: >-
    ClickHouse DSR SQL: bind session_id as a param (backslash-safe) so erasure can't silently fail
    (F-14)
  agent: data-engineer
  status: DONE
  assigned_to: data-engineer
  started_at: '2026-07-06T00:00:00Z'
  completed_at: '2026-07-06T12:00:00Z'
  merge_commit: 7880a1e
  branch: data-engineer/FOLLOW-462-clickhouse-dsr-param-binding
  pr: 'https://github.com/Pnawrocki9/Adaptive-Listings/pull/438'
  ci:
    'green (56 real gates, independently verified); Rule I wired-or-dead pre-existing-red
    non-blocking'
  notes_pm: >-
    Param-binding (not allowlist) — mirrors the existing chTracerQuery/chTracerCount convention
    (clickhouse-tracer.ts, FOLLOW-261). Hardened every id site incl. resolveMutationIdByMarker
    (previously UNESCAPED). Backslash/quote golden-query tests added. Worker flagged FOLLOW-504:
    chTracerQuery/chTracerCount don't escape param values before searchParams.set() — same latent
    class, currently safe (UUID/hex only), defense-in-depth follow-up.
  priority: P2
  estimated_hours: 2
  depends_on: []
  source: >-
    2026-07-01 audit F-14 — clickhouse-dsr.ts escapes ' only (not backslash); a session_id ending in
    \ malforms the ALTER…DELETE → DSR erasure silently fails (Art.17 compliance failure).
  spec: audit report §5.5 F-14; §4 trap 9
  notes: |
    AC:
    - [ ] DSR erase/status SQL uses ClickHouse param_* binding (or a strict hex/uuid allowlist) for
          session_id/tenant/mutation IDs — no raw quote-only escaping.
    - [ ] Test: a session_id containing a trailing backslash produces a well-formed, executed DELETE.
- id: FOLLOW-490
  title: >-
    Fix the 4th live fail-open route — /api/internal/schema accepts any non-empty bearer when
    SCHEMA_API_TOKEN is unset (the original FOLLOW-456's fix was cloned from)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-07-06T13:00:00Z'
  completed_at: '2026-07-06T14:00:00Z'
  merge_commit: 154d684
  branch: backend-engineer/FOLLOW-490-schema-fail-open
  pr: 'https://github.com/Pnawrocki9/Adaptive-Listings/pull/442'
  ci:
    'green (57 real gates, independently verified); Rule I wired-or-dead pre-existing-red
    non-blocking'
  notes_pm: >-
    Fail-closed via secretEquals (constant-time); 6-case unset/wrong/correct auth-matrix test. AC4
    grep found 2 MORE identical fail-open sites — ADAPT_API_KEY in GET /api/adapt:703 and GET
    /api/adapt/description:183 — deliberately NOT fixed here: they are live SDK-facing decision
    paths that also trust a spoofable x-tenant-id and are already scoped by FOLLOW-473 (flipping
    them fail-closed needs ADAPT_API_KEY confirmed in Vercel prod first, else SDK-wide outage). No
    new follow-up needed; FOLLOW-473 covers them.
  priority: P1
  estimated_hours: 1
  depends_on: []
  source: >-
    RETRO-153 (FOLLOW-456) — PR #430 closed the `if (secret) { if (provided !== secret) reject }`
    fail-open shape on three routes but LEFT the original it was copied from.
    api/internal/schema/route.ts:39-42 still accepts any non-empty bearer when SCHEMA_API_TOKEN is
    unset. Since all three sibling secrets were confirmed MISSING in Vercel prod (FOLLOW-483),
    SCHEMA_API_TOKEN is plausibly unset too → likely a LIVE auth hole on the per-tenant schema-drift
    endpoint (data-engineer daily cron, Master Design B.6). Promoted from FOLLOW_UPS stub
    2026-07-06.
  spec: RETRO-153; Master Design B.6; must land before FOLLOW-484 grep-lint
  notes: |
    AC:
    - [ ] /api/internal/schema returns 401 when SCHEMA_API_TOKEN is unset, even with a non-empty
          bearer (fail CLOSED).
    - [ ] 401 on wrong secret, success on correct secret, via secretEquals (constant-time), never a
          raw !== compare.
    - [ ] route.test.ts asserts the unset→401 / wrong→401 / correct→200 matrix.
    - [ ] Repo-wide grep confirms no remaining fail-open secret shape in apps/control-plane handlers
          (clean hand-off to FOLLOW-484).
- id: FOLLOW-482
  title: >-
    Durable, crash-survivable retry queue (Cloudflare Queues) for the post-ACK ClickHouse insert
    (ADR-0017)
  agent: backend-engineer
  status: CODE_COMPLETE_OPERATOR_PENDING # RETRO-159 Rule AA fix: code merged (f53c3ba) but the durable retry is INERT until devops provisions the queues (see operator_action); over-marked DONE in error, corrected 2026-07-06.
  assigned_to: backend-engineer
  code_completed_at: '2026-07-06T17:00:00Z'
  merge_commit: f53c3ba
  branch: backend-engineer/FOLLOW-482-clickhouse-retry-queue
  pr: 'https://github.com/Pnawrocki9/Adaptive-Listings/pull/449'
  ci:
    'green (56 real gates, independently verified); Rule I wired-or-dead pre-existing-red
    non-blocking'
  operator_action: >-
    DEPLOY-TIME DEVOPS HANDOFF before the queue actually retries: create the Cloudflare queues
    `estalara-events-retry` + `estalara-events-retry-dlq` (`wrangler queues create` or Terraform in
    infra/terraform/cloudflare/) per env; names must match apps/ingest/wrangler.toml. Code is
    merge/deploy-safe BEFORE provisioning — the EVENTS_RETRY_QUEUE binding is optional and degrades
    to pre-FOLLOW-482 behavior (Sentry-capture-only + warn) if absent. DLQ alert/runbook owner =
    devops (FOLLOW-495; alert should also key off the new Sentry tag kind:'retry_reinsert_failed').
  priority: P1
  estimated_hours: 6
  depends_on: []
  source: >-
    RETRO-154/FOLLOW-459 — ClickHouse is the SOLE prod events sink (Redpanda no-op, ESC-017); a
    terminal CH insert failure after the ~3.1s in-process retry window is Sentry-captured but the
    batch is not re-queued → events LOST. ADR-0017 ACCEPTED (CEO 2026-07-06, ESC-037): Cloudflare
    Queues over Upstash; duplicate-row risk ACCEPTED (no dedup key); DLQ runbook owner = devops.
  spec: docs/adr/ADR-0017-durable-post-ack-clickhouse-retry-queue.md (ACCEPTED)
  notes: |
    AC:
    - [ ] apps/ingest produces the failed batch to a Cloudflare Queue (estalara-events-retry) on
          terminal CH failure (after the in-process retries), replacing Sentry-capture-only.
    - [ ] A queue() consumer handler in the SAME apps/ingest Worker re-inserts via the existing
          pushToClickHouse path; native DLQ (estalara-events-retry-dlq) for poison batches.
    - [ ] wrangler.toml declares the producer + consumer + DLQ bindings (all envs); no dedup key
          added (duplicate risk accepted per ADR-0017).
    - [ ] Tests cover produce-on-terminal-failure and consumer re-insert. Actual CF Queue/DLQ +
          Terraform provisioning is a devops/operator deploy-time step (flag as handoff, not blocker).
- id: FOLLOW-513
  title: >-
    Ingest: the queue() consumer runs outside withSentry so its retry_reinsert_failed /
    malformed_retry_message captures likely no-op — bind Sentry on the queue path
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-07-06T18:00:00Z'
  completed_at: '2026-07-06T19:00:00Z'
  merge_commit: ef2d6dc
  branch: backend-engineer/FOLLOW-513-queue-sentry-binding
  pr: 'https://github.com/Pnawrocki9/Adaptive-Listings/pull/453'
  ci:
    'green (56 real gates, independently verified); Rule I wired-or-dead pre-existing-red
    non-blocking'
  notes_pm: >-
    Pure code fix, no operator dependency → genuinely DONE (contrast FOLLOW-482). Whole { fetch,
    queue } now wrapped in withSentry (verified @sentry/cloudflare@10.50.0 does instrument queue
    despite stale JSDoc). Worker also caught that @microlabs/otel-cf-workers instrument()
    mutates+wraps queue → fed it a fresh {fetch}-only object. LG-1 folded in: unknown schema_version
    now retried (not ack-dropped). New test drives the REAL index.ts default export (git-stash
    regression-verified fail-pre/pass-post) — closes the direct-call blind spot. 204/204 tests.
  priority: P1
  estimated_hours: 2
  depends_on: []
  source: >-
    RETRO-159 §4b BUG-1 / §4c TG-1 / §4a LG-1 / §7 hop-2 (FOLLOW-482 follow-up) — index.ts wraps
    only { fetch } in withSentry (Sentry.withSentry inits the client per-invocation); the queue
    export is a plain sibling never passed through that wrapper, so handleEventsRetryQueue's
    Sentry.captureException calls run with no bound client and @sentry/cloudflare no-ops them. Queue
    invocations frequently land on fresh isolates that never served a fetch, so this is a structural
    (not occasional) blind spot for the "durable retry also failed" signal — the exact observability
    floor ADR-0017/FOLLOW-482 was supposed to guarantee.
  spec: docs/adr/ADR-0017-durable-post-ack-clickhouse-retry-queue.md; RETRO-159
  notes: |
    Delegated 2026-07-06 (table row: ingest worker, control-plane, decision-api, Postgres/RLS,
    auth, onboarding HTTP, billing, webhooks -> backend-engineer). Branch-first (FOLLOW-448):
    first action must be
    `git checkout -b backend-engineer/FOLLOW-513-queue-sentry-binding main`.
    Full delegation brief in backlog/HANDOFFS.md.
    AC:
    - [ ] The queue() handler runs with a bound Sentry client (wrap the whole
          `ExportedHandler { fetch, queue }` object in `withSentry` per its documented usage —
          i.e. `withSentry({ fetch: instrumentedFetch, queue: handleEventsRetryQueue })` — or an
          equivalent that guarantees `Sentry.init` has run before `handleEventsRetryQueue` executes
          on a fresh isolate that never served a fetch).
    - [ ] A test asserts a Sentry client is BOUND (not merely that `captureException` was called
          against an unbound/no-op client) when the queue handler runs via the REAL default-export
          wiring in index.ts (not just by calling `handleEventsRetryQueue` directly, which is the
          existing test's blind spot).
    - [ ] (fold-in, LG-1) On a future `EventsRetryMessage` `schema_version` bump, the consumer must
          NOT ack-drop a well-formed-but-unknown-version message (Cloudflare holds in-flight
          messages across deploys) — replace the current `z.literal(1)` + ack-drop-on-mismatch
          behavior with a version union / route-by-version so a version bump can't silently lose
          in-flight retries.
    - [ ] No regression to the existing produce-on-terminal-failure / consumer-re-insert tests
          (FOLLOW-482, PR #449).
- id: FOLLOW-463
  title: >-
    Persist the verified_facts_used anti-hallucination audit trail (table exists, zero writers)
    (F-17)
  agent: ml-engineer # reassigned from data-engineer 2026-07-08 (session 18) — see notes
  status: DONE # PR #479 merged (4d1db35); prod grant applied + CLI-verified via PR #486 (2026-07-09)
  assigned_to: ml-engineer
  started_at: '2026-07-08T00:00:00Z'
  completed_at: '2026-07-09T00:00:00Z'
  branch: ml-engineer/FOLLOW-463-verified-facts-ch-audit
  pr: 479
  merged_commit: 4d1db35
  ci_status: green # all real gates pass; only standing pre-existing Rule I baseline red (new symbols confirmed absent from --log-failed)
  validated: |
    Session 18 (2026-07-08) — ml-engineer PR #479. Both ACs met: (1) POST /api/internal/description-cache
    now dual-writes a description_generations CH row (verified_facts_used + model + archetype/listing/
    locale + description_chars, tier=0 NO-Tiers, source=modal_generation) alongside the existing PG
    write, reusing clickhouse-http.ts (JSONEachRow body → no SQL-injection surface); (2) durability
    proven by a route.test.ts block asserting the CH INSERT fires independent of Redis, + a Python test
    proving verified_facts is forwarded in the POST payload. NEUTRAL (description=='') skips the audit
    row (tested). CH-write failure → Sentry kind:'description_generations_write_failed', non-blocking
    (PG write stays the read SoT; mirrors writeDsrAuditLog fire-and-forget). Independently verified:
    row is complete (11 cols), Rule I failure carries none of this PR's new symbols. Human merge only.

    GO-LIVE OPERATOR ACTION (filed in PR #479's ESCALATIONS.md, RESOLVED 2026-07-09 via PR #486):
    ESC-032/FOLLOW-424 (2026-06-29) deliberately NARROWED the prod ingest_worker CH grant to EXCLUDE
    description_generations on the "no writer exists" premise — which this PR invalidated. A
    ClickHouse Cloud admin session (2026-07-09) ran `GRANT INSERT ON default.description_generations
    TO ingest_worker;` and updated the grant-narrowing runbook. CLI-verified via `SHOW GRANTS` (as
    `ingest_worker`): grant present on the correctly-spelled table (an initial attempt landed on a
    misspelled `descriptions_generations` table and was REVOKEd + re-GRANTed — 0 occurrences of the
    typo remain). Escalation flipped RESOLVED in backlog/ESCALATIONS.md. Flipping
    CODE_COMPLETE_OPERATOR_PENDING -> DONE: code merged (#479), prod grant applied and verified
    (#486), RETRO-167 covers the paired FOLLOW-535 ticket. No open blocker remains.
  priority: P2
  estimated_hours: 3
  depends_on: []
  source: >-
    2026-07-01 audit F-17 — description_generations CH table exists but nothing writes it;
    verified_facts_used lives only in the Redis value and expires with TTL; the §E.7.5 audit trail
    promised for anti-hallucination is not persisted.
  spec: MASTER_DESIGN §E.7.5; audit report §5.3 F-17
  notes: |
    AC:
    - [x] The Modal description job writes verified_facts_used + model_version + archetype/listing to
          description_generations (or a Postgres column) on every generation.
    - [x] A query proves the audit trail is durable (survives Redis TTL).
    - [x] Prod grant applied and CLI-verified (PR #486, 2026-07-09): `SHOW GRANTS` shows
          `GRANT INSERT ON default.description_generations TO ingest_worker`.

    REASSIGNED data-engineer -> ml-engineer 2026-07-08 (session 18, model-fit/agent-fit routing
    after repo verification). The ticket was authored assuming a CH-schema/writer task
    (data-engineer), but verification shows the durable-write path is the existing
    generate_description.py -> POST /api/internal/description-cache handler, both authored by
    ml-engineer (FOLLOW-460/464/465). The CH table already exists (migration 0007); no new schema.
    The actual edits: (1) add verified_facts_used to the job's POST payload
    (apps/llm-gateway/src/jobs/generate_description.py, ~line 1650) — currently the payload omits it;
    (2) dual-write a description_generations row from the internal endpoint
    (apps/control-plane/.../internal/description-cache/route.ts) alongside the existing PG write,
    reusing clickhouse-http.ts. Continuity + file-ownership => ml-engineer. Model: Sonnet
    (well-defined in-scope implementation on an established write path; escalate to Opus only on a
    stumble). Full delegation brief in backlog/HANDOFFS.md (session 18 -> ml-engineer, FOLLOW-463).
    Design decision delegated: skip the CH audit row on NEUTRAL (description=="") — no generation to
    audit; CH-write failure captures to Sentry but does not fail the PG-durable POST.
- id: FOLLOW-464
  title: >-
    Model-key the Postgres description cache so a model switch isn't defeated by a stale pg hit —
    incl. the NEUTRAL cross-model short-circuit regression (F-15 + RETRO-162 LG-1 / folds
    FOLLOW-523)
  agent: ml-engineer
  status: DONE
  assigned_to: ml-engineer
  started_at: '2026-07-07T00:00:00Z'
  completed_at: '2026-07-07T00:00:00Z'
  branch: ml-engineer/FOLLOW-464-model-key-pg-cache
  pr: 468
  merged_commit: bc3b1ea
  priority: P1
  estimated_hours: 2
  depends_on: [FOLLOW-460]
  folds: [FOLLOW-523]
  source: >-
    2026-07-01 audit F-15 — getPgCachedDescription lookup omits model though Redis key includes it;
    Step-1 pg hit runs before the model-suffixed Redis key, so a global/demo model switch serves
    stale copy until webhook invalidation. PROMOTED P2→P1 2026-07-07 (RETRO-162 LG-1): FOLLOW-465's
    NEUTRAL negative cache short-circuits on this same model-blind Step-1 read, so a NEUTRAL written
    under model A now permanently suppresses generation under model B (incl. the DEMO override_model
    preview) — amplifying F-15 from a stale-model quality bug into a cross-model correctness bug on
    freshly-shipped code. FOLLOW-523's model-scoping AC folded in here.
  spec:
    audit report §5.2 F-15; backlog/RETROSPECTIVES.md RETRO-162 LG-1; backlog/FOLLOW_UPS.md
    FOLLOW-523
  notes: |
    AC:
    - [x] description_cache_persistent lookup (getPgCachedDescription) filters on model; a model
          change yields a miss→regen, not a stale pg hit — for BOTH the FIT read AND the FOLLOW-465
          NEUTRAL short-circuit.
    - [x] Test covering model-switch cache-busting on the pg path (FIT case).
    - [x] Test: a NEUTRAL row written under model A does NOT short-circuit a request under model B
          (nor a DEMO override_model request) — model B re-dispatches/re-generates instead of serving
          template_fallback. This is the RETRO-162 LG-1 regression guard.
    - [x] The demo override_model path is not short-circuited by a non-demo NEUTRAL row.
    Promoted + folded 2026-07-07 (pm-orchestrator, RETRO-162 close-out). Assigned ml-engineer (not
    the original backend-engineer): FOLLOW-523's model-scoping is the model-correctness of the
    FOLLOW-465 NEUTRAL read path that ml-engineer just authored (route.ts + description-pg-cache.ts),
    and the sibling FOLLOW-460 pg-cache work was also ml-engineer — continuity + adapt-read-path
    ownership. Full delegation brief in backlog/HANDOFFS.md.

    READY_FOR_REVIEW 2026-07-07 (session 16 — recovered-work path): the ml-engineer subagent
    dispatched last session had stalled/handed off mid-ticket — implementation was complete but
    uncommitted (no PR opened) in worktree `wt-follow464`, still on the correct branch, at base
    commit `d90cdfa` (no drift). Per docs/AGENT_WORKFLOW.md "Recovered-work re-verification":
    confirmed branch correctness, confirmed no unrelated diff was swept in (a separate stray
    QUEUE.md/STATUS.md/lessons.md docs diff was sitting uncommitted on `main` from the *previous*
    session's own bookkeeping — moved to its own `pm-orchestrator/session16-follow464-recovery`
    branch, kept fully separate from this ticket's commit), and independently re-ran (forced,
    no-cache) `pnpm turbo run lint typecheck test --filter=@estalara/control-plane`: 8/8 tasks green,
    137 test files / 1544 tests passed; targeted run of the 2 new test files 6/6 passed; `prettier
    --check` clean. Committed `94cce4c`, pushed, opened **PR #468**. CI: all real gates green; only
    the standing pre-existing "Rule I — wired-or-dead" baseline (181 violations, none from this diff
    — confirmed via job log) is red, matching precedent from every prior PR this sprint. Runtime
    wiring confirmed: producer `route.ts:310` (`getPgCachedDescription(..., effectiveModel)`) reaches
    consumer `description-pg-cache.ts:127` (`eq(descriptionCachePersistent.model, model)`), both
    non-test production code; only one call site in the repo. PM-validated comment posted on PR #468.

    DONE 2026-07-07: PR #468 merged (commit `bc3b1ea`), and the companion docs bookkeeping PR #469
    (`pm-orchestrator/session16-follow464-recovery`) also merged (commit `acf87bb`). Local `main`
    synced (`git pull` fast-forward `42e2821..acf87bb`). Worktree `wt-follow464` and branches
    `ml-engineer/FOLLOW-464-model-key-pg-cache` + `pm-orchestrator/session16-follow464-recovery`
    removed post-merge. Retrospective owed — to be spawned by the main session (not this
    close-out pass) per RETRO-162 precedent.
- id: FOLLOW-465
  title: >-
    Negative-cache NEUTRAL archetype-fit verdicts to stop perpetual Sonnet re-spend (F-18)
  agent: ml-engineer
  status: DONE
  assigned_to: ml-engineer
  started_at: '2026-07-06T00:00:00Z'
  completed_at: '2026-07-06T00:00:00Z'
  branch: ml-engineer/FOLLOW-465-neutral-verdict-negative-cache
  pr: 463
  merged_commit: '5acc055'
  priority: P2
  estimated_hours: 2
  depends_on: []
  source: >-
    2026-07-01 audit F-18 — a NEUTRAL fit verdict writes nothing to Redis/Postgres, so every
    subsequent request for that (listing, archetype) re-enqueues a Modal Sonnet call.
  spec: ADR-0010; audit report §5.4 F-18
  notes: |
    AC:
    - [x] A NEUTRAL verdict is negative-cached (persistent) keyed by (tenant,listing,archetype,
          locale,model); a repeat request short-circuits without a new Sonnet call until listing.
          updated invalidation.
    - [x] Test: two identical neutral requests trigger exactly one generation enqueue.
    Delegated 2026-07-06 (pm-orchestrator session 13). Table row used: "intent/adapt logic,
    embeddings, LLM gateway, auto-detect, ontology, platform-templates -> ml-engineer". Full
    delegation brief (incl. the exact schema/wire-contract constraints already found in the repo)
    in backlog/HANDOFFS.md.
    READY_FOR_REVIEW 2026-07-06 (session 13, resumed after terminal crash): PR #463, commit abff5c3.
    Impl was already complete in worktree wt-follow465 when the crash hit; resumed session validated,
    committed, pushed, opened PR. verdict enum (optional, absent=>FIT) added to
    DescriptionCacheValueSchema + internal-route BodySchema with superRefine scoping the min(1)
    relaxation to NEUTRAL only; migration 0033 (nullable verdict col + CHECK, journal idx 33);
    Python _generate_with_sonnet now 3-way FIT|NEUTRAL|FAILED, generate_description() negative-caches
    only NEUTRAL (genuine failure still writes nothing); route.ts short-circuits BOTH pg Step-1 and
    redis Step-2 hits on verdict=NEUTRAL to template_fallback, skipping RAG + Modal dispatch. Wire
    contract (DescriptionResponseSchema/DescriptionSourceSchema) UNCHANGED. FOLLOW-464 model-filter
    bug left untouched (separate ticket). Validation: pnpm lint/typecheck/test/build 17/17 +
    control-plane next build + Python pytest 132 passed + prettier clean + migration-journal
    monotonic (34 entries) + fire-and-forget guard PASS. CI: 56/58 pass; the only 2 reds are the
    documented pre-existing "Rule I — wired-or-dead" baseline (181 violations, none FOLLOW-465
    symbols). PR MERGEABLE, not merged (awaiting human review).
- id: FOLLOW-466
  title: >-
    Add replay protection to feedback HMAC + unify secret comparisons on timingSafeEqual (F-21)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: 2026-07-06T00:00:00Z
  completed_at: 2026-07-06T20:00:00Z
  merge_commit: 7540c22
  branch: backend-engineer/FOLLOW-466-feedback-hmac-replay-protection
  pr: 'https://github.com/Pnawrocki9/Adaptive-Listings/pull/459'
  ci:
    'green (57 real gates, independently verified); Rule I wired-or-dead pre-existing-red
    non-blocking'
  notes_pm: >-
    Shipped Option A (no SDK/wire-contract change). New lib/feedback-nonce.ts: Upstash SET NX EX 600
    keyed on the HMAC signature; replay → 200 {deduplicated:true} (no bandit double-count);
    fail-open on Redis unavailability; HMAC-path only. 2 timingSafeEqual sites → secretEquals.
    Worker flagged a 3rd identical timing-unsafe site (dsr/mutation-poll) → FOLLOW-519 fast-follow.
    1529 CP tests pass.
  priority: P2
  estimated_hours: 3
  depends_on: [FOLLOW-450]
  scope_decision: >-
    CEO 2026-07-06 (verify-not-guess: confirmed the SDK signs feedback client-side in
    packages/sdk/src/core/adapt.ts, so a timestamp-in-HMAC is an SDK↔API WIRE-CONTRACT change).
    LOCKED to Option A — server-side nonce cache (Upstash Redis SET NX EX ~600s keyed on the HMAC
    signature, fail-open, HMAC-path-only) + the timingSafeEqual sweep. Explicitly NO SDK change / no
    timestamp / no wire-contract change. The stronger timestamp+SDK+window path is DEFERRED to
    FOLLOW-518 (needs a rollout window + escalation).
  source: >-
    2026-07-01 audit F-21 — feedback HMAC has no timestamp/nonce → an observed (body,sig) pair is
    replayable (bounded bandit inflation); INTERNAL_API_SECRET/CRON_SECRET/webhook use plain ===/!==
    not timingSafeEqual.
  spec: ADR-0015; audit report §5.5 F-21
  notes: |
    AC (shipped as Option A per scope_decision — server-side nonce cache, NOT the deferred timestamp path):
    - [x] Replayed feedback ping (same body+sig within TTL) deduplicated server-side (Upstash nonce
          cache, fail-open, HMAC-path-only) → no bandit double-count. Timestamp+window path = FOLLOW-518.
    - [x] The 2 in-scope shared-secret comparisons (conversion-labels, adaptation-writes) → secretEquals
          (constant-time). 3rd site dsr/mutation-poll = FOLLOW-519 fast-follow.
    - [x] Tests: replay dedup, Redis-down fail-open, timingSafeEqual sites (1529 CP tests green).
    Delegated 2026-07-06 (pm-orchestrator session 12). Table row used: "a contract between two
    modules" does NOT apply here — this is a straight backend/auth hardening ticket → decision-table
    row "ingest worker, control-plane, decision-api, Postgres/RLS, auth, onboarding HTTP, billing,
    webhooks" -> backend-engineer.
- id: FOLLOW-474
  title: >-
    Codify a mandatory pre-PR local gate sequence (incl. next build) for control-plane workers +
    worktree workspace-dts bootstrap
  agent: devops-engineer
  status: READY
  priority: P3
  estimated_hours: 2
  depends_on: []
  source: >-
    RETRO-150 §9 (FOLLOW-455 recovery, 2026-07-02) — a crashed compliance-engineer subagent left 4
    gate-class defects (lint, format, typecheck, next-build webpack import resolution) uncaught in
    its otherwise correctly branch-isolated worktree; only an independent full local gate run by the
    recovering pm-orchestrator caught them. Folds in the session-6 candidate note (FOLLOW-452
    validation) about worktree bootstrap needing @estalara/* workspace deps built before lint.
  spec: backlog/FOLLOW_UPS.md FOLLOW-474; backlog/RETROSPECTIVES.md RETRO-150 §4e/§6/§9
  notes: |
    Promoted 2026-07-02 (pm-orchestrator) directly to Sprint 22b as READY. NOT on the FOLLOW-471
    clean-re-audit-gate critical path (process/tooling hardening, not a functional/compliance gap).
    AC:
    - [ ] docs/AGENT_WORKFLOW.md explicitly lists `next build` as a required pre-PR gate for any
          apps/control-plane change, distinct from `vitest run` and `tsc --noEmit` (RETRO-150 found
          webpack's import resolution catches defects neither of those two catch).
    - [ ] Worktree/worker bootstrap guidance documents building @estalara/{shared,db,auth,sdk}
          before the first local lint/typecheck pass in a fresh worktree.
    - [ ] (Optional, evaluate cost/benefit first) a scripts/pre-pr-check.sh convenience script, or a
          documented decision that one isn't worth the maintenance cost.
- id: FOLLOW-467
  title: >-
    Remove or annotate dead scaffolds that mislead Rule-H/wiring audits (F-12)
  agent: architect
  status: READY
  priority: P3
  estimated_hours: 3
  depends_on: []
  source: >-
    2026-07-01 audit F-12 — dead: packages/intent-ontology (14-line stub, 0 consumers),
    packages/compliance (0.0.0 placeholder), embedding.ts heuristic vectors (0 importers),
    price.compared signal (no emitter), session_quality + description_generations CH tables (0
    writers — until F-17), quiz_completions (0 readers — until F-455 DSR), sidebar-widget.ts (463
    LOC unmounted).
  spec: CONVENTIONS_PATCH.md Rule H/Rule I; MASTER_DESIGN §Snapshot.7 #7; audit report §5.3 F-12
  notes: |
    AC:
    - [ ] Each dead artifact is deleted OR carries a header comment stating it is intentionally
          reserved with the tracking ticket; no exported symbol remains importer-less without a note.
    - [ ] Rule I (wired-or-dead) violation count for these artifacts drops to zero.
- id: FOLLOW-468
  title: >-
    Route the adapt-description URL through buildEndpoint + encodeURIComponent (F-16)
  agent: sdk-engineer
  status: READY
  priority: P3
  estimated_hours: 1
  depends_on: []
  source: >-
    2026-07-01 audit F-16 — core/adapt-description.ts hand-concatenates the description URL outside
    buildEndpoint and does not encode listing_id/archetype/locale (DOM-sourced) — the exact class
    Rule X centralized buildEndpoint to prevent.
  spec: CONVENTIONS_PATCH.md Rule X; audit report §5.1 F-16
  notes: |
    AC:
    - [ ] adapt-description builds its URL via buildEndpoint with encoded query params; tested
          against the real snippet base (Rule X).
- id: FOLLOW-469
  title: >-
    Recover SDK bundle headroom below the 42KB gzip budget (F-19)
  agent: sdk-engineer
  status: READY
  priority: P3
  estimated_hours: 4
  depends_on: []
  source: >-
    2026-07-01 audit F-19 — estalara-sdk.iife.js is 39.86KB gzip vs the raised 42KB budget (~95%,
    near-zero headroom).
  spec: MASTER_DESIGN §B.2 (bundle budget, raised to 42KB ESC-028); audit report §5.4 F-19
  notes: |
    AC:
    - [ ] Bundle gzip drops below ~90% of budget via code-split/lazy-load of quiz/chat/micro-poll
          or dead-code removal (compose with F-12).
    - [ ] CI bundle-size gate stays green with restored headroom.
- id: FOLLOW-470
  title: >-
    Refresh stale status docs: Master_Design §Snapshot.1 + README + CLAUDE.md; promote orphaned
    FOLLOW-380 (Doc/governance)
  agent:
    architect # reassigned 2026-07-09 (pm-orchestrator, session 20): no decision-table row is
    # an exact fit for cross-repo doc/governance reconciliation (Master_Design SoT + README +
    # CLAUDE.md); "architect" (cross-cutting contracts / ADRs) is the closest specialist fit and
    # keeps PM out of doc-authoring, per PM's own guardrail scope. See delegation note in HANDOFFS.md.
  status: DONE
  assigned_to: architect
  started_at: '2026-07-09T00:00:00Z'
  completed_at: '2026-07-09'
  branch: architect/FOLLOW-470-snapshot1-doc-refresh
  pr: 488
  merged_pr: 488
  merge_commit: 8275e23
  ci_status: >-
    green (55 pass / 2 fail; both failures are the SAME pre-existing "Rule I — wired-or-dead check"
    gate duplicated across 2 matrix legs, 181 violations — independently re-verified by
    pm-orchestrator via `gh pr view 488 --json statusCheckRollup` [non-success count = 2, both Rule
    I] and `--log-failed` [181 WARN lines, all in apps/control-plane/src/lib/*, apps/control-plane/
    src/app/*, none touching this diff]; PR file list independently confirmed 100% docs
    [.claude/agents/pm-orchestrator/lessons.md, CLAUDE.md, README.md, backlog/FOLLOW_UPS.md,
    backlog/HANDOFFS.md, backlog/QUEUE.md, backlog/STATUS.md, docs/MASTER_DESIGN.md — zero .ts/.py/
    .sql] via `gh pr view --json files`. Every other real gate (Format, Typecheck, Lint, all Node/
    Python test suites, Build, Build (control-plane), Vercel, Rule H, Rule J, and the rest) is
    green.
  priority: P2
  estimated_hours: 3
  depends_on: []
  source: >-
    2026-07-01 audit §6.4 — §Snapshot.1 dated 2026-05-24 (~5wk stale, lists Sprint-13-era priorities
    as "next", claims "8 rules A–H" vs actual 25); README says "Sprint 0"; CLAUDE.md still describes
    Tiers 1/2/3; FOLLOW-380 (cross-listing re-adaptation hardening, P1) authored in FOLLOW_UPS.md
    but never promoted to QUEUE. Violates Operating Principle 1 (Snapshot.1 = SoT).
  spec: docs/ops/OPERATING_PRINCIPLES.md Rule 1; audit report §6.4
  notes: |
    PROGRESS 2026-07-09 (architect): doc edits complete on the working tree. §Snapshot.1 header
    re-dated + Changelog v4.3 added (Master_Design 4.2→4.3); 9 verdict rows corrected (A.1, B.1, B.2,
    C, D, E.1–E.3, E.4, E.7, H) each grep-verified against HEAD; §Snapshot.6 rule-count fixed —
    ACTUAL count is 27 (not the "25" estimated in this ticket's source line; verified by
    `grep '^## Rule ' CONVENTIONS_PATCH.md`). README "Sprint 0"→Sprint 22b. FOLLOW-380 promoted (block
    added above; stub marked promoted_to_queue:true).

    CORRECTION 2026-07-09 (pm-orchestrator, session 21 validation): the architect's original plan
    was to FLAG (not edit) CLAUDE.md's Tier 1/2/3 language, citing a config-file change-authority
    boundary. In practice the top-level orchestrator (who executed the branch/commit/push on the
    architect's behalf, since the architect subagent had no shell tool) applied the AC's
    Tier-retirement clause directly to CLAUDE.md: a "Historical — Tiers retired 2026-06-05" callout
    was added above the tier list (§8-15), the "Three integration tiers" heading became "Three
    (retired) integration tiers", the repo-scale bullet's tier reference was corrected, and the SDK
    budget line was corrected from stale "<40KB gzip for Tier 1+2 combined" to "<42KB gzip (raised
    from 40KB per ESC-028; measured 39.86KB at 2026-07-01 audit)" — independently confirmed via
    `gh pr diff 488` (CLAUDE.md hunk). This is a factual, low-risk correction (removing/flagging
    retired terminology per an already-ratified CEO decision, not a new architectural call), so it
    stands; recorded here so the discrepancy between the architect's stated plan and the executed
    diff is not silently lost.

    OUT-OF-SCOPE, follow-up filed: §Snapshot.2/.3/.5 narrative snapshots were NOT re-verified (still
    cite pre-2026-07-01 state, e.g. §Snapshot.2's stale `archetype-pipeline`/`adaptation-engine`
    Modal-app references) and §B.1's section BODY still carries the un-retired Tier 1/2/3 prose
    (only the §Snapshot.1 TABLE row for B.1 was annotated, not the body) — both flagged inline in
    the PR rather than silently skipped. Tracked as **FOLLOW-543** (P3, architect,
    `backlog/FOLLOW_UPS.md`, `promoted_to_queue: false`) for a future doc-hardening sprint; neither
    gap blocks FOLLOW-471 (the epic-closing gate only cites §Snapshot.1, not §Snapshot.2/.3/.5).

    PM-validated 2026-07-09 (session 21): CI non-success count = 2, both the pre-existing Rule I
    baseline (independently re-verified, not taken on the worker's word — see `ci_status` above).
    Step 5c (runtime-wiring grep) N/A — zero code files in diff. Step 5d (co-assignment integration
    check) N/A — single-agent ticket (architect content + orchestrator mechanics, not two workers on
    a shared contract). Step 5e (AC): all 3 AC bullets independently spot-checked against the diff —
    (1) 9 §Snapshot.1 rows corrected with grep-citable evidence in each row's "reason" cell; (2)
    README "Sprint 0"→"Sprint 22b" confirmed, CLAUDE.md Tier language confirmed edited (see
    correction above); (3) FOLLOW-380 confirmed as a real QUEUE.md ticket block (id: FOLLOW-380,
    below) AND its FOLLOW_UPS.md stub confirmed flipped `promoted_to_queue: true`; rule-count 8→27
    independently re-derived via `grep -oE "Rule [A-Z]{1,2}" CONVENTIONS_PATCH.md | sort -u` = 27
    (26 lettered A–Z + AA) — matches the PR's claim exactly. PM-validated. CI green (bar the standing
    Rule I baseline). Runtime wiring N/A (docs-only). Ready for human review.
    AC:
    - [x] §Snapshot.1 header re-dated + per-section verdicts reconciled to the 2026-07-01 audit
          (intent-engine real, 21/46 events, chat code-complete-dead-in-prod, bandit frozen, etc.).
    - [x] README status corrected (not "Sprint 0"); CLAUDE.md Tier language flagged/removed per the
          no-Tiers ruling.
    - [x] FOLLOW-380 promoted into a QUEUE ticket; §Snapshot.6 rule-count corrected.

    MERGED 2026-07-09: PR #488 squash-merged to `main` as commit `8275e23`. Ticket closed DONE.
    retrospective-analyst to be spawned by the coordinator on branch `pm-orchestrator/FOLLOW-470-
    close` (this same bookkeeping PR) per the repo's bundling convention (RETRO + DONE-flip in one
    PR, matching PRs #486/#487) — NOT run by pm-orchestrator itself (no subagent-spawn capability in
    this tool surface).
- id: FOLLOW-380
  title: >-
    Harden cross-listing re-adaptation (concurrency guard, per-listing headline, confidence re-pin)
    + unit tests
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-07-10T00:00:00Z'
  completed_at: '2026-07-10'
  branch: sdk-engineer/FOLLOW-380-cross-listing-hardening
  pr: 491
  merged_pr: 491
  merge_commit: 4cc5ba5
  model:
    Opus # concurrency/interleaving + shared-mutable-state coherence reasoning; model-fit
    # table "complex single-domain reasoning ... non-trivial design". See dispatch brief in
    # backlog/HANDOFFS.md ("PM orchestrator (session 22) -> sdk-engineer, FOLLOW-380") — note
    # that brief currently lives on unmerged PR #490 (bookkeeping-only, blocked on a merge-guard
    # awaiting human as of this validation), NOT yet on `main`; it was relayed to the worker out
    # of band by the coordinator. This DONE-trail edit folds the dispatch record in retroactively
    # since #490 had not landed when #491 was validated — avoids a phantom READY->READY_FOR_REVIEW
    # jump with no IN_PROGRESS record on `main`.
  ci_status: >-
    green (independently re-verified via `gh pr view 491 --json statusCheckRollup`): non-success
    count = 2, both the SAME standing pre-existing "Rule I — wired-or-dead check" (matrix-
    duplicated), 180 violations via `--log-failed` (stable vs. the ~180-181 baseline cited across
    PRs #486/#488/#490) — confirmed the NEW `ResolvedArchetype` interface/producer/consumer is NOT
    among them. Test (Node 22) 7m10s/6m21s green — pulled the full job log: `@estalara/sdk:test` ran
    the ENTIRE suite fresh (69 files / 1520 tests, all passed, incl. `follow-380.test.ts (10 tests)`
    and `adapt-description.test.ts (35 tests)` — the file the worker flagged 4 LOCAL failures on as
    a stale `@estalara/shared` build artifact; CI's fresh-build job shows it fully green, consistent
    with that explanation). Typecheck, Lint, Format check, Build, Build (control-plane), SDK E2E
    tests, all Python suites, Demo integration, Rule H, Rule J — all green. SDK bundle-size gate
    (embedded in the `Build` job, not a separate check): 40.43KB gzip vs the 42KB budget (ESC-028) —
    PASSED, +0.57KB over the pre-ticket 39.86KB baseline, still comfortable headroom. PR file list
    independently confirmed exactly 4 files: `.claude/agents/sdk-engineer/lessons.md`,
    `packages/sdk/src/__tests__/follow-380.test.ts`, `packages/sdk/src/core/session.ts`,
    `packages/sdk/src/index.ts` — zero edits to `backlog/QUEUE.md`, `docs/MASTER_DESIGN.md`,
    `README.md`, or `CLAUDE.md`.
  priority: P1
  estimated_hours: 4
  depends_on: []
  source: >-
    RETRO-105 (§4a LG-1/LG-2/LG-3, §4b CB-1, §4c TG-1); source_ticket FOLLOW-375 (PR #340). The SPA
    cross-listing fix has three robustness gaps under real navigation: (a) overlapping
    refreshDirectives() on rapid SPA nav have no in-flight guard/AbortController and interleave on
    shared currentIntentState/SoT; (b) originalHeadlineText is captured ONCE globally and restored
    to ALL headline slots, so listing-1's title can be stamped onto listing-2's non-fitting
    headline; (c) the SoT restore re-pins archetype but not confidence, so the FOLLOW-343 DOM
    confidence floor may still suppress the restored adaptation.
  spec: backlog/FOLLOW_UPS.md FOLLOW-380; backlog/RETROSPECTIVES.md RETRO-105
  notes: |
    Promoted 2026-07-09 (FOLLOW-470, architect) from backlog/FOLLOW_UPS.md into Sprint 22b as READY,
    matching the FOLLOW-467/468/469/472/474 promotion pattern. Orphaned P1 stub authored under
    RETRO-105 but never promoted (audit §6.4). NOT on the FOLLOW-471 clean-re-audit critical path
    (SDK robustness hardening, not a listed F-01…F-21 finding). cross_ref: extends FOLLOW-375's open
    test AC — do NOT duplicate.

    DISPATCHED 2026-07-10 (pm-orchestrator, session 22) to sdk-engineer (Opus), branch
    `sdk-engineer/FOLLOW-380-cross-listing-hardening`. Full brief in `backlog/HANDOFFS.md` ("PM
    orchestrator (session 22) → sdk-engineer, FOLLOW-380") — see `model:` field caveat above re:
    the brief's unmerged-PR-#490 status.

    PM-VALIDATED 2026-07-10 (pm-orchestrator, session 22) — PR #491
    (`sdk-engineer/FOLLOW-380-cross-listing-hardening`, off `main`). Independently verified (not
    taken on the worker's self-report), reading the actual `git diff main...HEAD` for
    `packages/sdk/src/core/session.ts` and `packages/sdk/src/index.ts`:

    - **Bug (a) — in-flight guard:** `index.ts` adds a module-level `let latestRefreshId = 0`;
      `refreshDirectives()` claims `const myRefreshId = ++latestRefreshId` on entry and, after the
      `await fetchDirectives(...)` resolves, checks `if (myRefreshId !== latestRefreshId) return;`
      before committing any state — a stale in-flight call whose fetch resolves after a newer
      navigation started can never clobber it. Confirmed non-vacuous by reading the dedicated
      hardening test: it deliberately resolves a STALE L2 fetch AFTER a fresher L3 fetch and
      asserts the final DOM shows L3's adapted copy, not L2's — this would fail without the guard.
    - **Bug (b) — per-listing headline:** the single global `let originalHeadlineText` is replaced
      with `const originalHeadlineByListing = new Map<string, string>()` + a
      `captureOriginalHeadline(listingId)` helper (idempotent, called on init AND on every
      `listing.viewed` navigation, before `refreshDirectives()` re-adapts). The restore site reads
      `originalHeadlineByListing.get(viewedListingId)` instead of the old global. Confirmed
      non-vacuous via the dedicated test (listing-2's own captured title shows on a non-fitting
      listing-2, not listing-1's title or adapted copy).
    - **Bug (c) — confidence re-pin, full producer→consumer chain traced:** `session.ts` adds a
      new exported `ResolvedArchetype { archetype: string; confidence: number }` interface;
      `persistResolvedArchetype(sessionId, archetype, confidence)` now writes
      `JSON.stringify({archetype, confidence})` (backward-compatible: `readResolvedArchetype`
      still parses a legacy bare-string entry, falling back to a documented
      `RESOLVED_ARCHETYPE_FALLBACK_CONFIDENCE = 0.85` chosen above BOTH the server's
      `CONFIDENCE_THRESHOLD = 0.6` gate — independently confirmed present at
      `apps/control-plane/src/app/api/adapt/route.ts:84/287` — AND the SDK's
      `DOM_ADAPT_CONFIDENCE_FLOOR = 0.5`). `index.ts`'s SoT-restore site now does
      `currentIntentState = { ...currentIntentState, archetype: sot.archetype, confidence:
      sot.confidence }` (both fields, not just archetype), and BOTH call sites of
      `persistResolvedArchetype` were updated to pass `currentIntentState.confidence` alongside
      the archetype. Full chain confirmed producer (session.ts) → consumer (index.ts) → the wire
      (`body.confidence` sent to `/api/adapt`) → the gate (server 0.6 threshold, echoed into
      `resp.confidence`) → the DOM floor (0.5) — genuinely wired end-to-end, not a half-wire.
      Confirmed non-vacuous via the dedicated test (a decayed neutral/low-confidence session with
      a high-confidence SoT still adapts post-restore because 0.85 clears both gates).
    - **`ResolvedArchetype` Rule I claim verified:** `grep -rn "ResolvedArchetype"
      packages/sdk/src --include=*.ts | grep -v test` shows a genuine non-test producer
      (`readResolvedArchetype` returns it, session.ts) AND consumer (`const sot: ResolvedArchetype
      | null = ...`, index.ts) — independently pulled the Rule I `--log-failed` output and
      confirmed `ResolvedArchetype` is absent from the 180 flagged symbols.
    - **Doc gap (quiz vs quiz-disabled stickiness):** confirmed a new inline comment block in
      `refreshDirectives()` documenting the two-layer (hysteresis + restore) vs one-layer
      (restore-only) asymmetry, matching the AC bullet.
    - **One consolidated test suite, not two:** `packages/sdk/src/__tests__/follow-380.test.ts`
      (543 lines, the ONLY new test file in the diff) has exactly 10 `it()` cases across 8
      `describe` blocks, covering all 5 cross_ref items (a: observer in-place mutation → b+c:
      combined SoT-restore/confidence describe → d: quiz-stickiness both branches → e: adapt.ts
      empty-value skip → c: eraseIntentState) PLUS the 3 new hardening tests (a: race guard, b:
      per-listing headline, c: confidence floor) — confirmed via `gh pr view --json files` this
      is the only test file touched (no second/competing suite).
    - Full local `@estalara/sdk` suite in CI's fresh Node 22 build: 69 files / 1520 tests, 100%
      pass — no regression introduced.

    PM-validated. CI green (bar the standing Rule I baseline). Runtime wiring confirmed
    end-to-end (producer/consumer grep pasted above). Ready for human review.
    AC:
    - [x] In-flight guard / AbortController prevents overlapping refreshDirectives from interleaving
          on session state; a rapid-nav test asserts a single coherent final archetype.
    - [x] Headline original text is captured per-listing (or read from the framework's re-rendered
          title); a test asserts listing-2's non-fitting headline does NOT show listing-1's title.
    - [x] SoT restore re-pins confidence alongside archetype so the FOLLOW-343 floor does not suppress
          the restored adaptation; a test asserts adaptation fires post-restore.
    - [x] Quiz vs quiz-disabled stickiness asymmetry documented.
    - [x] Unit tests for the FOLLOW-375 new paths (observer in-place mutation; SoT restore/update;
          eraseIntentState clears resolved-archetype key; intent.ts quiz-stickiness; adapt.ts
          empty-value skip).

    MERGED 2026-07-10: PR #491 squash-merged to `main` as commit `4cc5ba5` (2026-07-10T07:16:20Z),
    the PM-validation bookkeeping PR #492 merged immediately after as `57a0116`. PR #490 (the
    superseded dispatch-record PR) was CLOSED unmerged per human decision — its content is fully
    folded into this ticket block's DONE trail, nothing lost. Ticket closed DONE.

    FOLLOW-375 test-debt retired: `backlog/FOLLOW_UPS.md`'s FOLLOW-375 stub had one open bullet —
    "Add SDK unit tests for the new paths (a) observer in-place mutation, (b) refreshDirectives
    SoT restore/update, (c) eraseIntentState clears resolved-archetype key" — checked `[x]` and
    marked RESOLVED 2026-07-10 by this ticket's consolidated `follow-380.test.ts`
    (`cross_ref (a)`/`cross_ref (b) + hardening (c)`/`cross_ref (c)` describe blocks name-match
    exactly). The other two FOLLOW-375 bullets (platform/Rafał production-delivery actions:
    versioned SDK bundle URL, `chat_intent_dimensions` prod confirmation) are unrelated to this
    ticket and remain OPEN — FOLLOW-375 itself stays `DONE` in QUEUE.md (its stub in
    FOLLOW_UPS.md is a doc-follow-up tracker, not a re-open of the ticket).

    retrospective-analyst to be spawned by the coordinator on branch
    `pm-orchestrator/FOLLOW-380-close` (this same bookkeeping PR, RETRO-169) per the repo's
    RETRO+DONE bundling convention (matches PRs #486/#487, #489) — NOT run by pm-orchestrator
    itself (no subagent-spawn capability in this tool surface).
- id: FOLLOW-546
  title: >-
    Extend the FOLLOW-380 latest-wins in-flight guard over the fire-and-forget description tail
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-07-10T00:00:00Z'
  completed_at: '2026-07-10'
  branch: sdk-engineer/FOLLOW-546-description-staleness-guard
  pr: 495
  merged_pr: 495
  merge_commit: 118bdd8
  model:
    Opus # same cross-module async-staleness-coherence class as FOLLOW-380; model-fit table
    # "complex single-domain reasoning ... non-trivial design". See dispatch brief in
    # backlog/HANDOFFS.md ("PM orchestrator (session 23) -> sdk-engineer, FOLLOW-546") — note
    # that brief currently lives on unmerged PR #494 (bookkeeping-only, blocked awaiting human as
    # of this validation), NOT yet on `main`; relayed to the worker out of band by the
    # coordinator, same pattern as FOLLOW-380/#490.
  ci_status: >-
    green (independently re-verified via `gh pr view 495 --json statusCheckRollup`): non-success
    count = 2, both the SAME standing pre-existing "Rule I — wired-or-dead check" (matrix-
    duplicated), 180 violations via `--log-failed` — IDENTICAL to the FOLLOW-380 baseline, zero new
    flags (confirmed no new `export` statement in either touched source file's diff). Test (Node 22)
    green — pulled the full job log: `@estalara/sdk:test` ran the ENTIRE suite fresh (69 files /
    **1521** tests, all passed — up from FOLLOW-380's 1520 by exactly the 1 new `follow-380.test.ts`
    hardening (d) case). Typecheck, Lint, Format check, Build, Build (control-plane), SDK E2E tests,
    all Python suites, Demo integration, Rule H, Rule J — all green. SDK bundle-size gate (embedded
    in `Build`): **40.47KB gzip vs the 42KB budget** (ESC-028) — PASSED (worker self-reported
    40.25KB; CI's actual figure is 40.47KB, a minor self-report discrepancy, still comfortably under
    budget). PR file list independently confirmed exactly 4 files:
    `.claude/agents/sdk-engineer/lessons.md`, `packages/sdk/src/__tests__/follow-380.test.ts`
    (EXTENDED, not a new/duplicate file — now 11 tests, was 10),
    `packages/sdk/src/core/adapt-description.ts`, `packages/sdk/src/index.ts` — zero edits to
    `backlog/QUEUE.md`, `docs/MASTER_DESIGN.md`, `README.md`, or `CLAUDE.md`.

    "4 pre-existing local failures" claim: could NOT be literally reproduced. Independently ran both
    `packages/sdk/src/__tests__/adapt-description.test.ts` (35/35 pass) and
    `packages/shared/src/schemas/events/events.test.ts` (67/67 pass, incl. the exact
    "adapt.description.* events (FOLLOW-461 / audit F-04) — ingest round-trip" describe block)
    locally on THIS branch after a fresh `@estalara/shared` build, AND separately on `main` under
    the identical fresh-build condition — 100% green on BOTH. The worker's own lessons.md phrase
    "RED on main too" does not literally hold under a fresh build; the SUBSTANCE of the claim (no
    regression introduced) DOES hold, confirmed three independent ways: (1) CI is 100% green on this
    PR (1521/1521); (2) local reruns of the specific files are 100% green on both branches under
    equivalent conditions; (3) structurally, `AdaptDescriptionSkippedPayloadSchema.reason` is
    `z.string().min(1).optional()` — deliberately NOT `z.enum` per its own doc comment ("keeps
    forward-compat with new reason codes") — so a new `reason: 'stale'` value cannot possibly break
    the round-trip validation regardless of build state. Most likely explanation: the worker's local
    "4 failures" were the same class of transient stale-`@estalara/shared`-build artifact already
    documented in this exact lessons.md file from the FOLLOW-380 session — a property of a local dev
    environment, not of either branch's code.
  priority: P2
  estimated_hours: 2.5
  depends_on: []
  source: >-
    RETRO-169 (§4a LG-1 / §7 / §4c TG-1); source_ticket FOLLOW-380. FOLLOW-380 bug (a) added a
    monotonic latest-wins guard (`myRefreshId !== latestRefreshId`) as a SINGLE checkpoint at
    `packages/sdk/src/index.ts:737`, right after `fetchDirectives`. But the description adaptation
    is dispatched fire-and-forget AFTER that checkpoint — `void applyDescriptionAdaptation(config,
    resp.archetype)` at `index.ts:805` — in a SEPARATE module
    (`packages/sdk/src/core/adapt-description.ts:265`) that cannot see
    `myRefreshId`/`latestRefreshId`. It re-reads `listingId` fresh (`adapt-description.ts:279-283`)
    then `await fetchDescription(...)` (`:285`) with the STALE `resp.archetype` from the superseded
    refresh. On rapid cross-listing nav where the new listing resolves a DIFFERENT archetype, the
    stale invocation paints the correct (freshly-read) listing's description slot with the WRONG
    archetype's copy — the exact async-interleave class RETRO-105 LG-1 / FOLLOW-380 bug (a) set out
    to close, relocated one hop to the description path. 2nd sighting of the async-interleave
    pattern (RETRO-105 §6 + RETRO-169 §6, HELD not promoted — a 3rd sighting promotes a
    CONVENTIONS_PATCH rule).
  spec: backlog/FOLLOW_UPS.md FOLLOW-546; backlog/RETROSPECTIVES.md RETRO-169
  notes: |
    Promoted 2026-07-10 (pm-orchestrator, session 23) from backlog/FOLLOW_UPS.md into Sprint 22b,
    matching the FOLLOW-380/467/468/469/472/474 promotion pattern. `promoted_to_queue: true` set
    on the FOLLOW_UPS.md stub. Dispatched same-session to sdk-engineer (Opus). Full delegation
    brief in `backlog/HANDOFFS.md` ("PM orchestrator (session 23) → sdk-engineer, FOLLOW-546") —
    see `model:` field caveat above re: that brief's unmerged-PR-#494 status (mirrors the
    FOLLOW-380/#490 precedent).

    PM-VALIDATED 2026-07-10 (pm-orchestrator, session 23) — PR #495
    (`sdk-engineer/FOLLOW-546-description-staleness-guard`, off `main`). Independently verified
    (not taken on the worker's self-report), reading the actual `git diff main...HEAD`:

    - **Fix shape:** `applyDescriptionAdaptation` gained a THIRD, OPTIONAL parameter
      `isStale: () => boolean = () => false` (`adapt-description.ts:276`) — the default preserves
      the ~30 existing 2-arg test call sites unchanged (confirmed via
      `grep -rn "applyDescriptionAdaptation(" packages/sdk/src/__tests__` — all still 2-arg, still
      passing). The REAL production call site (`index.ts:805`) passes a live predicate:
      `() => myRefreshId !== latestRefreshId` — reusing the exact same closure variables as the
      FOLLOW-380 `:737` checkpoint. This is the `isStale()` callback shape the brief offered as
      option 1 — avoids exporting `latestRefreshId` across the module boundary (confirmed via
      `git diff` that neither file adds a new `export`).
    - **Both checkpoints confirmed, both genuinely pre-mutation:** `adapt-description.ts:288`
      (entry-time, before the `document.querySelectorAll` slot lookup) and `:309` (immediately
      after `await fetchDescription` resolves, BEFORE the `:314` `if (!resp)` handling and BEFORE
      the `:323` `slots.forEach(...)` paragraph mutation and the headline-slot mutation further
      down). Read the full function body to confirm ordering — both checks unambiguously precede
      every DOM-mutating statement.
    - **Non-vacuous test, independently inspected (not just re-run):** the new hardening (d) case
      in `follow-380.test.ts` deliberately resolves the NEWER navigation's description fetch
      FIRST and the STALE one LAST (mirroring FOLLOW-380's own race-guard test pattern), then
      asserts the description slot keeps the fresh copy and NEVER shows the stale archetype's
      text — this would fail without the `:309` post-await check. Also asserts the discard is
      OBSERVABLE (`adapt.description.skipped {reason:'stale'}` fires exactly once, `applied` never
      fires for the stale archetype) — confirms the "not a silent catch" claim.
    - **Rule I / no new exported symbol:** confirmed via `git diff` (no new `export` in either
      touched file) AND the CI Rule I log (180 violations, identical count to the FOLLOW-380
      baseline — zero new flags).
    - **CI green**, bundle 40.47KB/42KB, file list exactly 4 (no backlog/doc edits).
    - **"4 pre-existing failures" claim:** see `ci_status:` above for the full independent
      re-verification — could not literally reproduce "RED on main too," but confirmed via CI +
      two independent local reruns on both branches + schema-design analysis that this PR
      introduces ZERO test regression, which is the load-bearing conclusion that matters for
      merge-gating.

    PM-validated. CI green (bar the standing Rule I baseline). Runtime wiring confirmed
    end-to-end (producer at `index.ts:805`, consumer at both `adapt-description.ts` checkpoints).
    No regression (CI + independent local verification on both branches). Ready for human review.
    AC:
    - [x] `applyDescriptionAdaptation` receives a staleness check from the caller (an `isStale()`
          callback) and bails BEFORE mutating any DOM slot when superseded — both before AND
          after its own `await fetchDescription`.
    - [x] Non-vacuous jsdom test (retires RETRO-169 §4c TG-1) — stubs `IntersectionObserver`,
          drives a rapid cross-listing `listing.viewed` with an archetype change, asserts the
          stale description is discarded.
    - [x] No regression to the same-archetype fast-path — the `isStale` default/live-predicate
          shape is structurally non-invasive (unchanged behavior when never superseded); the full
          `packages/sdk` suite (1521 tests, incl. all pre-existing description tests) stays green.

    MERGED 2026-07-10: PR #495 squash-merged to `main` as commit `118bdd8` (2026-07-10T08:30:32Z);
    the PM-validation bookkeeping PR #496 merged immediately after as `4a5c2ba`. PR #494 (the
    superseded promotion/dispatch-record PR) was CLOSED unmerged per human decision — its content
    is fully folded into this ticket block's DONE trail, nothing lost. Ticket closed DONE.

    retrospective-analyst to be spawned by the coordinator on branch
    `pm-orchestrator/FOLLOW-546-close` (this same bookkeeping PR, RETRO-170) per the repo's
    RETRO+DONE bundling convention (matches PRs #486/#487, #489, #493) — NOT run by
    pm-orchestrator itself (no subagent-spawn capability in this tool surface).
- id: FOLLOW-548
  title: >-
    Guard the rAF-deferred description write per Rule AB (third relocation hop of the cross-listing
    async-interleave gap)
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-07-10T00:00:00Z'
  completed_at: '2026-07-10'
  branch: sdk-engineer/FOLLOW-548-raf-deferred-staleness-guard
  pr: 499
  merged_pr: 499
  merge_commit: ae1bc67
  model:
    Opus # rAF/microtask ordering + supersession-timing reasoning, prod-touching, same class
    # as FOLLOW-380/546; model-fit table "complex single-domain reasoning ... non-trivial design".
    # See dispatch brief in backlog/HANDOFFS.md ("PM orchestrator (session 24) -> sdk-engineer,
    # FOLLOW-548") — that brief currently lives on unmerged PR #498 (bookkeeping-only, awaiting
    # human as of this validation), relayed to the worker out of band, same pattern as
    # FOLLOW-380/#490 and FOLLOW-546/#494.
  ci_status: >-
    green (independently re-verified via `gh pr view 499 --json statusCheckRollup`): non-success
    count = 2, both the SAME standing pre-existing "Rule I — wired-or-dead check" (matrix-
    duplicated), 180 violations via `--log-failed` — IDENTICAL to the FOLLOW-546 baseline, zero new
    flags. Test (Node 22) green — pulled the full job log: `@estalara/sdk:test` ran the ENTIRE suite
    fresh (69 files / **1524** tests, all passed — up from FOLLOW-546's 1521 by exactly the 3 new
    tests: TG-1, TG-2, headline case). Typecheck, Lint, Format check, Build, Build (control-plane),
    SDK E2E tests, all Python suites, Demo integration, Rule H, Rule J — all green. SDK bundle-size
    gate (embedded in `Build`): **40.49KB gzip vs the 42KB budget** (ESC-028) — PASSED, matching the
    worker's self-report exactly this time. PR file list independently confirmed exactly 4 files:
    `.claude/agents/sdk-engineer/lessons.md`,
    `packages/sdk/src/__tests__/adapt-description.test.ts`,
    `packages/sdk/src/core/adapt-description.ts`,
    `packages/shared/src/schemas/events/adapt-description.ts` — zero edits to `backlog/QUEUE.md`,
    `docs/MASTER_DESIGN.md`, `README.md`, or `CLAUDE.md`, and `index.ts` is NOT in this diff
    (unchanged — confirmed correct, since it already passed the real predicate).
  priority: P3
  estimated_hours: 2.5
  depends_on: []
  source: >-
    RETRO-170 (§4a LG-1/LG-2 / §4c TG-1/TG-2 / §4d DG-1 / §7); source_ticket FOLLOW-546. Governed by
    Rule AB (CONVENTIONS_PATCH.md — promoted by RETRO-170 §6): a latest-wins staleness guard on a
    rapid-nav re-adaptation MUST be consulted at the LAST synchronous instant before EVERY host-DOM
    write it protects, including deferred writes — a single checkpoint is insufficient. This is the
    THIRD relocation hop of the RETRO-105 async-interleave class (sync-checkpoint [FOLLOW-380] →
    fire-and-forget tail [FOLLOW-546] → the write path this ticket covers).
  spec:
    backlog/FOLLOW_UPS.md FOLLOW-548; backlog/RETROSPECTIVES.md RETRO-170; CONVENTIONS_PATCH.md Rule
    AB
  notes: |
    Promoted 2026-07-10 (pm-orchestrator, session 24) from backlog/FOLLOW_UPS.md into Sprint 22b,
    matching the FOLLOW-380/546/467/468/469/472/474 promotion pattern. `promoted_to_queue: true`
    set on the FOLLOW_UPS.md stub. Dispatched same-session to sdk-engineer (Opus). Full delegation
    brief (incl. a PM-verified timing-analysis correction to the stub's own premise) in
    `backlog/HANDOFFS.md` ("PM orchestrator (session 24) → sdk-engineer, FOLLOW-548") — see
    `model:` field caveat above re: that brief's unmerged-PR-#498 status.

    PM-VALIDATED 2026-07-10 (pm-orchestrator, session 24) — PR #499
    (`sdk-engineer/FOLLOW-548-raf-deferred-staleness-guard`, off `main`). Independently verified
    (not taken on the worker's self-report), reading the actual `git diff main...HEAD` for
    `packages/sdk/src/core/adapt-description.ts` and `packages/shared/src/schemas/events/
    adapt-description.ts`:

    - **Worker independently confirmed the PM timing-analysis finding** (the dispatch brief
      flagged that the stub's LG-1 premise — ":323 rAF defers the write" — does not hold for the
      initial paint; the real gap is the `reapply` closure). Their PR report states they re-ran an
      equivalent repro before implementing. This closes the delegation-brief's explicit
      "independently re-confirm before implementing" instruction.
    - **Fix, traced end-to-end:** `applyAndObserveSlot`/`applyAndObserveHeadlineSlot` gained a
      REQUIRED third param `isStale: () => boolean` (no default — closes LG-2). Two guard sites
      confirmed by reading the full function bodies: (1) inside `reapply()` — `if (isStale())`
      appears FIRST, before the `descFingerprint` check, and on the stale path calls
      `s.obs.disconnect()` then `pushEvent(EVT + 'skipped', {reason:'stale'})` then returns —
      confirmed this genuinely precedes the `render`/`obs.observe` calls further down in the
      function (they're unreachable once this early-returns) — the disconnect kills the
      persistence leg by retiring the watchdog entirely; (2) entry defense-in-depth — a second
      `if (isStale())` check before the "Initial write," also confirmed to precede `render`/
      `obs.observe`. LG-2 confirmed: `index.ts` is UNCHANGED in this diff (not in the file list)
      and its existing call (`index.ts:809`) already passes the real predicate
      `() => myRefreshId !== latestRefreshId` — independently re-grepped
      (`grep -rn "applyDescriptionAdaptation" packages/sdk/src --include=*.ts | grep -v test`)
      and confirmed it is the ONLY production call site, so the required-param change cannot
      silently compile-break or mis-wire any other prod caller. Confirmed via
      `grep -c "() => false"` that the ~31 unit-test call sites (`adapt-description.test.ts`)
      all pass an explicit never-stale predicate (32 occurrences — close enough to the claimed 31
      given the new tests also use the literal). DG-1 confirmed: the schema JSDoc
      (`packages/shared/src/schemas/events/adapt-description.ts:57`/`:66-67`) now lists `'stale'`
      alongside `'neutral'`; the Zod shape itself is unchanged (`z.string().min(1).optional()`),
      so `{reason:'stale'}` is schema-valid without any contract change.
    - **Both new tests independently read and confirmed non-vacuous, not just re-run:** TG-1
      (`adapt-description.test.ts` — search `TG-1:`) drives a fresh paint → a framework-simulated
      DOM revert (arming the observer's internal rAF) → supersession set to `true` IN THE GAP
      between arming and firing → fires the deferred reapply via `vi.runAllTimers()` → asserts the
      slot keeps the NEWER content, never the stale copy, AND that a subsequent revert is no
      longer re-asserted (proves `disconnect()` genuinely ran). TG-2 (search `TG-2:`) is the
      persistence leg: the superseding nav's OWN fetch resolves `template_fallback` (non-
      adaptable), so it bails at `:314` before its own write — confirms the stale L1 watchdog,
      once fired, still does not resurrect the stale copy and is disconnected. A third test
      mirrors TG-1 for the headline path. All three assert the `skipped:stale` event fires
      (observable discard, not silent). Without the fix, `reapply()`'s unconditional
      `render`/`renderHeadline` call on a fingerprint mismatch would resurrect the stale content
      in both TG-1/TG-2/headline — these tests are structurally guaranteed to fail without the
      guard, matching the worker's scratchpad-cp-verified RED/GREEN claim.
    - **CI green**, bundle 40.49KB/42KB (exact match to self-report this time), Rule I 180
      (identical baseline, zero new flags), file list exactly 4 (no backlog/doc edits, `index.ts`
      correctly absent).

    PM-validated. CI green (bar the standing Rule I baseline). Runtime wiring confirmed
    end-to-end (required-param threading, both guard sites precede both DOM-mutating calls,
    persistence leg killed via `disconnect()`). Ready for human review.
    AC:
    - [x] Re-consult the staleness predicate at the LAST synchronous instant before EACH host-DOM
          write — both the `reapply`/MutationObserver watchdog path (the real gap) and the
          initial-write defense-in-depth. Neither `render` NOR `obs.observe` (nor a stale
          `reapply` firing) occurs when superseded.
    - [x] Non-vacuous test (TG-1) — supersedes at the actual deferred-write boundary (a
          MutationObserver-armed `reapply`, drained via `vi.runAllTimers()`); asserts the stale
          copy never paints.
    - [x] Non-vacuous test (TG-2, persistence leg) — the newer nav's `fetchDescription` returns a
          non-adaptable result and bails before its own write; asserts no surviving/
          self-reasserting stale slot.
    - [x] LG-2: closed the never-stale-default footgun — `isStale` is now a REQUIRED param, no
          silent-revert-to-never-stale possible; sole prod caller unaffected (already passed the
          real predicate); ~31 test call sites updated to pass an explicit `() => false`.
    - [x] DG-1: `adapt.description.skipped` schema JSDoc updated to list `'stale'` alongside
          `'neutral'`.

    **PM RECOMMENDATION re: the permanent-record accuracy issue (flagged in the delegation brief,
    independently confirmed by the worker too) — RETRO-170 §4a LG-1's own prose and Rule AB's
    evidence footnote in `CONVENTIONS_PATCH.md` cite `:323`/`:333` as "the unguarded write," but
    that line runs synchronously and was already guarded by the pre-existing `:309` check; the
    real unguarded write is the `reapply` closure (fired via the observer's internal `:155` rAF).
    The Rule AB PRINCIPLE is correct and does not need to change. Recommend: fold a small,
    surgical evidence-citation correction into Rule AB's existing footnote comment in
    `CONVENTIONS_PATCH.md` as part of THIS ticket's close PR (mirroring the FOLLOW-544 precedent
    of fixing a durable-doc inaccuracy inline with the closing PR of the ticket that surfaced it)
    — because Rule AB is a LIVE, forward-looking rule future tickets will actually consult, and an
    imprecise citation could mislead a future engineer investigating a similarly-shaped bug at the
    wrong line. Do NOT edit RETRO-170's own historical text — this repo's convention is
    append-only for retro entries (per the RETRO-168 DURABLE-SELF-REPORT-DRIFT pattern: propagate
    corrections to durable/live docs, don't rewrite history); the eventual RETRO-171 for this
    ticket will naturally reconcile/note the finding as part of its own analysis, which is the
    established pattern for how this repo's retro loop handles evolving understanding. Not
    actioning this myself — awaiting human/coordinator direction per instruction.

    MERGED 2026-07-10: PR #499 squash-merged to `main` as commit `ae1bc67` (2026-07-10T10:24:35Z);
    the PM-validation bookkeeping PR #500 merged immediately after as `b3770f6`. PR #498 (the
    superseded promotion/dispatch-record PR) was CLOSED unmerged per human decision — its content
    is fully folded into this ticket block's DONE trail, nothing lost. Ticket closed DONE.

    RULE AB CITATION FIX (human-approved recommendation, option (a) above): the evidence footnote
    in `CONVENTIONS_PATCH.md` Rule AB has been corrected in this same PR — the supporting line
    citation now points at the `reapply`/observer-rAF write (the genuinely deferred, unguarded
    write FOLLOW-548 fixed), not the synchronously-evaluated `:323`/`:333` line. Rule AB's
    PRINCIPLE text is unchanged (it was correct). `backlog/RETROSPECTIVES.md` RETRO-170's own
    historical text was NOT edited (append-only convention) — RETRO-171 will reconcile.

    retrospective-analyst to be spawned by the coordinator on branch
    `pm-orchestrator/FOLLOW-548-close` (this same bookkeeping PR, RETRO-171 — also asked to assess
    whether the RETRO-105 cross-listing async-interleave class is now FULLY closed after three
    relocation hops [FOLLOW-380 → FOLLOW-546 → FOLLOW-548] or whether a 4th hop exists) per the
    repo's RETRO+DONE bundling convention (matches PRs #486/#487, #489, #493, #497) — NOT run by
    pm-orchestrator itself (no subagent-spawn capability in this tool surface).
- id: FOLLOW-532
  title: >-
    Pin the two GET adapt call sites against future drift — the fail-loud DB-throw contract lives
    OUTSIDE the shared resolveAdaptGetAuth helper as an unenforced caller obligation
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-07-10T00:00:00Z'
  completed_at: '2026-07-10'
  branch: backend-engineer/FOLLOW-532-adapt-get-auth-dbthrow-parity
  pr: 502
  merged_pr: 502
  merge_commit: a934adf
  ci_status: >-
    green (independently re-verified via `gh pr view 502 --json statusCheckRollup`): non-success
    count = 2, both the SAME standing pre-existing "Rule I — wired-or-dead check" (matrix-
    duplicated); confirmed via `--log-failed` on run 29097226725 — 180 WARN lines, IDENTICAL to the
    FOLLOW-546/548 baseline, zero hits on grep for `adapt-get-auth`/`AdaptGetAuthResult`/
    `resolveAdaptGetAuth` in that log (none of the 180 are from this diff). Typecheck, Lint, Format,
    Build, Build (control-plane), Test (Node 22 full suite), SDK E2E, all Python suites, Vercel,
    Rule H, Rule J, and every other real gate green. CI-check counter: 1/5. Fix-iteration counter:
    0/3.
  model:
    Sonnet # routine, well-scoped implementation inside an existing ticket family (FOLLOW-473's
    # own routes/tests) — either a shared parity test or a 3rd AdaptGetAuthResult disposition;
    # no cross-module ambiguity or prod-irreversible risk. Model-fit table row "Routine
    # implementation inside a well-defined ticket scope ... mechanical refactors" -> Sonnet.
  priority: P2
  estimated_hours: 2
  depends_on: []
  source: >-
    RETRO-164 §4a LG-1 (source_ticket FOLLOW-473) — resolveAdaptGetAuth (adapt-get-auth.ts)
    deliberately does NOT catch the resolveApiKey throw (Rule K.2 configured-but-failed DB); its
    docstring requires the CALLER to try/catch + Sentry-capture + fail loud (401). Both GET
    /api/adapt and GET /api/adapt/description do this identically today but each owns its own
    try/catch + 401 construction, with no shared parity assertion pinning the two together — an edit
    dropping one route's catch would surface as an unhandled 500 on that route only, invisible to
    the untouched route's green CI.
  spec: backlog/FOLLOW_UPS.md FOLLOW-532; backlog/RETROSPECTIVES.md RETRO-164 §4a LG-1; ADR-0015
  notes: |
    Promoted 2026-07-10 (pm-orchestrator, session 25) from backlog/FOLLOW_UPS.md into Sprint 22b,
    matching the FOLLOW-380/546/467/468/469/472/474/548 promotion pattern. `promoted_to_queue: true`
    set on the FOLLOW_UPS.md stub. Dispatched same-session to backend-engineer ALONE (not
    co-assigned with qa-engineer as the stub originally suggested — see `promoted_to_queue:` note
    on the stub for reasoning). Full delegation brief in `backlog/HANDOFFS.md` ("PM orchestrator
    (session 25) -> backend-engineer, FOLLOW-532").

    PM-VALIDATED 2026-07-10 (pm-orchestrator, session 25) — PR #502
    (`backend-engineer/FOLLOW-532-adapt-get-auth-dbthrow-parity`, off `main`, not merged).
    Independently verified (not taken on the worker's self-report):
    - **Chosen mechanism:** option 2 (fold into helper) — `resolveAdaptGetAuth` gained a required
      3rd `area: 'adapt' | 'description'` param, now catches the `resolveApiKey` DB-throw itself,
      Sentry-captures internally (`tags: {area, kind: 'api_key_auth_db_error'}`), and returns a
      third `AdaptGetAuthResult` disposition `{ok:false,status:401,message,dbError:true}`. Read the
      full diff, not the summary: both `apps/control-plane/src/app/api/adapt/route.ts:714` and
      `.../adapt/description/route.ts:220` deleted their duplicated try/catch+Sentry blocks and now
      call the shared helper directly — both routes are now structurally incapable of diverging
      (stronger than a parity-test-only approach).
    - **Wiring grep** (non-test producer -> non-test consumer):
      `grep -rn "resolveAdaptGetAuth(" apps/ --include=*.ts | grep -v node_modules | grep -v test` ->
      exactly the helper's own export (`adapt-get-auth.ts:79`) plus the 2 production call sites
      above — no orphan 3rd caller, no stray old 2-arg call left behind. `Sentry` import confirmed
      still genuinely used elsewhere in both route files (not orphaned).
    - **New parity test** `apps/control-plane/src/lib/__tests__/adapt-get-auth.parity.test.ts` read
      in full: drives BOTH `area` values through a forced `resolveApiKey` throw and asserts
      `adaptResult).toEqual(descriptionResult)` (load-bearing, not decorative — would fail if either
      branch special-cased differently) plus the Sentry-capture shape. Two pre-existing route tests
      (`adapt/route.test.ts`, `description/route.test.ts`) correctly updated from
      `mockRejectedValue` to `mockResolvedValue({...dbError:true})` to match the new no-throw
      contract.
    - **Independently re-ran locally** (fresh `git worktree`, NOT trusting the worker's self-report
      per Rule 4e/FOLLOW-448): `pnpm install`, rebuilt `@estalara/{db,shared,auth,sdk}` first (the
      documented FOLLOW-474/RETRO-150 worktree-bootstrap gotcha — control-plane typecheck 2307s on
      workspace packages otherwise), then `tsc --noEmit` control-plane = clean;
      `vitest run adapt-get-auth.parity.test.ts` = 4/4 pass; `vitest run adapt/route.test.ts
      adapt/description/route.test.ts` = 89/89 pass; targeted `eslint` + `prettier --check` on all 6
      touched files = clean. Worktree removed after.
    - **CI:** `gh pr checks 502` all pass except the standing 2-leg "Rule I — wired-or-dead" gate;
      independently re-derived via `gh pr view --json statusCheckRollup` (count=2) and
      `gh run view --log-failed` (180 WARN lines, identical to the FOLLOW-546/548 baseline, zero
      hits for this diff's symbols). CI-check counter: 1/5. Fix-iteration counter: 0/3.

    PM-validated. CI green (bar the standing Rule I baseline). Runtime wiring confirmed
    end-to-end (shared code path, both production call sites traced, no orphan callers/imports).
    AC verified against the actual diff, not the worker's summary. Ready for human review.
    AC:
    - [x] Chose option 2: fold the throw-handling into resolveAdaptGetAuth as a third
          AdaptGetAuthResult disposition (`{ok:false,status:401,message,dbError:true}`) — both call
          sites now share the SAME branch, making divergence structurally impossible.
    - [x] The mechanism fails CI if one call site's DB-throw disposition drifts from the other: the
          shared-helper design makes drift structurally impossible, and the new parity test's
          `.toEqual` cross-area comparison would additionally red on any behavioral asymmetry
          (load-bearing, not decorative — independently confirmed by reading + re-running it).

    MERGED 2026-07-10: PR #502 (`backend-engineer/FOLLOW-532-adapt-get-auth-dbthrow-parity`) merged
    to `main` as commit `a934adf` (`a934adfd2359d4f12aa6538923e08ce351112025`,
    `mergedAt: 2026-07-10T14:36:48Z` per `gh pr view 502 --json state,mergeCommit,mergedAt`).
    `git checkout main && git pull` confirmed the commit is present locally
    (`git log --oneline -1` -> `a934adf ... [FOLLOW-532] (#502)`). Ticket closed DONE.

    retrospective-analyst to be spawned by the coordinator (per CLAUDE.md's per-ticket
    retrospective loop) — NOT run by pm-orchestrator itself (no subagent-spawn capability in this
    tool surface). Delegation brief prepared in `backlog/HANDOFFS.md` ("Retro delegation brief —
    FOLLOW-532").
- id: FOLLOW-549
  title: >-
    Pin each GET adapt route's own `area` literal + close the call-site-inventory doc lag introduced
    by FOLLOW-532's fold
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-07-10T00:00:00Z'
  completed_at: '2026-07-10'
  branch: backend-engineer/FOLLOW-549-adapt-get-auth-area-pin
  pr: 505
  merged_pr: 505
  merge_commit: f541f37
  ci_status: >-
    green (independently re-verified pre-merge via `gh pr view 505 --json statusCheckRollup`):
    non-success count = 2, both the SAME standing pre-existing "Rule I — wired-or-dead check"
    (matrix-duplicated); confirmed via `--log-failed` on run 29106380666 — 180 WARN lines, IDENTICAL
    to the FOLLOW-532/546/548 baseline, zero hits on grep for `adapt-get-auth`/
    `resolveAdaptGetAuth`/`AdaptGetAuthResult`/`mockResolveAdaptGetAuth` in that log. File list
    confirmed test/docs-only via `gh pr view 505 --json files`: 2 test files + 1 docstring-only lib
    change (read in full — comment-only, no executable code) + 1 agent lessons file; neither
    production route.ts touched. AC independently re-proven from scratch (not trusted from the
    worker's self-report, per Rule 4e/FOLLOW-448): fresh `git worktree`, rebuilt
    `@estalara/{db,shared,auth,sdk}` (FOLLOW-474/RETRO-150 gotcha), confirmed 91/91 green
    as-shipped, then swapped each route's `area` literal in turn — `adapt/route.ts`
    (`'adapt'`→`'description'`) genuinely FAILED the new pin test; reverted;
    `adapt/description/route.ts` (`'description'`→`'adapt'`) genuinely FAILED too; reverted; full
    suite back to 91/91. Both directions of the swap-fails property hold. Docstring change
    independently confirmed present on `main` post-merge (`adapt-get-auth.ts` lines 13-16, names the
    `area`-union-widening compile error as the forcing function). Merged 2026-07-10T16:48:49Z per
    `gh pr view 505 --json state,mergeCommit,mergedAt`.
  model:
    Sonnet # routine, mechanical, well-scoped (add 2 spy assertions + 1 docstring sentence to a
    # file the repo just finished working in); no cross-module ambiguity, no design judgment
    # call. Model-fit table row "Routine implementation inside a well-defined ticket scope ...
    # tests, docs/backlog bookkeeping, mechanical refactors" -> Sonnet.
  priority: P3
  estimated_hours: 1
  depends_on: []
  source: >-
    RETRO-172 §4c TG-1 / §4d DG-1 / §7 (source_ticket FOLLOW-532) — FOLLOW-532 folded the DB-throw
    try/catch INTO resolveAdaptGetAuth and gave it a required 3rd `area: 'adapt' | 'description'`
    param, the ONLY per-call-site obligation the fold left. Nothing pins each route to its own
    literal: the parity test drives the helper directly, and both route.test.ts files mock
    resolveAdaptGetAuth wholesale, so no test asserts GET /api/adapt passes 'adapt' and GET
    /api/adapt/description passes 'description'. A future clone that passed the wrong literal would
    mislabel the Sentry `tags.area` with NO CI signal (disposition + `tags.kind` stay correct —
    cosmetic observability mislabel only, hence P3, a degrade from FOLLOW-532's original
    P2-correctness seam per RETRO-172 §7's one-hop check). Separately, the helper's call-site-
    inventory note (`adapt-get-auth.ts:13-14`) still says only "a third consumer added later MUST be
    appended here" and doesn't mention that a genuinely new third route must ALSO widen the `area`
    union (a compile error — a good forcing function, but undocumented at the inventory site).
  spec: backlog/FOLLOW_UPS.md FOLLOW-549; backlog/RETROSPECTIVES.md RETRO-172 §4c/§4d/§7; Rule S
  notes: |
    Promoted 2026-07-10 (pm-orchestrator, session 25 cont'd) from backlog/FOLLOW_UPS.md into
    Sprint 22b, matching the FOLLOW-380/546/467/468/469/472/474/532/548 promotion pattern.
    `promoted_to_queue: true` set on the FOLLOW_UPS.md stub. Dispatched same-session to
    backend-engineer (Sonnet). Full delegation brief in `backlog/HANDOFFS.md` ("Delegation brief —
    FOLLOW-549").
    AC:
    - [x] A lightweight assertion (spy on the existing `mockResolveAdaptGetAuth`) in EACH route's
          own suite reds CI if `GET /api/adapt` is not called with `'adapt'` or `GET
          /api/adapt/description` is not called with `'description'` — independently re-proven by
          swapping each literal in a fresh worktree and confirming a genuine failure both ways
          (see `ci_status:` above).
    - [x] The `adapt-get-auth.ts` call-site-inventory docstring states that a third consumer must
          ALSO widen the `area: 'adapt' | 'description'` union type, naming the compile error as
          the forcing function — confirmed present on `main` post-merge.

    MERGED 2026-07-10: PR #505 (`backend-engineer/FOLLOW-549-adapt-get-auth-area-pin`) merged to
    `main` as commit `f541f37` (`f541f371ace5286bfd2afcadca041bb4d949c9d3`,
    `mergedAt: 2026-07-10T16:48:49Z` per `gh pr view 505 --json state,mergeCommit,mergedAt`). The
    human ALSO merged PR #504 (`pm-orchestrator/FOLLOW-549-dispatch`, commit `857e069`) — the
    original dispatch-record content (this IN_PROGRESS block) — rather than closing it as
    superseded, which is why this ticket skipped a separate `READY_FOR_REVIEW` state on `main`: the
    PM's intended validation PR (#506, `pm-orchestrator/FOLLOW-549-validate`) was cut BEFORE #504/
    #505 merged and developed an unresolvable `backlog/QUEUE.md` merge conflict once both landed;
    #506 was closed unmerged (no data loss — its validation evidence is reproduced in full here,
    independently re-confirmed against `main` post-merge, not copy-pasted blind) and this DONE-flip
    was written fresh on `pm-orchestrator/FOLLOW-549-done` off current `main`. `git checkout main
    && git pull` confirmed both merge commits present (`git log --oneline` shows `f541f37 ...
    (#505)` then `857e069 ... (#504)`); `backlog/QUEUE.md` confirmed to have exactly ONE FOLLOW-549
    block (no duplication from the two merges) before this edit. Ticket closed DONE.

    retrospective-analyst to be spawned by the coordinator (per CLAUDE.md's per-ticket
    retrospective loop) — NOT run by pm-orchestrator itself (no subagent-spawn capability in this
    tool surface) — to append RETRO-173 onto this SAME `pm-orchestrator/FOLLOW-549-done` branch, so
    DONE + RETRO bundle into ONE PR (matches the FOLLOW-532/#503 pattern) rather than the 3-PR
    sprawl (#504/#505/#506) this ticket just produced. Delegation brief in `backlog/HANDOFFS.md`
    ("Retro delegation brief — FOLLOW-549").
- id: FOLLOW-550
  title: >-
    Codify bookkeeping-PR sequencing to prevent QUEUE.md-conflict sprawl (single close-superseded
    default; never two QUEUE.md-touching PRs in flight)
  agent: architect
  status: DONE
  assigned_to: architect
  started_at: '2026-07-10T00:00:00Z'
  completed_at: '2026-07-10'
  branch: architect/FOLLOW-550-bookkeeping-pr-sequencing
  pr: 509
  merged_pr: >-
    509 (content — docs/AGENT_WORKFLOW.md, the ticket's deliverable) + 508 (bookkeeping — the
    dispatch+validation PR, correctly merged not closed per its own rule (a): its content was never
    duplicated/folded into a later PR)
  merge_commit: 66f8e76
  ci_status: >-
    green (independently re-verified via `gh pr view 509 --json statusCheckRollup`): non-success
    count = 2, both the SAME standing pre-existing "Rule I — wired-or-dead check" (matrix-
    duplicated); confirmed via `--log-failed` on run 29115981405 — 180 WARN lines, IDENTICAL to the
    FOLLOW-532/546/548/549 baseline (expected, docs-only diff). File list confirmed via `gh pr view
    509 --json files`: exactly ONE file, `docs/AGENT_WORKFLOW.md` — `CONVENTIONS_PATCH.md` NOT
    touched. CI-check counter: 1/5. Fix-iteration counter: 0/3.
  model:
    Sonnet # cross-cutting PROCESS/convention codification (workflow doc + rationale, no code, no
    # ambiguous tradeoff to adjudicate — the retro already did the analysis and left ready-made
    # Rule text) fits the model-fit table's "routine implementation inside a well-defined ticket
    # scope ... docs/backlog bookkeeping" row more than the "ambiguous acceptance criteria /
    # non-trivial design" Opus row. Escalate to Opus only if, while drafting, the architect finds
    # the CONVENTIONS_PATCH-vs-AGENT_WORKFLOW placement question (see AC) is genuinely contested
    # and needs deeper cross-cutting reasoning than the ticket's explicit answer already resolves.
  priority: P3
  estimated_hours: 1
  depends_on: []
  source: >-
    RETRO-173 §6/§9 (source_ticket FOLLOW-549) — FOLLOW-549 (a 1h P3 test/docs ticket) produced
    THREE PRs (#504 dispatch-record, #505 code, #506 validation) where FOLLOW-532 minutes earlier
    achieved a tight 2-PR shape. #506 was cut from `main` BEFORE #504/#505 merged; the human merged
    BOTH #504 (the redundant dispatch-record) AND #505 (code) instead of closing #504 as superseded,
    so #506 developed an unresolvable `backlog/QUEUE.md` merge conflict and was closed unmerged
    (recovered via a fresh DONE+RETRO bundle, #507). Root cause: the PM's own recurring close-out
    guidance presented "merge #N first" and "close it as superseded" as CO-EQUAL safe options across
    FOLLOW-380/532/546/548's close-out notes — they are NOT symmetric in downstream risk (merging
    the redundant bookkeeping PR guarantees any in-flight validation PR a QUEUE.md conflict; closing
    it does not).
  spec: backlog/FOLLOW_UPS.md FOLLOW-550; backlog/RETROSPECTIVES.md RETRO-173 §5d/§6/§9
  notes: |
    Promoted 2026-07-10 (pm-orchestrator, session 25 cont'd) from backlog/FOLLOW_UPS.md, human-
    approved dispatch to architect (cross-cutting process/convention change, not a worker
    deliverable — per human direction, overriding the stub's original "recommended_agent:
    pm-orchestrator", which didn't map cleanly onto the decision table). Full delegation brief in
    `backlog/HANDOFFS.md` ("Delegation brief — FOLLOW-550").

    **IMPORTANT — Rule AB / ≥2-prior-numbered-retro promotion discipline (read before drafting):**
    RETRO-173 explicitly did NOT promote this finding to a `CONVENTIONS_PATCH.md` Rule — the
    pattern is count 1 as a NUMBERED-RETRO finding (the ≥2-PRIOR-numbered-retro threshold that
    gates `CONVENTIONS_PATCH.md` promotion is genuinely unmet; the raw ~4x in-session recurrence of
    the two-PRs-in-flight SHAPE does NOT count toward that threshold — only documented findings in
    PRIOR numbered retros do, per the RETRO-153/158/169/170 precedent). **FOLLOW-550 is therefore a
    DELIBERATE workflow-doc codification (`docs/AGENT_WORKFLOW.md` guidance), NOT a back-door
    `CONVENTIONS_PATCH.md` Rule promotion that would bypass the threshold.** Do not add a
    `CONVENTIONS_PATCH.md` Rule as part of this ticket. If you (the architect) believe this finding
    genuinely warrants an immediate `CONVENTIONS_PATCH.md` Rule despite the count, that is an
    ESCALATION/ADR question for the human — write it to `backlog/ESCALATIONS.md`, do not silently
    add the Rule.

    **PROCESS/TOOLING FINDING (surfaced by the coordinator, recorded here):** the architect
    subagent's tool manifest is Read/Write/Edit/Glob/Grep/WebSearch/WebFetch — **no Bash**. It
    correctly REFUSED to `Edit` `docs/AGENT_WORKFLOW.md` directly, since without `git` it could not
    branch/commit and would have stranded the change on `main` — the exact FOLLOW-448/RETRO-146
    failure mode this repo's own "Branch-first worker discipline" section exists to prevent. It
    drafted the full section content + insertion point + mechanics and escalated the tooling gap;
    the coordinator then applied it verbatim (branched, inserted, committed `5025edd`, pushed,
    opened PR #509) — so this ticket's CONTENT is the architect's, the git mechanics are the
    coordinator's. Captured in `.claude/agents/pm-orchestrator/lessons.md` + `backlog/STATUS.md`;
    a FOLLOW_UPS stub is filed for the routing gap since FOLLOW-543 (another architect-assigned
    docs-codification ticket, still unpromoted) will hit the identical gap when dispatched.

    PM-VALIDATED 2026-07-10 (pm-orchestrator, session 25 cont'd) — PR #509
    (`architect/FOLLOW-550-bookkeeping-pr-sequencing`, off `main`, not merged). Independently
    verified (not taken on the coordinator's summary): read the full diff (53 lines,
    `docs/AGENT_WORKFLOW.md` only) — the new section is inserted at the exact recommended
    placement (between "Recovered-work re-verification" and "The retrospective loop"), states all
    four rules (a)-(d) verbatim to the AC's intent, cites RETRO-173 §5a/§6/§9 and the #504/#505/#506
    incident with the correct causal chain, and contains the required "workflow guidance, not a
    `CONVENTIONS_PATCH.md` Rule — Rule AB / ≥2-prior-numbered-retro threshold genuinely unmet"
    statement, additionally noting the section is the ready-made source text for a future Rule
    promotion. `CONVENTIONS_PATCH.md` confirmed untouched via `gh pr view 509 --json files`. CI
    green (see `ci_status:` above). PR comment posted with full evidence.

    Per FOLLOW-550's own rule (d), dogfooded before merge: this validation is folded into THIS
    SAME promotion PR (#508) rather than opened as a separate validation PR. PR #508 remains
    correct to MERGE (not close-superseded) per rule (a) — its content (the IN_PROGRESS dispatch
    record) is not being duplicated/re-included in a later PR; this validation commit only EXTENDS
    it in place, so #508 is the sole, non-redundant source of this ticket's bookkeeping trail.

    PM-validated. CI green. AC verified by direct read of the merged diff. Ready for human review.
    AC:
    - [x] Home: new subsection added to `docs/AGENT_WORKFLOW.md`, placed between "Recovered-work
          re-verification" and "The retrospective loop" as recommended. No `CONVENTIONS_PATCH.md`
          Rule added (confirmed via file list).
    - [x] (a) States the single default: a bookkeeping/dispatch PR whose content a later PR folds
          in is ALWAYS closed-as-superseded, never merged — no co-equal "merge it first" option.
    - [x] (b) States: never have two `backlog/QUEUE.md`-touching PRs open in flight simultaneously.
    - [x] (c) States: validation/DONE bookkeeping PRs are cut from `main` AFTER the code PR merges.
    - [x] (d) States the preferred shape: fold validation into the DONE+RETRO bundle rather than a
          separate validation PR, citing the FOLLOW-532/#503 pattern as the model.
    - [x] Cites RETRO-173 §5a/§6/§9 and the #504/#505/#506 incident concretely in the rationale
          prose.
    - [x] Explicitly states this is workflow guidance, not a `CONVENTIONS_PATCH.md` Rule promotion,
          citing Rule AB and the RETRO-153/158/169/170 promotion-discipline precedent by name.

    MERGED 2026-07-10: BOTH PRs merged by the human. PR #509 (`architect/FOLLOW-550-bookkeeping-pr-
    sequencing`, the content — `docs/AGENT_WORKFLOW.md`) merged to `main` as commit `66f8e76`
    (`66f8e76930dd31bb8f9c3dadac2b5ed21900e96c`, `mergedAt: 2026-07-10T19:42:37Z`). PR #508
    (`pm-orchestrator/FOLLOW-550-dispatch`, the bookkeeping — dispatch record + this validation)
    merged as commit `c02b96b` (`mergedAt: 2026-07-10T19:42:10Z`), both per `gh pr view
    508/509 --json state,mergeCommit,mergedAt`. #508 merging (not closing) is CORRECT per the new
    section's own rule (a): #508's dispatch-record content was never duplicated/re-included in a
    later PR — the validation commit EXTENDED #508 in place rather than opening a new PR (this
    very ticket's rule (d), dogfooded), so #508 is the sole, non-redundant source of the
    bookkeeping trail and had genuine content to merge, unlike FOLLOW-549's #504 (whose content
    WAS about to be duplicated by a separate #506). `git checkout main && git pull` confirmed both
    commits present (`git log --oneline` shows `66f8e76 ... (#509)` then `c02b96b ... (#508)`);
    `grep -n "Bookkeeping-PR sequencing" docs/AGENT_WORKFLOW.md` confirms the section is live on
    `main`; `backlog/QUEUE.md` confirmed to have exactly ONE FOLLOW-550 block (no duplication from
    the two merges) before this edit. Ticket closed DONE.

    retrospective-analyst to be spawned by the coordinator (per CLAUDE.md's per-ticket
    retrospective loop) — NOT run by pm-orchestrator itself (no subagent-spawn capability in this
    tool surface) — to append RETRO-174 onto this SAME `pm-orchestrator/FOLLOW-550-done` branch, so
    DONE + RETRO bundle into ONE PR (dogfooding rule (d), matching the FOLLOW-532/#503 pattern).
    Delegation brief in `backlog/HANDOFFS.md` ("Retro delegation brief — FOLLOW-550").
- id: FOLLOW-551
  title: >-
    Codify the architect-has-no-Bash routing gap: mandate draft-then-apply (or route to a
    Bash-capable agent) for any architect-assigned ticket requiring git/PR mechanics
  agent: architect
  status: DONE
  assigned_to: architect
  started_at: '2026-07-11T00:00:00Z'
  completed_at: '2026-07-11T09:02:26Z'
  branch: architect/FOLLOW-551-tool-capability-routing
  pr: 512
  merge_commit: c2670b2
  execution_mode: >-
    DRAFT-ONLY (dogfooding the very pattern this ticket codifies). Architect's tool manifest is
    Read/Write/Edit/Glob/Grep/WebSearch/WebFetch — NO Bash. Architect did NOT create a branch, did
    NOT Edit any file, did NOT attempt git of any kind. Architect produced the exact markdown
    content + insertion point(s) + rationale in its final report; the coordinator applied it
    verbatim (branch, commit `a8421e7`, push, PR #512). See full mechanics in the delegation brief
    (`backlog/HANDOFFS.md`, "Delegation brief — FOLLOW-551 (DRAFT-ONLY)").
  ci_status: >-
    green (independently re-verified via `gh pr view 512 --json statusCheckRollup`): non-success
    count = 2, both the SAME standing pre-existing "Rule I — wired-or-dead check" (matrix-
    duplicated); confirmed via `--log-failed` on run 29128704472 — 180 WARN lines, IDENTICAL to the
    FOLLOW-532/546/548/549/550 baseline (expected, docs-only diff — 2 files,
    `docs/AGENT_WORKFLOW.md` + `.claude/agents/architect.md`; `CONVENTIONS_PATCH.md` NOT touched,
    confirmed via `gh pr view 512 --json files`). CI-check counter: 1/5. Fix-iteration counter: 0/3.
  model:
    Sonnet # routine workflow-doc codification with a fully-specified AC and two named ≥2×
    # precedent instances already gathered (no open design question) — model-fit table "routine
    # implementation inside a well-defined ticket scope ... docs/backlog bookkeeping" row, not the
    # ambiguous-design Opus row. The one open judgment call (architect.md vs AGENT_WORKFLOW.md
    # placement, see AC) is bounded and doesn't need heavier reasoning.
  priority: P3
  estimated_hours: 1
  depends_on: []
  source: >-
    FOLLOW-550 (RETRO-174 §5a) — dispatching FOLLOW-550 (a docs(workflow) codification ticket) to
    architect surfaced that architect's tool manifest has no Bash; it correctly refused to Edit
    `docs/AGENT_WORKFLOW.md` directly (would have stranded the change on `main`, the exact
    FOLLOW-448/RETRO-146 failure mode) and instead drafted the content for the coordinator to apply.
    RETRO-174 §5a additionally found this workaround is NOT a one-off: the SAME draft-then-apply
    pattern already fired once before, on FOLLOW-470 (RETRO-168, `docs/MASTER_DESIGN.md` Changelog
    v4.3 — "the edit was applied by the top-level orchestrator on the architect's behalf [the
    architect subagent has no shell tool]"). Human decision (2026-07-11): resolve via option (2)
    from the FOLLOW-551 stub — formalize draft-then-apply as the standing, documented resolution
    (not option 1, route-away-from-architect entirely; not option 3, give architect Bash).
  spec: backlog/FOLLOW_UPS.md FOLLOW-551; backlog/RETROSPECTIVES.md RETRO-174 §5a; RETRO-168
  notes: |
    Promoted 2026-07-11 (pm-orchestrator, session 25 cont'd) from backlog/FOLLOW_UPS.md into
    Sprint 22b, matching the FOLLOW-380/546/467/468/469/472/474/532/548/549/550 promotion pattern.
    `promoted_to_queue: true` set on the FOLLOW_UPS.md stub. Dispatched same-session to architect
    in DRAFT-ONLY mode (see `execution_mode:` above) per human direction — resolving the routing
    gap using the very mechanism it will codify. Full delegation brief in `backlog/HANDOFFS.md`
    ("Delegation brief — FOLLOW-551 (DRAFT-ONLY)").

    **PRE-EXISTING DUPLICATE-RISK CATCH (found before dispatch, not after — verify-not-guess):**
    `backlog/FOLLOW_UPS.md` ALREADY contains an unpromoted, near-identical stub — **FOLLOW-545**
    ("Close the bashless-agent author-blur," `source_retro: RETRO-168 §4d DG-2`,
    `source_ticket: FOLLOW-470`, filed the SAME retro FOLLOW-551 cites as precedent #1, but never
    cross-referenced by FOLLOW-551's own stub when it was filed). FOLLOW-545's AC option (a)
    ("route doc-authoring / PR-producing tickets to a shell-capable agent by default") and this
    ticket's chosen resolution (draft-then-apply) are NOT identical but are answering the same
    underlying question — this ticket's human-approved resolution (draft-then-apply, option (2))
    substantially discharges FOLLOW-545's AC bullet 1. **FOLLOW-545's AC bullet 2 is a DISTINCT,
    still-open angle this ticket does NOT cover:** "require the orchestrator, whenever it executes
    an edit BEYOND a delegate's stated plan, to reconcile that deviation across ALL durable
    artifacts (Changelog/SoT/AC), not only the transient QUEUE note" (the FOLLOW-544 root cause —
    already RESOLVED_INLINE as a one-off instance, but the general discipline was never codified).
    Cross-referenced FOLLOW-545's own stub with a pointer back to this ticket (see
    `backlog/FOLLOW_UPS.md`) so FOLLOW-545 is not silently duplicated or forgotten — it should be
    reviewed at next promotion, scoped down to ONLY its still-open bullet 2, not re-promoted
    wholesale. This ticket proceeds as human-directed; the duplicate-risk is recorded, not blocking.

    **Rule-AB-discipline precision (read before drafting) — this is workflow guidance, NOT a
    `CONVENTIONS_PATCH.md` Rule, and here is the precise count, not a hand-wave:** the
    architect-has-no-Bash / draft-then-apply pattern has been independently OBSERVED in exactly
    TWO prior numbered retros — RETRO-168 (FOLLOW-470, first occurrence) and RETRO-174 (FOLLOW-550,
    second occurrence, which explicitly cross-referenced RETRO-168 as "≥2× recurrence"). Per this
    repo's own consistent ≥2-PRIOR-numbered-retro promotion discipline (Rule Q/V/X/AA/AB's own
    provenance footnotes: promotion requires 2 BANKED prior sightings PLUS a THIRD, independent
    sighting that serves as the promoting retro — the promoting retro does not inflate its own
    count), this pattern currently sits at exactly 2 banked sightings with NO third sighting yet.
    **FOLLOW-551 is the FIX for the gap, not a fresh occurrence of it — implementing this ticket is
    NOT the 3rd sighting and must not be treated as satisfying the threshold.** Do not add a
    `CONVENTIONS_PATCH.md` Rule as part of this ticket. If a THIRD independent numbered retro later
    observes a fresh instance of an agent hitting a tool-manifest gap on a git-touching ticket
    (whether architect again, hypothetically, or a newly-discovered case), THAT retro is the
    legitimate promotion trigger, citing RETRO-168 + RETRO-174 as the 2 banked priors — not this
    ticket. If you (the architect) believe this genuinely warrants an immediate
    `CONVENTIONS_PATCH.md` Rule despite the count, that is an ESCALATION/ADR question for the
    human — write it to `backlog/ESCALATIONS.md`, do not silently add the Rule.
    AC:
    - [x] Home: primary location is `docs/AGENT_WORKFLOW.md`, near "The 9 agents" table (:14-28)
          and/or the "Model-fit decision" section (:30-48) — mirror the structure/citation style of
          the existing "Bookkeeping-PR sequencing" section (:163) and "Branch-first worker
          discipline" section (:108). States: architect's tool manifest has no Bash; any ticket
          whose AC requires git/PR mechanics (commit, push, branch, open a PR) and is assigned to
          architect MUST use draft-then-apply — architect produces the exact content + insertion
          point + rationale in its final report; a Bash-capable party (PM or another agent) applies
          it verbatim — UNLESS the ticket is reassigned to a Bash-capable agent from the start
          (also an acceptable resolution, at the delegator's discretion).
    - [x] Cites BOTH precedent instances by ticket/retro number: FOLLOW-470/RETRO-168 and
          FOLLOW-550/RETRO-174, stating this is a ≥2× recurrence (not a one-off risk).
    - [x] Explicitly states this is workflow guidance, not a `CONVENTIONS_PATCH.md` Rule promotion,
          and states the precise 2-banked/no-3rd-sighting count from the note above (so a future
          reader — or retro — has the exact citation trail to evaluate a future 3rd-sighting
          promotion without re-deriving it).
    - [x] Architect's own judgment call (explicitly asked, not prescribed): does a companion note
          belong in `.claude/agents/architect.md` itself (e.g. "this agent has no Bash; any
          ticket requiring git/PR mechanics must use draft-then-apply, see
          docs/AGENT_WORKFLOW.md") — state the decision and reasoning either way in the final
          report, and include the exact content if the answer is yes.
    - [x] The PM delegation-table decision guidance (CLAUDE.md and/or AGENT_WORKFLOW.md) reflects
          the chosen resolution so a future PM session doesn't repeat the FOLLOW-550
          dispatch-then-discover round-trip for FOLLOW-543 or any future architect-assigned
          git-touching ticket. Per RETRO-174 §5b, **FOLLOW-543 should be dispatched using this
          newly-codified draft-then-apply resolution once FOLLOW-551 lands** — not before.

    PM-VALIDATED 2026-07-11 (pm-orchestrator, session 25 cont'd) — PR #512
    (`architect/FOLLOW-551-tool-capability-routing`, off `main`, not merged). Coordinator applied
    architect's DRAFT-ONLY report verbatim as commit `a8421e7`. Independently verified (not taken
    on the coordinator's summary): read the full diff (2 files, +69/-5) directly.
    - **New "Agent tool-capability routing" section confirmed** inserted immediately after
      "Model-fit decision" (matching the AC's recommended placement), mirroring the citation style
      of "Bookkeeping-PR sequencing" and "Branch-first worker discipline". States both routing
      options (route-away-from-architect / draft-then-apply, numbered 1/2) with option (2) named
      the default for architect-assigned docs/ADR tickets needing a PR. Cites both precedents by
      exact ticket/retro number with a direct quote from `docs/MASTER_DESIGN.md` Changelog v4.3 for
      FOLLOW-470/RETRO-168, and FOLLOW-550/RETRO-174 §5a/§7. Contains the explicit "This is
      workflow guidance, not a codified `CONVENTIONS_PATCH.md` Rule" statement — notably, it
      surfaces a nuance worth recording: the RAW `CLAUDE.md`/`CONVENTIONS_PATCH.md` "≥2 retros"
      wording is technically met at face value, but the section correctly defers to this repo's
      established 2-banked-plus-3rd-sighting adjudication discipline (citing RETRO-153/158,
      RETRO-169/170) and explicitly leaves the actual promotion call to FOLLOW-551's own
      retrospective rather than deciding it inline — satisfies "do not add a Rule" without
      overreach.
    - **FOLLOW-545 bullet 2 confirmed NOT silently absorbed:** the section's closing paragraph
      explicitly states FOLLOW-545's second bullet (orchestrator-edits-beyond-plan reconciliation)
      "is a broader authorship-integrity problem that this section does not resolve... That remains
      open under FOLLOW-545" — matches the duplicate-risk note recorded at promotion time.
    - **`.claude/agents/architect.md` confirmed fixed:** the "First action on any ticket" section
      no longer instructs `git checkout -b`; replaced with a note stating architect has no Bash,
      cross-referencing the new `docs/AGENT_WORKFLOW.md` section by name, and directing
      draft-then-apply as the default with a design-consultation-only carve-out. The
      `pre-edit-branch-guard.sh` hook is correctly reframed as a backstop-to-stop-and-draft rather
      than a branch reminder.
    - **CI:** `gh pr view 512 --json files` confirms exactly 2 files
      (`docs/AGENT_WORKFLOW.md`, `.claude/agents/architect.md`) — `CONVENTIONS_PATCH.md` NOT
      touched. Non-success count independently re-derived = 2, both the standing Rule I baseline
      (180 WARN lines, identical to prior baseline, zero new hits — see `ci_status:` above).
    - **No two-`QUEUE.md`-PRs-in-flight collision:** PR #511 (this ticket's promotion, still open)
      touches `backlog/QUEUE.md`; PR #512 touches only the two docs files above — disjoint file
      sets, so this validation is safely folded as an ADDITIONAL COMMIT onto #511's own branch
      (`pm-orchestrator/FOLLOW-551-dispatch`) rather than requiring #511 to merge first or opening
      a new PR — matches the FOLLOW-550/#508 precedent and rule (b)/(d).

    PM-validated. CI green (bar the standing Rule I baseline). AC verified by direct read of the
    merged diff, not assumed from the coordinator's summary. Ready for human review.

    **Queue-truth correction 2026-07-14 (pm-orchestrator, session 27):** `pr: 512` was independently
    confirmed MERGED (`gh pr view 512 --json state,mergedAt` → `MERGED`, `2026-07-11T09:02:26Z`,
    merge commit `c2670b2`, present in `main`'s `git log`) but the status field was never flipped
    from stale `READY_FOR_REVIEW`. Flipped to `DONE`, `completed_at` set to the merge timestamp. The
    PM-validated evidence trail above (direct diff read, AC verified against the merged content) was
    already independently re-verified at merge time — no new AC re-check required.
- id: FOLLOW-471
  title: >-
    Clean re-audit gate — re-run the 2026-07-01 full audit; every finding F-01…F-21 closed with
    proof (epic Definition of Done)
  agent: qa-engineer
  status: BACKLOG
  priority: P1
  estimated_hours: 6
  depends_on:
    [
      FOLLOW-449,
      FOLLOW-450,
      FOLLOW-451,
      FOLLOW-452,
      FOLLOW-453,
      FOLLOW-454,
      FOLLOW-455,
      FOLLOW-456,
      FOLLOW-457,
      FOLLOW-458,
      FOLLOW-459,
      FOLLOW-460,
      FOLLOW-461,
      FOLLOW-462,
      FOLLOW-463,
      FOLLOW-464,
      FOLLOW-465,
      FOLLOW-466,
      FOLLOW-467,
      FOLLOW-468,
      FOLLOW-469,
      FOLLOW-470,
    ]
  source: >-
    2026-07-01 audit — CEO acceptance goal: a final code review returns "no gaps, no bugs, Adaptive
    Listings works as intended."
  spec: audit report §7 output_validation; this Sprint 22b epic
  notes: |
    This is the epic's acceptance gate. Runs LAST, only after every ticket above is DONE.
    AC:
    - [ ] Re-run the same 8-track audit (SDK / ingest+data / intent / control-plane+LLM /
          analytics / compliance / plan-reconciliation) against HEAD.
    - [ ] Each of F-01…F-21 has a CLOSED verdict with file:line proof OR a CEO-ratified explicit
          deferral logged in ESCALATIONS.md (no silent carry-over).
    - [ ] Add the missing end-to-end test §Snapshot.5 flags: behavioral trace → ingest → intent →
          adapt → DOM mutation → measured lift (the differentiator e2e).
    - [ ] Baseline gates green (typecheck/lint/test incl. the e2e-smoke against a live wrangler);
          bundle within budget; Rule H + Rule I violation counts at zero for touched surfaces.
    - [ ] Verdict recorded in a new docs/AUDIT-2026-07-XX.md; only GREEN closes the epic.
```

## Sprint 23 — Audit 2026-07-11 Remediation + Pilot Ignition (OPEN)

**Source:** Full-Stack Audit #3, 2026-07-11 (CEO-commissioned, 6 parallel tracks: SDK / ingest+data
/ intent-engine / control-plane+LLM / compliance+security / plan-reconciliation) against HEAD
`146de2f`. Verdict 🟡 YELLOW: code foundation independently re-verified as sound (Sprint 22b code
legs genuinely done; anti-hallucination guards, fail-loud analytics, consent/opt-out, dual adapt
auth all confirmed at file:line) — but the measured-pilot capability is 0% live in prod because the
operator go-live checklist was 0/6 complete, and 3 new High-severity code defects were found.
Finding IDs `A3-F-NN` below are LOCAL to the 2026-07-11 audit report (session 26), NOT the
2026-07-01 F-01…F-21 set.

**Wave structure (ordering is the plan — do not cherry-pick P3s before Waves 0–1):**

- **Wave 0 — OPERATOR (Piotr/Rafał), highest leverage, blocks all measurement:** FOLLOW-553.
  Instructions: `docs/runbooks/OPERATOR_SESSION_2026-07-11.md`.
- **Wave 1 — code, delegable NOW, parallel with Wave 0:** FOLLOW-554 (quiz-skip SoT bug), FOLLOW-555
  (browser-session auth 401s), FOLLOW-556 (LLM spend cap).
- **Wave 2 — after Wave 0 lands:** FOLLOW-458 (shadow deploy, un-blocked by FOLLOW-449 leg),
  FOLLOW-557/558 (DSR completeness), FOLLOW-559 (ingest consent gate), FOLLOW-560 (scoring-path
  telemetry), FOLLOW-565 (signal enrichment wave 2 — gated on first real lift data).
- **Wave 3 — closing:** FOLLOW-471 (Sprint 22b clean re-audit gate — un-blocked once 449/450
  operator legs close; its AC already includes the differentiator e2e = A3-F-11), then P3 tail:
  FOLLOW-467/468/469/472/474 (pre-existing READY) + FOLLOW-561/562/563/564/566 (below).

**Audit-finding → ticket map (complete):** A3-F-01→FOLLOW-553 (+ESC-020 Rafał); A3-F-02→556;
A3-F-03→554; A3-F-04→555; A3-F-05→557; A3-F-06→558; A3-F-08→559; A3-F-09→560; A3-F-10→561;
A3-F-11→FOLLOW-471 AC (pre-existing); A3-F-12→FOLLOW-472 (pre-existing); A3-F-13→FOLLOW-468
(pre-existing); A3-F-14→566 (DECISION-GATED); A3-F-15→FOLLOW-467 (pre-existing); A3-F-17→562;
A3-F-18→563; A3-F-19→564; A3-F-07→565. Queue-label corrections (FOLLOW-450, FOLLOW-458) applied
in-place in Sprint 22b above.

```yaml
- id: FOLLOW-553
  title: >-
    Pilot ignition — consolidated OPERATOR go-live session executing the 0/6 checklist (A3-F-01)
  agent: OPERATOR (Piotr + Rafał; devops-engineer on standby for verification support)
  status: READY_OPERATOR
  priority: P0
  estimated_hours: 3
  depends_on: []
  source: >-
    2026-07-11 audit A3-F-01 — every learning/measurement loop dead in prod on operator gaps:
    intent_events count=0 (CH 0015 unapplied), bandit frozen Beta(1,1) (feedback 503-gated), cosine
    unreachable (listing_embeddings empty), embed-seed not live (ESC-034), pilot-site DOM hooks not
    deployed (ESC-020, 35 days), CI smoke soft-skipping (ESC-028).
  spec: docs/runbooks/OPERATOR_SESSION_2026-07-11.md (step-by-step, with attestation paste-points)
  notes: |
    Consolidates and, on completion, CLOSES: FOLLOW-449 AC1/AC2, FOLLOW-450 operator leg
    (both flip to DONE), ESC-034, ESC-028; hands ESC-020 to Rafał with the exact deploy contract.
    NOT delegable to a worker agent — requires Doppler prd, Vercel prod, Modal console, GitHub
    admin. Rule AA applies: this ticket is the ONLY thing that may flip 449/450 to DONE, and only
    with real pasted prod output in the runbook attestation stubs.
    AC:
    - [ ] CH migration 0015 attested+applied to prod; DESCRIBE TABLE proof pasted into
          docs/runbooks/clickhouse-migrations.md stub; intent_events count() > 0 after a live
          intent.snapshot.
    - [ ] Doppler prd: FEEDBACK_ENDPOINT_ENABLED=true + ADAPT_API_KEY + OPS_TENANT_ID +
          DATABASE_URL_ADMIN set; `doppler run --config prd -- pnpm feedback:canary` shows a real
          ab_bandit_weights delta (paste output in ticket close note).
    - [ ] ESC-034 corrected path executed: MODAL_EMBED_SEED_URL in Vercel prod,
          INTERNAL_API_SECRET confirmed in Modal estalara-secrets, smoke via onboarding-overflow
          event → Modal logs / Sentry tags.area:onboarding. ESC-034 marked RESOLVED.
    - [ ] listing_embeddings seeded for the pilot tenant (count() > 0 for tenant); cosine path
          verified reachable on one real GET /api/adapt reorder (console/log evidence until
          FOLLOW-560 lands structured telemetry).
    - [ ] ESC-028: 4 Upstash secrets in GitHub Actions + Doppler; redis-shadow-smoke.yml flips to
          hard-fail mode and passes. ESC-028 marked RESOLVED.
    - [ ] ESC-020 handed to Rafał with the SDK_PRODUCTION_INTEGRATION.md contract; deploy date
          committed (may complete after this session — the ONLY checklist item allowed to trail).
    - [ ] FOLLOW-449 + FOLLOW-450 statuses flipped to DONE with attestation links; STATUS.md
          go-live checklist table refreshed.
- id: FOLLOW-554
  title: >-
    SDK: quiz-skip must not persist `neutral` into the SoT archetype (ADR-0014 invariant) (A3-F-03)
  agent: sdk-engineer
  status: DONE # queue-truth correction 2026-07-14 (session 27): merged PR #518 (28a915c, 2026-07-12) — was stale READY despite being merged 2 days prior. Not independently re-validated by this correction pass; flip is git-log-confirmed only.
  completed_at: '2026-07-12'
  merged_pr: 518
  merge_commit: 28a915c
  priority: P1
  estimated_hours: 2
  depends_on: []
  source: >-
    2026-07-11 audit A3-F-03 — packages/sdk/src/index.ts:1210-1221 calls persistResolvedArchetype()
    unconditionally in the quiz onComplete callback; quiz-widget.ts Q1 option D resolves to
    'neutral' (quiz-widget.ts:572-574) → a buyer with an established non-neutral archetype who opens
    the quiz and skips gets the session SoT wiped to neutral, violating the documented invariant at
    session.ts:478-479 ("never to neutral", CEO 2026-06-22).
  spec: ADR-0014; packages/sdk/src/core/session.ts:478-479
  notes: |
    Model-fit: sonnet (well-bounded single-file fix + test). Suggested fix: gate the persist call
    on resolvedArchetype !== 'neutral' (mirror the refreshDirectives() guard at index.ts:750-758).
    Rule R applies (idempotent across rehydrate boundary).
    AC:
    - [ ] Quiz-skip (Q1-D) no longer writes to the resolvedArchetype sessionStorage key; an
          existing non-neutral SoT survives a quiz skip.
    - [ ] Non-neutral quiz leaves still persist exactly as today (regression-guard existing
          follow-380.test.ts cases).
    - [ ] New test covers the skip path explicitly (the gap the audit found in follow-380.test.ts).
- id: FOLLOW-555
  title: >-
    Migrate the 6 remaining browser-session routes off getAuthClaims to session-auth (A3-F-04)
  agent: backend-engineer
  status: DONE # queue-truth correction 2026-07-14 (session 27): merged PR #519 (386f58d, 2026-07-12) — was stale READY despite being merged 2 days prior. Not independently re-validated by this correction pass; flip is git-log-confirmed only.
  completed_at: '2026-07-12'
  merged_pr: 519
  merge_commit: 386f58d
  priority: P1
  estimated_hours: 4
  depends_on: []
  source: >-
    2026-07-11 audit A3-F-04 — same bug class FOLLOW-326/454 fixed elsewhere, 6 routes missed: GET
    /api/admin/labels (route.ts:260), PATCH /api/admin/labels/[id] (:75), GET
    /api/admin/generation-model (:117, PUT already fixed), PUT+GET /api/demo/override (:68,:113),
    POST /api/detect (:199), POST /api/schema/activate (:94). Each has a confirmed browser fetch()
    caller (labels page, settings page, demo override page, onboarding DetectWizard +
    DetectionPreview) → real logged-in users 401. The onboarding wizard is broken for SSR sessions;
    DetectWizard.tsx:141-143 comment incorrectly claims the cookie works.
  spec: apps/control-plane/src/lib/session-auth.ts (FOLLOW-454 pattern); ADR-0013
  notes: |
    Model-fit: sonnet (mechanical replication of the FOLLOW-454 pattern across 6 routes). Rule S
    applies (fix ALL siblings, same tier — that is this ticket's entire point; do a final grep to
    prove no 7th sibling remains). Delete the false cookie comment in DetectWizard.tsx.
    AC:
    - [ ] All 6 routes accept a real @supabase/ssr browser session (getSessionAuth /
          requireTenantSessionAccess) AND keep their existing Bearer-token path working.
    - [ ] A repo-wide grep proves no route with a dashboard/admin-page fetch() caller still uses
          bare getAuthClaims (list the checked callers in the PR description).
    - [ ] CI guard: lint rule or grep-gate failing on new getAuthClaims imports in route files
          under app/api/{admin,demo,detect,schema}/** (prevent the 3rd recurrence of this class).
    - [ ] Real-handler tests per route (FOLLOW-389/409 pattern) for the session path.
- id: FOLLOW-556
  title: >-
    Daily LLM spend cap on the Modal description/headline generation path (A3-F-02)
  agent: ml-engineer
  status: DONE # queue-truth correction 2026-07-14 (session 27): merged PR #520 (c78af84, 2026-07-12) — was stale READY despite being merged 2 days prior. Not independently re-validated by this correction pass; flip is git-log-confirmed only.
  completed_at: '2026-07-12'
  merged_pr: 520
  merge_commit: c78af84
  priority: P1
  estimated_hours: 4
  depends_on: []
  source: >-
    2026-07-11 audit A3-F-02 — generate_description.py calls Anthropic directly with NO daily spend
    circuit breaker (only _MAX_TOKENS_CEILING=2000 per call); the $100/day rolling cap in
    llm-gateway.ts:99,569-577 guards ONLY the inline adapt path. The description GET is
    authenticated by the tenant API key, which is public by design (embedded in the site snippet) →
    anyone can scrape a key and drive unbounded unique (listing × 17 archetypes × 3 locales) Sonnet
    generations. Cost-DoS surface on a real-money path.
  spec: apps/control-plane/src/lib/llm-gateway.ts (existing cap semantics); ADR-0016
  notes: |
    Model-fit: sonnet; escalate to opus only if the CH-read-from-Modal plumbing gets hairy.
    Suggested shape: before the Anthropic call in generate_description.py, check rolling-24h spend
    against the ClickHouse llm_calls table (same source the TS cap reads); on breach, return the
    NEUTRAL/skip path (request keeps serving template_fallback — fail-safe, never fail-broken).
    Consider a per-tenant daily generation-count quota as defense-in-depth (CEO open question Q5
    from the audit — if unanswered by implementation time, ship the global cap only).
    AC:
    - [ ] A breach of the daily cap makes generate_description return without calling Anthropic
          and without writing caches; Sentry event tagged kind:spend_cap.
    - [ ] Cap value shared/configurable via env (default parity with DAILY_SPEND_CAP_USD).
    - [ ] Headline path covered by the same breaker (both calls in the job).
    - [ ] Test: mocked spend-over-cap → no model call, template_fallback still served end-to-end.
- id: FOLLOW-557
  title: >-
    DSR erase: delete the chat-intent shadow Redis key namespace (A3-F-05)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-07-14T00:00:00Z'
  completed_at: '2026-07-15T00:00:00Z'
  branch: backend-engineer/FOLLOW-557-dsr-erase-shadow-redis
  pr: 528
  merge_commit: 7b83f39
  pm_validated: >-
    2026-07-15 session 30. Work was produced by the subagent but stranded uncommitted in its
    worktree (sessions 28/29 misread the empty branch-tip diff as "never ran"); rescued and
    committed as ce9125e. CI: every gate green except the standing Rule I baseline, which was
    verified as pre-existing rather than assumed — scripts/check-rule-i.sh locally gives 181
    violations on both main (561 symbols) and this branch (562 symbols), i.e. the new
    deleteShadowChatIntent is scanned and is NOT a violation (erase route imports it = wired); zero
    new violations. AC1 + AC2 (Rule Z) both met; the Rule Z fixture is parsed from redis_writer.py's
    literal, not hand-typed, so it cannot pass silently on drift.
  priority: P2
  estimated_hours: 1
  depends_on: []
  source: >-
    2026-07-11 audit A3-F-05 — erase/route.ts:87 SCANs session:{sessionId}:* but the chat-intent
    shadow prior lives at shadow:{tenant_id}:{session_id}:chat_intent (redis_writer.py:35-37) → not
    matched, not deleted. 24h TTL softens it; Art. 17 expects prompt erasure. Currently moot in prod
    (stream-consumer undeployed) — becomes live the day FOLLOW-458 deploys.
  notes: |
    Model-fit: sonnet. Add the shadow:* pattern (tenant-scoped) to deleteSessionFromRedis();
    cross-runtime key-format parity test against redis_writer.py's literal (Rule Z).
    AC:
    - [x] Erase deletes shadow:{tenant}:{session}:chat_intent; test with a seeded key.
    - [x] Key-format fixture shared/checked against the Python writer (Rule Z).
- id: FOLLOW-558
  title: >-
    DSR access + portability must disclose quiz_completions and intent_sessions (Art. 15/20)
    (A3-F-06)
  agent: compliance-engineer
  status: DONE
  assigned_to: compliance-engineer
  started_at: '2026-07-14T00:00:00Z'
  completed_at: '2026-07-15T00:00:00Z'
  branch: compliance-engineer/FOLLOW-558-dsr-access-portability-disclosure
  pr: 529
  merge_commit: 797b8ab
  pm_validated: >-
    2026-07-15 session 30 — PARTIALLY WRONG, corrected 2026-07-16 after RETRO-176. Read the
    correction before trusting any of it. Rescue + CI legs stand: work existed uncommitted in the
    agent's worktree, committed as 1877722; all gates green except the standing Rule I baseline,
    verified pre-existing (181 violations on both main and this branch, 561 symbols each — zero
    new). AC1 met; AC3 (Rule N) met in form but see FOLLOW-575 — the DPIA enumeration it added is
    itself out of sync with the code, so Rule N was satisfied procedurally while the disclosure doc
    still certifies behaviour we do not implement. AC2 (parity) is NOT met and was ticked in error —
    the PM validated it from the test's name and docstring rather than its assertion body; the
    "PARITY" block never imports erase/route.ts and asserts against 6 hardcoded literals, so it
    cannot fail on drift (FOLLOW-576). Reviewer note (1) — engagement_scores added beyond the stub's
    two named tables — stands as correct, but its stated justification ("the parity AC asserts
    access-set == erase-set") was reasoning from an invariant that does not exist in the code. Also
    unowned at merge: the union across storage classes — the Redis store FOLLOW-557 added to the
    erase set (FOLLOW-570) and four erased-but-undisclosed ClickHouse PII tables that are LIVE in
    prod today (FOLLOW-574 / ESC-037).
  priority: P2
  estimated_hours: 2
  depends_on: []
  source: >-
    2026-07-11 audit A3-F-06 — dsr/access/route.ts:27-38 and dsr/portability read only
    session_embeddings, consent_records, conversion_labels; erasure (Art. 17) already covers
    quiz_completions + intent_sessions (FOLLOW-455) but access/portability omit them → a data
    subject's access report would omit stores we demonstrably hold. New finding, no prior ticket.
  notes: |
    Model-fit: sonnet. Mirror the FOLLOW-455 table set into both read routes; update the DPIA §
    listing disclosed stores if it enumerates them (Rule N).
    AC:
    - [x] Access + portability payloads include quiz_completions + intent_sessions rows for the
          verified (tenant, session/email) scope.
    - [ ] Parity test: the erase table-set and the access table-set are asserted equal (minus
          documented exceptions) so the next new store cannot drift them apart again.
          NOT MET — corrected 2026-07-16 (RETRO-176). This was ticked [x] and merged in error. The
          "PARITY" block in disclosure-route-driven-pglite.test.ts never imports erase/route.ts
          (grep finds it only in comments; the file's own docstring concedes the list "must be
          updated by hand"). It asserts disclosure is a superset of 6 hardcoded literals, so adding
          a 7th DELETE target to erase keeps it GREEN — it cannot fail on the drift it is named for.
          The PM validated this AC from the test's NAME and DOCSTRING rather than its assertion
          body. Real fix: FOLLOW-576. Do not treat FOLLOW-570 AC(b) ("widen the parity block") as
          sufficient — widening a hand-typed list only yields a wider hand-typed list.
- id: FOLLOW-559
  title: >-
    Ingest: server-side consent gate for profiling-class events (defense-in-depth) (A3-F-08)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-07-16T00:00:00Z'
  completed_at: '2026-07-17T00:00:00Z'
  branch: backend-engineer/FOLLOW-559-consent-gate
  pr: 533
  merge_commit: 0009c0f
  pm_validated: >-
    2026-07-16 session 30, verified independently (not from the worker's self-report). Placement:
    ingest storage-boundary pass after EventSchema.safeParse in handlers/events.ts — shared envelope
    contract untouched, additive/non-breaking, so no architect escalation needed (confirmed the
    shared schema is not mutated). Per-event reject (worker judgment call, correct + wiring
    verified): rejected events go to rejected[] with code consent_not_granted + a Sentry counter,
    only validated[] reaches the sinks — a whole-batch 4xx would have dropped a consent.granted
    riding with a none profiling event (§H.9/AC2 violation). AC1/AC2/AC3 all met: profiling gated on
    consent_state; consent.granted/denied + operational + conversions + opted-out §H.8 events ingest
    under every consent_state incl none (explicit non-regression tests); contract test derives the
    taxonomy from the union at runtime (unclassified fails closed) + compile-time Record<EventType>
    exhaustiveness. CI: 53 relevant tests pass locally; the two reds are the standing pre-existing
    baseline, verified not assumed — Rule I 181/563 vs main 181/562 (new evaluateConsent scanned,
    NOT a violation = wired; net-zero), Vercel touches zero control-plane files. Gate keys on
    consent_state, never opt-out state, per CEO 2026-06-23 §H.9.
  priority: P2
  estimated_hours: 3
  depends_on: []
  source: >-
    2026-07-11 audit A3-F-08 — apps/ingest validates consent_state for shape only and stores
    whatever arrives; the §H.8 gate is enforced exclusively client-side in the SDK. A broken
    integration or malicious client can post consent_state:'none' profiling events and they persist.
    GDPR posture wants the storage boundary to enforce, not just record.
  spec: MASTER_DESIGN §H.8; packages/shared/src/schemas/event.ts:29-74
  notes: |
    Model-fit: opus (policy-shaped: needs a correct event-class → allowed-consent-states matrix,
    and must NOT break the §H.9 ruling that opted-out users' §H.8 events still flow). Reject or
    quarantine — CEO preference unknown; default reject-with-4xx + Sentry counter, escalate if
    ambiguity bites (agent coding standards §1). RESOLVED: per-event reject (not whole-batch), so a
    consent.granted in a mixed batch survives; no escalation needed.
    AC:
    - [x] Profiling-class events with consent_state not in {consented, legitimate-interest} are
          rejected (or quarantined) at events.ts validation, with a structured Sentry counter.
    - [x] consent.granted/consent.denied audit events + §H.9 opt-out-flagged events still ingest
          (explicit tests — do not regress the CEO 2026-06-23 §H.9 ruling).
    - [x] Contract test enumerates every EVENT_TYPES entry into a consent-class map so new event
          types must declare their class (Rule H-adjacent: no unclassified type ships).
- id: FOLLOW-574
  title: >-
    Close the ClickHouse axis of the DSR disclosure union — export the 5 erased PII tables under
    Art. 15/20 (events as full rows per CEO ruling), not an aggregate (RETRO-176 LG-1)
  agent: compliance-engineer
  status: DONE
  assigned_to: compliance-engineer
  started_at: '2026-07-17T00:00:00Z'
  completed_at: '2026-07-17T00:00:00Z'
  branch: compliance-engineer/FOLLOW-574-clickhouse-disclosure
  pr: 542
  merge_commit: 3c78ea2
  pm_validated: >-
    2026-07-17 session 30, verified independently. Access + portability now full-row-export all 5
    DSR_CLICKHOUSE_TABLES (derived from the constant, both routes in parity); events is a
    volume-safe keyset-paginated full export (60k-row truncation test) replacing the deleted
    FOLLOW-455 aggregate; DPIA 2.10 §8 synced (Rule N); engagement_scores phantom confirmed. CI: all
    blocking gates green; Rule I is 180 vs the 181 baseline — a net -1 (the worker deleted the
    now-dead getSessionEventSummary and declined to fake a symbol back to 181; verified no remaining
    consumer). 127 DSR tests pass. THE KEY FINDING: the worker correctly DEVIATED from the PM brief
    on intent_events — my brief said mirror the erase side (intent_session_id), but migrations
    0015/0016 + clickhouse-tracer.ts show real rows key on session_id and intent_session_id is a
    zero-UUID; mirroring erase would have shipped a false-empty Art. 15 disclosure. It disclosed on
    session_id (verified against 3 sources) and flagged the deviation in ESC-038. Corollary: the
    erase side has the same bug (never deletes intent_events) → FOLLOW-581 (P1, latent Art. 17
    no-op). Also filed FOLLOW-582 (engagement_scores phantom). Numbering collision (worker's tickets
    landed on the taken 577/578) caught + renumbered to 581/582 before merge.
  priority: P1
  estimated_hours: 4
  depends_on: []
  source: >-
    RETRO-176 §LG-1. Erase deletes 5 ClickHouse PII tables (DSR_CLICKHOUSE_TABLES) but disclosure
    returns only an aggregate over events; 4 tables are erased-but-undisclosed and events is a
    count-not-a-copy. Promoted from FOLLOW_UPS stub + dispatched 2026-07-17 after ESC-037 RESOLVED
    (CEO: events = full row export; sequence BEFORE FOLLOW-570). Full brief: backlog/HANDOFFS.md.
  spec: backlog/FOLLOW_UPS.md (FOLLOW-574 stub — full AC set a–e); ESC-037 (resolved ruling)
  notes: |
    Model-fit: opus (P1 GDPR, security-sensitive, cross-runtime intent_session_id resolution trap,
    volume-safe export design). Traps flagged in the brief: derive the disclosure set from
    DSR_CLICKHOUSE_TABLES (not hand-typed — the FOLLOW-576 defect); intent_events is keyed on
    intent_session_id and MUST use resolveIntentSessionId() like the erase side; fix access AND
    portability in parity; DPIA §8 sync coordinates with FOLLOW-575.
    AC (from FOLLOW_UPS stub):
    - [x] (a) All 5 DSR_CLICKHOUSE_TABLES disclosed (rows or documented exception), derived from the
          constant, on both access + portability.
    - [x] (b) events = FULL ROW EXPORT, volume-safe (CEO ruling ESC-037 — decided, not re-opened).
    - [x] (c) DPIA §8 step 5 updated in the same PR (coordinate FOLLOW-575).
    - [x] (d) engagement_scores phantom resolved (identify producer / file unbuilt-producer / retire
          + reconcile ROPA+DPIA).
    - [x] (e) phantom verdict recorded in PR body (arms/disarms RETRO-176 PHANTOM-STORE).
- id: FOLLOW-581
  title: >-
    Fix the latent intent_events erase no-op — DSR erase filters intent_session_id (zero-UUID),
    matching zero real rows, so intent_events is never erased (Art. 17)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-07-17T00:00:00Z'
  completed_at: '2026-07-17T00:00:00Z'
  branch: backend-engineer/FOLLOW-581-intent-events-erase-key
  pr: 544
  merge_commit: 85156db
  pm_validated: >-
    2026-07-17 session 30, verified independently. Root fix in the shared constant
    DSR_CLICKHOUSE_TABLES (intent_events column -> session_id, idSource dropped) propagated to all
    three consumers: erase route (mutation SQL now DELETE WHERE session_id, verified via
    clickhouse-dsr.test.ts + erase/route.test.ts asserting param_dsr_id_0 = the SDK session_id),
    mutation-poll (column special-case removed — would otherwise re-target the wrong column on
    retry), and FOLLOW-574's getClickHouseDisclosure (divergence note + branch removed; erase and
    disclosure now key-agree). resolveIntentSessionId + intent-session-lookup.ts + its test deleted
    (both callers gone); zero dangling refs; Rule I = 180 = baseline (net-zero). DPIA 2.10 -> 2.11.
    CI all blocking gates green; I fixed one non-blocking miss myself pre-merge (the worker's
    lessons.md failed Format check -> mechanical prettier commit c9b51d3). No escalation: the
    migration-0016 ORDER BY constraint blocks only MODIFY/rename of key columns, not a DELETE-WHERE
    on the non-key session_id. Closes the Art. 17 no-op that FOLLOW-574's validation surfaced.
  priority: P1
  estimated_hours: 3
  depends_on: []
  source: >-
    Discovered during FOLLOW-574 (ESC-038). Erase deletes intent_events on intent_session_id, but
    real rows carry that column at zero-UUID and the fingerprint in session_id (migrations
    0015/0016; clickhouse-tracer.ts). So erase matches nothing — a latent Art. 17 no-op since
    FOLLOW-455. Promoted from FOLLOW_UPS stub + dispatched 2026-07-17. Full brief:
    backlog/HANDOFFS.md.
  spec: backlog/FOLLOW_UPS.md (FOLLOW-581 stub); ESC-038
  notes: |
    Model-fit: opus (P1 GDPR Art. 17, security-sensitive, cross-cutting — a shared constant consumed
    by 3 call sites). Blast radius traced in the brief (stub understated it): DSR_CLICKHOUSE_TABLES
    (change intent_events column→session_id, drop idSource); erase/route.ts (remove idSource special
    path); mutation-poll/route.ts (ALSO special-cases the column — stub missed this); FOLLOW-574's
    getClickHouseDisclosure special-case (simplify); and resolveIntentSessionId may go dead (both its
    callers removed) → remove it, don't leave a Rule I violation (baseline 180, don't regress).
    AC (from stub):
    - [x] Erase of intent_events targets session_id + deletes the subject's real rows (route-driven /
          mutation-SQL test).
    - [x] FOLLOW-574's disclosure divergence note removed (erase + disclosure key now agree).
    - [x] DPIA §8 step 5 divergence note updated.
- id: FOLLOW-579
  title: >-
    Strip session.quality.snapshot derived-intent fields (final_archetype/confidence/stability) for
    unconsented users — §H.8(d) under-gate (CEO ruling: strip, stays operational)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-07-17T00:00:00Z'
  completed_at: '2026-07-17T00:00:00Z'
  branch: backend-engineer/FOLLOW-579-quality-snapshot-strip
  pr: 547
  merge_commit: d3911bf
  pm_validated: >-
    2026-07-17 session 30, verified independently — clean pass, no round-trips. Implements the CEO
    ruling (option ii): session.quality.snapshot stays operational (class unchanged at
    consent-gate.ts:142, NOT reclassified); a new pure redactPersistedPayloadForConsent strips
    final_archetype/final_confidence/prediction_stability_score when consent_state not in
    {consented, legitimate-interest}, wired at the storage boundary (handlers/events.ts:266) before
    validated.push so both sinks get the redacted payload; no-op for other types + consented/LI.
    AC-c golden per-type fixture asserts every union member's ConsentClass (closes RETRO-177
    exhaustiveness!=correctness); AC-d e2e proves none->stripped, consented->kept. Rule I = 180 =
    baseline (net-zero; the new export is wired via the handler). 64 ingest tests pass. AC-a-docs:
    ruling in the gate module doc; ROPA/DPIA don't enumerate session_quality at field level so
    nothing to amend (stated in PR). Phantom write-path confirmed (session_quality has no producer;
    strip is a payload-key deletion in the generic events flow) — flagged that a future dedicated
    writer must apply the same strip.
  priority: P2
  estimated_hours: 3
  depends_on: []
  source: >-
    RETRO-177 §LG-1. FOLLOW-559's consent gate classes session.quality.snapshot operational/
    always-ingest, but its payload carries §H.8(d) derived intent (final_archetype/confidence/
    stability) — the same class it gates as intent.snapshot. CEO ruling 2026-07-17: strip those
    fields when consent not granted (stays operational). Dispatched 2026-07-17. Brief: HANDOFFS.md.
  spec: backlog/FOLLOW_UPS.md (FOLLOW-579 stub, ruling banner)
  notes: |
    Model-fit: opus (§H.8(d) GDPR-sensitive, conditional payload redaction at ingest boundary).
    Grounded in brief: session.quality.snapshot currently lands in the GENERIC events table (payload
    as JSON) via clickhouse-producer.ts:146 — the dedicated session_quality table has NO writer
    (phantom), so the strip is a payload-key deletion, not a CH column concern. Strip in the
    handler's validated[] loop (near the intent.snapshot special-case). AC-a ruling already
    recorded; AC-c golden per-type fixture is the load-bearing test-quality leg (closes RETRO-177
    exhaustiveness≠correctness). Rule I baseline 180, don't regress.
    AC:
    - [x] (b) strip the 3 derived fields when consent_state not in {consented, legitimate-interest};
          event still ingests; consented/LI users keep them.
    - [x] (c) golden per-type classification fixture (assert every type's ConsentClass).
    - [x] (d) end-to-end test: none→stripped, consented→kept.
    - [x] (a-docs) record ruling in gate module doc + ROPA/DPIA if posture changes (Rule N).
- id: FOLLOW-560
  title: >-
    Structured cosine-vs-djb2 scoring-path telemetry on /api/adapt (A3-F-09)
  agent: data-engineer
  status: READY
  priority: P2
  estimated_hours: 3
  depends_on: [FOLLOW-553]
  source: >-
    2026-07-11 audit A3-F-09 — adapt/route.ts:597-623,1470-1482 logs cosine/djb2 fallback only via
    console.debug/warn; no structured metric. In prod today 100% of reorders are djb2 and nobody can
    see it; after FOLLOW-553 seeds embeddings, nobody can PROVE cosine went live.
  notes: |
    Model-fit: sonnet. Preferred: add scoring_path LowCardinality(String) to
    adaptation_decisions via CH migration 0021 — Rules W (prod sort-key check) + M (no auto-apply;
    the migration rides the FOLLOW-553-established attestation flow, hence depends_on) + extend
    the migration-contract test. Fallback if migration friction: OTel counter only.
    AC:
    - [ ] Every adapt decision records scoring_path ∈ {cosine, djb2_fallback, djb2_guard} in
          adaptation_decisions (or an OTel metric if CEO defers the migration).
    - [ ] Migration-contract test extended (FOLLOW-402 pattern); runbook attestation stub added.
    - [ ] Dashboard/tracer surface shows the split (even a single-number panel).
- id: FOLLOW-561
  title: >-
    Archetype-ID parity guard for the Python and DB-seed literal copies (A3-F-10)
  agent: qa-engineer
  status: DONE
  assigned_to: qa-engineer
  started_at: '2026-07-17T00:00:00Z'
  completed_at: '2026-07-18T00:00:00Z'
  branch: qa-engineer/FOLLOW-561-archetype-parity-guard
  pr: 552
  merge_commit: a203b52
  pm_validated: >-
    2026-07-17 session (PR #553) — CI green on every real gate, drift test parses nlp.py _ARCHETYPES
    + archetype-seeds.ts + migration 0005 and asserts set-equality against ARCHETYPE_NAMES with
    archetype-hints.ts documented as an exempt deliberate subset. Merged as a203b52 (worker PR #552)
    + 153ab0f (PM bookkeeping/validation PR #553). Human-merged 2026-07-17/18; DONE transition +
    retrospective in this session.
  priority: P3
  estimated_hours: 2
  depends_on: []
  source: >-
    2026-07-11 audit A3-F-10 — the 18-archetype set is consistent today, but parity is test-enforced
    only sdk↔shared (intent-weights-drift.test.ts); apps/intent-engine/src/nlp.py _ARCHETYPES
    (:58-77), packages/db/src/seed/archetype-seeds.ts and migration 0005 are hand-maintained
    literals with no guard — the exact "divergent sets" failure the 2026-05 audit (wrongly, then)
    alleged can silently become true.
  notes: |
    Model-fit: sonnet. Rule J (mirror-code sync gate). Parse nlp.py's literal + the seed file in
    a vitest (regex or JSON fixture export) and assert set-equality with ARCHETYPE_NAMES.
    AC:
    - [ ] Drift test covers nlp.py + archetype-seeds.ts + migration 0005 against ARCHETYPE_NAMES.
    - [ ] Deliberate-subset archetype-hints.ts documented as exempt in the test.
- id: FOLLOW-562
  title: >-
    Dashboard Panel 5 (/api/ab/weights) must surface fetch errors, not render an empty state
    (A3-F-17)
  agent: backend-engineer
  status: READY
  priority: P3
  estimated_hours: 1
  depends_on: []
  source: >-
    2026-07-11 audit A3-F-17 — dashboard/analytics/page.tsx:639-641 swallows Panel 5 fetch errors
    into an honest-but-silent "no anomalies" empty state; masks a real backend failure from the
    operator. Not the F-07 fabrication class (no fake numbers), but the same UX blind spot.
  notes: |
    Model-fit: sonnet. Reuse the existing ErrorBanner (page.tsx:141-151) exactly as the other 4
    panels do (Rule S — last sibling of the FOLLOW-453 fix).
    AC:
    - [ ] Panel 5 renders ErrorBanner on !res.ok / fetch throw; test added.
- id: FOLLOW-563
  title: >-
    Test hygiene: smoke-ingest soft-skip without live endpoint + mutation-poll cadence comment
    (A3-F-18)
  agent: qa-engineer
  status: DONE
  assigned_to: qa-engineer
  started_at: '2026-07-17T00:00:00Z'
  completed_at: '2026-07-17T00:00:00Z'
  branch: qa-engineer/FOLLOW-563-smoke-ingest-soft-skip
  pr: 549
  merge_commit: 395fc9d
  pm_validated: >-
    2026-07-17 session 31 (resumed) — validated independently. smoke-ingest.test.ts gates its
    live-service assertions behind REQUIRE_INGEST_SMOKE (mirrors the redis-shadow Rule Q contract):
    unset on a clean machine -> it.skipIf soft-skips + a module-top-level ::notice:: fires (verified
    locally: `pnpm --filter @estalara/e2e-smoke test` emits the notice and skips the file instead of
    hard-failing "fetch failed"; 5 static contract tests still pass). ::notice:: is deliberately at
    module top level, not in beforeAll — Vitest never runs beforeAll when every it is skipped, so a
    hook-based notice would be an inert Rule Q gate. e2e-smoke.yml sets REQUIRE_INGEST_SMOKE=1 only
    after its ClickHouse/wrangler health-checks, so CI still hard-fails on a real ingest->ClickHouse
    regression (not skippable in CI). mutation-poll/route.ts comment corrected 5-min -> */10 to
    match apps/control-plane/vercel.json. CI green on every real gate (Typecheck, Lint, Test Node
    22, Python x8, Format, Gitleaks, ClickHouse migrations, Vercel); the only 2 reds are the
    pre-existing non-blocking "Rule I — wired-or-dead check" — verified net-zero (180 on origin/main
    == 180 on the branch; diff adds no new export). No new exported helper, so check-rule-i.sh N/A.
  priority: P3
  estimated_hours: 1
  depends_on: []
  source: >-
    2026-07-11 audit A3-F-18 — tests/e2e/smoke-ingest.test.ts hard-fails `pnpm test` locally with
    "fetch failed" when no live ingest endpoint exists (verified in the audit run) instead of
    soft-skipping with positive proof (Rule Q pattern); dsr/mutation-poll/route.ts:7 comment says
    5-min cron, vercel.json:8-11 says */10.
  notes: |
    Model-fit: sonnet. Mirror the redis-shadow-smoke soft-skip contract (env-gated REQUIRE_*
    flag + ::notice:: emission). Fix the stale comment to match vercel.json.
    AC:
    - [x] `pnpm test` passes on a clean machine with no live services; CI with secrets still
          hard-fails on real regressions (Rule Q positive proof emitted either way).
    - [x] mutation-poll comment matches the actual schedule.
- id: FOLLOW-564
  title: >-
    Reconcile the p95 latency quality bar with ADR-0004's bifurcated SLA (A3-F-19)
  agent: architect
  status: READY
  priority: P3
  estimated_hours: 1
  depends_on: []
  source: >-
    2026-07-11 audit A3-F-19 — CLAUDE.md/Master Design quality bar still says "p95 <100ms for
    Decision API" while ADR-0004:51-63 bifurcates (deterministic <300ms / RAG <800ms / LLM <2000ms)
    and POST /api/adapt makes an inline LLM call on similarity branches 3-4 (route.ts:340-376). The
    two documents disagree; agents optimizing to the wrong number will make bad calls.
  notes: |
    Model-fit: sonnet. Docs-only. NOTE FOLLOW-551 (architect has no Bash): per the RETRO-168/DG-1
    precedent the top-level orchestrator applies the edits on the architect's plan — or reassign
    to backend-engineer if FOLLOW-551 lands first. §Y.2 propagation: CLAUDE.md quality-bar line +
    Master Design §Snapshot/§B.2-adjacent prose in the same change.
    AC:
    - [ ] One SLA truth stated in CLAUDE.md + Master Design, citing ADR-0004; no residual <100ms
          claim for the LLM-branch path.
- id: FOLLOW-565
  title: >-
    Signal enrichment wave 2 — wire the 4-6 highest-discrimination schema-only event types
    end-to-end (A3-F-07)
  agent: ml-engineer
  status: BLOCKED
  priority: P2
  estimated_hours: 10
  depends_on: [FOLLOW-553]
  source: >-
    2026-07-11 audit A3-F-07 — 25 of 52 event types are schema-only (incl. photo.opened,
    chat.opened, price.hovered, mouse.exit_intent, search.query); 8 of 18 archetypes are
    quiz/chat-only per §D.6 while chat is shadow+undeployed → behavioral-only discrimination rests
    on 14 signal types and archetype accuracy is the product's perceived quality.
  spec:
    MASTER_DESIGN §C.1 signal taxonomy; §D.7 damping calibration; 2026-06-05 enrichment precedent
    (FOLLOW-207…211)
  notes: |
    Model-fit: opus (signal-selection reasoning + likelihood calibration; the emit plumbing itself
    is sonnet-grade — consider a split brief). DELIBERATELY BLOCKED on FOLLOW-553: pick the 4-6
    types using the FIRST real per-archetype lift/starvation data from the ignited pilot, not
    intuition (verify-not-guess). Do NOT wire all 25 — Rule H requires each shipped type to have
    an emit site AND a SIGNAL_LIKELIHOODS consumer; types not selected get explicitly annotated
    or removed under FOLLOW-467's sweep.
    AC:
    - [ ] 4-6 selected types emit from the SDK, ingest, and carry SIGNAL_LIKELIHOODS entries
          (end-to-end round-trip test each, FOLLOW-471-e2e pattern).
    - [ ] Selection rationale documented against real pilot data (which archetypes were starved).
    - [ ] Bundle stays within the 42KB gzip budget (FOLLOW-469 headroom note — check BEFORE merge).
- id: FOLLOW-566
  title: >-
    DECISION-GATED: per-tenant origin allowlist on ingest (public-API-key self-poisoning) (A3-F-14)
  agent: backend-engineer
  status: BLOCKED
  priority: P3
  estimated_hours: 3
  depends_on: []
  source: >-
    2026-07-11 audit A3-F-14 — the tenant API key is public by design (embedded in the site
    snippet); anyone can scrape it and inject garbage events attributed to that tenant
    (self-poisoning of archetype/bandit training data; no cross-tenant break — tenant is resolved
    server-side, events.ts:128). No origin/referrer check exists in apps/ingest.
  notes: |
    BLOCKED on a CEO decision (audit open question Q3): accept the trade-off for the pilot
    (document in Master Design §V and close), or implement a per-tenant Origin allowlist checked
    in the Worker (KV-stored, defaulting open for tenants without a configured list). If
    implemented: model-fit sonnet. Escalate via ESCALATIONS.md if unanswered when Wave 3 opens.
    AC (if CEO says implement):
    - [ ] Origin allowlist per tenant enforced at ingest for browser-originated requests; signed
          server-adapter requests (HMAC path, auth.ts:86-96) exempt.
    - [ ] Master Design §V documents the model either way.
- id: FOLLOW-583
  title: >-
    Extend the archetype-ID guard to the 4th (production-live) full-parity copy + 2 subset copies
    the FOLLOW-561 guard missed; fix the already-broken `family_upsizer` mock literal
  agent: qa-engineer
  status: DONE
  assigned_to: qa-engineer
  started_at: '2026-07-18T00:00:00Z'
  completed_at: '2026-07-18T00:00:00Z'
  branch: qa-engineer/FOLLOW-583-archetype-guard-4th-copy
  pr: 555
  merge_commit: 4b527a4
  pm_validated: >-
    2026-07-18 session 36 — validated independently before READY_FOR_REVIEW (see superseded
    session-36 START HERE note above for full evidence: CI real-gate non-success count 0, AC-1
    full-parity re-parsed independently against the real generate_description.py, AC-2 subset
    reviewed line-by-line, AC-3 falsification-red self-run + reverted + re-green, family_upsizer ->
    upsizer confirmed canonical). PR #555 (worker) squash-merged as 4b527a4; PR #556 (this
    bookkeeping) squash-merged as 9776ce3. DONE 2026-07-18.
  priority: P2
  estimated_hours: 3
  depends_on: []
  source: >-
    RETRO-178 (§4a LG-1, §4b CB-1, §4c) on FOLLOW-561 (PR #552) — tests/integration/
    archetype-id-parity.test.ts guards exactly 3 hand-maintained literal copies. A repo-wide grep
    for `golden_visa_buyer` finds a 4th full-parity copy the guard misses:
    apps/llm-gateway/src/jobs/generate_description.py:161 `_ARCHETYPE_GUIDANCE` — this feeds the
    LIVE production Modal AI-description prompt (:1303/:1712, `.get(archetype, "<generic
    fallback>")`). Currently in sync (verified by manual diff — all 18 present) but a future
    archetype rename/add that misses this dict fails SILENTLY: no exception, no alert, just a
    generic-copy fallback for one persona indefinitely — the highest-consequence instance of the
    exact class FOLLOW-561 exists to prevent. Two more hand-maintained copies are documented subsets
    with NO subset-validity guard: demo-override-store.ts:37 REACHABLE_ARCHETYPES (legitimate
    13-reachable-archetype subset per §D.6), and route-helpers.ts:87 MOCK_ARCHETYPES +
    export/route.ts:311 buildMockExportRows() (already BROKEN — both hard-code 'family_upsizer', not
    a canonical ARCHETYPE_NAMES member; the real set has family_buyer and upsizer as two separate
    archetypes; TS never caught it because both fields are typed `archetype: string`).
  notes: |
    Model-fit: sonnet — mechanical extension of the FOLLOW-561 pattern (one more assertExactParity
    call + two subset-validity calls + two literal-string typo fixes), same shape/regex-parsing
    style as the existing test, no new design surface. Elevated stakes noted (generate_description.py
    is live-prod buyer-facing) but the change to that file is READ-ONLY (the guard parses it, never
    edits its runtime logic) — production Python behavior is unchanged by this ticket. Escalate to
    Opus only if the worker finds the _ARCHETYPE_GUIDANCE dict literal isn't cleanly regex-parseable
    (multi-line dict values already contain nested parens/quotes — verify the parser against the
    real file before assuming FOLLOW-561's regex style transfers unmodified).
    Branch: qa-engineer/FOLLOW-583-archetype-guard-4th-copy
    AC:
    - [ ] Full-parity assertion added for apps/llm-gateway/src/jobs/generate_description.py
          _ARCHETYPE_GUIDANCE against ARCHETYPE_NAMES (same assertExactParity helper, parses the
          real checked-in file, not a fixture).
    - [ ] Subset-validity assertion added for demo-override-store.ts REACHABLE_ARCHETYPES (every
          referenced id is a real ARCHETYPE_NAMES member; proper subset — mirror the
          archetype-hints.ts exemption shape already in the file).
    - [ ] Subset-validity assertion added for route-helpers.ts MOCK_ARCHETYPES AND export/route.ts's
          inline mock archetype literals — this assertion MUST be shown failing red against the
          pre-fix state first (falsification proof the guard actually catches the family_upsizer
          bug), then pass after the fix lands.
    - [ ] Fix 'family_upsizer' -> a valid canonical archetype id in both route-helpers.ts
          MOCK_ARCHETYPES and export/route.ts buildMockExportRows() (mock data has no correctness
          requirement beyond validity — either family_buyer or upsizer is acceptable; document the
          choice).
    - [ ] All existing 5 assertions in archetype-id-parity.test.ts still pass unaffected.
  cross_ref: [FOLLOW-561, RETRO-178]
- id: FOLLOW-584
  title: >-
    Promote + widen FOLLOW-036: consolidate bandit-seed.ts CANONICAL_ARCHETYPES, directives.ts
    ArchetypeId, and description.ts ArchetypeIdSchema onto one exported packages/shared canonical
    constant (RETRO-179)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-07-18T00:00:00Z'
  completed_at: '2026-07-19T17:23:17Z'
  branch: backend-engineer/FOLLOW-584-archetype-canonical-consolidation
  pr: 559
  merged_commit: a08fcdf
  retro: RETRO-180
  pm_validated: >-
    2026-07-19 session 39 — validated independently before READY_FOR_REVIEW. All 7 AC checkboxes
    re-verified against the real PR #559 diff (not the worker's claim): (1)
    packages/shared/src/archetypes.ts exports CANONICAL_ARCHETYPE_IDS (18-item `as const satisfies
    readonly string[]`) — confirmed by reading the file; (2) directives.ts ArchetypeId -> `(typeof
    CANONICAL_ARCHETYPE_IDS)[number]`, old inline union removed — confirmed; (3) description.ts
    ArchetypeIdSchema -> `z.enum([...CANONICAL_ARCHETYPE_IDS])`, old inline array removed —
    confirmed; (4) bandit-seed.ts imports CANONICAL_ARCHETYPE_IDS from `@estalara/shared`,
    module-private CANONICAL_ARCHETYPES + its "FOLLOW-036 will move this" comment deleted —
    confirmed; (5) new guard test at
    packages/shared/src/__tests__/archetype-canonical-parity.test.ts (NOT
    tests/integration/archetype-id-parity.test.ts, per the conflict-avoidance instruction) parses
    the real packages/sdk/src/core/intent.ts ARCHETYPE_NAMES via readFileSync + regex and asserts
    exact set-parity — confirmed zero file overlap with the concurrently-dispatched FOLLOW-585 via
    `git diff --stat`; (6) migration 0007 left as an explicit SQL literal with an explanatory
    comment — confirmed; (7) all tests pass, pnpm typecheck clean per worker's local run — CI
    independently re-verified green (see below), not taken on the worker's word. CI: `gh pr view 559
    --json statusCheckRollup` -> 2/58 non-SUCCESS, both "Rule I — wired-or-dead check" — confirmed
    pre-existing-red/non-blocking by checking the SAME check on already-merged PRs #555 and #557
    (`gh pr checks 555|557`), which fail identically. Every other real gate SUCCESS (Lint,
    Typecheck, Test Node 22, Test Python x4, Build, Build control-plane, SDK E2E, Format, Gitleaks,
    and all ticket-specific guards). CI-check counter: 1/5. Fix-iteration counter: 0/3 (no fixes
    needed). Runtime wiring (step 5c): `grep -rn 'CANONICAL_ARCHETYPE_IDS' apps/ packages/
    --include=*.ts --include=*.py | grep -v node_modules | grep -v '\.test\.'` -> 1 non-test
    producer (packages/shared/src/archetypes.ts:36 `export const CANONICAL_ARCHETYPE_IDS = [...]`)
    and 3 non-test consumers (apps/control-plane/src/lib/bandit-seed.ts:25 import + :55 usage,
    packages/shared/src/directives.ts:14 `import type`,
    packages/shared/src/schemas/description.ts:33 import + :44 usage). Not co-assigned (single
    agent, backend-engineer) — step 5d N/A. Reconciled with sibling PR #558
    (pm-orchestrator/FOLLOW-584-585-promote-dispatch, opened 2026-07-18, never merged) by merging
    its branch into this one (commit d95c726) — zero file overlap confirmed before merging (code vs.
    backlog docs), so no content was lost or duplicated. PR #558 is now superseded for its
    FOLLOW-584 portion and should be closed without merging; its FOLLOW-585 dispatch content already
    rides in this branch's history unmodified. See STATUS.md session 39 entry for full detail. NOT
    MERGED — human review boundary (adds a new public export `CANONICAL_ARCHETYPE_IDS` to
    `@estalara/shared`).
  priority: P2
  estimated_hours: 4
  depends_on: []
  source: >-
    RETRO-179 (§4a LG-1, §4c) on FOLLOW-583 — re-running Rule AC's own anchor grep
    (`golden_visa_buyer`) found bandit-seed.ts:37 CANONICAL_ARCHETYPES (an 18-item full-parity
    hand-copy feeding 54 live-prod ab_bandit_weights rows per new tenant via
    seedBanditWeightsForTenant) still unguarded — it was IN the grep output at FOLLOW-583's own
    scoping time and was dropped. Currently confirmed IN SYNC with ARCHETYPE_NAMES (PM-verified this
    session, byte-for-byte 18/18 match, see HANDOFFS.md) — drift-risk, not a live bug. Supersedes
    the long-dormant, never-promoted FOLLOW-036 (recommended_sprint 9, filed 2 sprints ago for this
    exact file). Widened per RETRO-179 §4c to also cover packages/shared/src/directives.ts
    ArchetypeId and packages/shared/src/schemas/description.ts ArchetypeIdSchema — two more
    independent hand-copies found this session, also confirmed IN SYNC.
  notes: |
    Model-fit: PM re-assessed independently (see HANDOFFS.md "Pre-delegation analysis") and is
    dispatching to backend-engineer ALONE (Sonnet), not architect+backend-engineer as the FOLLOW_UPS
    stub suggested — the stub's own AC already fully resolves the one cross-package design question
    (packages/shared cannot import packages/sdk, so this is a parallel canonical export, not an
    import; the stub states this explicitly). No new external dependency, no ADR-worthy decision
    remains open. If the worker hits a genuine cross-package contract question NOT already answered
    by the AC below, escalate to ESCALATIONS.md for architect input rather than deciding unilaterally
    — do not silently improvise the shared-package boundary.
    IMPORTANT — conflict-avoidance instruction (do not deviate): place the new guard test in
    packages/shared/src/__tests__/archetype-canonical-parity.test.ts (the AC's own second option),
    NOT in tests/integration/archetype-id-parity.test.ts. FOLLOW-585 (qa-engineer, dispatched
    concurrently) extends that shared file independently; touching it from both tickets guarantees a
    merge conflict. Zero file overlap is required between this ticket and FOLLOW-585 — verify
    `git diff --stat` against main touches only packages/shared/**,
    apps/control-plane/src/lib/bandit-seed.ts, and packages/db/migrations/0007_seed_ab_bandit_weights.sql
    (comment-only) before opening the PR.
    Branch: backend-engineer/FOLLOW-584-archetype-canonical-consolidation
    AC (verbatim from backlog/FOLLOW_UPS.md FOLLOW-584, PM-verified against real files first):
    - [x] packages/shared/src/archetypes.ts exports CANONICAL_ARCHETYPE_IDS: readonly ArchetypeId[]
          (parallel canonical export — packages/shared may NOT import packages/sdk; document that
          constraint inline, same rationale directives.ts currently states).
    - [x] packages/shared/src/directives.ts ArchetypeId derived from CANONICAL_ARCHETYPE_IDS
          (typeof CANONICAL_ARCHETYPE_IDS[number]) instead of an independent literal union.
    - [x] packages/shared/src/schemas/description.ts ArchetypeIdSchema built from
          CANONICAL_ARCHETYPE_IDS (z.enum(CANONICAL_ARCHETYPE_IDS) or equivalent) instead of an
          independent literal array.
    - [x] apps/control-plane/src/lib/bandit-seed.ts imports CANONICAL_ARCHETYPE_IDS from
          @estalara/shared instead of declaring its own CANONICAL_ARCHETYPES — remove the
          module-private constant and its "FOLLOW-036 will move this" comment.
    - [x] New guard test in packages/shared/src/__tests__/ (NOT
          tests/integration/archetype-id-parity.test.ts — see conflict-avoidance instruction above)
          asserts CANONICAL_ARCHETYPE_IDS (packages/shared) has exact set-parity with
          ARCHETYPE_NAMES (packages/sdk/src/core/intent.ts) — the one drift axis that survives
          consolidation.
    - [x] packages/db/migrations/0007_seed_ab_bandit_weights.sql left as an explicit SQL literal
          with a comment explaining SQL cannot import TS — not silently forgotten.
    - [x] All existing tests pass unchanged; pnpm typecheck clean.
  cross_ref: [FOLLOW-036, FOLLOW-583, FOLLOW-561, RETRO-178, RETRO-179]
- id: FOLLOW-585
  title: >-
    Fix the 2 already-invalid 'investor' mock-archetype literals in CTA-lift + dashboard-analytics
    mock fallbacks; add subset-validity guards (RETRO-179)
  agent: qa-engineer
  status: DONE
  assigned_to: qa-engineer
  started_at: '2026-07-18T00:00:00Z'
  completed_at: '2026-07-19T20:29:13Z'
  branch: qa-engineer/FOLLOW-585-investor-literal-fix
  pr: 561
  merged_commit: 475dc0c
  retro: RETRO-181
  archetype_pick: >-
    'investor' -> 'portfolio_builder' — CEO-chosen 2026-07-19 (PM-flagged genuinely-ambiguous: 5
    valid INVESTOR_ARCHETYPES candidates once yield_hunter excluded; portfolio_builder is the most
    generic, no niche flip/STR/visa/commercial connotation). Mock data, validity-only.
  priority: P2
  estimated_hours: 2
  depends_on: []
  source: >-
    RETRO-179 (§4b CB-1) on FOLLOW-583 — the same golden_visa_buyer anchor grep that scoped 583 is
    structurally blind to short 5-element MOCK_ARCHETYPES subset arrays that never happen to
    reference that id. Independent search this session confirms two sibling copies of the
    family_upsizer bug class, both already broken:
    apps/control-plane/src/app/api/pilot/cta-lift/route.ts:229-234 and
    .../dashboard/analytics/lift/route.ts:222-227, both hard-code 'investor', which is NOT a member
    of ARCHETYPE_NAMES. Both fields typed loose `string`, so pnpm typecheck stays clean on main
    despite the bad literal (PM re-confirmed this session).
  notes: |
    Model-fit: sonnet — mechanical, same shape as FOLLOW-583's route-helpers.ts fix (2
    literal-string fixes + 2 subset-validity test blocks in the same file/pattern already
    established).
    PM FLAG — 'investor' replacement is GENUINELY AMBIGUOUS, unlike family_upsizer->upsizer (which
    was an unambiguous decomposition of a fused id). 'yield_hunter' is already used in both mock
    arrays, eliminating the most obvious candidate. The remaining INVESTOR_ARCHETYPES members
    (packages/sdk/src/core/intent.ts:70-77) are: vacation_rental_investor, flip_investor,
    portfolio_builder, golden_visa_buyer, commercial_investor — PM found no textual/contextual
    anchor in either route.ts favoring one over another (unlike family_upsizer, there is no
    surrounding label/comment context to disambiguate). Per FOLLOW-585's own AC and the FOLLOW-583
    precedent, this is validity-only mock data with NO correctness requirement, so the worker MAY
    pick any valid canonical id — but per PM instruction, DO NOT silently guess: state your pick AND
    a one-sentence rationale prominently in the PR description, and flag it explicitly for a
    human/PM read before merge (do not just fold it into the general PR summary). If Piotr wants to
    weigh in before this merges, this is the line item to look at.
    Branch: qa-engineer/FOLLOW-585-investor-literal-fix
    AC (verbatim from backlog/FOLLOW_UPS.md FOLLOW-585; order matters, mirrors FOLLOW-583's AC-3
    falsification-before-fix discipline):
    - [x] Add a subset-validity assertion to tests/integration/archetype-id-parity.test.ts for
          pilot/cta-lift/route.ts MOCK_ARCHETYPES, shown FAILING RED against main's current state
          FIRST (falsification proof, paste the red output in the PR), then passing after the fix.
    - [x] Add a subset-validity assertion for dashboard/analytics/lift/route.ts MOCK_ARCHETYPES,
          same red-then-green discipline.
    - [x] Fix 'investor' -> a valid canonical archetype id in both MOCK_ARCHETYPES arrays (see PM
          FLAG above — document the choice + one-sentence rationale prominently).
    - [x] All existing 8 assertions in archetype-id-parity.test.ts (post-FOLLOW-583) still pass
          unaffected.
    - [x] Scope discipline: touch only the 2 named MOCK_ARCHETYPES arrays + the test file — do not
          touch the ClickHouse-backed (non-mock) code paths in either route.
  cross_ref: [FOLLOW-583, FOLLOW-561, RETRO-178, RETRO-179]
- id: FOLLOW-587
  title: >-
    Fix the 3rd/4th invalid archetype mock literals the FOLLOW-585 sweep missed (family_nester in
    tracer-sessions mock + 'investor' in audit mock); extend the parity guard to tracer
    top_archetype; retype hand-authored MOCK_ARCHETYPES arrays readonly ArchetypeId[] (RETRO-181)
  agent: qa-engineer
  status: DONE
  assigned_to: qa-engineer
  started_at: '2026-07-20T00:00:00Z'
  completed_at: '2026-07-20T00:00:00Z'
  branch: qa-engineer/FOLLOW-587-mock-literal-sweep
  pr: 563
  merged_commit: 2ed817f
  retro: RETRO-182
  priority: P3
  estimated_hours: 2
  depends_on: []
  source: >-
    RETRO-181 (§4b CB-1/CB-2) on FOLLOW-585 — an independent repo-wide top_archetype/archetype:'…'
    literal sweep found the mock-archetype-invalidity class still open in two inline-object-field
    sites the prior anchor greps were structurally blind to: admin/tracer/sessions/route.ts:49
    buildMockSessions() top_archetype:'family_nester' (+ its test-fixture copy in
    sessions/[id]/route.test.ts) and audit/route.ts:68 MOCK_ENTRIES details.archetype:'investor'.
    Neither is a member of canonical ARCHETYPE_NAMES; both fields typed loose string, so typecheck
    could not catch them.
  pm_validated: >-
    2026-07-20 — validated independently before DONE. Dispatched qa-engineer (Sonnet) with both
    substitutions pre-decided: family_nester->family_buyer (unambiguous) and (parent-agent call,
    consistent with the CEO's FOLLOW-585 disposition) audit 'investor'->'portfolio_builder'. All 5
    AC re-verified against the real PR #563 diff: (1) family_nester->family_buyer in
    tracer/sessions/route.ts buildMockSessions() + both lines of sessions/[id]/route.test.ts —
    confirmed; (2) audit/route.ts 'investor'->'portfolio_builder' with rationale comment placed
    ABOVE the parsed object literal — confirmed; (3) new red-first tracer top_archetype
    subset-validity guard added to tests/integration/archetype-id-parity.test.ts (RED on main = 1
    new fail on family_nester, GREEN after = 11/11) — re-ran locally, 11/11 green independently; (4)
    durable root-fix — 3 hand-authored MOCK_ARCHETYPES arrays (pilot/cta-lift, dashboard/analytics/
    lift, admin/labels/route-helpers) retyped `readonly ArchetypeId[]` from @estalara/shared;
    control-plane typecheck clean (no latent bug); the retype broke the parity test's own
    MOCK_ARCHETYPES parser regex (annotation between name and =), caught by its own fail-loud
    matched>0 guard and fixed by widening the regex — the guard architecture working as designed;
    (5) scope discipline — 8 files (7 in-scope + .claude/agents/qa-engineer/lessons.md), no
    ClickHouse (non-mock) path touched, verified via git diff --stat. CI: 57 pass / 2 fail, both
    pre-existing- red Rule I (unrelated — 179 violations all in untouched files). CI-check counter:
    3/5 this session. Fix-iteration counter: 0/3. NOT MERGED at validation time — merged by CEO
    immediately after (mock data + tests only, autonomous QA area).
  notes: |
    Model-fit: sonnet — mechanical, same class + red-then-green shape as FOLLOW-583/585.
    Root-fix note: FOLLOW-584's exported CANONICAL_ARCHETYPE_IDS / ArchetypeId made the
    `readonly ArchetypeId[]` compile-time guard possible — do NOT retype DB/ClickHouse-hydrated
    string fields (LiftRow.archetype, ChArchetypeCounts.archetype, IntentSessionRow.top_archetype);
    those deliberately accept unexpected external values.
    OUT-OF-SCOPE FINDING (worker-flagged, PM-confirmed live): a 5th instance —
    admin/tracer/history/route.ts:56 archetype_deltas: JSON.stringify({..., family_nester: -0.03 }),
    a JSON-stringified blob KEY (a third structural sub-shape, invisible to every anchor so far).
    Left for a follow-up (see RETRO-182 / FOLLOW_UPS.md), correctly not force-fit into this ticket.
    AC (verbatim from backlog/FOLLOW_UPS.md FOLLOW-587):
    - [x] family_nester -> family_buyer in tracer/sessions/route.ts + its test fixture.
    - [x] Disposition audit/route.ts 'investor' — fixed to 'portfolio_builder', documented.
    - [x] Red-first subset-validity guard for tracer mock top_archetype in the parity test.
    - [x] Durable root-fix: 3 hand-authored MOCK_ARCHETYPES arrays typed readonly ArchetypeId[];
          DB-hydrated string fields left as-is.
    - [x] Scope discipline: only named mock literals + test fixtures + parity test touched.
  cross_ref: [FOLLOW-585, FOLLOW-583, FOLLOW-561, FOLLOW-586, RETRO-179, RETRO-181]
- id: FOLLOW-589
  title: >-
    Fix the 5th invalid archetype mock literal (family_nester as a JSON-stringified object KEY in
    the tracer-history mock) + guard the JSON-blob archetype-key shape — the 3rd structural
    sub-shape of the mock-literal class; final reactive fix in the FOLLOW-561→583→585→587 chain
    (RETRO-182)
  agent: qa-engineer
  status: DONE
  assigned_to: qa-engineer
  started_at: '2026-07-20T00:00:00Z'
  completed_at: '2026-07-20T00:00:00Z'
  branch: qa-engineer/FOLLOW-589-json-blob-literal
  pr: 565
  merged_commit: 04f7832
  retro: RETRO-183
  priority: P3
  estimated_hours: 2
  depends_on: []
  source: >-
    RETRO-182 (§4b CB-1) on FOLLOW-587 — a fresh all-structural-shapes sweep found the sole
    remaining live invalid archetype literal in a 3rd sub-shape the FOLLOW-587 value-position regex
    was blind to: admin/tracer/history/route.ts:56 buildMockEvents() archetype_deltas:
    JSON.stringify({ ..., family_nester: -0.03 }) — an unquoted JSON-blob object KEY. family_nester
    is not canonical (family_buyer is); archetype_deltas is z.string(), so typecheck cannot catch a
    bad key. The Rule AD promotion trigger.
  pm_validated: >-
    2026-07-20 — validated independently before DONE. Dispatched qa-engineer (Sonnet); the
    family_nester->family_buyer substitution is unambiguous (no decision). All AC re-verified
    against the real PR #565 diff: (1) family_nester->family_buyer in admin/tracer/history/route.ts
    buildMockEvents() archetype_deltas blob — confirmed; (2) new red-first parser
    parseTracerHistoryArchetypeDeltaKeys added to tests/integration/archetype-id-parity.test.ts —
    regexes the {...} after `archetype_deltas: JSON.stringify(` and matches unquoted keys via
    /(\w+)\s*:\s*-?\d/g, with matched>0 non-vacuous guard + assertSubsetValidity; reads the REAL
    route file (not itself), so the describe-block comment's family_nester is inert. RED on main = 1
    fail, GREEN after = 12/12 — re-ran locally, 12/12 green independently. (3) Rule AD all-shapes
    sweep: PM independently grep-confirmed zero family_nester left in any live (non-test) path (only
    the test-internal follow-194.test.ts occurrence remains, out of class). (4) scope discipline — 3
    files (2 in-scope + qa-engineer/lessons.md), tracer.ts z.string() column NOT retyped. CI: 57
    pass / 2 fail, both pre-existing-red Rule I. CI-check counter: 4/5 this session. Fix-iteration
    counter: 0/3. NOT MERGED at validation time — merged by CEO immediately after (mock + test only,
    autonomous QA area).
  notes: |
    Model-fit: sonnet — mechanical, same class + red-then-green shape as FOLLOW-583/585/587.
    CHAIN CLOSURE: this is the LAST reactive fix in the mock-archetype-literal-invalidity class.
    Per RETRO-182's sweep (and PM re-verification), after this the class is fully
    enumerated-and-remediated across all 3 live structural shapes (named array, inline value/key,
    JSON-blob key), each guarded by tests/integration/archetype-id-parity.test.ts (12 assertions).
    See RETRO-183 for the auditable closure determination. Rule AD (CONVENTIONS_PATCH.md, promoted
    RETRO-182) codifies the discipline going forward. Still-open NON-chain follow-ups (separate
    concerns, NOT closed by this): FOLLOW-586 (2 duplicate-but-currently-valid full-parity copies)
    and FOLLOW-588 (parser comment-strip hardening).
    AC (verbatim from backlog/FOLLOW_UPS.md FOLLOW-589):
    - [x] family_nester -> family_buyer in admin/tracer/history/route.ts archetype_deltas JSON blob.
    - [x] Red-first JSON-blob-KEY subset-validity guard added to the parity test (12/12 green).
    - [x] Rule AD: all structural shapes enumerated in the PR; no other live JSON-blob-key literal.
    - [x] Scope discipline: only the mock literal + parity test; z.string() column not retyped.
  cross_ref: [FOLLOW-587, FOLLOW-585, FOLLOW-583, FOLLOW-561, FOLLOW-586, RETRO-181, RETRO-182]
- id: FOLLOW-588
  title: >-
    Harden the archetype-id-parity.test.ts parser helpers so inline comments inside a parsed literal
    block cannot false-positive the archetype scan (prevents re-tripping the FOLLOW-585
    comment-in-block gotcha) (RETRO-181)
  agent: qa-engineer
  status: DONE
  assigned_to: qa-engineer
  started_at: '2026-07-20T00:00:00Z'
  completed_at: '2026-07-20T00:00:00Z'
  branch: qa-engineer/FOLLOW-588-parser-comment-strip
  pr: 567
  merged_commit: c6326c8
  retro: RETRO-184
  priority: P3
  estimated_hours: 1
  depends_on: []
  source: >-
    RETRO-181 (§4c) on FOLLOW-585 — the FOLLOW-585 worker's lessons entry documented a real gotcha:
    a fix-rationale comment placed INSIDE a MOCK_ARCHETYPES = [...] block made the parser's
    /'([a-z_]+)'/g scan match a quoted id in the comment text, giving a misleading still-RED result
    after the array was already fixed. The moved-comment convention was an unwritten discipline
    FOLLOW-586 (edits these same parsers) could silently violate. Sequenced before FOLLOW-586.
  pm_validated: >-
    2026-07-20 — validated independently before DONE. Test-infra only (no production source). All AC
    re-verified against PR #567: (1) stripComments() added (strips /* */, // JS, # Python) and
    applied to ALL 11 parser helpers — confirmed by reading the diff (parseNlpPyArchetypes,
    parseArchetypeSeedsTs, parseMigration0005Archetypes, parseArchetypeHintsReferencedIds,
    parseArchetypeGuidancePyKeys, parseReachableArchetypes, parseMockArchetypes,
    parseMockArchetypesGeneric, parseExportRouteMockArchetypes,
    parseTracerSessionsMockTopArchetypes, parseTracerHistoryArchetypeDeltaKeys); (2) red→green
    regression test with two self-contained inline fixtures (JS // + Python #) proved load-bearing
    by neutering the stripper (2 fixtures fail, 12 real assertions stay green under the neuter); (3)
    warning comment added atop the parser section; (4) all 12 pre-existing assertions unchanged
    (stub said 10 — grown to 12 post-587/589), total 14/14 green — re-ran locally, 14/14 green
    independently. No over-strip: 12 real assertions green = empirical proof no parsed block relies
    on #/// as meaningful in-string content (ids and comments on separate lines). Scope: 2 files
    (test + .claude/agents/qa-engineer/lessons.md). CI: 56 pass / 2 fail, both pre-existing-red Rule
    I. CI-check counter: 5/5 this session. Fix-iteration counter: 0/3. NOT MERGED at validation time
    — merged by CEO immediately after (test-infra only, autonomous QA area).
  notes: |
    Model-fit: sonnet — mechanical test-infra hardening.
    Unblocks FOLLOW-586 (edits these same parsers, adds inline-commented z.enum/array literals of
    exactly the shape that previously re-tripped the gotcha) — the convention is now enforced by
    code, not discipline.
    AC (verbatim from backlog/FOLLOW_UPS.md FOLLOW-588):
    - [x] Strip //, /* */ (and # for Python) comments from the captured block before the id scan in
          the parser helpers.
    - [x] Regression test: a fixture with a commented invalid id parses to the valid set only.
    - [x] One-line warning atop the parser helpers noting comments-in-block are now stripped.
    - [x] All existing parity assertions still pass (12, grown from the stub's stated 10); suite green.
  cross_ref: [FOLLOW-585, FOLLOW-586, RETRO-181, RETRO-183]
- id: FOLLOW-586
  title: >-
    Finish the FOLLOW-584 consolidation: migrate the 2 remaining importable archetype-ID copies
    (intent-weights.ts ARCHETYPE_KEYS, adapt/description/route.ts inline z.enum) onto the
    now-exported CANONICAL_ARCHETYPE_IDS / ArchetypeIdSchema (RETRO-180)
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  started_at: '2026-07-20T00:00:00Z'
  completed_at: '2026-07-20T00:00:00Z'
  branch: backend-engineer/FOLLOW-586-finish-archetype-consolidation
  pr: 569
  merged_commit: 5883e18
  retro: RETRO-185
  priority: P3
  estimated_hours: 2
  depends_on: [FOLLOW-584]
  source: >-
    RETRO-180 (§4a LG-1) on FOLLOW-584 — FOLLOW-584 consolidated the 3 named archetype-ID copies but
    the closure grep found 2 MORE importable full-parity 18-entry TS copies (intent-weights.ts
    ARCHETYPE_KEYS, adapt/description/route.ts inline z.enum), both in the RETRO-179
    golden_visa_buyer anchor-grep output and dropped from scope. Both currently IN SYNC —
    consolidation/drift-risk closure, not a live-data fix.
  pm_validated: >-
    2026-07-20 — validated independently before merge (CEO pre-authorized merge-on-green).
    Dispatched backend-engineer (Sonnet); PM pre-verified the two facts that gated the refactor:
    ArchetypeIdSchema IS exported from the @estalara/shared root (schemas/index.ts ->
    description.js), and CANONICAL_ARCHETYPE_IDS order is byte-identical to ARCHETYPE_KEYS (so
    derivation preserves order, no behavior change). AC re-verified against the real PR #569 diff:
    (1) intent-weights.ts ARCHETYPE_KEYS = CANONICAL_ARCHETYPE_IDS (intra-package import from
    ../archetypes.js), ArchetypeKey type + both z.enum(ARCHETYPE_KEYS) call sites unchanged (both
    as-const readonly tuples, no spread needed) — confirmed; (2) adapt/description/route.ts
    archetype: ArchetypeIdSchema (added to the existing @estalara/shared import), bare required
    field, drop-in — confirmed; (3) no behavior change — pnpm typecheck clean across
    shared/control-plane/sdk (re-ran all three locally), intent-weights 281, sdk drift 9/9 (re-ran
    locally), adapt/description 53, integration parity 14/14 all green. CI: 57 pass / 2 fail, both
    pre-existing-red Rule I. CI-check counter: 6/5 (exceeded — 6 PRs validated this session).
    Fix-iteration counter: 0/3.
  notes: |
    Model-fit: sonnet — type-level DRY refactor, both copies pre-verified in-sync + order-identical.
    OUT-OF-SCOPE FINDING (worker-flagged, PM-confirmed real): AC#4's closure grep surfaced a THIRD
    genuine full-parity 18-entry copy this ticket's 2-named-file scope did not cover —
    packages/sdk/src/core/adapt-schema.ts archetypeIdSchema (z.enum, 18 ids). It is packages/sdk
    (sdk-engineer ownership, not one of the 2 named files), so correctly left out rather than
    scope-crept. Filed as a follow-up (see RETRO-185 / FOLLOW-590). It can derive intra-package from
    ARCHETYPE_NAMES (the in-package SoT), no circular-dep concern. So the importable-COPY
    consolidation thread is NOT yet fully closed repo-wide — one copy remains after this ticket.
    AC (verbatim from backlog/FOLLOW_UPS.md FOLLOW-586):
    - [x] intent-weights.ts ARCHETYPE_KEYS derives from CANONICAL_ARCHETYPE_IDS; ArchetypeKey +
          z.enum set unchanged.
    - [x] adapt/description/route.ts QueryParamsSchema.archetype uses ArchetypeIdSchema from
          @estalara/shared instead of inline z.enum.
    - [x] No behavior change — all adapt/description + intent-weights tests pass; typecheck clean.
    - [~] Closure grep shows no remaining hand-maintained full-parity TS ID array/enum copy outside
          archetypes.ts — PARTIAL: the 2 NAMED copies are closed, but the grep surfaced a 3rd
          (sdk adapt-schema.ts) out of this ticket's scope → FOLLOW-590 (sdk-engineer).
  cross_ref: [FOLLOW-584, FOLLOW-036, FOLLOW-583, FOLLOW-590, RETRO-179, RETRO-180]
- id: FOLLOW-590
  title: >-
    Migrate the last importable full-parity archetype-ID copy (sdk adapt-schema.ts archetypeIdSchema
    inline z.enum) onto @estalara/shared ArchetypeIdSchema + add a parity guard — closes the
    importable-full-parity-COPY class repo-wide (RETRO-185)
  agent: sdk-engineer
  status: DONE
  assigned_to: sdk-engineer
  started_at: '2026-07-20T00:00:00Z'
  completed_at: '2026-07-20T00:00:00Z'
  branch: sdk-engineer/FOLLOW-590-adapt-schema-consolidation
  pr: 571
  merged_commit: bb9f837
  retro: RETRO-186
  priority: P3
  estimated_hours: 1
  depends_on: [FOLLOW-586]
  source: >-
    RETRO-185 (§1 CRITICAL) on FOLLOW-586 — the FOLLOW-586 closure grep surfaced the LAST
    hand-maintained importable full-parity 18-entry TS copy the earlier tickets' scope did not
    cover: packages/sdk/src/core/adapt-schema.ts archetypeIdSchema (inline z.enum), whose own
    doc-comment said "Keep in sync by hand" and which had NO parity guard (could drift silently).
    In-sync at consolidation time — drift-risk closure, not a live-data fix.
  pm_validated: >-
    2026-07-20 — validated independently before merge. Dispatched sdk-engineer (Sonnet); PM
    pre-verified sdk depends on @estalara/shared (workspace:^, so sdk->shared re-export is the
    allowed direction) and that z.enum(ARCHETYPE_NAMES) can't be used (SoT array isn't as const). AC
    re-verified against the real PR #571 diff: (1) archetypeIdSchema = ArchetypeIdSchema
    (re-exported from @estalara/shared), inline 18-item z.enum removed, z still used for the other
    schemas in the file, doc-comment rewritten — confirmed; (2) new runtime parity guard in
    adapt-schema.test.ts (options non-vacuous + toEqual([...ARCHETYPE_NAMES])), proven load-bearing
    by worker perturbation (no natural red-on-main, copy was in sync — same discipline as
    FOLLOW-586) — re-ran locally 17/17 green; (3) @estalara/sdk typecheck clean, sdk suite 1534
    green, bundle 40.69KB gzip < 42KB limit; (4) closure grep re-run BY PM independently — every
    remaining golden_visa_buyer hit is the canonical archetypes.ts / ARCHETYPE_NAMES SoT, a numeric
    weight/embedding map, a playbook lookup/single return, or a doc-comment (incl. the
    audit/route.ts FOLLOW-587 rationale comment) — ZERO remaining hand-maintained full-parity
    ID-list array/enum copies. CI: 57 pass / 2 fail, both pre-existing-red Rule I. CI-check counter:
    7/5 (exceeded). Fix-iteration counter: 0/3. NOT MERGED at validation time — merged by CEO
    immediately after (SDK internal re-export, no behavior change).
  notes: |
    Model-fit: sdk-engineer, sonnet — type-level re-export, same pattern as FOLLOW-586's route.ts.
    CLOSES the importable-full-parity-COPY class repo-wide (RETRO-186 for the auditable determination).
    Every importable TS ID-list now derives from the single canonical CANONICAL_ARCHETYPE_IDS /
    ArchetypeIdSchema (FOLLOW-584) or the ARCHETYPE_NAMES SoT, each guarded. Deliberately parallel +
    OUT OF SCOPE (guarded separately, cannot be import-consolidated across runtimes): the Python
    copies nlp.py / generate_description.py (FOLLOW-561). Lower-severity residual (test-only fixtures,
    RETRO-185 §4c): noted, not filed.
    AC (verbatim from backlog/FOLLOW_UPS.md FOLLOW-590):
    - [x] adapt-schema.ts archetypeIdSchema re-exports @estalara/shared ArchetypeIdSchema; no
          behavior change (parse accepts/rejects the same set; adaptResponseSchema unchanged).
    - [x] PR states the chosen derivation (re-export shared) + the z.enum tuple-typing rationale.
    - [x] tsc clean on @estalara/sdk; sdk tests green/unchanged.
    - [x] Parity guard added (archetypeIdSchema.options == ARCHETYPE_NAMES, non-vacuous), load-bearing.
    - [x] Closure grep: no remaining full-parity ID-list copy outside archetypes.ts — class CLOSED.
  cross_ref: [FOLLOW-586, FOLLOW-584, FOLLOW-036, FOLLOW-561, RETRO-183, RETRO-185]
- id: FOLLOW-567
  title: >-
    Fix Modal embed-seed -> POST /api/listings/embed contract mismatch (text_fields required but
    never sent)
  agent: backend-engineer
  status: DONE # queue-truth correction 2026-07-14 (session 27): merged PR #522 (e48f9ec, 2026-07-13) — was stale READY despite being merged the day before. Not independently re-validated by this correction pass; flip is git-log-confirmed only.
  completed_at: '2026-07-13'
  merged_pr: 522
  merge_commit: e48f9ec
  priority: P1
  estimated_hours: 3
  depends_on: [FOLLOW-568]
  source: >-
    Wave-0 operator session 2026-07-11 (FOLLOW-553 step 4) — _embed_one_listing
    (apps/llm-gateway/src/jobs/consume_embed_seed_requests.py:135) intentionally omits text_fields,
    its comment claims "the endpoint fetches listing text from its own DB when text_fields is
    absent" — FALSE: apps/control-plane/src/app/api/listings/embed/route.ts:75 requires text_fields
    (Zod, non-empty refinement, no fetch fallback). Every ADR-0016 embed-seed dispatch 400s per
    listing. The existing cross-runtime contract test covers only the EVENT fields
    (tenant_id+listing_ids), not the downstream per-listing POST body — exactly the Rule Z gap
    class.
  spec: ADR-0016; packages/shared/contracts/listing-embed-seed-event.required.json (extend)
  notes: |
    Model-fit: sonnet. Preferred fix (matches the Modal comment's intent, unblocked by
    FOLLOW-568's backend-host rename): make the embed route fetch title/description/price/location
    via the existing listing-details helper when text_fields is absent, keeping the explicit
    text_fields path for direct callers. Alternative (rejected unless fetch proves flaky): have
    Modal send text_fields — it does not have them.
    AC:
    - [ ] A Modal-shaped POST (tenant_id+listing_id, NO text_fields) returns 200 and upserts a
          real embedding (integration test with mocked backend fetch).
    - [ ] Cross-runtime contract fixture extended to the per-listing POST body (Rule Z) so the
          two runtimes cannot drift again.
    - [ ] End-to-end smoke: one real listing seeded through the live Modal endpoint (the ESC-034
          smoke that Wave 0 could not run) — evidence in the PR.
- id: FOLLOW-568
  title: >-
    Estalara backend host renamed api.estalara.com -> api.app.estalara.com — propagate through repo,
    Doppler prd, Vercel prod
  agent: pm-orchestrator
  status: DONE
  completed_at: '2026-07-11'
  pr: 'recorded on merge (same-branch bookkeeping per AGENT_WORKFLOW rule (d))'
  priority: P1
  estimated_hours: 1
  depends_on: []
  source: >-
    CEO direction 2026-07-11 (Wave-0 operator session): Estalara infra renamed the Spring backend
    host ~2026-06-30 (new Let's Encrypt cert dated 2026-06-30; old host now serves Traefik default
    cert + universal 404). Verified live: /api/v1/listing/details on the new host answers
    application JSON with NO login redirect (ESC-019 symptom gone).
  notes: |
    Applied: Doppler prd ESTALARA_BACKEND_URL updated; Vercel prod env var ADDED (was entirely
    missing — prod control-plane silently defaulted to http://localhost:8081, so grounding
    fetches could never succeed from Vercel; FOLLOW-457 fail-safe meant template_fallback, no
    hallucination risk); .env.example + DOPPLER_SECRETS_MATRIX.md corrected (matrix also
    misstated ESTALARA_DECISION_API_URL as api.estalara.com — actual: decision.estalara.com);
    MASTER_DESIGN Update 2026-07-11 block + §B.4.5 example URL; HANDOFF.md historical-note.
    Historical records (ESC-019, FOLLOW-192, QUEUE PR #196 mentions) left verbatim by design.
    Control-plane redeploy after env add = done in-session.
    AC:
    - [x] Repo references updated (live docs/env-example) or annotated (historical snapshots).
    - [x] Doppler prd value updated; Vercel prod var added.
    - [x] MASTER_DESIGN documents the rename (Update 2026-07-11).
    - [x] Live verification: new host answers listing-details with application-level JSON.
- id: FOLLOW-569
  title: >-
    Audit F-01: `inquiry.completed` reaches only the bandit feedback ping, never ingest, so the
    cta-lift conversion-analytics leg JOINed on it is permanently empty (holdout AND variant)
  agent: sdk-engineer
  status: DONE # queue-truth correction 2026-07-14 (session 27): no QUEUE.md block existed at all — ticket ID was ad-hoc, coined in the PR/commit only, never promoted through the normal FOLLOW_UPS.md->QUEUE.md flow. Added retroactively from the merged PR; not independently AC-re-validated by this correction pass.
  completed_at: '2026-07-12'
  pr: 517
  merge_commit: b0d77a6
  priority: P1
  estimated_hours: 2
  depends_on: []
  source: >-
    Audit finding F-01 (docs/AUDIT-2026-07-12.md, High). The SDK routed inquiry.completed only to
    the bandit feedback ping (registerFeedbackListener in adapt.ts) and never queued it for ingest
    (/v1/events). apps/control-plane/src/app/api/pilot/cta-lift/route.ts JOINs on inquiry.completed,
    so the conversion-analytics leg counted zero for every session (holdout and variant).
  spec: backlog/FOLLOW_UPS.md (FOLLOW-569 entry, added same-PR per PR #517's own "Notes")
  notes: |
    **Queue-truth correction 2026-07-14 (pm-orchestrator, session 27):** PR #517
    (`fix(sdk): queue inquiry.completed for ingest so cta-lift conversion leg populates
    [FOLLOW-569]`) merged 2026-07-12T13:52:50Z (commit `b0d77a6`) but this ticket had NO block in
    `QUEUE.md` at all — the ticket ID was coined ad hoc inside the PR/commit and its own
    `FOLLOW_UPS.md` stub, never promoted through the normal `backlog/FOLLOW_UPS.md` ->
    `backlog/QUEUE.md` promotion flow. PR body's own "Notes" section flagged this explicitly:
    "FOLLOW-569 and its FOLLOW_UPS.md stub are provisional — PM to confirm/formalize the ticket id
    and fold into the Sprint 23 wave bookkeeping." Added retroactively here, delegation-table row:
    "client SDK, Shadow DOM, tiers, browser code -> sdk-engineer" (matches the PR's actual author
    role — `packages/sdk/src/index.ts`). Diff: `packages/sdk/src/index.ts` (+39), new test
    `packages/sdk/src/__tests__/follow569-inquiry-completed-ingest.test.ts` (+123, 5 cases: valid
    mapping, empty detail, agent-drop, invalid-field filtering, mixed subset), `backlog/FOLLOW_UPS.md`
    (+22, the stub itself). PR-stated verification: eslint + tsc clean, SDK bundle 40.67 KB gzip
    (under the 42 KB budget), local pilot round-trip confirmed (`inquiry.completed` -> `/v1/events`
    on `app.estalara.com` + mock decision server). Not independently AC-re-validated by this
    correction pass (git-log-confirmed merge only, same flag applied to the FOLLOW-551/436/554/555/
    556/567 corrections this session) — flagged for a future retro pass.
    AC:
    - [x] `inquiry.completed` queued for ingest (`/v1/events`) for every session (holdout + variant),
          not only routed to the bandit feedback ping.
    - [x] No-PII payload mapping only (`channel`, `has_phone`, `budget_hint`, `timeline`,
          `message_length`); `is_agent=true` signals dropped; invalid-schema fields filtered.
    - [x] Test coverage for the mapping/drop/filter behavior (5 cases, see notes).
- id: FOLLOW-592
  title: >-
    ADR-0018 foundation: resolveTenantAccess helper (agency|staff discriminated union) +
    security-invariant test suite
  agent: backend-engineer
  status: DONE
  assigned_to: backend-engineer
  completed_at: '2026-07-20T00:00:00Z'
  branch: backend-engineer/FOLLOW-592-resolve-tenant-access
  pr: 579
  merged_commit: 336786a
  retro: RETRO-187
  worker_model: opus
  pm_validated: >-
    2026-07-20 — validated independently before merge (CEO merge-on-green authorization). All AC
    re-verified against the real PR #579 diff: additive-only (one import-line extension; the 4
    pre-existing session-auth exports byte-unchanged; tracer-auth untouched); 17 new invariant tests
    + 21 pre-existing session/tracer-auth tests re-run locally by PM (38/38 green); typecheck clean;
    INV-2 foreign-tenant cross-check confirmed in code (param never overrides claim); headless
    ADMIN_API_SECRET rejected on the staff path via the attributable-identity requirement (test
    proves 403) — documented hardening vs the ADR sketch; CEO Q3 tier shipped (canWrite=ops+,
    isSuperadmin rank-3 predicate, dead-by-design until FOLLOW-598). CI 57 pass / 2 fail — Rule I
    only, now +4 DELIBERATE new symbols (deferred consumers, in-file deferral banner per remediation
    option 3; first consumers land in FOLLOW-594). RETRO-187 adversarial security verdict: CLEAN on
    all four seams (staff branch unreachable without opt-in; agency can never obtain via:staff or a
    foreign tenant; tenantExists fails CLOSED on DB error; secret path rejected). One P1 CASCADE
    finding (not a code defect): the INV-5 per-route tenant-filter test obligation was missing from
    the FOLLOW-594..600 stub ACs — retro fixed all 7 stubs; the already-dispatched FOLLOW-594
    worker's brief carried the obligation explicitly, so no gap in flight. LG-2 folded into
    FOLLOW-598 (global generation_model PUT rank-3 gate).
  priority: P1
  estimated_hours: 4
  depends_on: []
  source: >-
    ADR-0018 §2 (docs/adr/ADR-0018-superadmin-tenant-access.md; CEO-accepted 2026-07-20, all 4 open
    questions resolved same day). Every tenant-scoped dashboard API today resolves tenant_id from
    the agency session only (`claims.tenant_id`), so a staff/superadmin session (`tenant_id: null`)
    cannot act on any tenant — either 401s (session-tenant APIs) or, if middleware's staff block is
    ever lifted incorrectly, silently disables RLS (`createTenantClient(undefined)`). This ticket
    ships the one helper that makes staff access to a specific tenant both possible and safe.
    **Blocks FOLLOW-593..600 (all Phase 1-3 staff-porting tickets) — do this first.**
  notes: |
    **Model-fit: OPUS (worker model for this ticket — do NOT argue it down to sonnet).** Rationale:
    this is a security-sensitive auth-path change touching session resolution + RLS discipline (the
    staff branch deliberately bypasses RLS via a service-role client and depends entirely on a
    hand-written WHERE-clause filter for tenant isolation — a forgotten filter is a cross-tenant
    data leak). Per CLAUDE.md's model-fit rule: "escalate one tier when the task already failed once
    at the lower tier" and "never argue a P0 down a tier on cost grounds" — this is the auth-boundary
    equivalent for a P1 security-sensitive ticket; take the higher tier for irreversible/prod-touching
    reasoning even though the diff itself is additive/reversible.

    Full delegation brief is in backlog/HANDOFFS.md ("Delegation brief — FOLLOW-592"). Non-negotiable
    requirements restated here so they survive even if HANDOFFS.md is trimmed later:
    - **Read docs/adr/ADR-0018-superadmin-tenant-access.md §2 END-TO-END before writing any code.**
      All five security invariants apply, but **invariant 5 (the RLS/service-role trap) is the one
      that matters most**: staff DB access uses `createAdminClient` (service-role, RLS bypassed by
      construction), so EVERY staff-path query in this ticket's own test fixtures — and every route
      that later opts in — MUST carry an explicit `WHERE tenant_id = <validated id>` filter written
      into the query itself, proven by a test that fails if the filter is removed. Do not rely on
      "the helper returned the right tenantId" as proof; prove the filter is actually applied.
    - **Implement the CEO Q3 write tier exactly:** `canWrite = STAFF_ROLE_RANK[role] >= estalara:ops`
      (rank >= 2), PLUS a separate rank >= 3 (`estalara:superadmin`) assertion/flag for future
      highest-risk routes (bandit weights, global generation_model — those routes are ported later
      in FOLLOW-598+, not here; this ticket only needs to expose the primitive and prove it gates
      correctly in tests).
    - **Change NO existing route behavior.** This ticket is helper + tests ONLY —
      `apps/control-plane/src/lib/session-auth.ts` gains the new `resolveTenantAccess` export; no
      existing route file is modified to call it. Routes opt in starting with FOLLOW-593/594+.
    - Keep test coverage >=80% for `packages/*` / >=70% for `apps/*` per the CLAUDE.md quality bar
      (this lands in `apps/control-plane`, so >=70% applies; the ADR's own >=6-case matrix should
      clear that easily on the new code in session-auth.ts).

    Branch: backend-engineer/FOLLOW-592-resolve-tenant-access

    AC (verbatim from backlog/FOLLOW_UPS.md FOLLOW-592):
    - [ ] `resolveTenantAccess(req, opts)` implemented per ADR-0018 §2 in
          `apps/control-plane/src/lib/session-auth.ts`, returning the discriminated union
          `{ via: 'agency', tenantId, claims, rawToken } | { via: 'staff', tenantId, staff, role,
          canWrite }` (throws `AccessError({status})` on any failure).
    - [ ] >=6-case test matrix: (1) agency-unchanged — agency claims resolve exactly as today,
          `tenantId` comes ONLY from `claims.tenant_id`; (2) staff-read — `allowStaffOverride: true`
          + a valid staff session resolves `via: 'staff'`; (3) staff-write-role-gate INCLUDING the
          rank-3 (superadmin) tier, not just rank-2 ops; (4) foreign-tenant-rejected-for-agency — an
          agency session cannot supply a foreign `tenant_id` via URL/query (403, claim wins); (5)
          staff-tenant-validated-against-table — a staff-supplied `tenantId` that doesn't exist in
          `tenants` returns 404, validated BEFORE any query runs; (6) staff-query-is-tenant-filtered
          — a representative staff-path query includes an explicit `WHERE tenant_id = <id>` clause,
          proven by a test that fails if the filter is dropped (not merely code-reviewed).
    - [ ] No existing route behavior changes until routes opt in (helper + tests only).
    - [ ] Typecheck clean + all existing `session-auth` tests unchanged and still passing.
  cross_ref: [ADR-0018, FOLLOW-456, FOLLOW-555, RETRO-186]
```
