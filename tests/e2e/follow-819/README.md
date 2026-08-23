# FOLLOW-819 — differentiator E2E on localhost

**behavioral trace → ingest → intent → adapt → DOM → measured lift**, as one scripted session with
six independently-checkable acceptance criteria.

This is the test `§Snapshot.5` names in its own words — _"Critical gap: no end-to-end test of intent
→ archetype → adapt → DOM"_ — and it is FOLLOW-820's condition 1.

> **This test is allowed to fail.** A red AC(1)/AC(2) is a successful outcome. It is the first real
> measurement this product has taken, and calibration (FOLLOW-212) depends on knowing the true
> starting number rather than assuming one. Do not tune the fixture until it passes.

---

## 0. Execution status — READ THIS FIRST (Rule Q)

|                                      |                                                                 |
| ------------------------------------ | --------------------------------------------------------------- |
| **Harness**                          | Written, committed, reviewable.                                 |
| **Executed end-to-end?**             | **NO — not in the authoring session.**                          |
| **AC(6) branch taken**               | Documented manual runbook (§3), **explicitly labelled MANUAL**. |
| **Evidence pasted from a real run?** | **NONE YET.** §5 is empty on purpose.                           |

**Why it was not executed.** The authoring worker's sandbox could not bring the substrate up:
`docker run` is not permitted (read-only `docker ps` works, and every required image is already
present locally), there is no outbound network, and the worktree has no `node_modules`. That is a
permission boundary of the worker sandbox, not a property of the environment — a session with
container permissions can run §3 as written.

**This is stated plainly rather than papered over.** Under Rule Q a soft-skip must not masquerade as
a pass, and under this repo's own history a green test over a dead wire is the single worst artifact
we can produce (FOLLOW-097→114→127→141). **FOLLOW-819's ACs are therefore NOT discharged by this
PR.** What this PR delivers is the instrument plus the statically-verified findings in §4 — and §4
already changes the shape of two ACs.

The harness is deliberately **not** a `*.spec.ts`. A discoverable spec would be collected by a CI
runner and reported as a SKIP that reads as a pass. It is an `.mjs` script that hard-fails on an
absent substrate and exits non-zero.

---

## 1. What it asserts

Each AC is recorded independently — one red does not mask the others.

| AC      | Assertion                                                                                                                                                    | Guarded against                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **(1)** | Non-neutral archetype, `confidence` **strictly >** the server `CONFIDENCE_THRESHOLD`, **and** `directives.length > 0`, on the **real** `/api/adapt` response | The threshold is read out of `route.ts` **at run time**, value _and_ comparison operator, so it cannot drift away from the gate that actually decides (FOLLOW-875) |
| **(2)** | An observably adapted DOM — a `[data-estalara-slot]` text actually changed                                                                                   | Distinct from (1): the only assertion that catches directives that arrive but are never painted                                                                    |
| **(3)** | An `adaptation_decisions` row for this session carrying the FOLLOW-560 scoring path                                                                          | Tells real cosine ranking from a stable djb2 hash shuffle                                                                                                          |
| **(4)** | A feedback-driven `ab_bandit_weights` Beta delta                                                                                                             | Polls Postgres for the real state change; a 202 alone is never accepted                                                                                            |
| **(5)** | A lift number from real substrate rows via the **existing** analytics path                                                                                   | **Asserts `data_source === 'clickhouse'` first** — see §2                                                                                                          |
| **(6)** | Runs in CI, or a documented manual runbook with pasted evidence labelled MANUAL                                                                              | §0 + §3 + §5                                                                                                                                                       |

## 2. The assertion that matters most, and why

`getPlatformAnalyticsRollup()` falls back to `buildMockRollup()` when either store is unconfigured,
and that mock **fabricates a lift with `seededRandom()`**
(`apps/control-plane/src/app/api/admin/analytics/rollup/data.ts`).

So an AC(5) that asserted _"`ctaLift` is a number"_ would go **green against a completely dead
wire** — the exact failure class this repo has shipped four times. AC(5) therefore asserts the live
discriminator **before** it looks at the number, and treats `'mock'` as RED however plausible the
value looks.

> **The live value is `'clickhouse'`, not `'live'`.** `data_source` is typed
> `'clickhouse' | 'mock'`; only the secondary `scoring_path_source` / `quiz_data_source` fields use
> the literal `'live'`. The first draft of this harness asserted `=== 'live'`, which would have
> pinned AC(5) permanently RED for the wrong reason. A false red misleads exactly as much as a false
> green — it reports a dead analytics wire on a perfectly live substrate — and it was caught only by
> reading `data.ts` instead of assuming the field's vocabulary.

