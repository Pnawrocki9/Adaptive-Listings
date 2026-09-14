# FOLLOW-819 — differentiator E2E on localhost

**behavioral trace → ingest → intent → adapt → DOM → measured lift**, as one scripted session with
six independently-checkable acceptance criteria.

This is the test `§Snapshot.5` named in its own words until MASTER*DESIGN v4.12: *"Critical gap: no
end-to-end test of intent → archetype → adapt → DOM"\_. v4.12 (2026-09-13, FOLLOW-1148) replaced
that line with the measured state, and `§P.0` / `§Snapshot.0` now carry the gate. This harness is
FOLLOW-820's condition 1.

> **This test is allowed to fail.** A red AC(1)/AC(2) is a successful outcome. It is the first real
> measurement this product has taken, and calibration (FOLLOW-212) depends on knowing the true
> starting number rather than assuming one. Do not tune the fixture until it passes.

---

## 0. Execution status — READ THIS FIRST (Rule Q)

|                                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Harness**                          | Written, committed, reviewable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Executed end-to-end?**             | **YES — most recently 2026-08-26T10:06:24Z** (FOLLOW-1139, §5.9), against the real control plane on `:3000`, ingest on `:8787`, fixture on `:5173` — the exact §3 ports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Result**                           | ⚠️ **Grading caveat, 2026-09-13 (FOLLOW-1197):** this tally was graded by the AC(1) predicate that #894 (FOLLOW-1186) retired, and by an AC(7) that cannot fail on the fixture tenant (FOLLOW-1196). §5.9 recorded an `llm_tweaked` source and cannot be re-graded, because its artefact was overwritten. **No run has yet been graded by the current AC(1).** Cite §5.9 as "recorded `llm_tweaked`", not as "6 / 6". Recorded tally: **6 / 6 green (§5.9, FOLLOW-1139), the first fully green run.** PASS: AC(1), AC(2), AC(3), AC(4), AC(5), AC(7). RED: **none.** AC(2) went green with `changedSlots: ["headline","cta","feature"]` and a headline reading `Rental Yield: 7.2% \| Gross Income: $27,600/yr` — real client-side interpolation of a real served template. **Read §5.9 before quoting this row:** AC(2) is green because the FIXTURE was completed, and the fixture now DIVERGES from the pilot page on purpose. The tenant-facing half of the same defect is open (**ESC-074 / FOLLOW-1140**). |
| **AC(5) red-first**                  | **Proven by EXECUTION on the PERSISTENT substrate (§5.5)** — 11 pooled sessions in the window. With the CTA attribute removed, every condition of the OLD predicate still held (`ctaLift -54.5`, `adaptedConversions: 5`) while the new one went RED on `thisRunConversions=0`. Green restored, fixture byte-identical.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **AC(7) red-first**                  | **Proven by EXECUTION, both directions (§5.6).** Same mirrored profile in both arms; only `holdout_pct` differs. `0` → `drewHoldout false`, control served **3** directives → RED. `1` → `drewHoldout true`, control served **0** → GREEN. Adapted arm **4** throughout. That adapted-side count pools directives including `reorder`, so it proves nothing about adaptation (FOLLOW-1196).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **AC(2) red-first**                  | **Proven at the SDK layer, both directions (§5.9).** `follow-1139-fixture-contract.test.ts` reads the REAL fixture off disk and applies the REAL `yield_hunter` playbook through the REAL `applyDirectives()`: 6/6 failing before the fixture edit with the SAME skip-reason set the §5.8 harness run recorded (`unresolved_token_yield`, `unresolved_token_income`, `no_slot_elements` ×2), 6/6 passing after. The harness run itself is the end-to-end confirmation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **AC(6) branch taken**               | Documented manual runbook (§3), **MANUAL** — corrected against a real run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Evidence pasted from a real run?** | **YES — §5**, verbatim. That is the whole of the reachable evidence: `last-run.json` is **`.gitignore`d by design** and exists only in the tree that produced the run, so it is NOT citable to a reader at HEAD and is no longer cited as if it were (FOLLOW-1080, closed here).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### ⚠️ WHAT FOLLOW-820 MAY AND MAY NOT TAKE FROM THIS FILE

**FOLLOW-820 condition 1 is the TECHNICAL gate, and it does NOT read `ctaLift`.** ESC-073 (CEO
ruling, 2026-08-25) settled this in the terms this section previously contradicted: _"Condition 1
does NOT require a positive lift, and never did."_ What it DOES require is two things, both of which
live in this harness:

1. **The whole chain runs on real data** — SDK → ingest → decision → DOM → analytics, computed by
   the production path from real substrate rows. That is AC(1)–AC(5). Whether the chain ADAPTED is
   graded by `results[AC(1)].evidence.outcomes.adapted`, read with AC(1)'s `ok` (#894, FOLLOW-1186).
   A template, refused, outage or `default` response never counts.
2. **The holdout MECHANISM demonstrably separates the two arms** — a control session receives no
   directives and an adapted session does. That is **AC(7)** (FOLLOW-1131, first executed in §5.6).
   **Corrected 2026-09-13 (FOLLOW-1197), updated 2026-09-14 (FOLLOW-1209): its greens of 2026-08-26
   do not grade this clause.** They were graded by an adapted side that pooled directive counts,
   including the `reorder` the POST handler appends whatever the `source`, so they pass with a dead
   LLM path. Since #899 (FOLLOW-1196) the adapted side is AC(1)'s own predicate
   (`isAdaptedResponse()`), and on a run at HEAD AC(7)'s `ok` grades clause 2 by itself. The clause
   is not ceremonial: if arm assignment is broken, the real experiment run after GO collects garbage
   and nobody finds out until after the fact.

**The business proof — "adaptation measurably out-converts no-adaptation" — is FOLLOW-1130, and it
explicitly does NOT gate GO.** It gates outward-facing efficacy claims (pricing, pitch decks,
client-facing "+X% conversion"), not the production step. Do not import it into condition 1: that
reading is what deadlocked the plan, since real traffic would require passing FOLLOW-820 while
FOLLOW-820 would require real traffic.

**`ctaLift` is non-positive by construction — that is still true, and it is now an explanation of a
number nobody should grade, not a reason condition 1 cannot pass.** AC(5)'s control arm is
SYNTHETIC: `driveHoldoutArm()` mints one control session per run and converts it, so `holdoutRate`
is pinned at **1.0 by construction**, `computeLift()` collapses to
`ctaLift = (adaptedRate − 1) × 100`, and the value is **non-positive for arithmetic reasons that
have nothing to do with the product**. It also decays as runs accumulate, because the rollup is a
**7-day window over the whole substrate**, not a per-run experiment. A green AC(5) means _the
analytics path computed a lift from real rows (`data_source='clickhouse'`) **and THIS RUN's adapted
session produced at least one real `cta.clicked`**_ — scoped to this `session_id`, not to the 7-day
pool (FOLLOW-1124). It does **not** mean the differentiator produced a lift, and `rollup.sessions`
supports **no directional claim** — do not run a significance test on it. Every run writes this into
its own `last-run.json` under `results[AC(5)].evidence.liftProvenance`, next to the number itself
(FOLLOW-1098). That file is `.gitignore`d and readable only in the tree that produced the run (see
the evidence row above), so a reader at HEAD gets the caveat from this paragraph, not from the
artefact. (FOLLOW-1148 item 4, resolved in that direction.)

**AC(1) FIRST WENT GREEN IN §5.3, UNDER THE PREDICATE #894 RETIRED. Corrected 2026-09-13
(FOLLOW-1197).** That green was graded by `nonNeutral && peak > gate && totalDirectives > 0`, which
passed on a withheld template `cta` and on an LLM outage. §5.3 recorded no `source`, so it cannot be
re-graded under `evaluateAc1()`. What survives is the reachability measurement below, which does not
depend on the predicate. **THE HEADLINE MEASUREMENT IS UNCHANGED.** Behaviour alone still peaks at
**`confidence = 0.36554663991975933`** against a server gate of **`> 0.6`** — bit-for-bit identical
to `LOCAL_PILOT_ENVIRONMENT.md` §9.2 and to every prior execution. What changed is that **the quiz
arm finally ran**: driving the real widget through real clicks resolves `yield_hunter` at
`confidence = 1.0` with directives > 0, so the harness's own verdict now reads _"behavior alone did
NOT clear the gate; quiz input was REQUIRED (confirms runbook §9.2)"_ — the judgement §9.2 made on
paper, now measured. See §5.3.

