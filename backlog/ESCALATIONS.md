# Escalations

Issues that require human decisions. Agents append; humans resolve.

## Format

```markdown
## OPEN — <short title>

**Filed by:** <agent or human> **Date:** <ISO timestamp> **Affects:** <ticket-id or area> **Type:**
[architectural | compliance | priority | scope | vendor | other]

**Description:** What happened, what was expected, what's needed to unblock.

**Required action:** What needs to happen to resolve.

**Resolution:** <empty until resolved>
```

When resolved, change `## OPEN` to `## RESOLVED` and add the resolution.

---

## RESOLVED — ESC-046: the "unknown actor" that merged PR #646 was the main-loop session acting on Piotr's explicit instruction — no guardrail was bypassed

**Resolved 2026-07-31 by Piotr's ruling ("zamknij jako wyjaśnioną"), on the following facts.**

**What actually happened.** Piotr instructed the main-loop session, verbatim, "mergujemy #646 i
#647". The main loop verified CI on both (68 and 65 pass, `Rule I` pre-existing-red at 192 on each,
confirmed from the job logs rather than the check summary), then ran `gh pr merge 646 --squash`,
producing `306285f7` at `2026-07-31T03:50:54Z` — the exact commit and timestamp this escalation
flagged. **No subagent merged anything.** The backend-engineer is cleared; the suspicion recorded
below was reasonable on the evidence available to the PM, and wrong.

**Why the PM could not see it.** The PM was dispatched by the main loop and ran concurrently with
it. It has no visibility into the main loop's actions, and `merged_by` resolves to the shared
account identity every process in this sandbox uses, so a merge by the main loop is
indistinguishable from a merge by a worker. The PM did the right thing with what it could see: it
refused to normalise an unexplained merge and escalated instead of assuming.

**The real lesson is mine, not the PM's.** The main loop dispatched a PM to drive the backlog and
then operated on the same repository in parallel — the same class of collision the PM had just spent
a session recovering from at the git level (two agents, one shared `HEAD`), reproduced one layer up
at the coordination level. Merges and other repo-mutating actions should happen either BEFORE a PM
is dispatched or AFTER it returns, not alongside it.

**Residual point that survives this closure, and is NOT resolved by it:** the escalation's
governance question stands on its own — nothing in this environment technically prevents a
Bash-capable subagent from running `gh pr merge` on its own PR. Today that boundary is a convention
each agent follows, not a control. Filed as **FOLLOW-755** (P3) so it is not lost with this closure;
it needs no action before the next dispatch.

---

<details><summary>Original escalation as filed (preserved for the record — its premise was false)</summary>

## OPEN — ESC-046: PR #646 (FOLLOW-743) was merged to `main` by an actor this PM session did not invoke, while the PM's own review was in progress

**Filed by:** claude (session 85) **Date:** 2026-07-31T03:51:00Z **Affects:** the "humans merge"
guardrail generally; PR #646 (FOLLOW-743, `306285f7`); the reliability of
`gh pr checks`/`git status` as ground truth while any dispatched agent process may still be running
with the same credentials **Type:** other (process/governance)

**Description:** While this PM session was mid-validation of PR #646 (CI checks had just been
confirmed green and a PM-validation comment posted, but the ticket had **not** been marked merged
and no `gh pr merge` was ever run by the PM), `git fetch origin main` unexpectedly returned a new
tip, `306285f7`, one commit ahead of what the PM had just pushed. `gh api repos/.../pulls/646`
confirms **PR #646 is `MERGED`**, `merged_by: Pnawrocki9`, timestamp `2026-07-31T03:50:54Z` — merged
by an actor other than this PM session, using the same shared repo/`gh` credentials every process in
this sandbox authenticates with (so `merged_by` identifies the account, not which specific process
invoked the merge). `auto_merge` on the PR object is confirmed `null` (GitHub's native auto-merge
was not the mechanism). The most likely explanation, not proven: the backend-engineer subagent this
PM dispatched for FOLLOW-743 ran `gh pr merge` itself after opening the PR and seeing its own CI go
green — an action no dispatch brief this session asked for and that the PM's own guardrails
explicitly forbid ("You MUST NOT merge PRs. Humans merge.").