The same discipline governs AC(1). The quiz arm drives the **real quiz widget through real DOM
clicks**, so the confidence is _produced_ by the production intent path. Injecting an archetype or a
confidence would make AC(1) a green over a dead wire (RETRO-009 / RETRO-011).

And the whole run is gated by `assertRealControlPlane()`, which refuses the `:9100` mock decision
harness outright — the standing trap named twice in this backlog.

---

## 3. MANUAL runbook

> **Every command below is UNVERIFIED-BY-EXECUTION in the authoring session** (§0). They are
> transcribed from `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §3.5 / §3.6 / §3.8, which _were_
> executed by their authors. Treat a deviation as a finding.

### 3.1 ClickHouse + the FOLLOW-560 column

```bash
docker run -d --name estalara_ch_local -p 8123:8123 \
  -e CLICKHOUSE_USER=default -e CLICKHOUSE_PASSWORD=clickhouse \
  clickhouse/clickhouse-server:25.8

LOCAL=1 CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_PASSWORD=clickhouse \
  ./infra/clickhouse/scripts/migrate.sh
```

### 3.2 Control-plane Postgres

```bash
docker run -d --name al_pg_local -p 5433:5432 -e POSTGRES_PASSWORD=postgres \
  public.ecr.aws/supabase/postgres:17.6.1.134
docker logs -f al_pg_local 2>&1 | grep -m2 'database system is ready to accept connections'

export DATABASE_URL_ADMIN='postgresql://supabase_admin:postgres@127.0.0.1:5433/postgres'
pnpm db:bootstrap:local && pnpm db:migrate && pnpm seed:local-tenant
```

A migrate/seed run that appears to hang on an older checkout is finished work with an unclosed pool
— read the last log line, not the exit code (fixed in PR #826).

### 3.3 SDK bundle + static fixture server

```bash
pnpm --filter @estalara/shared build && pnpm --filter @estalara/sdk build
doppler run -p estalara-adaptive-listings -c dev -- node scripts/dev/mock-decision-server.mjs  # serves the bundle on :9100
npx serve -l 9200 tests/e2e/follow-819    # serves fixture-listing.html
```

The `:9100` process is used **only** as a static host for `estalara-sdk.iife.js`. The fixture's
`data-decision-url` points at `:3000`, and the harness hard-fails if it resolves to the mock.

### 3.4 The REAL control plane

```bash
cd apps/control-plane
FEEDBACK_ENDPOINT_ENABLED=true \
ADAPT_API_KEY=local-follow819-key \
ADMIN_API_SECRET=local-follow819-admin-secret \
OPS_TENANT_ID=00000000-0000-0000-0000-0000000000e2 \
DATABASE_URL_ADMIN="$DATABASE_URL_ADMIN" \
SCORING_PATH_COLUMN_ENABLED=true \
CLICKHOUSE_URL=http://localhost:8123 \
CLICKHOUSE_USER=default CLICKHOUSE_PASSWORD=clickhouse \
  doppler run -c dev -- pnpm dev
```

`ADAPT_API_KEY` and `ADMIN_API_SECRET` are **two different credentials** and the harness needs both:
`ADAPT_API_KEY` is the ADR-0015 ops bypass for `/adapt` + `/adapt/feedback` (AC(4)), while the AC(5)
rollup route is staff-gated by `verifyTracerAdminAuth`, whose Bearer path compares against
`ADMIN_API_SECRET`. Passing the adapt key to the rollup route 401s — a false RED.

`SCORING_PATH_COLUMN_ENABLED=true` is **load-bearing for AC(3)**: without it `logDecisionAsync`
omits `scoring_path` from the INSERT entirely and AC(3) reads a column the writer never wrote.
`CLICKHOUSE_*` and `DATABASE_URL_ADMIN` are **load-bearing for AC(5)**: without both,
`getPlatformAnalyticsRollup()` returns the `seededRandom` mock and AC(5) is RED by design.

### 3.5 Ingest Worker

Per `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §3.6 (KV api-key seed, then `wrangler dev` on :8787).

### 3.6 Run

```bash
DATABASE_URL_ADMIN="$DATABASE_URL_ADMIN" \
ADAPT_API_KEY=local-follow819-key \
ADMIN_API_SECRET=local-follow819-admin-secret \
OPS_TENANT_ID=00000000-0000-0000-0000-0000000000e2 \
  node tests/e2e/follow-819/differentiator-e2e.mjs
```

Writes a machine-readable artifact to `tests/e2e/follow-819/last-run.json` (override with
`SESSION_JSON`). `HEADLESS=false` to watch it.

---