**Why the quiz arm had never run, measured before it was fixed (FOLLOW-1099).** The locator was
`[data-estalara-quiz-option], .estalara-quiz button` and **neither half can ever match**:
`data-estalara-quiz-option` exists nowhere in shipped code, and no element carries the class token
`estalara-quiz` (the widget renders `.estalara-quiz-overlay` / `-card` / `-answer` / `-cta`, and a
CSS class selector matches whole tokens, never prefixes). The stub's competing hypothesis — that
`quiz_enabled` was false for this tenant — is **REFUTED** both in source (`seed-local-tenant.mts`
seeds `quiz_enabled` TRUE; the `'{}'::jsonb` beside it is `quiz_config`, the optional definition
override) and in the live database (`local-e2e` reads `quiz_enabled = t`, `consent_required = f`).
The interaction model needed correcting too: a ROOT answer applies immediately, a NON-ROOT answer
only SELECTS and the separate `.estalara-quiz-cta` commits it, so the old "click `.first()` six
times" loop could not have driven the widget even with a working selector. `.estalara-quiz-skip` is
never clicked — a skip resolves to `neutral` (FOLLOW-554).

**A run can be UNMEASURED on the adapted axis, and that is now detected (FOLLOW-1098).** The browser
session's `holdout_group` is decided by the real `assignHoldout()` at the tenant's default holdout
percentage, and the SDK mints its own session id — so on a minority of runs the arm this harness
calls "adapted" **is the control arm**, receives zero directives by design, and AC(1)/AC(2)/AC(5)
all go red for a reason that is not the differentiator. Observed on a real run (§5.3). The harness
cannot prevent it in scope, so it names it: `adaptedArmDrewHoldout` sits **above** `results` in
`last-run.json`, and `adaptedArmDrewHoldout=true` is pushed into AC(5)'s `unmetPreconditions`. When
it is true the AC tally understates the product by construction — **re-run before reading it.**

**AC(2) IS GREEN AS OF §5.9 (2026-08-26T10:06:24Z), AND WHAT IT MEANS IS NARROWER THAN "IT WORKS".**
It took two fixes in two tickets, at two different layers, and the second one carries a caveat a
grader must not skip.

