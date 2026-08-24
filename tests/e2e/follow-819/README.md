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

|                                      |                                                                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Harness**                          | Written, committed, reviewable.                                                                                                                     |
| **Executed end-to-end?**             | **YES — 2026-08-24T11:17:45Z** (FOLLOW-1075), against the real control plane on `:3000`, fixture on `:5173` — the exact §3 ports, no substitutions. |
| **Result**                           | **3 / 5 green.** PASS: AC(3), AC(4), **AC(5) — new**. RED: AC(1), AC(2).                                                                            |
| **AC(6) branch taken**               | Documented manual runbook (§3), **MANUAL** — corrected against a real run.                                                                          |
| **Evidence pasted from a real run?** | **YES — §5**, verbatim, plus `last-run.json`.                                                                                                       |

**AC(5) is green for the first time (FOLLOW-1075).** `ctaLift = -80`, computed by the **existing**
`computeLift()` from real substrate rows: `sessions: 10, adapted: 5, holdout: 5`
(`data_source: 'clickhouse'`, never the `seededRandom` mock). Two real, independently-verified
production-path writes made this possible — neither existed before this ticket:

1. The fixture now carries a `[data-estalara-cta]` button — the SDK's **actual click collector**
   (`observer.ts:547` `onCtaClick`), a different attribute from the `data-estalara-slot="cta"` copy
   slot — clicked in the adapted-arm browser session, producing a real `cta.clicked` event over the
   real ingest Worker.
2. The harness drives a genuinely separate session into the real holdout arm via `holdout_pct: 1` on
   a real `POST /api/adapt` — a real field of `AdaptPostBodySchema` consumed by the real
   `assignHoldout()` (HMAC-SHA-256), an INPUT to production code, never an injected `holdout_group`
   output — plus a real ingest `cta.clicked` event for that session.

Verified independently against ClickHouse (not trusted from the endpoint alone):
`adapted_n: 5, adapted_conversions: 1, holdout_n: 5, holdout_conversions: 5` →
`((1/5 − 5/5) / (5/5)) × 100 = -80`. See §4.1's second correction and §5.