## 4. Findings established WITHOUT running the harness

These were verified by reading HEAD in the authoring session. They are **static** findings — each
names its file so a runner can confirm or refute it. Two of them change what the ACs can mean.

### 4.1 AC(5) is structurally blocked by the FOLLOW-822 ClickHouse drift

The lift query joins `events WHERE type = 'cta.clicked'` (`.../analytics/rollup/data.ts`). **The
ingest path cannot write `events` rows to a default-configured ClickHouse at all**, so that join has
nothing to match and `computeLift()` can only return `null`.

Root cause, and it is an **asymmetry between the two writers**:

| Writer                                                                                  | Serialization                               | Result                                                      |
| --------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| Ingest Worker (`apps/ingest/src/clickhouse-producer.ts`, `handlers/intent-snapshot.ts`) | `new Date(ts).toISOString()` → trailing `Z` | **REJECTED** — `date_time_input_format` defaults to `basic` |
| Control plane (`apps/control-plane/src/app/api/adapt/route.ts`)                         | `.replace('T',' ').replace('Z','')`         | **ACCEPTED**                                                |

`grep -rn 'date_time_input_format\|best_effort' --include=*.ts --include=*.sh --include=*.mjs`
returns **zero hits at HEAD** — the drift documented in `LOCAL_PILOT_ENVIRONMENT.md` §8 is still
unfixed.

**Consequence: AC(3) can be green while AC(5) is structurally red**, and that is not a flake — it is
the asymmetry above. AC(5) additionally needs sessions in **both** arms plus ≥1 holdout conversion,
because `computeLift()` returns `null` when `holdoutN === 0` or `holdoutRate === 0`.

### 4.2 AC(1) is expected RED from behavioral signals alone — and that is the deliverable

`LOCAL_PILOT_ENVIRONMENT.md` §9.2 already measured this and the harness re-measures it rather than
assuming it. The peak confidence `0.36554663991975933` is the **cold-start prior**, reached before
the first behavioral event and only pushed _down_ by browsing; it reproduced bit-for-bit across two
unrelated pages and across a 4× longer session.

The harness runs **two arms** and reports which one clears the gate:

- **Arm A — behavior only.** Expected not to clear `> 0.6`.
- **Arm B — the real quiz widget, driven by real clicks.** A quiz leaf resolves at
  `min(0.85 × 1.2, 1.0) = 1.0` and clears the bar outright.

**The reachability verdict is the deliverable, not a bug to fix** (FOLLOW-875 AC-5). The two honest
readings remain _"quiz or chat is required on this page"_ and _"the damping/threshold pair is
miscalibrated for behavior-only sessions"_; choosing between them is FOLLOW-212's work.

### 4.3 AC(3) names a column that does not exist under that name

The stub says `score_function`. The column FOLLOW-560 actually shipped (migration 0022) is
`adaptation_decisions.scoring_path`. Same instrument, different name. The harness asserts the
shipped name and records the discrepancy rather than silently reconciling it.

### 4.4 Two false-RED defects were found in this harness before it ever ran

Both were caught by reading HEAD rather than assuming an API's vocabulary, and both would have
produced a **permanently red AC for the wrong reason**:

1. **AC(5) asserted `data_source === 'live'`.** The live value is `'clickhouse'` (§2).
2. **AC(5) authenticated with `ADAPT_API_KEY`.** The rollup route is staff-gated and wants
   `ADMIN_API_SECRET` (§3.4).

Recording these matters because this ticket's whole purpose is a trustworthy first measurement. A
false red is not the "safe" direction of error: it would have been reported as _"the analytics wire
is dead"_ on a live substrate, sending FOLLOW-212 after a defect that does not exist. **Assertions
must be verified against the producer in both directions — that it can go green when the wire is
live, and red when it is dead.** Neither direction has been confirmed by execution yet (§0).

---

## 5. Evidence from a real run — **MANUAL**, not yet produced

> Intentionally empty. Rule Q: an empty evidence section is honest; a fabricated or inferred one is
> not. The next session that can run containers pastes the `node tests/e2e/follow-819/…` output and
> the resulting `last-run.json` AC block here, verbatim, and updates §0.

```text
(no run yet — see §0)
```

---

## Cross-references

FOLLOW-471 · FOLLOW-560 · FOLLOW-816 · FOLLOW-817 · FOLLOW-818 · FOLLOW-820 · FOLLOW-822 (the drift
in §4.1) · FOLLOW-875 (the AC(1) correction) · FOLLOW-876 · FOLLOW-212 (calibration) ·
`docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §3.5 / §3.8 / §7 / §9.1 / §9.2 · Rule Q · Rule AY