**Mitigating facts, so this is not read as worse than it is:** the merged content is exactly what
the PM had already independently validated moments earlier — CI green (`Rule I` pre-existing-red at
192, matching `main`'s own baseline, all other real gates pass), runtime wiring confirmed by reading
the PR branch directly (not the PR's prose), all 5 ACs met. There is no evidence of a bad merge, a
force-push, or history rewriting — `main` and `origin/main` are byte-identical with no corruption.
The harm here is procedural (the human review gate was skipped for this one merge), not a defect in
the shipped code.

**Why this needs a human ruling rather than a queue ticket:** if a Bash-capable subagent can execute
`gh pr merge` using the shared credentials this sandbox authenticates every process with, the
"humans merge" boundary is not actually enforced by anything except each agent's own
instruction-following — it is a convention, not a technical control, in this environment. That is a
gap the PM cannot close from inside a session (the PM has no ability to revoke `gh`/git write
credentials from a worker it spawns).

**Required action (Piotr):**

1. Decide whether this was in fact the backend-engineer subagent self-merging (worth confirming by
   auditing that agent's own transcript/log if accessible:
   `/tmp/claude-1000/.../scratchpad/ dispatch_logs/follow743_backend.log`), a stray `gh` action from
   something else in the sandbox, or an intentional action taken on the human's own behalf that this
   PM was simply not told about.
2. If it was an agent self-merging: decide whether to (a) accept it as a one-off given the content
   was independently verified correct anyway, (b) add an explicit instruction to every dispatch
   brief forbidding `gh pr merge`/`gh pr merge --auto` (defense in depth, since the guardrail
   already exists in the PM's own instructions but apparently is not inherited by workers), or (c)
   restrict write scopes/tokens so workers structurally cannot merge, if that's feasible in this
   environment.
3. No action needed on PR #646 itself — content verified correct, already live on `main`.

**Resolution:** <awaiting Piotr>

## </details>

## RESOLVED — ESC-043: prod ingest Worker runs code from 2026-05-29 — 14 merged ingest commits (incl. consent gate + origin enforcement) have NEVER been deployed; no working deploy pipeline exists

**Filed by:** claude (session 61, live diagnostic) **Date:** 2026-07-26T15:45:00Z **Affects:**
`apps/ingest` (all merged work since 2026-05-29), FOLLOW-642/658 (origin enforcement), FOLLOW-559
(server-side consent gate), FOLLOW-579 (unconsented-snapshot stripping), FOLLOW-459/482/513 (<50ms
ACK + durable queue retry + Sentry), FOLLOW-678 stub premise, ESC-020 (same defect class) **Type:**
other (infra/ops — deploy gap, compliance-relevant)

**Description:** While verifying today's `FIRST_PARTY_TENANT_ID` secret, a diagnostic
`POST /v1/events` with `Origin: http://localhost:5173` against `ingest.estalara.com` sailed
**through** the origin gate (rejected only by Zod schema validation; nothing persisted —
`accepted:0`). Root cause established from `wrangler deployments list --env production`: the last
**code** deployment of `estalara-ingest-production` is **2026-05-29T21:21:49Z** — every entry since
is `Secret Change` only. The deployed binary therefore predates the entire origin-enforcement stack
and **13 further merged ingest commits**. `git log --since=2026-05-29 -- apps/ingest` on `main`
lists 14 undeployed commits, including:

- `d631a08` FOLLOW-642 per-tenant `allowed_origins` CORS enforcement (#623) — **not live**
- `95a8492` FOLLOW-658 producer + fail-loud `origin_policy_unconfigured` guard (#628) — **not live**
- `0009c0f` FOLLOW-559 **server-side consent gate for profiling-class events** (#533) — **not live**
- `d3911bf` FOLLOW-579 strip derived-intent fields from unconsented `session.quality.snapshot`
  (#547) — **not live**
- `08eb138`/`f53c3ba`/`ef2d6dc` FOLLOW-459/482/513 — ACK-before-insert p95 fix, durable Queue retry,
  Sentry on the queue consumer — **not live**

There is **no working deploy path**: the only Worker deploy workflow is `deploy-staging.yml` (manual
`workflow_dispatch`, staging-only, and every historical run FAILED — last attempt 2026-05-04). Prod
deploys have always been manual `wrangler deploy` from an operator machine.

**Impact if not fixed:**

1. **Compliance:** prod ingest accepts profiling-class events with **no server-side consent
   enforcement** (FOLLOW-559 merged ~2026-06 but never live) — client-side suppression is the only
   real gate; MASTER_DESIGN and multiple docstrings assert server-side behavior that is not running.
   This is Rule AI (ship-falsifies-doc) at the **deploy layer** — the doc-truth axis the retro loop
   now tracks, but for merged-vs-deployed instead of merged-vs-written.
2. **Security:** anyone can POST events for the Estalara tenant from any origin with the public SDK
   api key (empirically proven today). All origin-enforcement work of #623/#628 is inert.
3. **Reliability/perf:** the <50ms ACK fix and the durable ClickHouse retry queue are not live; prod
   still runs the pre-FOLLOW-459 synchronous path.
4. Today's `FIRST_PARTY_TENANT_ID` ingest secret is set but **read by nothing** until deploy.

**Required action:** Piotr decision + a verified deploy (recommend a dedicated ticket, NOT a blind
`wrangler deploy`):

1. **Pre-flight:** the May-29 binary predates the `env.production` queue producers/consumers
   (FOLLOW-482) and any later bindings — verify the Cloudflare account actually HAS the queues/KV
   namespaces `wrangler.toml` now declares (`wrangler queues list`, `kv namespace list`), or the
   deploy fails/misbehaves. Also identify which origins CURRENTLY send prod events (deploying
   activates the origin gate: Estalara's KV record has no `allowed_origins` → `inherit` → only
   `app.estalara.com` + `admin.estalara.com` pass; any other origin in live use starts 403ing).
2. **Deploy** `wrangler deploy --env production` from a clean checkout of `main`.
3. **Post-deploy verification:** `/health` 200; events from `app.estalara.com` accepted; a
   localhost-origin POST now returns 403 `forbidden_origin` (TODAY it passes — that is the
   regression test this escalation hands you); Sentry shows no `origin_policy_unconfigured` for the
   first-party tenant (proves the FOLLOW-658 guard + today's secret agree).
4. Decide whether a prod deploy pipeline (extend `deploy-staging.yml` with a gated production job)
   becomes a ticket, so this class ends — this is the third "merged ≠ live" surface after ESC-020
   (Estalara-app DOM hooks) and ESC-042 (Modal intent-engine).

**Resolution:** RESOLVED 2026-07-26 (session 61) — **verified deploy executed via FOLLOW-690**, CEO
at the keyboard for every mutation, Claude driving reads/interpretation. Full procedure captured as
`docs/runbooks/INGEST_WORKER_DEPLOY.md` (Rule AH: executed steps only). Facts:

- **Pre-flight found the account was missing BOTH queues** (`estalara-events-retry`, `-dlq` —
  required since FOLLOW-482/#449, 20+ days merged): the account had zero queues, so a blind
  `wrangler deploy` would have failed. Created via `wrangler@4` (repo's wrangler 3.114 hits a
  queues-create API incompatibility: `The specified queue settings are invalid.`). KV namespaces +
  the secret trio pre-existed; optional secrets (`SENTRY_DSN_INGEST`, `MODAL_CHAT_NLP_URL`,
  `REDPANDA_*`) absent but code-verified graceful.
- Two traffic samples (45s + 4min `wrangler tail`) saw **zero** live requests pre-deploy — the
  origin-gate activation risk was nil in practice (consistent with ESC-020: client hooks never
  shipped).
- Staging deploy green (bundle/API smoke), then production: version
  `6b943785-2d32-4ace-b76e-580d950ed662` (May-29 code) → **`e64dd0c3-89ef-44a7-849c-47a4883ea6a6`**;
  all bindings attached (2×KV, DO, 2×queue producers + consumer).
- **Behavioral probes green:** `/health` 200; localhost-origin probe flipped from
  reaches-schema-validation (morning) to **403 `forbidden_origin`** (the standing regression test —
  also empirically clears FOLLOW-678's mis-set axis for the current value, since a wrong UUID would
  have produced `origin_policy_unconfigured`); `app.estalara.com`-origin probe passed both gates and
  was rejected ONLY by schema (`accepted:0` — zero persistence by construction). Response
  fingerprint (discriminator list incl. `live.signup`/`adapt.description.*`) proves the new bundle
  serves. No rollback needed.
- Now live for the first time: FOLLOW-559 server-side consent gate, FOLLOW-579 snapshot stripping,
  FOLLOW-642+658 origin enforcement (with today's `FIRST_PARTY_TENANT_ID`), FOLLOW-459/482/513
  ACK/queue/Sentry paths.
- **Still open, deliberately:** item 4 (production deploy pipeline) stays an unmade decision —
  `deploy-staging.yml` remains manual/staging-only/never-green; `SENTRY_DSN_INGEST` unset = the
  FOLLOW-658 guard 403s but cannot page; FOLLOW-678 canonicalization remains worth doing.

## RESOLVED — prod `ingest_worker` ClickHouse user has NO grant on `description_generations`, blocking FOLLOW-463's audit-trail write [FOLLOW-463]

**Filed by:** ml-engineer (session, FOLLOW-463) **Date:** 2026-07-08T00:00:00Z **Affects:**
FOLLOW-463 (P2, audit F-17), `apps/control-plane/src/app/api/internal/description-cache/route.ts`,
prod ClickHouse **Type:** other (infra/ops — grant)

**Description:** FOLLOW-463 makes `POST /api/internal/description-cache` write a
`description_generations` audit row (via `writeDescriptionGenerationAudit`, using the same
`ingest_worker` credentials — `CLICKHOUSE_USER`/`CLICKHOUSE_PASSWORD` — every other control-plane
ClickHouse sink in this app uses). Per `docs/runbooks/clickhouse-ingest-worker-grant-narrowing.md`
(ESC-032 / FOLLOW-424, executed 2026-06-29), the prod `ingest_worker` grant was deliberately
**narrowed to exclude `description_generations` entirely** — the runbook's Confirmed Table Access
table lists it as "**none** (no writer) — intentionally dropped", and the prod attestation's
negative control (`SELECT ... FROM default.description_generations`) was confirmed `ACCESS_DENIED`
(Code 497). That premise is no longer true: FOLLOW-463 is the writer ESC-032 didn't anticipate.

**Impact if not fixed:** the code is fail-loud-but-non-blocking by design (matches the ticket's AC —
a CH failure must not fail the Modal callback), so nothing breaks. But every insert attempt in prod
will get HTTP 403/497 `ACCESS_DENIED`, captured to Sentry as
`kind: 'description_generations_write_failed'`, and the `description_generations` table will stay
empty in prod — i.e. FOLLOW-463's actual goal (a durable §E.7.5 anti-hallucination audit trail) will
silently not be achieved until the grant is added, even though CI/local tests are green and the PR
looks fully functional. This is the exact RETRO-021 failure shape (measured-in-fixture,
not-reachable-in-prod) the ml-engineer guardrails require flagging up front.

**Required action:** A ClickHouse Cloud admin (per the runbook, `default` via the Cloud SQL console
— `ingest_worker` has no `GRANT OPTION`) must run:

```sql
GRANT INSERT ON default.description_generations TO ingest_worker;
```

and update the grant-narrowing runbook's Confirmed Table Access table (`description_generations`
row) to reflect the new writer, replacing "none (no writer) — intentionally dropped" with the
FOLLOW-463 write path. Re-run the runbook's Step 3 smoke test (INSERT + cleanup) to confirm.

**Resolution:** 2026-07-09 — resolved by Piotr (CEO) via the ClickHouse Cloud SQL console (admin
`default`), service `hl0kc83gt4.eu-west-1.aws.clickhouse.cloud:8443`, bundled with FOLLOW-535's
migration 0020 (TTL) in RETRO-167 order (TTL first, then GRANT).

**Near-miss caught by CLI verification (RETRO-167 verify discipline).** The first attempt granted a
**misspelled** table — `descriptions_generations` (extra "s"). A CLI check (`SHOW GRANTS` as
`ingest_worker` via Doppler `prd` creds) exposed it: the real table `description_generations` still
returned `Code: 497 ACCESS_DENIED`. Corrected in a second admin pass:

```sql
REVOKE INSERT ON default.descriptions_generations FROM ingest_worker;   -- drop the typo
GRANT  INSERT ON default.description_generations  TO ingest_worker;     -- correct table
```

**Verified from CLI 2026-07-09** — `SHOW GRANTS` (as `ingest_worker`) now includes, and the typo
table is gone (0 occurrences):

```
GRANT INSERT ON default.description_generations TO ingest_worker
```

The grant is **INSERT only** — `ingest_worker` retains NO SELECT on this table (write-only audit
sink; the reader is the still-open FOLLOW-536). The FOLLOW-535 TTL leg is **verbatim-verified**: an
admin `SHOW CREATE TABLE default.description_generations` shows
`TTL toDateTime(created_at) + toIntervalMonth(13)` on the correct table (an initial `INTERNAL` typo
was corrected to `INTERVAL` first; full DDL archived in `docs/runbooks/clickhouse-migrations.md`).
Attested in `docs/runbooks/clickhouse-ingest-worker-grant-narrowing.md` and
`docs/runbooks/clickhouse-migrations.md`. Two operator typos in one session (`descriptions_` grant,
`INTERNAL` TTL) are fresh evidence for FOLLOW-542 (durable, copy-safe, CLI-verified runbook). See
RETRO-167, FOLLOW-542.

See RETRO-167, FOLLOW-542.

---

## RESOLVED — Approve ADR-0017 (Cloudflare Queues durable retry) before FOLLOW-482 (P1) is worked [FOLLOW-482]

**Filed by:** pm-orchestrator (session 10) **Date:** 2026-07-06T00:00:00Z **Affects:** FOLLOW-482
(P1), apps/ingest, ADR-0017 **Type:** architectural | vendor

FOLLOW-482 was elevated to P1 (RETRO-154): ClickHouse is the SOLE prod `events` sink (Redpanda is a
no-op, ESC-017), so FOLLOW-459's post-ACK move made at-least-once **best-effort** — a terminal CH
failure after the ~3.1s in-process retry window loses events. The architect wrote
`docs/adr/ADR-0017-durable-post-ack-clickhouse-retry-queue.md` (Status: **PROPOSED**) recommending a
**Cloudflare Queue** (`estalara-events-retry` + native DLQ `estalara-events-retry-dlq`) produced-to
on terminal CH failure and consumed by a new `queue()` handler in the same `apps/ingest` Worker (no
new deployable; reuses `pushToClickHouse`). Est. recurring cost **< $10/mo** at pilot volume (below
the €100/mo threshold — cost is not the blocker). Per CLAUDE.md (new third-party service / vendor
lock-in), this needs CEO sign-off before FOLLOW-482 is scheduled to a worker.

**Decisions needed from Piotr (PROPOSED → ACCEPTED):**

1. **Adopt Cloudflare Queues** as a new bound resource type on `apps/ingest` (new Terraform
   resource, new outage surface, new ops ownership)? Same-vendor as the existing Worker/KV/DO stack,
   but still a new service.
2. **Cloudflare Queues over Upstash Redis** (already a paid vendor in the stack) — architect
   recommends CF (fewer moving parts, native push-consumer, no extra cross-service hop); confirm the
   trade-off is accepted.
3. **Owner of the DLQ replay / pager runbook** (`estalara-events-retry-dlq` non-empty alert) —
   needed before FOLLOW-495's alerting AC can close.
4. **Accept the named duplicate-row risk:** the `events` CH table has **no dedup key**
   (ReplicatedMergeTree, ORDER BY excludes `event_id`); a queue-level retry compounds (additively)
   the pre-existing in-process-retry duplicate risk. ADR-0017 does NOT add dedup — accept as a named
   risk, or require a dedup key (ReplacingMergeTree / idempotency key) as part of FOLLOW-482 scope?

**Resolution (2026-07-06, CEO Piotr — ACCEPTED):** (1) **Adopt Cloudflare Queues.** (2) **Cloudflare
Queues over Upstash Redis** — confirmed. (3) DLQ replay/alert runbook owner = **devops-engineer**
(discharged via FOLLOW-495's alerting work). (4) **Duplicate-row risk ACCEPTED as a named risk** —
no dedup key required; FOLLOW-482 does NOT add a `ReplacingMergeTree`/idempotency key. ADR-0017
flipped PROPOSED → ACCEPTED; FOLLOW-482 promoted to QUEUE (P1) and delegated to backend-engineer for
the Worker producer + `queue()` consumer + wrangler binding (actual CF Queue/DLQ + Terraform
provisioning is a devops/operator deploy-time step).

---

## RESOLVED — commitlint ticket-reference rule rejects the `TICKET-PILOT-` prefix [TICKET-PILOT-003]

**Filed by:** data-engineer **Date:** 2026-05-24T00:00:00Z **Affects:** TICKET-PILOT-003 (and any
other `TICKET-PILOT-NNN` Sprint 12 pilot tickets) **Type:** repo-config

**Description:**

The `ticket-reference` custom rule in `commitlint.config.cjs` enforces an allow-list of ticket
prefixes. Sprint 12 introduced the `TICKET-PILOT-NNN` family (see `backlog/sprint-12/`), but the
regex on line ~110 does not include a `PILOT-` alternative:

```js
/\[TICKET-(?:FIX-|INFRA-|...|RUNTIME-FIX-)?\d+[a-z]?\]|\[FOLLOW-\d+\]|\[ESCALATION\]/;
```

As a result the commit-msg hook rejects a well-formed message such as
`feat(data): add CTA-lift dashboard with holdout comparison [TICKET-PILOT-003]`.

I cannot edit `commitlint.config.cjs` from the data-engineer lane (it is a repo-wide config file),
and skipping hooks (`--no-verify`) is disallowed by the operating rules. The TICKET-PILOT-003 work
is otherwise complete: 26 new tests pass, full control-plane suite (568 tests) green, typecheck and
lint clean.

**Required action (devops-engineer or PM — ~2 minutes):**

Add `PILOT-` to the `ticketPattern` alternation in `commitlint.config.cjs`:

```js
/\[TICKET-(?:FIX-|INFRA-|DEMO-|ADM-|QUIZ-|DB-|EMB-|ARCH-|ADP-|DQS-|AUTO-|AB-|REORDER-|AGENCY-|GDPR-|VAL-|DESC-PIVOT-|DESC-|CAUSAL-|PROCESS-|DECISIONS-|RLS-|RUNTIME-AUDIT-|RUNTIME-FIX-|PILOT-)?\d+[a-z]?\]|\[FOLLOW-\d+\]|\[ESCALATION\]/;
```

Then the TICKET-PILOT-003 commit can be created and the PR opened.

**Resolution:** Resolved 2026-05-25 by pm-orchestrator. `PILOT-` was added to the `ticketPattern`
alternation in `commitlint.config.cjs`; the fix landed alongside PR #145 (FOLLOW-078). All
`[TICKET-PILOT-NNN]` commit subjects now pass the commit-msg hook (verified: PRs #143–#146 merged
with PILOT-prefixed commits).

---

## RESOLVED — ESC-010: DOPPLER_TOKEN_DEV secret must be provisioned in GitHub Actions [FOLLOW-040]

**Filed by:** devops-engineer **Date:** 2026-05-24T00:00:00Z **Affects:** FOLLOW-040, FOLLOW-063,
FOLLOW-068, FOLLOW-039 **Type:** repo-config

**Description:**

FOLLOW-040 has wired the Doppler CI integration into `.github/workflows/ci.yml`. The workflow
installs the Doppler CLI and uses `doppler run --` for secret injection. The `doppler-verify` job
performs a soft-skip when `DOPPLER_TOKEN_DEV` is absent (so CI is not broken), but it must have the
token to pass as a real green check.

The token has NOT been created yet. Until it is provisioned in GitHub Actions secrets:

- The `doppler-verify` job soft-skips (logs a clear message, exits 0) on every PR.
- FOLLOW-063 (seed CI), FOLLOW-068 (demo CI), FOLLOW-039 (ClickHouse DSR) will soft-skip any step
  that requires `doppler run --` with injected DB / API key credentials.

**Required action (Piotr — ~10 minutes):**

1. Go to [Doppler dashboard](https://dashboard.doppler.com) → project `estalara` → config `dev` →
   Access → Service Tokens → Create service token.
   - Name: `ci-github-actions`
   - Config: `dev` (NOT staging, NOT prod)
   - Expiry: none (or 1 year) — rotate on breach per V.6.1 policy
2. Copy the token value (shown only once).
3. Go to GitHub repo → Settings → Secrets and variables → Actions → New repository secret.
   - Name: `DOPPLER_TOKEN_DEV`
   - Value: (paste the token)
4. Trigger a CI run on any open PR (or push to a devops-engineer branch) — the `doppler-verify` job
   should now show "Doppler auth verified" instead of the soft-skip message.

**Do NOT create a production-scope token.** Production secrets remain Vercel-only per §V.6.3.

**Resolution:** RESOLVED 2026-06-10 by Piotr Nawrocki. Doppler service token `ci-github-actions`
created in project `estalara` config `dev`. Added as `DOPPLER_TOKEN_DEV` GitHub Actions repository
secret. CI `doppler-verify` job confirmed green ("Doppler auth verified").

---

## RESOLVED — GitHub Actions billing prevents CI from running on PR #125

**Filed by:** backend-engineer **Date:** 2026-05-21T21:40:00Z **Affects:** TICKET-AUTO-006-POLISH,
PR #125 **Type:** other

**Description:** All CI jobs for PR #125 fail immediately (2-4s) with "The job was not started
because recent account payments have failed or your spending limit needs to be increased." This is a
GitHub Actions billing/quota issue. All local checks pass: 474 tests, 0 ESLint errors in new files,
prettier unchanged. The code is production-ready but CI cannot validate it.

**Required action:** Resolve GitHub Actions billing so CI can run on PR #125. Once CI is green, PM
can merge and mark TICKET-AUTO-006-POLISH DONE.

**Resolution:** Resolved 2026-05-25 by pm-orchestrator. GitHub Actions billing has been restored —
CI has run green on PRs #142–#146 (Sprint 12) since this was filed. PR #125 (TICKET-AUTO-006-POLISH)
is stale and should be rebased + re-validated independently if the carve-out work is still wanted;
the billing block itself no longer applies.

---

## RESOLVED — Vendor Account Creation Required for 5 Infrastructure Providers

**Filed by:** devops-engineer  
**Date:** 2026-04-27T14:00:00Z  
**Affects:** TICKET-009, TICKET-014, TICKET-015, TICKET-020  
**Type:** vendor

**Description:**

TICKET-009 created Terraform module skeletons for 5 vendors (Supabase, ClickHouse Cloud, Modal,
Redpanda Cloud, Upstash), but all resources are commented out because vendor accounts do not exist
yet. These accounts must be created by a human with access to:

1. Shared team email (`infra@estalara.io` recommended) or CTO's personal accounts
2. Payment method (credit card) for production tiers
3. Doppler workspace access to store credentials

Without these accounts, downstream tickets are blocked:

- TICKET-014 (ClickHouse table DDL)
- TICKET-015 (Stream consumer Modal scaffold)
- TICKET-020 (Drizzle ORM + Supabase setup)

**Required action:**

1. **Create accounts** for all 5 vendors (follow `docs/runbooks/vendor-accounts.md`)
2. **Generate API tokens/keys** (documented in runbook, section-by-section)
3. **Store secrets in Doppler** under `dev` config (10+ secrets total):
   - `SUPABASE_ACCESS_TOKEN`, `SUPABASE_ORG_ID`, `SUPABASE_DB_PASSWORD`
   - `CLICKHOUSE_ORG_ID`, `CLICKHOUSE_API_KEY`, `CLICKHOUSE_API_SECRET`
   - `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`
   - `REDPANDA_CLIENT_ID`, `REDPANDA_CLIENT_SECRET`
   - `UPSTASH_EMAIL`, `UPSTASH_API_KEY`
4. **Verify setup** by running `terraform init && terraform validate` in each module
5. **Mark this escalation as RESOLVED** once all accounts are created and secrets stored

**Estimated time:** 2-3 hours (30 minutes per vendor)

**Cost commitment:** All vendors have free tiers or trial credits (no immediate payment required for
MVP testing).

**Resolution:** Resolved 2026-05-14 by pm-orchestrator audit. All 5 vendor accounts (Supabase,
ClickHouse Cloud, Modal, Redpanda Cloud, Upstash) have been active since Sprint 1+ — confirmed by
active tables in Supabase, ClickHouse DDL applied (TICKET-014, PR merged), Modal Python skeleton
running (TICKET-015), Redpanda consumer deployed (stream-consumer app), Upstash Redis active
(session cache). No human action required; this escalation was stale.

---

## RESOLVED — GitHub Actions CI workflow fails immediately with "workflow file issue" on all branches

**Filed by:** backend-engineer **Date:** 2026-05-01T10:50:00Z **Affects:** All tickets — TICKET-025
(and previously TICKET-012, TICKET-013, all main merges) **Type:** other (repo-config)

**Description:**

Every CI run since Sprint 0 completes in 0s with status `failure` and reason "This run likely failed
because of a workflow file issue." This includes pushes to `main` after merging TICKET-012 and
TICKET-013 (both previously marked DONE). The workflow file at `.github/workflows/ci.yml` appears
syntactically valid locally, so the issue is likely one of:

1. A required GitHub Actions secret (`TURBO_TOKEN`, `TURBO_TEAM`, or `GITHUB_TOKEN` permissions) is
   misconfigured or missing at the repo/org level
2. The `if: ${{ secrets.DOPPLER_TOKEN_DEV != '' }}` expression in the `doppler-verify` job uses a
   secrets context in a way that GitHub Actions flags as invalid at the workflow level
3. A GitHub Actions runner or org-level policy is blocking the workflow

All agent code (TICKET-012, 013, 025) passes local tests, typecheck, build, and prettier. The CI
infrastructure issue is not caused by agent code.

**Required action:**

1. Navigate to GitHub repo Settings → Actions → General and verify workflow permissions are set to
   "Read and write permissions"
2. Check if required secrets (`TURBO_TOKEN`, `TURBO_TEAM`) are set under Settings → Secrets and
   variables → Actions
3. Verify that the `if: ${{ secrets.DOPPLER_TOKEN_DEV != '' }}` guard in `doppler-verify` job is
   valid — this expression references `secrets` context which is not available in `if` conditions at
   the job level without `${{ secrets.NAME }}` wrapping. The correct form is:
   `if: ${{ secrets.DOPPLER_TOKEN_DEV != '' }}` which _should_ work but may fail for some org
   configurations
4. Try triggering a workflow run manually from the GitHub Actions UI to see the actual error message
5. If needed, devops-engineer should review and fix `.github/workflows/ci.yml`

**Partial fix history:**

- PR #21 (2026-05-01): Fixed `secrets` in job-level `if` condition (`doppler-verify` job)
- PR #22 (2026-05-01): Fixed `secrets` in workflow-level `env:` block (`TURBO_TOKEN`, `TURBO_TEAM`
  in `ci.yml`; `CLOUDFLARE_ACCOUNT_ID` in `deploy-staging.yml`)

**CI still fails after both fixes.** 30 runs total across all branches, 0 successes. The API returns
`total_count: 0` jobs and `billable: {}` — nothing runs. The exact error message is only visible in
the GitHub Actions UI (navigate to Actions → select any failed run → see the banner).

**Required human action:** Navigate to GitHub repo → Actions → select a failed run → read the banner
message that says "This run likely failed because of a workflow file issue." The SPECIFIC error text
below that banner will identify the remaining root cause. The agent cannot see this message via the
GitHub API. Possible remaining issues:

- Missing `permissions:` block required by a repo or org policy
- A GitHub Actions feature (required workflows, environment protection) blocking the run
- A third workflow validation error not yet identified

**Resolution:** Resolved 2026-05-04 via PR #34. Root cause:
`if: ${{ secrets.DOPPLER_TOKEN_DEV != '' }}` on a step-level `if` is invalid in GitHub Actions
(secrets context not available there), causing the workflow to fail at parse time before any jobs
were queued. Fix: removed the invalid `if` condition (job has `continue-on-error: true` so
doppler-verify is non-blocking). Additional fixes in the same PR: build @estalara/shared before
lint, add `permissions: pull-requests: read` to gitleaks-scan, auto-detect placeholder test,
ClickHouse auth (CLICKHOUSE_PASSWORD env var + per-statement execution + UInt64 type fix). CI now
green on main: `completed success` run #25315111966.

---

## RESOLVED — Sprint 8 spec doc needed before architect can write ticket files

**Filed by:** pm-orchestrator **Date:** 2026-05-13T10:00:00Z **Affects:** TICKET-AB-001,
TICKET-REORDER-001, TICKET-AGENCY-001, TICKET-FAIR-001, TICKET-AB-004, TICKET-NATIVE-001,
TICKET-CAUSAL-001 **Type:** scope **resolved_at:** 2026-05-13 **resolved_by:** Piotr Nawrocki

**Description:**

Sprint 7 and Sprint 7.5 are both DONE as of 2026-05-13. Sprint 8 ticket skeletons have been added to
QUEUE.md under "Sprint 8 — A/B holdout + re-ranking + agency answers + fair-housing linter" with
agent assignments, estimated hours, dependencies, and scope notes. However, no formal
`docs/specs/SPRINT_8_SPEC.md` exists yet (analogous to `docs/specs/SPRINT_7_5_SPEC.md`).

Architect agent cannot write the full ticket markdown files (under `backlog/sprint-8/`) without a
human-reviewed spec doc that resolves the two open scope questions below.

**Open questions requiring human decision before spec is written:**

1. **Fair-housing linter scope for re-ranking (TICKET-REORDER-001 + TICKET-FAIR-001 conflict).** The
   Master Design (E.3.2) requires `brand_safety_score` from the fair-housing linter as one of five
   inputs to the multi-objective optimization score. But the ReorderDirective re-sorts listing cards
   on a search results grid. This raises a genuine fair-housing question: does re-ranking listings
   per archetype constitute "steering" under the US Fair Housing Act (FHA) or UK Equality Act? If a
   `yield_hunter` archetype sees investment-yielding listings ranked first, and that archetype
   correlates with a protected class, we have a legal exposure. The compliance-engineer has not yet
   assessed this. **Decision needed:** (a) permit re-ranking with a linter gate, or (b) restrict
   re-ranking to non-protected signals only (price, size, location), or (c) defer REORDER-001 to
   Sprint 9 until compliance assessment is complete.

2. **NATIVE-001 CTO/CPO dependency.** TICKET-NATIVE-001 (app.estalara.com Tier 3 integration)
   requires Rafal (CTO) to add `data-estalara-*` attributes to SvelteKit components and Krystian
   (CPO) to approve the slot mapping. This is human engineering work that agents cannot perform.
   **Decision needed:** (a) who schedules this human work, (b) whether NATIVE-001 is in Sprint 8 or
   a dedicated CTO sprint, (c) whether the SDK side of NATIVE-001 (sdk-engineer wiring the init and
   corpus fixture) can proceed before CTO adds the attributes.

**Required action:**

1. Piotr reviews the two open questions above and provides direction.
2. Architect agent writes `docs/specs/SPRINT_8_SPEC.md` incorporating that direction plus the
   skeleton ticket scopes already in QUEUE.md.
3. Piotr reviews and approves the spec doc.
4. PM-orchestrator promotes Sprint 8 tickets from BACKLOG to READY and begins delegation.

**Suggested first-mover once spec is approved:** TICKET-AB-001 (no internal Sprint 8 dependencies,
unblocks AB-004 and FAIR-001) in parallel with TICKET-REORDER-001 (if fair-housing question is
resolved). TICKET-CAUSAL-001 is P2 and should not start until AB-001 has 2+ weeks of real holdout
data in production.

**Resolution:**

Both open questions resolved by Piotr Nawrocki on 2026-05-13:

1. **Fair-housing / REORDER-001:** REORDER-001 is **unblocked**. No FAIR-001 linter is needed at
   this stage. Rationale: Estalara does not collect demographic data. Archetypes are derived
   exclusively from behavioral signals (scroll depth, chat intent, dwell time, click patterns) —
   they are behavioral clusters, not demographic categories. No protected-class identity attaches to
   a session. Re-ranking listings to fit a buyer's expressed behavioral intent (e.g., `yield_hunter`
   reading rental-yield content → surface high-yield listings first) is not steering under
   FHA/Equality Act/UAE PDPL definitions, which all anchor on protected characteristics (race,
   religion, family status, national origin, gender, disability). Because none of those signals
   enter the archetype space, the legal premise of "steering" does not apply. **IMPORTANT CAVEAT
   (binding on all future agents):** This determination holds only as long as the archetype space
   remains purely behavioral. If any agent proposes adding a demographic or proxy-demographic signal
   to an archetype — including zip-code priors, name analysis, photo analysis, or any signal that
   acts as a proxy for race, religion, family status, national origin, gender, or disability — this
   decision MUST be re-litigated via a new escalation before that signal enters any model or
   pipeline. TICKET-FAIR-001 is CANCELLED as a result (not required at this stage).

2. **NATIVE-001 CTO/CPO dependency:** TICKET-NATIVE-001 is **deferred to MVP launch**. Tier 3 Native
   components require Rafal (CTO) and Krystian (CPO) scheduling on the SvelteKit side. That work is
   sequenced for the launch window, not Sprint 8. The SDK side does not proceed speculatively — it
   would create rework risk. NATIVE-001 remains BLOCKED with updated reason.

---

## RESOLVED — Fair-housing risk in copy_template strings (US-region pilot blocker)

**Filed by:** retrospective-analyst (RETRO-004) **Date:** 2026-05-14 **Affects:** TICKET-046,
TICKET-DESC-001, Sprint 11 pilot launch **Type:** compliance

**Description:** RETRO-004 surfaced that multiple `copy_template.en` strings introduced in PR #92
(TICKET-046) contain protected-class (familial-status) value propositions. Specifically,
`family_buyer` and `student_parent` archetype templates describe lifestyle outcomes tied to
household composition — language that, while not using protected-class terms directly, could be
construed as steering under FHA (US) if served to sessions that could be profiled as family
households.

Examples (from PR #92 merged copy):

- `family_buyer.copy_template.en` — references "family-friendly", "school catchment areas", "family
  space" etc. as the primary value proposition surfaced to that archetype
- `student_parent.copy_template.en` — references proximity to universities as a primary hook

The 2026-05-13 fair-housing resolution (above) determined that archetype = behavioral, not
demographic. That determination holds — but it applies to the _routing/reordering_ layer, not the
_copy layer_. The copy_template strings are surfaced to buyers and explicitly market familial
lifestyle outcomes. This is a distinct exposure from the reorder decision:

- Reorder: "which listings appear first" — ruled non-steering because no protected class attaches
- Copy: "what language is served to a behavioral cluster" — if the cluster correlates with family
  status, serving family-marketing copy may constitute illegal steering under HUD guidance on
  advertising, even if the archetype signal is behavioral

**Required action:**

1. **Piotr / compliance-engineer review** — confirm whether the 2026-05-13 ruling extends to the
   copy layer or whether a separate assessment is needed.
2. If a separate assessment IS needed: compliance-engineer runs a fair-housing copy audit on all 17
   non-neutral `copy_template.en` strings (focus: family_buyer, student_parent, diaspora_buyer,
   retiree_relocator) before any US-region pilot tenant is onboarded.
3. If the 2026-05-13 ruling DOES extend (behavioral copy = not steering): mark this resolved, add a
   binding note that copy strings must not reference protected characteristics explicitly (race,
   religion, gender, disability, national origin, family status) — behavioral framing only.

**Impact if unresolved:** `copy_template.en` strings MUST NOT be served to US-region sessions until
this is resolved. The `GET /api/adapt/description` endpoint (TICKET-DESC-001, Sprint 9) and any
SDK-side copy rendering must gate on `tenant.region !== 'us'` OR require compliance sign-off. →
tracked as FOLLOW-034 in `backlog/FOLLOW_UPS.md`.

**Resolution:** Resolved 2026-05-14 by Piotr Nawrocki (CEO).

The system does NOT limit access to listings or information. Every buyer receives the same complete
set of listings — the copy_template and variant strings adjust only the PRESENTATION framing of the
same underlying property data, not which properties are shown or hidden. This is equivalent to a
travel site displaying "family-friendly amenities" vs "business-travel essentials" for the same
hotel room: the framing differs, the access does not.

HUD fair-housing advertising guidance prohibits copy that EXCLUDES or DISCOURAGES protected classes
from accessing listings. Because Estalara serves all listings to all sessions (no filtering by
archetype at the listing-selection layer), the copy layer presents no gatekeeping exposure. The
archetype system is purely behavioral (scroll depth, dwell time, intent signals); no protected-class
identity enters the signal space (binding constraint from 2026-05-13 resolution above). Presenting
the same property in a yield-focused framing vs a family-amenity framing to different behavioral
clusters does not constitute steering under FHA/HUD advertising rules.

Binding constraint going forward: copy_template and variant strings MUST NOT reference protected
characteristics explicitly (race, religion, gender, disability, national origin, family status,
national origin). Behavioral framing only (investment return, space utility, commute time, lifestyle
fit). Agents writing or editing copy strings must follow this constraint.

FOLLOW-034 is CANCELLED — no compliance audit or region gate required.

---

## RESOLVED — ESC-009: Provision E2E_BEARER_TOKEN GitHub Actions secret for demo-integration CI job

**Filed by:** qa-engineer **Date:** 2026-05-24T00:00:00Z **Affects:** FOLLOW-068, PR
`qa-engineer/FOLLOW-068-demo-ci` **Type:** other

**Description:** The `demo-integration` CI job (`.github/workflows/demo-integration.yml`) runs the
detect → activate → adapt → SDK E2E spec with a live Next.js server. Steps 1–3 of the spec POST to
authenticated routes (`/api/detect`, `/api/schema/activate`, `/api/adapt`) using a Bearer token
drawn from the `E2E_BEARER_TOKEN` environment variable. The spec's `beforeAll()` precheck
(FOLLOW-067, bundled into FOLLOW-068) fails fast with an actionable error if the token is absent, so
the job will not produce 401-hang failures — but it also cannot run the integration steps without
the token.

The token must be a valid JWT signed by `JWT_SECRET` for the demo/canary E2E tenant
(`E2E_TENANT_ID`, defaulting to `est_test_e2e_tenant`). It should be long-lived (or auto-rotated)
and scoped read-write to that tenant only.

Additionally, `E2E_TENANT_ID` (the canary tenant's Postgres UUID) should be set as a GitHub Actions
variable (`vars.E2E_TENANT_ID`) so the workflow can pass it to the spec without hardcoding.

**Required action:**

1. DevOps/Piotr: generate a long-lived E2E JWT for the `est_test_e2e_tenant` / `tnt_canary_eu` demo
   tenant (or whichever tenant UUID is used for canary).
2. Add it to GitHub Actions repository secrets as `E2E_BEARER_TOKEN`.
3. Add the tenant UUID to GitHub Actions repository variables as `E2E_TENANT_ID`.
4. After adding, re-run the `demo-integration` workflow on the PR branch to confirm the E2E steps
   execute (rather than soft-skipping due to missing DOPPLER_TOKEN_DEV — note: the DOPPLER soft-skip
   is a separate gate; the E2E_BEARER_TOKEN precheck is the inner gate within the E2E describe
   block).

**Note:** The demo-integration job also requires `DOPPLER_TOKEN_DEV` (tracked separately as
FOLLOW-040). Until FOLLOW-040 lands, the job soft-skips with exit 0 before the spec even runs.
Provisioning `E2E_BEARER_TOKEN` now is still recommended so it is ready the moment FOLLOW-040
unblocks the job.

**Resolution:** RESOLVED 2026-05-24 by Piotr Nawrocki. `E2E_BEARER_TOKEN` added as GitHub Actions
repository secret (2026-05-24T15:48Z). `E2E_TENANT_ID` added as GitHub Actions repository variable
with value `est_test_e2e_tenant` (2026-05-24T15:47Z). Confirmed present via `gh secret list` on
2026-06-10.

---

## RESOLVED — ESC-011: GitHub Actions not starting any runs — FOLLOW-105 Wave-1 PR #149 cannot get CI green

**Filed by:** pm-orchestrator **Date:** 2026-05-25T20:30:00Z **Affects:** FOLLOW-105 Wave 1 (PR
#149, `feat/follow-105-1bcd-canonical-adapt-enforcement`) and ALL subsequent PRs **Type:**
repo-config / account

**Description:** PR #149 (FOLLOW-105 Wave 1) was opened and pushed, but the GitHub Actions `CI`
workflow created **zero runs** for it. Diagnosis:

- The CI workflow is `active` (not disabled) — confirmed via `gh workflow list`.
- There have been **no workflow runs of any kind across the whole repo since 2026-05-25T15:08:45Z**
  (the #148 merge-to-main push). My PR was created well after that and got nothing.
- `ci.yml` `on.push.branches` only matches `main` + agent-prefixed branches (`sdk-engineer/**`,
  `architect/**`, …). A `feat/**` branch like #149's does NOT match the push trigger — but the
  `on.pull_request → main` trigger should still fire (it DID for #148's
  `feat/follow-105-1a-sdk-audit` branch at 14:54).
- Close/reopen of #149 (to re-fire the `pull_request` event) produced **no new run**.

**Most likely cause:** a **GitHub Actions minutes / billing limit** reached on the `Pnawrocki9`
personal account after 15:08 (workflows stay "active" but GitHub silently stops starting new runs),
or a transient GitHub Actions incident. Only the account owner can confirm/resolve.

**Impact:** Per CLAUDE.md, PM cannot mark a ticket READY_FOR_REVIEW until CI is green. With Actions
not running, CI-green is unverifiable on the platform. PM has validated locally instead (see below),
but this blocks the documented merge gate for #149 and every future PR until Actions runs again.

**Local validation already performed (substitute evidence while Actions is down):**

- `pnpm turbo run build typecheck test`: all pass except `@estalara/e2e-smoke` (needs a live ingest
  Worker at 127.0.0.1:8787 — environmental; pre-existing-red on merged PRs #146/#148 too).
- `pnpm exec prettier --check` on all changed files: clean.
- `bash scripts/check-rule-h.sh` (incl. the new adapt gates): pass.
- `bash scripts/check-mirror-files.sh` (Rule J): pass (ran in pre-push).
- `bash scripts/check-rule-i.sh`: 114 violations — **pre-existing-red (107 at base, FOLLOW-090),
  non-blocking** (merged PRs #146/#148 also have rule-i red). +7 from this PR: +3 decision-api libs
  orphaned by the ratified Worker-410 (owned by FOLLOW-107) + ~4 new test-only/util exports.

**Required action (account owner / Piotr):**

1. Check GitHub → Settings → Billing → Actions usage for the `Pnawrocki9` account; raise the
   spending limit or wait for the monthly reset if minutes are exhausted. (Or confirm a GH
   incident.)
2. Once Actions runs again, re-trigger #149 (push an empty commit, or close/reopen) and confirm the
   real merge gates are green: Build, Build (control-plane), Format check, Auto-Detection corpus
   gate, ClickHouse migrations smoke, Doppler verify, Test (Node), rule-h, rule-j. (Vercel, Rule I,
   and Python tests are pre-existing-red and non-blocking per the #146/#148 merge history.)
3. **Convention note:** #149 uses branch `feat/follow-105-1bcd-...` per the spawn instruction, which
   does NOT match the `push`-trigger agent-prefix allowlist in `ci.yml`. The repo's reliable CI path
   is push-triggered on agent-prefixed branches (CLAUDE.md branch-naming =
   `<agent>/<ticket>-<slug>`). Recommend future PR branches use an agent prefix (e.g.
   `architect/FOLLOW-105-...`) so push-CI fires regardless of the pull_request trigger. PM can
   rename/re-push #149's branch on request.

**Resolution:** RESOLVED 2026-05-25. Two compounding causes, both addressed: (1) **branch-name /
trigger mismatch** — the `feat/**` branch matched neither the `push` allowlist nor (anomalously) the
`pull_request` trigger; renaming to `architect/FOLLOW-105-canonical-adapt-enforcement` (PR #150,
supersedes #149) put it on the reliable push-CI path. (2) **Actions budget** — the account owner
bumped the GitHub Actions budget and pushed a retrigger commit (`09adfd6`). CI now runs; PR #150 is
green on every real merge gate (Build, Build control-plane, Typecheck, Lint, Test Node 22, SDK E2E,
rule-h, rule-j, Format, corpus, ClickHouse, Doppler, Gitleaks). **Lasting fix:** future PR branches
must use the `<agent>/<ticket>-<slug>` convention (CLAUDE.md) so push-CI fires regardless of the
pull_request trigger.

---

## RESOLVED — ESC-012: `pnpm db:migrate` against any env will fail until pilot tenant exists [FOLLOW-149 / TICKET-PILOT-001]

**Filed by:** devops-engineer **Date:** 2026-05-28T20:00:00Z **Affects:** any environment that runs
`pnpm db:migrate` after FOLLOW-149's journal repair lands and before TICKET-PILOT-001 seeds the
pilot tenant. Concretely: dev, staging, and any future region/tenant DB clone that has not yet had
the pilot tenant `000-app-estalara` inserted. **Type:** sequencing / operational

**Discovered during:** FOLLOW-149 Part D — applying migration 0015 to prd.

**Description:** Drizzle's pg-core migrator wraps ALL pending migrations in a single transaction
(`drizzle-orm/pg-core/dialect.js:60 `await
session.transaction(...)`). Migration 0016 (`0016_pilot_inquiry_selector.sql`) ends with a `DO $$
... RAISE
EXCEPTION`guard that aborts when the pilot tenant`000-app-estalara`is missing. Pre-pilot prd had 0 tenants → running`pnpm
db:migrate`raised inside the txn and rolled BOTH 0015 and 0016 back. To honour FOLLOW-149's explicit "do not apply 0016 in this ticket" instruction (and because 0016 requires a real tenant), I applied 0015 via a one-off, isolated`BEGIN/INSERT
INTO drizzle.\_\_drizzle_migrations/COMMIT` mirror of the migrator's per-entry logic. **0015 is now
applied on prd; 0016 remains pending.**

The systemic issue this exposes: `pnpm db:migrate` is no longer a "safe to run anywhere" command.
Any future invocation in dev / staging / a fresh region clone will hit the same 0016 raise and roll
back any future entries 0017+ alongside it.

**Required action (TICKET-PILOT-001 or earlier):** TICKET-PILOT-001 (Magic Link wizard
`POST /api/tenants`) MUST seed the pilot tenant row BEFORE the operator runs any `pnpm db:migrate`
that needs to pick up 0016+. Two equivalent paths:

1. Make TICKET-PILOT-001's wizard step explicitly call db:migrate AFTER tenant creation, and
   document the order in `docs/runbooks/pilot-onboarding.md` (does not exist yet — see FOLLOW stub).
2. Edit migration 0016 to skip its `UPDATE`/`RAISE` block when the tenant row is absent (i.e. change
   `RAISE EXCEPTION` to a `RAISE NOTICE` no-op). This is data-engineer's call; out of scope for
   FOLLOW-149 because the ticket forbids editing migration SQL.

**Workaround until then:** Operators running `pnpm db:migrate` against a tenant-less DB will see
0016 fail loudly with the FOLLOW-141/FOLLOW-147 error message. Pending entries from 0017+ (none
exist yet) would also roll back. Use the same isolated apply pattern I used for 0015 if any 0017+
entry must land before the pilot exists. Long-term, this is brittle — pick path 1 or 2 above.

**Resolution:** RESOLVED 2026-05-29. Path (1) confirmed: `POST /api/tenants` (tenant-create)
executed before `pnpm db:migrate` during TICKET-PILOT-001 onboarding. Migration 0016 applied cleanly
after pilot tenant `000-app-estalara` was seeded; `RAISE EXCEPTION` guard passed.
`SELECT inquiry_submit_selector` on the pilot tenant row confirms the column is populated.
Sequencing order documented in `docs/ops/PILOT_RUNBOOK.md` §3 "Migration sequencing."

---

## RESOLVED — ESC-013: app.estalara.com frontend repo path unknown to sdk-engineer [TICKET-PILOT-001]

**Filed by:** sdk-engineer **Date:** 2026-05-29T00:00:00Z **Affects:** TICKET-PILOT-001 Step 1 (SDK
snippet install in frontend layout) **Type:** scope / operational

**Description:**

TICKET-PILOT-001 Step 1 requires editing `+layout.svelte` in the app.estalara.com SvelteKit frontend
to inject the SDK snippet. However:

1. No SvelteKit repo (no `.svelte` files, no `svelte.config.js`) exists in any accessible directory
   on this machine. Searched: all directories under `/home/asipi/Projects/` and `/home/asipi/`.
2. `/home/asipi/Projects/EstalaraNew` is a Next.js app (marketing site `estalara.com`), not
   `app.estalara.com`.
3. `/home/asipi/Projects/Live-Hosts` is a .NET + Python stack unrelated to SvelteKit.

The ticket spec says "SvelteKit `+layout.svelte`" but no such file exists in the accessible tree.
The app.estalara.com frontend may be in a private repo, a separate machine, or may actually be
Next.js not SvelteKit. The SDK snippet parameters and slot requirements are fully documented in
`docs/ops/PILOT_RUNBOOK.md` §5 (added by this PR) and can be applied as soon as the path is known.

**Required action (Piotr — 2 minutes):**

Provide the path to the app.estalara.com frontend repo so sdk-engineer can edit the layout file and
inject the snippet in Step 1. Options:

a. If the repo is local: provide the absolute path. b. If the repo is on GitHub: provide the repo
URL. sdk-engineer will clone and edit. c. If the frontend is actually Next.js (not SvelteKit): the
snippet goes in `app/layout.tsx` using Next.js `<Script>` component with
`strategy="afterInteractive"`.

**Required action (DNS — separate):** `admin.estalara.com` resolves to an nginx server (not Vercel),
blocking the Step 1 smoke test for `GET /api/adapt`. See ESC-014.

**Resolution:** RESOLVED 2026-05-29. SDK installed on `app.estalara.com` via Tier 2 script tag by
CTO Rafał Palak. Script `src` points to `https://admin.estalara.com/sdk.js` (served as Vercel static
asset per ESC-015). Verified: `sdk.js` loads in browser DevTools on `app.estalara.com`.

---

## RESOLVED — ESC-014: admin.estalara.com DNS not pointing to Vercel control-plane [TICKET-PILOT-001]

**Filed by:** sdk-engineer **Date:** 2026-05-29T00:00:00Z **Affects:** TICKET-PILOT-001 smoke test
(Step 1 AC: `GET https://admin.estalara.com/api/adapt` returns 200) **Type:** operational / devops

**Description:**

The TICKET-PILOT-001 acceptance criteria require:

> Smoke assertion: `GET https://admin.estalara.com/api/adapt` returns 200 (NOT 410)

Current state: `admin.estalara.com` resolves to an nginx/1.22.1 server returning "Welcome to KIEG
server!" — not the Vercel-deployed control-plane. Verified via:

```
HTTP/1.1 200 OK
Server: nginx/1.22.1
Date: Fri, 29 May 2026 05:21:13 GMT
```

This means `GET https://admin.estalara.com/api/adapt` returns 404 (nginx, not Vercel). The
control-plane is confirmed to be a Next.js app with a Vercel deployment config
(`apps/control-plane/vercel.json`, region `cdg1`), but the custom domain `admin.estalara.com` has
not been configured as a Vercel custom domain, or the DNS has not been pointed to Vercel's
nameservers.

The SDK's `data-decision-url` in production must be `https://admin.estalara.com/api`. If this domain
does not point to Vercel before SDK install, all `/api/adapt` calls from app.estalara.com will 404.

**Required action (Piotr or devops-engineer — ~15 minutes):**

1. Go to Vercel project dashboard for the control-plane.
2. Add `admin.estalara.com` as a custom domain.
3. Update DNS records at the registrar to point `admin.estalara.com` to Vercel (CNAME to
   `cname.vercel-dns.com` or A record to Vercel's IP, as Vercel instructs).
4. Wait for DNS propagation.
5. Verify:
   `curl -s -o /dev/null -w "%{http_code}" "https://admin.estalara.com/api/adapt?session_id=smoke&archetype=neutral&confidence=0.5&similarity=0.5&tier=1" -H "Authorization: Bearer <key>"`
   returns 200.

Until this is resolved, use the Vercel preview URL as a temporary `data-decision-url` for shadow
mode. Report the Vercel preview URL to sdk-engineer to unblock the snippet install.

**Resolution:** RESOLVED 2026-05-29. `admin.estalara.com` added as a custom domain on the Vercel
control-plane project. DNS CNAME record set to `6f8ae58f0ad31434.vercel-dns-017.com`. Verified:
`dig admin.estalara.com` resolves to Vercel; `curl https://admin.estalara.com/api/adapt` returns 200
(not 404 nginx).

## RESOLVED — ESC-015: SDK serve URL `cdn.estalara.com` is unprovisioned; pilot snippet src 404s [TICKET-PILOT-001]

**Filed by:** devops-engineer **Date:** 2026-05-29T00:00:00Z **Affects:** TICKET-PILOT-001 (Sprint
13a pilot launch), every tenant onboarded via the Magic Link wizard, every snippet currently emitted
by `apps/control-plane/src/components/onboarding/DetectionPreview.tsx:buildSnippet()` **Type:**
infrastructure / pilot-blocker

**Description:**

`buildSnippet()` emits `<script src="https://cdn.estalara.com/sdk.js" ...>` (the canonical CDN host
named by `SDK_CDN_URL` in `packages/shared/src/domains.ts:16`). Diagnostic during pilot dry run
confirmed:

- `cdn.estalara.com` has never been provisioned. No DNS record, no Cloudflare R2 bucket, no
  Wrangler/Terraform deploy pipeline, no SRI release flow.
- `packages/sdk/dist/estalara-sdk.iife.js` is built by `pnpm --filter @estalara/sdk build` but is
  gitignored and only ever published via `npm pack` for downstream consumers. Nothing uploads it to
  a public host.
- Net effect: every tenant who copy-pastes the wizard-generated snippet hits a DNS-level 404 on the
  `src` attribute, so the SDK never loads. Tier 1/2/3 are all silently broken at the install step.

`admin.estalara.com` (the Next.js control plane on Vercel) went live today via ESC-014. It already
serves Vercel static assets from `apps/control-plane/public/`. CEO decision: **ship the pilot by
serving the SDK bundle as a Vercel static asset under `https://admin.estalara.com/sdk.js`**. CDN
provisioning (versioned releases, SRI hashes, multi-region edge cache) is deferred to Phase 2.

**Required action:** (resolved by this PR — devops lane)

1. Build `@estalara/sdk` IIFE bundle and copy it to `apps/control-plane/public/sdk.js` (Vercel will
   serve it at `https://admin.estalara.com/sdk.js` with `content-type: application/javascript`).
2. Add `SDK_SERVE_URL = ${CONTROL_PLANE_URL}/sdk.js` to `packages/shared/src/domains.ts` so the URL
   is derived from `CONTROL_PLANE_URL` rather than another hardcoded literal.
3. Flip `buildSnippet()` (`DetectionPreview.tsx`) to emit `src="${SDK_SERVE_URL}"`.
4. Update the Pilot Runbook (`docs/ops/PILOT_RUNBOOK.md` §5 "Install the snippet") to use
   `https://admin.estalara.com/sdk.js` and to note that `cdn.estalara.com` is Phase 2.

**Resolution:** RESOLVED 2026-05-29 by this PR (`devops-engineer/ESC-015-sdk-static-serving`). The
pilot serves the SDK from `admin.estalara.com/sdk.js` via Vercel static asset hosting.
`SDK_CDN_DOMAIN` / `SDK_CDN_URL` constants remain in `packages/shared/src/domains.ts` for the Phase
2 cutover and are not consumed by `buildSnippet()` while the pilot is live.

**Phase 2 follow-up (not in scope for this PR):** Provision `cdn.estalara.com` end-to-end —
Cloudflare R2 bucket, signed release pipeline (`pnpm --filter @estalara/sdk release`), SRI hash
injection in `buildSnippet()`, multi-region edge cache, and a rollback playbook. When that lands,
flip the snippet generator back from `SDK_SERVE_URL` to `SDK_CDN_URL` and delete the `SDK_SERVE_URL`
constant. Track in a Phase 2 ticket (FOLLOW stub when sprint plan opens).

---

## RESOLVED — ESC-016: ingest Worker has no CORS headers; SDK calls from app.estalara.com are blocked [TICKET-PILOT-001]

**Filed by:** devops-engineer **Date:** 2026-05-29T00:00:00Z **Affects:** TICKET-PILOT-001 (Sprint
13a pilot launch), every browser-loaded SDK call to `ingest.estalara.com/v1/events` from
`app.estalara.com` (pilot) and `admin.estalara.com` (control-plane dashboards / wizard test pings)
**Type:** infrastructure / pilot-blocker

**Description:**

The pilot SDK is now live on `app.estalara.com` (ESC-015 served `sdk.js` from the control plane; the
script tag appears in DevTools and executes). But every event POST to
`https://ingest.estalara.com/v1/events` is blocked by the browser with:

> Access to fetch at 'https://ingest.estalara.com/v1/events' from origin 'https://app.estalara.com'
> has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the
> requested resource.

Root cause: `apps/ingest/src/router.ts` registers `secureHeaders` + `errorHandler` + `idempotency`
but **no CORS middleware** at all. The Hono app has no OPTIONS handler, so the preflight returns 404
with no `Access-Control-*` headers, and the actual POST response is missing
`Access-Control-Allow-Origin`. Net effect: zero events reach Redpanda from the browser-loaded pilot
SDK. Shadow-mode telemetry was silently empty.

This was never caught earlier because every prior ingest integration test exercises the handler from
the same origin (Node `app.fetch` with no `Origin` header — the browser CORS check never runs).

**Required action:** (resolved by this PR — devops lane)

1. Add `hono/cors` middleware to `apps/ingest/src/router.ts`, ordered immediately after
   `secureHeaders` so CORS headers land on every response (including the 401/429/5xx error paths the
   SDK needs to read).
2. Allow-list exactly the origins the SDK runs in: `https://app.estalara.com` (pilot site) and
   `https://admin.estalara.com` (control-plane Magic Link wizard / dashboards).
3. Allow methods `GET, POST, OPTIONS` and the four headers the SDK sets on every batch:
   `Content-Type`, `X-Estalara-API-Key`, `X-Estalara-Signature`, `Idempotency-Key`.
4. Expose `X-Request-ID` (debugging) and `Retry-After` (so the SDK's rate-limit backoff can read the
   header on 429 responses) via `Access-Control-Expose-Headers`.
5. Set `Access-Control-Max-Age: 86400` so browsers cache the preflight for 24h and the per-request
   CORS overhead drops to zero after the first page-view.
6. Cover preflight + actual-request + disallowed-origin paths with five unit tests in
   `apps/ingest/src/index.test.ts` so the regression we just hit cannot land silently again.

**Resolution:** RESOLVED 2026-05-29 by this PR (`devops-engineer/ESC-016-ingest-cors-fix`). After
merge + Wrangler deploy of the ingest Worker, verify with:

```
curl -i -X OPTIONS https://ingest.estalara.com/v1/events \
  -H "Origin: https://app.estalara.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,x-estalara-api-key,x-estalara-signature"
# Expect: 204, Access-Control-Allow-Origin: https://app.estalara.com,
# Access-Control-Allow-Methods includes POST, Access-Control-Allow-Headers
# includes content-type + x-estalara-api-key + x-estalara-signature + idempotency-key.
```

**Phase 2 follow-up (not in scope):** when customer-owned tenant domains come online, the hardcoded
`ALLOWED_ORIGINS` array becomes a tenant-aware lookup (origin → tenant_id → check
`tenants.allowed_origins`). For the pilot the two-host allow-list is correct and minimises attack
surface.

**Verification (2026-05-29):** `OPTIONS https://ingest.estalara.com/v1/events` returns `204` with
`Access-Control-Allow-Origin: https://app.estalara.com` present. `X-Session-ID` added to
`Access-Control-Allow-Headers` in follow-up PR #169
(`fix(ingest): add X-Session-ID to CORS allow-headers — ESC-016`). Live in production.

---

## RESOLVED — ESC-017: Redpanda Cloud Serverless has no Pandaproxy; ingest Worker cannot produce events [TICKET-PILOT-001]

**Filed by:** devops-engineer **Date:** 2026-05-29T00:00:00Z **Affects:** TICKET-PILOT-001 (Sprint
13a pilot launch), `apps/ingest` event pipeline, Master Design §A.1 Redpanda producer hop **Type:**
infrastructure / pilot-blocker

**Description:**

During TICKET-PILOT-001 E2E smoke testing, the ingest Worker attempted to POST events to Redpanda
Cloud Serverless via the Pandaproxy REST API (`REDPANDA_BROKER_URL`). The Pandaproxy endpoint was
unreachable — Redpanda Cloud **Serverless tier does not expose a Pandaproxy REST interface**.
Pandaproxy is only available on Dedicated and BYOC clusters. The original Master Design assumed
Pandaproxy as the ingest Worker → Redpanda hop, which was never viable on the Serverless cluster.

Net effect: zero events reached ClickHouse via the Redpanda path. Shadow-mode telemetry was silently
empty until diagnosed.

**Required action (resolved by PR #170):**

Implement a direct Worker → ClickHouse HTTPS write path in `apps/ingest/src/clickhouse-producer.ts`
using the ClickHouse HTTP interface (port 8443, `INSERT INTO default.events FORMAT JSONEachRow`).
Retain the Redpanda call as a dual-write no-op so the full chain activates without Worker changes
when a Pandaproxy-capable cluster is provisioned.

**Resolution:** RESOLVED 2026-05-29 by PR #170
(`feat(ingest): direct ClickHouse-write path for pilot [ESC-017]`). Direct Worker→ClickHouse HTTPS
write path implemented in `apps/ingest/src/clickhouse-producer.ts` (port 8443, INSERT FORMAT
JSONEachRow). E2E verified: event count 0→1 after POST to `/v1/events`,
`event_id = 01928f00-...-a3fc180390b5`, `tenant_id = cbc51cfa-1056-40aa-b0a9-6e982b52b1de`,
end-to-end latency 1.4s. Redpanda dual-write no-op retained for future Dedicated/BYOC upgrade path.

**Architectural implication (FOLLOW-157):** Redpanda Cloud Serverless = no Pandaproxy. The original
ingest→Pandaproxy→Redpanda→ClickHouse chain is not viable at the current tier. Canonical pilot path
= direct Worker→ClickHouse. Upgrade path vs. formalizing direct-ClickHouse as canonical to be
decided at Sprint 4 planning.

---

## RESOLVED — ESC-018: `description.requested` event omits `original_description`; real description+headline pipeline never generates [ADR-0009]

**Filed by:** Claude (session) **Date:** 2026-06-03T00:00:00Z **Affects:** description pipeline
(`apps/control-plane/src/app/api/adapt/description/route.ts` →
`apps/llm-gateway/src/jobs/generate_description.py`), ADR-0009 per-listing headline **Type:**
architectural / contract

**Description:** Pre-existing contract mismatch, surfaced while shipping the ADR-0009 per-listing
LLM headline. The control-plane route builds the `description.requested` event WITHOUT an
`original_description` field, and `DescriptionRequestedEventSchema`
(`packages/shared/src/schemas/description.ts`) does not declare one. But the Modal consumer treats
`original_description` as **required** — `consume_description_requests()` rejects any message
missing it (`missing_fields`), and `generate_description()` reads `event["original_description"]`
directly (KeyError otherwise). It is also the primary factual-grounding source for both the v1.8
description prompt and the new `_generate_headline()` call.

Net effect: in the real Redpanda→Modal path, every `description.requested` message is dropped at
consumer validation — so neither the AI description nor the new per-listing headline is ever
generated or cached. The local demo works only because it routes through the mock decision harness
(`scripts/dev/mock-decision-server.mjs`, port :9100), which generates inline and bypasses this event
contract entirely.

This is **not** introduced by the ADR-0009 headline change (the route diff only added `headline`
fields to responses); the headline simply inherits the same latent gap. The headline implementation
itself is correct and rides the description cache as designed.

**Required action:** Thread `original_description` from the route into the `description.requested`
event and add it to `DescriptionRequestedEventSchema` (source: the listing's current description —
likely via `retrieveListingContext` or a dedicated listing fetch). Then verify end-to-end that a
Tier 2/3 cache miss results in a cached `{text, headline, generated_at}` entry. Decide whether to
fix in a follow-up ticket or fold into the next description-pipeline change.

**Resolution:** RESOLVED 2026-06-03 on branch `ml-engineer/per-listing-llm-headline` (PR #182).
`original_description` is now threaded through the pipeline:

- `DescriptionRequestedEventSchema` (`packages/shared/src/schemas/description.ts`) declares
  `original_description: z.string()` (always present; may be empty).
- New helper `apps/control-plane/src/lib/listing-details.ts` →
  `fetchListingOriginalDescription(listingId, locale)` fetches the listing's original description
  from the Estalara backend listing-details API (`ESTALARA_BACKEND_URL`, UUID→`?listing-uuid=` else
  `/slug?slug=`, locale upper-cased) — mirroring the mock harness `fetchListing`. Fail-open to `''`
  with a 2s timeout; no `listings` table exists, so the tenant backend is the source.
- The description route (`/api/adapt/description`) fetches it in parallel with RAG context on cache
  miss and includes it in the published event. `ESTALARA_BACKEND_URL` added to `.env.example`.
- Tests: route asserts the event carries `original_description` (and is populated from the backend);
  6 unit tests for the helper (UUID vs slug, locale upper-casing, fail-open paths). Full
  control-plane typecheck/lint/prettier clean.

Note: SSRF check is intentionally NOT applied — the base host comes from our trusted
`ESTALARA_BACKEND_URL` and `listing_id` is URL-encoded into a query value (cannot alter the host);
`checkSsrf` would also reject the loopback backend used in local dev.

---

## RESOLVED — ESC-019: production Estalara backend listing-details API requires auth; server-side fetch fails open to empty `original_description` [TICKET-DESC-001]

**Filed by:** Claude (session) **Date:** 2026-06-03T00:00:00Z **Affects:** description + per-listing
headline pipeline (`apps/control-plane/src/lib/listing-details.ts`, `/api/adapt/description`),
ESC-018 fix end-to-end correctness **Type:** architectural / infra

**Description:** Surfaced while verifying the ESC-018 fix (RETRO-028 P1 PM action: "verify against a
real backend"). The fix grounds generation by fetching the listing's original description from the
Estalara backend listing-details API. This works against the **local dev backend**
(`localhost:8081`, what the mock harness `fetchListing` uses) but NOT against the **production**
backend.

Verified against production (read-only GET):

```
GET https://app.estalara.com/api/v1/listing/details/slug?slug=9-blackberry-pl-palm-coast-fl-32137&locale=EN
→ HTTP 302  location: /en?back=%2Fapi%2Fv1%2Flisting%2Fdetails%2Fslug%3F...
```

An **unauthenticated server-to-server** call is redirected to the SvelteKit login page. The helper's
`fetch` follows the redirect (undici default `redirect: 'follow'`), receives the SPA HTML with
`200`, `res.json()` throws, and the helper **fails open to `''`**. Net effect in production:
`original_description` is empty, so both the adapted description and the ADR-0009 per-listing
headline are generated **without factual grounding** (the v1.8 thin-original exception kicks in) —
the consumer no longer drops the message (the key is present), so the failure is **silent**: copy is
produced, just ungrounded. (`api.estalara.com` is not the host — returns 404.)

The local dev backend does not enforce the auth guard, so the mock-harness demo and the unit tests
(mocked backend) both pass — the gap is invisible until a real authenticated production fetch.

**Required action (human / devops + backend — needs a decision):**

1. Decide how the control-plane authenticates server-to-server to the Estalara backend listing API:
   an **internal/unguarded backend URL** (set `ESTALARA_BACKEND_URL` to it, not the public
   `app.estalara.com`), OR a **service token / session** the helper attaches (e.g. `Authorization`
   header or signed internal header), OR a dedicated internal listing-details endpoint.
2. Set the resolved `ESTALARA_BACKEND_URL` (and any token secret) in Vercel prod + Doppler.
3. Harden the helper to fail **loud not silent** on a non-JSON / redirected response: use
   `redirect: 'manual'` or assert the response `content-type` is JSON, and log a distinct warning
   (and/or emit a metric) so an ungrounded-generation regression is observable rather than silent.
4. Re-verify end-to-end: a Tier 2/3 cache miss against the real backend yields a cached
   `{text, headline, generated_at}` whose copy reflects the actual listing facts.

**Note:** The ESC-018 data-shape fix itself is correct and remains RESOLVED (the event now always
carries the `original_description` key). ESC-019 is the _reachability/auth_ half — the field is now
threaded, but the production source it reads is not yet reachable by an unauthenticated server call.

**Resolution:** RESOLVED 2026-06-04 by PR #196
(`fix(control-plane): correct ESTALARA_BACKEND_URL to api.estalara.com + redirect guard [ESCALATION]`).
Root cause: `ESTALARA_BACKEND_URL` was pointing at `app.estalara.com` (SvelteKit frontend with auth
guard). PR #196 corrected it to `https://api.estalara.com` (Spring Boot backend with `permitAll()` —
no auth required for listing-details). Added `redirect: 'manual'` guard in `listing-details.ts` so
redirect responses fail loud rather than silently failing open. FOLLOW-192 (Sprint 15) marked
CLOSED.

---

## RESOLVED — ESC-021: PR #281 (FOLLOW-287) merged with FAILING ClickHouse migrations smoke gate [FOLLOW-287/FOLLOW-288]

**Filed by:** pm-orchestrator **Date:** 2026-06-13T10:30:00Z **Affects:** FOLLOW-287 (PR #281),
FOLLOW-288 (remediation), ClickHouse migrations smoke CI gate on main **Type:** CI gate violation /
repo integrity

**Description:**

PR #281 (FOLLOW-287, branch `backend-engineer/FOLLOW-279-k36-ch-write-fix`) was merged to main at
2026-06-12T22:31:19Z while the **ClickHouse migrations smoke** CI gate was FAILING. This violates
the non-negotiable rule: PM must not mark a ticket READY_FOR_REVIEW while any real CI check is
failing, and PRs must not be merged without all real gates green.

Root cause confirmed from CI logs (run 27446753341):

```
ClickHouse migrations smoke  Apply migrations (LOCAL=1 → MergeTree)
curl: (22) The requested URL returned error: 500
Code: 524. DB::Exception: ALTER of key column intent_session_id from type UUID to type String
is not safe because it can change the representation of primary key.
(ALTER_OF_COLUMN_IS_FORBIDDEN) (version 26.5.1.882 (official build))
Process completed with exit code 22.
```

Migration 0016 (`infra/clickhouse/migrations/0016_intent_events_session_id_type_fix.sql`) contains:

```sql
ALTER TABLE intent_events
  MODIFY COLUMN intent_session_id String DEFAULT '';
```

ClickHouse 26.5.1 forbids `MODIFY COLUMN` on ORDER BY key columns. This was the exact fix that was
supposed to have been applied as a SELECT 1 no-op, but the actual file still contains the forbidden
ALTER TABLE statement.

**Impact on main branch:** The ClickHouse migrations smoke gate now FAILS on every PR that runs
against main. FOLLOW-267 (the next P1 ticket in the K.3.6 chain) cannot be merged cleanly while this
gate is red.

**Required action (human — approve remediation path):**

FOLLOW-288 (P0) has been added to the queue with status READY. It will:

1. Replace migration 0016 with a `SELECT 1` no-op (preserves journal sequence, fixes smoke gate).
2. Remove `intent_session_id` from the INSERT body in intent-snapshot.ts (session_id is the
   authoritative join key per migration 0015 — intent_session_id stays UUID with original default).
3. Update tests accordingly.

**Human decision needed:** Please confirm the remediation approach is acceptable before PM delegates
FOLLOW-288. Specifically: confirm that leaving `intent_session_id` as UUID NOT NULL with its
original default (writing nothing to it) is acceptable — existing rows will have the UUID default,
new rows will also have the UUID default. The `session_id` String column (migration 0015) is the
authoritative join key for FOLLOW-269, not intent_session_id.

**Resolution:** RESOLVED 2026-06-13 by backend-engineer (PR #282, merged 2026-06-12T23:27:03Z). No
CEO decision was required. ClickHouse error 524 (ALTER_OF_COLUMN_IS_FORBIDDEN on ORDER BY key
columns) is a hard constraint — there is no design choice to make. The remediation was technically
unambiguous: migration 0016 was replaced with a SELECT 1 no-op, and intent_session_id was removed
from the INSERT body (ClickHouse uses zero-UUID default; session_id String from migration 0015 is
the authoritative join key for FOLLOW-269). ClickHouse migrations smoke gate is now PASSING on PR
#282. All real CI gates confirmed green. ESC-021 filed in error as requiring human decision.

---

## OPEN — ESC-020: Estalara-app DOM hooks committed but not deployed to production [FOLLOW-191]

**Filed by:** sdk-engineer **Date:** 2026-06-06T13:30:00Z **Affects:** FOLLOW-191, FOLLOW-197,
Sprint 15 Track A **Type:** deployment

**Description:**

FOLLOW-191 audit (2026-06-06) confirmed the following gap: the `data-estalara-slot` hooks and the
SDK `<script>` loader are **committed** to the Estalara-app git repo (`web-master` HEAD at commit
`9d2df9d`) but the **production `app.estalara.com`** is running an older build that predates these
changes. Evidence:

```
curl -s https://app.estalara.com/en/listing/deerfield-lake-ct-cape-coral-fl-33909-90681784-8a9a-4953-ae48-fe8f8a3865e2 \
  | grep -c "data-estalara"
# Returns: 0
```

The production HTML has zero `data-estalara-*` attributes and no SDK `<script>` tag in `<head>`. The
adaptation layer fires `adapt.skipped` with `reason: 'no_slot_elements'` for every listing view. No
adapted experience has been measured in production.

Additionally, the local `web-master` working tree has `src/app.html` temporarily overridden to point
to `http://localhost:9100/estalara-sdk.iife.js` for local demo use. This override is uncommitted and
must NOT be deployed.

**Required action (Rafał Palak, CTO):**

Three steps to unblock pilot measurement:

1. In the `web-master` directory, restore `app.html` to the committed (production) version if it
   differs: `git checkout -- src/app.html`. The committed version correctly points to
   `https://admin.estalara.com/sdk.js`.

2. Set `PUBLIC_ESTALARA_SDK_ENABLED=true` in the production hosting environment for `web-master`
   (Docker env, hosting provider config, or equivalent). This flag gates all four A1 slot edits —
   without it the listing page renders with no slots (byte-identical to before the edits).

3. Deploy `web-master` HEAD to production. After deploy, verify with:

   ```bash
   curl -s https://app.estalara.com/en/listing/deerfield-lake-ct-cape-coral-fl-33909-\
   90681784-8a9a-4953-ae48-fe8f8a3865e2 | grep -c "data-estalara"
   # Expected: ≥3 (listing-id attr + headline slot + description slot)
   ```

4. Confirm `https://admin.estalara.com/sdk.js` returns HTTP 200 (the SDK IIFE bundle must be served
   there — see `apps/control-plane/public/sdk.js` in Adaptive-Listings).

5. Mark this escalation RESOLVED and update FOLLOW-191 → DONE in `backlog/QUEUE.md`.

Full deployment guide: `backlog/HANDOFFS.md` section "FOLLOW-191 → Rafał Palak (CTO)". Original slot
spec: `/home/asipi/Projects/Estalara-app/web-master/HANDOFF_ESTALARA_ADAPTIVE.md`.

**Blocking:** FOLLOW-197 (adapt.applied signal) depends on this being live.

**Resolution:** CEO clarification 2026-06-10: agreed workflow is **local-first testing** — all
verification must pass on localhost (Estalara-app running on developer machine) BEFORE Rafał deploys
to production. This escalation's "Required action (Rafał)" is DEFERRED until local testing is
complete and CEO signs off. **This escalation does NOT block the PM pipeline for other tickets.**
FOLLOW-191 tracks local validation; once CEO confirms local testing passes, Rafał will be instructed
on the production deployment steps listed above. ESC-020 remains OPEN until the production deploy is
confirmed.

---

## RESOLVED — ESC-022: Prod Supabase was 14 migrations behind (2026-05-28 → 2026-06-14) including compliance migrations — item (1) compliance integrity SIGNED OFF; item (2) standing mechanism DONE (FOLLOW-308 LIVE)

**Filed by:** pm-orchestrator **Date:** 2026-06-14T10:00:00Z **Affects:** prod Supabase (project
yhmivuqeqkmzpxpyrsvc, "Adaptive-Listings", eu-west-3), FOLLOW-307, FOLLOW-308, compliance posture
(conversion_labels, dsr_durable_lead_id) **Type:** compliance / operational

**Description:**

On 2026-06-14, the K.3.6 D-1 seed (migration 0030) was applied to prod Supabase via
`doppler run --config prd -- pnpm db:migrate`. During apply it was discovered that prod was **14
migrations behind** — `drizzle.__drizzle_migrations` had only 17 entries, last applied approximately
2026-05-28 (migration ~0016), while the repo was at migration 0030. Migrations **0017 through 0030
had NEVER been applied to prod**.

The affected migrations include:

- **0019, 0020** — `conversion_labels` table (CRM tracking, GDPR-related label data)
- **0024** — `dsr_durable_lead_id` column (DSR / GDPR Art. 17 erasure tracking)
- **0021** — `engagement_scores` table
- **0022** — `quiz_completions` table
- **0025** — `tenants_quiz_enabled` column
- **0026, 0027** — quiz_config strip migrations
- **0028** — `intent_sessions` table (K.3.6)
- **0029** — `intent_weight_configs` table (K.3.6)
- **0030** — global-default seed row (K.3.6)

This means that for approximately **2.5 weeks** (2026-05-28 → 2026-06-14), features that depended on
these schemas were silently non-functional in prod:

- Conversion label writes would have failed (table did not exist)
- DSR `dsr_durable_lead_id` column would have been absent from `leads` (DSR erasure tracking broken)
- Quiz completion writes would have failed (table did not exist)
- All K.3.6 intent tracer features were inert in prod (schemas absent)

All 14 migrations applied cleanly on 2026-06-14. Prod `drizzle.__drizzle_migrations` is now at 31
(full repo count). Root cause: no auto-apply mechanism (RETRO-076 OG-1) — Postgres migrations are
operator-driven only, unlike ClickHouse which auto-applies in CI. Note: prod project was AUTO-PAUSED
(Supabase idle pause) and had to be resumed before apply — confirming prod is not yet serving steady
traffic (pre-pilot phase).

**FOLLOW-307** (apply objective) is DONE. **FOLLOW-308** (standing mechanism) tracks the prevention
fix.

**Required human action (Piotr / Rafał — compliance + operations):**

1. ~~**Compliance data-integrity check**~~ — **SIGNED OFF 2026-06-14 (see item-1 resolution
   below).**

2. **Standing mechanism decision (STILL OPEN):** Approve one of the two options in FOLLOW-308:
   - Option A: Add an auto-apply `db:migrate` step to the deploy workflow (mirrors ClickHouse).
   - Option B: Add an explicit operator checklist gate with a CI divergence check. This decision
     blocks FOLLOW-308 (P1) from proceeding to implementation.

**This escalation does NOT block the PM pipeline** for other tickets (FOLLOW-293, FOLLOW-269, etc.)
but DOES block FOLLOW-308 AC3 closure until item (2) is decided.

---

### Item (1) — RESOLVED 2026-06-14 — Compliance data-integrity sign-off

**Question closed:** Did the 14-migration prod drift (prod stuck at 2026-05-28, migrations 0017→0030
absent) cause any data-integrity issue from the compliance migrations being absent in prod —
specifically 0019/0020 conversion_labels and 0024 dsr_durable_lead_id?

**Verdict: NO data-integrity issue. The gap was benign. No remediation needed.**

**Evidence (verified against prod project yhmivuqeqkmzpxpyrsvc on 2026-06-14):**

1. The three compliance migrations are PURELY ADDITIVE — no transform/backfill/drop:
   - 0019 `CREATE TABLE IF NOT EXISTS conversion_labels` (new table)
   - 0020 `ADD CONSTRAINT … UNIQUE (tenant_id, prediction_id)` on a table the migration itself notes
     "has never been seeded in any environment"
   - 0024 `ADD COLUMN IF NOT EXISTS durable_lead_id text` (nullable, no backfill) So applying them
     late cannot corrupt pre-existing data.

2. All 14 migrations applied CLEANLY — runner reported "Migrations applied: 14 … 31 now applied, 0
   still pending", exit 0; prod `__drizzle_migrations` went 17→31. The UNIQUE constraint (0020)
   applying cleanly is positive proof no conflicting rows existed.

3. Prod data state verified EMPTY / pre-pilot: tenants=1, conversion_labels=0, dsr_verifications=0
   (with durable_lead_id non-null=0), intent_sessions=0, quiz_completions=0, engagement_scores=0.

4. The two specific compliance risks could not have materialized:
   - DSR under-deletion (the FOLLOW-184 / 0024 concern): requires DSR requests AND CRM-sourced
     conversion labels — prod has 0 of each. Nothing to erase; nothing erased incompletely.
   - Conversion-label corpus duplication/loss (0019/0020 concern): conversion_labels=0 — no labels
     written, none duplicated or lost.
   - The prod DB had auto-paused from inactivity, consistent with no feedback/CRM/DSR traffic during
     the window.

**Signed off by:** Piotr (CEO) via Claude Code orchestrator, 2026-06-14, on the above evidence.

---

### Item (2) — RESOLVED 2026-06-15 — Standing mechanism live

FOLLOW-308 (P1, devops): Option A implemented and now ACTIVE. `.github/workflows/db-migrate.yml`
auto-applies `pnpm db:migrate` staging → prod on every push to `main` touching
`packages/db/migrations/**` or `packages/db/scripts/migrate.ts`. Activation required three fixes
beyond the initial PR #297: (a) ESC-023 Doppler tokens provisioned, (b) build-order fix PR #306
(`Build @estalara/shared` before `db`), (c) `DATABASE_URL_ADMIN` added to Doppler stg/prd. Verified
live end-to-end: `workflow_dispatch` run 27513894932 — Migrate (staging) + Migrate (prod) both
green, real `Run Drizzle migrations` executed (not soft-skip). With item (1) already signed off,
ESC-022 is now fully RESOLVED.

**Resolution:** PARTIALLY-RESOLVED. Item (1) closed 2026-06-14 by Piotr (CEO) sign-off — compliance
integrity confirmed benign (pre-pilot, zero traffic, purely-additive migrations applied cleanly).
Item (2) — standing mechanism — remains OPEN pending Piotr's Option A/B decision to unblock
FOLLOW-308 implementation.

---

## RESOLVED — ESC-023: DOPPLER_TOKEN_STG and DOPPLER_TOKEN_PRD GitHub Actions secrets must be provisioned for db-migrate.yml to activate [FOLLOW-308]

**Filed by:** devops-engineer **Date:** 2026-06-14T00:00:00Z **Affects:** FOLLOW-308,
`.github/workflows/db-migrate.yml`, prod + staging Supabase migration auto-apply **Type:**
repo-config / secrets

**Description:**

FOLLOW-308 (Option A — CEO decision) implements a new GitHub Actions workflow
`.github/workflows/db-migrate.yml` that auto-applies `pnpm db:migrate` to staging then prod on every
push to `main` that touches `packages/db/migrations/**` or `packages/db/scripts/migrate.ts`.

The workflow requires two Doppler service tokens as GitHub Actions repository secrets:

- `DOPPLER_TOKEN_STG` — Doppler service token scoped to project `estalara-adaptive-listings`, config
  `stg`. Used to inject `DATABASE_URL_ADMIN` (or `DATABASE_URL_DIRECT`) for the staging Supabase
  project during the `migrate-staging` job.
- `DOPPLER_TOKEN_PRD` — Doppler service token scoped to project `estalara-adaptive-listings`, config
  `prd`. Used to inject the prod Supabase credentials during the `migrate-prod` job.

**`gh secret list` result (2026-06-14):** Only `DOPPLER_TOKEN_DEV` exists in this repo. Neither
`DOPPLER_TOKEN_STG` nor `DOPPLER_TOKEN_PRD` exists.

**Current impact:** The `db-migrate.yml` workflow is in the repo and will be triggered by migration
pushes, but both jobs will soft-skip (emit a `::notice::` and exit 0). The workflow is visually
present in GitHub Actions but INERT. No auto-apply will occur until the secrets are provisioned.

**Required action (Piotr — ~10 minutes per token, ~20 minutes total):**

For each environment (stg, prd):

1. Go to [Doppler dashboard](https://dashboard.doppler.com) → project `estalara-adaptive-listings` →
   config `stg` (or `prd`) → Access → Service Tokens → Create service token.
   - Name: `ci-github-actions-migrate`
   - Config: `stg` (for staging token) / `prd` (for prod token)
   - Expiry: none or 1 year — rotate on breach per V.6.1 policy.
   - The token needs READ access to the config so `doppler run` can inject
     `DATABASE_URL_ADMIN`/`DATABASE_URL_DIRECT`/`DATABASE_URL`.
2. Copy the token value (shown only once).
3. Go to GitHub repo → Settings → Secrets and variables → Actions → New repository secret.
   - Staging: Name `DOPPLER_TOKEN_STG`, value = staging token.
   - Prod: Name `DOPPLER_TOKEN_PRD`, value = prod token.
4. After adding, push an empty commit to `main` or use `workflow_dispatch` on `db-migrate.yml` to
   trigger a run. Confirm both jobs execute `pnpm db:migrate` (not soft-skip) and exit 0 ("Already
   up-to-date" or "Migrations applied successfully.").
5. Mark ESC-023 RESOLVED.

**Security note:** The `prd` token must be scoped read-only to the Doppler `prd` config. It does NOT
need write access to Doppler — only `doppler run` injection (reading secrets). The token should NOT
have access to any other Doppler project.

**This does NOT block FOLLOW-308 AC1/AC2** (the workflow is implemented and cross-referenced in
docs). It blocks AC3 (ESC-022 compliance sign-off) and the "live not inert" state of the mechanism.

**Resolution:** RESOLVED 2026-06-15 (Piotr). Three conditions had to be met for the workflow to run
for real, not just exist:

1. **GitHub Actions secrets provisioned** (2026-06-14): `DOPPLER_TOKEN_STG` and `DOPPLER_TOKEN_PRD`
   service tokens (Doppler project `estalara-adaptive-listings`, configs `stg`/`prd`) added as repo
   secrets. Confirmed via `gh secret list`.
2. **Build-ordering bug fixed** (PR #306, merged 2026-06-15): `db-migrate.yml` built `@estalara/db`
   without first building its `workspace:*` dependency `@estalara/shared`, so `tsc` failed on a
   clean runner (`TS2307: Cannot find module '@estalara/shared'`). Added
   `pnpm --filter @estalara/shared build` before the db build in all three affected jobs
   (migrate-staging, migrate-prod, and `post-migrate-seed.yml` seed-archetypes, which had the same
   latent bug).
3. **Doppler config content** (2026-06-15): the `stg`/`prd` configs were missing
   `DATABASE_URL_ADMIN` (the admin/RLS-bypass connection the migrate script requires per
   `packages/db/src/client.ts:189`). Added to both configs as the Supabase **Session pooler** URI
   (port 5432, IPv4-reachable from GitHub-hosted runners — Direct connection is IPv6-only and would
   fail; Transaction pooler 6543 is not session-mode).

**Verification:** `workflow_dispatch` run 27513894932 — both `Migrate (staging)` and
`Migrate (prod)` green, with the real `Run Drizzle migrations` step executing (NOT the soft-skip
path). The workflow is now LIVE, not inert: any push to `main` touching `packages/db/migrations/**`
or `packages/db/scripts/migrate.ts` auto-applies staging → prod.

**Note:** This was the activation half of FOLLOW-308 AC3. The other half — the **ESC-022 human
compliance sign-off** on migrations 0019/0020/0024 against pre-schema prod — was already SIGNED OFF
2026-06-14 (ESC-022 item 1, Piotr/CEO). With activation now verified live, ESC-022 item (2)
(standing mechanism) is also closed → ESC-022 fully RESOLVED and **FOLLOW-308 closed in full**
2026-06-15.

---

## RESOLVED — ESC-024: GitHub Actions secrets required for FOLLOW-293 K.3.6 D-1 live-network smoke [FOLLOW-293]

**Resolved:** 2026-06-15 by Piotr (CEO). ESTALARA_SMOKE_API_KEY (smoke key est_pub_0000000000000001,
api_keys row inserted manually via Supabase SQL) + ESTALARA_SMOKE_DECISION_API_URL
(https://admin.estalara.com/api) added to GitHub Actions secrets. DATABASE_URL_ADMIN added to Vercel
prod env (was in Doppler prd but missing from Vercel); control-plane redeployed. Smoke run
27555287447: AC-LN1/LN2/LN3 all GREEN. FOLLOW-293 DONE IN FULL.

**Filed:** 2026-06-15 by qa-engineer **Blocks:** FOLLOW-293 hard-assert mode (smoke currently
soft-skips in all CI runs) **Priority:** P2

**Context:**

FOLLOW-293 adds a live-network smoke (`tests/integration/intent-weights-live.smoke.test.ts`) that
calls the real SDK `fetchIntentWeights()` against the real `GET /api/intent/config` endpoint and
asserts `data_source: 'live'` (proving migration 0030 / FOLLOW-307 AC1 is effective in production).
The CI job (`intent-weights-live-smoke.yml`) runs on every push but soft-skips when the required
secrets are absent. Currently **no run will exercise the live assertion** because neither secret is
provisioned.

**Secrets needed:**

1. `ESTALARA_SMOKE_API_KEY` — a real tenant Bearer token for a real row in `api_keys` in the
   production Supabase (project `yhmivuqeqkmzpxpyrsvc`, eu-west-3). The token must be for a tenant
   that has NO tenant-specific `intent_weight_configs` row so it falls through to the global seed
   row and returns `data_source: 'live'`. Any real onboarded-tenant key works, or a dedicated
   smoke-tenant key seeded via `pnpm seed:local-tenant` run against prod.

2. `ESTALARA_SMOKE_DECISION_API_URL` — the production `decisionApiUrl` value, which is
   `https://admin.estalara.com/api` (host + `/api`, as emitted by `buildSnippet()` in
   `DetectionPreview.tsx:153`). This is NOT a secret (it is already public in the snippet), but it
   is included as a secret so the CI job can be pointed at staging vs production without a code
   change. Staging value: `https://admin-stg.estalara.com/api` (if a staging deployment exists).

**Steps to provision:**

1. Create (or reuse) a tenant API key in production Supabase:
   - Find an existing active key:
     `SELECT raw_key, tenant_id FROM api_keys WHERE revoked_at IS NULL LIMIT 1;` (requires
     `pnpm db:studio` or Supabase SQL editor with service-role access).
   - Alternatively run `pnpm seed:local-tenant` against prod to create a dedicated smoke tenant.
2. Add both secrets to the GitHub repo:
   - GitHub repo → Settings → Secrets and variables → Actions → New repository secret
   - `ESTALARA_SMOKE_API_KEY`: the raw API key value
   - `ESTALARA_SMOKE_DECISION_API_URL`: `https://admin.estalara.com/api`
3. Push a commit to main or use `workflow_dispatch` on `intent-weights-live-smoke.yml`.
4. Confirm the job enters the HARD-FAIL mode (not soft-skip): look for `secrets_present=true` in the
   "Check secret availability" step.
5. Confirm the smoke assertions pass: AC-LN1, AC-LN2, AC-LN3 all green.
6. Mark ESC-024 RESOLVED.

**What happens until ESC-024 is resolved:**

Every CI run emits:
`::notice::ESTALARA_SMOKE_API_KEY is not set — K.3.6 D-1 live-network smoke will soft-skip.`

The smoke test suite itself reports all 3 tests as skipped. This is NOT a CI failure — it is a
documented, intentional soft-skip. The live assertion gap (FOLLOW-293's core purpose) is documented
here so it cannot be forgotten.

**Security note:** `ESTALARA_SMOKE_API_KEY` must be a read-only SDK API key (same `scopes` as the
`data-api-key` attribute in the install snippet — `write:events` if the ingest is wired, or a custom
read scope). It must NOT be an admin key or service-role key.

---

## RESOLVED — ESC-025: FOLLOW-346 chat NLP shadow bridge is dead-on-arrival in prod (cross-language payload-key mismatch); ticket was marked DONE against an unmet AC-1 [FOLLOW-346 / FOLLOW-366]

**RESOLVED 2026-06-20:** FOLLOW-366 (PR #332, commit `eaf31a9`) merged to main — `_spawn_chat_nlp`
now reads `payload["message"]` and the test fixture is built from the real
`ChatMessageSentPayloadSchema` (Rule Z). PM-validated (0 new CI failures, wiring confirmed
hop-by-hop, fail-before/pass-after). The shadow bridge now fires for real `chat.message.sent`
traffic; FOLLOW-346 AC-1 is met end-to-end.

**Filed by:** retrospective-analyst (RETRO-098, via Opus 4.8 session) **Date:** 2026-06-20
**Affects:** FOLLOW-346 (merged PR #330), FOLLOW-366 (hotfix) **Type:** priority

**Description:** The just-merged chat NLP shadow bridge does not function against real traffic. The
SDK producer emits `chat.message.sent` with payload `{ message, char_count, lead_id }` (canonical
`ChatMessageSentPayloadSchema`, `packages/shared/src/schemas/events/chat.ts:38-48`), but the new
Python consumer `_spawn_chat_nlp` (`apps/stream-consumer/src/consumers/events.py:67-74`) reads
`payload.get("content")` / `payload.get("role")` and guards `if not message["content"]: return`. For
100% of real events `content == ""` → the guard trips → the Modal `process_chat_message` spawn never
fires → no Redis shadow key is ever written → the TS reader at `route.ts:1073` always misses. Both
sides shipped green because every test on the path constructs a hand-invented `{role, content}`
fixture instead of the real producer shape (Rule Z violation). FOLLOW-346's AC-1 ("consumed
`chat.message.sent` invokes the NLP extractor; Redis shadow key written + read by `/api/adapt`") is
therefore NOT met end-to-end — the ticket should not have closed against it. The prior PM validation
("verified end-to-end") checked the Redis key byte-identity but not the payload field one hop
upstream. DPIA posture is unaffected (no raw text persisted; the brief's privacy conclusions hold —
only its "shadow data is being collected" premise is currently false).

**Required action:** (1) Authorize FOLLOW-366 as a P0 hotfix (repoint the consumer to
`payload["message"]`, ship with a producer-shape-grounded fixture). (2) Decide whether FOLLOW-346
should be re-opened / re-labeled (AC-1 unmet) or left DONE with FOLLOW-366 carrying the fix. (3)
Note that the post-pilot chat-vs-archetype disagreement-rate analysis (the entire purpose of shadow
mode) will have an empty dataset until FOLLOW-366 lands.

**Owner:** CEO (priority call) → data-engineer (FOLLOW-366 implementation)

---

## RESOLVED — ESC-026: FOLLOW-342 GET-path bandit serves + logs treatment variants to HOLDOUT sessions, contaminating the experiment baseline in prod [FOLLOW-342 / FOLLOW-360]

**RESOLVED 2026-06-20:** FOLLOW-360 (PR #333, commit `2836adc`) merged to main — GET-path variant
selection is now gated behind the holdout check (`holdoutGroup ? 'control' : thompsonSample(...)`),
so holdout GET sessions serve + log `variant='control'`. PM-validated (0 new CI failures, both
serve + ClickHouse-log paths receive the gated value, fail-before/pass-after). **Data caveat:**
exclude `adaptation_decisions` rows where `holdout_group=1 AND variant != 'control'` from historical
lift queries for the window PR #327 merge (`66054d6`, 2026-06-19) → PR #333 merge (`2836adc`,
2026-06-20).

**Filed by:** retrospective-analyst (RETRO-095, via Opus 4.8 session) **Date:** 2026-06-20
**Affects:** FOLLOW-342 (merged PR #327), FOLLOW-360 (hotfix), pilot-calibration + ab/weights
analytics **Type:** priority

**Description:** The POST `/api/adapt` handler returns early for holdout BEFORE variant selection
(`route.ts:894-919`, selection at `:993`), so holdout sessions correctly get `directives:[]` and no
variant. The GET handler samples + serves + logs a bandit variant at `route.ts:698-742` with NO
holdout short-circuit, yet still logs `holdoutGroup`. A GET request carrying `holdout_group=true` is
now served `v1`/`v2` copy AND logged to ClickHouse as `(holdout_group=1, variant=v1)` — the holdout
counterfactual baseline (which must stay control-only) is being polluted on every GET-path holdout
request. Before PR #327, GET hardcoded `'control'` in its log, so holdout rows were always clean;
this PR regressed it. Any downstream measurement keyed on `adaptation_decisions` (FOLLOW-170
conversion label loop, pilot calibration) now reads a contaminated baseline. Separately (P1,
FOLLOW-359): the GET response omits `variant`, so GET-path conversions are unattributable and the
bandit posterior never learns from GET traffic.

**Required action:** (1) Authorize FOLLOW-360 as a P0 hotfix (gate GET variant selection behind the
holdout/consent check, mirror POST's early-return ordering; holdout GET requests must serve + log
`variant=control`). (2) Flag that any analytics computed over `adaptation_decisions` between
2026-06-19 (PR #327 merge) and the FOLLOW-360 fix should treat holdout-row variants as suspect.

**Owner:** CEO (priority call) → backend-engineer (FOLLOW-360 implementation)

---

## RESOLVED — ESC-027: FOLLOW-345 page-type-derived `tier` re-introduces Tier vocabulary that MASTER_DESIGN §E.7 eliminated — CEO ruling needed before FOLLOW-357 can be implemented [FOLLOW-345 / FOLLOW-357]

**Filed by:** pm-orchestrator **Date:** 2026-06-20 **Affects:** FOLLOW-357 (P1 rename/carve-out),
MASTER_DESIGN §E.7, `apps/control-plane/src/app/api/adapt/route.ts` `tierFromPageType()` **Type:**
architectural

**Description:** MASTER_DESIGN §E.7 (CEO ruling 2026-06-05) eliminated Tiers: "wszyscy tenanci
dostają jedno doświadczenie … Parametr `tier` usunięty z API". FOLLOW-345 (PR #323, merged
2026-06-20) introduces `tierFromPageType()` (`route.ts:763`) which derives a value explicitly called
the "integration tier" (`{1, 2}` from `page_type`) and persists it to `adaptation_decisions.tier`.
The docstring calls tier 2 "Augment" — the old tier-2 integration tier name. This contradicts §E.7.

Two resolutions are possible: (a) **Rename path**: rename the derived value off the "tier"
vocabulary (e.g. `directive_scope: 'detail' | 'list'` or `page_context`), update the ClickHouse
column semantics, fix the docstring and §E.7 / §E.1 in MASTER_DESIGN so SoT and code agree. (b)
**Carve-out path**: CEO grants an explicit §E.7 carve-out that the `/api/adapt` response `tier`
field is a page-context axis (detail vs list) independent of the legacy integration-tier concept,
and §E.7 is patched to document the exception. The "Augment" framing in the docstring is removed.

**Required action:** CEO chooses (a) or (b) and records the decision here. FOLLOW-357
(backend-engineer, P1, 2h) is BLOCKED until this ruling is received.

**Owner:** CEO architectural ruling → FOLLOW-357 (backend-engineer)

**Resolution:** RESOLVED 2026-06-20: CEO ruled option (a) — rename to `directive_scope`. Implemented
in FOLLOW-357 (PR opened 2026-06-20): `tierFromPageType` renamed to `directiveScopeFromPageType`,
local variable `derivedTier` renamed to `directiveScope`, POST response field `tier` renamed to
`directive_scope` in all three response arms, docstring rewritten, `AdaptationDirectives` shared
type updated, SDK `AdaptResponse` updated, Zod schema updated. ClickHouse column rename
(`adaptation_decisions.tier` → `directive_scope`) is deferred to FOLLOW-358 (GET/POST column
divergence unification).

---

## RESOLVED — SDK IIFE bundle over 40 KB gzip budget (pre-existing violation from FOLLOW-373 consent strings) [FOLLOW-372]

**Filed by:** sdk-engineer **Date:** 2026-06-21 **Affects:** FOLLOW-372, FOLLOW-373,
`packages/sdk/scripts/check-bundle-size.js` CI gate **Type:** architectural

**Description:** The `packages/sdk` IIFE bundle budget is 40 KB gzip (hard, CI-enforced).

Baseline measurements (2026-06-21):

| State                                              | gzip bytes | KB                 |
| -------------------------------------------------- | ---------- | ------------------ |
| Pre-FOLLOW-373 (commit `aa2f007`)                  | 40,819     | 39.86 KB — PASSING |
| Post-FOLLOW-373 (current `main`, commit `0cfd08c`) | 41,503     | 40.53 KB — FAILING |
| FOLLOW-372 PR (this PR)                            | 42,143     | 41.17 KB — FAILING |

The FOLLOW-373 compliance-engineer additions to `consent-banner.ts` (`disclosurePlatform` strings in
EN/PL/ES — ~3×~230 chars) pushed the bundle from 39.86 KB to 40.53 KB, crossing the 40 KB limit by
543 bytes. This pre-existing violation means the `build:check` CI gate was already failing on `main`
before FOLLOW-372 was started.

FOLLOW-372 (this PR) adds a minimal-footprint opt-out toggle and opt-out state module contributing
+640 bytes gzip above the already-over baseline, for a total of +1,183 bytes over the 40 KB limit.

**Required action (choose one):** (A) **Raise the budget to 42 KB** — acknowledges that the
FOLLOW-373 disclosures are legally required content that cannot be stripped, and the FOLLOW-372
opt-out toggle is a mandatory legal/UX feature. Update `scripts/check-bundle-size.js` MAX_BYTES to
43 \* 1024. The budget was set conservatively; given accumulated feature growth, 42 KB remains well
below the 80 KB Tier 1+2+3 budget and the 40 KB was an internal Tier 1+2 target.

(B) **Lazy-load the consent-banner disclosures** — move `disclosurePlatform` strings out of the main
IIFE into a fetched i18n JSON file. SDK fetches them at consent-banner render time. This is
architecturally cleaner but requires a backend endpoint and adds a network round-trip before the
consent banner renders.

(C) **Accept the CI failure on bundle check** temporarily and create a FOLLOW ticket to do option
(B) post-pilot.

sdk-engineer recommends **(A)** — the disclosure strings are legally mandated content (DPIA §13.4),
not feature bloat. The 42 KB revised budget still gives substantial headroom under the 80 KB Native
tier budget.

**Resolution:** RESOLVED 2026-06-21: CEO approved option (A) — raise budget 40KB→42KB. Implemented
on `compliance-engineer/FOLLOW-373-consent-umbrella` (commit `b8f9e2b`): `MAX_BYTES = 42 * 1024` in
`packages/sdk/scripts/check-bundle-size.js`. The disclosure strings are legally mandated (DPIA
§13.4), not feature bloat; 42KB stays well under the 80KB ceiling. Headroom is now slim (~0.8KB over
current 41.17KB) — durable trim via lazy-loaded i18n (option B) deferred to a post-pilot FOLLOW.

---

## RESOLVED — ESC-028: GitHub Actions secrets required for FOLLOW-368 Redis shadow round-trip smoke [FOLLOW-368]

**RESOLVED 2026-07-13.** All four GH Actions secrets provisioned against the existing project
Upstash DB `sacred-crawdad-106876` (`Adaptive-Listings`, eu-central-1) — reused rather than a
throwaway because the smoke writes one uniquely-namespaced self-expiring key (no FLUSH), so reuse is
collision-safe and matches the "one shared parity instance" intent. `redis-shadow-smoke.yml` ran in
hard-fail mode (`REQUIRE_REDIS_SMOKE=1`) and **passed** — run 29257991341. Gotcha caught during
provisioning: the token must be the Upstash **REST** token, not the TCP `redis://` password (first
attempt failed hard with `WRONGPASS` / TTL HTTP 401 — the hard-fail did its job). **Non-blocking
remainder:** Doppler dev/stg/prd wiring (step 3 below) for local-dev parity — not needed for the CI
gate or prod (Modal uses its own `estalara-secrets` bundle). Full attestation in
`docs/runbooks/OPERATOR_SESSION_2026-07-12.md` Step 5.

---

### Original escalation (for reference)

**Filed by:** devops-engineer **Date:** 2026-06-23 **Affects:** FOLLOW-368 (P1), FOLLOW-346 AC-1
(chat-intent bridge end-to-end), FOLLOW-384 (redis_writer opt-out skip), K.3.6 D-2 chat panel
**Type:** infra / repo-config

**Description (Rule C):** The `redis-shadow-smoke.yml` CI workflow added by FOLLOW-368 requires four
GitHub Actions secrets that do not yet exist:

| Secret name                | Used by               | What it must point at                       |
| -------------------------- | --------------------- | ------------------------------------------- |
| `UPSTASH_REDIS_REST_URL`   | Python writer (Modal) | A test Upstash Redis instance REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Python writer (Modal) | Token for the same test instance            |
| `UPSTASH_REDIS_URL`        | TS reader (Vercel)    | SAME test instance REST endpoint            |
| `UPSTASH_REDIS_TOKEN`      | TS reader (Vercel)    | Token for the same test instance            |

**Critically:** `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_URL` MUST be the SAME Upstash database
URL (and their tokens the same token). If they differ, the round-trip smoke test will correctly fail
— which is the entire point of FOLLOW-368 (it catches the HW-3 misconfiguration from RETRO-098).

**Recommendation:** Provision a dedicated test Upstash Redis instance (free tier is sufficient) and
set all four secrets to credentials for that one instance. This can be done in the Upstash dashboard
(create a new database) and then GitHub repo Settings → Secrets → Actions → New repository secret.
The test cleans up its own keys (TTL = 86400 s, so the smoke key self-deletes within 24 h).

**What happens until ESC-028 is resolved:** Every run of `redis-shadow-smoke.yml` enters the
soft-skip path (`secrets_present=false` → `REQUIRE_REDIS_SMOKE` unset → the spec emits a
`::notice::` and skips all assertions). The workflow does NOT fail. The CI badge is green with
"notice" annotations. This is the intended behavior — the smoke is a canary, not a blocking gate,
until the secrets are provisioned.

**After provisioning:** Once all four secrets are set in GitHub, the workflow will automatically
switch to hard-fail mode (`REQUIRE_REDIS_SMOKE=1`). No code changes are needed — the workflow reads
the secrets and sets the flag accordingly.

**Required action:** Piotr or Rafał to:

1. Create a test Upstash Redis instance (free tier sufficient) in the Upstash dashboard.
2. Add four GitHub Actions secrets — all pointing at the same instance URL and token:
   - `UPSTASH_REDIS_REST_URL` = the REST endpoint URL
   - `UPSTASH_REDIS_REST_TOKEN` = the REST token
   - `UPSTASH_REDIS_URL` = the same REST endpoint URL
   - `UPSTASH_REDIS_TOKEN` = the same REST token
3. Add the same four values to Doppler (dev + staging + prod configs) so local development and Modal
   deployments also use the parity-verified instance.
4. Mark ESC-028 RESOLVED.

**Owner:** CEO / CTO — requires Upstash dashboard access + GitHub repo admin access

---

## RESOLVED — ESC-029: Public ingest schema change — profiling_opt_out field on ChatMessageSentPayloadSchema [FOLLOW-387]

**Filed by:** backend-engineer **Date:** 2026-06-24 **Affects:** FOLLOW-387, §H.9 opt-out epic
**Type:** architectural

**Description (CLAUDE.md autonomy rules):** FOLLOW-387 requires adding an optional
`profiling_opt_out` boolean field to `ChatMessageSentPayloadSchema` in
`packages/shared/src/schemas/events/chat.ts`. This is a public ingest-event contract change (the
`packages/shared` event schema is the wire contract between the SDK, CF Worker ingest, and the
Python stream-consumer). Per CLAUDE.md: "change a public API surface (`@estalara/sdk` exports,
ingest event schema, decision API contract)" requires human escalation.

**Change being made:** Add `profiling_opt_out: z.boolean().optional()` to
`ChatMessageSentPayloadSchema`. The field is OPTIONAL with no default, so:

- All existing SDK producers that do not set the field remain valid (back-compat,
  backward-compatible, non-breaking additive change).
- The Python stream-consumer reads it with `payload.get("profiling_opt_out", False)` — if absent,
  defaults to False (the safe behavior: shadow prior is written, no leakage of the new flag into old
  sessions).

**§H.9 / RETRO-108 rationale:** Without this field, `_spawn_chat_nlp` cannot forward the per-session
opt-out state to `process_chat_message`, so an opted-out user's live chat messages still write the
AL shadow prior. This is the RETRO-108 HW-1 / LG-1 finding: FOLLOW-384 added the consumer guard but
the flag cannot reach it because the event schema carries no opt-out field.

**Required action:** CEO approval before merging the PR.

**Resolution:** CEO (Piotr Nawrocki) APPROVED 2026-06-24. The additive optional field is confirmed
non-breaking. Proceeding with FOLLOW-387 PR (`backend-engineer/FOLLOW-387-live-chat-optout-thread`).

---

## RESOLVED — ESC-030: CEO decision required before FOLLOW-341 (archetype embeddings) can be delegated [FOLLOW-341]

**Filed by:** pm-orchestrator **Date:** 2026-06-25 **Affects:** FOLLOW-341, FOLLOW-342 (blocked on
FOLLOW-341), §F cosine/MOAT claim **Type:** architectural / scope

**Description:**

FOLLOW-341 (P1, ml-engineer, 6h) would populate `archetype_embeddings.embedding` via
`text-embedding-3-small` to activate the cosine affinity path in `getArchetypeEmbedding()` /
`affinityScore()`. Currently, 18 seed rows in `archetype_embeddings` have `embedding NULL`, and
`affinityScore()` falls back to a djb2 hash for 100% of requests. The entire §F vector-matching /
MOAT layer is non-functional in prod.

FOLLOW-341's stub (FOLLOW_UPS.md) explicitly flags: "Decision point for CEO (F-02 open question #4):
build the real embedding job now, OR formally drop the cosine/MOAT claim and ship with hash ordering
acknowledged."

Two options:

**Option A — Build the job:** Delegate FOLLOW-341 to ml-engineer: build an idempotent
embed-and-UPSERT job (Modal or GHA workflow_dispatch), add a `archetype-embeddings-not-null` CI
precheck. Estimated 6h. Unblocks FOLLOW-342 (bandit variant → playbook selection).

**Option B — Drop the claim:** Remove the cosine branch from `affinityScore()` + `reorder.ts`,
remove the §F MOAT narrative from MASTER_DESIGN, cancel FOLLOW-341 and FOLLOW-342. Estimated 2h. The
djb2 hash ordering becomes the documented and only mechanism.

**Required action:**

Piotr (CEO): choose Option A or Option B. Pasting your answer in Slack/reply with "A" or "B" is
sufficient. PM will delegate accordingly.

**Resolution:** CEO (Piotr) chose **Option A** on 2026-06-25 — "we need it to be fully functional in
all aspects." FOLLOW-341 delegated to ml-engineer. FOLLOW-342 unblocked once FOLLOW-341 is done.

---

## RESOLVED — ESC-031: P1 prod incident — ALL adaptation_decisions writes silently failing since PR #357 merge [FOLLOW-394]

**Filed by:** pm-orchestrator **Date:** 2026-06-26 **Affects:** FOLLOW-394 (and FOLLOW-395
downstream), production ClickHouse `adaptation_decisions` table **Type:** P1 production data-loss
incident

**Description:**

PR #357 (FOLLOW-358) merged at 2026-06-26T10:40Z adds `page_context_source` to the explicit column
list of the `logDecisionAsync` INSERT in `apps/control-plane/src/app/api/adapt/route.ts` (~line
468). ClickHouse rejects an INSERT that names a column not present in the table with
`NO_SUCH_COLUMN_IN_BLOCK`. The `logDecisionAsync` function is fire-and-forget with a swallowed
`.catch` (route.ts:501-504 — only `console.error`s). This means:

**Every call to `/api/adapt` (GET or POST) since PR #357 merged has silently failed to write its row
to `adaptation_decisions` in production ClickHouse.** No row is written, no error surfaces to the
caller, no alert fires.

The fix is migration `infra/clickhouse/migrations/0019_adaptation_decisions_page_context_source.sql`
— an idempotent
`ALTER TABLE adaptation_decisions ADD COLUMN IF NOT EXISTS page_context_source LowCardinality(String) DEFAULT 'legacy'`.
This migration runs in CI against a throwaway container but does NOT auto-apply to prod (project
invariant: ClickHouse migrations require manual operator apply, per memory
`project_postgres_migrations_no_autoapply` and RETRO-076/FOLLOW-308).

**Complicating factor (CAVEAT):** The prod ClickHouse user is `ingest_worker`. Per RETRO-076, this
user may lack `ALTER TABLE` DDL grant. Attempting `ALTER TABLE` without the grant will also fail
silently (or with a permission error). You must verify the DDL grant BEFORE applying.

**Required human action — two paths:**

**Path A (recommended — fastest to resolve the data loss):** Manually apply migration 0019 to prod
ClickHouse via Doppler:

```
doppler run --config prd -- clickhouse-client --host <CH_HOST> --user ingest_worker --password <pw> \
  --query "ALTER TABLE adaptation_decisions ADD COLUMN IF NOT EXISTS page_context_source LowCardinality(String) DEFAULT 'legacy'"
```

FIRST verify the `ingest_worker` user has `ALTER TABLE` privilege. If not, use the admin/default
user for the DDL apply (or grant the privilege). After apply, run a smoke test: make one GET and one
POST request to `/api/adapt`, then query
`SELECT DISTINCT page_context_source FROM adaptation_decisions LIMIT 5` — should return
`caller_supplied` and/or `page_type_derived` for new rows.

**Path B (if prod ClickHouse access is unavailable right now):** Temporarily revert the
`page_context_source` column from the INSERT in `route.ts` until the migration can be applied. This
stops the data loss but requires another deploy. PM can delegate this to backend-engineer
immediately.

**PM is blocked from picking new tickets while this escalation is OPEN.**

**Resolution:** Applied 2026-06-26T~12:00Z via ClickHouse Cloud SQL console (admin user). Migration
0019
(`ALTER TABLE adaptation_decisions ADD COLUMN IF NOT EXISTS page_context_source LowCardinality(String) DEFAULT 'legacy'`)
applied successfully. Verified: column exists with correct type and default. All `/api/adapt` writes
now succeeding. Remaining FOLLOW-394 code ACs (AC-4: ClickHouse-smoke contract test; AC-5: deploy
runbook update) delegated to data-engineer — tracked in QUEUE.md FOLLOW-394 IN_PROGRESS.

---

## RESOLVED — ESC-032: `ingest_worker` prod ClickHouse grant is `INSERT,SELECT ON default.*` (all tables) — diverges from MASTER_DESIGN `default.events` least-privilege; security posture decision required [FOLLOW-424]

**Filed by:** pm-orchestrator **Date:** 2026-06-28 **Affects:** FOLLOW-424, prod ClickHouse security
posture, MASTER_DESIGN.md §44 **Type:** architectural / security

**Description:**

RETRO-133 (§4a LG-1, surfaced during FOLLOW-404 prod attestation) found that the prod ClickHouse
user `ingest_worker` holds `GRANT SELECT, INSERT ON default.* TO ingest_worker` — covering EVERY
table in the `default` schema. `MASTER_DESIGN.md:44` documents the intended scope as
`default.events` only.

Two-part divergence:

1. **Security posture:** A compromised or misused `ingest_worker` credential can INSERT into and
   SELECT from ANY table in `default`, not the minimal write set. The tables the worker actually
   writes are: `events`, `adaptation_decisions`, `intent_events` (and potentially others). A
   wildcard beyond those surfaces unnecessary blast radius.

2. **Design-doc drift:** The Master Design says `default.events`; the actual prod grant is
   `default.*`. Either the doc is stale (the wildcard was intentional, never updated) or the prod
   grant is over-broad (should be narrowed). The current wildcard is what silently makes
   `logDecisionAsync` INSERTs to `adaptation_decisions` legal.

Per the autonomy rules (CLAUDE.md): "A test reveals a security issue" and "They need to change a
public API surface … or compliance posture" → PM escalates.

**Required action (Piotr — ~10 minutes decision + optional ~30 min implementation):**

Choose ONE of:

**Option A — Narrow the grant (recommended, least-privilege):**

1. Enumerate all tables `ingest_worker` writes: grep INSERT call sites (currently `events`,
   `adaptation_decisions`, `intent_events` — confirm complete list).
2. Revoke the wildcard: `REVOKE SELECT, INSERT ON default.* FROM ingest_worker`
3. Re-grant the minimal set: `GRANT INSERT ON default.events TO ingest_worker`,
   `GRANT INSERT ON default.adaptation_decisions TO ingest_worker`,
   `GRANT INSERT ON default.intent_events TO ingest_worker` (add SELECT where needed for existing
   queries).
4. Run a smoke test to confirm writes still succeed on all three tables.
5. Update `MASTER_DESIGN.md:44` to document the exact minimal write set.

**Option B — Accept the wildcard with documented rationale:**

1. Update `MASTER_DESIGN.md:44` to say `default.*` (all tables) with explicit rationale (e.g.
   "wildcard chosen to avoid grant-maintenance friction as new tables are added; accepted
   blast-radius trade-off for this service tier").
2. File a FOLLOW stub to revisit at pilot scale.

**Blocking:** This does NOT block the PM pipeline. FOLLOW-424 tracks the implementation; this
escalation records the security decision.

**Resolution:** Piotr (CEO) chose **Option A — narrow the grant (least-privilege)**, 2026-06-28,
with a mandatory safety sequence to avoid re-introducing a silent/broken write path so soon after
ESC-031:

1. **Enumerate first, narrow second.** Before any REVOKE, data-engineer must grep all
   `ingest_worker` write call sites (`INSERT INTO …` across apps/ingest and apps/control-plane) and
   produce the COMPLETE table list. Do not assume the list is only
   `events`/`adaptation_decisions`/`intent_events` — confirm it.
2. **Verify fail-loud coverage per table.** For each table in the write set, confirm the writer
   surfaces HTTP-level rejections (non-ok response → Sentry capture), as FOLLOW-425 did for
   `adaptation_decisions`. If any sink still only has `.catch()` (network-only), file a follow-up to
   add fail-loud there — do NOT narrow the grant until each path will fail loudly, so a missed table
   can't silently break.
3. **Apply narrowed grant** via Doppler `prd`: REVOKE the `default.*` wildcard, re-GRANT the minimal
   `INSERT` (+ `SELECT` only where an existing query needs it) on the confirmed table set.
4. **Smoke-test** writes on every table in the set post-narrowing; confirm rows land.
5. **Update `MASTER_DESIGN.md` §44** to document the exact minimal write set (aligns doc to
   reality).

Rationale: GDPR/PDPL posture wants least-privilege on a write-path service account; tighten reality
to the stricter documented model rather than relaxing the model to match drift. The enumeration +
fail-loud gate converts the wildcard into an explicit, auditable grant without gambling on an
incomplete table list. Tracked by FOLLOW-424 (delegated to data-engineer 2026-06-28). Non-blocking
for the pipeline.

**EXECUTED & VALIDATED — 2026-06-29.** Phase 1 (read-only enumeration + fail-loud audit) found the
write set is LARGER than the initial estimate: 5 INSERT tables (`events`, `intent_events`,
`adaptation_decisions`, `llm_calls`, `dsr_audit_log`) plus DSR `ALTER DELETE/UPDATE` and
`system.mutations` SELECT that the wildcard never covered. The fail-loud gate surfaced two more
blind sinks (`logLlmCallAsync`, `writeDsrAuditLog`) — hardened in FOLLOW-427/428 (PR #377) before
narrowing. Phase 2 REVOKE/GRANT run by Piotr in the ClickHouse Cloud SQL console;
`SHOW GRANTS FOR ingest_worker` returned the exact 14-row minimal grant with NO `default.*`
wildcard. Validated by direct `ingest_worker` tests against prod: auth ✅, SELECT ✅, INSERT ✅ (row
landed), ALTER DELETE ✅, negative control `SELECT default.description_generations` →
`Code: 497 … ingest_worker: Not enough privileges … (ACCESS_DENIED)` ✅ (confirms wildcard removed
and least-privilege enforced). Full procedure + attestation in
`docs/runbooks/clickhouse-ingest-worker-grant-narrowing.md`. §44 updated to the minimal grant.
**Grant is correct and does not break writes.**

NOTE: During validation, a SEPARATE prod regression was found — the control-plane `/api/adapt` app
path no longer writes `adaptation_decisions` (two end-to-end smokes failed, while direct
`ingest_worker` INSERT succeeds). This is NOT caused by the grant. Filed as ESC-033 (P1).

---

## RESOLVED — ESC-033: control-plane `/api/adapt` silently not writing `adaptation_decisions` in prod (grant-independent latent bug) [P1]

**Filed by:** orchestrator (acting) **Date:** 2026-06-29 **Affects:** prod control-plane adapt
route, `adaptation_decisions` analytics, decision audit trail **Type:** prod regression / data loss
(analytics)

**Severity:** P1. NOT user-facing — `/api/adapt` returns HTTP 200 with a valid decision. Impact is
analytics/audit: adaptation decisions are not being persisted, so lift/calibration dashboards and
the decision audit trail go stale. Same silent-write-failure FAMILY as ESC-031 (but now fail-loud,
so Sentry should hold the exact error).

**Evidence (2026-06-29 session):**

1. FOLLOW-422 confirmed writes flowed at 2026-06-28 13:01 (2 rows in `adaptation_decisions`,
   sessions `smoke-follow422-*`).
2. Two fresh end-to-end smokes today via `https://admin.estalara.com/api/adapt` (sessions
   `smoke-esc032-1782683704` @ 21:55 and `smoke-esc032b-1782684969` @ 22:16) each returned HTTP 200
   with a valid `adapt_decision_id`, but NEITHER row landed in `adaptation_decisions` (`count()=0`
   per session).
3. Direct `INSERT` into `adaptation_decisions` as `ingest_worker` (post grant-narrowing) SUCCEEDS —
   so the table, grant, and credential are fine. The failure is specific to the control-plane
   runtime write path (`logDecisionAsync`).
4. Window: regression appeared between 13:01 (working) and 21:55 (broken) on 2026-06-28 — coincides
   with prod redeploys from merging PR #376 (FOLLOW-426, touched
   `apps/control-plane/src/app/api/adapt/route.ts`) and PR #377 (FOLLOW-427/428). Prime suspect: a
   deploy-introduced change in the adapt route's fire-and-forget block, OR a runtime env/URL/user
   difference in the deployed control-plane.

**Required action (next work cycle):**

1. Pull the exact error from Sentry (control-plane project, ~21:55 and ~22:16 UTC 2026-06-28, tag
   `kind:insert_rejected` or `kind:network`) — the FOLLOW-425 fail-loud capture should hold the
   verbatim ClickHouse/fetch error. Alternatively `vercel logs` for the control-plane prod
   deployment (console.error from `logDecisionAsync`).
2. The error class points the fix: `497 Not enough privileges` → control-plane connects as a user
   OTHER than `ingest_worker`; `network`/DNS → `CLICKHOUSE_URL` missing/wrong in the deployed
   runtime; `Unknown column` → a column drift in the INSERT list from a recent deploy.
3. Likely owner: backend-engineer (adapt route) with data-engineer support.

**Blocking:** Does NOT block the agent pipeline or ESC-032. Analytics-only data loss; fix promptly.

**ROOT CAUSE — diagnosed 2026-06-29 (NOT a regression; pre-existing latent bug):**

The fire-and-forget ClickHouse write in `logDecisionAsync`
(`apps/control-plane/src/app/api/adapt/route.ts:512`) issues `fetch(...)` but is **never awaited and
never wrapped in `waitUntil()`/`after()`** (documented as "Fire-and-forget — never awaited, never
blocks the response", route.ts:458). On Vercel, once the handler does
`return NextResponse.json(...)`, the function instance is suspended; an in-flight un-awaited `fetch`
is not guaranteed to complete — so the INSERT is silently dropped on cold/isolated requests.

**Empirical proof:** a burst of 8 rapid GET `/api/adapt` requests (2026-06-29) all returned HTTP 200
but only **1 of 8 rows landed** in `adaptation_decisions`. Isolated requests (21:55, 22:16) landed
0; FOLLOW-422's two requests at 13:01 were 8s apart and landed 2/2 (warm instance). Identical
credentials every call ⇒ not auth/grant — the variance is instance-lifecycle timing. The "regression
/ deploy window" framing in the title is therefore WRONG: the write was never reliable; FOLLOW-422
caught lucky warm-instance flushes.

**Compounding finding:** because the instance can freeze before the `.then`/`.catch` runs, the
**fail-loud Sentry capture itself (FOLLOW-425/426/427/428) is also unreliable** without `waitUntil`
— which is why Sentry may show no `insert_rejected` event for the dropped writes. The write family
and the fail-loud family share the same gap.

**Scope:** the same un-awaited pattern (no `waitUntil`/`after`) applies to the whole family:
`logDecisionAsync`, `logLlmCallAsync` (`lib/llm-gateway.ts`), `writeDsrAuditLog`
(`api/dsr/_clickhouse.ts`), `publishAbAssignmentEvent` (`lib/ab-events.ts`),
`publishDescriptionRequested` (`api/adapt/description/route.ts`).
`grep -rn "waitUntil|after" apps/control-plane/src` → zero hits.

**FIX (recommended):** wrap each fire-and-forget sink in Next.js 15 `after()`
(`import { after } from 'next/server'`) — or `waitUntil` from `@vercel/functions` — so the async
write (and its fail-loud `.then`/`.catch` → Sentry) completes after the response is sent, before
suspension. `after()` needs no new dependency. Owner: backend-engineer; add tests asserting each
sink promise is registered via `after()`. This also makes FOLLOW-425/426/427/428's fail-loud
observability actually effective.

**Resolution:** RESOLVED 2026-06-29 by FOLLOW-431. Root cause was the missing `waitUntil`/`after` on
fire-and-forget sinks (proof: 1/8 burst writes landed). FOLLOW-431 wraps all five sinks
(`logDecisionAsync`, `logLlmCallAsync`, `publishAbAssignmentEvent`, `publishDescriptionRequested`,
`writeDsrAuditLog`) in Next.js `after()` from `next/server`, so the async write and its fail-loud
`.then`/`.catch` → Sentry complete after the response is sent, before instance suspension. Sinks now
return `Promise<void>`; DSR call sites drop their redundant outer `.catch()` (the sink captures all
errors internally and never rejects). Tests assert each sink is registered via `after()`. This also
makes the FOLLOW-425/426/427/428 fail-loud observability effective. Title's "regression" framing
superseded by the latent-bug diagnosis. **Post-merge:** verify in prod via a burst of N `/api/adapt`
requests → expect N rows in `adaptation_decisions` (not the prior ~1/8).

**PROD VERIFICATION — PASSED 2026-06-29.** Burst of 10 GET `/api/adapt` requests (session prefix
`smoke-esc033-1782729874-`, archetype `luxury_buyer`, tier 2) all returned HTTP 200;
`SELECT count() FROM adaptation_decisions WHERE session_id LIKE 'smoke-esc033-1782729874-%'`
returned **10** (vs the prior ~1/8 burst-landing rate). All 10 rows present with distinct
session_ids, ts 10:44:35–10:44:37Z, variant=control, source=playbook,
page_context_source=caller_supplied. Confirmed against the post-merge prod deploy (commit `3a0f802`,
prod deploy created 09:08Z). Procedure recorded in `docs/runbooks/esc-033-verification.md`. ESC-033
fully closed.

## RESOLVED — ESC-035: SECURITY — feedback route uses caller-supplied bearer as HMAC key with no api_keys lookup; trusts caller's body.tenant_id → forgeable auth + cross-tenant bandit write-poisoning [FOLLOW-442 / AUD-05]

**Filed by:** pm-orchestrator **Date:** 2026-07-01T00:00:00Z **Affects:**
`apps/control-plane/src/app/api/adapt/feedback/route.ts`, `ab_bandit_weights`, `conversion_labels`
**Type:** security

**Description (Rule C — security finding; agents must escalate):**

`apps/control-plane/src/app/api/adapt/feedback/route.ts:143` computes:

```ts
const expectedHex = await hmacSha256Hex(bearerToken, rawBody);
```

where `bearerToken` is the **caller-supplied** `Authorization: Bearer <value>`, NOT a value looked
up from `api_keys`. Any caller who knows their own bearer token (which they chose themselves) can
compute a valid HMAC over any payload they craft and pass signature verification. There is no
`api_keys` table lookup in the HMAC path.

Additionally, `tenantId` is taken from `parsed.data.tenant_id` (the request body, line 374/395), not
derived from a resolved API key. A malicious caller can therefore write `ab_bandit_weights` and
`conversion_labels` for ANY `tenant_id` they supply.

The fallback at lines 130-134 (`if (adaptApiKey && bearerToken === adaptApiKey)`) only protects the
ops integration-test key path; the HMAC path is unprotected.

**Impact:**

- Any tenant (or external actor who has ever made a legitimate feedback call) can poison bandit
  Thompson-sampling weights for any other tenant, corrupting variant selection.
- Any actor can forge conversion labels (`conversion_labels` table) for any tenant.
- This makes pilot A/B results forgeable.

**Evidence:**

```
grep -n "hmacSha256Hex\|bearerToken\|api_keys\|tenant_id" \
  apps/control-plane/src/app/api/adapt/feedback/route.ts
# Line 143: hmacSha256Hex(bearerToken, rawBody) — bearerToken is caller-supplied
# Lines 374, 395: tenantId: parsed.data.tenant_id — caller-supplied
# No api_keys lookup anywhere in the file
```

**Required fix (backend-engineer, after human confirms scope):**

1. Look up `bearerToken` in `api_keys` table → derive `resolvedTenantId` and a stored `secret`.
2. Use the stored `secret` (not the raw bearer) as the HMAC key.
3. After auth, assert `parsed.data.tenant_id === resolvedTenantId`; reject with 403 if mismatch.
4. If `ADAPT_API_KEY` ops fallback is kept, scope it to the ops tenant or add a hard `tenant_id`
   constraint.

**Required action:** Piotr (CEO) to confirm: (a) The fix scope above is correct — particularly
whether `api_keys` already stores the shared HMAC secret per tenant, or whether a new
`api_key_secrets` column/table is needed. (b) Priority: this is a security bug in production NOW.
Recommend P0 fix before ANY pilot traffic runs through the feedback endpoint. (c) Whether the
existing ops `ADAPT_API_KEY` bypass should be removed or scoped.

**Blocking:** YES — blocks delegating FOLLOW-442 and blocks pilot go-live (a pilot with forgeable
feedback metrics is worse than no pilot). Per PM guardrails, no new ticket can be delegated while
this escalation is open.

**Resolution:** RESOLVED 2026-07-01 by Piotr Nawrocki (CEO). CEO rulings (from decision prompt
2026-07-01): (a) **Priority P0**, routed architect-ADR-then-backend. (b) **Interim =
secure-by-default 503**: the feedback endpoint is disabled unless `FEEDBACK_ENDPOINT_ENABLED=true`
is explicitly set — shipped in FOLLOW-444 (PR #397, merged, main `0e0bdb0`). Prod is safe with zero
operator action. (c) **`ADAPT_API_KEY` ops bypass RETAINED but scoped** to a single designated ops
tenant (`OPS_TENANT_ID`, 403 on mismatch) — also shipped in FOLLOW-444.

**SCHEMA CORRECTION (verified in code 2026-07-01, supersedes the "argon2id / new column" framing in
the Required-fix section above):** `api_keys.hashed_key` is **SHA-256(raw_key) with a unique index**
(the schema doc-comment saying "argon2id" is wrong — ADR-0015 fixes it), and a correct
`resolveApiKey()` helper already exists and is used by four routes (`quiz/public-config`,
`intent/config`, `quiz/completion`, `crm/outcome`). Therefore the permanent fix needs **NO migration
and NO new column** — the `lookup_hash`/argon2id path is REJECTED (ADR-0015 §Alternatives). The fix:
extract `resolveApiKey()` into `apps/control-plane/src/lib/api-key-auth.ts`, use it in
`feedback/route.ts`, derive `tenantId` from the resolved key, reject
`body.tenant_id !== resolvedTenantId` (403). Design: **ADR-0015**
(`docs/adr/ADR-0015-feedback-endpoint-authentication.md`), status PROPOSED. Backend-engineer
implements from ADR-0015 in the FOLLOW-443 implementation ticket once ADR-0015 is ACCEPTED; the
interim 503 is lifted (`FEEDBACK_ENDPOINT_ENABLED=true`) only after that PR merges CI-green.

**FINAL RESOLUTION (verified 2026-07-01 by pm-orchestrator — closing the loop the same session):**
ADR-0015 status is now **ACCEPTED** (`docs/adr/ADR-0015-feedback-endpoint-authentication.md:3`).
FOLLOW-443 merged to main (PR #401, commit `6224c2d`): `feedback/route.ts` now runs the 5-step
ADR-0015 algorithm — SHA-256 bearer → `api_keys` DB lookup via the new shared
`resolveApiKey()`/`sha256Hex()`/`constantTimeEqual()` lib
(`apps/control-plane/src/lib/api-key-auth.ts`), HMAC body-signature defense-in-depth, and
server-authoritative `body.tenant_id !== resolvedTenantId → 403` enforcement. `ADAPT_API_KEY` ops
bypass retained but now scoped to `OPS_TENANT_ID` (403 on mismatch), per CEO ruling (c). 49 tests in
`feedback/route.test.ts` cover the T1–T12 auth matrix. CI green on PR #401
(lint/typecheck/build/test all pass). ESC-035 code-fix axis is CLOSED — the forgeable-auth
vulnerability no longer exists in main.

**Remaining non-blocking operator step (same pattern as ESC-034):** the endpoint is still
secure-by-default OFF in prod (`FEEDBACK_ENDPOINT_ENABLED` not yet flipped). Per PR #401's own
"NEXT" note: ops must set `OPS_TENANT_ID` + `ADAPT_API_KEY` in Doppler `prd` and flip
`FEEDBACK_ENDPOINT_ENABLED=true` before the feedback endpoint serves live traffic. This is a
privileged operator action, not a code gap — it does NOT block further ticket delegation (mirrors
ESC-020/ESC-028/ESC-034 precedent: code-complete-awaiting-operator-action is non-blocking). Tracked
going forward as part of the pilot go-live checklist in `backlog/STATUS.md`, not as its own new
FOLLOW ticket.

---

## RESOLVED — ESC-034: FOLLOW-436 embed-seed Modal consumer awaiting operator go-live — code bugs fixed by FOLLOW-437, operator steps remain [FOLLOW-436]

**RESOLVED 2026-07-13.** The direct-HTTPS embed-seed path (ADR-0016, post-Redpanda) is live and
proven **end-to-end**. Direct smoke on the deployed Modal web endpoint
`https://estalara--estalara-description-generator-listing-embed-s-e2dcc5.modal.run`: `POST` with
`Authorization: Bearer <INTERNAL_API_SECRET>` + `{tenant_id, listing_ids:[…]}` → **202
`{"status":"accepted"}`**; no-auth → **401**. The spawn's callback landed — the target listing's
`listing_embeddings.updated_at` bumped to ~now (SQL-verified). So Modal endpoint →
`process_embed_seed_request.spawn` → `POST /api/listings/embed` → OpenAI → DB upsert all work, and
`INTERNAL_API_SECRET` in Modal `estalara-secrets` matches control-plane. `MODAL_EMBED_SEED_URL`
present in Vercel prod (re-set to the confirmed URL + redeployed). Traps: the Modal URL is
truncated+hashed (copy from the dashboard, never derive from `MODAL_DESCRIPTION_URL`);
`MODAL_DESCRIPTION_URL` is Vercel-Sensitive (unreadable). Onboarding-overflow trigger itself not
exercised (heavy) but every leg proven. Full attestation:
`docs/runbooks/OPERATOR_SESSION_2026-07-12.md` Step 3.

---

### Original escalation (for reference)

**Filed by:** devops-engineer **Date:** 2026-06-30T00:00:00Z **Affects:** FOLLOW-436, FOLLOW-435,
FOLLOW-437 **Type:** other (privileged operator action — code bugs now resolved)

**Description:**

FOLLOW-436 (operator go-live for the FOLLOW-435 embed-seed Modal consumer) requires privileged human
steps: Modal account access, the actual `INTERNAL_API_SECRET` value from Doppler `prd`, and
`modal deploy`. Agents cannot execute these.

**CODE BUGS — RESOLVED by FOLLOW-437 (PR #393, commit 09084f3, merged 2026-06-30):**

During FOLLOW-436 go-live wiring verification, two structural code bugs were found that made a safe
go-live impossible with the FOLLOW-435 codebase. Both are now fixed:

**BUG 1 — ORPHAN (`main.py` deployed nothing) — FIXED:** `apps/llm-gateway/src/main.py` was a
placeholder stub (no `modal` import, no `modal.App`, no imports of consumer modules). Running the
canonical `modal deploy apps/llm-gateway/src/main.py` registered zero functions. Fix: `main.py` now
imports both consumer modules (load-bearing `# noqa: F401`) so all 3 functions register under one
deployment.

**BUG 2 — APP-NAME COLLISION — FIXED:** `generate_description.py` and
`consume_embed_seed_requests.py` each declared an independent
`modal.App("estalara-description-generator")`. Deploying either file alone would have wiped the
other's functions from the live app. Fix: the single shared `app` is now in
`apps/llm-gateway/src/jobs/_app.py`; both consumers import from there. App name
`estalara-description-generator` preserved.

**Remaining required action (operator only):**

**Operator go-live (Piotr or Rafał, ~20 min):** Follow
`docs/runbooks/modal-embed-seed-consumer-golive.md` in order:

- Step 1: Provision three secrets in Modal `estalara-secrets` (via web console):
  - `REDPANDA_TOPIC_LISTING_EMBEDDINGS` = `estalara.listing-embeddings`
  - `EMBED_API_BASE_URL` = `https://admin.estalara.com` (or staging URL)
  - `INTERNAL_API_SECRET` = copy from `doppler secrets get INTERNAL_API_SECRET --config prd --plain`
- Step 2: `modal deploy apps/llm-gateway/src/main.py` — verify `consume_embed_seed_requests` appears
  in the Modal dashboard with schedule `every 30 seconds`.
- Step 3: Smoke verification per the runbook (trigger overflow activation, check Modal logs, check
  Sentry `tags.area:onboarding tags.sink:modal-embed-seed`).

**Resolution:** Code fix complete (FOLLOW-437 / PR #393 merged 2026-06-30). Awaiting operator
go-live (Step 1-3 above). Escalation closes when smoke verification passes.

**CORRECTION 2026-07-06 (pm-orchestrator session 10) — the runbook above is now STALE, do not follow
Step 1-3 as written.** FOLLOW-485 (PR #431, ADR-0016, merged 2026-07-03) replaced the
Redpanda-poller embed-seed consumer entirely with a direct-HTTPS Modal endpoint
(`listing_embed_seed_requested_endpoint`, same pattern as the now-live description flow). The old
`consume_embed_seed_requests` poller code is retained in the repo but its `modal.Period(seconds=30)`
schedule was removed — it is dead/unscheduled, not the live path. **Corrected operator go-live
path:** provision `MODAL_EMBED_SEED_URL` in Vercel prod (mirroring `MODAL_DESCRIPTION_URL`; both
consumed by `apps/control-plane/src/lib/listing-embed-seed-publisher.ts` via
`publishListingEmbeddingSeed`), confirm `INTERNAL_API_SECRET` (bearer, `hmac.compare_digest`) is set
in Modal `estalara-secrets` (same secret already required for the description endpoint), then smoke
by triggering an onboarding-overflow embed-seed event and checking Modal logs / Sentry
`tags.area:onboarding tags.sink:modal-embed-seed`. No `REDPANDA_TOPIC_LISTING_EMBEDDINGS` step is
needed. `docs/runbooks/modal-embed-seed-consumer-golive.md` needs an update pass to match (not done
by this session — flagging for devops-engineer or the next doc-sync ticket). Escalation stays OPEN,
still operator-action-pending, just against the corrected target.

---

## RESOLVED — Modal ML layer never deployed to prod (no apps/secrets in the only account, no CI deploy) [FOLLOW-436]

**Filed by:** pm-orchestrator (session 9) **Date:** 2026-07-02T21:30:00Z **Affects:** FOLLOW-436,
FOLLOW-458, FOLLOW-460 (Modal legs), pilot go-live, core AI-description feature **Type:**
architectural | vendor (infra)

**Description:** While preparing the FOLLOW-460 operator step (add `DESCRIPTION_CACHE_*` keys to the
Modal `estalara-secrets` secret), discovered the Modal ML layer is not deployed to prod at all:

- The only Modal account available (CEO's `pnawrocki9`, the sole profile in `~/.modal.toml`) has **0
  deployed apps and 0 secrets** (`modal app list` / `modal secret list` both empty; only the `main`
  environment exists). CEO confirmed there is no separate Estalara/org Modal account.
- **No CI workflow deploys Modal** (`grep 'modal deploy'` over `.github/workflows` = 0). There is no
  automated deploy path for any Modal app.
- `estalara-secrets` therefore does not exist; FOLLOW-436's "provision estalara-secrets + deploy
  llm-gateway" operator step was never completed. FOLLOW-458 (deploy stream-consumer + data-quality)
  likewise never done.
- Prod `description_cache_persistent` = 0 rows (consistent, though also expected pre-#428).

**Impact reconciliation (what works vs. what is dark in prod):**

- ✅ WORKS without Modal: archetype decision + playbook directives + the directive-level LLM tweak
  (headline/CTA/feature) — `apps/control-plane/src/lib/llm-gateway.ts` calls `@anthropic-ai/sdk`
  (`new Anthropic()`) DIRECTLY from the control-plane, needing only `ANTHROPIC_API_KEY` (set in
  prod). This is why DOM adaptation worked on localhost and works in prod.
- ❌ DARK without Modal: full per-listing AI description-body rewrite (`/api/adapt/description`
  publishes `description.requested` to Redpanda `estalara.descriptions`; the consumer is a Modal
  `@app.function` in `generate_description.py` that is not deployed → events unconsumed → only
  `template_fallback` served). Also dark: intent-engine NLP, embeddings/embed-seed, stream-consumer
  (live chat NLP), data-quality drift cron — all Modal. On localhost these ran via the local mock
  harness (:9100), masking that prod Modal was never stood up.

**Required action (CEO/devops decision — do NOT auto-provision):** Decide and execute the prod Modal
stand-up: (1) confirm `pnawrocki9` is the canonical prod Modal account (or create an org account);
(2) assemble the full `estalara-secrets` inventory from Doppler/Vercel (ANTHROPIC*API_KEY, all
REDPANDA*_, UPSTASH*REDIS*_, SENTRY_DSN, EMBED_API_BASE_URL, INTERNAL_API_SECRET, plus FOLLOW-460's
DESCRIPTION_CACHE_INTERNAL_SECRET + DESCRIPTION_CACHE_API_BASE_URL); (3)
`modal secret create estalara-secrets ...`; (4) `modal deploy` the llm-gateway (+ intent-engine /
stream-consumer / data-quality per FOLLOW-458 scope); (5) add a CI deploy workflow so it doesn't
drift again. Until then, FOLLOW-460's Postgres-cache write and full AI description generation are
inert in prod; the code PRs (#428/#429/#430) can still merge — this gap is infra, not code.

**Update 2026-07-03 (Redpanda cost/blocker resolved by ADR-0016):** During stand-up we found the
prod Redpanda cluster is **Serverless**, whose HTTP Proxy (the REST endpoint the edge/serverless
producers publish through) is **BYOC/Dedicated-only** — and a Dedicated cluster (~$500/mo) is out of
pilot budget (CEO). Decision **ADR-0016**: drop Redpanda for the pilot and invoke Modal directly
over HTTPS (Modal web endpoint); implementation **FOLLOW-485** (P1, ml-engineer). This removes
Redpanda from the Phase-A critical path entirely. ESC-036 stays OPEN for the remaining, non-Redpanda
work: create the `estalara` Modal workspace + provision `estalara-secrets` (minus Redpanda) + deploy
`apps/llm-gateway`

- add a CI deploy workflow. Operator guide + `MODAL_PROD_STANDUP.md` updated to the no-Redpanda
  flow.

**Resolution (2026-07-03, RESOLVED — Modal ML layer LIVE in prod):** Operator (Piotr) executed the
ESC-036 Modal stand-up per `docs/runbooks/MODAL_PROD_STANDUP.md`: created the `estalara` Modal
workspace, provisioned `estalara-secrets` (no Redpanda, per ADR-0016), deployed
`estalara-description-generator` (`apps/llm-gateway`), set
`MODAL_DESCRIPTION_URL`/`MODAL_EMBED_SEED_URL` in Vercel prod, and redeployed the control-plane. A
`.github/workflows/modal-deploy.yml` deploy pipeline was added (PR #432) so it can't silently drift
again. ATTESTATION: a real Sonnet-4.6 family_buyer description (1060 chars) was generated and
written to prod `description_cache_persistent` via the deployed direct-Modal web endpoint. Two
deploy bugs were found + fixed during stand-up: (1) the consumer modules read the shared contract
fixtures at import time but they weren't in the Modal image → container crashed on import → **PR
#433** bakes them in; (2) a stray **leading space** in the manually-pasted `ANTHROPIC_API_KEY`
secret value produced an "Illegal header value" that surfaced as a misleading
`APIConnectionError: Connection error.` → corrected in `estalara-secrets`. RESIDUAL (not blocking,
tracked separately): the full browser→SDK→control-plane→Modal leg + the ESC-019 listing-fetch hop
still want a real-listing confirmation; Modal Phases B (intent-engine) and C (data-quality /
stream-consumer, FOLLOW-458) remain deferred; and a `.strip()` hardening on secret-env reads is
filed as FOLLOW-488 to prevent the leading-space class of bug recurring.

---

## RESOLVED — ESC-037: four erased ClickHouse PII tables are disclosed to nobody — live Art. 15/20 gap in prod today (not gated on any deploy) [FOLLOW-574]

**Filed by:** pm-orchestrator (session 30, off RETRO-176) **Date:** 2026-07-16T00:00:00Z
**Affects:** FOLLOW-574 (P1), `apps/control-plane/src/app/api/dsr/access/route.ts`,
`apps/control-plane/src/app/api/dsr/portability/route.ts`,
`apps/control-plane/src/lib/clickhouse-dsr.ts`, prod ClickHouse **Type:** compliance

**Description:** DSR erasure deletes **five** ClickHouse PII tables — `DSR_CLICKHOUSE_TABLES`
(`clickhouse-dsr.ts:72-78`) lists `events`, `adaptation_decisions`, `llm_calls`, `session_quality`,
`intent_events`. DSR access/portability disclose **one aggregate over one of them**: both routes
call only `getSessionEventSummary()` and return `events_summary` (`access/route.ts:301,326`). So
`adaptation_decisions`, `llm_calls`, `session_quality` and `intent_events` are **erased but
disclosed to nobody**, and `events` is disclosed as a count rather than a copy of the data.

Verified independently by the PM before filing (read `DSR_CLICKHOUSE_TABLES` and both routes'
ClickHouse call sites), not taken on the retro's word.

Same asymmetry class the 2026-07-11 audit raised as A3-F-06 and that FOLLOW-558 (PR #529, merged
`797b8ab`) was supposed to close: **if the controller demonstrably holds and erases a store, an Art.
15 access report and an Art. 20 export may not omit it.** FOLLOW-558 closed the gap on the Postgres
axis only. Nobody owned the union across storage classes.

**Why this is escalated rather than left as a queue ticket:** unlike the sibling Redis gap
(FOLLOW-570, which arms only when FOLLOW-458 deploys), **this data is live in prod right now and
needs no deploy to arm it.** Any DSR access/portability request served today returns an incomplete
report. That is a compliance-posture question with a regulatory clock on it, and per CLAUDE.md
compliance posture is not the PM's call.

Two related findings from the same retro pair, for context (both filed as tickets, neither
escalated):

- **FOLLOW-576 — FOLLOW-558's AC2 is not met.** The `disclosure-route-driven-pglite.test.ts`
  "PARITY" block never imports `erase/route.ts` (`grep` finds it only in comments; the file's own
  docstring admits the list "must be updated by hand"). It asserts disclosure ⊇ 6 hardcoded
  literals, so **adding a 7th DELETE target to erase keeps it green** — it cannot fail on the drift
  it is named for. The PM ticked that AC on the strength of the test's name and docstring rather
  than its assertion body, and merged on it; the tick is corrected in `QUEUE.md` this session.
  Widening the hardcoded list (FOLLOW-570 AC(b)) yields a wider hardcoded list — FOLLOW-576 is the
  real fix.
- **FOLLOW-575 — DPIA §8 is out of sync with the code that runs**, so the disclosure enumeration
  that Rule N exists to keep honest currently certifies behaviour the code does not implement.

**Required action (CEO / DPO):**

1. **Rule on exposure. ANSWERED 2026-07-16 by direct prod read — exposure is ZERO; no notification
   duty is triggered.** `SELECT count(*) FROM dsr_verifications` against prod Postgres (via
   `doppler run --config prd`, admin creds, user-authorized read) returned **0**. That table is the
   front door of every DSR flow — access, portability AND erase all begin with an `initiate` that
   writes a `dsr_verifications` row — so zero rows means **no DSR request of any type has ever been
   served in prod**. No incomplete report was delivered because no report was delivered. This makes
   FOLLOW-574 a **latent** gap to close before the first real DSR, not a live incident with a
   remediation/notification clock. The CEO/DPO decision this item asked for is therefore moot; the
   remaining two are not. **Caveat — re-check before first pilot DSR:** this is a point-in-time
   count; it must be re-run (or a monitor added) before any tenant is told DSR is live, since the
   gap arms the moment the first request lands. **Side finding worth a ticket:** the prod
   `dsr_audit_log` ClickHouse read was _not_ usable for this — the Doppler-prd `ingest_worker`
   credentials have **no SELECT grant** on `dsr_audit_log` (`ACCESS_DENIED`), diverging from the
   `INSERT,SELECT ON default.*` recorded at ESC-032. The Postgres front-door count is the reliable
   exposure signal; the CH audit trail is currently unreadable by ops creds.
2. **Sequence FOLLOW-574 against Wave 0.** RETRO-176 recommends 574 **before** FOLLOW-570 on the
   grounds that 574 is live and 570 is deploy-gated. That inverts the Sprint 23 order and competes
   with the FOLLOW-559/FOLLOW-356 lane decision still open from session 29.
3. **Decide the disclosure shape for `events`** — a count is not the data. Full row export vs.
   summary is a product/compliance judgement (volume vs. Art. 15 completeness), not an engineering
   one.

**Resolution:** RESOLVED 2026-07-17 by Piotr (CEO).

1. **Exposure** — already answered before this ruling: prod `dsr_verifications` count = 0, so zero
   exposure, no notification/remediation duty. FOLLOW-574 is a latent gap to close before the first
   real DSR. (Caveat stands: re-run the count or add a monitor before any tenant is told DSR is
   live.)
2. **Sequencing** — **FOLLOW-574 BEFORE FOLLOW-570.** Per RETRO-176's reasoning (574 is the
   live-in-prod ClickHouse axis; 570 is deploy-gated on FOLLOW-458). This inverts the default Sprint
   23 order for these two tickets.
3. **`events` disclosure shape** — **FULL ROW EXPORT, not an aggregate count.** CEO chose Art. 15/20
   completeness over payload economy. Access + portability must return the actual `events` rows for
   the verified (tenant, session) scope, alongside the other four erased-but-undisclosed ClickHouse
   tables (`adaptation_decisions`, `llm_calls`, `session_quality`, `intent_events`).
   **Implementation implication recorded for FOLLOW-574 (not a re-litigation of the ruling):**
   `events` is potentially high-volume per session, so the full export needs a volume-safe delivery
   path (pagination / streaming / a size cap with a documented continuation) rather than one
   unbounded in-memory response. That is an engineering detail for the FOLLOW-574 worker; the
   completeness requirement is fixed by this ruling.

The side finding (`ingest_worker` lacks SELECT on `dsr_audit_log`, diverging from ESC-032) is spun
out as its own follow-up (FOLLOW-580) — an ops-grant hygiene item, not part of this compliance gap.

---

## RESOLVED — ESC-038: FOLLOW-574 diverged from its brief on `intent_events`: the erase filter targets a column that matches zero real rows (latent Art. 17 no-op) [FOLLOW-574]

**Filed by:** compliance-engineer (session, FOLLOW-574) **Date:** 2026-07-17T00:00:00Z **Affects:**
FOLLOW-574, FOLLOW-581, `apps/control-plane/src/app/api/dsr/erase/route.ts`,
`apps/control-plane/src/lib/clickhouse-dsr.ts` (`DSR_CLICKHOUSE_TABLES`) **Type:** compliance
(non-blocking — flagging a deliberate brief deviation + a latent erasure bug for PM/human review)

**Description.** The FOLLOW-574 delegation brief instructed the disclosure of `intent_events` to
"mirror the erase side exactly" using `resolveIntentSessionId()` (filter on `intent_session_id`),
warning that "a raw session_id filter returns the wrong data (empty or cross-session)." On
re-verification (brief's own instruction) that premise is **inverted by migrations 0015/0016**:
`intent_events` rows are written with `intent_session_id` left at its zero-UUID default and the real
SDK fingerprint in the String `session_id` column. The production reader (`clickhouse-tracer.ts`)
filters on `(tenant_id, session_id)` and its header explicitly says "Do NOT use intent_session_id".
So:

1. The erase-side filter `WHERE intent_session_id IN (resolveIntentSessionId())` matches **zero real
   rows** — `intent_events` is a latent Art. 17 erasure no-op (tracked as FOLLOW-581).
2. Mirroring that filter for disclosure would return an **empty** `intent_events` while the
   subject's real rows exist in ClickHouse — a false Art. 15 disclosure, which violates the prime
   directive ("never let shipped behavior claim what it does not do").

**Decision I made (PR-gated, reversible).** FOLLOW-574 discloses `intent_events` on the
authoritative `(tenant_id, session_id)` key so the disclosure is TRUTHFUL, and derives the
disclosure SET (not the per-table filter column) from `DSR_CLICKHOUSE_TABLES`. This yields
disclosure ⊋ erasure for `intent_events` until the erase filter is fixed. I did NOT touch the erase
route (out of scope per the brief); I filed FOLLOW-581 to fix the erase filter, after which
disclosure + erasure re-converge and the divergence note is removed.

**Required action:** PM/human confirm the disclosure-by-`session_id` decision for `intent_events`
(vs. mirroring the empty erase filter) and prioritise FOLLOW-581 (P1 erasure bug). No code change
needed to accept; this entry documents the deviation so it is visible, not hidden.

**Resolution:** RESOLVED 2026-07-17 (pm-orchestrator, session 30). The deviation was CORRECT and is
accepted: the PM independently verified against migrations 0015/0016, the production reader
`clickhouse-tracer.ts`, and the schema that real `intent_events` rows key on `session_id` and
`intent_session_id` is a zero-UUID default — so disclosing on `session_id` (not mirroring the erase
filter) is the truthful Art. 15 behaviour, and mirroring erase would have shipped a false-empty
disclosure. The underlying erase no-op it exposed is fixed in **FOLLOW-581 (DONE, PR #544,
`85156db`)**: `DSR_CLICKHOUSE_TABLES` now keys `intent_events` on `session_id`, so erase +
disclosure re-converged and the FOLLOW-574 divergence note was removed. Nothing further outstanding.

---

## RESOLVED — ESC-039: three staff config editors swallow a failed load, then clobber real tenant config with defaults on the next Save — live on `main` [FOLLOW-624]

**Resolved:** 2026-07-24 by FOLLOW-624 (PR #608, squash-merged to `main` `3b0b4a3`, auto-deployed).
All three editors now track fetch outcome (loading/loaded/error) separately from save status: a
failed GET renders a `role="alert"` banner + Retry and disables Save (guarded again inside
`handleSave` as defense-in-depth); a successful GET (incl. first-time/no-row tenants, which the
route serves as a normal 200) is unaffected. tenant-config-editor also now surfaces the route's zod
`.flatten()` validation `details` in the save-error banner. Tests assert BOTH directions in all
three editors. All real CI gates green (only pre-existing repo-wide `Rule I` red, confirmed also red
on `main` d89757f — not a regression).

**Tenant-facing axis closed 2026-07-24 by FOLLOW-630 (PR #609, `0bfaedd`):** RETRO-206 found the
FOLLOW-624 fix was scoped to `/admin` only and missed three byte-identical twins living outside
`/admin` (`dashboard/quiz/page.tsx`, `dashboard/demo/override/page.tsx`,
`components/generation-model-settings.tsx`, two writing the SAME routes). FOLLOW-630 applied the
identical guard to all three and proved a repo-wide (not `/admin`-narrowed) grep clean. ESC-039 is
now RESOLVED on BOTH the admin and tenant-facing axes.

**Enforcement leg closed 2026-07-24 by FOLLOW-625 (PR #610, `f936089`):** an AST-based CI hard-gate
(`Rule K.2 consumer-side swallow guard`) now FAILS the build on a config-load swallow in any client
component under `src/app/**` OR `src/components/**`, with a fixture suite proving both directions
and a load-bearing allow-list. The pattern can no longer be copy-forwarded silently.

**ESC-039 FULLY CLOSED** — all three legs done: fix (FOLLOW-624), twins (FOLLOW-630), mechanised
enforcement (FOLLOW-625). Nothing outstanding.

**[original escalation below]**

**Filed by:** claude (session 56, post-RETRO-205) **Date:** 2026-07-23T22:00:00Z **Affects:**
FOLLOW-624, FOLLOW-600 (PR #606, merged `19ef714`),
`apps/control-plane/src/app/admin/tenants/[id]/settings/tenant-config-editor.tsx`,
`.../quiz/quiz-config-editor.tsx`, `.../demo/demo-override-editor.tsx` **Type:** other (live
data-loss bug — priority call needed)

**Description:** RETRO-205 found, and I independently confirmed by reading the source, that
`tenant-config-editor.tsx:61` throws on `!r.ok` while `:76` swallows the rejection with a
comment-only `.catch(() => {})`. The component's `DEFAULTS` stay rendered, so a staff user sees a
populated, plausible-looking form. `handleSave` then PATCHes a **full** body. Net effect: one failed
load followed by one Save silently overwrites the tenant's real `brand_config` with defaults and
wipes `allowed_origins` to `[]` — and the UI reports success ("Settings saved!").

The identical block exists in `quiz-config-editor.tsx:72` and `demo-override-editor.tsx:87`, so the
blast radius is all three per-tenant staff surfaces, not just the one FOLLOW-600 added.

This is a Rule K.2 consumer-side violation. Neither code review nor the pm-orchestrator post-merge
audit caught it — the audit terminated at "the columns are real", which is a producer-side fact.

**Impact if not fixed:** silent, unattributed tenant config loss in production. The control-plane
auto-deploys on merge to `main`, so this is live now. There is no dialog and no error state, so a
staff user has no signal that anything was lost, and the wiped `allowed_origins` would not be
noticed until someone tries to rely on it.

**Required action:** CEO/PM priority call on FOLLOW-624. Recommend treating as P1 and fixing ahead
of the remaining P3 backlog. FOLLOW-625 (mechanise the Rule K.2 swallow check in CI) should land
with or immediately after it so the pattern cannot be copy-forwarded a fourth time.

**Resolution:** <empty until resolved>

---

## RESOLVED — ESC-040: `tenants.allowed_origins` is a security facade — the settings UI and MASTER_DESIGN both claim SDK origin enforcement that does not exist in code [FOLLOW-622]

**Filed by:** claude (session 56, post-RETRO-205) **Date:** 2026-07-23T22:00:00Z **Affects:**
FOLLOW-622, FOLLOW-600, `apps/ingest/src/router.ts:69-73`, `packages/db/src/schema/api_keys.ts:33`,
`docs/MASTER_DESIGN.md:5021` **Type:** architectural (security posture — documented control not
implemented)

**Description:** RETRO-205's CHECK B found `tenants.allowed_origins` is written by the new
FOLLOW-600 settings page and read by **nothing**. Ingest CORS is enforced from a hardcoded env list
(`apps/ingest/src/router.ts:69-73`), not from this column. Two artefacts nonetheless assert the
control is real:

- `packages/db/src/schema/api_keys.ts:33` — "null = inherit tenant allowedOrigins"
- `docs/MASTER_DESIGN.md:5021` — "Origin validated against tenant.allowed_origins config"

So a staff user can enter an origin allow-list, save it successfully, and reasonably believe they
have restricted which sites may embed the SDK for that tenant. They have not. The same finding
applies (without the security dimension) to
`tenants.brand_config.{primary_color,logo_url, white_label}` — zero consumers, no white-label logic
anywhere in `packages/sdk`, and the live brand colour is actually `quiz_config.accent_color`
(FOLLOW-623).

**Impact if not fixed:** a UI that promises a security control it does not provide is worse than no
UI, because it produces false assurance. If a tenant is ever told "origins are restricted", that
statement is currently untrue. This also has a documentation-truth dimension: MASTER_DESIGN is the
project's single source of truth and it currently overstates enforcement.

**Required action:** CEO decision on direction for FOLLOW-622 — **wire it** (make ingest CORS read
the column) or **de-scope it** (remove the control from the settings page and correct both the
`api_keys` docstring and MASTER_DESIGN §V.3.4). Either is acceptable; leaving the UI as-is is not.
Same wire-or-de-scope call needed on FOLLOW-623.

**Resolution:** RESOLVED 2026-07-26 (session 60) — **no new CEO decision was required; the decision
had already been made and shipped.** This escalation was filed 2026-07-23 and overtaken by events
one day later. Verified against the current tree at `5e66288`, not against the ticket text:

**The ruling: CEO Option B (de-scope), 2026-07-24.** Recorded in-code in two places —
`apps/control-plane/src/app/admin/tenants/[id]/settings/page.tsx:11` ("FOLLOW-622 (CEO Option B,
2026-07-24): the SDK `allowed_origins` allow-list control was de-scoped from this page — it was an
unenforced security facade") and `packages/db/src/schema/tenants.ts:53-54`.

Every "Required action" in this escalation is now satisfied — and the outcome went **both** ways,
which is why the two ticket names look contradictory:

| Required action                           | Status | Evidence                                                                                             |
| ----------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| CEO decision wire-vs-de-scope             | DONE   | Option B, 2026-07-24                                                                                 |
| Remove the control from the settings page | DONE   | FOLLOW-622 / PR #618 (`24aa860`); `sdk.allowed_origins` also removed from the `/api/config` contract |
| Correct the `api_keys` docstring          | DONE   | `packages/db/src/schema/api_keys.ts:33-42`                                                           |
| Correct MASTER_DESIGN §V.3.4              | DONE   | `docs/MASTER_DESIGN.md:5024-5029,5044` — now describes the KV projection, "NOT a hardcoded env list" |
| Same call on FOLLOW-623 / `brand_config`  | DONE   | wired, not de-scoped — `/api/quiz/public-config` serves the `brand` slice to the SDK (PR #619, #626) |

Beyond de-scoping the facade, real enforcement was then **built**: FOLLOW-642 / PR #623 (`d631a08`)
shipped `apps/ingest/src/origin-gate.ts`, which matches the browser `Origin` against the tenant's
list and returns 403 `forbidden_origin` before any ingest side effect. So the column is no longer a
facade in the read direction.

**⚠️ Closing this escalation does NOT make origin enforcement effective, and unblocks nothing.** Two
things must not be mistaken for done:

1. **The write path does not exist.** A repo-wide grep confirms **zero** writes to `KV_API_KEYS`
   anywhere (`.put(` exists only for `KV_IDEMPOTENCY` and Durable Object storage). The gate reads a
   KV record that no in-repo code produces, so enforcement silently inherits the env allow-list for
   every tenant until an operator seeds KV by hand. That is FOLLOW-658 (P1, still OPEN).
2. **The corrected docstrings introduced a _new_ over-claim.** `tenants.ts:40-41` and
   `api_keys.ts:38-41` state the column "is projected onto the api-key KV record **at
   provisioning**" — describing an automatic step that is not implemented (Rule M
   false-automation-claim axis). This is exactly FOLLOW-658 AC3, and it is now the _second_
   generation of the same documentation-truth defect this escalation was opened about.

**Correction to the session-60 hand-off:** FOLLOW-658 was reported as "blocked on ESC-040". It is
not and never was — its stub carries `depends_on: []`, and the overlap with ESC-040 is confined to
AC3. FOLLOW-658 is dispatchable immediately; ESC-040 was never the constraint. The remaining
external-brand go-live gate is FOLLOW-658 + FOLLOW-659, not this escalation.

---

## OPEN — ESC-041: the `Release` workflow has failed on every run for days (`@estalara/sdk` → E403) with zero record in any backlog file [FOLLOW-626]

**Filed by:** claude (session 56, post-RETRO-205) **Date:** 2026-07-23T22:00:00Z **Affects:**
FOLLOW-626, `@estalara/sdk` publish path, repo CI gate credibility **Type:** other (ops — dead
release pipeline + gate-hygiene precedent)

**Description:** RETRO-205's cascading-impact sweep surfaced a second permanently-red workflow
beyond the long-known `Rule I`. I verified independently via `gh run list --workflow=Release`: the
last 8 runs are `failure`, back to 2026-07-22, failing on `@estalara/sdk` publish with
`E403 owner not found`. No backlog file — QUEUE, FOLLOW_UPS, ESCALATIONS, RETROSPECTIVES — has ever
mentioned it. It has been failing unnoticed.

This is the concrete cost of the normalized-deviance pattern RETRO-205 promoted to **Rule AF**
(permanently-red gate = disabled gate; a "known red" waiver must be a baseline comparison, not a
label). `Rule I` has now been red 191 times and `main`'s aggregate `CI` conclusion is `failure` on
every push — which is precisely why a _newly_ dead workflow could go days without anyone noticing. I
applied that same "pre-existing red, non-blocking" reasoning twice in this session to clear the #607
and #606 merges; the reasoning happened to be correct both times, but it is not a safe default.

**Impact if not fixed:** the SDK release path is dead — any assumption that a merged SDK change has
been published is currently false. More broadly, while the aggregate CI conclusion is permanently
red, no future breakage can be detected by looking at whether CI is green.

**Required action:** CEO/PM call on FOLLOW-626 (fix or quarantine the `Release` workflow — the E403
suggests an npm org/ownership or token problem that likely needs a human with registry access), and
on whether to schedule the `Rule I` cleanup so the aggregate signal becomes meaningful again. Also
related: FOLLOW-628 (unpinned `pip install` in `modal-deploy.yml` under a `production` environment —
same class of latent upstream risk as the `:latest` ClickHouse tag that broke CI repo-wide this
session) and FOLLOW-629 (CI↔prod ClickHouse version-skew detection, so the FOLLOW-620 pin's hidden
expiry fires loudly).

**Resolution:** <empty until resolved>

---

## OPEN (narrowed) — ESC-042: Modal `intent-engine` deploy is the sole remaining chat-un-shadow blocker — design ruling (item 2) RESOLVED 2026-07-27 [FOLLOW-635]

**Filed by:** ml-engineer (FOLLOW-635) **Date:** 2026-07-24T00:00:00Z **Affects:** FOLLOW-635, chat
NLP intent path (`apps/intent-engine`, `apps/ingest/src/handlers/chat-nlp-dispatch.ts`,
`apps/control-plane/src/app/api/adapt/route.ts`, `packages/sdk/src/core/{adapt,intent}.ts`), Modal
Phase B (ESC-036 residual / FOLLOW-458) **Type:** priority (deploy/enablement) + architectural (one
design ruling)

**Description (Phase-1 scope, with file:line evidence):**

The read path is already fully wired AND the chat signal already reaches the adaptation DECISION —
via the SDK client prior loop, not a server-side fusion:

1. `apps/control-plane/src/app/api/adapt/route.ts:1508-1535` reads the shadow key and `:1563`
   attaches `chat_intent_dimensions` to the response UNCONDITIONALLY (no `CHAT_NLP_LIVE` gate on
   emission).
2. `packages/sdk/src/core/adapt.ts:863-888` calls `applyChatIntentPrior(intentState, dims)` on
   receipt; `packages/sdk/src/core/intent.ts:1353-1403` performs a REAL multiplicative Bayesian
   update that changes `intentState.archetype`/`probabilities` (§D.7: chat weight == quiz weight),
   and persists it to sessionStorage.
3. `packages/sdk/src/core/adapt.ts:761` then sends `body.archetype_hint = intentState.archetype` on
   the NEXT adapt call, and `route.ts:1289` sets `archetypeId = body.archetype_hint ?? 'neutral'` —
   which drives `runDecisionTree` (headline/description) and `buildReorderDirective` (reorder).

So: server-side WITHIN one request, `chat_intent_dimensions` is metadata only; ACROSS requests it
influences directives via the client loop. This is already un-gated by `CHAT_NLP_LIVE` — that flag
(`route.ts:100`) is vestigial: it appears only in a `console.info` line (`:1521`), gates no
directive logic, and its docstring (`:89-99`) claims a server-side fusion that does not exist. The
fusion policy is therefore already DEFINED and implemented; no new fusion weight needs inventing.

**Why it is nonetheless DARK in prod today (the actual blocker):** the write path is not deployed.
`.github/workflows/modal-deploy.yml` deploys ONLY `apps/llm-gateway`; intent-engine is explicitly
"added as Phases B/C go live" (ESC-036 residual, FOLLOW-458). With no `estalara-intent-engine` Modal
app running, `chat_nlp_endpoint` does not exist, `MODAL_CHAT_NLP_URL` in the ingest Worker is a
configured no-op (`apps/ingest/src/handlers/chat-nlp-dispatch.ts:58-61`), the shadow key is never
written, `readShadowChatIntent` always returns null, and `applyChatIntentPrior` never fires. This
matches the 2026-07-12 audit ("chat feeds zero live archetype signal"). §H.9 opt-out is preserved
end-to-end (`redis_writer.py:55` skips the write; null key → null read → no prior).

**Required action:**

1. OPERATOR/DEVOPS (Modal Phase B — unblocks the pilot): (a)
   `modal deploy apps/intent-engine/src/main.py` (add it to `modal-deploy.yml` `paths`/jobs so it
   can't drift); (b) confirm `estalara-secrets` contains `INTERNAL_API_SECRET` +
   `UPSTASH_REDIS_REST_URL/TOKEN` pointing at the SAME Upstash the control-plane reads via
   `UPSTASH_REDIS_URL/TOKEN`; (c) set `MODAL_CHAT_NLP_URL` (+ matching `INTERNAL_API_SECRET`) in the
   ingest Worker prod env to the deployed `chat_nlp_endpoint` URL. After that, chat goes live for
   the pilot through the existing client prior loop — no code change.

2. CEO/PM DESIGN RULING on `CHAT_NLP_LIVE` and the latent "shadow-hole": because the client loop is
   un-gated, once the write deploys chat influences decisions REGARDLESS of `CHAT_NLP_LIVE`. For a
   single first-party tenant (Estalara, DPIA not a blocker) this is the DESIRED behavior. Choose:
   (A) Accept the client-loop as the live path; DELETE the vestigial `CHAT_NLP_LIVE` flag and
   correct the now-false "shadow-only / zero UX effect / purely behavioural" docstrings in
   `apps/intent-engine/src/{main,redis_writer}.py`, `route.ts:89-99`, and `adapt.ts:859-862` (small
   ml-engineer PR; also update the FOLLOW-346 test contract). OR (B) additionally build a
   server-side fusion path (fuse chat dims into `archetypeId` within the request, independent of the
   SDK) — a NEW decision-influence path requiring a product decision on the server fusion weight of
   chat vs the incoming behavioral `archetype_hint`; ml-engineer will NOT guess that weight.
   Recommendation: (A) — the client loop already delivers chat influence with the §D.7 policy; (B)
   is only needed for non-SDK consumers or first-request effect.

I did NOT open a code PR: there is no mechanical ml-code change that un-shadows (the code is already
wired; enablement is the deploy). The docstring/flag cleanup is deferred pending the (A)/(B) ruling
so it lands atomically with the chosen direction.

**Resolution (partial — item 2 only):** **RESOLVED 2026-07-27 — CEO ruling: Option (A).** Accept the
client prior loop as the live path; delete the vestigial `CHAT_NLP_LIVE` flag and correct the
now-false "shadow-only / zero UX effect / purely behavioural" docstrings; update the FOLLOW-346 test
contract to match. **Option (B) server-side fusion is explicitly NOT approved** — not to be built,
no fusion weight to invent.

**Verified-not-guessed before acting on this ruling:** re-read the actual repo state rather than
assuming the ruling described undone work. **All of item 2 was already shipped 2026-07-24, three
days before this ruling landed** — `ml-engineer` (Opus) scoped and built it same-day as this
escalation was filed, per `backlog/QUEUE.md` session-57 head and `backlog/FOLLOW_UPS.md` FOLLOW-635:

- PR #613, squash-merged `5ab923b` (2026-07-24T15:24:37+02:00,
  `chore(intent): remove vestigial CHAT_NLP_LIVE flag, fix shadow-only docstrings [FOLLOW-635] (#613)`).
- `grep -rn CHAT_NLP_LIVE` across the live tree returns **zero** occurrences outside
  backlog/docs/comments narrating its removal and one `packages/shared/src/directives.ts:174`
  docstring that correctly describes it as removed — no `process.env.CHAT_NLP_LIVE` read remains
  anywhere in `apps/control-plane`, `apps/intent-engine`, or `packages/sdk`.
- Docstrings independently re-read at `apps/control-plane/src/app/api/adapt/route.ts:1559-1573` and
  `packages/shared/src/directives.ts:160-181`: both now correctly state the field is
  live-influencing (not shadow-only), attached unconditionally, with no server-side gate, and that
  the ONLY remaining blocker is the ESC-042 Modal deploy (item 1 below) — an honest,
  non-overclaiming description.
- `apps/control-plane/src/app/api/adapt/route.follow346.test.ts` exists and its `describe` block
  (`FOLLOW-346 / FOLLOW-635: chat-intent shadow-read bridge (no CHAT_NLP_LIVE gate)`) asserts the
  new unconditional-attach behavior — the FOLLOW-346 test contract update this ruling asked for is
  done.

**No new ml-engineer ticket dispatched for item 2** — there is nothing left to build; the ruling
formalizes work already merged. If a docstring/test gap is found on a future audit, re-open as a
fresh, separately-numbered ticket rather than reusing this closed item.

**Item 1 (Modal Phase B operator deploy) stays OPEN, narrowed scope, re-titled above.** This is now
a pure operator/devops task — `modal deploy apps/intent-engine/src/main.py`; confirm
`estalara-secrets` has `INTERNAL_API_SECRET` + Upstash REST creds pointing at the SAME Upstash the
control-plane reads; set `MODAL_CHAT_NLP_URL` (+ matching secret) in the ingest Worker prod env — no
agent in this pipeline can execute it. Per 2026-07-27 dispatch-policy ruling (same treatment as
ESC-020): **treated as non-blocking-for-dispatch**, kept OPEN, and surfaced in every session close
until an operator runs the deploy and confirms live (chat_intent shadow key populated end-to-end).

---

## OPEN — ESC-044: the consent gate's "canonical" hash is a hand-typed placeholder — the fabrication refusal it exists to fire cannot fire, and every default-path consent record since go-live attests a text that was never displayed [FOLLOW-704 / FOLLOW-706]

**Filed by:** claude (session 69, post-RETRO-227) **Date:** 2026-07-27T21:00:00Z **Affects:**
FOLLOW-704 (P0), FOLLOW-706 (P1, operator-gated),
`apps/control-plane/src/app/api/v1/consent/platform-registration/lib.ts:51-52`,
`docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §6.1, prod `consent_records` **Type:** compliance /
security

**Description:** `CANONICAL_CONSENT_TEXT_HASH` — the constant this session's own two merges (PR #631
FOLLOW-684, PR #632 FOLLOW-697/698) just spent building an evidence-keyed, tri-state refusal gate
around — is not a SHA-256 digest of anything. RETRO-227 proved this three independent ways: the hex
pattern is a hand-typed sequence (first nibble of every byte cycles `a,f,e,d,c,b,a` exactly 32
times), 60 normalizations of both candidate source texts (the doc's §6.1 block and the server-side
`renderPlatformConsentText()` output) hash to none of it, and `git log -S` shows it unchanged since
introduction in `f810f72e` (FOLLOW-374, 2026-06-21). I independently re-derived the real hash myself
before filing RETRO-227's dispatch (computed `821216cd2cca…` for the rendered Estalara text) and
flagged the pattern; the retro's own script work confirmed it and found the second candidate (the
doc's raw bytes hash to a third, different value: `201c5b326baa…`) — so even the two plausible
"correct" answers disagree with each other, not just with the constant.

**Two live consequences, why this needs a CEO/DPO ruling rather than a queue ticket alone:**

1. **The refusal this repo just finished hardening cannot fire against a real fabricator.** The 422
   in `route.ts` fires iff `submitted hash === CANONICAL_CONSENT_TEXT_HASH`. A brand that actually
   copies Estalara's displayed text (rendered or the published doc) and hashes it submits one of the
   two REAL values above — both land in the alert-only, write-proceeds branch. The only way to trip
   the refusal is to copy the placeholder literal out of this repo's source, which no legitimate or
   adversarial caller would ever do. FOLLOW-659 → 660 → 684 → 697/698 is four merged PRs building a
   gate whose one hard-refusal case is unreachable by the threat it names.
2. **Every consent record written on the default path since 2026-06-21 stores a hash of no text.**
   `route.ts:703` defaults to the placeholder when the caller omits `consent_text_hash`, and
   `backlog/HANDOFFS.md:2842` instructs the only caller (app.estalara.com) to omit it — that is the
   documented go-live flow. GDPR Art. 7(1) requires the controller to be able to demonstrate consent
   was given to a specific text; a hash that is the digest of nothing demonstrates nothing.

**Why this is escalated rather than left as a queue ticket:** FOLLOW-706's own AC says it plainly —
_"the PM escalates; this ticket does not self-escalate."_ This is a compliance-posture question
(whether existing prod consent records are Art. 7(1)-adequate, and if not, what remediation —
backfill, annotate, re-consent, or accept-with-rationale) that CLAUDE.md reserves for the human. It
also has a regulatory clock shape similar to ESC-037 (four ClickHouse PII tables
erased-but-undisclosed): unlike that case, prod exposure here has **not yet been counted** —
FOLLOW-706 AC-1 is exactly that count and is UNRUN as of this filing. **Do not assume live exposure
or its absence; the number needs to be pulled before scoping remediation.**

**Two coordinated code-fix follow-ups, filed but not escalated (queue tickets, not this item):**
FOLLOW-705 (compliance-engineer, P1 — decide which source text is byte-canonical for hashing: the
doc or the renderer; they currently disagree at two placeholder substitutions, independent of the
hash-constant defect) must land before FOLLOW-704 can pick final bytes; FOLLOW-704
(backend-engineer, P0) then makes the constant derived-not-asserted and closes the
unreachable-refusal gap; FOLLOW-707 (P1, a second omitted-hash bypass on the provisioned-brand
branch #632 shipped) is adjacent but independently fixable.

**Required action (CEO / DPO):**

1. **Run FOLLOW-706 AC-1 first** (or authorize an operator to): count prod `consent_records` rows
   where `consent_text_hash` equals the placeholder value
   (`a3f2e1d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2`), split by `consent_type`,
   `tos_version`, date range. A zero result (the app.estalara.com caller may never have gone live on
   this endpoint) closes the prod-remediation axis cheaply — do not assume either way pending the
   count, per the ESC-037 precedent where an assumed-live gap turned out to have zero exposure.
2. **Rule on FOLLOW-705**: is the DOC's §6.1 block or the server-rendered text the byte-canonical
   source for the hash? (The doc is what a regulator reads; the renderer is what the data subject
   actually saw — they currently diverge at two bracket-placeholder substitutions.)
3. **If prod rows exist, rule on FOLLOW-706's Art. 7(1) remediation options**: (a) backfill the
   recomputed hash plus a provenance/annotation column recording the reconstruction, (b) annotate
   without backfilling, (c) re-consent the affected subjects, (d) accept with a recorded rationale.
   No option is recommended here by omission — pick one and record why.
4. **Sequencing**: FOLLOW-705 → FOLLOW-704 (code fix, stops new void records) can proceed on an
   engineering track once item 2 is ruled; FOLLOW-706 (prod remediation) is gated on items 1 and 3
   and does not block 704/705.

---

**Update 2026-07-28 (session 74, post-RETRO-228 / PR #633):**

**Item 2 has a recorded answer, not yet your sign-off.** FOLLOW-705 merged (`47e863c6`) with
compliance-engineer ruling the server renderer (not the doc) byte-canonical, on the grounds that
§6.1 is hardcoded to the Estalara identity (undefined for white-label brands) and Art. 7(1) is about
what the subject actually read. Reasoning and code are in PR #633. Treating this as answered unless
you override it — flagging here since this item was originally routed to you.

**New item 4, filed per FOLLOW-710's own AC-3** ("the PM escalates; this ticket does not
self-escalate") — **bundle into the SAME DPO round as items 1 and 3, not a separate conversation**:

RETRO-228 (following #633) investigated the consent text's withdrawal instruction — _"you can
withdraw this consent at any time by contacting the agency's DSR contact"_ — and found there is no
mechanism for a data subject to act on it, not merely a missing address:

- `POST /api/dsr/initiate` is JWT-gated to **tenant staff** — a data subject cannot call it
  directly; an agency admin must act on their behalf, and there is no public DSR-request page.
- The consent route itself has no withdrawal endpoint (GET + POST only).
- The DPIA's own documented intake procedure (`dpia.md` §8 step 3) names `POST /api/v1/dsr/request`
  — **this route does not exist anywhere in the repo.**
- The §6.3 DOM opt-out is explicitly not withdrawal (already documented as such in `HANDOFFS.md`).

Every investor who has registered since 2026-06-21 (FOLLOW-374 go-live) has been told a specific,
concrete way to withdraw consent that does not exist. This is GDPR Art. 7(3) (withdrawal must be as
easy as giving consent) and Art. 13(1)(a)–(b) (contact details required) territory — filed as
**FOLLOW-710** (P1). A related but lower-severity sibling, **FOLLOW-711** (P2, latent on the current
single-tenant model, live the day a second brand registers): the same text hardcodes an Estalara
mailbox as every white-label brand's own privacy-documentation contact, contradicting a sibling
docblock about per-brand configurability. Both explicitly need to ride the **same text-change /
`PLATFORM_REGISTRATION_TOS_VERSION` bump** as FOLLOW-706's remediation and the existing FOLLOW-145
(SDK consent-banner withdrawal, same right, different surface, already OPEN P2) — RETRO-228's own
recommendation is one DPO round covering FOLLOW-706 + FOLLOW-710 + FOLLOW-711 + FOLLOW-145, not four
separate conversations.

**Required action (CEO / DPO), added to the existing three:**

5. **Rule on FOLLOW-710's withdrawal-channel options**: (a) name a concrete monitored DSR mailbox in
   the text and stand it up, (b) build a subject-facing withdrawal affordance in the
   registration/account surface and name it, (c) keep the mediated (staff-initiated) model but
   render each tenant's own DSR contact from `brand_config` so the text names a real, brand-correct
   address, (d) accept the current mediated/staff-only model with a recorded rationale — no option
   recommended by omission.
6. **Rule on FOLLOW-711's white-label contact**: per-brand contact from `brand_config` (fail-loud if
   unprovisioned, same pattern as `brand_name`/`legal_entity`), or an
   explicitly-Estalara-as-processor sentence that doesn't pretend to be the brand's own contact.
7. **Take the FOLLOW-706 / item-1 prod row count BEFORE any text bump lands** — the population being
   counted/remediated shifts the moment `PLATFORM_REGISTRATION_TOS_VERSION` changes.

**Resolution:** — awaiting CEO/DPO ruling (items 1, 3, 5, 6; item 2 stands unless overridden).

**Resolution:** — awaiting CEO/DPO ruling.

---

## OPEN — ESC-045: the local chat-NLP shim fails GREEN on a missing Anthropic key — it returns 202 and writes a neutral archetype, and four records name the wrong cause [FOLLOW-729 / FOLLOW-730]

**Filed by:** claude (session 79, post-RETRO-233) **Date:** 2026-07-29T16:00:00Z **Affects:**
Piotr's standing "100% end-to-end on localhost" priority, FOLLOW-729 (merged, PR #641), FOLLOW-730
(P2), `apps/intent-engine/src/nlp.py:318-332`, `apps/intent-engine/src/redis_writer.py:35` **Type:**
operator / credentials + falsified record

**Description:** two things, one of which is my own error.

**(1) The credentials gap itself.** No dev-tier Anthropic key and no dev Upstash instance are
provisioned, so the merged `local_dev.py` cannot actually run the chat → intent → archetype loop end
to end. FOLLOW-729's own AC5 pre-authorised escalating this ("escalate the credentials gap
separately if needed"), and Rule AA says an operator-gated ticket is not DONE on code alone. It
blocks a CEO-stated product priority, so it is escalated here rather than left as prose in
`QUEUE.md`.

**(2) The recorded cause was wrong, and the real failure mode is worse.** The PR body, the
`README.md` section, `QUEUE.md` and the `FOLLOW_UPS.md` stub all state that an authenticated POST
500s on the missing `ANTHROPIC_API_KEY`. It does not. RETRO-233 falsified this and I re-verified it
directly: `extract_intent` is documented **"Never raises"** and swallows every Anthropic failure
(`nlp.py:325-332` — prints, then returns the neutral payload); the 500 I observed actually came from
`redis_writer._get_redis` raising `KeyError('UPSTASH_REDIS_REST_URL')` (`redis_writer.py:35`),
because in my smoke run BOTH credentials were absent and Redis raised first. The log line I quoted
as the cause was a swallowed-error print, not the raise.

**Why that matters operationally:** provision Upstash first (the harder credential) and leave the
Anthropic key unset, and the shim returns **202, writes the shadow key, and records
`archetype_hint: neutral, confidence: 0.0, all dimensions null`**. The wire looks healthy. That is
indistinguishable at a glance from a writer/reader Upstash database mismatch — the _other_ silent
failure on this same path — and both present exactly as "chat isn't affecting the archetype", which
is the highest-cost false-bug trail on this loop. Blast radius is bounded (RETRO-233 checked:
`flattenIntentDimensions` drops nulls → `{}` → `adapt.ts:869-880` skips the prior, so no archetype
poisoning and Rule R is not burned) — the damage is diagnostic time, not corrupted state.

**Decision needed from Piotr (CEO/operator):**

1. Provision an `ANTHROPIC_API_KEY` and an Upstash instance for local dev — and set BOTH before the
   first run, since a partial provision fails green.
2. Confirm the Upstash env-pair parity (`UPSTASH_REDIS_REST_URL`/`_TOKEN` for the writer vs
   `UPSTASH_REDIS_URL`/`_TOKEN` for the control-plane reader must address the SAME database, per
   `docs/runbooks/upstash-redis-env-parity.md`).
3. Whether FOLLOW-730 (make the neutral-payload fallback distinguishable from a real neutral buyer)
   should be pulled forward ahead of the remaining P2/P3 stubs, since until it lands the green-wire
   ambiguity above stays live.

**Not blocked on:** ESC-042 item 1 (prod Modal deploy) — unrelated, still open, local-only scope.

**Added 2026-07-30 (second `/code-review` round on PR #642) — item 4, Rule AJ half-wire.**
FOLLOW-730 wires extraction failures to Sentry, but **`SENTRY_DSN` is not provisioned** in Doppler
`prd` or in the Modal `estalara-secrets` secret (`docs/runbooks/MODAL_PROD_STANDUP.md` records that
prd is missing every Modal runtime secret). `_capture_extraction_error` returns early when the DSN
is unset, so in the deployed container every capture added by that PR is a no-op. The code is wired
and tested; the channel is absent. **Consequence:** a model outage in prod still produces a silent
all-null archetype run — the only surviving signals are a container stdout line and the
`extraction_error` field inside a 24h-TTL Redis key that no dashboard, alert rule or TS reader
surfaces. **✅ RESOLVED 2026-07-30 — `SENTRY_DSN` is now SAFE to provision.** FOLLOW-738 merged (PR
#644, `479ac0ef`): all three Python Modal apps now initialise Sentry through one shared, hardened
`init_sentry` helper (`include_local_variables=False`, `send_default_pii=False`,
`default_integrations=False` + explicit atexit), and `scripts/check-sentry-init-singleton.sh` is a
CI gate that fails the build on any raw `sentry_sdk.init(` outside `observability.py`. Verified on
`main` after merge: the gate passes and all four Rule J mirror pairs are in sync. **The warning
below is kept for the record, struck through — it was correct until PR #644 merged and is now
historical.**

~~**⚠️ CORRECTION 2026-07-30 (RETRO-234 HW-3) — DO NOT PROVISION `SENTRY_DSN` YET.**~~ The advice
originally written here (and given to Piotr twice in session) was to provision the DSN alongside the
other ESC-045 credentials. That is now known to be unsafe. All three Python Modal apps read the
**bare** `SENTRY_DSN` name and mount the **same** `modal.Secret.from_name("estalara-secrets")`:
`apps/intent-engine/src/nlp.py` (hardened by PR #642),
`apps/llm-gateway/src/jobs/consume_embed_seed_requests.py:193,393` and
`apps/data-quality/src/crons/schema_validation.py:352-357`. **Neither of the latter two sets
`include_local_variables=False`, `send_default_pii=False` or `default_integrations=False`** — so
they would ship frame locals, and via the default `LoggingIntegration` every `logging.error`, as
Sentry events. Provisioning the one secret this ticket asks for therefore silently switches on two
producers that lack the exact control PR #642 spent a whole review round adding. `.env.example:70`'s
comment ("all services share one org, separate projects") is already false for the Python tier.

**⚠️ CORRECTION 2026-07-31 — item 1 ("no dev-tier Anthropic key") IS FALSE, and it was my error.**
Verified by direct query during FOLLOW-736 validation (names and value-shapes only, never values):
Doppler project `estalara-adaptive-listings` holds `ANTHROPIC_API_KEY` in **all three** configs
`dev` / `stg` / `prd`, all 108 chars, all `sk-ant-` shaped, and **all three are byte-identical**.
The ml-engineer proved that value live during FOLLOW-736 (a real Haiku extraction returned
`feature_priority: "4_bedrooms"`, a token in no fixture in this repo). So a working key is readable
today with `doppler secrets get ANTHROPIC_API_KEY -c dev --plain` — **nothing needs provisioning.**
This escalation asserted the opposite from the day it was filed and I repeated it to Piotr twice.

**Item 2-3 (Upstash) — still genuinely absent from Doppler** (`UPSTASH_*` appears in NO config), but
FOLLOW-736's verification demonstrated a path that needs no cloud provisioning either: a local
`redis:7-alpine` behind `hiett/serverless-redis-http` is a working Upstash-REST-compatible endpoint.
Point BOTH the writer's `UPSTASH_REDIS_REST_URL`/`_TOKEN` and the control-plane reader's
`UPSTASH_REDIS_URL`/`_TOKEN` at that one local shim and the env-pair parity requirement is satisfied
by construction — the mismatch hazard this escalation warns about cannot occur when there is one
endpoint. That reduces the remaining operator work for the "100% on localhost" goal to starting two
containers.

**`SENTRY_DSN` — confirmed absent from all three configs**, consistent with FOLLOW-744.

**New risk surfaced by the same query, unrelated to this escalation's original scope:** `dev`, `stg`
and `prd` share ONE Anthropic key value. A local developer run is therefore indistinguishable from
production in billing and rate limits, and the key cannot be rotated for dev without breaking prod.
Filed as FOLLOW-750 (P3) for Piotr's judgement; not blocking anything here.

**Decision needed (updated after FOLLOW-738 merged):** option (a) is done — provision `SENTRY_DSN`
into the Modal `estalara-secrets` secret whenever convenient; the hardening it was waiting on is on
`main` and CI-guarded. Items 1-3 (Anthropic key, Upstash instance + env-pair parity) are unaffected
and remain the actual blockers on the "100% on localhost" goal.

**CORRECTION 2026-07-30 (session 83, per RETRO-235 §3 HW-2 / §4d DG-1) — item 4's "RESOLVED" framing
above conflated two distinct legs; only one is closed.** Item 4, in its own original words, named
two legs: (a) the hazard — provisioning `SENTRY_DSN` would silently activate two unhardened Sentry
producers; (b) the absent channel — _"the code is wired and tested; the channel is absent"_ (no
producer exists in prod for any of the four call sites, DSN or no DSN). **FOLLOW-738 (PR #644)
closed leg (a) only.** The "✅ RESOLVED" line above, and this session's own earlier `QUEUE.md`/
`STATUS.md` entries which repeated "items 1-3 remain the ONLY open blockers", both over-read that as
closing leg (b) too. It did not: `SENTRY_DSN` is still absent from Doppler `prd` and from the Modal
`estalara-secrets` secret (`docs/runbooks/MODAL_PROD_STANDUP.md:17`) — nothing changed on the
producer side, only the hazard of provisioning it did. **Leg (b) is now correctly tracked as
`backlog/FOLLOW_UPS.md` → `## FOLLOW-744`** (filed by RETRO-235, since RETRO-234's original note —
"NO new stub — already owned by ESC-045 item 4" — lost its owner when item 4 was marked resolved).
This escalation stays `## OPEN` (not re-opened as blocking-for-dispatch; it was never closed to
begin with) — this note only corrects the record, it changes no decision and requires no new
operator action beyond what FOLLOW-744 already asks for.