**The headline AC(1) measurement is UNCHANGED and reproduces a third time.** Behaviour-only peaks at
**`confidence = 0.36554663991975933`** against a server gate of **`> 0.6`** — bit-for-bit identical
to `LOCAL_PILOT_ENVIRONMENT.md` §9.2 and to the 2026-08-23 run (PR #833), on a third distinct
execution. **AC(1) is RED with a real number rather than an assumption, and that number is the
deliverable** (FOLLOW-212's input). FOLLOW-1075 did not touch this measurement's value — only the
verdict STRING (next paragraph).

**The quiz arm still did NOT run, and the verdict string now says so correctly (FOLLOW-1075).**
`quizWidgetFound: false` — the fixture carries no quiz widget, so Arm B never executed. Before this
ticket the harness's own verdict string said _"NEITHER behavior nor quiz cleared the gate"_ even
when the quiz arm never ran — RETRO-301 §4b BUG-1's finding, an unmeasured arm reported as a failed
one. The string now reads _"behavior alone did NOT clear the gate; quiz arm UNMEASURED
(quizWidgetFound: false, no quiz widget on this fixture) — report as 'behaviour-only RED, quiz
UNMEASURED', NOT as 'neither cleared'"_ — see §5's pasted output.

**Rule Q posture is unchanged.** A soft-skip must not masquerade as a pass, and a green test over a
dead wire is the worst artifact this repo can produce (FOLLOW-097→114→127→141). Accordingly every
PASS below is reported with the substrate discriminator that makes it meaningful (`AC(5)`'s
`data_source = 'clickhouse'` PLUS the independent ClickHouse conversion-count check above, `AC(4)`'s
before/after Beta pair), and **FOLLOW-819 is NOT closed by this run: 2 of its 5 measurable ACs are
still RED, so FOLLOW-820 condition 1 is NOT satisfied.**

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

> **This runbook has been executed end-to-end** — 2026-08-23T21:48:43Z, against the real control
> plane on `:3000` (§0). Four of its commands, as originally transcribed from
> `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §3.5 / §3.6 / §3.8, turned out to be wrong in ways that
> failed **silently** (three of them) or loudly (the fourth, §6.3 — out of scope for this
> correction); §6 is the measured record of what broke and why, and it is kept as history, not
> deleted. The commands below are the **corrected** forms actually run. Each carries a **Verified
> 2026-08-23** or **Still unverified** tag, and every corrected command carries a forward pointer to
> the §6 paragraph that measured its defect. Treat any further deviation from these corrected forms
> as a finding, exactly as before.

### 3.1 ClickHouse + the FOLLOW-560 column

```bash
docker run -d --name estalara_ch_local -p 8123:8123 \
  -e CLICKHOUSE_USER=default -e CLICKHOUSE_PASSWORD=clickhouse \
  clickhouse/clickhouse-server:25.8

LOCAL=1 CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_PASSWORD=clickhouse \
  ./infra/clickhouse/scripts/migrate.sh
```

**Verified 2026-08-23** — this is the exact container §5's evidence and §2's independent
re-measurement were taken against.

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

**Verified 2026-08-23** — 39 migrations applied, `local-e2e` tenant seeded; this is the Postgres
AC(4)'s Beta delta was independently corroborated against (§2).

### 3.3 SDK bundle + static fixture server

**Verified 2026-08-23 — corrected from `:9200` (§6.2).** `CORS_DEV_EXTRA_ORIGINS`
(`apps/control-plane/src/lib/origin-policy.ts`) is a hardcoded
`['http://localhost:5173', 'http://localhost:3000']`. Serving the fixture on `:9200` still gets a
server-side **200** and a written `adaptation_decisions` row — the browser is refused the response
body, so AC(3) can look green while AC(1)/AC(2) are red for a reason that has nothing to do with
confidence (§6.2 calls this the nastiest of the four defects). **Product CORS policy was
deliberately not widened to accommodate a test port** — that call is right and is not being
re-litigated here; serve the fixture on `:5173` instead:

```bash
pnpm --filter @estalara/shared build && pnpm --filter @estalara/sdk build
doppler run -p estalara-adaptive-listings -c dev -- node scripts/dev/mock-decision-server.mjs  # serves the bundle on :9100
npx serve -l 5173 tests/e2e/follow-819    # serves fixture-listing.html — NOT :9200, see §6.2
```

The `:9100` process is used **only** as a static host for `estalara-sdk.iife.js`. The fixture's
`data-decision-url` points at `:3000`, and the harness hard-fails if it resolves to the mock.

### 3.4 The REAL control plane

**Verified 2026-08-23 — corrected form (§6.1).** `VAR=… doppler run -c dev -- pnpm dev`, with the
overrides placed **before** `doppler run`, is **❌ silently wrong**: Doppler `dev` defines both
`DATABASE_URL_ADMIN` and `ADAPT_API_KEY`, and `doppler run` overrides shell values set ahead of it —
the control plane resolves against **hosted Supabase** while every log line still says localhost.
Use the `env` form so the local overrides win:

```bash
cd apps/control-plane
doppler run -c dev -- env \
  FEEDBACK_ENDPOINT_ENABLED=true \
  ADAPT_API_KEY=local-follow819-key \
  ADMIN_API_SECRET=local-follow819-admin-secret \
  OPS_TENANT_ID=00000000-0000-0000-0000-0000000000e2 \
  DATABASE_URL_ADMIN="$DATABASE_URL_ADMIN" \
  SCORING_PATH_COLUMN_ENABLED=true \
  CLICKHOUSE_URL=http://localhost:8123 \
  CLICKHOUSE_USER=default CLICKHOUSE_PASSWORD=clickhouse \
  pnpm dev
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

**Verified 2026-08-23 — corrected tenant (§6.4).** `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §3.6
seeds the KV api-key record for **its own** pilot tenant (`839ecbd1-0000-4000-8000-000000000001`,
the `:5173` pilot). This fixture declares a **different** tenant —
`data-tenant-id="00000000-0000-0000-0000-0000000000e2"` (`local-e2e`,
`tests/e2e/follow-819/fixture-listing.html`) — so copying that step verbatim attributes every
ingested event to the wrong tenant. Seed the record against the tenant this fixture actually claims:

```bash
cd apps/ingest
printf 'CLICKHOUSE_USER = "default"\nCLICKHOUSE_PASSWORD = "clickhouse"\n' > .dev.vars

npx wrangler kv key put --binding KV_API_KEYS --local --preview false \
  --persist-to .wrangler/state "api_key:pilot-key" \
  '{"tenant_id":"00000000-0000-0000-0000-0000000000e2","scopes":["write:events"],"label":"FOLLOW-819 differentiator fixture","allowed_origins":["http://localhost:5173"]}'

npx wrangler dev --local --port 8787 --persist-to .wrangler/state \
  --var ENVIRONMENT:development CLICKHOUSE_URL:http://localhost:8123 CLICKHOUSE_DATABASE:default
```

The two auth traps (`allowed_origins` semantics — `[...]` allows exactly those origins, `[]` denies
every cross-origin request, absent/`null` inherits the env list; and `ENVIRONMENT` must never be
`production`) are otherwise unchanged from `LOCAL_PILOT_ENVIRONMENT.md` §3.6 — only the tenant in
the seeded record differs.

### 3.6 Run

**Verified 2026-08-23.** The harness's own `LISTING_URL` default is still `:9200` — pass the `:5173`
override explicitly (§6.2), or the run silently exercises the CORS-refused port again:

```bash
DATABASE_URL_ADMIN="$DATABASE_URL_ADMIN" \
ADAPT_API_KEY=local-follow819-key \
ADMIN_API_SECRET=local-follow819-admin-secret \
OPS_TENANT_ID=00000000-0000-0000-0000-0000000000e2 \
LISTING_URL=http://localhost:5173/fixture-listing.html \
  node tests/e2e/follow-819/differentiator-e2e.mjs
```

Writes a machine-readable artifact to `tests/e2e/follow-819/last-run.json` (override with
`SESSION_JSON`). `HEADLESS=false` to watch it.

---

## 4. Findings established WITHOUT running the harness

These were verified by reading HEAD in the authoring session. They are **static** findings — each
names its file so a runner can confirm or refute it. Two of them change what the ACs can mean.

### 4.1 AC(5) is structurally blocked by the FOLLOW-822 ClickHouse drift — ⚠️ **SUPERSEDED BY THE RUN, TWICE — AND THE FIRST SUPERSESSION WAS ITSELF INCOMPLETE**

> **Corrected 2026-08-23 by execution.** Two errors in the section below, both now measured:
>
> 1. **Wrong ticket.** The root cause is **FOLLOW-853**, not FOLLOW-822 (which owns drift
>    _detection_). This mislabel has now been made three times; it was fixed in `FOLLOW_UPS.md` and
>    `LOCAL_PILOT_ENVIRONMENT.md` §8 before this run.
> 2. **The blocker is GONE, and it was not what blocked AC(5) anyway.** FOLLOW-853 merged as
>    `341d6c7c`, and this run wrote **18 `events` rows** through the real ingest Worker — the write
>    path the section below calls impossible. Separately, the local container reports
>    `date_time_input_format = best_effort`, **not** the `basic` the section assumes as the default
>    (CI's job on the _same_ `clickhouse-server:25.8` image reports `basic`) — so the default is a
>    property of the deployment, never of the image.
>
> **AC(5)'s real blocker, measured:** `holdout = 0`. `computeLift()` returns `null` unless there are
> sessions in **both** arms plus ≥1 holdout `cta.clicked`. The harness drives one arm only. That is
> a harness-coverage gap, not a product defect — and it is the one thing standing between this run
> and a real lift number.

> **Corrected AGAIN 2026-08-24 by execution (FOLLOW-1075) — the 2026-08-23 correction above named
> ONE blocker where TWO independently-sufficient ones existed, and the second was the more
> fundamental.** `computeLift()` (`rollup/data.ts:248-258`) returns `null` when `holdoutN === 0`
> **or** `holdoutRate === 0`, and `holdoutRate` is fed by a join against
> `events WHERE type = 'cta.clicked'` (`:200-205`). **The 2026-08-23 harness never emitted that
> event AT ALL** — the fixture had no CTA element to click, and `differentiator-e2e.mjs` never
> called the ingest endpoint for one. Verified two independent ways at the time (RETRO-301 §4a LG-2,
> Rule AR): lexically, `grep -n "cta.clicked" tests/e2e/follow-819/*` returned only two **comment**
> lines; structurally, the surviving local ClickHouse instance's own
> `SELECT tenant_id, type, count() FROM events GROUP BY 1,2` showed **no `cta.clicked` row at all**.
> So `adaptedConversions` and `holdoutConversions` were BOTH structurally 0, independently of
> `holdout = 0` — **fixing `holdout` alone would have moved AC(5) from `null` to `null`**, which is
> exactly what the 2026-08-23 text's "the one thing standing between this run and a real lift
> number" claimed would not happen.
>
> FOLLOW-1075 fixed **both** blockers, not just the named one:
>
> 1. The fixture now carries a `[data-estalara-cta]` button — the SDK's real click **collector**
>    (`packages/sdk/src/core/observer.ts:547` `onCtaClick`), a different attribute from the
>    `data-estalara-slot="cta"` copy **slot** already on the page — clicked in the adapted-arm
>    browser session. This produces a real `cta.clicked` POST from the SDK's own ingest pipeline;
>    the harness never synthesizes the event itself (§2's anti-injection discipline, applied here).
> 2. The harness drives a genuinely SEPARATE session into the real holdout arm via `holdout_pct: 1`
>    on a real `POST /api/adapt` — a genuine field of `AdaptPostBodySchema` (`route.ts:225`)
>    consumed by the real `assignHoldout()` (`packages/shared/src/ab-holdout.ts`, HMAC-SHA-256 keyed
>    on `tenant_id`) — an INPUT to production code, never an injected `holdout_group` OUTPUT — plus
>    a real `cta.clicked` event over the real ingest Worker for that session.
>
> **Measured result, 2026-08-24T11:17:45Z, against the exact §3 ports (`:3000` / `:5173`, no
> substitutions):** `ctaLift = -80`, `data_source: 'clickhouse'`,
> `sessions: 10, adapted: 5, holdout: 5`. **AC(5) is PASS — the first time this product has computed
> a real lift number.** Independently re-derived against ClickHouse directly (not trusted from the
> endpoint alone): `adapted_n: 5, adapted_conversions: 1, holdout_n: 5, holdout_conversions: 5` →
> `((1/5 − 5/5) / (5/5)) × 100 = -80`, matching exactly. See §0 and §5.
>
> A found-by-execution defect in THIS ticket's own first draft, recorded because a false green is
> not the safe direction of error (§2): the harness's CTA click originally used Playwright's
> `force: true`, which skips the scroll-into-view step. On this fixture the button sits below the
> fold, so a forced click silently landed on whatever was in the (unscrolled) viewport instead —
> `adaptedCtaClicked` read `true` from the locator's `count() > 0` while ZERO `cta.clicked` rows
> landed in ClickHouse. Caught only by querying ClickHouse directly before AND after the click,
> never by trusting the click call's own return value. Fixed by removing `force` (Playwright then
> scrolls the element into view before clicking) — verified fixed the same way, by direct query.
>
> The original text is kept below unaltered, as the record of what was believed before either
> measurement (Rule AO — the pattern PR #835 used for this exact file, applied again here rather
> than editing the original in place).

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

## 5. Evidence from real runs — **MANUAL**

Two runs, kept chronologically (Rule AO — a correction is a forward-pointing addition, not a rewrite
of the prior record). §0 summarizes the LATEST (§5.2); §5.1 is kept as the run §4.1's first
correction was graded against.

### 5.1 — 2026-08-23T21:48:43Z (PR #833)

Run at **`2026-08-23T21:48:43.306Z`**, `listingUrl = http://localhost:5173/fixture-listing.html`,
`decisionOrigin = http://localhost:3000` (the real control plane — the preflight discriminator was
verified in **both** directions first: `:3000` returns 404 for `GET /mock/status` and 401 for
`POST /api/adapt`, while `:9100` returns 200 for `/mock/status`). Verbatim stdout:

```text
[preflight] real control plane confirmed at http://localhost:3000 (POST /api/adapt → 401); server gate = confidence > 0.6 (apps/control-plane/src/app/api/adapt/route.ts)

[FAIL] AC(1) — non-neutral archetype with confidence > 0.6 AND directives.length > 0, on the real /adapt response
        {"serverGate":{"value":0.6,"comparison":"<=","source":"apps/control-plane/src/app/api/adapt/route.ts"},"peakConfidence":0.36554663991975933,"archetype":"neutral","nonNeutral":false,"directivesTotal":0,"source":"default","REACHABILITY_FINDING":{"behavioralSignalsAlone":{"peakConfidence":0.36554663991975933,"directives":0,"clearedGate":false},"withQuizInput":{"quizWidgetFound":false,"peakConfidence":0,"directives":0,"clearedGate":false},"verdict":"NEITHER behavior nor quiz cleared the gate — report this as the measurement, do not tune the fixture"}}
[FAIL] AC(2) — at least one [data-estalara-slot] observably changed in the live DOM
        {"changedSlots":[]}
[PASS] AC(3) — adaptation_decisions row logged for this session, carrying a FOLLOW-560 scoring_path
        {"rowCount":2,"scoringPaths":["not_applicable"],"rows":[{"archetype":"neutral","confidence":0.36554664,"directive_count":0,"holdout_group":false,"variant":"v1","scoring_path":"not_applicable"},{"archetype":"neutral","confidence":0.36554664,"directive_count":0,"holdout_group":false,"variant":"v2","scoring_path":"not_applicable"}]}
[PASS] AC(4) — feedback ping moved a real ab_bandit_weights row (Beta delta observed, not just a 202)
        {"httpStatus":202,"archetype":"neutral","variant":"v1","before":{"alpha":1,"beta":1},"after":{"alpha":2,"beta":1},"polls":0}
[FAIL] AC(5) — lift computed from real localhost-substrate rows by the existing analytics path (data_source='clickhouse', NOT the seededRandom mock)
        {"httpStatus":200,"data_source":"clickhouse","scoring_path_source":"live","ctaLift":null,"sessions":4,"adapted":4,"holdout":0}

[substrate] ClickHouse row counts: {"events":18,"intent_events":0,"adaptation_decisions":5}

2/5 acceptance criteria green
RED: AC(1), AC(2), AC(5)
```

#### What each verdict actually means (§5.1)

- **AC(1) RED — measured, not assumed.** `0.36554663991975933` is §9.2's cold-start prior reproduced
  bit-for-bit. Behaviour-only cannot clear `> 0.6`. **Quiz arm UNMEASURED**
  (`quizWidgetFound: false`) — see the §0 note on the overstated verdict string.
- **AC(2) RED — causally downstream of AC(1)**, not an independent defect: `confidence <= 0.6` means
  the route returns `directives: []`, so there is nothing to paint. AC(2) becomes meaningful only
  once AC(1) clears.
- **AC(3) PASS.** FOLLOW-560's instrument works: two rows for the run's session, `scoring_path`
  populated. **Corrected cause (FOLLOW-1072) — the value is `not_applicable` NOT because of a
  confidence gate.** The reorder block at `route.ts:1804` is gated on
  `tenantSchema && listing_ids.length > 0`; there is no confidence check between `runDecisionTree`
  and it. The real cause: `tenant_site_schemas` was EMPTY for every tenant on this substrate, so
  `getTenantSchema()` returned `null` and the block was never entered, **at any confidence**.
  FOLLOW-1072 seeded a `tenant_site_schemas` row for `local-e2e` and reproduced a real
  `scoring_path = 'djb2_fallback'` row against this same local control plane — the first
  non-`not_applicable` row in the product's history. **Cosine-vs-djb2 remains undistinguished** only
  because `archetype_embeddings`/`listing_embeddings` are still unpopulated, not because the ranker
  is unreachable — FOLLOW-560's discriminating question now depends on seeding embeddings, not on
  raising confidence.
- **AC(4) PASS — the strongest result here.** `ab_bandit_weights` moved `Beta(1,1) → Beta(2,1)` with
  **both** endpoints captured. A 202 alone was never accepted. FOLLOW-818's loop is real.
- **AC(5) RED — but NOT for the reason §4.1 predicted.** `data_source = 'clickhouse'` proves the
  analytics wire is live (the `seededRandom` mock would have read `'mock'`), and `events = 18`
  proves the ingest→ClickHouse write path works. `ctaLift` is `null` purely because `holdout = 0`:
  `computeLift()` returns `null` without both arms. **See §4.1's correction below.**

#### Substrate this run stood on (§5.1)

ClickHouse 25.8 (`estalara_ch_local`, `:8123`) with the migration chain applied and
`adaptation_decisions.scoring_path` present; control-plane Postgres (`al_pg_local`, `:5433`, 39
migrations, `local-e2e` tenant seeded); SDK built from source (156,862 B IIFE) served on `:9100`;
fixture served on **`:5173`** (not `:9200` — see §6); real control plane on `:3000`; real ingest
Worker (`wrangler dev`) on `:8787`.

### 5.2 — 2026-08-24T11:17:45Z (FOLLOW-1075) — AC(5) PASS for the first time

Same substrate class as §5.1 (ClickHouse `estalara_ch_local` `:8123`, Postgres `al_pg_local`
`:5433`, real ingest Worker `:8787`), rebuilt fresh (`pnpm --filter "./packages/**" build` — the
prior session's `dist/` did not survive between sessions) and run against the **exact §3 ports, no
substitutions**: `listingUrl = http://localhost:5173/fixture-listing.html`,
`decisionOrigin = http://localhost:3000`. Verbatim stdout, with the **two session identifiers
elided** — `sessionId` to its first 12 hex characters and the holdout id to `f1075hold-546256bf…`.
That is the only edit to this block, it is applied consistently, so the AC(3) proof still reads as a
proof: the four rows carry the _same_ value, which is what that AC asserts.

**The elision is gate-mitigation, not anonymisation** (FOLLOW-1097). The full 64-hex value tripped
`gitleaks`' generic 40-char entropy rule, and this is a credential-bearing document — §3.4 pastes
`ADAPT_API_KEY` / `ADMIN_API_SECRET` / `CLICKHOUSE_PASSWORD` — so `Rule V` forbids exempting the
whole file to keep it. Truncation removes the stable join key and clears the gate; it does **not**
make the value unlinkable. `generateSessionId()` is an unkeyed `SHA-256` over user-agent, screen
size, timezone and language, so anyone enumerating plausible tuples can still confirm a guess
against a 12-hex prefix — a candidate space far smaller than 2^48. That residual is **FOLLOW-1105**,
not this note.

```text
[preflight] real control plane confirmed at http://localhost:3000 (POST /api/adapt → 401); server gate = confidence > 0.6 (apps/control-plane/src/app/api/adapt/route.ts)

[FAIL] AC(1) — non-neutral archetype with confidence > 0.6 AND directives.length > 0, on the real /adapt response
        {"serverGate":{"value":0.6,"comparison":"<=","source":"apps/control-plane/src/app/api/adapt/route.ts"},"peakConfidence":0.36554663991975933,"archetype":"neutral","nonNeutral":false,"directivesTotal":1,"source":"default","REACHABILITY_FINDING":{"behavioralSignalsAlone":{"peakConfidence":0.36554663991975933,"directives":1,"clearedGate":false},"withQuizInput":{"quizWidgetFound":false,"peakConfidence":0,"directives":0,"clearedGate":false},"verdict":"behavior alone did NOT clear the gate; quiz arm UNMEASURED (quizWidgetFound: false, no quiz widget on this fixture) — report as \"behaviour-only RED, quiz UNMEASURED\", NOT as \"neither cleared\" (FOLLOW-1075)"}}
[FAIL] AC(2) — at least one [data-estalara-slot] observably changed in the live DOM
        {"before":[{"slot":"headline","text":"9 Blackberry Pl, Palm Coast, FL 32137 — 3 bed, 2 bath"},{"slot":"description","text":"A three-bedroom, two-bathroom single-family home on a quiet residential street. Open-plan living area, attached two-car garage, screened lanai and a mature garden. Close to schools, the intracoastal waterway and local am"}],"after":[{"slot":"headline","text":"9 Blackberry Pl, Palm Coast, FL 32137 — 3 bed, 2 bath"},{"slot":"description","text":"A three-bedroom, two-bathroom single-family home on a quiet residential street. Open-plan living area, attached two-car garage, screened lanai and a mature garden. Close to schools, the intracoastal waterway and local am"}],"changedSlots":[]}
[PASS] AC(3) — adaptation_decisions row logged for this session, carrying a FOLLOW-560 scoring_path
        {"sessionId":"2ffdf39a3571…","rowCount":4,"scoringPaths":["djb2_fallback","not_applicable"],"cosineVsDjb2Distinguishable":true,"rows":[{"session_id":"2ffdf39a3571…","archetype":"neutral","confidence":0.34261772,"directive_count":1,"holdout_group":false,"variant":"control","adapt_decision_id":"1fa0eb89-9898-4bb5-b72f-69a5dea395f9","scoring_path":"djb2_fallback"},{"session_id":"2ffdf39a3571…","archetype":"neutral","confidence":0.36554664,"directive_count":1,"holdout_group":false,"variant":"v2","adapt_decision_id":"06ee6c67-e1cc-472d-86b5-56cd536597fe","scoring_path":"djb2_fallback"},{"session_id":"2ffdf39a3571…","archetype":"neutral","confidence":0.36554664,"directive_count":0,"holdout_group":false,"variant":"v1","adapt_decision_id":"8e9c4bf2-db33-49eb-967b-e3f3b9e12a5c","scoring_path":"not_applicable"}],"note":"AC names this `score_function`; the shipped column (migration 0022) is `scoring_path`."}
[PASS] AC(4) — feedback ping moved a real ab_bandit_weights row (Beta delta observed, not just a 202)
        {"httpStatus":202,"archetype":"neutral","variant":"v2","before":{"alpha":1,"beta":1},"after":{"alpha":2,"beta":1},"polls":0}

[FOLLOW-1075] driving a real holdout-arm session…
[FOLLOW-1075] holdout arm: {"attempted":true,"holdoutSessionId":"f1075hold-546256bf…","adaptStatus":200,"adaptDecisionId":"f11caa53-44cf-44bf-b3e9-38d3bb67f8ff","loggedHoldoutGroup":true,"decisionRowFound":true,"ingestStatus":200}
[PASS] AC(5) — lift computed from real localhost-substrate rows by the existing analytics path (data_source='clickhouse', NOT the seededRandom mock)
        {"httpStatus":200,"data_source":"clickhouse","scoring_path_source":"live","ctaLift":-80,"sessions":10,"adapted":5,"holdout":5,"adaptedArm":{"sessionId":"2ffdf39a3571…","ctaButtonFound":true,"ctaClicked":true,"ctaClickError":null},"holdoutArm":{"attempted":true,"holdoutSessionId":"f1075hold-546256bf…","adaptStatus":200,"adaptDecisionId":"f11caa53-44cf-44bf-b3e9-38d3bb67f8ff","loggedHoldoutGroup":true,"decisionRowFound":true,"ingestStatus":200},"conversionCounts":null,"unmetPreconditions":[],"antiFixtureGuard":null,"note":"computeLift() returns null when holdoutN === 0 or holdoutRate === 0, so a real lift needs sessions in BOTH arms plus at least one holdout cta.clicked conversion. unmetPreconditions[] names which of those (plus adaptedConversions, for the value's own meaningfulness) is 0 on THIS run."}

[substrate] ClickHouse row counts: {"events":80,"intent_events":4,"adaptation_decisions":13}

3/5 acceptance criteria green
RED: AC(1), AC(2)
```

`conversionCounts: null` here means AC(5) was GREEN — the diagnostic re-derivation
(`measureConversionCounts()`) only runs when the endpoint's own verdict is red, by design (§4c of
the ticket: it must not become a second, competing source of truth for a passing run). Run directly
against ClickHouse for this section, independently of the harness, to corroborate the `-80`:

```text
SELECT countDistinctIf(...) adapted_n, ... FROM adaptation_decisions AS ad LEFT JOIN (...) AS ev ...
{"adapted_n":5,"adapted_conversions":1,"holdout_n":5,"holdout_conversions":5}
```

`((1/5 − 5/5) / (5/5)) × 100 = -80` — matches the endpoint exactly.

#### What changed vs §5.1 (§5.2)

- **AC(1)/(2) — same real number, third reproduction.** `0.36554663991975933`, bit-for-bit, on a
  third distinct execution (different session process, same deterministic session_id — this
  fixture's session identity is stable across runs, which is itself a useful corroboration that
  nothing about the measurement is randomized). The verdict STRING is the only thing that changed
  (see §0).
- **AC(3) — now distinguishing.** `cosineVsDjb2Distinguishable: true`, `scoring_path` values include
  `djb2_fallback`, not only `not_applicable`. This reflects state accumulated on the shared local
  substrate across sessions (FOLLOW-1071/1072-adjacent work, not this ticket) — recorded because
  §5.1 explicitly called the opposite state out, and a silent divergence would be exactly the kind
  of thing Rule AO exists to catch.
- **AC(5) — RED → PASS.** The entire point of FOLLOW-1075. See §4.1's second correction for the
  root-cause analysis.

#### Substrate this run stood on (§5.2)

Same containers as §5.1 (`estalara_ch_local` `:8123`, `al_pg_local` `:5433`), packages rebuilt from
this session's worktree (`pnpm --filter "./packages/**" build`); control plane on `:3000`
(`doppler run -c dev -- env … pnpm dev`, the §3.4 form); ingest Worker (`wrangler dev --local`) on
`:8787`, with the fixture's tenant KV record seeded per §3.5; fixture served on `:5173`
(`npx serve -l 5173 tests/e2e/follow-819`); SDK bundle host on `:9100`
(`scripts/dev/mock-decision-server.mjs`, serving THIS session's freshly-built
`packages/sdk/dist/estalara-sdk.iife.js`).

---

## 6. Defects in §3 itself, found by executing it

§3 said _"treat a deviation as a finding"_. There were four, and **three of them fail silently** —
each would let a run look like it was exercising localhost while it was not. They are the most
valuable output of this run.

### 6.1 §3.4's command cannot work as written — it reads the HOSTED database

```bash
DATABASE_URL_ADMIN="$DATABASE_URL_ADMIN" ... doppler run -c dev -- pnpm dev   # ❌ silently wrong
```

Doppler `dev` **defines both `DATABASE_URL_ADMIN` and `ADAPT_API_KEY`**, and `doppler run` overrides
the shell values passed before it. The control plane therefore resolves API keys and bandit rows
against **hosted Supabase**, not the local `:5433` container, while every log line still says
"localhost". The first run of this harness died here: `pilot-key` was inserted into the local DB and
`/api/adapt` kept answering `401 invalid_demo_token`, because the lookup was happening somewhere
else entirely.

```bash
doppler run -c dev -- env DATABASE_URL_ADMIN='postgresql://…@127.0.0.1:5433/postgres' \
  ADAPT_API_KEY=… ADMIN_API_SECRET=… pnpm dev                                  # ✅ overrides win
```

**This invalidates the premise of any prior "local" run through §3.4**, and it is precisely the
class of defect the CEO's localhost-first ruling exists to catch.

### 6.2 §3.3's fixture port `:9200` can never receive an adapt response

`CORS_DEV_EXTRA_ORIGINS` (`apps/control-plane/src/lib/origin-policy.ts`) is a hardcoded
`['http://localhost:5173', 'http://localhost:3000']`. A fixture served on `:9200` emits the request,
the server processes it and writes the row — **and the browser is refused the response body**:

```text
Access to fetch at 'http://localhost:3000/api/adapt' from origin 'http://localhost:9200'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present
```

This is the nastiest of the four: server-side it looks like a **200**, `adaptation_decisions` gains
a row, and AC(3) goes green — while AC(1)/AC(2) are red for a reason that has nothing to do with
confidence. Serve the fixture on **`:5173`** (`LISTING_URL` override). Product CORS policy was
deliberately **not** widened to accommodate a test port.

### 6.3 `pilot-key` is not a registered credential

The fixture ships `data-api-key="pilot-key"`, which works against the `:9100` mock (it checks
nothing) but not against `:3000`. `api_keys` had no such row, so the API-key fallback path 401s.
Register it — `hashed_key = SHA-256(rawKey)`, hex — with `allowed_origins` covering the fixture
origin.

### 6.4 §3.6's KV seed names a different tenant than the fixture

The runbook seeds `api_key:pilot-key → tenant 839ecbd1-0000-4000-8000-000000000001` (the `:5173`
pilot), while this fixture declares `data-tenant-id="00000000-0000-0000-0000-0000000000e2"`
(`local-e2e`). Seed the KV record against the tenant the fixture actually claims, or ingest
attributes events to the wrong tenant.

---

## Cross-references

FOLLOW-471 · FOLLOW-560 · FOLLOW-816 · FOLLOW-817 · FOLLOW-818 · FOLLOW-820 · FOLLOW-822 (the drift
in §4.1) · FOLLOW-875 (the AC(1) correction) · FOLLOW-876 · FOLLOW-1072 (the AC(3) causal
correction) · FOLLOW-212 (calibration) · **FOLLOW-1075 (AC(5)'s second blocker + the AC(1)
verdict-string fix, §4.1/§5.2)** · `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §3.5 / §3.8 / §7 /
§9.1 / §9.2 · Rule Q · Rule AR · Rule AY · RETRO-301 §4a LG-2 / §4b BUG-1