- **FOLLOW-1138 (merged, #855) — page type.** `detectPageType()` (`packages/sdk/src/index.ts`)
  defaulted to `listing_list` unless the URL contained `/listing/` or the script tag set
  `data-page-type`, so `filterDirectivesByPageType()` (`route.ts:1269`) **stripped the `headline`
  directive before the response was sent**. Widened to also resolve `listing_detail` from a single
  `[data-estalara-listing-id]` element. Confirmed by execution (§5.8):
  `resolvedPageType: listing_detail`, `pageContextsSeen: [2]`, `headline` served. **Closed subject —
  do not re-diagnose it.**
- **FOLLOW-1139 (this file's §5.9) — the fixture could not receive what was now being served.** With
  `headline` finally arriving, `changedSlots` was still `[]`. Three of the four served directives
  were refused by the DOM layer, and `default.events` named each one: the `yield_hunter` headline is
  a TEMPLATE (`Rental Yield: {yield}% | Gross Income: {income}/yr`), `interpolatePlaceholders()`
  (FOLLOW-1018) resolves `{token}` from a `data-estalara-<token>` attribute on the matched slot
  element and discards the WHOLE directive on one unresolved token (`unresolved_token_yield`,
  `unresolved_token_income`), while `cta` and `feature` had no elements to paint at all
  (`no_slot_elements` ×2). The fixture now carries the two fact attributes and declares all four
  slots.

**⚠️ THE CAVEAT, AND IT IS THE IMPORTANT PART.** AC(2) is green because the FIXTURE was completed,
and the completed fixture **no longer mirrors the pilot page**. The pilot listing page
(`docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §1) renders `headline` + `description` and **no fact
attributes at all**. On that page, today, the same run would still be red. AC(2) asserts **hop 10**
— a directive that arrives is painted — and hop 10 is now proven end-to-end on real data. It does
**not** assert that a tenant page as currently authored will adapt.

**That gap was real and wider than this fixture — and it has since been largely CLOSED. Corrected
2026-08-27 (FOLLOW-1161); the paragraph this replaces is preserved two paragraphs down as the
measurement it was.** When this file was written, 17 distinct `{token}` placeholders shipped in
`slots[].en` across 16 of the 18 archetypes and 15 of them had no emitter anywhere in non-test code,
so on a real tenant page the headline directive was discarded for most archetypes, silently. Two
rulings closed that:

- **ESC-074 (b), shipped as FOLLOW-1140 / #860** — `/api/adapt` now fills five tokens SERVER-side
  from the listing's own facts, on the branches that serve playbook copy verbatim.
- **ESC-075, ruled option 1 and shipped as #862** — the other twelve, which no data in the estate
  could ever fill, were written OUT of the copy rather than given an invented source.

**Net effect on what this README grades:** the tenant-side headline loss described above no longer
applies to the twelve rewritten archetypes, and `yield_hunter` — the archetype this harness
exercises — now needs **no fact attribute at all**. The register gate
(`packages/sdk/src/__tests__/placeholder-token-producers.test.ts`) holds both residual counters at
**0** and recomputes them from source on every CI run. What remains on the tenant axis is part
**(c)** (publishing the `data-estalara-<token>` contract as an onboarding requirement) plus the
`cta` / `feature` slot elements the pilot page does not declare — not the copy demanding facts
nobody has. **Do not read the AC(2) caveat above as though the token gap were still open**; it is
the SLOT-DECLARATION half of the divergence that stands, not the token half.

**Per this file's standing rule, the fixture was not tuned until it passed — it was completed once
the harness had NAMED what it was missing, and the divergence is stated in the fixture's own header
and here rather than absorbed into a green.**

**Rule Q posture is unchanged.** A soft-skip must not masquerade as a pass, and a green test over a
dead wire is the worst artifact this repo can produce (FOLLOW-097→114→127→141). Accordingly every
PASS below is reported with the substrate discriminator that makes it meaningful (`AC(5)`'s
`data_source = 'clickhouse'` PLUS the independent ClickHouse conversion-count check above, `AC(4)`'s
before/after Beta pair). **As of §5.9 no AC was red, but that run does NOT by itself satisfy
FOLLOW-820 condition 1 (corrected 2026-09-13, FOLLOW-1197).** It was graded by the pre-#894 AC(1)
and by the pre-#899 AC(7), which could not fail on the fixture tenant. On a run at HEAD, clause 1 is
decided by `results[AC(1)].evidence.outcomes.adapted` > 0 (equal to AC(1)'s `ok` since #904) and
clause 2 by AC(7)'s `ok`, each cited with the artefact's pasted `--check-staleness` verdict line
(MASTER_DESIGN §P.0 item 1, updated 2026-09-14 by FOLLOW-1209). The red ACs are named here rather
than counted, because the count is what went stale across three regenerations of this section — and
when the set is empty this sentence says so rather than reporting a number. **What a grader must
still weigh is in the AC(2) caveat above:** hop 10 is proven, tenant-page readiness is not, and that
half is open as ESC-074 / FOLLOW-1140.

The harness is deliberately **not** a `*.spec.ts`. A discoverable spec would be collected by a CI
runner and reported as a SKIP that reads as a pass. It is an `.mjs` script that hard-fails on an
absent substrate and exits non-zero.

---

## 1. What it asserts

Each AC is recorded independently — one red does not mask the others.

| AC      | Assertion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Guarded against                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(1)** | **At least one real `/api/adapt` response that was ADAPTED** (`evaluateAc1()`, FOLLOW-1186 / #894), meaning all of the following on that same response: `source` ∈ {`llm_tweaked`, `llm_full`}, a non-neutral archetype, `confidence` **strictly >** the server `CONFIDENCE_THRESHOLD`, and **≥1 non-`reorder` directive**. Prints `N of M responses adapted`. The evidence carries `outcomes` (`adapted` / `llmNotQualifying` / `refused` / `outage` / `template` / `default` / `other`) and `sourcesObserved`, and FOLLOW-820 condition 1 grades `outcomes.adapted`. Since FOLLOW-1205, `outcomes.adapted` is the count of responses passing all four conditions, so it is `> 0` exactly when AC(1) is green; before, it counted every `llm_*` source and could read 1 on a red run. This replaced the pre-#894 predicate `nonNeutral && peak > gate && totalDirectives > 0`, kept only as `legacy` reporting | The threshold is read out of `route.ts` **at run time**, value _and_ comparison operator, so it cannot drift away from the gate that actually decides (FOLLOW-875). A withheld template `cta`, a fact-check refusal, an LLM outage or a `default` + `reorder` response cannot turn it green, and an empty population is RED                                                                                                                                                                                               |
| **(2)** | An observably adapted DOM — a `[data-estalara-slot]` text actually changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Distinct from (1): the only assertion that catches directives that arrive but are never painted                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **(3)** | An `adaptation_decisions` row for this session carrying the FOLLOW-560 scoring path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Tells real cosine ranking from a stable djb2 hash shuffle                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **(4)** | A feedback-driven `ab_bandit_weights` Beta delta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Polls Postgres for the real state change; a 202 alone is never accepted                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **(5)** | A lift number from real substrate rows via the **existing** analytics path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **Asserts `data_source === 'clickhouse'` first** — see §2                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **(6)** | Runs in CI, or a documented manual runbook with pasted evidence labelled MANUAL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | §0 + §3 + §5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **(7)** | The holdout MECHANISM **separates the arms**: the control session received **zero** directives and the adapted session received **at least one response that passes AC(1)'s predicate** (`evaluateAc7()` calls `isAdaptedResponse()`; corrected 2026-09-13, FOLLOW-1205 — this row said "> 0" directives, the pooled count #899 retired because it includes the `reorder` every non-holdout response carries) — **discharges ESC-073 clause 2**, the second half of FOLLOW-820 condition 1                                                                                                                                                                                                                                                                                                                                                                                                                      | The control call **mirrors the profile of the FIRST adapted response** (`selectProfileResponse()`, FOLLOW-1196), and AC(7) refuses a control call that mirrored anything else. Holdout assignment is NOT the only difference between the two sessions: `driveHoldoutArm()`'s docblock lists four axes the mirror does not equalise (corrected 2026-09-13, FOLLOW-1205). Without that mirror the control session is `neutral` and receives zero directives **in either arm** — an assertion that cannot fail (FOLLOW-1131) |

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

**Corrected 2026-09-13 (FOLLOW-1200, FOLLOW-1205, FOLLOW-1206).** The harness's own `LISTING_URL`
defaults to `:5173`, matching §3.3. Serve the fixture there: the control plane on `:3000` does not
serve `fixture-listing.html`, so no other origin in this runbook works. The explicit `LISTING_URL`
below is shown for clarity only.

**The preflight probe, and what it can tell you.** Before any session starts,
`assertRealControlPlane()` sends `POST /api/adapt` with the fixture's `data-api-key` as the bearer
(the SDK's own credential), `Origin: <LISTING_URL origin>` and a `{}` body. It accepts exactly one
answer: `400 Validation failed` with that origin echoed in `access-control-allow-origin`, which
means the demo secret is present, the key authenticated and the origin is allowed. Every other
answer aborts the run and names its class:

| answer                           | class                           | first thing to check                                                                       |
| -------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| `500 demo_auth_misconfigured`    | `demo_secret_missing`           | §6.5 — Turbo stripped `DEMO_MODE_JWT_SECRET`                                               |
| `401 invalid_demo_token`         | `fixture_key_not_authenticated` | §6.3 key not registered, §6.1 wrong `DATABASE_URL_ADMIN`, §6.7 Postgres out of connections |
| `403 <reason>`                   | `origin_refused_by_key_policy`  | the key's or tenant's `allowed_origins` exclude the fixture origin                         |
| `400 Validation failed`, no ACAO | `cors_origin_not_echoed`        | `next start` (`NODE_ENV=production`) only echoes `CORS_PROD_ORIGINS`; or not `:5173`       |
| `404`, no answer, anything else  | as named                        | `DECISION_ORIGIN` is not the real control plane                                            |

The probe cannot say which of the `401` causes it hit, because the handler answers all of them the
same way. It also cannot see anything read after body validation: ClickHouse, the LLM gateway,
`SCORING_PATH_COLUMN_ENABLED`, AL enablement, or `HOLDOUT_ASSIGNMENT_SECRET` once FOLLOW-1201 lands.
Those show up as red ACs. The statuses above are pinned against the real handler and middleware by
`control-plane-probe.test.ts`.

```bash
DATABASE_URL_ADMIN="$DATABASE_URL_ADMIN" \
ADAPT_API_KEY=local-follow819-key \
ADMIN_API_SECRET=local-follow819-admin-secret \
OPS_TENANT_ID=00000000-0000-0000-0000-0000000000e2 \
LISTING_URL=http://localhost:5173/fixture-listing.html \
  node tests/e2e/follow-819/differentiator-e2e.mjs
```

Writes a machine-readable artifact to `tests/e2e/follow-819/last-run.json` (override with
`SESSION_JSON`). `HEADLESS=false` to watch it. `ADAPT_API_KEY` is required, and the harness refuses
to start without it: since FOLLOW-1201 (#902) the control arm sends it as the ops bearer, the only
caller whose `holdout_pct` is honoured. Run it from a clean tree: uncommitted changes under the
measured path set (below) are recorded in the artefact's `harnessTree`, and such an artefact never
reads FRESH.

**Before grading any artefact, run the staleness check (FOLLOW-1200, FOLLOW-1205, FOLLOW-1208).** A
grade taken from an artefact that does not pass it is not evidence about HEAD.

**The rule (FOLLOW-1208).** Freshness asks whether the bytes that ran are HEAD's, not how many
commits separate them. The measured path set is `HARNESS_TREE_PATHSPEC`, listed once in its docblock
in the harness (product code, ClickHouse migrations, the root dependency manifests, the harness, its
probe module and the fixture page; not docs, backlog, this README or the vitest files). The same
list decides the run-start `harnessTree` and the grading-time
`git diff --quiet <harnessSha> HEAD -- <path set>`. A completed, clean run whose measured paths are
unchanged since `harnessSha` is FRESH, however many docs, backlog or other test commits landed after
it. That includes a squash-merged PR-branch commit that is not an ancestor of HEAD.
**`--allow-stale` is still needed only when a measured path changed after the run, and `harnessSha`
is an ancestor of HEAD** (an older commit of this history, for example a run taken before a product
fix merged). Quote such a grade as a grade of that commit. The flag never rescues a non-ancestor
whose measured paths differ from HEAD's, an unreadable diff, an abort artefact, a dirty run, or an
artefact with no tree record. For those, re-run at HEAD.

```bash
node tests/e2e/follow-819/differentiator-e2e.mjs --check-staleness [path] [--allow-stale]
```

- **Path.** With no path it reads `last-run.json` next to the harness, resolved against the harness
  file, so it works from any cwd. An explicit `path` (or `SESSION_JSON`) is taken relative to the
  cwd.
- **Verdicts.** `[FRESH]`: no measured path changed since `harnessSha`, clean tree, run completed.
  The line prints `measuredPathsChanged=0` and, for an ancestor, `commitsBehind=<n>`. A non-ancestor
  prints `FRESH-by-content` and no `commitsBehind`, because its rev-list count is not a distance.
  `[STALE]`: no `harnessSha`, measured paths changed (the changed paths are listed), a diff git
  could not read (for example a SHA this clone lacks), or no tree record (every artefact written
  before FOLLOW-1205). `[ABORTED]`: an abort artefact, whose ACs are unmeasured. `[DIRTY]`: the run
  started with uncommitted changes, listed in the banner. `[ALLOW-STALE]`: an ancestor whose
  measured paths changed, graded only because `--allow-stale` was given. Quote both numbers wherever
  the grade is quoted.
- **Exit code.** `0` for FRESH, and for ALLOW-STALE under `--allow-stale`. `1` for everything else,
  including an unreadable or non-JSON file. Read the verdict word, not only the exit code.
- **Age is not checked.** `startedAt` is printed next to the verdict, not graded.

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

> **Corrected a THIRD time 2026-09-13 (FOLLOW-1148, on a note from the FOLLOW-1200 worker). The
> writer table and the grep sentence below are false at HEAD, and have been since FOLLOW-853 merged
> (`341d6c7c`).** Both ingest writers now encode through `toClickHouseDateTime64()`
> (`apps/ingest/src/clickhouse-producer.ts:159-161`), which runs `.toISOString()` and then removes
> the `T` and the `Z`. It is called at `clickhouse-producer.ts:191-192` and
> `apps/ingest/src/handlers/intent-snapshot.ts:179`, so the ingest side now sends the same zone-less
> shape the control plane already sent. The integration spec asserts the bytes against a live engine
> under the server default and under `best_effort`
> (`apps/ingest/src/__tests__/integration/clickhouse-producer.integration.test.ts`, AC2-A and
> AC2-C). The table as it reads at HEAD:
>
> | Writer                                                                  | Serialization                                          | Result                                       |
> | ----------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
> | Ingest Worker (`clickhouse-producer.ts`, `handlers/intent-snapshot.ts`) | `toClickHouseDateTime64()` → `YYYY-MM-DD hh:mm:ss.sss` | **ACCEPTED** under `basic` and `best_effort` |
> | Control plane (`apps/control-plane/src/app/api/adapt/route.ts`)         | `.replace('T',' ').replace('Z','')`                    | **ACCEPTED**                                 |
>
> The grep `date_time_input_format\|best_effort` now returns hits at HEAD. All of them are
> FOLLOW-853's own docblocks and tests (e.g. `clickhouse-producer.ts:125-146` and the integration
> spec above), plus a comment in `infra/clickhouse/scripts/smoke-test.sh:35`. None is a settings
> override, and none needs to be: the fix changed the bytes, not the server setting. Why the local
> container itself reads `best_effort` is a separate open finding (FOLLOW-1076), not settled here.
> The original text stays below, unaltered (Rule AO).

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

Five runs, kept chronologically (Rule AO — a correction is a forward-pointing addition, not a
rewrite of the prior record). §0 summarizes §5.5; **§5.4 and §5.5 supersede §5.3's red-first
control** — that one was run on a FRESH substrate and could not have distinguished a run-scoped
assertion from a substrate-scoped one. §5.1 is kept as the run §4.1's first correction was graded
against.

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

### 5.3 — 2026-08-25 (FOLLOW-1098 + FOLLOW-1099) — AC(1) PASS for the first time; the quiz arm executes

> **Grading note 2026-09-13 (FOLLOW-1197):** graded by the pre-FOLLOW-1186 predicate; source
> recorded: none; under `evaluateAc1`: UNGRADEABLE.

Same substrate class as §5.2 (ClickHouse `estalara_ch_local` `:8123`, Postgres `al_pg_local`
`:5433`, control plane `:3000`, ingest Worker `:8787`, fixture `:5173`). Ran at
`2026-08-25T10:18:55.852Z`.

```
4/5 acceptance criteria green
RED: AC(2)
```

**AC(1) — the quiz arm, executed for the first time in this harness's history.**

```json
{
  "behavioralSignalsAlone": {
    "peakConfidence": 0.36554663991975933,
    "directives": 1,
    "clearedGate": false
  },
  "withQuizInput": {
    "quizWidgetFound": true,
    "quizDriven": true,
    "quizCompleted": true,
    "quizSteps": [
      {
        "step": 0,
        "answers": 4,
        "ctaPresent": true,
        "ctaEnabled": false
      },
      {
        "step": 1,
        "answers": 4,
        "ctaPresent": true,
        "ctaEnabled": true
      },
      {
        "step": 2,
        "answers": 3,
        "ctaPresent": true,
        "ctaEnabled": true
      }
    ],
    "peakConfidence": 1,
    "directives": 3,
    "clearedGate": true
  },
  "verdict": "behavior alone did NOT clear the gate; quiz input was REQUIRED (confirms runbook \u00a79.2)"
}
```

Read the two arms side by side. Behaviour alone peaks at `0.36554663991975933` — the §9.2 number,
reproduced bit-for-bit a fourth time on a fourth distinct execution. The quiz arm peaks at `1` with
`3` directives and clears the `> 0.6` server gate. `quizSteps` records the interaction shape that
the old loop could not have driven: step 0 has `ctaEnabled: false` (a ROOT answer applies on click),
steps 1 and 2 have `ctaEnabled: true` (a NON-ROOT answer only selects; the CTA commits).

> **Annotation 2026-09-13 (FOLLOW-1205).** `clearedGate` in this transcript is the pre-#899
> definition, `peakConfidence > gate && directives > 0`. Since FOLLOW-1196
> (`evaluateArmReachability()`) it means confidence only: the directive conjunct was always true
> alongside it, because every non-holdout response carries a `reorder`. Both values above read the
> same under either definition. Neither says a model adapted anything; that is AC(1)'s claim.

**AC(5) — green under the RESTATED predicate, with its provenance attached.**

```json
{
  "ctaLift": -57.14285714285714,
  "conversionCounts": {
    "adaptedN": 7,
    "adaptedConversions": 3,
    "holdoutN": 7,
    "holdoutConversions": 7
  },
  "unmetPreconditions": []
}
```

`adaptedConversions: 3` is the conjunct FOLLOW-1098 added, and it is the only input the synthetic
control cannot manufacture. `syntheticControlRunsInWindow: 7` is how many harness runs this single
number is pooled over — the value is a 7-day rollup over the whole substrate, not a per-run
experiment. `holdoutRate` is **1.0 by construction**. The lift is **negative for arithmetic
reasons** and is **not directional evidence**; `isDirectionalEvidence` is `false` in the artefact
itself.

**The red-first control, executed — not argued.** On a FRESH ClickHouse (`clickhouse-server:25.8`,
migration chain applied, zero prior rows — so the 7-day window carried no debris), with
`data-estalara-cta` renamed off the fixture button:

```json
{
  "ok": false,
  "ctaLift": -100,
  "data_source": "clickhouse",
  "adaptedArm": { "ctaButtonFound": false, "ctaClicked": false },
  "conversionCounts": {
    "adaptedN": 1,
    "adaptedConversions": 0,
    "holdoutN": 1,
    "holdoutConversions": 1
  },
  "unmetPreconditions": ["adaptedConversions=0"]
}
```

**AC(5) goes RED — and the OLD predicate (`res.ok && live && lift !== null`) would have reported
PASS on this exact state**, because `data_source` is `clickhouse` and `-100` is not `null`. That is
the structural false green this ticket removed, demonstrated on a substrate rather than derived on
paper. Restoring the attribute returns AC(5) to green.

**A false RED found while proving the false GREEN.** On one fresh-substrate run the browser session
drew `holdout_group = true` from the real `assignHoldout()`. The quiz still resolved `yield_hunter`
at `confidence = 1.0` — but every row it wrote carried `directive_count: 0`, because a control-arm
session receives no directives by design. AC(1), AC(2) and AC(5) all went red on a run where nothing
was wrong with the differentiator. The harness now reports `adaptedArmDrewHoldout` above `results`
and pushes `adaptedArmDrewHoldout=true` into AC(5)'s `unmetPreconditions`. **This means the AC tally
has never been deterministic across runs, and no artefact said so until now.**

**One thing measured and deliberately NOT fixed here.** On the fresh substrate the SDK emitted
`cta.clicked` (it is present in the artefact's `emitted` array) and the ingest Worker logged **no
`events_accepted` line for that batch at all** — the POST left the browser and did not reach the
Worker, so the row never existed to be lost. On the `:8123` substrate the same click lands every
time. Not root-caused, out of scope for both tickets, filed as its own stub.

---

### 5.4 — 2026-08-25 (FOLLOW-1124 + FOLLOW-1125) — AC(5) becomes falsifiable on the PERSISTENT substrate

§5.3's red-first control was run on a **fresh** ClickHouse, _"so the 7-day window carried no
debris"_. That sentence was the defect, not a detail of the setup. RETRO-310 found that AC(5)'s
adapted-arm conjunct read `measureConversionCounts()`, whose entire filter is
`WHERE ad.ts >= now() - toIntervalDay(7)` — **no session filter, no tenant filter**. It asserted
_"some adapted session somewhere converted this week"_ while meaning _"this run's adapted arm
converted"_. On a fresh substrate the two are indistinguishable, because both are empty.

**Measured on the documented persistent substrate** (`estalara_ch_local`, restarted, prior runs
intact), against a fabricated session id standing for a totally broken run:

```
pooled, 7-day, no session filter   →  adaptedN: 7      adaptedConversions: 3     ⇒ OLD predicate GREEN
scoped to this run's session_id    →  adaptedDecisions: 0   conversions: 0       ⇒ NEW predicate RED
```

> **Annotation 2026-09-13 (FOLLOW-1205).** `adaptedDecisions` in this and every later transcript
> (§5.5, §5.9) is the field #899 renamed `treatmentArmDecisions` (`measureThisRunAdaptedArm()`). It
> always counted `holdout_group = 0` rows whatever their `source`: arm membership, not adaptation.
> The transcripts keep the name they were recorded under.

**The old conjunct reports GREEN for a run that did not exist**, off three conversions produced by
earlier runs — no fixture change required to demonstrate it. That is stronger than §5.3's control:
it needs no edit to the fixture at all, only a substrate that has been used before, which is the
documented one. AC(5) now reads `adaptedArm.thisRun`; the pooled counts stay in the artefact to
explain `ctaLift`'s value and no longer carry the verdict.

**The harness also used to die before writing its own artefact (FOLLOW-1125).**
`measureAdaptedArmHoldout(sessionId)` was awaited outside any `try`, and `sessionId` is
`… ?? … ?? null` — null whenever the SDK emitted nothing (failed to boot, consent denied, fixture
server dead). `sid.replace()` is evaluated while BUILDING the query argument, so it threw before
`chQuery` was ever called and the `.catch()` on its promise never saw it. Reproduced against the
shipped source text, and re-run against the fixed source:

```
OLD shape  →  REJECTED: TypeError: Cannot read properties of null (reading 'replace')
NEW shape  →  {"drewHoldout":null,"reason":"no_session_id","groups":[],"rows":0}
```

That state previously produced a normal RED artefact; the regression made it **neither red nor
skipped**, leaving the previous run's `last-run.json` in place to be mistaken for this one's. Three
further indeterminate paths are now distinguished rather than collapsed —
`no_decision_rows_for_session` (the fire-and-forget write has not landed),
`mixed_holdout_group_within_session` (the one-group-per-session invariant is **asserted**, not
assumed — FOLLOW-1121's remedy (b) is the first change that would break it), and
`clickhouse_unreachable`. `null` now enters `unmetPreconditions` with its reason instead of
rendering as `"adaptedArmDrewHoldout": null` above `results`, where it skim-read as _not held out_.

A bottom-of-file handler guarantees the artefact and the browser teardown on **every** path, so a
crash can no longer leave a stale artefact looking like a result.

---

### 5.5 — 2026-08-25 (FOLLOW-1124 + FOLLOW-1125, EXECUTED) — red→green on the PERSISTENT substrate

> **Grading note 2026-09-13 (FOLLOW-1197):** graded by the pre-FOLLOW-1186 predicate; source
> recorded: `playbook_fallback_llm_unavailable` (the only one named); under `evaluateAc1`: probably
> FAIL.

§5.4 proved the defect by query. This is the same claim proved by **running the harness**, on the
documented persistent substrate (`estalara_ch_local`, prior runs intact — the 7-day window held
**11** pooled sessions by the end, not zero).

**Red-first, `data-estalara-cta` renamed off the fixture:**

```json
{
  "httpStatus": 200,
  "data_source": "clickhouse",
  "ctaLift": -54.54545454545454,
  "conversionCounts": { "adaptedN": 11, "adaptedConversions": 5 },
  "adaptedArm": { "ctaButtonFound": false, "thisRun": { "adaptedDecisions": 2, "conversions": 0 } },
  "unmetPreconditions": ["thisRunConversions=0"]
}
```

Read the two halves against each other. `res.ok` ✓, `data_source: clickhouse` ✓, `ctaLift !== null`
✓ — **and the pooled conjunct is satisfied too** (`adaptedN: 11 > 0`, `adaptedConversions: 5 > 0`).
**Every condition of the FOLLOW-1098 predicate holds, so it would have reported PASS on this exact
state.** The run-scoped predicate reports RED, with exactly one unmet precondition and no noise.

**Green restored, fixture byte-identical:**

```json
{
  "unmetPreconditions": [],
  "adaptedArm": { "thisRun": { "adaptedDecisions": 3, "conversions": 1 } },
  "ctaLift": -50,
  "liftProvenance": { "isDirectionalEvidence": false }
}
```

> **Annotation 2026-09-13 (FOLLOW-1205).** Both `adaptedDecisions` values in §5.5, and the one in
> the prose below, are `treatmentArmDecisions` under their pre-#899 name (see the §5.4 annotation).

**4/5 green. AC(2) is the only red** — `changedSlots: []` against
`source: playbook_fallback_llm_unavailable`: FOLLOW-1123's disjoint-slot finding reproducing
exactly. The fixture was **not** tuned. AC(1) reproduces `yield_hunter` at `confidence: 1` through
the real quiz widget.

`ctaLift` is still negative (`-50`) and still `isDirectionalEvidence: false`. Per ESC-073 that is
arithmetic, not product, and FOLLOW-820 condition 1 does not read it.

**A defect in the FIRST draft of this fix, caught only by running it.** The run-scoped query
initially carried `AND tenant_id = '<tid>'`, and AC(5) went RED on a run that had genuinely
converted. Cause: **the SDK reports `tenant_id` as an all-zero UUID** — it does not know the
tenant's UUID; the ingest Worker resolves the real one from the API key and writes THAT to
ClickHouse. So the harness's `tenantId`, read back out of the SDK's own emitted events, is
`00000000-0000-0000-0000-000000000000` while every row carries `…00e2`. The artefact showed the
contradiction directly, because the two reads sit side by side: `drewHoldoutDetail` reported
`rows: 3` for the same session on which `thisRun` reported `adaptedDecisions: 0`. `session_id` alone
is the correct key, and it is what AC(3) and `measureAdaptedArmHoldout()` already used — this
function was the outlier. **A query-level proof could not have caught this; only the end-to-end run
did.**

---

### 5.6 — 2026-08-26 (FOLLOW-1131, EXECUTED) — AC(7) added; ESC-073 clause 2 discharged for the first time

> **Grading note 2026-09-13 (FOLLOW-1197):** graded by the pre-FOLLOW-1186 predicate, with an AC(7)
> whose adapted side counts the unconditional `reorder` (FOLLOW-1196); sources recorded in the
> matching on-disk artefact (`ranAt 2026-08-25T22:37:59Z`, matched by inference): `default`,
> `playbook_fallback_llm_unavailable`, `playbook`; under `evaluateAc1`: FAIL (re-graded by
> RETRO-325, 0 of 3 adapted).

**5 / 6 green. AC(2) is the only red.** New in this run: **AC(7)**, which asserts the half of
FOLLOW-820 condition 1 that ESC-073 added and the harness had never measured — _"a control session
receives no directives and an adapted session does"_.

**The first draft of AC(7) was vacuous, and the run is what proved it.** With `holdout_pct: 0` — the
red-first, where the "control" session is NOT held out — it still reported `directivesServed: 0`.
The reason is a real property of the system: `driveHoldoutArm()` sent no archetype at all, so
`/adapt` resolved the session `neutral`, below the confidence gate, and returned zero directives
**regardless of which arm it landed in**. An assertion that the control arm received nothing would
have been satisfied by a session in the ADAPTED arm. Rule AU, one level down from where FOLLOW-1124
found it.

**The fix is to mirror the adapted arm's own winning profile onto the control call**, so holdout
assignment is the only difference between the two. `archetype_hint`, `confidence` and `similarity`
are real INPUT fields of `AdaptPostBodySchema` — the same standing `holdout_pct` already had; the
outputs stay computed by production code.

> **Annotation 2026-09-13 (FOLLOW-1205).** Two sentences above no longer describe the harness. (1)
> The "winning profile" was the most confident response, whatever its `source`. Since #899
> (FOLLOW-1196) the control call mirrors the FIRST ADAPTED response (`selectProfileResponse()`), and
> AC(7) refuses a mirror of anything else. (2) Holdout assignment is not the only difference:
> `driveHoldoutArm()`'s docblock lists four axes the mirror leaves unequal (session history,
> `listing_ids`, call count, source branch). The red-first below compares the same synthetic session
> at `holdout_pct` 0 and 1, which is the comparison ESC-073 clause 2 needs.

**Both directions, same mirrored profile (`yield_hunter`, `confidence: 1`, `similarity: 0.85`), only
`holdout_pct` differing:**

```json
// RED-FIRST — holdout_pct: 0
"controlArm": { "drewHoldout": false, "directivesServed": 3, "directiveCountLogged": 3 },
"adaptedArm": { "directivesServed": 4 },
"unmetPreconditions": ["controlArmDidNotDrawHoldout=false", "redFirstKnobEngaged:holdout_pct=0"]

// GREEN — holdout_pct: 1
"controlArm": { "drewHoldout": true,  "directivesServed": 0, "directiveCountLogged": 0 },
"adaptedArm": { "directivesServed": 4 },
"unmetPreconditions": []
```

The control arm goes 3 → 0 on the holdout draw alone. **That is the separation, measured.**

> **Annotation 2026-09-13 (FOLLOW-1205). This GREEN is RED under the current AC(7).**
> `adaptedArm.directivesServed` in both blocks above is the field #899 moved to
> `legacy.directivesServedIncludingReorder`. It sums every directive, including the `reorder` every
> non-holdout response carries, and it is no longer the verdict. The adapted half now requires at
> least one response passing AC(1)'s predicate. Re-executed on 2026-09-13: the current
> `evaluateAc1()` and `evaluateAc7()`, run over the on-disk artefact matched to this section by
> inference (`ranAt 2026-08-25T22:37:59Z`, recorded AC(7) `ok: true`), give
> `0 of 3 responses adapted` (`default`, `playbook_fallback_llm_unavailable`, `playbook`) and AC(7)
> `false`, with unmet `[adaptedArmHasNoAdaptedResponse]`. The CONTROL half's 3 → 0 separation is
> unaffected.

**What AC(7) does NOT say.** It is not a lift claim and not an efficacy claim — it says the
apparatus splits traffic, so that a real experiment after GO collects something rather than garbage.
The business proof remains FOLLOW-1130, which deliberately does not gate GO.

**The red-first knob is deliberately loud.** `FOLLOW1131_CONTROL_HOLDOUT_PCT` reaches
`last-run.json` twice and AC(7) refuses to PASS on any value other than `1` (`redFirstKnobEngaged`
enters `unmetPreconditions`), so a run that quietly forced separation off cannot be mistaken for a
clean one.

**§6.7 recurred and cost a full run.** The first green attempt reported AC(4), AC(5) **and** AC(7)
red with `PostgresError: sorry, too many clients already`; `psql` itself could not connect. After
restarting the control-plane process, connections fell from the cap to **8** and the same harness
went 5/6. Recognise it before reading any run of it as a product failure.

---

### 5.7 — 2026-08-26 (FOLLOW-1138) — the fix is implemented and proven at the SDK layer; **the authoring session could not re-run the harness** — say so, don't infer it. It was re-run later the same day by the PM: see §5.8

**What changed.** `detectPageType()` (`packages/sdk/src/index.ts`) is widened: after the explicit
`data-page-type` attribute and the `/listing/` URL substring, a page carrying **exactly one**
`[data-estalara-listing-id]` element (the FOLLOW-819 fixture's real shape — one listing,
`fixture-listing.html:57`) now resolves `listing_detail` too, instead of falling through to the
`listing_list` default that made `filterDirectivesByPageType()` (`route.ts:1269`) strip the
`headline` directive. "Exactly one", not "any", because a real listing GRID page renders that same
attribute once PER CARD (`tenant-schema.ts`'s default `item_selector`) — see the function's doc for
the full branch order and the chosen option (a widen-the-heuristic / b explicit-attribute- fail-loud
/ c both) with rationale (PR description).

**Proven true through the REAL `init()` → `POST /api/adapt` request path, not the pure function in
isolation** (Rule Q) — `packages/sdk/src/__tests__/follow-1138.test.ts`, run against a DOM built to
the fixture's exact shape: the captured `/api/adapt` request body now carries
`page_type: 'listing_detail'` (previously `listing_list`), and a new `adapt.page_type_resolved`
event reaches the real ingest event-batching pipeline with `provenance: 'dom_signal'`. This is the
same class of evidence §2's anti-injection discipline asks for — the real SDK code path, not an
injected value — but it stops at the SDK's own boundary; it does not reach the real `/api/adapt`
route, the real ClickHouse write, or this harness's own DOM.

**⚠️ The harness itself could NOT be re-run in the session that shipped this fix.** The sandboxed
worktree that authored FOLLOW-1138 has no permission to mutate Docker container state
(`docker start`/`docker restart` on `estalara_ch_local` / `al_pg_local` were refused), so
§3.1/§3.2's substrate could not be brought up and §3.6's
`node tests/e2e/follow-819/differentiator-e2e.mjs` was never invoked. **No AC(2) verdict from this
harness was claimed for this fix by the session that wrote it.** That gap has since been closed: a
PM session with Docker access ran §3 end-to-end against this exact branch and appended **§5.8** with
`changedSlots`, `resolvedPageType`, `servedSlots` and `fixtureSlots` — the four fields AC(2)'s
evidence records, per this same PR. Read §5.8, not this paragraph, for the measured verdict.

**Why the SDK-layer evidence above is still strong signal, not a substitute.** The fixture's own
markup is `data-estalara-listing-id="839ecbd1-…"` with no sibling of that attribute anywhere else on
the page (`fixture-listing.html:57`) — exactly the "count === 1" shape the widened heuristic
targets, and exactly what `follow-1138.test.ts`'s DOM fixture reproduces. The remaining uncertainty
is not the SDK's resolution logic (proven) but whether the control-plane route, the LLM/playbook
source selected on a given run, and the fixture's `readSlots()` DOM read agree with it end-to-end —
which is precisely what §3.6 exists to measure and this session could not run. §5.8 measured it: the
route and the SDK **do** agree (`page_context 2`, `headline` served); the fixture's DOM read is
where it still breaks, for a cause unrelated to page type.

### 5.8 — 2026-08-26T08:01:33Z (PM re-verification of FOLLOW-1138) — **the harness WAS re-run against the fix: page-type resolution is CLOSED; AC(2) is still red for a NEW cause**

**Run for real, not inferred.** `node tests/e2e/follow-819/differentiator-e2e.mjs` executed against
branch `sdk-engineer/FOLLOW-1138-page-type-detail-signal` (`79bd79f0`) on a real local substrate —
ClickHouse `estalara_ch_local`, Postgres `al_pg_local`, real control plane on `:3000`, ingest Worker
on `:8787`, fixture on `:5173` — the exact §3 ports.
`listingUrl = http://localhost:5173/fixture-listing.html`,
`sessionId = eeb99406-a369-4854-8620-338fe2451801`, `adaptedArmDrewHoldout: false` (so the adapted
arm really was adapted — the §5.3 re-run trap did not fire). Artifact: `last-run.json`,
`ranAt: 2026-08-26T08:01:33.766Z`.

**Result: 5 / 6. PASS: AC(1), AC(3), AC(4), AC(5), AC(7). RED: AC(2) only** — the same tally as
§5.6, but **not the same AC(2)**: its cause has changed.

**FOLLOW-1138's own fix is CONFIRMED and needs no further work.** AC(2)'s evidence, verbatim from
this run:

```json
{
  "changedSlots": [],
  "resolvedPageType": "listing_detail",
  "pageContextsSeen": [2],
  "servedSlots": ["reorder", "headline", "cta", "feature"],
  "fixtureSlots": ["headline", "description"]
}
```

`resolvedPageType` is `listing_detail` and `pageContextsSeen` is `[2]` — the fixture is no longer
misclassified — and **`headline` now appears in `servedSlots`**, where before the fix
`filterDirectivesByPageType()` (`route.ts:1269`) stripped it on every run. The new
`adapt.page_type_resolved` event also reached real ClickHouse with the correct payload (3 rows,
queried directly) — a real producer→consumer wire, not a test-only symbol. **Page-type resolution is
a closed subject; do not re-diagnose it.**

**AC(2) is red for a different, newly-exposed reason — tracked as FOLLOW-1139, not FOLLOW-1138.**
`changedSlots: []` despite `headline` being served. Traced through `default.events` `adapt.skipped`
rows for this session:

| reason                    | slot                                                           |
| ------------------------- | -------------------------------------------------------------- |
| `unresolved_token_yield`  | `headline` (twice — `llm_tweaked` and `playbook` sources both) |
| `unresolved_token_income` | `headline`                                                     |
| `no_slot_elements`        | `cta`                                                          |
| `no_slot_elements`        | `feature`                                                      |

Two independent causes, neither of them page type:

1. **The served `yield_hunter` headline is a template with `{yield}`/`{income}` placeholders the
   fixture never satisfies.** `interpolatePlaceholders()` (`packages/sdk/src/core/adapt.ts`,
   FOLLOW-1018) resolves `{token}` from a `data-estalara-${token}` attribute **on the matched slot
   element itself**, and by FOLLOW-1018's deliberate design an unresolved token discards the WHOLE
   directive rather than partially rendering it. `fixture-listing.html`'s
   `[data-estalara-slot="headline"]` carries neither `data-estalara-yield` nor
   `data-estalara-income`.
2. **`servedSlots` and `fixtureSlots` barely intersect.** The fixture declares only `headline` and
   `description`; the run served `reorder`, `headline`, `cta`, `feature`. `cta` and `feature` cannot
   paint on this fixture as authored, and `description` was never served — so `headline` was the
   only slot that could possibly have changed, and cause 1 took it.

**Do not read this as "the differentiator doesn't work".** The adaptation reached the page; the DOM
write was refused by a placeholder-interpolation contract the fixture doesn't meet. FOLLOW-1139
carries the diagnosis, the two candidate levers (widen the fixture vs. a possible real
tenant-template gap — `apps/control-plane/src/app/dashboard/demo/mockup/page.tsx:152` is currently
the only place in the repo that emits `data-estalara-yield`), and the AC.

**➡️ SUPERSEDED BY §5.9 (same day, 10:06:24Z).** FOLLOW-1139 ruled BOTH levers, the fixture was
completed, and a real re-run went **6 / 6 with AC(2) green**. The tenant-template half was confirmed
real and escalated (ESC-074 / FOLLOW-1140) rather than absorbed. Read §5.9 for the current verdict;
this section is kept as the measurement that produced the diagnosis.

### 5.9 — 2026-08-26T10:06:24Z (FOLLOW-1139, EXECUTED) — **6 / 6 for the first time: AC(2) goes green, and the fixture's divergence from the pilot page is the price**

**Run for real, not inferred.** `node tests/e2e/follow-819/differentiator-e2e.mjs` executed from the
FOLLOW-1139 worktree branch (`75bc2963`) against a real local substrate — ClickHouse
`estalara_ch_local`, Postgres `al_pg_local` (already migrated + seeded from the §5.8 run), real
control plane on `:3000` via `doppler run -c dev -- env … pnpm --filter @estalara/control-plane dev`
(§6.5's Turbo bypass — verified by the `invalid_demo_token` probe, NOT `demo_auth_misconfigured`),
ingest Worker on `:8787` (PID checked against `ss -ltnp`, §6.8), fixture on `:5173`. Both §6.6
warm-up curls issued first. `listingUrl = http://localhost:5173/fixture-listing.html`,
`sessionId = 59286eb2-5c6f-4a9b-a28e-8c7f3283681c`, `adaptedArmDrewHoldout: false` (so the adapted
arm really was adapted — the §5.3 re-run trap did not fire). Artifact: `last-run.json`,
`ranAt: 2026-08-26T10:06:24.108Z`.

> **Annotation 2026-09-13 (FOLLOW-1205, RETRO-326 §4d DG-2).** "Verified by the `invalid_demo_token`
> probe" verified nothing. That probe carried no bearer and answers `invalid_demo_token` whether or
> not `DEMO_MODE_JWT_SECRET` reached the process (§6.5, corrected). This run's green does not depend
> on it: a plane without the secret cannot serve `llm_tweaked` at all.

**Result: 6 / 6. PASS: AC(1), AC(2), AC(3), AC(4), AC(5), AC(7). RED: none.** First fully green run
in this harness's history.

**AC(2)'s evidence, verbatim from this run:**

```json
{
  "changedSlots": ["headline", "cta", "feature"],
  "resolvedPageType": "listing_detail",
  "pageContextsSeen": [2],
  "servedSlots": ["reorder", "headline", "cta", "feature"],
  "fixtureSlots": ["headline", "description", "cta", "feature"],
  "before": [
    { "slot": "headline", "text": "9 Blackberry Pl, Palm Coast, FL 32137 — 3 bed, 2 bath" },
    { "slot": "cta", "text": "Request a Tour" },
    { "slot": "feature", "text": "Property Highlights" }
  ],
  "after": [
    { "slot": "headline", "text": "Rental Yield: 7.2% | Gross Income: $27,600/yr" },
    { "slot": "cta", "text": "Request Investment Pack" },
    { "slot": "feature", "text": "Investment Performance" }
  ]
}
```

(`description` is unchanged in both arrays and is omitted here for width — it was never served, on
this run or any prior one.)

**The two headline directives this run actually served, from `last-run.json` `.decided[]`:**

| `source`      | `headline` value                                                |
| ------------- | --------------------------------------------------------------- |
| `llm_tweaked` | `"Rental Yield: {yield}% \| Gross Income: {income}/yr"`         |
| `playbook`    | `"Investment Property — {yield}% Gross Yield, Tenant in Place"` |

**Read that table twice.** The LLM path SUCCEEDED (`source: llm_tweaked`, `AC(1) peakConfidence 1`,
`directivesTotal 5`) and still returned the RAW template tokens — `llm-gateway.ts`'s
`buildListingContextBlock()` tells the model to substitute them from listing context, and with no
listing context on this substrate it correctly left them alone rather than inventing figures. The
painted headline is therefore **client-side interpolation of a server-served template**, which is
FOLLOW-1018's design working as specified. FOLLOW-1139's stub flagged this as possibly a regression;
it is not — but it does mean the placeholder contract is load-bearing on the LLM path too, not only
on the playbook fallback.

**Independently corroborated in real ClickHouse** (`default.events`, this `session_id`, queried
directly rather than read off the harness's own verdict):

```
adapt.applied                    headline   1
adapt.applied                    cta        1
adapt.applied                    feature    1
adapt.skipped  no_cards          [data-estalara-listing-id]  2
```

Every `unresolved_token_*` and `no_slot_elements` row from §5.8 is **gone**. The remaining
`no_cards` is the `reorder` directive on a single-listing detail page — expected, and unrelated.

**RED-FIRST, both directions, before the fixture was touched.**
`packages/sdk/src/__tests__/follow-1139-fixture-contract.test.ts` reads the REAL fixture file off
disk and applies the REAL `getPlaybook('yield_hunter')` directives through the REAL
`applyDirectives()` — no hand-written markup, no hand-written directive value. Against the pre-fix
fixture: **6 / 6 failing**, emitting exactly the §5.8 skip set (`unresolved_token_yield`,
`unresolved_token_income`, `no_slot_elements` ×2). Against the post-fix fixture: 6 / 6 passing. The
new register gate `placeholder-token-producers.test.ts` was likewise proven red in both of its
directions by probe — a token added to a playbook without a register entry, and a producer added to
a non-test file without a register entry — and both probes reverted.

**⚠️ WHAT THIS GREEN DOES NOT SAY — and the ruling behind it.** The fixture was completed, and it
now DIVERGES from the pilot page: it declares `cta` / `feature` slots and carries
`data-estalara-yield` / `data-estalara-income`, and the pilot page (`LOCAL_PILOT_ENVIRONMENT.md` §1)
has none of them. **The ruling on FOLLOW-1139's two candidate levers is BOTH**, for one reason: the
fixture's incompleteness was blocking the measurement of hop 10, AND the same shape of gap is real
tenant-facing product surface, so fixing only the fixture would have converted a product finding
into a green. Measured for this ruling, two independent strategies per Rule AR — a lexical grep over
`packages/sdk/src/core/playbooks/` and a structural extraction that imports `getAllPlaybooks()` at
runtime and walks `slots[].{en,pl,es}` plus every bandit variant; both returned the SAME 17 tokens
**as of 2026-08-26 — a dated measurement, superseded by ESC-075 on 2026-08-27 and kept here because
it is the evidence the ruling was made on, not a statement of current state. Twelve of the seventeen
below no longer ship; re-run the two strategies before quoting any count from this block:**

`{arv} {bedrooms} {climate} {income} {internet_speed} {key_feature} {key_luxury_feature} {location_highlight} {minutes} {monthly_payment} {neighborhood} {nightly_rate} {school_rating} {sqm} {threshold} {university} {yield}`

carried by **16 of the 18 archetypes**, almost all on `headline`. A repo-wide scan of non-test
source for `data-estalara-<token>=` finds emitters for exactly **two** of them — `{yield}` and
`{bedrooms}`, both only in `apps/control-plane/src/app/dashboard/demo/mockup/page.tsx`, a dashboard
DEMO with hardcoded listings. **Fifteen tokens had no emitter anywhere.** (All figures in this
paragraph are the 2026-08-26 measurement. Post-ESC-075 the shipped set is five tokens across six
archetypes, every one of them server-resolvable.) The same scan shows the mockup emits
`data-estalara-area` while the playbook token is `{sqm}` → `data-estalara-sqm`, so even the
reference implementation and the templates disagree. Consequence: on a real tenant page the headline
directive is discarded for most archetypes, with no error and no `fallback_reason` — only an
`adapt.skipped {unresolved_token_<name>}` row nobody queries. **That is a product-behaviour decision
(narrow the templates, emit the facts, or interpolate server-side), so it was escalated — ESC-074 —
and filed as FOLLOW-1140, not decided inside an SDK ticket.**

**Rule AZ compliance for this regeneration of §0.** Grep, lexical + structural:
`grep -n "follow-819/README" backlog/FOLLOW_UPS.md backlog/RETROSPECTIVES.md` → **FOLLOW-1080** (§0
cites `.gitignore`d `last-run.json` as reachable evidence) and **FOLLOW-1127** (three claims in the
merged FOLLOW-1098 artefact, incl. README §1's AC table and §5.2's determinism claim). **FOLLOW-1080
is CLOSED here** — §0's evidence row now says in as many words that `last-run.json` is
`.gitignore`d, exists only in the producing tree, and is not citable at HEAD. **FOLLOW-1127 is
knowingly DEFERRED** — its three items live in §1, §5.2 and `differentiator-e2e.mjs`'s Rule AU
lineage comment, none of which this PR regenerates.

**One superseded claim WAS found in code and corrected, because it lands in the artefact the
FOLLOW-820 grader reads.** `differentiator-e2e.mjs`'s AC(5) `liftProvenance.nNote` still asserted
_"FOLLOW-820 condition 1 requires a POSITIVE lift over a REAL control, which this harness cannot yet
produce"_, and so did the comment block above it. **ESC-073 abolished that requirement**
(_"Condition 1 does NOT require a positive lift, and never did"_). FOLLOW-1133 corrected README §0
and was scoped to §0; the code copies survived and were emitted into **every** `last-run.json`
since. Both now state ESC-073's ruling. The `ctaLift`-is-non-positive-by-construction explanation is
unchanged and still correct — this run reports `ctaLift: -30.0` over 35 pooled sessions, and it must
not be graded.

**Substrate this run stood on (§5.9).** ClickHouse row counts after the run: `events 352`,
`intent_events 16`, `adaptation_decisions 61` — the PERSISTENT substrate, continuous with §5.4–§5.8,
not a fresh container. AC(5) reports `data_source: "clickhouse"`, `scoring_path_source: "live"`,
`syntheticControlRunsInWindow: 17`, `adaptedArm.thisRun: { adaptedDecisions: 3, conversions: 1 }`
(`treatmentArmDecisions` since #899; see the §5.4 annotation) — the run-scoped conjunct FOLLOW-1124
made the verdict turn on. AC(3) reports `scoring_path: "djb2_fallback"` on all three rows, unchanged
from prior runs. AC(4) moved a real Beta pair `{alpha 5, beta 1}` → `{alpha 6, beta 1}`.

**One bring-up note, not a §6 defect but it costs 15 minutes.** A FRESH worktree has no
`node_modules` and no built workspace `dist/`s. `pnpm install` alone is not enough: the control
plane fails to compile with `Module not found: Can't resolve '@estalara/auth'` and every route
answers HTTP 500 with a Next.js error page — which is NOT one of §6.5's two documented probe
responses and reads like a broken substrate. `pnpm --filter './packages/*' build` first. (The
`@estalara/shared` half of this is the already-known cross-package rebuild trap; the control plane
needs the other packages too.)

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

### 6.5 §3.4's `pnpm dev` routes through Turbo, which STRIPS `DEMO_MODE_JWT_SECRET` — every `/api/adapt` call 500s

**Measured 2026-08-25.** The root `dev` script is `turbo run dev`, and Turbo **2.9.6 defaults to
strict `envMode`**: a task only receives environment variables declared in `turbo.json`'s `env` /
`globalEnv` / `passThroughEnv`. `turbo.json` declares none of them. So `DEMO_MODE_JWT_SECRET` —
which Doppler `dev` **does** define — never reaches the Next.js process, `verifyDemoJwt()` throws
`DemoJwtSecretMissingError`, and `/api/adapt` returns **500 `demo_auth_misconfigured` for every
request**, including the SDK's.

This fails in the worst possible way: the control plane starts cleanly, `/` answers, the preflight's
unauthenticated probe is _supposed_ to be rejected so a 500 still looks like a rejection, and the
harness proceeds. The SDK then receives no directives and **AC(1), AC(2) and AC(3) all go RED** —
reading exactly like a broken differentiator. Observed as `0/5` before the cause was found.

> **Annotation 2026-09-13 (FOLLOW-1205, RETRO-326 §4b BUG-1).** The paragraph above says the
> preflight's probe saw a 500 and read it as a rejection. It did not: that probe carried no bearer,
> and `route.ts` `POST` returns `401 invalid_demo_token` on a missing bearer before
> `verifyDemoJwt()` reads the secret. The probe answered 401 on this broken plane and on a healthy
> one alike, which is why the harness proceeded. The Turbo finding itself stands. Since FOLLOW-1205
> the probe carries the fixture key and fails on this state (§3.6).

Diagnostic that names it in one call — **corrected 2026-09-13 (FOLLOW-1205).** The original form had
no `Authorization` header and printed `invalid_demo_token` in **both** states:

```bash
curl -s -X POST -H 'content-type: application/json' -d '{}' http://localhost:3000/api/adapt
# WITHDRAWN: answers {"error":"invalid_demo_token"} whether or not the secret reached the process
```

The request must carry a bearer so the handler reaches the secret check:

```bash
FIXTURE_KEY=pilot-key   # the fixture tenant's demo key, as the harness sends it
curl -s -w ' %{http_code}\n' -X POST -H 'content-type: application/json' \
  -H "Authorization: Bearer ${FIXTURE_KEY}" -d '{}' http://localhost:3000/api/adapt
# {"error":"demo_auth_misconfigured"} 500  -> the secret did not reach the process; stop
# anything else                           -> the secret is present
```

Pasted from an execution on 2026-09-13 against a real `next dev --turbo` of this checkout, on port
`:3217`, with no Postgres. Containers were down, so the healthy `400` below was not executed live:

```text
--- DEMO_MODE_JWT_SECRET unset, bearer-less (the withdrawn form):
{"error":"invalid_demo_token"} 401
--- DEMO_MODE_JWT_SECRET unset, with bearer:
{"error":"demo_auth_misconfigured"} 500
--- DEMO_MODE_JWT_SECRET set, DATABASE_URL_ADMIN unset, bearer-less:
{"error":"invalid_demo_token"} 401
--- DEMO_MODE_JWT_SECRET set, DATABASE_URL_ADMIN unset, with bearer:
{"error":"invalid_demo_token"} 401
```

With the secret present, the bearer's answer depends on Postgres. It is `401 invalid_demo_token`
when the key cannot be looked up (as above), and `400 Validation failed` once §3.2 Postgres is up
and `pilot-key` is registered (§6.3). The `400` comes from the real handler in
`control-plane-probe.test.ts`, not from this execution.

**Corrected command — bypass Turbo, keep everything else identical:**

```bash
... doppler run -c dev -- env ... pnpm --filter @estalara/control-plane dev
```

### 6.6 The preflight's 8 s timeout is shorter than a cold Next.js compile, so the FIRST run after any bring-up aborts

**Measured 2026-08-25.** `assertRealControlPlane()` probes `POST /api/adapt` with
`AbortSignal.timeout(8000)`. The control-plane log for that exact request reads
`POST /api/adapt 401 in 8655ms` — the route answered **correctly**, 655 ms too late, because Next.js
dev compiles routes on demand. Warm, the same route answers in **0.33 s**.

So the first run after every bring-up aborts on a healthy substrate. Warm both routes before
running:

```bash
curl -s -o /dev/null -X POST -H 'content-type: application/json' -d '{}' http://localhost:3000/api/adapt
curl -s -o /dev/null -H "Authorization: Bearer $ADMIN_API_SECRET" \
  "http://localhost:3000/api/admin/analytics/rollup?tenant_id=00000000-0000-0000-0000-0000000000e2"
```

Since FOLLOW-1125 this aborts _visibly_ — artefact written, every AC marked UNMEASURED, exit 1 —
rather than leaving the previous run's `last-run.json` to be mistaken for this run's result. That
was the first real-world exercise of that handler and it behaved as designed.

### 6.7 Repeated runs against one `next dev` process exhaust Postgres connections, and the 500s look like product failures

**Measured 2026-08-25.** After several consecutive harness runs the control plane began returning
`500` from `/api/admin/analytics/rollup` and failing API-key auth on `/api/adapt`, with
`PostgresError: sorry, too many clients already` in its log. `pg_stat_activity` was at
`max_connections`; `psql` itself could no longer connect. The dev server does not release pooled
connections between runs.

Symptom to recognise: AC(5) red with `http_status=500` **and** `conversionCounts=unavailable`, while
ClickHouse is demonstrably healthy. Remedy: restart the control-plane process (connections dropped
from the cap to 8 immediately). **Do not read this as a lift-pipeline defect** — it is a dev-server
resource leak, and it silently poisoned two red-first attempts before it was identified.

### 6.8 A failed `wrangler dev` can leave an orphaned `workerd` holding `:8787` and answering requests

**Measured 2026-08-25.** `wrangler dev` failed with
`failed: ::bind(...): Address already in use; toString() = 127.0.0.1:8787`, yet `:8787` was bound by
a live `workerd` that returned `404` on `/` — a plausible-looking response for the ingest Worker.
The child outlived its parent's failed start. A run against it would be attributed by **whatever KV
api-key record that process was started with**, not the one just seeded — an event-attribution error
that produces no error message anywhere. Check the owner before trusting the port:

```bash
ss -ltnp | grep :8787   # confirm the workerd PID is the one you just started
```

## Cross-references

FOLLOW-471 · FOLLOW-560 · FOLLOW-816 · FOLLOW-817 · FOLLOW-818 · FOLLOW-820 · FOLLOW-822 (the drift
in §4.1) · FOLLOW-875 (the AC(1) correction) · FOLLOW-876 · FOLLOW-1072 (the AC(3) causal
correction) · FOLLOW-212 (calibration) · **FOLLOW-1075 (AC(5)'s second blocker + the AC(1)
verdict-string fix, §4.1/§5.2)** · `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §3.5 / §3.8 / §7 /
§9.1 / §9.2 · Rule Q · Rule AR · Rule AY · RETRO-301 §4a LG-2 / §4b BUG-1
