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

|                                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Harness**                          | Written, committed, reviewable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Executed end-to-end?**             | **YES — most recently 2026-09-20T14:01:17Z at `241e762b`** (FOLLOW-1185, §5.10), against the real control plane on `:3000`, ingest on `:8787`, fixture on `:5173` — the exact §3 ports. Artefact verdict pasted in §5.10: `[FRESH] … commitsBehind=0, measuredPathsChanged=0`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Result**                           | **CHAT ARM (2026-10-04, §5.18, graded SHA `4d683fe0`, FOLLOW-1299): AC(8) is in the harness and the TALLY now counts 7.** Runs 8–10 (and 11) read `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` consecutively on one un-restarted control plane; run 12, with the shim stopped, read AC(8) RED at hop 3. Read §5.18's four caveats and §6.11 (the control plane's Redis and its `:8078` adapter are new on localhost) before citing it; FOLLOW-820 is the CEO's ruling. **CONDITION-1 SERIES BEFORE IT (2026-09-22, §5.17, graded SHA `bb1532a0`): citable series NO.** The second graded series under the CEO rulings (§3.6), on one un-restarted control plane: GREEN, GREEN, RED, GREEN, RED, GREEN over the 6-run budget, 0 UNMEASURED, longest GREEN streak 2. Both reds are AC(1)+AC(7): the quiz turn came back `playbook_fallback_llm_unavailable` / `fact_check_refused` because the model kept `yield_hunter`'s authored `feature` label "Investment Performance" (`hallucinated_proper_name`, judge-confirmed) → **FOLLOW-1251**, which recurred 2 of 6 and is now the only cause blocking a citable series. AC(2), AC(3), AC(4) and AC(5) passed on all six runs (`tokens_in` 789). FOLLOW-1252's AC(5) poll held, including through a re-sent `cta.clicked` batch; §6.10 counted 4 proxy 503s and 0 `Reloading local server`. New: FOLLOW-1255 (harness timing on `Date.now()`), FOLLOW-1256 (unformatted price in served copy). **FOLLOW-820 condition 1 is NOT satisfied yet.** **Previous (2026-09-22, §5.16, graded SHA `d7e8ad26`): citable series NO.** It was the first graded series under the CEO rulings (§3.6), run on one un-restarted control plane: GREEN, GREEN, RED, GREEN, GREEN, RED over the 6-run budget, 0 UNMEASURED, longest GREEN streak 2. AC(1), AC(2), AC(3), AC(4) and AC(7) passed on all six runs (`llm_tweaked`, `tokens_in` 789). Both reds are AC(5) `thisRunConversions=0`: ingest (workerd) answered 503 to the `cta.clicked` batch, the SDK's FOLLOW-1242 re-send delivered it 7.9–8.15 s after the click, and the harness counts once at 7 s → **FOLLOW-1252**. The conversion was not lost. The §5.15 risks did not recur: 0 rollup 500s, 0 `fact_check_refused` (FOLLOW-1250, FOLLOW-1251). **FOLLOW-820 condition 1 is NOT satisfied yet.** **Previous (2026-09-21, §5.13, at `0025663f`, context only per the 2026-09-22 ruling): 6 / 6 on all three consecutive runs against one un-restarted control plane** — AC(1) `llm_tweaked` every run, PG client connections flat at ≤2 (FOLLOW-1241 closed). Not exercised by these runs: a holdout draw (FOLLOW-1240) and a dropped `cta.clicked` (FOLLOW-1242) — a later red from either is a known cause, not a regression. The rows below are history. **Previous (2026-09-20, §5.10, the FIRST run graded by the current AC(1) and AC(7)): 4 / 6.** PASS: AC(2), AC(3), AC(4), AC(5). **RED: AC(1), AC(7)** — one cause, `source: playbook_fallback_llm_unavailable`, `fallback_reason: listing_context_unavailable`: localhost serves no listing facts (`ESTALARA_BACKEND_URL` unset → `http://localhost:8081`, which §3 never starts) → **FOLLOW-1225** (P1) / **FOLLOW-1226**. `outcomes.adapted = 0`, so **FOLLOW-820 condition 1 is NOT satisfied today**. AC(2)'s green is a TEMPLATE `cta` (`fromAdaptedResponse: false`). The historical row below is kept as the record of what §5.9 measured. ⚠️ **Grading caveat, 2026-09-13 (FOLLOW-1197):** that tally was graded by the AC(1) predicate that #894 (FOLLOW-1186) retired, and by an AC(7) that cannot fail on the fixture tenant (FOLLOW-1196). §5.9 recorded an `llm_tweaked` source and cannot be re-graded, because its artefact was overwritten. **Superseded 2026-09-20 (FOLLOW-1185): a run HAS now been graded by the current AC(1) — §5.10, and it is 4 / 6.** Cite §5.9 as "recorded `llm_tweaked`", not as "6 / 6". Recorded tally: **6 / 6 green (§5.9, FOLLOW-1139), the first fully green run.** PASS: AC(1), AC(2), AC(3), AC(4), AC(5), AC(7). RED: **none.** AC(2) went green with `changedSlots: ["headline","cta","feature"]` and a headline reading `Rental Yield: 7.2% \| Gross Income: $27,600/yr` — real client-side interpolation of a real served template. **Read §5.9 before quoting this row:** AC(2) is green because the FIXTURE was completed, and the fixture now DIVERGES from the pilot page on purpose. The tenant-facing half of the same defect is open (**ESC-074 / FOLLOW-1140**). |
| **AC(5) red-first**                  | **Proven by EXECUTION on the PERSISTENT substrate (§5.5)** — 11 pooled sessions in the window. With the CTA attribute removed, every condition of the OLD predicate still held (`ctaLift -54.5`, `adaptedConversions: 5`) while the new one went RED on `thisRunConversions=0`. Green restored, fixture byte-identical.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **AC(7) red-first**                  | **Proven by EXECUTION, both directions (§5.6).** Same mirrored profile in both arms; only `holdout_pct` differs. `0` → `drewHoldout false`, control served **3** directives → RED. `1` → `drewHoldout true`, control served **0** → GREEN. Adapted arm **4** throughout. That adapted-side count pools directives including `reorder`, so it proves nothing about adaptation (FOLLOW-1196).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **AC(2) red-first**                  | **Proven at the SDK layer, both directions (§5.9).** `follow-1139-fixture-contract.test.ts` reads the REAL fixture off disk and applies the REAL `yield_hunter` playbook through the REAL `applyDirectives()`: 6/6 failing before the fixture edit with the SAME skip-reason set the §5.8 harness run recorded (`unresolved_token_yield`, `unresolved_token_income`, `no_slot_elements` ×2), 6/6 passing after. The harness run itself is the end-to-end confirmation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **AC(6) branch taken**               | Documented manual runbook (§3), **MANUAL** — corrected against a real run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Evidence pasted from a real run?** | **YES — §5**, verbatim. That is the whole of the reachable evidence: `last-run.json` is **`.gitignore`d by design** and exists only in the tree that produced the run, so it is NOT citable to a reader at HEAD and is no longer cited as if it were (FOLLOW-1080, closed here).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### ⚠️ WHAT FOLLOW-820 MAY AND MAY NOT TAKE FROM THIS FILE

**The GO conditions and their status are NOT restated here (2026-09-24, FOLLOW-1258).** Definition
of record: `docs/MASTER_DESIGN.md` §P.0 (condition 1 = this harness's AC(1) + AC(7) under the
2026-09-22 series rule, graded by the `TALLY` line; condition 1b = the chat arm, AC(8), in this
harness since FOLLOW-1299 (§1, §5.18, §6.11); condition 2 = FOLLOW-815, DONE). Status of record:
§Snapshot.0 "Status at HEAD". The CEO rulings ESC-073 (condition 1 does not read `ctaLift`;
FOLLOW-1130 is the business proof and does not gate GO) and D1/D2 of 2026-09-24 are transcribed
there, not here.

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
`confidence = 1.0` (the pre-Q4 fold; since FOLLOW-1359 a confirmed leaf is sent at 0.90 and an
unconfirmed one at 0.72) with directives > 0, so the harness's own verdict now reads _"behavior
alone did NOT clear the gate; quiz input was REQUIRED (confirms runbook §9.2)"_ — the judgement §9.2
made on paper, now measured. See §5.3.

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
`last-run.json`, and `adaptedArmDrewHoldout=true` is pushed into AC(5)'s `unmetPreconditions`.
**Since FOLLOW-1240 the tally says so too:** such a run prints `TALLY … run=UNMEASURED` and grades
AC(1), AC(2), AC(5) and AC(7) `UNMEASURED` rather than FAIL (rules and line format in §3.6). Before,
it printed `2/6 acceptance criteria green`. A FOLLOW-820 grader reads the `TALLY` line or
`grade.runVerdict`; **an UNMEASURED run is neither a pass nor a fail — re-run it.**

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
before/after Beta pair). **As of §5.10 (2026-09-20, `241e762b`) the red set is AC(1) and AC(7), for
one cause named there and ticketed as FOLLOW-1225.** As of §5.9 no AC was red, but that run does NOT
by itself satisfy FOLLOW-820 condition 1 (corrected 2026-09-13, FOLLOW-1197): it was graded by the
pre-#894 AC(1) and by the pre-#899 AC(7), which could not fail on the fixture tenant. On a run at
HEAD, clause 1 is decided by `results[AC(1)].evidence.outcomes.adapted` > 0 (equal to AC(1)'s `ok`
since #904) and clause 2 by AC(7)'s `ok`, each cited with the artefact's pasted `--check-staleness`
verdict line (MASTER_DESIGN §P.0 item 1, updated 2026-09-14 by FOLLOW-1209). The red ACs are named
here rather than counted, because the count is what went stale across three regenerations of this
section — and when the set is empty this sentence says so rather than reporting a number. **What a
grader must still weigh is in the AC(2) caveat above:** hop 10 is proven, tenant-page readiness is
not, and that half is open as ESC-074 / FOLLOW-1140.

The harness is deliberately **not** a `*.spec.ts`. A discoverable spec would be collected by a CI
runner and reported as a SKIP that reads as a pass. It is an `.mjs` script that hard-fails on an
absent substrate and exits non-zero.

---

## 1. What it asserts

Each AC is recorded independently — one red does not mask the others.

| AC       | Assertion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Guarded against                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(1)**  | **At least one real `/api/adapt` response that was ADAPTED** (`evaluateAc1()`, FOLLOW-1186 / #894), meaning all of the following on that same response: `source` ∈ {`llm_tweaked`, `llm_full`}, a non-neutral archetype, `confidence` **strictly >** the server `CONFIDENCE_THRESHOLD`, and **≥1 non-`reorder` directive**. Prints `N of M responses adapted`. The evidence carries `outcomes` (`adapted` / `llmNotQualifying` / `refused` / `outage` / `template` / `default` / `other`) and `sourcesObserved`, and FOLLOW-820 condition 1 grades `outcomes.adapted`. Since FOLLOW-1205, `outcomes.adapted` is the count of responses passing all four conditions, so it is `> 0` exactly when AC(1) is green; before, it counted every `llm_*` source and could read 1 on a red run. This replaced the pre-#894 predicate `nonNeutral && peak > gate && totalDirectives > 0`, kept only as `legacy` reporting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | The threshold is read out of `route.ts` **at run time**, value _and_ comparison operator, so it cannot drift away from the gate that actually decides (FOLLOW-875). A withheld template `cta`, a fact-check refusal, an LLM outage or a `default` + `reorder` response cannot turn it green, and an empty population is RED                                                                                                                                                                                                                                                                                                                                                       |
| **(2)**  | An observably adapted DOM — a `[data-estalara-slot]` text actually changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Distinct from (1): the only assertion that catches directives that arrive but are never painted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **(3)**  | An `adaptation_decisions` row for this session carrying the FOLLOW-560 scoring path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Tells real cosine ranking from a stable djb2 hash shuffle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **(4)**  | A feedback-driven `ab_bandit_weights` Beta delta — **or, while the bandit is frozen (FOLLOW-1286, D3; `BANDIT_ENABLED` off, the default), the freeze itself:** the ping refused as 404 `bandit_disabled`, no arm moved, and every served and logged `variant` = `control` (`mode: bandit_frozen` in the evidence); a holdout draw is UNMEASURED (series rule (2)), pinned by `ac4-verdict.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Polls Postgres for the real state change; a 202 alone is never accepted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **(5)**  | A lift number from real substrate rows via the **existing** analytics path, computed from the caller class (`conversion_source: 'signed_events'`), AND this session's own **server-confirmed conversion** (FOLLOW-1203; CEO decision #4, ESC-084): after the real `cta.clicked` row has landed (the funnel hop, read by a poll whose budget is the SDK's retry schedule, FOLLOW-1252), the harness asks the `:8081` fixture host backend to confirm it; the backend SIGNS an `inquiry.completed` and POSTs it to ingest; AC(5) is GREEN only when a signed row for this `session_id` (FOLLOW-1124) was received at or after the session's first decision. A run whose only conversion is browser-emitted (unsigned) is **RED** (`thisRunConversionLoss=only_unsigned_conversion`), and so is a run whose click never landed (§1.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **Asserts `data_source === 'clickhouse'` first** — see §2. A `cta.clicked` or an unsigned conversion cannot turn it green, `conversion_source: 'disabled'` is RED, and the harness holds no signing secret (`confirmed-conversion.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **(6)**  | Runs in CI, or a documented manual runbook with pasted evidence labelled MANUAL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | §0 + §3 + §5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **(7)**  | The holdout MECHANISM **separates the arms**: the control session received **zero** directives and the adapted session received **at least one response that passes AC(1)'s predicate** (`evaluateAc7()` calls `isAdaptedResponse()`; corrected 2026-09-13, FOLLOW-1205 — this row said "> 0" directives, the pooled count #899 retired because it includes the `reorder` every non-holdout response carries) — **discharges ESC-073 clause 2**, the second half of FOLLOW-820 condition 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | The control call **mirrors the profile of the FIRST adapted response** (`selectProfileResponse()`, FOLLOW-1196), and AC(7) refuses a control call that mirrored anything else. Holdout assignment is NOT the only difference between the two sessions: `driveHoldoutArm()`'s docblock lists four axes the mirror does not equalise (corrected 2026-09-13, FOLLOW-1205). Without that mirror the control session is `neutral` and receives zero directives **in either arm** — an assertion that cannot fail (FOLLOW-1131)                                                                                                                                                         |
| **(8)**  | **The chat arm (FOLLOW-1299; FOLLOW-820 condition 1b).** In its own fresh browser session with no quiz answer, one scripted rental-yield message is dispatched as the host page's `estalara:chat:message-sent` CustomEvent and travels seven hops, each asserted on its own and printed as `[chat-arm] hop n …`: (1) the SDK POSTs `chat.message.sent` with that text, (2) ingest answers 2xx, (3) the shim on `:8090` is reachable, (4) the shadow key for this session carries a new `detected_at`, (5) an `/api/adapt` response carries `chat_intent_dimensions` with that stamp, (6) the next `/api/adapt` request — the one the SDK itself issues after the carrier, on the same page view, no reload (FOLLOW-1301) — sends `archetype_hint: yield_hunter`, (7) its response says `archetype: yield_hunter`. **Hops 1–7 move the label only (one message lands at ~0.37, under the 0.6 gate); since FOLLOW-1302 (CEO ruling 2026-10-05, proposal 1) condition 1b is graded on a SECOND consistent rental-yield message that changes a dimension (`finance_complexity` `standard_mortgage` → `investment_vehicle`):** (8) it is POSTed and ingest answers 2xx, (9) the shim writes a record with a NEW `detected_at`, (10) an `/api/adapt` response carries that stamp, (11) the SDK's own follow-up call (FOLLOW-1306: drawn when the fold crosses the gate) sends a confidence above the server gate, (12) a response to a call after that carrier passes AC(1)'s `isAdaptedResponse()` — and the page is never navigated after the baseline view (no reload). GREEN also needs the baseline archetype (before any message) to differ from `yield_hunter`, and the **negative control**: a neutral message, sent first and proven processed by its cold-key shadow record, leaves every archetype the SDK's own chat-refresh calls are served equal to the baseline (`evaluateAc8()`, pinned by `ac8-verdict.test.ts`, which also pins what the second extraction must contain to cross the gate — gap candidate G-04) | Nothing is POSTed to ingest by the harness and no archetype or dimension is injected: the hint in hop 6 is the SDK's own fold of the shim's own extraction. A session that was `yield_hunter` all along, a dead shim (the neutral control then proves nothing and is RED, not green) and an SDK that draws no call after the fold (hop 6: "no /api/adapt request was issued", the pre-FOLLOW-1301 behaviour) all fail it; so does a moved label with nothing adapted (the recorded negative case, §5.21: the first extraction twice folds to 0.403 live, under the gate on the same archetype, so the SDK draws no follow-up call — hop 11). The first failing hop is `brokenHop` |
| **(10)** | **The quiz confirmation path (FOLLOW-1361; Faza Q, MASTER_DESIGN §E.4.10; checkpoint KQ1).** Three fresh sessions walk the SERVED quiz tree to its result screen and close it three ways: (a) confirm, (b) "Not quite" + an alternative read off the DOM, (c) ×. Graded on the `quiz_runs` row, the SDK's persisted state, the first `/api/adapt` request after the fold and its response (AC(1)'s `isAdaptedResponse()`). `evaluateAc10()`, pinned by `ac10-verdict.test.ts`; see §1.2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Which request hops 6 and 11 grade (FOLLOW-1352).** The follow-up is the first `/api/adapt` request
SENT AFTER the carrier was answered and after the SDK's own persisted state shows
`chatPriorAppliedAt === <the carrier's stamp>`, not "the next request by sequence number"
(`pickFollowUpAfterCarrier()`, pinned by `ac8-verdict.test.ts`). The old pick graded a request that
a parallel chat-refresh chain had sent while the carrier was still in flight: at the K3 run 2 it was
issued 1889 ms before the carrier was answered, so it carried the pre-fold confidence (0.367)
although the SDK had already folded to 0.664, and the page was closed before the real follow-up. The
pick runs on monotonic stamps (`performance.now()`; the wall-clock stamps stay as evidence, §5.18),
the page stays open for the SDK's chat-refresh debounce plus slack measured from the fold
(`CHAT_REFRESH_DEBOUNCE_MS`, `packages/sdk/src/core/adapt-loop.ts`), and if no such request exists
the hop is BROKEN with a `TIMING:` reason that names the early request(s), never a silent pass. The
0.6 gate, AC(8)'s definition and the negative control's wait are unchanged. The overlap itself is an
SDK defect (two chat-refresh chains), fixed separately.

### 1.1 AC(5)'s this-run read and how long it waits (FOLLOW-1252; the conversion: FOLLOW-1203)

**Two hops since FOLLOW-1203, in this order.** (1) The CLICK: the real `[data-estalara-cta]` is
clicked and its `cta.clicked` row is polled for, exactly as described below. It is a funnel stage,
no longer the conversion, but it stays a precondition: the conversion is requested only once the
click's row has landed, so the §5.5 negative control (CTA attribute removed) still reds AC(5) with
`cta_not_sent`. (2) The CONVERSION: the harness POSTs
`{"session_id": …, "type": "inquiry.completed", "listing_id": …}` to
`http://localhost:8081/fixture/confirmed-conversion`; the fixture host backend signs one event
(FOLLOW-1201's scheme) and sends it to the real ingest Worker, which writes it with
`caller_signed = 1`. The harness then polls (10 s) for a signed row and, at AC(5), reads
`adaptedArm.thisRun`:

| `thisRun` field       | Meaning                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `conversions`         | **The verdict.** Signed `inquiry.completed` / `live.signup` rows received at/after the first decision |
| `ctaClicks`           | `cta.clicked` rows (the funnel hop)                                                                   |
| `signedConversions`   | Signed conversion rows, whenever received                                                             |
| `unsignedConversions` | Browser-emitted conversion rows: accepted by ingest (ESC-084), never counted                          |

`conversions = 0` adds `thisRunConversions=0` and one loss kind. The three click kinds in the table
further down apply when the click's row never landed; when it did, the kind is one of:

| `lossKind`                                | Meaning                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `confirmed_conversion_not_requested`      | The harness never asked the host backend (the reason is in the cause)                  |
| `conversion_emitter_failed`               | The fixture backend did not get the signed event accepted (its status is in the cause) |
| `signed_conversion_row_never_landed`      | Ingest accepted the signed event; no signed row reached ClickHouse                     |
| `signed_conversion_before_first_decision` | A signed row exists but precedes the first decision: pre-exposure, not a conversion    |
| `only_unsigned_conversion`                | The only conversion rows are unsigned. This is the red-first control below             |

**Red-first control (one command).** `FOLLOW1203_REDFIRST_UNSIGNED_CONVERSION=1` makes the adapted
session convert the pre-FOLLOW-1203 way: the harness POSTs the `inquiry.completed` itself with the
page key and an `Origin`, no signature. Ingest answers 200 and AC(5) must be RED with
`only_unsigned_conversion`; the knob is recorded (`confirmedConversion.mode`,
`redFirstUnsignedConversion=engaged`) and AC(5) cannot pass under it. §5.22 has the executed run.

**The Playwright "element is not stable" flake on the CTA click (2 of 10 runs in the FOLLOW-1220
series) can still red a run.** The click is still a required hop, so a click that Playwright refuses
means no `cta.clicked` row, no conversion request, and AC(5) RED with
`confirmed_conversion_not_requested` / `cta_not_sent`. FOLLOW-1203 did not change that.

After the harness clicks the real `[data-estalara-cta]`, it polls ClickHouse every 500 ms for
`events` rows with this `session_id` and `type = 'cta.clicked'`. It never filters by `tenant_id`
(§5.5). The poll stops when the count is ≥ 1 or the budget runs out. Green runs stop as soon as the
row appears.

**The budget is read from the SDK source at run time** (`deriveAc5PollBudget()`), never typed into
the harness:

- `BATCH_INTERVAL_MS` comes from `packages/sdk/src/index.ts` (5000 at `d7e8ad26`).
- `MAX_FLUSHES` and the power-of-two re-send predicate come from `dispatchEvents()` in
  `packages/sdk/src/core/events.ts` (16 at `d7e8ad26`). A refused batch is sent on flushes 1, 2, 4,
  8 and 16, and then dropped.
- A click just after a flush is first sent one interval later, so the last send goes out at most 16
  × 5000 = 80000 ms after the click.
- `INGEST_TO_CLICKHOUSE_SLACK_MS` = 5000 is added. This is the one harness number: run 6's ingest
  log shows 26 ms from `events_accepted` to `clickhouse_push_ok_post_ack`.
- **Budget: 85000 ms at `d7e8ad26`.** If the SDK source stops matching the shape the reader expects,
  the reader throws rather than guessing.

The old read slept `BATCH_INTERVAL_MS + 2000` = 7000 ms and counted once. That covers only a batch's
first send. In §5.16 (added by PR #930), runs 3 and 6 were RED because the re-sent conversion landed
at 7.9 s and 8.15 s.

**A real loss is still RED.** If the budget runs out with no row, AC(5) fails with
`thisRunConversions=0` as before. It also gets `thisRunConversionLoss=<kind>`, read from this run's
own ingest records:

| `lossKind`                         | Meaning                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `cta_not_sent`                     | No ingest POST carried this session's `cta.clicked`. This is also the §5.5 negative control, where the CTA attribute is removed. |
| `no_ingest_2xx_for_cta_batch`      | Batches carried it, but none got a 2xx. The cause lists each send's status or network error.                                     |
| `ingest_accepted_row_never_landed` | Ingest answered 2xx, but no row reached ClickHouse.                                                                              |

**What the artefact records.** `results[AC(5)].evidence.adaptedArm` holds three objects:

- `ac5Poll`: `attempts`, `waitedMs`, `budgetMs`, `landedAtMs` (when the poll first saw the row, at
  most 500 ms after it landed), `unreadableReads`, and `budget` (the SDK constants behind it).
- `ctaIngest`: each POST that carried the `cta.clicked`, with its status or `failure`;
  `ctaBatchAccepted`; `ingest5xx`; `ingestFailedAtNetwork`; and `resent`/`resentFirstEventIds`. A
  re-send shows up as the same first `event_id` twice in `emitted[]`.
- `conversionLoss`.

The top level holds `ingestPosts[]` and `ac5Poll`. A 503 without CORS headers never reaches the
browser's `response` event. It shows up as `requestfailed` `net::ERR_FAILED`, so it is counted in
`ingestFailedAtNetwork`, not in `ingest5xx`. Only the Worker log shows the status itself.

**Cost:** a run that really lost its conversion now waits up to 85 s longer before AC(5) reports.
Pinned by `ac5-conversion-poll.test.ts`.

### 1.2 AC(10), the quiz confirmation path, and the KQ1 rule (FOLLOW-1361, FOLLOW-1367)

**Why it exists.** Faza Q (`docs/PLAN-QUIZ-ACCURACY-2026-10-19.md` §B, MASTER_DESIGN §E.4.10) gives
the quiz a result screen ("Based on your answers: **{name}** — … Is that right?"). Since FOLLOW-1359
the leaf folds at **0.72** when the buyer reaches it without confirming (× or no confirmation step)
and at **0.90** when they confirm it or correct it to an offered alternative; a confirmed leaf is
anchored against behaviour and tempers chat by τ = 0.5. Since ESC-087 (CEO 2026-10-20, option 1) the
SDK SENDS `similarity = min(posterior, 0.85)`, so a confirmed 0.90 session stays on the LLM branch
(`llm_tweaked`) instead of the template branch 2. AC(10) is the end-to-end proof of that path; AC(1)
only proves that one quiz session got adapted copy.

**The three sub-sessions** (`driveAc10()`; each a fresh browser context after the chat arm, so none
of their responses enters AC(1)'s population):

| Sub-session                  | The buyer                                                                   | GREEN needs (`evaluateAc10()`, unmet entries prefixed `a:` / `b:` / `c:`)                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) confirm**              | walks the tree (first answer each step), clicks "Yes"                       | a `quiz_runs` row `confirmed` with `confirmed_archetype` = the leaf, on the SERVED `definition_hash`, with one `step_ms` entry per answered question; the SDK state at the leaf at 0.90 (`quiz_confirmed`); the first request after the fold carrying the leaf, confidence 0.90 and similarity 0.85, answered ADAPTED for that leaf; then two contrary `estalara:listing:favorited` signals reach the SDK and the leaf keeps 0.90 |
| **(b) correct**              | walks the same way, clicks "Not quite", picks the first offered alternative | a row `corrected` with `resolved_archetype` = the walked leaf, `confirmed_archetype` = the chosen one and `offered` = the alternatives the DOM showed; the SDK state at the chosen archetype at 0.90; the first request after the correction folded carrying the CHOSEN hint at 0.90 / 0.85, answered ADAPTED for the chosen archetype (STOP rule: not serving the correction = the path is broken)                               |
| **(c) ×** (negative control) | walks the same way, closes the result screen with ×                         | a row `unconfirmed` with a null `confirmed_archetype`; the SDK state at the leaf at 0.72, not confirmed. A × must never read as a confirmation                                                                                                                                                                                                                                                                                    |

**Nothing is injected.** The leaf, the offered alternatives and the chosen one are the widget's own
text, mapped to archetype ids through the served definition's `confirm.names_i18n` (any language; an
ambiguous name maps to nothing). The row is read from Postgres (`quiz_runs`, `DATABASE_URL_ADMIN`,
`readQuizRunsForSession()` in `bandit-probe.mjs`), i.e. what `POST /api/quiz/run` wrote from the
SDK's pings. The state is the SDK's persisted `estalara_intent_{session}` envelope, read only, the
way AC(8) reads it. The contrary signals are the host page's own `estalara:listing:favorited`
CustomEvent (a 3-bedroom bookmark, or a commercial one when the leaf is `family_buyer` / `upsizer`),
and they count only if two `listing.bookmarked` events reached ingest AND `signal_count` rose by
two. The masses (0.72, 0.90) and the cap (0.85) are read from the SDK source at run time
(`readQuizFoldConstants()`), and `ac10-verdict.test.ts` checks them against `applyQuizLeaf()` and
the route's `HIGH_SIMILARITY_THRESHOLD`.

**Which request is "the first after the fold".** `intent-loop.ts` folds the result, persists it and
calls `adapt.refresh()` unconditionally in the same click task, for every outcome; a correction
draws no extra chat-style follow-up. A poll of the persisted state can therefore never see the fold
before that request leaves, so FOLLOW-1352's "sent after the fold was seen" floor would exclude the
very request it looks for. The pick (`pickFirstRequestAfterQuizFold()`) uses the state stamp the
request itself carries: the fold writes `quiz_traits`, and `fetchDirectives()` sends `traits` iff
the state has them. The graded request is the first one SENT at or after the decisive click whose
body carries `traits`, and only once the persisted state showed the fold. It refuses with a reason
(never a guess) when the fold was not observed or a request sent before the click already carried
`traits`. It never selects on the hint or confidence it grades, so "the follow-up carries the
pre-correction hint" stays a reachable RED.

**Holdout.** (a) and (b) need an adapted response, which a held-out session cannot get. The draw is
read off the page-load response before the quiz is walked, and a held-out session is replaced by a
fresh one, at most `AC10_MAX_DRAWS` (3) per sub-session; every draw is in `sessions.*.draws`. Only
when the last draw is still holdout is AC(10) `UNMEASURED:holdout`, and only if nothing else is
unmet. (c) grades no adaptation and keeps its first session. Each draw leaves a `quiz_runs` row: a
redrawn session leaves a `shown` row, the others one row per terminal status.

**TALLY.** Since FOLLOW-1361 the run grades eight ACs (`GRADED_ACS`: 1, 2, 3, 4, 5, 7, 8, 10; AC(6)
is this manual runbook and is never recorded), so a full run prints
`TALLY green=… red=… unmeasured=… total=8 run=…`. A graded AC a run did not record is recorded RED
(`notEvaluated`), so a skipped AC can never shrink the total. Every artefact written before this
change reads STALE under `--check-staleness` by design (the harness is a measured path).

**KQ1.** Checkpoint KQ1 (MASTER_DESIGN §E.4.10) needs **three consecutive `run=GREEN` with
`total=8`, each `[FRESH]`, on ONE SHA**, on one control plane that was not restarted between them,
under the series rules above (§3.6: a `run=RED` resets the streak, a `run=UNMEASURED` neither counts
nor resets it). STOP rule: AC(10)(b) not serving the corrected archetype means the correction path
is broken and blocks the merge.

**FOLLOW-1367, two bring-up and harness changes.**

- **AC(5) no longer clicks under the quiz card.** In one Q5-series run AC(5) read `cta_not_clicked`:
  the served card was still open over `[data-estalara-cta]`. Before the click,
  `closeQuizCardBeforeCta()` waits up to 2 s for the card to unmount on its own, then closes it with
  its own × and waits up to 10 s for it to be gone. Never `force: true` (FOLLOW-1075). What happened
  is recorded as `results[AC(5)].evidence.adaptedArm.quizOverlayBeforeCta` (`visibleBefore`,
  `screen`, `action` ∈ `none` / `waited` / `closed_with_x`, `cleared`).
- **`localhost-up.sh` step 10 warms `GET /api/quiz/public-config`** with the fixture page's key and
  `Origin` (180 s budget for the cold compile, measured at 4–27 s), then runs the harness's own
  `assertServedQuizConfig()` inside 8 s: 200, `data_source: 'db'`, a sha-256 `definition_hash` and a
  `confirm` block. Anything else fails the bring-up loudly, because the SDK would show no quiz card
  (it has no built-in tree since FOLLOW-1370) and AC(10) would be RED for a substrate reason.

## 2. The assertion that matters most, and why

`getTenantAnalyticsRollup()` falls back to `buildMockRollup()` when either store is unconfigured,
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

## 3. Bring-up: ONE command (FOLLOW-1261); the MANUAL runbook below is what it does

```bash
scripts/dev/localhost-up.sh                      # bring up + warm + preflight; fails loudly at the first bad step
node tests/e2e/follow-819/differentiator-e2e.mjs # env: the script prints the exact block when it finishes
scripts/dev/localhost-down.sh                    # stops exactly what the up script started (PID files)
```

`localhost-up.sh` is idempotent, caps every Node process at `--max-old-space-size=2048`, builds with
`--concurrency=1`, keeps logs and PID files in the gitignored `.localhost-up/`, and covers §3.1-§3.5
below plus the chat hop (SRH `:8079`, the shim `:8090`, and since FOLLOW-1299 the Redis path adapter
`:8078` with `UPSTASH_REDIS_URL` on the control plane, §6.11; `SKIP_CHAT=1` omits all of it and
AC(8) is then RED by design), §6.5 (control plane started from `apps/control-plane`, not via Turbo),
§6.6 (route warm-up), §6.8 (refuses a foreign owner of `:8787`) and §6.9 (refuses a `dist` that
resolves outside this checkout). It ends by importing the harness and running its own
`assertRealControlPlane()`, `assertDemoModeOn()`, `assertGroundingSource()`,
`assertIngestReachable()` and (FOLLOW-1203) `assertConversionEmitter()`. It is inside
`HARNESS_TREE_PATHSPEC`.

**The server-confirmed conversion needs four things the script wires (FOLLOW-1203, §3.3c):**
migration 0024 on the local ClickHouse (step 3, `migrate.sh`); `CALLER_SIGNED_COLUMN_ENABLED=true`
on BOTH the ingest Worker (it writes `events.caller_signed`) and the control plane (its lift readers
read it); a LOCAL HMAC secret, generated once into `.localhost-up/fixture-server-hmac-secret` and
never committed; and a second KV record, `api_key:pilot-server-key`, carrying that secret. Missing
any one, AC(5) is RED and says which (`conversion_source=disabled`, `conversion_emitter_failed`, or
the preflight refuses to start).

**The `listing.updated` webhook works locally since FOLLOW-1314 (§6.14, §6.15).** The script
generates a LOCAL `LISTING_UPDATED_WEBHOOK_SECRET` the same way as the conversion signing secret —
once, into `.localhost-up/listing-updated-webhook-secret` (32 random hex bytes, never committed,
never a production value) — and passes it to the control plane. `POST /api/webhooks/listing-updated`
with `X-Webhook-Secret: $(cat .localhost-up/listing-updated-webhook-secret)` then advances
`listing_revisions.revision` for the listing (FOLLOW-1291's fence), and the next description request
regenerates at the new revision. The script prints the exact `curl` when it finishes. A control
plane left running from an older bring-up has no secret and still answers 401: run
`localhost-down.sh` first.

**`DEMO_MODE=1` on the control plane is required (FOLLOW-1288).** Since WP-2.3 the demo-JWT and ops-
caller auth variants of `POST /api/adapt` exist only when the control plane runs with `DEMO_MODE=1`
(read in one place, `apps/control-plane/src/lib/demo/demo-mode.ts`). The harness's control arm sends
the `ADAPT_API_KEY` ops bearer to force `holdout_pct: 1`, so without the flag every control-arm call
401s and AC(4)/AC(7) would look like a broken differentiator. `localhost-up.sh` therefore starts the
control plane with `DEMO_MODE=1` (`DEMO_MODE=` empty starts it without, for a red-first check), and
the harness's preflight `assertDemoModeOn()` — run by `main()` and by the script's step 11 — sends
the ops bearer with an empty body and refuses anything but `400 Validation failed`; with the flag
off it throws `[demo_mode_off]` before the browser launches. The FOLLOW-1205 fixture-key probe
cannot see this state (the tenant key authenticates either way), which is why it is a separate
probe. A manual §3.4 start must add `DEMO_MODE=1` to its `env` list.

**A graded series (FOLLOW-820 condition 1 / 1b) copies the artefact after EVERY run.** The harness
overwrites `tests/e2e/follow-819/last-run.json` each time, so after each run, before the next:

```bash
cp tests/e2e/follow-819/last-run.json <scratch>/runN.json
node tests/e2e/follow-819/differentiator-e2e.mjs --check-staleness <scratch>/runN.json
```

and paste the `TALLY` and `[FRESH]` lines per run (§5.19 is the series that skipped it and is not
citable). Since FOLLOW-1302 the chat arm sends THREE messages on one page view (neutral, then two
rental-yield questions) and waits for the second one's model-written response, so AC(8) needs the
shim's live Haiku extraction twice and the control plane's LLM path once more than before; it adds
roughly 30–60 s to a run.

The subsections below are **what the script does**, kept as the reference for each step and its
traps (they are also what `pathspec-grounding-server.test.ts` parses for START commands).

### 3.0 The MANUAL runbook (what the script does)

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

**Verified 2026-08-23 — corrected from `:9200` (§6.2).** The non-production browser-origin list
(since FOLLOW-1333 `packages/shared/src/browser-origins.ts`, read by both the control plane and the
ingest Worker; before it `CORS_DEV_EXTRA_ORIGINS` in `origin-policy.ts`) adds exactly
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

### 3.3b Grounding source — listing facts on `:8081` (FOLLOW-1225)

**Added 2026-09-20. Without this step AC(1) is unreachable, and that was measured, not reasoned
(§5.10).** `fetchListingJson()` (`apps/control-plane/src/lib/listing-details.ts:71`) reads
`ESTALARA_BACKEND_URL ?? http://localhost:8081`; before this step nothing in §3 started anything
there, so the control plane logged `[listing-details] fetch failed: fetch failed`,
`groundingMissing` went true (`route.ts:2008`) and every adapted response came back
`playbook_fallback_llm_unavailable` / `listing_context_unavailable` with `outcomes.adapted: 0`.

```bash
node scripts/dev/fixture-listing-details-server.mjs   # :8081, PORT / FIXTURE_PATH to override
```

Verify before starting the control plane. This exact command and its answer were pasted 2026-09-22
(FOLLOW-1249; the 2026-09-20 answer carried `headline` and `description` only):

```console
$ curl -si "http://localhost:8081/api/v1/listing/details?listing-uuid=839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c&locale=EN"
HTTP/1.1 200 OK
content-type: application/json
x-estalara-facts-source: /home/asipi/Projects/Adaptive-Listings/.claude/worktrees/agent-a6c3789a6a38bf7b7/tests/e2e/follow-819/fixture-listing.html
Date: Tue, 22 Sep 2026 10:07:27 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked

{"uuid":"839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c","headline":"9 Blackberry Pl, Palm Coast, FL 32137 — 3 bed, 2 bath","description":"A three-bedroom, two-bathroom single-family home on a quiet residential street. Open-plan living area, attached two-car garage, screened lanai and a mature garden. Close to schools, the intracoastal waterway and local amenities.","price":385000,"currency":"USD","streetAddress":"9 Blackberry Pl","city":"Palm Coast","region":"FL"}
```

(The `x-estalara-facts-source` path is the checkout the server was started from — that run was from
a worktree. The header names the file, which is the point: grounding provenance on the wire.)

The transcript above is the 2026-09-22 payload, kept as recorded. FOLLOW-1317 renamed one field in
it: `streetAddress` → `publicLocationLabel`, same value. The backend's public detail DTO has no
`streetAddress` (`ListingResponseTO.kt:36-59`: address precision is gated behind
`locationDisclosureLevel` and published as `publicLocationLabel`), so the fixture had been grounding
on a field production cannot send — which is what the CEO ruling cited below forbids. Every run
recorded in this file before 2026-10-16 was measured on the old payload.

**What it serves, and why not more.** Exactly what `fixture-listing.html`, the page under test,
publishes, and nothing else: the `headline` and `description` slot text, plus the structured facts
the page publishes as `data-estalara-fact` elements (`price`, `currency`, `publicLocationLabel`,
`city`, `region`; added by FOLLOW-1249, `publicLocationLabel` renamed from `streetAddress` by
FOLLOW-1317). That is the whole field set `fetchListingTextFields()` reads into the `/api/adapt`
prompt, so the prompt carries `listing_title`, `listing_description`, `listing_price` and
`listing_location`, as production's does. CEO ruling 2026-09-22 (FOLLOW-820 condition 1): a
fixture-grounded run is GO evidence only once the fixture serves the grounding fields production
uses. `grounding-source.test.ts` derives that field set from the production reader at run time and
fails if the server serves a field the reader does not read, or (FOLLOW-1317) a field the backend
DTO does not carry; it stopped asserting plain set EQUALITY when the reader became tolerant of
several price and location shapes at once, since no single listing carries all of them. The fixture
listing is a synthetic listing whose facts ARE that page: a grounding source that knew a district or
a bedroom count the page never shows would let the model write copy the page cannot support, which
is the injection this harness exists to catch (ESC-076 / MASTER*DESIGN §E.7.0; FOLLOW-1225 scope:
*"do not hand-write facts into the prompt path to make AC(1) go green"\_). A fact enters the
grounding only by being published on the page first. Consequence to expect, not to fix here: the
page publishes no bedroom count, area, district or highlights, which feed
`fetchListingPlaceholderFacts()` rather than the prompt. So no `{bedrooms}` / `{sqm}` /
`{key_feature}` token resolves server-side, and a directive carrying one is discarded exactly as
against a thin real listing (FOLLOW-1018 / ESC-074).

**Why not the real Spring backend, which would be the better source.** It cannot answer for this
listing. Measured 2026-09-20:
`select count(*) from listing where uuid='839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c'` returns **0** in
BOTH local Estalara app databases (`estalara_postgres`, `estnew_postgres`) — `seed_listings.sql`
mints a fresh UUID per load, and the fixture's id is from an older seed — so a running backend would
404 the harness's listing. Our own Postgres has no listing text at all (`packages/db/src/schema`
holds `listing_embeddings` vectors only). If you DO bring the Java stack up
(`docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §3.1–§3.2) it owns `:8081` and this stand-in will refuse
to bind, which is the right outcome — but re-point the fixture at a listing id that backend actually
serves first, and re-seed `listing_embeddings` for it (§3.2) or AC(3) drops to `djb2_fallback`.

**Pass `ESTALARA_BACKEND_URL` to BOTH the control plane (§3.4) and the harness (§3.6).** The
harness's `assertGroundingSource()` probes the origin ITS process was given; two processes started
with different values means a green probe over an ungrounded control plane, and the only surviving
signal is `fallback_reason: listing_context_unavailable` on the adapted response.

### 3.3c The host backend confirms the conversion — signed, on `:8081` (FOLLOW-1203)

CEO ruling of 2026-10-13 (ESC-084, ruling 3): on localhost the fixture server of §3.3b, the stand-in
for the Estalara host backend, emits the server-confirmed conversion, and the harness triggers it.
Emission from the real host backend is a post-GO deployment step (MASTER_DESIGN §P.0).

The same process serves two more routes:

```text
GET  /fixture/confirmed-conversion   → 200 {"configured":true,"ingestUrl":"http://localhost:8787","signed":true}
                                       503 conversion_emitter_unconfigured when it has no signing env
POST /fixture/confirmed-conversion   {"session_id":"<32-64 chars>","type":"inquiry.completed"|"live.signup","listing_id":"…"}
                                     → 200 {"ok":true,"eventId":…,"ingestStatus":200,"sends":[…]}
                                       502 ingest_refused (ingest's own status and body attached)
```

The POST builds ONE event and sends it to `POST :8787/v1/events` as a server caller: no `Origin`,
`X-Estalara-API-Key: pilot-server-key`, and `X-Estalara-Signature: hmac-sha256:<hex>` over
`timestamp + "\n" + nonce + "\n" + body` (`apps/ingest/src/auth.ts`). A 5xx or a network failure is
re-sent up to three more times, freshly signed with the same `event_id` (§6.10: `wrangler dev`'s
proxy answers some POSTs 503 before the Worker sees them). Nothing is inserted into ClickHouse from
here, and the harness holds no secret.

The script starts the server with the env it needs (`localhost-up.sh` step 5):

```bash
INGEST_URL=http://localhost:8787 FIXTURE_SERVER_API_KEY=pilot-server-key \
FIXTURE_SERVER_HMAC_SECRET="$(cat .localhost-up/fixture-server-hmac-secret)" \
  node scripts/dev/fixture-listing-details-server.mjs
```

The secret is 32 random bytes, hex, generated by the script on the first bring-up
(`node -e 'crypto.randomBytes(32)…'`, file mode 600, in the gitignored `.localhost-up/`). It is a
local dev value and never a production one; it is reused across bring-ups so a server left running
and the KV record of §3.5 always agree. A fixture server started without it (by hand, or left over
from a checkout before FOLLOW-1203) answers the GET with 503, and both `localhost-up.sh` and the
harness preflight (`assertConversionEmitter()`) refuse to go on.

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
  DEMO_MODE=1 \
  ADAPT_API_KEY=local-follow819-key \
  ADMIN_API_SECRET=local-follow819-admin-secret \
  OPS_TENANT_ID=00000000-0000-0000-0000-0000000000e2 \
  DATABASE_URL_ADMIN="$DATABASE_URL_ADMIN" \
  ESTALARA_BACKEND_URL=http://localhost:8081 \
  SCORING_PATH_COLUMN_ENABLED=true \
  CALLER_SIGNED_COLUMN_ENABLED=true \
  CLICKHOUSE_URL=http://localhost:8123 \
  CLICKHOUSE_USER=default CLICKHOUSE_PASSWORD=clickhouse \
  pnpm dev
```

`ESTALARA_BACKEND_URL` is **load-bearing for AC(1)** and is the §3.3b addition: it is absent from
Doppler `dev`, so without this line the process falls back to `http://localhost:8081` — correct by
luck if §3.3b is running, but state it, because the whole point of §3.3b is that this variable is
the one nobody had set. It must name the SAME origin the harness gets in §3.6.

`ADAPT_API_KEY` and `ADMIN_API_SECRET` are **two different credentials** and the harness needs both:
`ADAPT_API_KEY` is the ADR-0015 ops bypass for `/adapt` + `/adapt/feedback` (AC(4)), while the AC(5)
rollup route is staff-gated by `verifyTracerAdminAuth`, whose Bearer path compares against
`ADMIN_API_SECRET`. Passing the adapt key to the rollup route 401s — a false RED.

> **⚠️ This block has no grounding source, and AC(1) cannot go green without one — measured
> 2026-09-20 (§5.10, FOLLOW-1185).** `ESTALARA_BACKEND_URL` is unset in Doppler `dev` and nothing
> here sets it, so `fetchListingJson()` (`apps/control-plane/src/lib/listing-details.ts:71`) falls
> back to `DEFAULT_BACKEND_URL = http://localhost:8081`, which **no step in this runbook starts**.
> The log line is `[listing-details] fetch failed: fetch failed`; the symptom three layers later is
> `source: playbook_fallback_llm_unavailable`, `fallback_reason: listing_context_unavailable`, and
> AC(1) RED with `outcomes.adapted: 0`. Adding the missing source is **FOLLOW-1225** (P1). Until it
> lands, a 4/6 with AC(1)+AC(7) red is the expected result of this runbook, not a new finding.

`SCORING_PATH_COLUMN_ENABLED=true` is **load-bearing for AC(3)**: without it `logDecisionAsync`
omits `scoring_path` from the INSERT entirely and AC(3) reads a column the writer never wrote. Since
FOLLOW-1202 a row reading `djb2_fallback` or `djb2_guard` served **no** `reorder` (it is withheld
unless every listing has a cosine score; the row's `features_snapshot.reorder_withheld` names why).
So a run whose fixture listing is unseeded shows no reorder on the page, and `djb2_fallback` in
AC(3). `CLICKHOUSE_*` and `DATABASE_URL_ADMIN` are **load-bearing for AC(5)**: without both,
`getTenantAnalyticsRollup()` returns the `seededRandom` mock and AC(5) is RED by design.

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
  '{"tenant_id":"00000000-0000-0000-0000-0000000000e2","scopes":["write:events"],"label":"FOLLOW-819 differentiator fixture"}'

npx wrangler dev --local --port 8787 --persist-to .wrangler/state \
  --var ENVIRONMENT:development CLICKHOUSE_URL:http://localhost:8123 CLICKHOUSE_DATABASE:default
```

**FOLLOW-1203 adds a second KV record and one var.** The fixture host backend (§3.3c) signs with its
own SERVER key, whose record carries `hmac_secret` (a server caller sends no `Origin`); and the
Worker writes the caller class only with the column flag on:

```bash
npx wrangler kv key put --binding KV_API_KEYS --local --preview false \
  --persist-to .wrangler/state "api_key:pilot-server-key" \
  "{\"tenant_id\":\"00000000-0000-0000-0000-0000000000e2\",\"scopes\":[\"write:events\"],\"label\":\"FOLLOW-1203 fixture host backend (signed)\",\"hmac_secret\":\"$(cat ../../.localhost-up/fixture-server-hmac-secret)\"}"
# and add to the `wrangler dev` line above:  --var CALLER_SIGNED_COLUMN_ENABLED:true
```

Without the var every row reads `caller_signed = 0`, including the signed conversion, and AC(5) is
RED with `signed_conversion_row_never_landed`. The page's own key (`pilot-key`) has no secret and
cannot sign; that is the point.

`ENVIRONMENT` must never be `production` here: the Worker's browser-origin list is one constant
(FOLLOW-1333) and a production Worker accepts no localhost origin. The record carries no origin
field any more — before FOLLOW-1333 its `allowed_origins` was a second auth trap (`[]` denied every
browser, absent inherited the env list); a record that still carries it is ignored.

**Verify it before running, because a FAILED build does not free the port (added 2026-09-20,
§5.11).** A `wrangler dev` whose esbuild bundle failed still binds `:8787` and accepts connections
while answering nothing, so every request hangs to the caller's timeout and the harness reds AC(7)
and AC(5) ten minutes later with no mention of ingest:

```bash
grep -c 'Could not resolve' <the wrangler log>   # must be 0
curl -s -m 5 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/health   # must be 200
```

Seen on 2026-09-20 in a git worktree that had no `apps/ingest/node_modules` (every other workspace
package there is symlinked into the main checkout; ingest was missed), giving 11 unresolved imports
and a silent Worker. **Since [FOLLOW-1239] the preflight asserts the `/health` 200 itself
(`assertIngestReachable()`, §3.6) and refuses to start without it** — the `grep` line above is still
worth running, because it names the CAUSE the probe can only detect. The rest of [FOLLOW-1238] (the
per-hop `driveHoldoutArm()` split) is still open, so a dead `:8787` reaching the session would still
red AC(7) and AC(5) as if the arms had not separated.

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
| `403 <reason>`                   | `origin_not_listed`             | the fixture origin is not on the constant list: not `:5173`, or `next start` (production)  |
| `400 Validation failed`, no ACAO | `cors_origin_not_echoed`        | auth passed but no ACAO — not reachable with one list (FOLLOW-1333); kept as a guard       |
| `404`, no answer, anything else  | as named                        | `DECISION_ORIGIN` is not the real control plane                                            |

The probe cannot say which of the `401` causes it hit, because the handler answers all of them the
same way. It also cannot see anything read after body validation: ClickHouse, the LLM gateway,
`SCORING_PATH_COLUMN_ENABLED`, AL enablement, or `HOLDOUT_ASSIGNMENT_SECRET` once FOLLOW-1201 lands.
Those show up as red ACs. The statuses above are pinned against the real handler and middleware by
`control-plane-probe.test.ts`.

**The GROUNDING probe (FOLLOW-1225).** `assertGroundingSource()` then GETs the listing-details URL
for the fixture's own `data-estalara-listing-id` at `ESTALARA_BACKEND_URL` (else `:8081`) and aborts
unless the answer carries at least one of the four fields `withListingFacts()` maps. It exists
because §5.10 spent a session on a 4/6 whose cause was three layers from any assertion the harness
made. Its classes:

| answer                                        | class                | what it means                                                                                        |
| --------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| nothing listening / timeout                   | `unreachable`        | §3.3b was not started — the §5.10 state, `outcomes.adapted` will be 0                                |
| `404`                                         | `listing_not_served` | the source does not know the fixture listing (e.g. the real backend, whose seed minted another UUID) |
| any other non-200                             | `upstream_non_ok`    | `fetchListingJson()` gets `null` and the prompt goes out ungrounded                                  |
| `200`, not a JSON object                      | `not_json`           | same null, different cause                                                                           |
| `200`, no headline/description/price/location | `no_usable_fields`   | `hasListingFacts()` false, i.e. identical to nothing answering                                       |

It probes the origin THIS process was given, not the control plane's — see §3.3b's last paragraph —
and it says nothing about whether the facts are rich enough for a given directive: an unresolved
`{token}` still discards its directive (FOLLOW-1018), which surfaces as a red AC.

**The INGEST probe (FOLLOW-1238, preflight half).** `assertIngestReachable()` then GETs
`${INGEST_ORIGIN}/health` with a 5 s timeout and aborts on anything but a 200. Its classes:
`unreachable` (nothing listening), `bound_but_silent` (the connection is accepted and never answered
— the failed-`wrangler dev`-still-holding-the-port state of §3.5, which cost the 15:29Z run both
AC(5) and AC(7) ten minutes later with no mention of ingest) and `health_non_ok`. It replaces the
manual `curl` in §3.5 as the thing that ENFORCES the check; keep running the
`grep -c 'Could not resolve'` line, because it names the cause the probe can only detect. The rest
of FOLLOW-1238 — the per-hop `driveHoldoutArm()` split, so an ingest timeout can no longer read as
"the arms did not separate" — is still open.

**THE POST-QUIZ SETTLE, AND ITS BUDGET (FOLLOW-1239, FOLLOW-1240). Read `postQuizSettle` on
`last-run.json` before grading a red AC(1) or AC(2).** The wait after the quiz loop is a CONDITION
on the quiz turn's OWN `/api/adapt` response, identified by the REQUEST that carried it, not by
where it landed in `decided[]`. The harness numbers every browser `/api/adapt` request as it goes
out (`adaptRequests[]`, `seq`), stamps each response with the `requestSeq` it answers and its
`receivedAt`, and timestamps every quiz click just before dispatching it. The last click before the
card disappears is `quizCompletedAt`; the quiz-completion callback calls `refreshDirectives()`
synchronously, so the FIRST request at or after that click is the quiz turn's. `postQuizSettle`
records it (`quizRequest`: `seq`, `msAfterCompletingClick`, the `archetypeHint`/`confidence` it
sent) and its response (`quizResponse`: `decidedIndex`, `msAfterRequest`,
`arrivedBeforeSettleStarted`, `source`, `holdoutGroup`). The wait ends one of five ways, recorded
verbatim in the artefact and printed on a `[settle]` line:

| `endedBy`               | what it means                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quiz-response`         | the quiz turn's response was read — the normal path, fast or slow. Floor, then paint grace                                                          |
| `quiz-response-holdout` | that response carries `holdout_group: true`: the session drew holdout. Ends at once — no floor, no grace, no budget. The adapted axis is UNMEASURED |
| `quiz-request-failed`   | the quiz turn's request failed at the network layer (`requestfailed`); no response will come. RED                                                   |
| `no-quiz-turn`          | the quiz did not complete, so there is no quiz turn to wait for. Ends at the floor                                                                  |
| `budget`                | the quiz turn's response did not arrive in 30 s. RED, and `cause` names which of three things was seen (below)                                      |

A `budget` cause says "NO /api/adapt response arrived at or after the completing click" only when
that is literally true. When the SDK issued no request after the click it says so ("NO /api/adapt
REQUEST"); when the quiz turn's request went unanswered but other responses did arrive after the
click, it names them by request number and does not claim silence. **Why this changed (FOLLOW-1240,
RETRO-340 LG-1):** #919 took `startIndex = decided.length` after the loop's final `sleep(1200)`, so
a fast quiz-turn answer that was not adapted (holdout, template, `default`, an error) landed before
the index and neither early exit could fire: 30 s burned, and a cause naming an outage that never
happened. Both holdout runs on record (§5.12 run 3 and the FOLLOW-1239 substrate run) printed
exactly that. The converse was positional too: any later `/api/adapt`, such as a behavioural
refresh, satisfied the wait whether or not the quiz caused it. The old `adapted-response` exit,
which accepted an adapted body from any request, is gone for the same reason.

**The budget is 30 s, and it is sized against a MEASURED 5.278 s post-quiz turnaround** (§5.11 run
2: quiz `step=completed` 18:33:19.527 → `/api/adapt` `generated_at` 18:33:24.805; route pre-LLM 540
ms + Haiku 2225 ms + fact check + paint). That is ~5.7×. A healthy run never pays it — the wait ends
on the response. Under it sits a 3000 ms floor (the SDK's 2000 ms batch-flush interval, which the
pre-FOLLOW-1239 `sleep(3000)` was sized for) and a 1500 ms paint grace after the response (measured
response → `adapt.applied` delta: 21 ms). The holdout exit skips both: there is nothing to paint.
**Anyone widening the budget should widen it against a newer measurement and record it here.**

Three artefact fields exist because of the same class of defect. `gradedResponseCount` is
`decided.length` at the instant `evaluateAc1()` read it, and `responsesArrivedAfterVerdict` is how
many bodies landed after — **a non-zero value here is normal**, because the session keeps calling
`/api/adapt` after the verdict (the CTA click draws one more).
**`adaptedResponsesArrivedAfterVerdict` greater than 0 next to a failed AC(1) is the 18:32Z false
RED**, and since FOLLOW-1240 the grader acts on it (below) instead of leaving it to a reader. The
verdict predicate itself is unchanged: `source ∈ {llm_tweaked, llm_full}`, non-neutral, confidence >
the gate, ≥1 non-`reorder` directive (FOLLOW-1186). The settle can only change WHEN the population
is read, never WHAT counts. `settle-on-response.test.ts` drives every row above against the real
function, next to the two earlier waits kept executable as the bugs they were
(`legacyFixedSleepSettle()`, `legacyPositionalSettle()`).

**THE TALLY, AND HOW TO GRADE IT (FOLLOW-1240).** Every AC is graded `PASS`, `FAIL` or `UNMEASURED`
by `gradeRun()`. `results[].ok` stays the AC's raw predicate outcome; `results[].verdict` is the
grade, and `unmeasuredBecause` is `holdout` or `window`. Only a FAIL can become UNMEASURED, and only
where the failure has no cause of its own:

| AC                      | UNMEASURED when it failed and…                                                                                                                                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC(1), AC(2)            | the session drew holdout (`holdout`), or a response passing AC(1)'s predicate arrived after the verdict, `adaptedResponsesArrivedAfterVerdict > 0` (`window`)                                                                                                                                       |
| AC(7)                   | the same two, and only if every `unmetPreconditions` entry is an adapted-arm consequence (`adaptedArmHasNoAdaptedResponse`, `controlProfileNotAdaptable:…`, `controlProfileNotFromAdaptedResponse`) and the control arm served and logged 0. A control arm that served directives is RED on any run |
| AC(5)                   | holdout only, and only if the rollup itself answered (`httpStatus` 200, `data_source` `clickhouse`, non-null `ctaLift`). A rollup 500 stays RED                                                                                                                                                     |
| AC(8)                   | the CHAT session drew holdout (its own session, its own draw: every baseline body `holdout_group: true`) and that draw is the only unmet precondition. A broken hop or a failed negative control is RED on any run; the quiz session's draw does not touch AC(8)                                    |
| AC(3), AC(4), `HARNESS` | never                                                                                                                                                                                                                                                                                               |

The holdout draw is read from two places. The served bodies (`holdoutFromResponses()`: every body
`holdout_group: true`) are known at settle time, so the `[FOLLOW-1098]` warning prints **above** the
AC(1) line and AC(1)/AC(2) print `[UNMEASURED:holdout]` rather than `[FAIL]`. ClickHouse
(`measureAdaptedArmHoldout()`) is read ~35 s later, and either source saying `true` is enough. An AC
whose verdict changes after its line was printed gets a
`[RECLASSIFIED] AC(n): FAIL → UNMEASURED (reason)` line. The run then prints, last:

```text
TALLY green=<n> red=<n> unmeasured=<n> total=<n> run=<GREEN|RED|UNMEASURED>
<summary line>
```

`TALLY` is the machine line, and it is always printed: grep `^TALLY ` and split on spaces and `=`.
`run` is `RED` if any AC is FAIL, else `UNMEASURED` if any is UNMEASURED, else `GREEN`. The same
values are on `last-run.json` under `grade` (`runVerdict`, `tally`, `tallyLine`, `summaryLine`,
`facts`). The summary line is the legacy `<g>/<n> acceptance criteria green` **only when nothing is
UNMEASURED**, so a fully measured run reads exactly as every run in §5 did. Otherwise it reads
`NOT a graded run: <k> of <n> acceptance criteria UNMEASURED (AC(1)[holdout], …); <g> green, <r> red. Re-run before grading.`
A bare `N/6 green` is never printed over an unmeasured run. An UNMEASURED run exits 1, like a red
one: it is not a pass. `run-grade.test.ts` pins every row of the table above, including the negative
controls.

**How a series is graded for FOLLOW-820 (CEO rulings of 2026-09-22; text of record MASTER_DESIGN
§P.0 item 1).** (1) Condition 1 needs **three consecutive** runs whose `TALLY` line reads
`run=GREEN`, at the graded SHA, on one control plane that was not restarted between them; any
`run=RED` resets the series to zero. (2) A `run=UNMEASURED` run (`holdout` or `window`) is neutral:
it neither counts toward the series nor breaks it. Re-run. (3) Runs grounded by the `:8081` fixture
stand-in (§3.3b) count as condition-1 evidence only after the fixture serves the same grounding
fields production uses (price, location and the rest of MP-017's set, about 902 `tokens_in`; today
two fields, 761), still on localhost. That is FOLLOW-1249. So §5.13 (`0025663f`) and §5.14
(`a51dcdd9`) are context, not GO evidence; the first citable series is the first three consecutive
GREEN runs after FOLLOW-1249 merges.

**Since FOLLOW-1299 (2026-10-04, §5.18) the tally has seven ACs, and `run=GREEN` therefore also
requires AC(8).** Three consecutive `run=GREEN` runs with `total=7` were recorded at `4d683fe0`
(§5.18 runs 8–10) on a substrate that §6.11 describes as new; whether that series is cited for
FOLLOW-820 is decided in MASTER_DESIGN §P.0 / §Snapshot.0, not here. The two paragraphs below are
the six-AC series that preceded it. **Since FOLLOW-1361 the tally has eight ACs (AC(10), §1.2):** a
`run=GREEN` needs `total=8`, and checkpoint KQ1 is three consecutive such runs, each `[FRESH]`, on
one SHA.

**Citable series: NO (as of 2026-09-22, §5.17, graded SHA `bb1532a0`).** Six graded runs on one
un-restarted control plane, 0 UNMEASURED: GREEN, GREEN, RED, GREEN, RED, GREEN. The longest GREEN
streak is 2. Both reds are AC(1)+AC(7) on the quiz turn's `fact_check_refused` fallback: the model
kept `yield_hunter`'s authored `feature` label "Investment Performance", the checker flagged it
`hallucinated_proper_name` and the judge confirmed it (FOLLOW-1251, now recurring at 2 of 6). AC(2),
AC(3), AC(4) and AC(5) passed on all six runs. FOLLOW-1252's AC(5) poll held on every run, including
one whose `cta.clicked` batch was refused by the §6.10 proxy and re-sent.

**Previous: citable series NO (2026-09-22, §5.16, graded SHA `d7e8ad26`).** Six graded runs on one
un-restarted control plane, 0 UNMEASURED: GREEN, GREEN, RED, GREEN, GREEN, RED. The longest GREEN
streak is 2. Both reds are AC(5) `thisRunConversions=0`: the SDK's FOLLOW-1242 re-send of a
503-refused `cta.clicked` batch landed after the harness's single 7 s read (FOLLOW-1252). AC(1),
AC(2), AC(3), AC(4) and AC(7) passed on all six runs.

```bash
DATABASE_URL_ADMIN="$DATABASE_URL_ADMIN" \
ADAPT_API_KEY=local-follow819-key \
ADMIN_API_SECRET=local-follow819-admin-secret \
OPS_TENANT_ID=00000000-0000-0000-0000-0000000000e2 \
ESTALARA_BACKEND_URL=http://localhost:8081 \
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
- **Arm B — the real quiz widget, driven by real clicks.** Since FOLLOW-1359 a quiz leaf folds at
  0.72 when reached and 0.90 once the buyer confirms it (the AC(1) loop confirms); both clear the
  bar. Before Q4 it resolved at `min(0.85 × 1.2, 1.0) = 1.0`.

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
`packages/shared/src/playbooks/` and a structural extraction that imports `getAllPlaybooks()` at
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

### 5.10 — 2026-09-20T14:01:17Z (FOLLOW-1185, EXECUTED at `241e762b`) — **the FIRST run graded by the CURRENT AC(1): 4 / 6, and the two reds are one cause**

**What this run settles, and what it does not.** §0 said _"No run has yet been graded by the current
AC(1)"_. One has now. It is **4 / 6**, RED on **AC(1)** and **AC(7)**, and both reds reduce to a
single measured fact: on this substrate the LLM band is called, answers, and produces nothing
usable, because **nothing on localhost serves the listing's facts** (→ **FOLLOW-1225**, P1; the
diagnostic half is **FOLLOW-1226**). The run also **refutes** the claim that this harness cannot
exercise the Haiku band — the reason FOLLOW-1185 existed.

**Provenance.** `node tests/e2e/follow-819/differentiator-e2e.mjs`, from the
`qa-engineer/FOLLOW-1185-real-harness-run` worktree at `241e762b` (= `origin/main`), clean tree.
Real control plane on `:3000` (§3.4's `doppler run -c dev -- env …` form, `next dev` inside
`apps/control-plane`, no Turbo), ingest Worker `:8787` (`workerd` PID checked against `ss -ltnp`,
§6.8), fixture `:5173`, ClickHouse `estalara_ch_local`, Postgres `al_pg_local` — the exact §3 ports,
no substitutions. Both §6.6 warm-up curls issued first. `sessionId`
`cc05fec0-638a-4f8e-afae-324b14df979b`, `adaptedArmDrewHoldout: false`.

**Freshness, pasted rather than asserted (§3.6):**

```text
[FRESH] …/tests/e2e/follow-819/last-run.json: harnessSha 241e762b6d56
is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it;
clean tree, run completed; startedAt 2026-09-20T14:01:17.332Z
```

**Result, per AC:**

| AC    | verdict | the number that decides it                                                                                                                                                                       |
| ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1** | **RED** | `outcomes: {adapted: 0, outage: 1, default: 1}` of 2 responses; `sourcesObserved: {default: 1, playbook_fallback_llm_unavailable/listing_context_unavailable: 1}`                                |
| **2** | PASS    | `changedSlots: ["cta"]` — but `paintedSlotAttribution.perSlot[0].fromAdaptedResponse: **false**`, `servedBy: playbook_fallback_llm_unavailable`. A TEMPLATE cta painted, not adaptation          |
| **3** | PASS    | 3 rows, `scoringPaths: ["cosine"]`, `cosineVsDjb2Distinguishable: true` — the FOLLOW-560 path, not the djb2 shuffle                                                                              |
| **4** | PASS    | real Beta delta `{alpha 5, beta 1}` → `{alpha 6, beta 1}`, `polls 0`                                                                                                                             |
| **5** | PASS    | `data_source: "clickhouse"`, `thisRun: {treatmentArmDecisions: 3, conversions: 1}`, `unmetPreconditions: []`. `ctaLift: -25` — **do not grade it** (§0)                                          |
| **7** | **RED** | control arm served **0** directives and `drewHoldout: true` (that half holds); `unmetPreconditions: ["adaptedArmHasNoAdaptedResponse"]` — clause 2 is unreachable while AC(1) is red, not broken |

**The adapted arm's own `source`, pasted beside AC(1) as FOLLOW-1185 required — this is NOT LLM
adaptation:**

```json
[
  {
    "source": "default",
    "fallback_reason": null,
    "archetype": "neutral",
    "confidence": 0.36554663991975933,
    "slots": ["reorder"]
  },
  {
    "source": "playbook_fallback_llm_unavailable",
    "fallback_reason": "listing_context_unavailable",
    "archetype": "yield_hunter",
    "confidence": 1,
    "slots": ["cta", "reorder"]
  }
]
```

**The LLM WAS called. Local ClickHouse `llm_calls`, the three completed runs of this session:**

```text
2026-09-20 14:01:54  yield_hunter  claude-haiku-4-5  llm_tweaked_unavailable_malformed  in 613  out   9   998 ms
2026-09-20 13:57:27  yield_hunter  claude-haiku-4-5  llm_tweaked_unavailable_malformed  in 613  out   9   813 ms
2026-09-20 13:53:15  yield_hunter  claude-haiku-4-5  llm_tweaked_unavailable_malformed  in 613  out 124  2366 ms
```

`claude-haiku-4-5` is **branch 3**, `0.6 < similarity ≤ 0.85` — the band #883 (FOLLOW-1180) changed.
The model answered and was billed; the reply did not parse. `tokens_in 613` is the UNGROUNDED mode
of [MP-017]'s bimodal signature, and the control plane logged
`[listing-details] fetch failed: fetch failed` ×7 — `ESTALARA_BACKEND_URL` is unset, so
`fetchListingJson()` fell back to `DEFAULT_BACKEND_URL = http://localhost:8081`, which **§3 never
starts**. That is FOLLOW-1225.

**Reachability, unchanged and re-measured bit-for-bit:** behaviour alone peaks at
`confidence = 0.36554663991975933` against a gate of `> 0.6` and does NOT clear it; the quiz arm ran
(3 steps, real clicks) and resolved `yield_hunter` at `confidence = 1`. Verdict string: _"behavior
alone did NOT clear the gate; quiz input was REQUIRED (confirms runbook §9.2)"_.

**Reproducibility, and one run that must not be quoted.** Four runs were started. Run A aborted on
the §6.6 preflight timeout (8 s) while ClickHouse was restarting — `[ABORTED]`, unmeasured. Run B
completed but `adaptedArmDrewHoldout: true` (the §0 FOLLOW-1098 trap, ~10% per run at
`DEFAULT_HOLDOUT_PCT`), so its 2/6 is **UNMEASURED on the adapted axis** and is not quoted here.
Runs C and E completed clean and are **identical**: 4/6, RED AC(1)+AC(7), same `source`, same
`fallback_reason`. Run D completed but hit **§6.7**
(`PostgresError: sorry, too many clients already`) and reported AC(4)+AC(5) red for that dev-server
leak — restarting `next dev` restored both, which is §6.7 behaving exactly as documented. **The
AC(1) red is deterministic across all three completed runs; the AC(4)/AC(5) reds are not the
product.**

**Substrate.** ClickHouse after the run: `events 390+`, `intent_events 18`,
`adaptation_decisions 75+` — the PERSISTENT substrate, continuous with §5.4–§5.9. Postgres proved
before the run with
`pnpm db:assert:cosine --tenant 00000000-0000-0000-0000-0000000000e2 --min-rows 13 --require-listing 839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c`:
_"archetype half PASS: 18 rows … listing half PASS: 13 rows … including 839ecbd1…"_. AC(3)'s
`cosine` is the visible consequence — §5.9 read `djb2_fallback` on the same assertion.

**Two bring-up notes for the next runner, neither a §6 defect.**

1. **`infra/clickhouse/scripts/migrate.sh` is not idempotent past `0018`.** Against a container that
   already holds the schema it dies on
   `Wrong column name. Cannot find column 'tier' to rename. (NOT_FOUND_COLUMN_IN_BLOCK)`. That is
   "already applied", not drift — verify with `DESCRIBE TABLE adaptation_decisions` (through `0022`:
   `page_context_source`, `holdout_pct`, `scoring_path`) rather than re-running the script.
   **Superseded by FOLLOW-1280:** `migrate.sh` now records applied files in `schema_migrations`,
   bootstraps an already-migrated database once, and re-runs as a no-op.
2. **ClickHouse was OOM-killed (exit 137) during the Next.js compile** on a 3.6 GB host, and the
   symptom one layer away is `{"error":{"code":"query_failed","message":"fetch failed"}}` from the
   rollup route — indistinguishable, from the harness's side, from a dead analytics wire. Check
   `docker ps -a` before believing an AC(5) red of that shape.

**What this run does NOT license.** It is not a GO signal and not a regression report against the
LLM path. FOLLOW-820 condition 1 clause 1 reads `results[AC(1)].evidence.outcomes.adapted`, which is
**0** here, and clause 2 (AC(7)) cannot be graded while clause 1 is red. Both become gradeable once
FOLLOW-1225 gives localhost a grounding source; until then the honest statement is _"the chain runs
end to end on real data and paints a real template directive; the LLM branch has no facts to work
from and produces none"_.

---

### 5.11 — 2026-09-20 (FOLLOW-1225, EXECUTED TWICE) — **grounding restored: the adapted arm leaves `playbook_fallback_llm_unavailable` for the first time since `3d22cf6b`**

> Numbering note: §5.10 is added by #916 (FOLLOW-1185), the run that found this. This section is the
> answer to it and depends on that merge for its back-references.

Two runs on one substrate, both with §3.3b's grounding source up, both `harnessTree.dirty: false`:

| run   | at        | sha        | AC(1)    | adapted response                        |
| ----- | --------- | ---------- | -------- | --------------------------------------- |
| run 1 | 15:29:27Z | `04486885` | **PASS** | `llm_tweaked` yield_hunter conf 1       |
| run 2 | 18:32:47Z | `62ac28f0` | RED      | `llm_tweaked` — **arrived 1.05 s late** |

**What grounding changed.** `llm_calls` on this box, the same day, spans both sides of the fix:

```text
13:53–14:01  llm_tweaked_unavailable_malformed  tokens_in 613  ×3   ← §5.10, no :8081
15:27, 15:29 llm_tweaked                        tokens_in 761  ×2   ← §3.3b up (run 1)
18:33:24     llm_tweaked                        tokens_in 761       ← run 2, latency 2225 ms
```

+148 tokens is the injected `listing_title` + `listing_description` and nothing else. **761, not
MP-017's 902: that reference was a production listing carrying price and location, and the fixture
page publishes neither** — the point is that the run left the 613 mode, not that it reached 902. Run
1's copy, every phrase traceable to the two fields the page publishes:

```text
headline  "Single-family rental on quiet residential street in Palm Coast"
cta       "Request Investment Pack"
feature   "Three-bedroom, two-bathroom layout with attached two-car garage and screened lanai"
```

Run 1 was **4 / 6** — AC(1), AC(2), AC(3), AC(4) green, and AC(2) green for the right reason for the
first time (`paintedSlotAttribution.fromAdaptedResponse: [headline, cta, feature]`, nothing in
`notFromAdaptedResponse`; §5.10's green was a template `cta`). Its AC(5) and AC(7) reds were ONE
substrate cause with nothing to do with the product: **`wrangler dev` had failed to build** (the
worktree was missing `apps/ingest/node_modules`, so esbuild could not resolve `@sentry/cloudflare`
and two others) **and still bound `:8787`, accepting connections and answering nothing** — zero
`events` rows in ClickHouse for both sessions. Filed as [FOLLOW-1238], which also asks the preflight
to probe the ingest origin the way it now probes the control plane and the grounding source.

Run 2, with the Worker actually serving, took **AC(5) green** (9 event rows for its session) and red
on AC(1)/AC(2)/AC(7) — a false RED whose proof is inside its own artefact: `decided[1]` holds the
`llm_tweaked` response with `text` directives for headline, cta and feature while AC(1) reports
`evaluatedResponseCount: 1, sourcesObserved: {default: 1}`, and ClickHouse records
`adapt.applied ×3` at 18:33:24.826 — 1.05 s after the harness had snapshotted the DOM and clicked
the CTA. The post-quiz settle is a fixed 3 s; the post-quiz turnaround here was 5.3 s. Filed as
[FOLLOW-1239] (P1: it makes FOLLOW-820 condition 1 ungradeable run-to-run, and may be much of what
MP-017 records as "~43% flaky").

**What a reader may take from this section:** grounding is no longer the thing standing between
localhost and FOLLOW-820 condition 1 clause 1 — the adapted arm reaches `llm_tweaked` on a grounded
prompt, twice. What stands there now is the harness's own observation window (FOLLOW-1239) and the
ingest bring-up's silent failure mode (FOLLOW-1238). Neither is a product defect, and neither is
evidence that the product passes: **condition 1 needs a run where AC(1) and AC(7) are green
together, and this file does not have one yet.**

### 5.12 — 2026-09-21 (session 165, EXECUTED ×3 at `e0cd7560`) — **6/6 once; the two reds are NOT AC(1), and one of them is a product leak**

First runs on `main` with BOTH FOLLOW-1225 (§3.3b grounding, #917) and FOLLOW-1239 (settle on the
real response, #919) merged. One substrate, three consecutive runs, one `next dev` process (§3.4),
§3.3b on `:8081`, SDK bundle rebuilt from HEAD (`pnpm --filter @estalara/sdk build`; the committed
`dist/` was from 2026-08-27). Every artefact reads
`[FRESH] … commitsBehind=0, measuredPathsChanged=0` and `harnessTree.dirty: false`.

| run | startedAt (UTC) | tally   | red                        | settle                 | cause of the red                                          |
| --- | --------------- | ------- | -------------------------- | ---------------------- | --------------------------------------------------------- |
| 1   | 08:25:13        | **6/6** | —                          | `new-response` 4512 ms | —                                                         |
| 2   | 08:26:01        | 5/6     | AC(5)                      | `new-response` 4506 ms | the batch carrying `cta.clicked` was lost (FOLLOW-1242)   |
| 3   | 08:26:39        | 2/6     | AC(1), AC(2), AC(5), AC(7) | `budget` 30079 ms      | the adapted arm drew holdout (FOLLOW-1240) + PG exhausted |

**AC(1) passed on every run in which the adapted arm was served an adaptation (2 of 2).** Both
responses `llm_tweaked`, `yield_hunter`, confidence 1, no `fallback_reason`, copy traceable to the
two fields §3.3b serves:

```text
run 1  headline "Single-family rental on quiet residential street — 3 bed, 2 bath"
       cta      "Request Investment Pack"
run 2  headline "Single-family rental on quiet residential street — 3 bed, 2 bath with established appeal"
       cta      "Request Investment Pack"
```

Run 1 is the first run in this file where **AC(1) and AC(7) are green together at HEAD on a grounded
prompt** — the thing §5.11 said this file did not have yet. One run is not stability; the two reds
below are why the other two runs are not counter-evidence either.

**Run 3 — the adapted arm drew holdout.** All three `/api/adapt` bodies `holdout_group: true`,
`source: default`, ClickHouse `adaptation_decisions` for session `ed12d87f-…` in group 1. That is
the 10 % draw working as configured (4 of 41 non-synthetic sessions on this box in 30 days). The
harness still spent the full 30 s budget and printed the misnamed `BUDGET EXPIRED … outage` cause:
exactly [FOLLOW-1240], observed a second time. Its AC(5) additionally read `http_status=500`, which
is the next paragraph.

**The rollup 500 is a PRODUCT connection leak, not a dev-server artefact — §6.7 was wrong.**
`createAdminClient()` (`packages/db/src/client.ts:188`) builds a new postgres.js pool on every call,
nothing ends it, and postgres.js keeps idle connections by default. Measured on a freshly restarted
control plane, counting `ss -tn | grep -c ':5433 '` (every connection owned by the one `next-server`
pid):

```text
boot                                   0
GET /api/admin/analytics/rollup ×1     4
                                ×6    24
                                ×16   64
```

+4 connections per request, never returned; the 100-connection cap falls after ~25 requests, which
is three harness runs. At the end of run 3 `psql` itself was refused
(`FATAL: sorry, too many clients already`) and the rollup answered `500 query_failed` on
`select "id","name","slug" from "tenants"`. Nothing about this is specific to `next dev`: the calls
are per-request in product code, and Fluid Compute reuses an instance across requests. Filed as
[FOLLOW-1241] (P1, fix in flight).

**Run 2 — `cta.clicked` was emitted and never stored.** The SDK's batch carrying it is in the
artefact's `emitted[]`; the browser console reads
`Access to fetch at 'http://localhost:8787/v1/events' … blocked by CORS policy: No 'Access-Control-Allow-Origin' header` +
`net::ERR_FAILED`; the Worker log holds its only `POST /v1/events 503 Service Unavailable` of the
whole session, with no `events_accepted` line for it (`apps/ingest/src` contains no 503 path, so it
came from `wrangler dev`/workerd, next to repeated `OTLPExporterError … Network connection lost`).
ClickHouse has every other event type for session `f1f2c024-…` and no `cta.clicked`. The product
half: `dispatchEvents()` (`packages/sdk/src/core/events.ts:85`) neither reads `response.ok` nor
retries, so ANY failed flush — a 5xx without CORS headers, a network blip — drops that batch,
conversions included, silently. Filed as [FOLLOW-1242].

**What a reader may take from this section:** at `e0cd7560`, grounded, AC(1) and AC(7) went green
together once and AC(1) never failed on a served adaptation. It is NOT a FOLLOW-820 condition-1
verdict: that still needs repeated runs after [FOLLOW-1241] (without it a third consecutive run
cannot pass), and a run that draws holdout still grades as red until [FOLLOW-1240].

### 5.13 — 2026-09-21 (EXECUTED ×3 at `0025663f`, after [FOLLOW-1241]) — **6/6 three times on one `next dev` process; Postgres connections stay at ≤2**

First runs after #921 (FOLLOW-1241, `6728d874`) made `createAdminClient()` / `createTenantClient()`
share one postgres.js pool per process. Same substrate as §5.12: containers `al_pg_local` +
`estalara_ch_local` (`docker start`), §3.3b on `:8081`, fixture on `:5173`, bundle host on `:9100`
(static only), ingest on `:8787` (`/health` 200, 0 `Could not resolve`), control plane on `:3000`
started ONCE via the §3.4 `env` form and **never restarted** across the warm-up, the leak probe and
the three runs. Workspace packages (`shared`, `db`, `auth`, `sdk`) were built from HEAD in the
checkout that ran (see §6.9 for why that has to be checked). Every artefact reads
`[FRESH] … commitsBehind=0, measuredPathsChanged=0`, clean tree.

| run | startedAt (UTC) | tally   | red | settle                 | adapted-arm drew holdout |
| --- | --------------- | ------- | --- | ---------------------- | ------------------------ |
| 1   | 12:37:14        | **6/6** | —   | `new-response` 4508 ms | false                    |
| 2   | 12:38:18        | **6/6** | —   | `new-response` 4508 ms | false                    |
| 3   | 12:39:01        | **6/6** | —   | `new-response` 4506 ms | false                    |

**The Postgres series.** `pg_stat_activity` total (it includes the `psql` doing the counting and 7
background workers), client backends excluding that `psql`, and the `next-server` sockets on `:5433`
(`ss -tnp`):

```text
12:36:20 boot                                   pg_stat_activity=8  client_backends=0 next_server_sockets=0
12:36:49 warm-up (adapt ×1, rollup ×1)          pg_stat_activity=9  client_backends=1 next_server_sockets=1
12:37:00 rollup ×6 cumulative                   pg_stat_activity=9  client_backends=1 next_server_sockets=1
12:37:04 rollup ×16 cumulative  (= before run 1) pg_stat_activity=9  client_backends=1 next_server_sockets=1
12:38:09 after run 1                            pg_stat_activity=10 client_backends=2 next_server_sockets=2
12:38:54 after run 2                            pg_stat_activity=10 client_backends=2 next_server_sockets=2
12:39:37 after run 3                            pg_stat_activity=10 client_backends=2 next_server_sockets=2
12:40:04 idle ~27 s after run 3                 pg_stat_activity=8  client_backends=0 next_server_sockets=0
```

The rollup ×1/×6/×16 rows repeat §5.12's leak probe on the same route: **0 / 1 / 1 / 1**
connections, against **0 / 4 / 24 / 64** before the fix. Over the whole process the control plane
served 19 rollup GETs, 16 `/api/adapt` POSTs, 3 feedback POSTs, 3 quiz completions and 6 description
GETs (control-plane log), and never held more than 2 connections; the log has 0 `PostgresError` /
`too many clients` lines. The connections drop to 0 within the 20 s `SHARED_POOL_IDLE_TIMEOUT_S`.
**[FOLLOW-1241] is closed on this evidence:** the count is flat, not +4 per request, and a third
consecutive run on one process now passes where §5.12's run 3 could not.

**AC(1) on every run**, `llm_tweaked`, `yield_hunter`, confidence 1, no `fallback_reason`, copy
traceable to the two fields §3.3b serves (garage, screened lanai are in its `description`):

```text
run 1  headline "Single-family rental on quiet residential street — 3 bed, 2 bath with attached garage"
run 2  headline "Single-family rental on quiet residential street — 3 bed, 2 bath with garage and screened lanai"
run 3  headline "Single-family rental on quiet residential street — 3 bed, 2 bath with two-car garage"
       cta      "Request Investment Pack" (all three)
```

The third response each run drew (after the verdict, `responsesArrivedAfterVerdict: 1`,
`adaptedResponsesArrivedAfterVerdict: 0`) was `playbook` with
`fallback_reason: ungrounded_directives_withheld`, which is not graded and is the ESC-076 guard
working.

**What this does NOT show.** No red, so no new cause — but two known causes were simply not drawn,
not fixed: the adapted arm never drew holdout (at a 10 % rate, three misses in a row happen about 73
% of the time), so [FOLLOW-1240] is untested here; and every `cta.clicked` batch landed (ingest log:
15 `POST /v1/events`, 0 `503`), so [FOLLOW-1242]'s silent drop is not ruled out either. A future red
from either is the known cause, not a regression of this result. Three runs are three runs: this
closes the connection leak that made a third run impossible, and it is repeated-run evidence for
FOLLOW-820 condition 1, not the whole of it.

### 5.14 — 2026-09-22 (FOLLOW-1240, EXECUTED ×3 at `a51dcdd9`, PR branch) — **the settle waits on the quiz turn's request; 6/6 ×3, no holdout drawn**

Run to check the one part the unit tests cannot reach: `main()`'s wiring from Playwright's `request`
event to `decided[].requestSeq` to the settle. Same substrate as §5.13 (containers `al_pg_local` +
`estalara_ch_local`, §3.3b on `:8081`, fixture on `:5173`, bundle host on `:9100`, ingest on `:8787`
with 0 `Could not resolve`, control plane on `:3000` via the §3.4 `env` form, started once).
`pnpm install --frozen-lockfile --offline` in the worktree, `shared`/`db`/`auth`/`sdk` built from
HEAD, `readlink -f apps/control-plane/node_modules/@estalara/db` inside the worktree (§6.9). Every
artefact reads `[FRESH] … commitsBehind=0, measuredPathsChanged=0`, clean tree.

| run | TALLY                                                | `[settle]`                                                   |
| --- | ---------------------------------------------------- | ------------------------------------------------------------ |
| 1   | `TALLY green=6 red=0 unmeasured=0 total=6 run=GREEN` | `quiz-response` 4512 ms — request #2, `llm_tweaked`, 3210 ms |
| 2   | `TALLY green=6 red=0 unmeasured=0 total=6 run=GREEN` | `quiz-response` 4511 ms — request #2, `llm_tweaked`, 2847 ms |
| 3   | `TALLY green=6 red=0 unmeasured=0 total=6 run=GREEN` | `quiz-response` 4511 ms — request #2, `llm_tweaked`, 2987 ms |

Run 1's `adaptRequests[]`, relative to the completing click: #1 at −18141 ms (`archetype_hint`
`neutral` @ 0.3655, the page load), **#2 at +67 ms (`yield_hunter` @ 1, the quiz leaf)**, #3 at
+5852 ms (the CTA click). `decided[]` holds one response per request, each carrying its
`requestSeq`, so the quiz turn was matched by identity, and the request body it carried confirms it
was the quiz turn. `adaptedArmDrewHoldoutByResponse.drewHoldout` was `false` on all three, agreeing
with ClickHouse.

**What this does NOT show:** a holdout draw. None happened in three runs, as is likely at a 10 %
rate. The holdout exit, the UNMEASURED grading and the budget-cause taxonomy are proven by
`settle-on-response.test.ts` and `run-grade.test.ts` over session `6f1f169e-…`'s real bodies, not by
a live draw.

### 5.15 — 2026-09-22 (FOLLOW-1249, EXECUTED ×2 at `0e3664e2`, PR branch) — **the prompt now carries price and location; `tokens_in` 761 → 789; neither run is GREEN**

**Context, not evidence, like every run before it.** CEO ruling 2026-09-22 (FOLLOW-820 condition 1):
the first citable fixture-grounded series is 3 consecutive `run=GREEN` runs AFTER FOLLOW-1249
merges. These two runs were taken on the PR branch to check the grounding change end to end, not as
that series.

**Substrate.** Same as §5.14: containers `al_pg_local` + `estalara_ch_local` (already up), §3.3b on
`:8081` from this worktree, fixture on `:5173`, bundle host on `:9100` (static only), ingest on
`:8787` (`/health` 200, 0 `Could not resolve`, KV seeded per §3.5), control plane on `:3000` via the
§3.4 `env` form, started once. `pnpm install --frozen-lockfile --offline` in the worktree, then
`shared`/`db`/`auth`/`sdk` built from HEAD.
`readlink -f apps/control-plane/node_modules/@estalara/db` resolved inside this worktree (§6.9).
`pnpm db:migrate`: 0 pending. Both artefacts read
`[FRESH] … commitsBehind=0, measuredPathsChanged=0`, clean tree. The §3.3b probe answered with all
seven fields (pasted in §3.3b), and the harness preflight printed
`grounds listing_title, listing_description, listing_price, listing_location`.

| run | startedAt (UTC) | TALLY                                              | adapted arm (`llm_calls`, this session)                         | red                                 |
| --- | --------------- | -------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------- |
| 1   | 10:08:00        | `TALLY green=5 red=1 unmeasured=0 total=6 run=RED` | `llm_tweaked`, `tokens_in` **789**, out 234                     | AC(5): rollup `httpStatus` 500      |
| 2   | 10:09:45        | `TALLY green=4 red=2 unmeasured=0 total=6 run=RED` | `llm_tweaked_fact_check_rejected`, `tokens_in` **789**, out 306 | AC(1) + AC(7): `fact_check_refused` |

**`tokens_in`.** Every earlier grounded `llm_tweaked` row for this fixture in the local `llm_calls`
reads **761** (16 rows, 2026-09-20 15:27Z → 2026-09-22 09:20Z). Both runs here read **789**. The +28
is the two lines `listing_price: 385000 USD` and `listing_location: 9 Blackberry Pl, Palm Coast, FL`
that `buildListingContextBlock()` now adds. MP-017's **902** is a different request (the production
FOLLOW-1022 canary, a real listing with a longer description, `similarity: 0.7`), so 789 is not
expected to equal it. What matches production is the field SET in the prompt, and
`grounding-source.test.ts` pins that. The token count is not pinned.

**The prompt carries price and location: yes.** Besides the +28, run 1's adapted headline quotes the
price, which the page published nowhere before FOLLOW-1249:

```text
headline "Single-family rental investment in Palm Coast, FL — 3 bed, 2 bath at $385000 USD"
cta      "Request Investment Pack"
feature  "Strong fundamentals: established residential neighbourhood, attached two-car garage, screened lanai, mature garden. …"
```

`$385000 USD` is copy-quality, not grounding: `fetchListingTextFields()` renders `price` as
`` `${price} ${currency}` `` with no formatting, and the model echoed it. A production listing gets
the same string.

**Run 1's red, AC(5), is not a grounding consequence.** `GET /api/admin/analytics/rollup` answered
**500 in 570 ms** with no log line. The route's only 500 is a failed ClickHouse or tenant-roster
Postgres query (`route.ts` docblock), which it reports to Sentry and not to the console. The route
reads no listing details. A manual call at 10:09:15Z, before run 2, and run 2's own call both
answered 200. The cause is not identified, and the harness records no response body for a non-200
rollup, so nothing more can be read from the artefact.

**Run 2's red, AC(1) + AC(7), is one cause, and it is the one to watch in the graded series.** The
quiz turn's response was `playbook_fallback_llm_unavailable` /
`fallback_reason: fact_check_refused`. The log line was
`[llm-gateway] directive fact-check violation: hallucinated_proper_name archetype=yield_hunter slot=feature value="Investment Performance"`.
The judge ran (`fact_check_judge_flag_confirmed`, `tokens_in` 338) and upheld the flag, so this is
not the RETRO-318 judge-cap starvation. The model kept the playbook's `feature` label instead of
writing one. It is the first `llm_tweaked_fact_check_rejected` for this fixture in the local
`llm_calls` history (0 of the 16 runs at 761, 1 of the 2 at 789). **Two runs cannot say whether the
richer prompt caused it.** 1 in 18 is also consistent with chance. It is recorded so the graded
series is read against it: if refusals recur there, the grounding change is a suspect, and the
corpus change it would point to is product work, not this fixture.

### 5.16 — 2026-09-22 (FOLLOW-820 condition-1 graded series, EXECUTED ×6 at `d7e8ad26`) — **not citable: the longest GREEN streak is 2; both reds are AC(5) reading the conversion before the SDK's retry delivers it**

The first series graded under the CEO rulings of 2026-09-22 (§3.6, MASTER_DESIGN §P.0 item 1).
Graded SHA **`d7e8ad26`** (#928, MASTER_DESIGN 4.15), with #929 (FOLLOW-1249) below it, so the
`:8081` fixture serves the production field set. Budget set before the first run: stop at 3
consecutive `run=GREEN` or after 6 graded runs, whichever came first, with nothing tuned, patched or
restarted in between. The budget ran out at 6 graded runs, none UNMEASURED.

**Substrate.** A git worktree at `d7e8ad26`, clean. `pnpm install --frozen-lockfile --offline` in
the worktree, then `shared`/`db`/`auth`/`sdk` built from HEAD. `readlink -f` put
`apps/control-plane/node_modules/@estalara/{db,shared,auth,sdk}` inside the worktree (§6.9).
`pnpm db:migrate`: 0 pending (39 of 39). Containers `al_pg_local` + `estalara_ch_local` were already
up. §3.3b on `:8081` from the worktree answered all seven fields
(`x-estalara-facts-source: …/agent-a881c829cc9e8d8c4/tests/e2e/follow-819/fixture-listing.html`).
Fixture on `:5173` (`npx serve`), bundle host on `:9100` (static only), ingest on `:8787` (KV seeded
per §3.5, `/health` 200, 0 `Could not resolve`). The control plane ran on `:3000` via the §3.4 `env`
form and was warmed per §6.6. **One control-plane process, pid 123168, served all six runs and was
not restarted.** Every run's preflight printed
`grounds listing_title, listing_description, listing_price, listing_location`.

| run | startedAt (UTC) | SHA        | TALLY                                                | `tokens_in` | quiz-turn `source` | `endedBy`       | red cause                                                              |
| --- | --------------- | ---------- | ---------------------------------------------------- | ----------- | ------------------ | --------------- | ---------------------------------------------------------------------- |
| 1   | 10:32:03        | `d7e8ad26` | `TALLY green=6 red=0 unmeasured=0 total=6 run=GREEN` | 789         | `llm_tweaked`      | `quiz-response` | —                                                                      |
| 2   | 10:32:56        | `d7e8ad26` | `TALLY green=6 red=0 unmeasured=0 total=6 run=GREEN` | 789         | `llm_tweaked`      | `quiz-response` | —                                                                      |
| 3   | 10:33:33        | `d7e8ad26` | `TALLY green=5 red=1 unmeasured=0 total=6 run=RED`   | 789         | `llm_tweaked`      | `quiz-response` | AC(5) `thisRunConversions=0`: `cta.clicked` landed ≈ 7.9 s after click |
| 4   | 10:37:32        | `d7e8ad26` | `TALLY green=6 red=0 unmeasured=0 total=6 run=GREEN` | 789         | `llm_tweaked`      | `quiz-response` | —                                                                      |
| 5   | 10:38:13        | `d7e8ad26` | `TALLY green=6 red=0 unmeasured=0 total=6 run=GREEN` | not booked¹ | `llm_tweaked`      | `quiz-response` | —                                                                      |
| 6   | 10:38:53        | `d7e8ad26` | `TALLY green=5 red=1 unmeasured=0 total=6 run=RED`   | 789         | `llm_tweaked`      | `quiz-response` | AC(5) `thisRunConversions=0`: `cta.clicked` landed 8.15 s after click  |

Series by the ruling: G, G, **R (reset)**, G, G, **R (reset)**. The longest run of consecutive GREEN
runs is **2**, and **no citable series exists at `d7e8ad26`**.

`tokens_in` and `source` are the quiz turn's `llm_calls` row, joined on `session_id` (never on
`tenant_id`, which the SDK reports as all zeros). Every served generation read **789**, as in §5.15.
¹ Run 5's generation ran: its `fact_check_unjudged_exempt_authored` row exists and the response
served `llm_tweaked`. But its `llm_tweaked` row was refused by ClickHouse, see "Clock" below. Each
run's settle was `quiz-response` on request #2, `holdout_group: false` in the bodies and in
ClickHouse. The adapted headlines were:

```text
run 1  "Single-family rental at 9 Blackberry Pl, Palm Coast, FL — three bedrooms, two bathrooms"
run 2  "Three-bedroom single-family home in Palm Coast — stable residential investment"
run 3  "Three-bedroom single-family home in Palm Coast — stable rental market foundation"
run 4  "Single-family rental investment on quiet residential street in Palm Coast, FL"
run 5  "Single-family rental at 9 Blackberry Pl, Palm Coast, FL — 3 bed, 2 bath on quiet residential street"
run 6  "Single-family rental investment at 9 Blackberry Pl, Palm Coast, FL"
       cta "Request Investment Pack" (all six)
```

**Staleness, every run** (`--check-staleness <artefact>`; `<scratch>` abbreviates the session
scratchpad path each artefact was copied to, and `d7e8ad26…` the 40-character `harnessSha`, which
gitleaks' `cloudflare-api-token` rule matches; the rest is verbatim):

```text
[FRESH] <scratch>/run1.json: harnessSha d7e8ad26… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-09-22T10:32:03.094Z
[FRESH] <scratch>/run2.json: harnessSha d7e8ad26… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-09-22T10:32:56.371Z
[FRESH] <scratch>/run3.json: harnessSha d7e8ad26… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-09-22T10:33:33.917Z
[FRESH] <scratch>/run4.json: harnessSha d7e8ad26… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-09-22T10:37:32.537Z
[FRESH] <scratch>/run5.json: harnessSha d7e8ad26… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-09-22T10:38:13.456Z
[FRESH] <scratch>/run6.json: harnessSha d7e8ad26… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-09-22T10:38:53.668Z
```

**The two reds are one cause, and the conversion was NOT lost.** In both runs AC(5) failed on
`unmetPreconditions: ["thisRunConversions=0"]` alone, with the rollup healthy (`httpStatus` 200,
`data_source` `clickhouse`), `ctaClicked: true`, `treatmentArmDecisions: 3`. The chain, read from
the artefact, the ingest log and ClickHouse:

1. The harness clicked the real `[data-estalara-cta]`. The SDK queued `cta.clicked`, and request #3
   went out at the click (run 3 10:34:00.046, run 6 10:39:16.200).
2. The first send of the batch carrying it got **`POST /v1/events 503 Service Unavailable`** with no
   `events_accepted` line. The browser console read
   `Access to fetch at 'http://localhost:8787/v1/events' … blocked by CORS policy` +
   `net::ERR_FAILED`, and the batch appears twice in `emitted[]` with the same first `event_id` (run
   3 `1f66031c`, run 6 `cdad2783`).
3. Since FOLLOW-1242 (#923) the SDK holds a failed batch and re-sends it with the same
   `Idempotency-Key` on its 2nd flush, about 5 s later (`dispatchEvents()` docblock,
   `packages/sdk/src/core/events.ts`). The re-send was accepted and written:
   ```text
   run 3  cta.clicked 1f66031c…  ts 10:34:00.043  ingest_received_at 10:34:06.093  (batch 6269e3d0, 6 events)
   run 6  cta.clicked cdad2783…  ts 10:39:16.196  ingest_received_at 10:39:24.345  (batch f02cf5c9, 6 events)
   ```
4. The harness waits `BATCH_INTERVAL_MS + 2000` = **7000 ms** after the click (read from the SDK
   source), which covers ONE flush, and then `measureThisRunAdaptedArm()` counts the session's
   `cta.clicked` once. The re-send lands on the second flush. Run 6: 8.15 s after the click. Run 3:
   6.05 s by the wall clock, but the host clock stepped back about 1.9 s during that window (see
   "Clock"), so about 7.9 s of real time. The count read 0, and the row is in ClickHouse now. The
   holdout arm's `adaptation_decisions` row (run 3 10:34:06.451, run 6 10:39:24.559) was written
   after the count, which fixes the order.

Run 1 took the same 503 on its `cta.clicked` batch (same double emission, same console line). Its
re-send landed at 10:32:40.111, 5.46 s after the click and inside the 7 s window, so it passed. **3
of 6 runs had their `cta.clicked` batch refused once, and 2 of the 3 re-sends missed the window.**
Across the whole session 4 of 34 `POST /v1/events` answered 503: three `cta.clicked` batches and one
`scroll.depth` batch. `apps/ingest/src` has no 503 path (as in §5.12), so the 503s came from
`wrangler dev`/workerd. Why it answers 503 is not identified.

**What this is and is not.** It is a harness measurement window that is shorter than the delivery
path the SDK now implements, meeting a local ingest that refused 4 of 34 sends. FOLLOW-1242 did its
job: before #923 the same 503 lost the conversion for good (§5.12 run 2). It is not a product
regression, and it is not a grounding consequence: AC(1), AC(2), AC(3), AC(4) and AC(7) passed on
all six runs. By the ruling it is still RED, and it reset the series both times. Nothing was
reclassified. Filed as **FOLLOW-1252**, where the AC(5) read waits for the SDK's retry schedule
(read from the producer, like `readSdkBatchIntervalMs()`) and the workerd 503 is diagnosed.

**AC(5) rollup 500 (§5.15 run 1): not recurred.** The run-level rollup answered 200 in every run, as
did the warm-up call. The harness still saves no body for a non-200 rollup → **FOLLOW-1250**.

**The `"Investment Performance"` refusal (§5.15 run 2): not recurred.** 0 of 6 quiz turns returned
`fact_check_refused`. The control-plane log has 0 `fact-check violation` lines, and the string
appears in none of the six artefacts. At 789 `tokens_in` the local `llm_calls` now reads 1
`llm_tweaked_fact_check_rejected` against 6 served, plus run 5's unbooked one. Kept as a watch →
**FOLLOW-1251 (P2)**.

**Clock.** The WSL host clock stepped backwards at least twice during the series, and the control
plane logged it. In run 3, `POST /api/adapt 200 in -1585ms` was request #3, which takes about 350 ms
on every other run. In run 5, the quiz-turn generation's `llm_calls` INSERT was refused:

```text
[llm-gateway] ClickHouse INSERT rejected: HTTP 500 — Code: 457. DB::Exception: Value -281 cannot be parsed as UInt32 for query parameter 'p_latency_ms' …
```

`llm-gateway.ts` measures durations with `Date.now()` differences, so a backward step gives a
negative `latency_ms`, and the `UInt32` column refuses the whole row. That is why run 5 has no
`tokens_in`. It also explains run 5's `msAfterRequest: 244` for a Haiku call: the harness timestamps
are wall-clock too. `ps -o lstart` for pid 123168 moved from 12:31:23 to 12:30:45 over the session,
with the same pid. `systemd-journald` logs `Time jumped backwards` repeatedly in `dmesg`. The grade
does not depend on it, because the settle waits are `setTimeout`s on a monotonic clock. But
millisecond deltas in these artefacts are only approximate, and the lost register row is a product
defect → **FOLLOW-1253**.

> **Corrected 2026-09-22 (§5.17): the settle is NOT on a monotonic clock.** Only its `sleepFn`
> pauses are `setTimeout`s. The floor, the 30 s budget and AC(5)'s 85 s poll budget are all compared
> against `now = Date.now()` (`settleForAdaptResponse()`, `pollThisRunConversion()`), so a
> wall-clock step moves them. No verdict in §5.16 or §5.17 depended on it → **FOLLOW-1255**.

**Postgres.** `pg_stat_activity` read 8 at the end (background workers and `psql` only). There was
no `PostgresError` or `too many clients` in the control-plane log. FOLLOW-1241 still holds.

**Shutdown.** All processes stopped. Ports 3000/5173/8081/8787/9100 are free, and the two containers
are left running.

### 5.17 — 2026-09-22 (FOLLOW-820 condition-1 graded series, EXECUTED ×6 at `bb1532a0`) — **not citable: G, G, R, G, R, G; both reds are the FOLLOW-1251 fact-check refusal, AC(5) held on every run**

The second series graded under the CEO rulings of 2026-09-22 (§3.6, MASTER_DESIGN §P.0 item 1).
Graded SHA **`bb1532a0`**, which carries #930 (§5.16), #931 (FOLLOW-1252: AC(5) polls for up to the
SDK-derived 85 s and names `thisRunConversionLoss`) and #932 (§6.10). Budget set before the first
run: stop at 3 consecutive `run=GREEN` or after 6 graded runs, whichever came first, with nothing
tuned, patched or restarted in between. The budget ran out at 6 graded runs, none UNMEASURED.

**Substrate.** A git worktree at `bb1532a0`, clean before and after every run. A real
`pnpm install --frozen-lockfile --offline` in the worktree (59 s), then `shared`/`db`/`auth`/`sdk`
built from HEAD. `readlink -f` put `apps/control-plane/node_modules/@estalara/{db,shared,auth,sdk}`
and `apps/ingest/node_modules/@estalara/shared` inside the worktree (§6.9). `pnpm db:migrate`: 0
pending (39 of 39). Containers `al_pg_local` + `estalara_ch_local` were already up. §3.3b on `:8081`
from the worktree answered all seven fields, and its `x-estalara-facts-source` named this worktree's
`fixture-listing.html`. Fixture on `:5173` (`npx serve`), bundle host on `:9100` (static only),
ingest on `:8787` (KV seeded per §3.5, `/health` 200, 0 `Could not resolve`, fresh `workerd` pids).
The control plane ran on `:3000` via the §3.4 `env` form, with its cwd in the worktree, and was
warmed per §6.6. **One control-plane process, pid 308502, served all six runs and was not
restarted.** Every run's preflight printed
`grounds listing_title, listing_description, listing_price, listing_location`.

| run | startedAt (UTC) | SHA        | TALLY                                                | `tokens_in` | quiz-turn `source`                  | `endedBy`       | `ac5Poll.waitedMs` | ingest 503 | re-send                   | red cause                                                                           |
| --- | --------------- | ---------- | ---------------------------------------------------- | ----------- | ----------------------------------- | --------------- | ------------------ | ---------- | ------------------------- | ----------------------------------------------------------------------------------- |
| 1   | 14:33:49        | `bb1532a0` | `TALLY green=6 red=0 unmeasured=0 total=6 run=GREEN` | 789         | `llm_tweaked`                       | `quiz-response` | 6925               | 2          | yes (incl. `cta.clicked`) | —                                                                                   |
| 2   | 14:35:13        | `bb1532a0` | `TALLY green=6 red=0 unmeasured=0 total=6 run=GREEN` | 789         | `llm_tweaked`                       | `quiz-response` | 3181               | 2          | yes (non-CTA batches)     | —                                                                                   |
| 3   | 14:35:51        | `bb1532a0` | `TALLY green=4 red=2 unmeasured=0 total=6 run=RED`   | 789         | `playbook_fallback_llm_unavailable` | `quiz-response` | 588                | 0          | no                        | AC(1)+AC(7): `fact_check_refused`, `feature` "Investment Performance" (FOLLOW-1251) |
| 4   | 14:36:47        | `bb1532a0` | `TALLY green=6 red=0 unmeasured=0 total=6 run=GREEN` | 789         | `llm_tweaked`                       | `quiz-response` | 603                | 0          | no                        | —                                                                                   |
| 5   | 14:37:31        | `bb1532a0` | `TALLY green=4 red=2 unmeasured=0 total=6 run=RED`   | 789         | `playbook_fallback_llm_unavailable` | `quiz-response` | 1327               | 0          | no                        | AC(1)+AC(7): `fact_check_refused`, `feature` "Investment Performance" (FOLLOW-1251) |
| 6   | 14:38:18        | `bb1532a0` | `TALLY green=6 red=0 unmeasured=0 total=6 run=GREEN` | 789         | `llm_tweaked`                       | `quiz-response` | 2666               | 0          | no                        | —                                                                                   |

Series by the ruling: G, G, **R (reset)**, G, **R (reset)**, G. The longest run of consecutive GREEN
runs is **2**, and **no citable series exists at `bb1532a0`**.

`tokens_in` is the quiz turn's generation row in `llm_calls`, joined on `session_id` (never on
`tenant_id`). For runs 3 and 5 that row is `llm_tweaked_fact_check_rejected`: the generation ran at
789 and was refused. "ingest 503" is the per-run delta of `grep -c 'POST /v1/events 503'` on the
wrangler log (§6.10). "re-send" is `ctaIngest.resent` from the artefact: in run 1 a `scroll.depth`
batch and the `cta.clicked` batch were each refused once and re-sent, and in run 2 a `scroll.depth`
batch and a `quiz.event` batch were, while its `cta.clicked` batch was accepted on first send. Each
run's settle was `quiz-response` on request #2, with `holdout_group: false` in the bodies and in
ClickHouse. The served adapted headlines were:

```text
run 1  "Single-family rental at 9 Blackberry Pl, Palm Coast, FL — three bedrooms, two bathrooms"
run 2  "Single-family rental investment — 3 bed, 2 bath on quiet residential street"
run 3  (none: refused, template cta + reorder only)
run 4  "Single-family rental at 9 Blackberry Pl, Palm Coast — stable residential market"
run 5  (none: refused, template cta + reorder only)
run 6  "Single-family rental investment on quiet residential street — 3 bed, 2 bath at 385000 USD"
       cta "Request Investment Pack" (all six)
```

**Staleness, every run** (`--check-staleness <artefact>`; `<scratch>` abbreviates the session
scratchpad path each artefact was copied to, and `bb1532a0…` the 40-character `harnessSha`, which
gitleaks' `cloudflare-api-token` rule matches; the rest is verbatim):

```text
[FRESH] <scratch>/run1.json: harnessSha bb1532a0… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-09-22T14:33:49.717Z
[FRESH] <scratch>/run2.json: harnessSha bb1532a0… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-09-22T14:35:13.110Z
[FRESH] <scratch>/run3.json: harnessSha bb1532a0… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-09-22T14:35:51.373Z
[FRESH] <scratch>/run4.json: harnessSha bb1532a0… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-09-22T14:36:47.649Z
[FRESH] <scratch>/run5.json: harnessSha bb1532a0… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-09-22T14:37:31.398Z
[FRESH] <scratch>/run6.json: harnessSha bb1532a0… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-09-22T14:38:18.220Z
```

**The two reds are one cause: the FOLLOW-1251 refusal, twice.** In both runs AC(1) and AC(7) failed
and nothing else did. AC(1) read `outcomes.adapted: 0` of 2 (`default` ×1,
`playbook_fallback_llm_unavailable/fact_check_refused` ×1). AC(7) failed on
`unmet: [adaptedArmHasNoAdaptedResponse]` while its control arm served 0 and logged 0 with
`drewHoldout true`, so the arms did separate. Only the adapted arm had nothing adapted to show. The
chain, read from the artefact, the control-plane log and ClickHouse:

1. The quiz turn's request #2 carried `archetypeHint: yield_hunter`, `confidence: 1`. Its response
   was `source: playbook_fallback_llm_unavailable`, `fallback_reason: fact_check_refused`, with
   directives `cta` "Request Investment Pack" (the authored template) + `reorder` only
   (`adapt_decision_id` run 3 `46699bd3`, run 5 `56313cb1`).
2. The control-plane log around that request. Run 3 is shown; run 5 is identical apart from
   `quiz/completion … in 682ms`, `sessionId f7c5442d…` and `POST /api/adapt 200 in 3940ms`:
   ```text
    POST /api/quiz/completion 201 in 659ms
   [llm-gateway] directive fact-check violation: hallucinated_proper_name archetype=yield_hunter slot=feature value="Investment Performance"
   [adapt] directive withheld — ungrounded template copy {"sessionId":"a5066e70…",…,"archetype":"yield_hunter",…,"withheld_slots":["headline","feature"]}
    POST /api/adapt 200 in 1994ms
   ```
   The whole session log has exactly 2 `fact-check violation` lines, one per red run, and both are
   this line. The `directive withheld` line is ESC-076's template withholding. It prints once on
   every run, when the later behavioural refresh serves the `playbook`, and once more in the red
   runs, because the refused turn's fallback is a template too.
3. `llm_calls`, by `session_id`: the same three rows in both runs, within 5 ms of each other:
   ```text
   a5066e70  14:36:12.704  fact_check_unjudged_exempt_authored   tokens_in   0  out   0
   a5066e70  14:36:12.706  fact_check_judge_flag_confirmed        tokens_in 338  out   9
   a5066e70  14:36:12.707  llm_tweaked_fact_check_rejected        tokens_in 789  out 316
   f7c5442d  14:37:59.480  fact_check_unjudged_exempt_authored   tokens_in   0  out   0
   f7c5442d  14:37:59.482  fact_check_judge_flag_confirmed        tokens_in 338  out   9
   f7c5442d  14:37:59.485  llm_tweaked_fact_check_rejected        tokens_in 789  out 299
   ```
   The judge ran and upheld the flag, as in §5.15 run 2, so this is not RETRO-318 judge-cap
   starvation.
4. ClickHouse `adaptation_decisions`, by `session_id`: `default` →
   `playbook_fallback_llm_unavailable` (2 directives, `holdout_group` false, `holdout_pct` 0.1,
   `scoring_path` `cosine`) → `playbook`. `events`: exactly one `cta.clicked` per session, in all
   six sessions.

This is the §5.15 run 2 failure again, byte for byte. It is a product refusal on a correctly
grounded prompt, not a harness or substrate artefact. By the ruling it is RED, and it reset the
series both times. Nothing was reclassified.

**FOLLOW-1251 (watch) — this series' data.** 2 of 6 quiz turns refused at 789 `tokens_in`, against 0
of 6 in §5.16. The local register now reads, at `tokens_in` 789, 10 `llm_tweaked` and 3
`llm_tweaked_fact_check_rejected` (plus §5.16 run 5's served but unbooked generation), so 3 of 14.
At 761, before FOLLOW-1249, it read 16 and 0. The stub's own AC says "Escalate to P1 if refusals
recur". They recurred, and at `bb1532a0` this refusal is the ONLY cause keeping condition 1 from a
citable series: AC(2), AC(3), AC(4) and AC(5) passed on all six runs, and AC(1)/AC(7) passed on
every run that was not refused.

**FOLLOW-1252: AC(5) held on every run, including a real re-send.** In run 1 the `cta.clicked` batch
took a §6.10 proxy 503 (`net::ERR_FAILED`, seq 5) and was re-sent with the same `Idempotency-Key`
(seq 7, 200). The poll saw the row at 6925 ms after 13 attempts, inside the 85000 ms budget.
`thisRunConversionLoss` was null on all six runs. ClickHouse holds one `cta.clicked` for that
session, so the re-send was written once.

**§6.10 counts.** `grep -c 'POST /v1/events 503'` = **4** over the session (2 in run 1, 2 in run 2,
0 after), against 34 `POST /v1/events 200` and 34 `events_accepted`.
`grep -c 'Reloading local server'` = **0**. That is the ProxyWorker trap exactly as diagnosed. No
Worker restart happened, and every refused batch was re-sent and accepted.

**FOLLOW-1253 (negative `latency_ms`) — this series' data.** No register row was lost: 0 `Code: 457`
/ `p_latency_ms` lines, 0 negative `POST … in -…ms` lines, and all 32 `llm_calls` rows for the six
sessions were booked with `latency_ms ≥ 0`. `dmesg` has no `Time jumped backwards` inside the series
window (the last one is about 14:00 UTC). **The wall clock still stepped during the series.**
`ps -o lstart` for pid 308502 read 16:32:36, then 16:32:10 after the series, then 16:32:06 at
shutdown, with the same pid. Run 6's settle recorded `waitedMs: 2341`, which is impossible without a
step: the loop leaves `quiz-response` only once `Date.now()` elapsed ≥ the 3000 ms floor, and then
sleeps the 1500 ms paint grace on a `setTimeout`. So the wall clock lost at least about 2.2 s inside
that settle. Run 3's refused generation also booked `latency_ms` 608 for 316 output tokens, where
the other five generations booked 1929–3453 ms for 204–320. That fits a step, but does not prove
one. So the product defect did not fire this time, while its trigger did.

**New findings.**

- **FOLLOW-1255 (harness).** The settle's floor and budget and AC(5)'s poll budget run on
  `Date.now()`, not on a monotonic clock. §5.16 said otherwise, and that sentence is now corrected.
  A forward step can end the AC(5) poll or the settle budget early and report a false RED; a
  backward step makes them wait longer. Run 6 shows a step of ≥ 2.2 s inside one settle. No verdict
  in this series depended on it.
- **FOLLOW-1256 (product copy).** Run 6 served a headline ending "at 385000 USD".
  `fetchListingTextFields()` (`apps/control-plane/src/lib/listing-details.ts`) builds the prompt's
  price as `` `${String(priceNum)} ${currency}` ``, with no grouping or currency symbol, and the
  model copied it verbatim. It is grounded and the fact check correctly passed it. The defect is
  that production's own reader hands the model an unformatted number to quote.

**Postgres.** `pg_stat_activity` read 8 at the end (1 client backend, the `psql` probe). There was
no `PostgresError` or `too many clients` in the control-plane log. FOLLOW-1241 still holds.

**Shutdown.** All processes stopped. Ports 3000/5173/8081/8787/9100 are free, and the two containers
are left running.

---

### 5.18 — 2026-10-04 (FOLLOW-1299, chat arm, EXECUTED ×11 at `14bbe8ba` and `4d683fe0`) — **AC(8) exists and is graded: three consecutive `run=GREEN` with `total=7` at `4d683fe0` (runs 8–10, then an 11th); red-first proven with the shim stopped**

The first series with the chat arm (AC(8), FOLLOW-820 condition 1b). Brought up by
`scripts/dev/localhost-up.sh` with the chat hop on, in a git worktree after a real
`pnpm install --frozen-lockfile --offline`; `readlink -f` put
`apps/control-plane/node_modules/@estalara/{db,shared}` inside the worktree (§6.9). The first `up`
stopped at step 10 (`/api/adapt still slower than 8 s after warm-up`, the host was also running an
unrelated video render); a second `up` left every service running and passed warm-up and the three
preflight probes. **One control-plane process (`next-server` pid 2258344, started 21:25:51 local)
served all eleven completed runs and was not restarted.** The tree was clean at every run start.

**Substrate differs from every earlier record: read §6.11 first.** The control plane now has a Redis
(`UPSTASH_REDIS_URL` → the `:8078` path adapter → SRH `:8079`), which condition 1b needs and which
no run in §5.1–§5.17 nor the K1 series had.

| run | startedAt (UTC) | SHA        | TALLY                                                     | AC(8)                | cause of anything not GREEN                                                                                         |
| --- | --------------- | ---------- | --------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | 19:33:04        | `14bbe8ba` | `TALLY green=5 red=2 unmeasured=0 total=7 run=RED`        | PASS                 | AC(1)+AC(7): quiz turn `fact_check_refused`, `feature` "Investment Performance" (FOLLOW-1251)                       |
| 2   | 19:35:58        | `14bbe8ba` | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | PASS                 | —                                                                                                                   |
| 3   | 19:37:09        | `14bbe8ba` | `TALLY green=6 red=1 unmeasured=0 total=7 run=RED`        | **FAIL (false RED)** | AC(8) hop 6: a HARNESS defect, wall-clock ordering (below). The product sent and served `yield_hunter` on request 8 |
| 4   | 19:38:20        | `14bbe8ba` | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | PASS                 | —                                                                                                                   |
| 5   | —               | `14bbe8ba` | (stopped mid-run by this session to fix run 3's defect)   | —                    | not a run                                                                                                           |
| 6   | 19:41:42        | `4d683fe0` | `TALLY green=6 red=0 unmeasured=1 total=7 run=UNMEASURED` | UNMEASURED:holdout   | the chat session drew holdout — neutral                                                                             |
| 7   | 19:42:19        | `4d683fe0` | `TALLY green=4 red=2 unmeasured=1 total=7 run=RED`        | UNMEASURED:holdout   | AC(1)+AC(7): `fact_check_refused` again (FOLLOW-1251); the chat session drew holdout                                |
| 8   | 19:42:53        | `4d683fe0` | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | PASS                 | —                                                                                                                   |
| 9   | 19:44:02        | `4d683fe0` | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | PASS                 | —                                                                                                                   |
| 10  | 19:45:13        | `4d683fe0` | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | PASS                 | —                                                                                                                   |
| 11  | 19:46:59        | `4d683fe0` | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | PASS                 | — (meant as the red-first run; the shim had survived the first kill, so it is a fourth GREEN)                       |
| 12  | 19:48:24        | `4d683fe0` | `TALLY green=6 red=1 unmeasured=0 total=7 run=RED`        | **FAIL (intended)**  | red-first: shim stopped on purpose (below)                                                                          |

Series by the ruling, at `4d683fe0`: U (neutral), **R (reset)**, **G, G, G**, G, then the deliberate
red. Three consecutive `run=GREEN` runs with `total=7` exist at `4d683fe0`: runs 8, 9 and 10.
Whether they are GO evidence for condition 1b is not decided here (§6.11's two points, and the
record's own caveats below).

**What a GREEN AC(8) looked like (run 8; runs 1, 2, 4, 9, 10 and 11 differ only in the stamp, the
session and, in run 1, the request numbers).**

```text
[chat-arm] hop 1 sdk_emitted_chat_message_sent: ok — the SDK POSTed a chat.message.sent carrying the scripted text for this session
[chat-arm] hop 2 ingest_acked_2xx: ok — ingest status 200
[chat-arm] hop 3 intent_engine_shim_reachable: ok — GET http://localhost:8090/health → 200
[chat-arm] hop 4 shadow_key_written_by_this_message: ok — key shadow:00000000-0000-0000-0000-0000000000e2:<session>:chat_intent detected_at 2026-10-04T19:43:51.770572+00:00
[chat-arm] hop 5 adapt_response_carries_chat_intent: ok — request #7 answered chat_intent_dimensions [purchase_purpose, finance_complexity, decision_role, risk_appetite, tax_aware] stamped 2026-10-04T19:43:51.770572+00:00
[chat-arm] hop 6 sdk_sent_folded_archetype_hint: ok — request #8 archetype_hint yield_hunter
[chat-arm] hop 7 adapt_response_archetype: ok — response archetype yield_hunter
[chat-arm] negative control: ok — baseline neutral, after the neutral message ["neutral","neutral","neutral","neutral"]
```

The shim's record for the scripted message, every run: `purchase_purpose: investment`,
`finance_complexity: standard_mortgage`, `decision_role: decider`, `risk_appetite: balanced`,
`tax_aware: true`, its own `archetype_hint: yield_hunter` at 0.72, `model_used: haiku-4.5`,
`data_source: model`. The neutral message's record: every dimension `null`,
`archetype_hint: neutral`, confidence 0 — written by the cold-key `SET … NX`, which is the proof the
shim processed it.

**Red-first, executed (run 12).** The shim's process session was stopped (`:8090` free, `/health` no
answer) and nothing else was touched:

```text
[chat-arm] hop 1 sdk_emitted_chat_message_sent: ok — the SDK POSTed a chat.message.sent carrying the scripted text for this session
[chat-arm] hop 2 ingest_acked_2xx: ok — ingest status 200
[chat-arm] hop 3 intent_engine_shim_reachable: BROKEN — GET http://localhost:8090/health → no answer
[chat-arm] hop 4 shadow_key_written_by_this_message: BROKEN — no record with a new detected_at appeared under this session — the dispatch never reached the shim, the extraction failed, or it carried no usable dimension
[chat-arm] hop 5 adapt_response_carries_chat_intent: BROKEN — no /api/adapt response carried the record's detected_at within the SDK's chat-refresh budget — the control plane is not reading the store the shim writes
[chat-arm] hop 6 sdk_sent_folded_archetype_hint: BROKEN — request #9 archetype_hint neutral
[chat-arm] hop 7 adapt_response_archetype: BROKEN — response archetype neutral
[chat-arm] negative control: FAILED — baseline neutral, after the neutral message ["neutral","neutral","neutral","neutral"] — NOT PROVEN: neutralMessageNeverReachedTheShim
[FAIL] AC(8) — … — brokenHop=3:intent_engine_shim_reachable; negativeControlNotProven:neutralMessageNeverReachedTheShim
TALLY green=6 red=1 unmeasured=0 total=7 run=RED
```

Ingest still answered 200 (hop 2 ok) and its log read
`[chat-nlp] Modal dispatch failed: Network connection lost.` — the 200-over-a-dead-pipeline that
`LOCAL_PILOT_ENVIRONMENT.md` §3.7 warns about. The negative control's archetypes were unchanged and
it is still graded FAILED, because an unchanged archetype over a dead chain proves nothing.

**Run 3's false RED, and the fix (`4d683fe0`).** The first version of the arm identified "the first
request after the reload" by comparing `Date.now()` stamps. In run 3 the wall clock stepped back
about 2 s between the carrying response and the reload: request 7 is stamped +32723 ms and request
8, issued after it, +31811 ms. The already-answered request 7 (the carrier,
`archetype_hint: neutral`) therefore satisfied "requested at or after the reload" and was graded as
the next call, while the real next call, request 8, sent `archetype_hint: yield_hunter` and was
answered `yield_hunter`. It is FOLLOW-1255's phenomenon in new code. The arm now orders by request
sequence number and waits on `performance.now()`. The predicate did not change. The older waits
FOLLOW-1255 names (the settle, AC(5)'s poll) still use `Date.now()`; run 8's `[settle]` line shows
it (`after 2028 ms`, `4145 ms after the request`).

**Staleness** (`--check-staleness <artefact>`; `<scratch>` abbreviates the session scratchpad path
and `4d683fe0…` the 40-character `harnessSha`, which gitleaks' `cloudflare-api-token` rule matches;
the rest is verbatim). Runs 6, 7, 11 and 12 read `[FRESH]` in the same words.

```text
[FRESH] <scratch>/run8.json: harnessSha 4d683fe0… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-10-04T19:42:53.313Z
[FRESH] <scratch>/run9.json: harnessSha 4d683fe0… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-10-04T19:44:02.669Z
[FRESH] <scratch>/run10.json: harnessSha 4d683fe0… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-10-04T19:45:13.628Z
```

**What these runs do NOT show — four things a grader must weigh.**

1. **The chat-derived response is not an adapted page.** In every GREEN run the response to the
   folded hint was `archetype: yield_hunter`, `confidence: 0.36683961839039025`, `source: default`.
   That is below the server gate (`> 0.6`), so it carried no adapted directives. One chat message in
   a session with no quiz answer moves the archetype LABEL and nothing a buyer sees. AC(8) asserts
   what §P.0 item 1b says (the archetype and the chat intent in the response); it does not assert a
   changed DOM.
2. **The "next" `/api/adapt` is drawn by a page reload.** The SDK's chat-refresh loop stops on the
   call that delivers the dimensions (`runChatRefresh()`: the watermark moved), and the folded
   archetype travels only on a later call. On a page where the buyer does nothing else, no later
   call is made. The harness reloads the page (the buyer's next page view), in the negative control
   too.
3. **`yield_hunter` rests on a tie broken by `tax_aware`.** `purchase_purpose=investment` alone
   weighs `yield_hunter` and `portfolio_builder` equally (0.7 each); the message also asks how the
   income is taxed, and `tax_aware=true` favours `yield_hunter`. The message was fixed before the
   first run and not changed.
4. **FOLLOW-1251 fired on 2 of 11 quiz turns** (runs 1 and 7); §5.17 had 2 of 6.

**Host.** 4918 MB RAM. `MemAvailable` read 1170–1400 MB at the end of each run (about 3.7 GB in
use), swap 4.5–4.7 GB in use; the same host ran VS Code throughout. `localhost-down.sh` ran after
run 12; no process from the worktree and none of the stack's ports remained.

### 5.19 — 2026-10-04 (FOLLOW-1299, chat arm, EXECUTED ×3 at `3e5cffee`, the squashed PR head) — **three consecutive `run=GREEN` with `total=7`; NOT a citable condition-1b series: only run 3 has its `[FRESH]` line**

Why this series exists: #956 was squashed to one commit after gitleaks flagged two >40-character
quoted identifiers in `ac8-verdict.test.ts` and `differentiator-e2e.mjs` as `cloudflare-api-token`
(renamed, predicate unchanged). Both files are in `HARNESS_TREE_PATHSPEC`, so §5.18's runs at
`4d683fe0` are stale against the PR head by the harness's own rule, and the PM reran the series at
`3e5cffee`. Same substrate as §5.18 (§6.11: `localhost-up.sh`, chat hop on, the `:8078` path
adapter), one `up`, **one un-restarted control plane for all three runs**, `localhost-down.sh`
after; no worktree process left.

| run | finished (UTC) | SHA        | TALLY                                                | AC(8) |
| --- | -------------- | ---------- | ---------------------------------------------------- | ----- |
| 1   | 20:06:36       | `3e5cffee` | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | PASS  |
| 2   | 20:07:51       | `3e5cffee` | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | PASS  |
| 3   | 20:09:04       | `3e5cffee` | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | PASS  |

Each run's `[PASS] AC(8)` line reads, in the same words as §5.18 run 8: _"one real chat.message.sent
moved the next /api/adapt archetype to yield_hunter through every hop … and a neutral message left
the archetype unchanged — neutral → yield_hunter after the message"_. No holdout draw, no
`fact_check_refused` (FOLLOW-1251) in these three.

**Staleness — only run 3 can show it.** The harness writes one artefact, `last-run.json`, and
overwrites it on every run; §5.18 copied it to `<scratch>/runN.json` after each run and this series
did not, so the artefacts of runs 1 and 2 are gone and their `[FRESH]` lines cannot be produced. Run
3 (the surviving artefact; its `startedAt` 20:07:52 is the second after run 2 finished):

```text
[FRESH] tests/e2e/follow-819/last-run.json: harnessSha 3e5cffee… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-10-04T20:07:52.564Z
```

By the series rule (MASTER_DESIGN §P.0 item 1b: three consecutive GREEN runs **each with its
`[FRESH]` line pasted**) this series is therefore **not citable for condition 1b**. What it does
show: the squashed head behaves exactly as `4d683fe0` did in §5.18 runs 8–10, so the rename did not
change the arm. §5.18's product findings (the chat-derived archetype lands at confidence 0.367 with
`source: default`, so no adapted directive is served; the SDK draws the next `/api/adapt` only after
a reload) hold here unchanged and are the subject of the CEO ruling that row 1b awaits. Lesson for
the next series: copy `last-run.json` to a per-run file after every run, before the next one starts.

### 5.20 — 2026-10-05 (FOLLOW-1301, chat arm WITHOUT its reload, EXECUTED ×5 + 1 red-first at `baec7ff6`) — **three consecutive `run=GREEN` with `total=7`, each with its `[FRESH]` line pasted: the SDK now draws the follow-up `/api/adapt` call itself after a chat-intent fold**

Why this series exists: FOLLOW-1301 removed the page reload §5.18's chat arm needed. The SDK's
chat-refresh loop stopped on the `/api/adapt` call that delivered `chat_intent_dimensions` (§5.18
finding 2), so the folded archetype reached the server only on a later call the SDK never issued.
When a fold moves the hint, `refreshDirectives()` now schedules exactly one follow-up through the
existing chat-refresh timer (once per `chatPriorAppliedAt` stamp, no retries, skipped when profiling
is opted out or a refresh is already pending; `packages/sdk/src/index.ts`, `chatFollowUpStamp`).
Substrate: §6.11 (`localhost-up.sh`, chat hop on, the `:8078` path adapter) started from the
`sdk-engineer/FOLLOW-1301-chat-refresh` worktree at `baec7ff6` (the squashed PR head is recorded by
the merge), one `up`, **one un-restarted control plane for every run below, red-first included**,
`localhost-down.sh` after; no worktree process left.

| run | finished (UTC) | TALLY                                                                                                                                                                                                                 | AC(8) |
| --- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | 22:05          | ABORTED pre-artefact — control-plane probe timeout: a swapped-out `next dev` lost to the 8 s budget (§6.6 now applies BETWEEN runs, not only after bring-up; runs 2+ were pre-warmed with one `POST /api/adapt` each) | n/a   |
| 2   | 22:07          | `TALLY green=5 red=2 unmeasured=0 total=7 run=RED` — AC(1)+AC(7): the FOLLOW-1251 fact-check refusal (known flake, §5.17/§5.18)                                                                                       | PASS  |
| 3   | 22:09          | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`                                                                                                                                                                  | PASS  |
| 4   | 22:11          | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`                                                                                                                                                                  | PASS  |
| 5   | 22:13          | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`                                                                                                                                                                  | PASS  |

Every GREEN run's hop 6 is the SDK's OWN call, same page view, no reload — e.g. run 3:
`[chat-arm] hop 6 sdk_sent_folded_archetype_hint: ok — request #6 archetype_hint yield_hunter` and
hop 7 `response archetype yield_hunter`; the negative control is graded on the SDK's own
chat-refresh calls (baseline `neutral`, after the neutral message `["neutral","neutral"]`). Per the
§5.19 lesson, `last-run.json` was copied to a per-run scratch file after EVERY run, so all three
GREEN runs carry their staleness line (`/tmp/follow819-1301` is the session scratchpad; `baec7ff6…`
abbreviates the 40-character `harnessSha`, which gitleaks' `cloudflare-api-token` rule matches —
same caveat as §5.18; the rest is verbatim):

```text
[FRESH] /tmp/follow819-1301/run3.json: harnessSha baec7ff6… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-10-05T22:09:22.047Z
[FRESH] /tmp/follow819-1301/run4.json: harnessSha baec7ff6… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-10-05T22:11:17.117Z
[FRESH] /tmp/follow819-1301/run5.json: harnessSha baec7ff6… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-10-05T22:13:11.735Z
```

**Red-first (the ticket's own AC).** After the series, `packages/sdk/src/index.ts` ALONE was
reverted to `main` (`c04c2a8d`), the SDK rebuilt (IIFE 151.63 KB), and one more run executed on the
same un-restarted control plane — every other byte identical:

```text
[chat-arm] hop 6 sdk_sent_folded_archetype_hint: BROKEN — no /api/adapt request was issued after the response that carried the chat intent
[chat-arm] hop 7 adapt_response_archetype: BROKEN — response archetype null
[FAIL] AC(8) — … brokenHop=6:sdk_sent_folded_archetype_hint
TALLY green=6 red=1 unmeasured=0 total=7 run=RED
RED: AC(8)
```

That is the pre-fix behaviour with the SDK file as the only delta; the tree was restored and rebuilt
after (the red run's artefact reads DIRTY by design and is quoted here, not cited).

**Bundle.** `packages/sdk/dist/estalara-sdk.iife.js`: gzip `main` @ `c04c2a8d` **42,243 B** →
`baec7ff6` **42,312 B** (**+69 B**; ESC-080 ceiling 43,136 B → 824 B headroom). Raw 155,269 →
155,411 B.

**Host.** 4918 MB RAM, VS Code and the full §6.11 stack resident throughout; ~1.0 GB `MemAvailable`
at run time (swap heavy — the run-1 abort above). No holdout draw on the adapted arm in any graded
run; FOLLOW-1251 fired only in run 2. Evidence scratch copies (run logs, per-run artefacts, fresh
lines, bundle measurements) are preserved in the session scratchpad and quoted in the FOLLOW-1301 PR
body; the citable record is this section.

### 5.21 — 2026-10-12 (FOLLOW-1302, chat arm graded on an ADAPTED response, EXECUTED ×3 + 1 red-first at `359db019`) — **three consecutive `run=GREEN` with `total=7`, each with its `[FRESH]` line: after a second consistent message, the SDK's own follow-up call is answered `llm_full` at confidence 0.664, no reload**

Why this series exists: the CEO ruling of 2026-10-05 (proposal 1) says condition 1b is NOT met by a
moved label. §5.18–§5.20's AC(8) graded `archetype: yield_hunter` at confidence 0.367 with
`source: default` — nothing a buyer sees. AC(8) now also needs hops 8–12 (§1 row 8): a second
rental-yield message that changes a dimension, and a response, on the same page view, that passes
AC(1)'s `isAdaptedResponse()`. FOLLOW-1306 (#975) made the SDK draw the follow-up call when a fold
crosses the 0.6 gate, not only when the archetype changes (Codex Review F-04).

Substrate: §6.11 (`scripts/dev/localhost-up.sh`, chat hop on, the `:8078` path adapter) from the
`qa-engineer/FOLLOW-1302-ac8-two-message-adapted` worktree after
`pnpm install --frozen-lockfile --offline`. The first `up` stopped at step 11 (the `:8081` grounding
probe timed out under swap; the server was up and answered 200 a minute later); a second `up`
(`SKIP_BUILD=1`, idempotent) left every service running and passed all four preflight probes. **One
control plane (`next-server` pid 536478, started 00:05:25 local) served the red-first run and all
three graded runs and was not restarted.** `main` moved by one docs-only commit (`42ec0b95`, no
measured path) between the red-first run and the series; the branch was rebased onto it before run
1, so the graded SHA is `359db019`. `localhost-down.sh` after run 3; no worktree process and none of
the stack's ports remained.

**The script and what the live shim extracted** (every run; `intent_dimensions` with nulls omitted):

| message                                                                                                                                                                         | extraction                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| neutral: _"hello, is anyone there?"_                                                                                                                                            | every dimension `null` (the cold-key record that proves the negative control)                                                                                  |
| 1: _"I want to buy this flat as a buy-to-let investment and rent it out straight away. What gross rental yield does it bring, and how is the rental income taxed?"_ (unchanged) | `purchase_purpose: investment`, `finance_complexity: standard_mortgage`, `decision_role: decider`, `risk_appetite: balanced`, `tax_aware: true`                |
| 2: _"I would buy it through my property investment company, a limited company I use for buy-to-let. What net rental yield would the company get after costs?"_ (new)            | the same, except `finance_complexity: investment_vehicle` and `cross_border: domestic` (which has no likelihood entry in `CHAT_INTENT_LIKELIHOODS`, no effect) |

Message 2 was chosen to change `finance_complexity` (Codex Review amendment to FOLLOW-1302) and
checked against the live shim on two throwaway sessions before the red-first run (both
`investment_vehicle`; `risk_appetite` read `balanced` once and `null` once). It was not changed
after.

**Initial state and the confidence the SDK's own fold reached** — read from the SDK's persisted
intent state (`estalara_intent_{session}` in sessionStorage, read-only, `[chat-arm] sdk intent`),
identical in all three graded runs: baseline `neutral` 0.3655 → after message 1 `yield_hunter`
0.36684 (under the gate: hops 6–7 move the label only) → after message 2 `yield_hunter` **0.66415**
(> 0.6). The follow-up call sent that confidence and was answered at it.

| run       | startedAt (UTC)  | SHA                        | TALLY                                                | AC(8)               | hop 12 (the response after message 2)                                       |
| --------- | ---------------- | -------------------------- | ---------------------------------------------------- | ------------------- | --------------------------------------------------------------------------- |
| red-first | 22:09:35 (10-11) | `3d772d95` + DIRTY harness | `TALLY green=6 red=1 unmeasured=0 total=7 run=RED`   | **FAIL (intended)** | none: no follow-up call was drawn (hop 11)                                  |
| 1         | 22:12:15 (10-11) | `359db019`                 | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | PASS                | request #10 `llm_full` `yield_hunter` 0.664, slots [headline, feature, cta] |
| 2         | 22:14:10 (10-11) | `359db019`                 | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | PASS                | request #9 `llm_full` `yield_hunter` 0.664, slots [headline, feature, cta]  |
| 3         | 22:16:05 (10-11) | `359db019`                 | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | PASS                | request #10 `llm_full` `yield_hunter` 0.664, slots [headline, feature, cta] |

Series by the ruling, at `359db019`: **G, G, G** — no RED, no holdout draw on either the quiz or the
chat session, no `fact_check_refused` in any run (FOLLOW-1251/1305 are on `main`), AC(1)
`llm_tweaked` on the quiz turn every run. Each run's negative control read
`baseline neutral, after the neutral message ["neutral","neutral","neutral"]`,
`navigations after baseline: 0`.

**What a GREEN AC(8) looks like (run 1; runs 2 and 3 differ only in the stamps, the session and the
request numbers).**

```text
[chat-arm] hop 7 adapt_response_archetype: ok — response archetype yield_hunter
[chat-arm] hop 8 second_message_emitted_and_acked: ok — the SDK POSTed the second chat.message.sent; ingest status 200
[chat-arm] hop 9 second_shadow_record_written: ok — detected_at 2026-10-11T22:13:46.217690+00:00 (first message 2026-10-11T22:13:30.928343+00:00)
[chat-arm] hop 10 adapt_response_carries_second_intent: ok — request #9 answered chat_intent_dimensions [purchase_purpose, cross_border, finance_complexity, decision_role, risk_appetite, tax_aware] stamped 2026-10-11T22:13:46.217690+00:00
[chat-arm] hop 11 sdk_drew_follow_up_above_gate: ok — request #10 sent archetype_hint yield_hunter confidence 0.6641488145588295 (gate > 0.6)
[chat-arm] hop 12 adapted_response_after_second_message: ok — request #10 llm_full yield_hunter confidence 0.6641488145588295 slots [headline, feature, cta]
[chat-arm] changed: [{"dimension":"cross_border","first":null,"second":"domestic"},{"dimension":"finance_complexity","first":"standard_mortgage","second":"investment_vehicle"}]
[chat-arm] navigations after baseline: 0
[chat-arm] negative control: ok — baseline neutral, after the neutral message ["neutral","neutral","neutral"]
TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN
```

**Red-first — the old predicate's shape, executed, and the recorded negative case.** Before the
series, on the same control plane, `CHAT_ARM_SCRIPT.secondMessage` ALONE was set to message 1's text
(so the second extraction repeats the first), one run executed, and the file was restored with
`git checkout`. The label moved exactly as in §5.18–§5.20 (hops 1–7 ok) and nothing was adapted:

```text
[chat-arm] hop 7 adapt_response_archetype: ok — response archetype yield_hunter
[chat-arm] hop 10 adapt_response_carries_second_intent: ok — request #7 answered chat_intent_dimensions [purchase_purpose, finance_complexity, decision_role, risk_appetite, tax_aware] stamped 2026-10-11T22:11:15.789007+00:00
[chat-arm] hop 11 sdk_drew_follow_up_above_gate: BROKEN — no /api/adapt request was issued after the response that carried the second message's intent — the fold did not change a decision input (hint or the gate side)
[chat-arm] hop 12 adapted_response_after_second_message: BROKEN — none of 0 response(s) after the carrier passed AC(1)'s predicate — sources [], confidences []
[chat-arm] changed: []
[chat-arm] sdk intent: {"baseline":{"archetype":"neutral","confidence":0.36554663991975933,…},"afterFirst":{"archetype":"yield_hunter","confidence":0.36683961839039025,…},"afterSecond":{"archetype":"yield_hunter","confidence":0.4033913780719174,…}}
[FAIL] AC(8) — … — brokenHop=11:sdk_drew_follow_up_above_gate
TALLY green=6 red=1 unmeasured=0 total=7 run=RED
RED: AC(8)
```

The identical extraction folded twice reached **0.403** live — under the gate, same archetype, so
the SDK correctly drew no follow-up (FOLLOW-1306's predicate) and the buyer saw nothing new. The
Codex intake's figure for this case was 0.484; from `initIntentState()` the same two folds give
0.463 (`ac8-verdict.test.ts`, G-04). The live figure is lower than both; the difference was not
investigated (the session's behavioural signals between the two messages are the likely cause). It
does not change the verdict: every figure is under 0.6. The run's artefact reads `[DIRTY]` by design
and is quoted here, not cited.

**Staleness** (`<scratch>` abbreviates the session scratchpad; `359db019…` abbreviates the
40-character `harnessSha`, which gitleaks' `cloudflare-api-token` rule matches — same caveat as
§5.18; the rest is verbatim). Read right after each run, before the next:

```text
[FRESH] <scratch>/run1.json: harnessSha 359db019… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-10-11T22:12:15.219Z
[FRESH] <scratch>/run2.json: harnessSha 359db019… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-10-11T22:14:10.649Z
[FRESH] <scratch>/run3.json: harnessSha 359db019… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-10-11T22:16:05.177Z
```

`359db019` is the harness commit as it ran; this record (README, MASTER_DESIGN, the test file's
comment) was then amended into the same commit, which touches no measured path, so at the PR head
the same three artefacts read FRESH-by-content (the PR body pastes those lines).

**What these runs do NOT show.**

1. **A changed DOM in the chat session.** AC(8) grades the adapted RESPONSE (AC(1)'s predicate); it
   does not assert that the chat session's slots were painted. AC(2) asserts painting for the quiz
   session only.
2. **That any second message crosses.** The crossing rests on the extraction carrying
   `finance_complexity: investment_vehicle` together with `purchase_purpose: investment`
   (`ac8-verdict.test.ts`, G-04: `investment_vehicle` alone stays under; with `tax_aware` but no
   purpose it flips to `golden_visa_buyer`). A buyer whose second message repeats the first sees
   nothing new — that is the ruling's design (the gate and one message's strength stay as they are),
   not a defect.
3. **The `:8078` adapter** is still a localhost stand-in no ruling has accepted (§6.11).
4. **Three runs.** FOLLOW-1251's refusal did not fire here; the series is short.

### 5.22 — 2026-10-13/14 (FOLLOW-1203, AC(5) graded on a SERVER-CONFIRMED conversion, EXECUTED ×4 + 1 red-first at `254a6d8b`) — **three consecutive `run=GREEN` with `total=7`, each with its `[FRESH]` line; the red-first run converts unsigned and AC(5) is RED on it**

**MANUAL.** `scripts/dev/localhost-up.sh` from the FOLLOW-1203 branch (`[pg_cache_off]` passed:
`control plane DATABASE_URL host: 127.0.0.1:5433`, `probe_rows=1 listing_revisions_rows=1`; the new
preflight line: `conversion emitter: configured; signed events go to http://localhost:8787`), one
control plane, never restarted, five runs back to back, `scripts/dev/localhost-down.sh` after.
`harnessSha` is `254a6d8b…`, the last pre-squash commit of the PR branch: its measured-path tree
(`HARNESS_TREE_PATHSPEC`) equals the PR head's, so `--check-staleness` reads FRESH at either
(FRESH-by-content at the squashed head, FOLLOW-1208). The local ClickHouse applied 0024 first:
`=== Migrations: 1 applied, 23 already recorded ===`, then `0 applied, 24 already recorded`.

| Run       | Started (UTC) | `TALLY`                                                   | AC(5) | This run's adapted session (`adaptedArm.thisRun`)      | Counts as |
| --------- | ------------- | --------------------------------------------------------- | ----- | ------------------------------------------------------ | --------- |
| red-first | 23:46:31      | `TALLY green=5 red=2 unmeasured=0 total=7 run=RED`        | RED   | `conversions: 0, ctaClicks: 1, signed: 0, unsigned: 1` | —         |
| 1         | 23:51:06      | `TALLY green=6 red=0 unmeasured=1 total=7 run=UNMEASURED` | PASS  | `conversions: 1, ctaClicks: 1, signed: 1, unsigned: 0` | neutral   |
| 2         | 23:52:30      | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | PASS  | `conversions: 1, ctaClicks: 1, signed: 1, unsigned: 0` | GREEN 1   |
| 3         | 23:54:26      | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | PASS  | `conversions: 1, ctaClicks: 1, signed: 1, unsigned: 0` | GREEN 2   |
| 4         | 23:56:22      | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | PASS  | `conversions: 1, ctaClicks: 1, signed: 1, unsigned: 0` | GREEN 3   |

Every run's `--check-staleness` line, taken right after it (path shortened to the file name):

```text
[FRESH] redfirst.json: harnessSha 254a6d8b… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-10-13T23:46:31.851Z
[FRESH] run1.json: harnessSha 254a6d8b… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-10-13T23:51:06.228Z
[FRESH] run2.json: harnessSha 254a6d8b… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-10-13T23:52:30.367Z
[FRESH] run3.json: harnessSha 254a6d8b… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-10-13T23:54:26.258Z
[FRESH] run4.json: harnessSha 254a6d8b… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 — no measured path changed since it; clean tree, run completed; startedAt 2026-10-13T23:56:22.678Z
```

AC(1) on all five: `outcomes.adapted: 1`, `sourcesObserved: {default: 1, llm_tweaked: 1}`.

**The red-first run (`FOLLOW1203_REDFIRST_UNSIGNED_CONVERSION=1`).** The adapted session converted
the pre-FOLLOW-1203 way: an `inquiry.completed` POSTed with the page key and an `Origin`, no
signature. Ingest answered **200** (ESC-084 ruling 2: accepted, not rejected) and the row landed
with `caller_signed = 0`. AC(5):

```text
unmetPreconditions: redFirstUnsignedConversion=engaged, adaptedConversions=0, thisRunConversions=0,
                    thisRunConversionLoss=only_unsigned_conversion
rollup.conversions: adaptedN 180, adaptedConversions 0, holdoutN 109, holdoutConversions 1,
                    preExposureConversions 0, unsignedConversions 1, ctaClickedSessions 191
ctaLift: -100   (0/180 against the one signed holdout conversion, 1/109)
```

So on the real stack a browser-emitted conversion is reported (`unsignedConversions: 1`) and moves
no numerator. **That run's second red, AC(8), is not this change:** it was the first run on a cold
control plane, `GET :8090/health` got no answer inside the probe's timeout (hop 3) and no
`/api/adapt` response carried the shim's record inside the SDK's chat-refresh budget (hop 5), while
the shim's own writes (hops 4, 8, 9) succeeded; the box had 1.3 GB available and 4.1 GB in swap. It
did not recur in runs 1–4 on the same plane, and the chat arm shares no code with the conversion.
Run 1 is `UNMEASURED` because the chat arm's session drew holdout (`AC(8)[holdout]`): neutral under
series rule (2).

**What ClickHouse holds for the run sessions** (`estalara_ch_local`, per run; identical for runs
1–4):

```text
                     arm                type               caller_signed  n
red-first            adapted(browser)   cta.clicked        0              1
                     adapted(browser)   inquiry.completed  0              1     ← unsigned: not counted
                     holdout(synthetic) cta.clicked        0              1
                     holdout(synthetic) inquiry.completed  1              1
runs 1–4 (each)      adapted(browser)   cta.clicked        0              1
                     adapted(browser)   inquiry.completed  1              1     ← the conversion
                     holdout(synthetic) cta.clicked        0              1
                     holdout(synthetic) inquiry.completed  1              1

all conversion events in the 7-day window:  inquiry.completed  caller_signed=0  1 row / 1 session
                                            inquiry.completed  caller_signed=1  9 rows / 9 sessions
```

**The rollup's lift after run 4** (`GET /api/admin/analytics/rollup`, `data_source: clickhouse`,
`conversion_source: signed_events`): numerators `adaptedConversions 4`, `holdoutConversions 5`;
denominators `adaptedN 188`, `holdoutN 114`; `ctaLift −51.49` = (4/188 − 5/114) / (5/114);
`preExposureConversions 0`, `unsignedConversions 1`, `ctaClickedSessions 199`. The 199 click
sessions are almost all from before this series: every `cta.clicked` in the window, none of which is
in the numerator any more. The value is non-positive by construction (the synthetic control always
converts, README §0) and is not graded. It moved from `null` before the series (no signed row
existed: the era boundary) to a number computed from nine signed rows.

**The attribution rule, checked live after the series (one hand-driven session, not a harness
run).** A signed conversion emitted for a fresh session BEFORE any `/api/adapt` call, then the
session's first decision:

```text
before            adaptedN 188  holdoutN 114  adaptedConversions 4  holdoutConversions 5  preExposureConversions 0
after conversion  (unchanged — no decision row, so the session is in no arm and no count)
after decision    adaptedN 189  holdoutN 114  adaptedConversions 4  holdoutConversions 5  preExposureConversions 1
```

The session entered the adapted denominator, its conversion landed in `preExposureConversions`, and
no numerator moved. That session (`f1203pre-…`) stays in the local substrate's 7-day window.

**What this series does and does not establish.** It establishes that the chain now ends in a
conversion a page cannot forge: signed by a process that holds a secret the page never sees, written
`caller_signed = 1` by the real ingest Worker, and counted by the production readers only when it
follows the session's first decision. It does not establish a lift: `ctaLift` stays non-positive by
construction. The signer is the localhost fixture, not the Estalara host backend; that emission, and
applying 0024 to production, are post-GO deployment steps (MASTER_DESIGN §P.0). The Playwright
"element is not stable" flake on the CTA click did not occur in these five runs; it can still red a
run, because the click is still a required hop (§1.1).

### 5.23 — 2026-10-14 (condition-1 series at `main` HEAD `f11534be`, EXECUTED ×3) — **three consecutive `run=GREEN` with `total=7`, each `[FRESH]` as an ANCESTOR of HEAD: the first series graded on a merged commit of `main` after every FOLLOW-820-path ticket**

**MANUAL, run by the PM.** `scripts/dev/localhost-up.sh` from a clean `main` checkout at `f11534be`
(#1007, FOLLOW-1203), all 11 steps plus `11b [pg_cache_off]` passed, the conversion emitter
preflight read `configured; signed events go to http://localhost:8787`. One control plane
(`next dev`, pid 1688050 before run 1 and after run 3 — never restarted), three runs back to back,
`scripts/dev/localhost-down.sh` after. No run was discarded, no RED, no holdout draw. The artefact
was copied after every run before the next and `--check-staleness` run on each copy.

| Run | Started (UTC)        | `TALLY`                                              | `--check-staleness`                                                                                                    |
| --- | -------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | 2026-10-14T00:21:21Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run1.json: harnessSha f11534be… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 … clean tree` |
| 2   | 2026-10-14T00:23:40Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run2.json: harnessSha f11534be… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 … clean tree` |
| 3   | 2026-10-14T00:25:39Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run3.json: harnessSha f11534be… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 … clean tree` |

`harnessSha` is abbreviated here (the artefacts hold all 40 characters; a 40-character hex in a
tracked file trips the secret scanner, §5.18). Unlike §5.19–§5.22, whose graded SHAs were pre-squash
branch commits that read FRESH only by content after the squash merge, this series was produced AT
the merged commit.

What every run graded GREEN: AC(1) an LLM-adapted `/api/adapt` response on the real control plane;
AC(2) a slot changed in the live DOM; AC(3) the decision row with its `scoring_path`; AC(4) bandit
frozen (D3); AC(7) the holdout mechanism separates the arms; AC(5) the rollup computed a lift from
real substrate rows with `data_source='clickhouse'` and `conversion_source='signed_events'`, and
this run's adapted session holds a signed conversion at or after its first decision (FOLLOW-1203);
AC(8) the chat arm through every hop to an adapted response after the second message (FOLLOW-1302).

**What this series does not show.** (a) The lift VALUE is not evidence of anything: run 3's rollup
read `ctaLift` −47.2 over 311 sessions (194 adapted, 117 holdout), because the harness confirms a
signed conversion for every holdout session and for one adapted session per run — the arms are
synthetic (§5.10's caveat stands; condition 1 is technical, ESC-073). (b) No description was
generated in-process during these runs (the persisted revision-1 row is served `ai_cached`, §6.13);
the in-process generation path was last exercised live in FOLLOW-1297 PR A's first series (PR #997
body; §6.13). (c) Grounding comes from the `:8081` fixture and the Redis path from the `:8078`
adapter, both localhost stand-ins. (d) The AC(5) CTA-click stability flake (two REDs in ten runs on
FOLLOW-1220's series) did not occur in these three runs and is not fixed.

### 5.24 — 2026-10-16 (condition-1 series at `main` HEAD `e8d1a04d`, EXECUTED ×3) — **three consecutive `run=GREEN` with `total=7`, each `[FRESH]` as an ancestor of HEAD; supersedes §5.23 as the citable series after FOLLOW-1314 and FOLLOW-1315 changed the description path**

**MANUAL, run by the PM.** Same procedure as §5.23: `scripts/dev/localhost-up.sh` from a clean
`main` checkout at `e8d1a04d` (#1012), every step plus `11b [pg_cache_off]` passed; one control
plane (pid 2002693 before run 1 and after run 3, never restarted); three runs back to back; artefact
copied after every run, `--check-staleness` on each copy; `scripts/dev/localhost-down.sh` after. No
run discarded, no RED, no holdout draw.

| Run | Started (UTC)        | `TALLY`                                              | `--check-staleness`                                                                                                    |
| --- | -------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | 2026-10-16T06:07:14Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run1.json: harnessSha e8d1a04d… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 … clean tree` |
| 2   | 2026-10-16T06:09:10Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run2.json: harnessSha e8d1a04d… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 … clean tree` |
| 3   | 2026-10-16T06:10:50Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run3.json: harnessSha e8d1a04d… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0 … clean tree` |

The caveats of §5.23 (a)–(d) apply unchanged. Since §5.23, the live description path was exercised
by hand (§6.14) and by FOLLOW-1315's before/after measurement (§6.16): with the new headline prompt
8 of 8 generated headlines were served for the fixture listing, one of them not grounded
("single-storey" for a single-family home — a lower-case claim no current check covers;
FOLLOW-1311).

### 5.25 — 2026-10-18 (checkpoint K0 baseline series at harness SHA `0d395ffb`, EXECUTED ×4) — **three `run=GREEN` with `total=7` (runs 1, 2, 4), each `[FRESH]` as an ancestor of HEAD; run 3 `run=UNMEASURED` (holdout draw, neutral per §P.0) — the baseline of the localhost-completion plan (`docs/PLAN-LOCALHOST-COMPLETION-2026-10-17.md`, checkpoint K0 control I1)**

**MANUAL, run by the PM.** `scripts/dev/localhost-up.sh` from a clean `main` checkout at `0d395ffb`
(#1014; the three Phase 0 merges after it — #1015, #1016, #1017 — are docs/CI only and outside
`HARNESS_TREE_PATHSPEC`, so `measuredPathsChanged=0` holds for every run). Full build (no
`SKIP_BUILD`), every step plus `11b [pg_cache_off]` passed on the second attempt — the first attempt
stopped at step 8 because a `.localhost-up/pids/ingest-8787.pid` left by the 2026-10-16 session
named a wrangler tree that was alive but no longer listening (defect recorded in
`docs/checkpoints/K0.md`). One control plane, never restarted across the four runs; artefact copied
after every run, `--check-staleness` on each copy; `scripts/dev/localhost-down.sh` after.

| Run | Started (UTC)            | `TALLY`                                                   | `--check-staleness`                                                                                                                                                      |
| --- | ------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 2026-10-18T08:17:29.073Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | `[FRESH] run1.json: harnessSha 0d395ffb… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T08:17:29.073Z` |
| 2   | 2026-10-18T08:20:25.110Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | `[FRESH] run2.json: harnessSha 0d395ffb… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T08:20:25.110Z` |
| 3   | 2026-10-18T08:22:26.124Z | `TALLY green=6 red=0 unmeasured=1 total=7 run=UNMEASURED` | `[FRESH] run3.json: harnessSha 0d395ffb… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T08:22:26.124Z` |
| 4   | 2026-10-18T08:24:33.589Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | `[FRESH] run4.json: harnessSha 0d395ffb… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T08:24:33.589Z` |

Run 3's `unmeasured=1` is the holdout draw §P.0 declares neutral ("a `run=UNMEASURED` run is
neutral"); it does not reset the count, so runs 1, 2 and 4 are the three consecutive `run=GREEN`.
The caveats of §5.23 (a)–(d) apply unchanged. The same day the real Estalara app was exercised on
the same control plane (quiz walk → `yield_hunter`, `llm_tweaked`, description `ai_cached` in 10.6
s) — recorded in `docs/checkpoints/K0.md` control I3, not here, because the harness cannot grade
that substrate.

### 5.26 — 2026-10-18 (checkpoint K1 series at `main` HEAD `4506baaa`, EXECUTED ×4) — **three consecutive `run=GREEN` with `total=7` (runs 2, 3, 4), each `[FRESH]` as an ancestor of HEAD; run 1 `run=RED` on AC(1)/AC(7)/AC(8) — a chat-arm cold start right after bring-up, diagnosed, not a regression**

**MANUAL, run by the PM.** `SKIP_BUILD=1 scripts/dev/localhost-up.sh` from a clean `main` checkout
at `4506baaa` (#1020 — Phase 1 of the localhost-completion plan: C1 FOLLOW-1321 and C2 FOLLOW-1322,
both `apps/control-plane/src` only, so `packages/*` dist was unchanged); every step plus
`11b [pg_cache_off]` passed; the control plane carried `NEXT_PUBLIC_ESTALARA_TENANT_ID` = the seeded
tenant (new in C2) and `/admin` answered 307 (not the cached 308). One control plane, never
restarted; artefact copied after every run, `--check-staleness` on each copy;
`scripts/dev/localhost-down.sh` after.

| Run | Started (UTC)            | `TALLY`                                              | `--check-staleness`                                                                                                                                                      |
| --- | ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 2026-10-18T09:15:14.576Z | `TALLY green=4 red=3 unmeasured=0 total=7 run=RED`   | `[FRESH] run1.json: harnessSha 4506baaa… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T09:15:14.576Z` |
| 2   | 2026-10-18T09:18:36.913Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run2.json: harnessSha 4506baaa… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T09:18:36.913Z` |
| 3   | 2026-10-18T09:20:34.458Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run3.json: harnessSha 4506baaa… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T09:20:34.458Z` |
| 4   | 2026-10-18T09:22:36.451Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run4.json: harnessSha 4506baaa… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T09:22:36.451Z` |

Run 1 is a legitimate RED, recorded as the header asks. Diagnosis from `run1.log`: the chat arm's
first Haiku extraction returned every dimension `null` (hop 5 "no /api/adapt response carried the
record's detected*at"), the second extraction was correct but the folded confidence stayed at 0.3668
(< 0.6 gate, hop 11), so no adapted response followed (hop 12) and AC(8), AC(1) and AC(7) fell
together; the credited variant in AC(4) was
`playbook_fallback_llm*\*`. Step 10 of the bring-up warms `/api/adapt`and the rollup but not the chat shim, so the very first LLM extraction after a cold start is the exposed call. Runs 2–4 on the same un-restarted control plane and SHA were GREEN with`llm_tweaked`/`llm_full`; C1/C2 touch neither `/api/adapt`
nor the chat path. Per §P.0 a RED resets the count, so the series of record is runs 2, 3, 4.
Follow-up folded into the bring-up hygiene scope (FOLLOW-1233/1246): warm the chat shim in step 10.
The caveats of §5.23 (a)–(d) apply.

### 5.27 — 2026-10-18 (checkpoint K2a series at `main` HEAD `bed16746`, EXECUTED ×4) — **three `run=GREEN` with `total=7` (runs 1, 2, 4), each `[FRESH]` as an ancestor of HEAD; run 3 `run=UNMEASURED` (the chat session drew holdout, AC(8) `UNMEASURED:holdout`, neutral per §P.0) — checkpoint K2a control I1 of the localhost-completion plan**

**MANUAL, run by the PM.** Full `scripts/dev/localhost-up.sh` (not `SKIP_BUILD`: R4 #1026 touched
`packages/sdk`, so `dist` had to be rebuilt) from a clean `main` checkout at `bed16746` — the first
Phase 2 batch of the plan: R1 #1023, R2 #1024, R3 #1025, R4 #1026, R7 #1029, plus R5 #1027 and R9
#1028 merged before the series. Every step passed; the control plane ran with
`NEXT_PUBLIC_ESTALARA_TENANT_ID` = the seeded tenant. One control plane, never restarted; artefact
copied after every run, `--check-staleness` on each copy; `scripts/dev/localhost-down.sh` after.
Before the bring-up the main checkout was cleaned of ignored residue of ten long-deleted
apps/packages (`.turbo`, `dist`, `node_modules`, `.venv`) — it had inflated the local N1 and
deployment-surface gates (never CI); see `docs/checkpoints/K2a.md` finding 1.

| Run | Started (UTC)            | `TALLY`                                                   | `--check-staleness`                                                                                                                                                      |
| --- | ------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 2026-10-18T12:33:04.300Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | `[FRESH] run1.json: harnessSha bed16746… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T12:33:04.300Z` |
| 2   | 2026-10-18T12:36:18.072Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | `[FRESH] run2.json: harnessSha bed16746… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T12:36:18.072Z` |
| 3   | 2026-10-18T12:38:55.882Z | `TALLY green=6 red=0 unmeasured=1 total=7 run=UNMEASURED` | `[FRESH] run3.json: harnessSha bed16746… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T12:38:55.882Z` |
| 4   | 2026-10-18T12:40:10.928Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | `[FRESH] run4.json: harnessSha bed16746… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T12:40:10.928Z` |

Run 3 is neutral, not red: its six graded criteria passed and AC(8) reported `[UNMEASURED:holdout]`
— the fresh chat session was bucketed into the holdout arm, whose branch serves no chat intent by
design (FOLLOW-1299 wording in the harness: "UNMEASURED for this run — NOT failed. Re-run"). That is
the same draw as §5.25 run 3. No cold-start RED this time (cf. §5.26 run 1): run 1 came ~2 min after
step 10, long enough for the chat shim to be warm. The caveats of §5.23 (a)–(d) apply.

### 5.28 — 2026-10-18 (checkpoint K2b series at `main` HEAD `a47018ce`, EXECUTED ×4) — **three consecutive `run=GREEN` with `total=7` (runs 2, 3, 4), each `[FRESH]` as an ancestor of HEAD; run 1 `run=RED` on AC(8) (chat-shim cold start) and `[DIRTY]` (a stale untracked artefact) — checkpoint K2b control I1 of the localhost-completion plan**

**MANUAL, run by the PM.** Full `scripts/dev/localhost-up.sh` (rebuild: R6 #1033 touched
`packages/sdk` and `packages/shared`) from a clean `main` checkout at `a47018ce` (R6 FOLLOW-1328 —
the detection chain removed; R5 #1027 proved on the stack earlier the same day, K2b entry gate).
Every step passed. One control plane, never restarted; artefact copied after every run,
`--check-staleness` on each copy; `scripts/dev/localhost-down.sh` after.

| Run | Started (UTC)            | `TALLY`                                              | `--check-staleness`                                                                                                                                                                   |
| --- | ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 2026-10-18T13:52:24.639Z | `TALLY green=6 red=1 unmeasured=0 total=7 run=RED`   | `[DIRTY] run1.json: run at harnessSha a47018ce… started with uncommitted changes in [packages/sdk/corpus-report.json] — the SHA does not name the bytes that ran; refusing to grade…` |
| 2   | 2026-10-18T13:56:00.998Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run2.json: harnessSha a47018ce… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T13:56:00.998Z`              |
| 3   | 2026-10-18T13:58:15.037Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run3.json: harnessSha a47018ce… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T13:58:15.037Z`              |
| 4   | 2026-10-18T14:00:09.296Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run4.json: harnessSha a47018ce… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T14:00:09.296Z`              |

Run 1 is a legitimate RED, recorded as the header asks, and doubly disqualified: (a) its AC(8) chat
arm hit the cold start of §5.26 run 1 again (hop 3 `GET :8090/health` no answer, extraction 1 every
dimension `null`, folded confidence 0.306 < 0.6, so hops 5–7 and 11–12 fell; the six other criteria
passed); (b) `--check-staleness` refused to grade it as `[DIRTY]`:
`packages/sdk/ corpus-report.json`, a June artefact of the deleted `test:corpus`, became untracked
when R6 dropped its `.gitignore` line. The file was deleted before run 2; nothing regenerates it.
Runs 2–4 on the same un-restarted control plane and SHA were GREEN with `llm_tweaked`/`llm_full`.
Per §P.0 a RED resets the count, so the series of record is runs 2, 3, 4. The caveats of §5.23
(a)–(d) apply.

### 5.29 — 2026-10-18 (R8 FOLLOW-1330 series at `main` HEAD `0c75f7cf`, EXECUTED ×3) — **three consecutive `run=GREEN` with `total=7` (runs 1, 2, 3), each `[FRESH]` as an ancestor of HEAD — the per-PR series of plan Phase 2 R8 (the rollup route the harness reads for AC(5) was re-scoped to one tenant); K2c closes after R10/R11**

**MANUAL, run by the PM.** `SKIP_BUILD=1 scripts/dev/localhost-up.sh` from a clean `main` checkout
at `0c75f7cf` (#1035 — R8: `api/admin/analytics/rollup` scoped to `ESTALARA_TENANT_ID`, the
`/admin/analytics` page deleted, its panels moved to the tenant hub; `apps/control-plane/src` only,
`packages/*` dist unchanged since the §5.28 build at `a47018ce`). Every step passed; the chat shim
answered `/health` before run 1, so no cold-start RED this time. One control plane, never restarted;
artefact copied after every run, `--check-staleness` on each copy; `scripts/dev/localhost-down.sh`
after.

| Run | Started (UTC)            | `TALLY`                                              | `--check-staleness`                                                                                                                                                      |
| --- | ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 2026-10-18T14:46:54.875Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run1.json: harnessSha 0c75f7cf… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T14:46:54.875Z` |
| 2   | 2026-10-18T14:49:53.900Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run2.json: harnessSha 0c75f7cf… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T14:49:53.900Z` |
| 3   | 2026-10-18T14:52:15.835Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run3.json: harnessSha 0c75f7cf… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T14:52:15.835Z` |

The R8 STOP check of the plan (K2c: "AC(5) `conversion_source ≠ signed_events` → the analytics
collapse broke the lift reader") did not trigger: on every run AC(5) read the re-scoped rollup with
`data_source='clickhouse'`, `conversion_source='signed_events'`, `scoring_path_source='live'` and a
non-null `ctaLift` (run 1: `sessions=381, adapted=242, holdout=139`). The tenant fence the route now
applies to the scoring-path and reorder-withheld queries changed nothing on localhost, where every
row carries the OPS tenant. The caveats of §5.23 (a)–(d) apply.

### 5.30 — 2026-10-18 (checkpoint K2c series at `main` HEAD `1de62758`, EXECUTED ×3) — **three consecutive `run=GREEN` with `total=7` (runs 1, 2, 3), each `[FRESH]` as an ancestor of HEAD — checkpoint K2c control I1 of the localhost-completion plan; Phase 2 (R1–R11) complete**

**MANUAL, run by the PM.** Full `scripts/dev/localhost-up.sh` (rebuild: R11 #1039 touched
`packages/shared` and the ingest Worker) from a clean `main` checkout at `1de62758` (R10 #1030, R11
#1039, FOLLOW-1347 #1037 and the docs PR #1038 since §5.29). Every step passed; the chat shim and
ingest answered `/health` before run 1. One control plane, never restarted; artefact copied after
every run, `--check-staleness` on each copy. The real Estalara app (N3-lite) was driven on the same
stack after run 3 (`docs/checkpoints/K2c.md` control I3); `scripts/dev/localhost-down.sh` after.

| Run | Started (UTC)            | `TALLY`                                              | `--check-staleness`                                                                                                                                                      |
| --- | ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 2026-10-18T16:56:03.546Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run1.json: harnessSha 1de62758… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T16:56:03.546Z` |
| 2   | 2026-10-18T16:59:02.380Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run2.json: harnessSha 1de62758… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T16:59:02.380Z` |
| 3   | 2026-10-18T17:01:21.931Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN` | `[FRESH] run3.json: harnessSha 1de62758… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-18T17:01:21.931Z` |

Run 1 logged one `[FOLLOW-1125] ⚠ ADAPTED-ARM ASSIGNMENT INDETERMINATE (clickhouse_unreachable)`
inside AC(5)'s evidence: the harness's `chQuery(...).catch(() => null)` turns any transient into
that label, and the first run after a full rebuild started with ~1 GB free. AC(5) itself passed on
all three runs with `data_source='clickhouse'`, `conversion_source='signed_events'` and a non-null
`ctaLift` (the K2c STOP check); the label did not recur in runs 2–3 and had not appeared in any of
the 19 runs of §5.25–§5.29. After R11 the origin gate admits `http://localhost:5173` only outside a
production build (`packages/shared/src/browser-origins.ts`), which is what let the fixture page and
the real app through here. The caveats of §5.23 (a)–(d) apply.

### 5.31 — 2026-10-19 (checkpoint K3 series at `main` HEAD `434b2513`, EXECUTED ×7 after a RED pair at `3952ac29`) — **three `run=GREEN` with `total=7` (runs 1, 5, 7), each `[FRESH]` as an ancestor of HEAD; runs 2, 4, 6 `run=UNMEASURED` (the chat session drew holdout), run 3 `run=UNMEASURED` (the adapted session drew holdout) — checkpoint K3 control I1 of the localhost-completion plan; Phase 3 (M1–M5) complete**

**MANUAL, run by the PM.** Two series on one day. First, at `3952ac29` (M1 #1042, M3 #1041, M5
#1043, M2 #1044, N2 full #1045 since §5.30), full `scripts/dev/localhost-up.sh` from a clean `main`
checkout: runs 1 and 2 both `TALLY green=6 red=1 … run=RED` on **AC(8) hop 11** (the request after
the second chat message carried confidence 0.30570 and 0.36684 against the 0.6641488145588295 of
every green run since §5.26). Per the plan's STOP rule (RED twice → bisect) a read-only forensic
(Opus, `scratchpad/k3/forensic-ac8.md`) settled it from the 16 run JSONs without re-running: no
commit in `1de62758..3952ac29` touched `packages/sdk` or the harness; run 2 was an **SDK race** (two
chat-refresh timer chains in flight at once, the harness grading a request issued 1889 ms before the
carrier was answered, so it still carried the pre-fold confidence), run 1 was the cold-shim shape of
K2b run 1 (hop 3 BROKEN, a dwell tick stripping the ×1.2 chat bonus). Fixes: #1046 (FOLLOW-1352:
hops 6 and 11 grade the first request sent after the SDK's persisted `chatPriorAppliedAt` equals the
fold's stamp, the page stays open for the follow-up) and #1047 (FOLLOW-1351: one chat-refresh chain
at a time). Second, at `434b2513`, the same bring-up from a clean checkout; the shim and ingest
answered `/health` before run 1; one control plane, never restarted; artefact copied after every
run, `--check-staleness` on each copy; `pnpm run test:backoffice` (N2) on the same stack after run 7
(`docs/checkpoints/K3.md` control I4); `scripts/dev/localhost-down.sh` after.

| Run | Started (UTC)            | `TALLY`                                                   | `--check-staleness`                                                                                                                                                      |
| --- | ------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 2026-10-19T11:42:52.932Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | `[FRESH] run1.json: harnessSha 434b2513… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-19T11:42:52.932Z` |
| 2   | 2026-10-19T11:46:00.951Z | `TALLY green=6 red=0 unmeasured=1 total=7 run=UNMEASURED` | `[FRESH] run2.json: … startedAt 2026-10-19T11:46:00.951Z` — AC(8) `UNMEASURED:holdout` (the chat session drew holdout), neutral per §P.0                                 |
| 3   | 2026-10-19T11:47:25.296Z | `TALLY green=2 red=0 unmeasured=5 total=7 run=UNMEASURED` | `[FRESH] run3.json: … startedAt 2026-10-19T11:47:25.296Z` — the adapted session drew holdout (`holdout_pct` 1): AC(1)/(2)/(3)/(5)/(8) `UNMEASURED`, neutral per §P.0     |
| 4   | 2026-10-19T11:49:26.305Z | `TALLY green=6 red=0 unmeasured=1 total=7 run=UNMEASURED` | `[FRESH] run4.json: … startedAt 2026-10-19T11:49:26.305Z` — AC(8) `UNMEASURED:holdout`, neutral                                                                          |
| 5   | 2026-10-19T11:51:06.968Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | `[FRESH] run5.json: harnessSha 434b2513… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-19T11:51:06.968Z` |
| 6   | 2026-10-19T11:53:20.591Z | `TALLY green=6 red=0 unmeasured=1 total=7 run=UNMEASURED` | `[FRESH] run6.json: … startedAt 2026-10-19T11:53:20.591Z` — AC(8) `UNMEASURED:holdout`, neutral                                                                          |
| 7   | 2026-10-19T11:55:25.840Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | `[FRESH] run7.json: harnessSha 434b2513… is an ancestor of HEAD, commitsBehind=0, measuredPathsChanged=0… clean tree, run completed; startedAt 2026-10-19T11:55:25.840Z` |

Hop 11 read 0.6641488145588295 on runs 1, 5 and 7 (request #9 / #10 / #9 ADAPTED `llm_full`, 3
non-reorder directives, no reload). Four UNMEASURED draws in seven runs is the 1-in-2 holdout of the
local fixture tenant doing its job, not a defect; a `run=UNMEASURED` run neither counts nor resets
the streak (§P.0, CEO 2026-09-22). **Residual after #1046 (recorded, not fixed):** the negative
control's wait (`sentAt + cycleMs + 3000`) can end with the neutral chain still in flight — the runs
counted 2 or 3 neutral responses; the predicate is correct, the count is loose. It is re-cut
together with AC(10) in Faza Q package Q6. **Design note** (superseded by Faza Q): the gate at hop
11 is crossed only through the chat ×1.2 bonus (`intent.ts:866`), and a dwell or behavioural
recompute strips it; the quiz plan (`docs/PLAN-QUIZ-ACCURACY-2026-10-19.md` §B) keeps that scale for
chat-without-quiz only and anchors a confirmed quiz leaf. The caveats of §5.23 (a)–(d) apply.

### 5.32 — 2026-10-20 (Faza Q package Q2 FOLLOW-1357 series at branch HEAD `39208e88`, EXECUTED ×6) — **three consecutive `run=GREEN` with `total=7` (runs 4, 5, 6), each `[FRESH]`; runs 1–3 `run=UNMEASURED` (holdout draws, neutral per §P.0) — the per-PR series of the quiz widget v2 (#1055, merged as `9df1ffb4`)**

**MANUAL, run by the PM.** Full `scripts/dev/localhost-up.sh` from a clean checkout of the PR branch
(a first bring-up failed at step 11: the `:8081` grounding probe timed out with ~1.1 GB free while
`next dev` compiled; the second bring-up passed every step). One control plane, never restarted;
artefact copied and `--check-staleness` after every run.

| Run | Started (UTC)            | `TALLY`                                                   | `--check-staleness`                                        |
| --- | ------------------------ | --------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | 2026-10-20T07:11:00.617Z | `TALLY green=5 red=0 unmeasured=2 total=7 run=UNMEASURED` | `[FRESH]` run1.json: harnessSha 39208e88… ancestor of HEAD |
| 2   | 2026-10-20T07:15:04.559Z | `TALLY green=2 red=0 unmeasured=5 total=7 run=UNMEASURED` | `[FRESH]` run2.json: harnessSha 39208e88… ancestor of HEAD |
| 3   | 2026-10-20T07:17:00.673Z | `TALLY green=2 red=0 unmeasured=5 total=7 run=UNMEASURED` | `[FRESH]` run3.json: harnessSha 39208e88… ancestor of HEAD |
| 4   | 2026-10-20T07:18:37.609Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | `[FRESH]` run4.json: harnessSha 39208e88… ancestor of HEAD |
| 5   | 2026-10-20T07:20:11.716Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | `[FRESH]` run5.json: harnessSha 39208e88… ancestor of HEAD |
| 6   | 2026-10-20T07:21:49.496Z | `TALLY green=7 red=0 unmeasured=0 total=7 run=GREEN`      | `[FRESH]` run6.json: harnessSha 39208e88… ancestor of HEAD |

On the same stack, `quiz_runs` (H002, applied by the bring-up) held 6 `shown` + 6 `completed` rows,
one `definition_hash`, 3 `step_ms` entries and the trait each run picked — the Q3 recording path
works end to end with consent-gated pings. AC(1) adapted to `first_time_buyer` (the harness's
first-answer walk on the v3 tree), `llm_tweaked`. **Finding (pre-existing, FOLLOW-1365):** every run
walked the SDK's BUILT-IN tree (`definition_hash` `builtin-en-v2`, no confirmation step), because
`fetchQuizConfig`'s 1000 ms timeout (`packages/sdk/src/core/quiz-config.ts:140`) aborts against the
local `next dev` control plane (~1 s plus a ~0.5 s CORS preflight); the served v2 tree with its
`confirm` block was never exercised. AC(10) and checkpoint KQ1 need it fixed first. The caveats of
§5.23 (a)–(d) apply.

### 5.33 — 2026-10-21 (checkpoint KQ1 series at `main` HEAD `8c08deba`, EXECUTED ×3) — **three consecutive `run=GREEN` with `total=8` (runs 1, 2, 3), each `[FRESH]` — checkpoint KQ1 of Faza Q (AC(10) quiz confirmation path GREEN live)**

**MANUAL, run by the PM.** Full `scripts/dev/localhost-up.sh` from a clean `main` checkout at
`8c08deba` (step 10 warmed `/api/quiz/public-config`: 200, served hash `6fce0f72…`, 699 ms); one
control plane, never restarted; `last-run.json` deleted before each run and `--check-staleness` on
each copy; nothing else running on the machine.

| Run | Started (UTC)            | `TALLY`                                              | `--check-staleness`                                                       |
| --- | ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | 2026-10-20T22:21:26.628Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` harnessSha `8c08deba…`, commitsBehind=0, measuredPathsChanged=0 |
| 2   | 2026-10-20T22:26:08.391Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` same                                                            |
| 3   | 2026-10-20T22:29:15.114Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` same                                                            |

`quiz_runs` written during the series: 6 `confirmed`, 3 `corrected`, 3 `unconfirmed`, 3 `shown`, all
on the served hash; AC(10)(b) corrected `first_time_buyer → family_buyer` and the first request
after the correction folded was `llm_tweaked`. A first series on the same SHA was not counted: its
run 3 was a harness preflight timeout (a RED substrate that resets the streak). An earlier attempt
on `1d578ba9` crashed in every run (`configOf is not defined`, fixed by #1073). Ledger:
`docs/checkpoints/KQ1.md`. The caveats of §5.23 (a)–(d) apply.

### 5.34 — 2026-10-21 (QA-sweep fixes FOLLOW-1370/1371/1372 + FOLLOW-1373 series at branch HEAD `b2c3dce9`, EXECUTED ×3) — **three consecutive `run=GREEN` with `total=8` (runs 1, 2, 3), each `[FRESH]` — the per-PR series of #1077 (served-only quiz card, no bundled tree; merged as `d7ac20cf`), on top of #1076 (PL copy, new served hash)**

**MANUAL, run by the PM.** Full `scripts/dev/localhost-up.sh` at `b2c3dce9` (#1077's head, rebased
on `e88d6747` = #1076); one control plane, never restarted; `--check-staleness` on each copy.

| Run | Started (UTC)            | `TALLY`                                              | `--check-staleness`                                                       |
| --- | ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | 2026-10-21T20:37:58.961Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` harnessSha `b2c3dce9…`, commitsBehind=0, measuredPathsChanged=0 |
| 2   | 2026-10-21T20:43:14.936Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` same                                                            |
| 3   | 2026-10-21T20:46:07.004Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` same                                                            |

`quiz_runs` written during the series: 6 `confirmed`, 3 `corrected`, 3 `unconfirmed`, 3 `shown`, all
on the new served hash `2e95f96e…` (FOLLOW-1373); no row carries a non-served hash — the SDK no
longer bundles a tree (FOLLOW-1370). SDK bundle 42,249 B gzip. The caveats of §5.23 (a)–(d) apply.

### 5.35 — 2026-10-21 (FOLLOW-1376 series at branch HEAD `2b7e5317`, control plane under `next start`, EXECUTED ×4) — **three `run=GREEN` with `total=8` (runs 1, 2, 4), each `[FRESH]`; run 3 `run=UNMEASURED` (the adapted session drew holdout, neutral per §P.0) — the first series on a production-mode control plane (`CP_MODE=prod`)**

**MANUAL, run by the PM.** `CP_MODE=prod scripts/dev/localhost-up.sh` at `2b7e5317`: the control
plane ran as `next build && next start` with `ESTALARA_LOCAL_ORIGINS=1`. The build took 6–10 min.
The first bring-up failed step 11 once: the ingest Worker answered `/health` in ~5 s while the build
swapped (`bound_but_silent`). A re-run with the processes left running passed all 11 steps. Admin
pages then answered in 5–120 ms with no first-visit compile.

| Run | Started (UTC)            | `TALLY`                                                   | `--check-staleness`                       |
| --- | ------------------------ | --------------------------------------------------------- | ----------------------------------------- |
| 1   | 2026-10-21T21:52:03.336Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN`      | `[FRESH]` harnessSha `2b7e5317…`          |
| 2   | 2026-10-21T21:54:36.819Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN`      | `[FRESH]` same                            |
| 3   | 2026-10-21T21:56:35.224Z | `TALLY green=3 red=0 unmeasured=5 total=8 run=UNMEASURED` | `[FRESH]` same (adapted arm drew holdout) |
| 4   | 2026-10-21T21:58:48.388Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN`      | `[FRESH]` same                            |

The caveats of §5.23 (a)–(d) apply.

### 5.36 — 2026-10-22 (FOLLOW-1377 series at branch HEAD `c3948431`, control plane under `next start`, EXECUTED ×7) — **three consecutive `run=GREEN` with `total=8` (runs 5, 6, 7), each `[FRESH]`; runs 1 and 3 `run=RED` on AC(5) only (the analytics rollup answered HTTP 500), run 4 `run=UNMEASURED` (holdout) — the per-PR series of #1081 (Claude 5.x generation models)**

**MANUAL, run by the PM.** `CP_MODE=prod scripts/dev/localhost-up.sh` at `c3948431`; one control
plane, never restarted.

| Run | Started (UTC)            | `TALLY`                                                   | Note                                         |
| --- | ------------------------ | --------------------------------------------------------- | -------------------------------------------- |
| 1   | 2026-10-22T18:20:09.763Z | `TALLY green=7 red=1 unmeasured=0 total=8 run=RED`        | AC(5): `GET /api/admin/analytics/rollup` 500 |
| 2   | 2026-10-22T18:22:55.415Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN`      |                                              |
| 3   | 2026-10-22T18:25:04.833Z | `TALLY green=7 red=1 unmeasured=0 total=8 run=RED`        | AC(5): same 500                              |
| 4   | 2026-10-22T18:28:38.732Z | `TALLY green=3 red=0 unmeasured=5 total=8 run=UNMEASURED` | adapted arm drew holdout                     |
| 5   | 2026-10-22T18:30:50.189Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN`      |                                              |
| 6   | 2026-10-22T18:32:56.572Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN`      |                                              |
| 7   | 2026-10-22T18:35:14.292Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN`      |                                              |

All seven `[FRESH]` (harnessSha `c3948431…`, ancestor of HEAD). The two REDs are the rollup route's
Rule K.2 500 (a ClickHouse rollup query that failed), not this PR: the route imports none of the
files #1081 changes, three manual calls right after run 3 answered 200 (0.4–3.5 s), and a probe
every 10 s through runs 4–6 saw no non-200. AC(1) and AC(10) were GREEN in all seven runs. Filed as
FOLLOW-1379. The caveats of §5.23 (a)–(d) apply.

### 5.37 — 2026-10-25 (FOLLOW-1381/1382/1387 series at branch HEAD `0a4a772b`, control plane under `next start`, global model `claude-sonnet-5-5`, EXECUTED ×12) — **three consecutive `run=GREEN` with `total=8` (runs 12, 13, 14), each `[FRESH]` — the per-PR series of #1083 (merged as `6aa0303d`)**

**MANUAL, run by the PM.** `CP_MODE=prod scripts/dev/localhost-up.sh` at `0a4a772b`; the local
`app_config.generation_model` set to `claude-sonnet-5-5` (migration 0018 seeds 4.6) so the series
exercised the new default. The machine was heavily loaded the whole time (load average 20–40: a
second Claude session ran e2e tests with docker in another project, and the local ClickHouse spent
~2 cores merging its own `system.*_log` tables, ~1 bn rows — truncated afterwards, FOLLOW-1391).

| Run(s) | Started (UTC)                 | Result                                                  | Cause                                                 |
| ------ | ----------------------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| 1      | 2026-10-25T20:42:13.988Z      | `green=7 red=1` `run=RED`, AC(8)                        | chat shim :8090 did not answer (hop 3, cold shim)     |
| 2, 3   | 20:48:12.745Z, 20:51:51.801Z  | `green=8` `run=GREEN` ×2                                |                                                       |
| 4, 5   | 20:57:31.463Z, 20:58:44.635Z  | `HARNESS ABORTED`                                       | preflight timeouts (control plane, ingest) under load |
| 6      | 20:59:06.569Z                 | `green=7 red=1` `run=RED`, AC(8)                        | chat arm under load                                   |
| 7      | 21:07:44.653Z                 | `run=UNMEASURED` (holdout)                              |                                                       |
| 10     | 22:47:32.934Z                 | `HARNESS ABORTED`                                       | control-plane probe timeout                           |
| 11     | 22:47:51.721Z                 | `green=7 red=1` `run=RED`, AC(5)                        | analytics rollup (FOLLOW-1379)                        |
| 12–14  | 22:51:29.282Z → 22:56:37.066Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` ×3 | `[FRESH]` harnessSha `0a4a772b…`                      |

No RED in any run touched the description/headline path changed by #1083 (AC(1), AC(2), AC(10) GREEN
in every run that completed). The caveats of §5.23 (a)–(d) apply.

### 5.38 — 2026-10-26 (FOLLOW-1383/1384/1388/1389/1390 series at branch HEAD `1f326021`, control plane under `next start`, global model `claude-sonnet-5-5`, EXECUTED ×3) — **three consecutive `run=GREEN` with `total=8` (runs 20, 21, 22), each `[FRESH]` — the per-PR series of #1085 (merged as `bd33f229`)**

**MANUAL, run by the PM.** `CP_MODE=prod scripts/dev/localhost-up.sh` at `1f326021`; the local
`app_config.generation_model` set to `claude-sonnet-5-5`, as in §5.37.

| Run(s) | Started (UTC)            | Result                                               | Cause                            |
| ------ | ------------------------ | ---------------------------------------------------- | -------------------------------- |
| 20     | 2026-10-26T00:11:33.203Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` harnessSha `1f326021…` |
| 21     | 00:13:30.293Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` harnessSha `1f326021…` |
| 22     | 00:15:02.010Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` harnessSha `1f326021…` |

Three consecutive GREEN runs, no RED or ABORTED run in the series. The caveats of §5.23 (a)–(d)
apply.

### 5.39 — 2026-10-26 (FOLLOW-1392/1393/1394/1395 series at branch HEAD `df69dd2d`, control plane under `next start`, global model `claude-sonnet-5-5`, EXECUTED ×7) — **three consecutive `run=GREEN` with `total=8` (runs 34, 35, 36), each `[FRESH]`; run 30 `run=UNMEASURED` (holdout), run 33 `run=RED` on AC(5) only (a harness flake, FOLLOW-1398) — the per-PR series of #1086 (merged as `9560950a`)**

**MANUAL, run by the PM.** `CP_MODE=prod scripts/dev/localhost-up.sh` at `df69dd2d`; the local
`app_config.generation_model` set to `claude-sonnet-5-5`, as in §5.37.

| Run | Started (UTC)            | `TALLY`                                                   | Note                                                   |
| --- | ------------------------ | --------------------------------------------------------- | ------------------------------------------------------ |
| 30  | 2026-10-26T01:14:32.967Z | `TALLY green=3 red=0 unmeasured=5 total=8 run=UNMEASURED` | adapted arm drew holdout                               |
| 31  | 01:16:15.132Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN`      |                                                        |
| 32  | 01:17:51.945Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN`      |                                                        |
| 33  | 01:19:40.402Z            | `TALLY green=7 red=1 unmeasured=0 total=8 run=RED`        | AC(5): CTA `locator.click` timeout 5000 ms, no overlay |
| 34  | 01:21:26.606Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN`      |                                                        |
| 35  | 01:23:09.738Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN`      |                                                        |
| 36  | 01:24:53.442Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN`      |                                                        |

All seven `[FRESH]` (harnessSha `df69dd2d…`, ancestor of HEAD, clean tree). The RED in run 33 is a
harness flake, not this PR: the CTA button was found, but Playwright's click waited 5000 ms for it
to become stable ("element is not stable": the CTA re-rendered after adaptation), no quiz overlay
was visible, and the run therefore never clicked, so no conversion was requested. Filed as
FOLLOW-1398 (wait for a stable CTA). AC(10) was GREEN in all seven runs, AC(1) and AC(2) in every
run but run 30, where they were UNMEASURED (holdout). The caveats of §5.23 (a)–(d) apply.

### 5.40 — 2026-10-26 (FOLLOW-1400/1401/1402/1403/1404/1405 series at branch HEAD `dc9da931`, control plane under `next start`, global model `claude-sonnet-5-5`, EXECUTED ×3) — **three consecutive `run=GREEN` with `total=8` (runs 40, 41, 42), each `[FRESH]` — the per-PR series of #1089 (merged as `6e4fd350`)**

**MANUAL, run by the PM.** `CP_MODE=prod scripts/dev/localhost-up.sh` at `dc9da931`; the local
`app_config.generation_model` set to `claude-sonnet-5-5`, as in §5.37.

| Run(s) | Started (UTC)            | Result                                               | Cause                            |
| ------ | ------------------------ | ---------------------------------------------------- | -------------------------------- |
| 40     | 2026-10-26T03:27:30.868Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` harnessSha `dc9da931…` |
| 41     | 03:29:06.647Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` harnessSha `dc9da931…` |
| 42     | 03:30:40.145Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` harnessSha `dc9da931…` |

Three consecutive GREEN runs, no RED or ABORTED run in the series. The caveats of §5.23 (a)–(d)
apply.

### 5.41 — 2026-10-30 (FOLLOW-1411 series on `main` at `2ac3d9d0`, after the merge of #1093, control plane under `next start`, global model `claude-sonnet-5-5`, EXECUTED ×3) — **three consecutive `run=GREEN` with `total=8` (runs 110, 111, 112), each `[FRESH]` — the post-merge series of #1093**

**MANUAL, run by the PM.** #1093 was merged with CI green before its series ran, so the series ran
on `main` after the merge. `CP_MODE=prod scripts/dev/localhost-up.sh` at `2ac3d9d0`; the local
`app_config.generation_model` set to `claude-sonnet-5-5`, as in §5.37. The first bring-ups failed in
`next build` on a stale local build of `@estalara/shared` (a poisoned turbo cache entry, then the
`.next/cache/eslint` results computed against it); neither reaches CI or Vercel, which build fresh.

| Run(s) | Started (UTC)            | Result                                               | Cause                            |
| ------ | ------------------------ | ---------------------------------------------------- | -------------------------------- |
| 110    | 2026-10-30T00:56:08.746Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` harnessSha `2ac3d9d0…` |
| 111    | 00:58:05.652Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` harnessSha `2ac3d9d0…` |
| 112    | 01:00:04.104Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` harnessSha `2ac3d9d0…` |

Three consecutive GREEN runs, no RED or ABORTED run in the series. The caveats of §5.23 (a)–(d)
apply.

### 5.42 — 2026-10-30 (FOLLOW-1415 series at branch HEAD `d8a08b38`, control plane under `next start`, global model `claude-sonnet-5-5`, EXECUTED ×4) — **three `run=GREEN` with `total=8` (runs 113, 115, 116) and one holdout draw (run 114, UNMEASURED, neutral), each `[FRESH]` — the per-PR series of #1095 (merged as `2e6c0315`)**

**MANUAL, run by the PM.** `CP_MODE=prod scripts/dev/localhost-up.sh` at `d8a08b38`; the local
`app_config.generation_model` set to `claude-sonnet-5-5`, as in §5.37.

| Run(s) | Started (UTC)            | Result                                                    | Cause                                                       |
| ------ | ------------------------ | --------------------------------------------------------- | ----------------------------------------------------------- |
| 113    | 2026-10-30T01:28:11.709Z | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN`      | `[FRESH]` harnessSha `d8a08b38…`                            |
| 114    | 01:30:00.136Z            | `TALLY green=3 red=0 unmeasured=5 total=8 run=UNMEASURED` | adapted arm drew HOLDOUT (`holdout_group: true`); not a RED |
| 115    | 01:31:43.674Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN`      | `[FRESH]` harnessSha `d8a08b38…`                            |
| 116    | 01:33:33.822Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN`      | `[FRESH]` harnessSha `d8a08b38…`                            |

Three GREEN runs with no RED or ABORTED run; the holdout draw counts as neutral (CEO ruling
2026-09-22). The caveats of §5.23 (a)–(d) apply.

> **CORRECTION 2026-10-30 — this series did NOT exercise the FOLLOW-1415 code.** `localhost-up.sh`
> found the control plane of §5.41 still running ("control-plane-3000: already running - leaving
> it") and did not rebuild it, so runs 113–116 were served by the `main` `2ac3d9d0` build; `[FRESH]`
> proves only the harness checkout. FOLLOW-1415 is live-validated by §5.43 (runs 120–126, a fresh
> `next build` of a tree that contains it).

### 5.43 — 2026-10-30 (FOLLOW-1412 series at branch HEAD `6389f429`, which contains FOLLOW-1415 `2e6c0315`; fresh `next build` (BUILD_ID 03:15 CET), control plane under `next start`, global model `claude-sonnet-5-5`, EXECUTED ×7) — **three consecutive `run=GREEN` with `total=8` (runs 124, 125, 126), each `[FRESH]` — the per-PR series of #1097 (merged as `059d955f`) and the live validation of #1095**

**MANUAL, run by the PM.** The control plane was stopped by PID first; the bring-up log reads
`control-plane-3000: started` and the served chunk carries the restored CTA. Live `family_buyer`
CTAs observed: "Get Family Buyer Guide" (the restored playbook string), "Schedule a Family Tour",
"Schedule Your Family Tour"; the pre-1412 "Get the Moving-Up Guide" no longer appears.

| Run(s) | Started (UTC)            | Result                                               | Cause                                                                 |
| ------ | ------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------- |
| 120    | 2026-10-30T02:16:52.353Z | `TALLY green=7 red=1 unmeasured=0 total=8 run=RED`   | AC(8) hop 3 `intent_engine_shim_reachable` — first run after bring-up |
| 121    | 02:19:23.120Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` harnessSha `6389f429…`                                      |
| 122    | 02:21:18.659Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` harnessSha `6389f429…`                                      |
| 123    | 02:22:58.012Z            | `TALLY green=7 red=1 unmeasured=0 total=8 run=RED`   | AC(5) CTA `locator.click` timeout, element not visible (FOLLOW-1398)  |
| 124    | 02:24:38.843Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` harnessSha `6389f429…`                                      |
| 125    | 02:26:33.020Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` harnessSha `6389f429…`                                      |
| 126    | 02:28:23.257Z            | `TALLY green=8 red=0 unmeasured=0 total=8 run=GREEN` | `[FRESH]` harnessSha `6389f429…`                                      |

Three consecutive GREEN runs (124–126). The two REDs are harness-side (shim warm-up, CTA click
flake), not product defects. The caveats of §5.23 (a)–(d) apply.

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

`CORS_DEV_EXTRA_ORIGINS` (`apps/control-plane/src/lib/origin-policy.ts`; since FOLLOW-1333 the
shared constant `packages/shared/src/browser-origins.ts`) is a hardcoded
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
Register it — `hashed_key = SHA-256(rawKey)`, hex. (Before FOLLOW-1333 the row also needed its
origin column to cover the fixture origin; origins are a constant list now.)

### 6.4 §3.6's KV seed names a different tenant than the fixture

The runbook seeds `api_key:pilot-key → tenant 839ecbd1-0000-4000-8000-000000000001` (the `:5173`
pilot), while this fixture declares `data-tenant-id="00000000-0000-0000-0000-0000000000e2"`
(`local-e2e`). Seed the KV record against the tenant the fixture actually claims, or ingest
attributes events to the wrong tenant.

---

### 6.5 §3.4's `pnpm dev` routes through Turbo, which STRIPS `DEMO_MODE_JWT_SECRET` — every `/api/adapt` call 500s

**Moved (FOLLOW-1132, 2026-09-14).** This is a repository-configuration defect, not a harness
defect, so it now lives where everyone who starts the control plane will read it:
`docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §3.5.1 holds the measurement, the `turbo.json` fix, the
one-call diagnostic (with a bearer; the bearer-less form cannot tell the two states apart) and its
pasted before/after outputs.

Short form, for a reader who arrived here from the §3.6 table: `500 demo_auth_misconfigured` on a
bearer-carrying probe means `DEMO_MODE_JWT_SECRET` did not reach `next dev`. Since FOLLOW-1132,
`turbo.json` passes the environment through to the `dev` task, so both
`pnpm dev --filter=@estalara/control-plane` from the repo root and §3.4's `cd apps/control-plane`
form (no Turbo) carry it. The 2026-08-25 measurement and the 2026-09-13 FOLLOW-1205 annotation that
this section used to hold are summarised in §3.5.1 of the runbook.

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

> **⚠️ Corrected 2026-09-21 (§5.12): this is NOT a dev-server leak.** `createAdminClient()` opens a
> new pool on every call in product code (+4 connections per rollup request, measured), so it
> applies to any long-lived instance, Fluid Compute included. Fix: [FOLLOW-1241]. Until it merges,
> restarting the control plane between runs remains the workaround.
>
> **Fixed and verified 2026-09-21 (§5.13):** at `0025663f` three runs plus 16 extra rollup requests
> on one process held at most 2 connections. No restart is needed between runs.

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

### 6.9 In a git worktree with symlinked `node_modules`, the control plane runs the MAIN checkout's `packages/*/dist`

**Found 2026-09-21 (§5.13), before the run, not by it.** The usual worktree shortcut symlinks
`node_modules` and `apps/*/node_modules` to the main checkout. pnpm's workspace links inside them
are relative, so `apps/control-plane/node_modules/@estalara/db` resolves to the MAIN checkout's
`packages/db`, and `@estalara/db`'s `exports` point at `dist/`. That `dist/` was dated 2026-07-28,
two months before [FOLLOW-1241]. `transpilePackages` does not help, because it transpiles whatever
the exports resolve to. A run done that way would have graded a worktree's `packages/*` fix while
executing code that predates it, and a leak measurement taken on it would have looked like "the fix
did not work". Nothing logs which copy loaded.

Check before starting the control plane from a worktree:

```bash
readlink -f apps/control-plane/node_modules/@estalara/db   # must be inside THIS checkout
```

If it is not, run `pnpm install --frozen-lockfile --offline` in the worktree (about 40 s from the
store) and then build the packages the control plane imports:
`pnpm --filter @estalara/shared --filter @estalara/db --filter @estalara/auth --filter @estalara/sdk build`.

### 6.10 `wrangler dev` answers some `POST /v1/events` with its OWN 503, because the SDK flushes every 5.000 s

**Diagnosed 2026-09-22 ([FOLLOW-1252], §5.16's "substrate" half).** 4 of 34 ingest POSTs in the
`d7e8ad26` series got `503` with no CORS header (the browser shows `net::ERR_FAILED`) and no
`events_accepted` line. The ingest Worker did not produce them. `wrangler dev` (3.114.17) puts a
**ProxyWorker** on `:8787` in front of the real Worker, and the two talk over a pooled loopback HTTP
connection. The KJ HTTP stack under workerd closes an idle keep-alive connection after 5 s on the
server side and reuses it for up to 5 s on the client side. The SDK flushes on
`setInterval(flush, BATCH_INTERVAL_MS)` with `BATCH_INTERVAL_MS = 5_000`
(`packages/sdk/src/index.ts`). That cadence lines each POST up with the moment the idle connection
is closed, so the ProxyWorker's `fetch()` to the Worker throws before any request byte is delivered.
The ProxyWorker then returns this body with `503` and `Retry-After: 0`:
`Your worker restarted mid-request. Please try sending the request again. Only GET or HEAD requests are retried automatically.`
It returns that body even when no restart happened. Its "did the Worker change?" check compares the
full request URL with a URL built without the path (`urlFromParts(proxyData.userWorkerUrl)` in
`wrangler-dist/ProxyWorker.js`), so for `/v1/events` the check can never match. Every network error
on a POST is therefore reported as a restart. Upstream report:
[workers-sdk#14641](https://github.com/cloudflare/workers-sdk/issues/14641), still open, and it
reproduces on wrangler 4.x too.

Reproduced on one `wrangler dev` with SDK-shaped POSTs from a real Chromium page on
`http://localhost:5173` (50 POSTs per row):

| Target                                | Cadence (fixed, like `setInterval`) | 503 / `ERR_FAILED` |
| ------------------------------------- | ----------------------------------- | ------------------ |
| `:8787` (ProxyWorker)                 | 5000 ms                             | 13 / 50            |
| the Worker's own port (proxy skipped) | 5000 ms                             | 0 / 50             |
| `:8787` (ProxyWorker)                 | 5500 ms                             | 1 / 50             |

A Node client at a fixed 5000 ms cadence got 13 / 40, and every one had the body above. The series
log has no `Reloading local server` line, which a real restart prints, and the failed requests never
reached the app. The series had 30 `200`s and exactly 30 `events_accepted` lines, and the re-sent
batches were written to ClickHouse once each.

**Production is not affected (by construction; not measured against the deployed Worker).** The
deployed Worker has no ProxyWorker and no loopback hop, and the failing hop is exactly that one. The
browser-to-server hop at the same cadence was clean: the second row of the table is Chromium talking
straight to a workerd listener over keep-alive at 5000 ms, 0 / 50. The Worker's own error responses
(4xx, 429, and an unhandled 500 routed through `app.onError`) carry `Access-Control-Allow-Origin`,
and `apps/ingest/src/index.test.ts` "CORS — FOLLOW-1252" pins that. The only CORS-less 503 comes
from the wrangler proxy.

**What it costs a run.** The SDK re-sends a refused batch with the same `Idempotency-Key` on its
next flush (FOLLOW-1242), so no event is lost. A refused batch lands about 5 s late, though. With
about a quarter of POSTs refused, any read that waits for exactly one flush (AC(5)'s `cta.clicked`
count, §5.16) can come up empty.

**How to recognise it.** It is this trap, not a Worker fault, when all of the following hold:

```bash
grep -c 'POST /v1/events 503' <the wrangler log>   # > 0
grep -c 'Reloading local server' <the wrangler log> # 0: no real restart happened
```

**Mitigation.** Do not change product code for this: the SDK's cadence is correct against the edge,
and its retry already recovers every refused batch. On the local side, any read that depends on one
specific batch must wait for at least the SDK's 2nd flush. FOLLOW-1252's AC(5) poll does this. To
remove the 503s entirely, the harness could point the SDK at the Worker's own port instead of
`:8787`. That port is random on every start, though. Find it with `ss -ltnp | grep workerd`: it is
the second `workerd`'s listener that answers `GET /health` with `200`. That is fragile, so it is not
the default.

### 6.11 The control plane could not read the shadow key on localhost: no `UPSTASH_REDIS_URL`, and SRH does not speak the URL-path form (FOLLOW-1299)

Found 2026-10-04 while building AC(8), before any chat run. Two separate breaks at the same hop
(shadow key → `/api/adapt`), either of which leaves chat with no effect and no error:

1. `localhost-up.sh` started the control plane under `doppler run -c dev` with no
   `UPSTASH_REDIS_URL`, and Doppler `dev` carries none (`doppler secrets --only-names` lists
   `UPSTASH_API_KEY` and `UPSTASH_EMAIL` only). `readShadowChatIntent()` returns `null` when the
   variable is unset, by design.
2. Pointing it at SRH (`:8079`) does not help. The control plane's four Redis readers
   (`chat-intent-cache.ts`, `description-cache.ts`, `tenant-schema.ts`, `feedback-nonce.ts`) use
   Upstash's URL-path REST form, `GET {base}/get/<key>`. SRH implements the POST-body form only:

   ```text
   POST http://localhost:8079        ["SET","probe1299","ok"]   → 200
   GET  http://localhost:8079/get/probe1299                     → 404 {"error":"SRH: Endpoint not found. SRH might not support this feature yet."}
   POST http://localhost:8079/pipeline [["DEL","probe1299"]]    → 200 [{"result":1}]
   ```

   The reader treats a non-2xx as "no key" (fail-open), so the shim's write is invisible.

`LOCAL_PILOT_ENVIRONMENT.md` §3.7 verified the chain only as far as the shadow key (read back with a
POST-body `GET`), so neither break showed there.

**What the bring-up does now.** `scripts/dev/upstash-rest-path-adapter.mjs` listens on `:8078`,
rewrites the path form into the body form and forwards it to SRH with the caller's bearer;
`localhost-up.sh` starts it with the chat hop and gives the control plane
`UPSTASH_REDIS_URL=http://localhost:8078` + `UPSTASH_REDIS_TOKEN`. It holds no state and invents no
value: every byte it returns is SRH's answer about the Redis the shim wrote to. It is inside
`HARNESS_TREE_PATHSPEC`.

**Two things a grader must weigh.** (a) The adapter is a localhost stand-in in the measured path of
condition 1b, like the `:8081` grounding server is for condition 1; production reads real Upstash,
which speaks the path form natively. Whether AC(8) runs through it count as GO evidence is a ruling
this file does not make. (b) Giving the control plane a Redis switches on its three other Redis
users on localhost for the first time (description cache, tenant-schema cache, feedback replay
nonce), so runs from FOLLOW-1299 on are not on the same substrate as the K1 series or §5.1–§5.17.

### 6.12 The description route's Postgres cache layer was OFF on localhost: no `DATABASE_URL` (FOLLOW-1313)

`/api/adapt/description` reads its persistent cache (`description_cache_persistent`, with the
`claims-v1` stamp of FOLLOW-1305 and the `listing_revisions` fence of FOLLOW-1291) through `getDb()`
in `apps/control-plane/src/lib/description-pg-cache.ts`, which returns `null` when
`process.env.DATABASE_URL` is unset, and every read/write then no-ops as a fail-open miss, with no
log line. `localhost-up.sh` exported only `DATABASE_URL_ADMIN` (§6.1). Doppler `dev` defines no
`DATABASE_URL` (verified 2026-10-12: `doppler secrets get DATABASE_URL` is "not found"; the names
list shows `DATABASE_URL_ADMIN` only), so the variable was simply unset: not a hosted-database
write, but every FOLLOW-819 series to date exercised only the Redis and template paths.

**What the bring-up does now.** The control plane's `env` form sets `DATABASE_URL` to the same local
`127.0.0.1:5433` URL as `DATABASE_URL_ADMIN` (the admin role is reused: the table's tenant-isolation
RLS leaves no other local login role able to read it without a JWT). Step 11b, `[pg_cache_off]`,
FAILS the bring-up unless (a) the process owning `:3000` carries `DATABASE_URL` and its host:port is
`127.0.0.1:5433` (never printed in full), and (b) an INSERT then SELECT of a probe row into
`description_cache_persistent`, as that URL's role, succeeds inside a transaction that is rolled
back (no residue). It proves the layer can be on, against the local host; it does not prove a given
request hit it. For that, count rows in `description_cache_persistent` before and after a series.

**Grader caveat.** Runs from FOLLOW-1313 on are not on the same substrate as §5.1-§5.18: a PG hit
now short-circuits the Redis/Modal path, and a stale row from an earlier run can be served.

### 6.13 The description route GENERATES on localhost since FOLLOW-1297 PR A (ADR-0023): no `MODAL_DESCRIPTION_URL` → in-process generation

Until PR A every cache miss of `/api/adapt/description` on localhost logged
`MODAL_DESCRIPTION_URL not set — skipping Modal dispatch` and no series ever exercised generation:
no `llm_calls` row with `source IN ('description','headline','description_claim_refused')`, no
`description_cache_persistent` row, even after §6.12 turned the PG layer on. Since PR A the route
selects by the variable: set → the Modal dispatch (prod, unchanged); unset → `generateDescription()`
from `apps/control-plane/src/lib/description-generator.ts` in `after()`. `localhost-up.sh` never
sets it, so **a series now spends** (Sonnet 4.6 through the Doppler dev `ANTHROPIC_API_KEY`, the
same key the `/api/adapt` path uses), **writes** `llm_calls` rows under `session_id = <listing_id>`
and `description_cache_persistent` rows (FIT or the NEUTRAL marker; a REFUSED generation writes a
zero-cost `description_claim_refused` row and no cache row), and the Redis key through the `:8078`
adapter.

**What the grader reads per run (ADR-0023 §8):** the local ClickHouse `llm_calls` rows for the
fixture listing
(`SELECT source, model, tokens_in, tokens_out, latency_ms FROM llm_calls WHERE session_id = '<listing_id>' AND source IN (...) ORDER BY ts`),
the `[description] in-process generation … outcome=… writes={"pg":…,"redis":…,"audit":…}` line in
`.localhost-up/logs/control-plane.log`, and the `description_cache_persistent` row count before and
after the series. The `[pg_cache_off]` preflight (§6.12) stays and is what makes the PG write
observable.

**Grader caveat.** The description slot can turn `ai_cached` on a later run of the same un-restarted
plane (the first run's miss generates; the second run hits PG). No FOLLOW-819 AC reads the
description slot, so the grade is unaffected, but the `tokens_in` of the adapt path and the
description path now both land in `llm_calls`; filter by `source`. The in-process generation runs
inside the control plane's `after()`, so a run can add up to ~95 s of awaited I/O to the plane after
the response — it does not block the harness, which reads the adapt response only.

---

### 6.14 Live in-process description generation, exercised by hand at `main` `c20ce2ab` (2026-10-15) — every generated headline was suppressed

The condition-1 series (§5.23) serves the persisted revision-1 row `ai_cached`, so it never
generates (§6.13). To exercise the path, the PM requested two archetypes with no cached row for the
fixture listing on a stack brought up by `scripts/dev/localhost-up.sh` (bearer = the local harness
key, not Doppler `dev`'s `ADAPT_API_KEY`, which answers 401 locally):

| Archetype       | 1st GET             | +15 s       | Description (`after()`) | Headline | Kept headline                   | PG row                                 |
| --------------- | ------------------- | ----------- | ----------------------- | -------- | ------------------------------- | -------------------------------------- |
| `luxury_buyer`  | `template_fallback` | `ai_cached` | 6,398 ms, $0.0207       | 1,600 ms | no — `hallucinated_number`      | FIT, `listing_revision` 1, `claims-v1` |
| `remote_worker` | `template_fallback` | `ai_cached` | 10,312 ms, $0.0226      | 1,358 ms | no — `hallucinated_proper_name` | FIT, `listing_revision` 1, `claims-v1` |

Both runs logged `writes={"pg":"published","redis":"written","audit":"written"}`. Every factual
claim of both bodies is in the 479-byte grounding payload (garage, lanai, garden, waterway, schools,
bedrooms, bathrooms). Two embellishments passed the bounded claim lexicon: "no through traffic" and
"predictable background noise", where the grounding says only "quiet residential street" (the known
condition-1c limit; the typed claim contract is FOLLOW-1311).

**Every headline was dropped.** None of the four locally cached rows carries a model headline. The
parity corpus v1 tells the same story on live model output: of 21 recorded live headlines, 3 were
kept; 12 were refused as `hallucinated_proper_name`, typically a city the listing is in
("Albufeira", "Lisbon"). Production calls `retrieveListingContext` with `intentVector = null`, so
`listing_context` is always `{}` and a place name that is in the listing's own location fields never
reaches the headline check. → FOLLOW-1314.

Not exercisable locally: the `listing.updated` revision bump — Doppler `dev` has no
`LISTING_UPDATED_WEBHOOK_SECRET`, and the webhook fails closed without it (→ FOLLOW-1314 item 3;
resolved, §6.15).

### 6.15 FOLLOW-1314: the headline check sees the listing's own fields; the revision bump works locally (2026-10-16)

**What changed.** `/api/adapt/description` reads the listing ONCE (`fetchDescriptionGrounding` in
`apps/control-plane/src/lib/listing-facts-context.ts`) and sends its own title, price and location
as `listing_context` (`listing_title` / `listing_price` / `listing_location`, the `/api/adapt` key
names). The digit and proper-name grounding reads those values as written
(`json.dumps(ensure_ascii=False)`), so "Jávea" grounds "Jávea" and an `é` no longer grounds a `9`
through its `é` escape. Corpus v1 stays frozen; `corpus.v2.jsonl` + `MANIFEST.v2.json` differ from
it in three expected records, each listed with its reason.

**§6.14's diagnosis, corrected by classifying the 18 refused live headlines of corpus v1.** A place
name the listing carries was the cause of ONE refusal (live.018, "Jávea", hidden by the ASCII
escape), not of most. Albufeira is in its listing's own description and was never the trigger;
"Lisbon" (live.010) is in its listing's location field but the same headline also invents a "Golden
Visa Pathway". 15 of the 18 refuse a claim the listing does not make ("Rental Income Potential",
"Move-In Ready", "Strong Flip Potential", …). The other two false refusals (live.029, live.032) are
the check's capitalised-word rule meeting a word that is not a name: "Near" (the listing says "close
to") and "Quiet-Street" (the listing says "quiet residential street"). FOLLOW-1314 does not touch
that rule.

**Live, at this tree.** Five archetypes generated on the fixture listing; the body now uses the
fields ("Palm Coast", "Listed at $385,000", both grounded). No headline was served:
`[description-generator] done … archetype=second_home_buyer verdict=FIT has_headline=false …`. Three
re-sampled headlines show why: "Coastal Palm Coast Retreat — 3-Bed Home With Lanai & Rental Income
Potential" (invented rental claim), "Sunny Florida Retreat — Low-Maintenance 3-Bed Home Near the
Waterway" ("Florida" is not in the listing, which says `FL`; "Low-Maintenance" is invented),
"Spacious 3-Bed Family Home With Garden, Lanai & Room to Grow" (refused only for "Room", "Grow").
The model writes Title Case, so every capitalised common word must be a listing word.

**Revision bump.** `POST /api/webhooks/listing-updated` without `X-Webhook-Secret` → 401; with the
local secret → 200 `{"invalidated":true}`; `listing_revisions.revision` 1 → 2; every revision-1 row
invalidated; the next `family_buyer` request generated a new FIT row at `listing_revision` 2 and
served it `ai_cached` (`luxury_buyer` regenerated as NEUTRAL `core_need_contradiction` at revision
2, served `template_fallback`).

### 6.16 FOLLOW-1315: the headline PROMPT asks for sentence case and listing facts only — measured before/after (2026-10-16)

**What changed.** Only the headline prompt in `apps/control-plane/src/lib/description-generator.ts`
(its system text and `renderHeadlinePrompt`). It now asks for sentence case (capitalise only the
first word and true proper names), facts stated in the listing only, a place name written exactly as
the listing writes it (`FL`, not "Florida"), and no investment or outcome promise (rental potential,
yield, move-in ready, guarantees, visa pathways, "prime", "rare", superlatives) unless the listing
states it. The old system text explicitly permitted "strong rental demand". The description prompt,
`checkHeadlineFacts`, the claim lexicon, the digit rule and the capitalised-word rule are unchanged
(CEO ruling 2026-10-16). Parity: `corpus.v3.jsonl` + `MANIFEST.v3.json` are a prompt-digest
re-freeze of v2 — only the headline prompt digests differ; the recorded raw headlines predate the
new prompt and are replayed through the same checks, so every verdict is v2's.

**Procedure (identical both sides).** `localhost-up.sh` on the code under test (BEFORE: a worktree
of `origin/main` at FOLLOW-1314; AFTER: the FOLLOW-1315 branch), then one
`POST /api/webhooks/listing-updated` (revision bump, every cached row invalidated), then
`GET /api/adapt/description` for all 18 archetypes of the fixture listing (bearer = the local
harness key), one every 8 s, then — once the plane logged every in-process generation — a second
`GET` per archetype. "Served" means the second `GET` returned `ai_cached` with a non-null
`headline`.

| Archetype                  | BEFORE body                         | BEFORE headline            | AFTER body                    | AFTER headline |
| -------------------------- | ----------------------------------- | -------------------------- | ----------------------------- | -------------- |
| `yield_hunter`             | FAILED `residual_tag`               | —                          | FAILED `residual_tag`         | —              |
| `vacation_rental_investor` | FAILED `residual_tag`               | —                          | FIT                           | served         |
| `flip_investor`            | REFUSED `unsupported_amenity`       | —                          | FAILED `residual_tag`         | —              |
| `portfolio_builder`        | FAILED `truncated`                  | —                          | REFUSED `unsupported_amenity` | —              |
| `golden_visa_buyer`        | NEUTRAL `core_need_contradiction`   | —                          | NEUTRAL (same)                | —              |
| `commercial_investor`      | NEUTRAL `no_legitimate_angle…`      | —                          | NEUTRAL (same)                | —              |
| `family_buyer`             | FIT                                 | `hallucinated_proper_name` | FIT                           | served         |
| `first_time_buyer`         | FAILED `residual_tag`               | —                          | FAILED `residual_tag`         | —              |
| `upsizer`                  | FIT                                 | `hallucinated_proper_name` | FIT                           | served         |
| `downsizer`                | FIT                                 | `hallucinated_proper_name` | FIT                           | served         |
| `luxury_buyer`             | NEUTRAL `core_need_contradiction`   | —                          | NEUTRAL (same)                | —              |
| `remote_worker`            | FIT                                 | `hallucinated_proper_name` | FIT                           | served         |
| `lifestyle_expat`          | REFUSED `unsupported_guarantee`     | —                          | FIT                           | served         |
| `retiree_relocator`        | FIT                                 | `hallucinated_proper_name` | FAILED `truncated`            | —              |
| `diaspora_buyer`           | FAILED `residual_tag`               | —                          | FAILED `residual_tag`         | —              |
| `second_home_buyer`        | REFUSED `unsupported_guarantee`     | —                          | FIT                           | served         |
| `student_parent`           | NEUTRAL `no_legitimate_angle`       | —                          | NEUTRAL (same)                | —              |
| `neutral`                  | FIT                                 | `hallucinated_proper_name` | FIT                           | served         |
| **Headline served**        | **0 of 6** headline calls (0 of 18) |                            | **8 of 8** (8 of 18)          |                |

The body column moves between rounds by sampling alone (the description prompt is unchanged); the
headline is called only on a FIT body, so the comparable rate is served / headline calls: 0/6 → 8/8.
Every BEFORE suppression was `hallucinated_proper_name` (the Title-Case rule, §6.15).

**Every AFTER headline, verbatim**, against the listing (title "9 Blackberry Pl, Palm Coast, FL
32137 — 3 bed, 2 bath"; description "A three-bedroom, two-bathroom single-family home on a quiet
residential street. Open-plan living area, attached two-car garage, screened lanai and a mature
garden. Close to schools, the intracoastal waterway and local amenities."):

- `vacation_rental_investor`, `lifestyle_expat`, `neutral`: "Three-bedroom home with screened lanai
  and garage in Palm Coast, FL" — grounded.
- `family_buyer`: "Three-bedroom home with screened lanai and garden on a quiet street in Palm
  Coast, FL" — grounded.
- `upsizer`: "Three-bedroom home with open-plan living, screened lanai and mature garden in Palm
  Coast, FL" — grounded.
- `remote_worker`: "Three-bedroom home with screened lanai and quiet street in Palm Coast, FL" —
  grounded (awkward, not invented).
- `second_home_buyer`: "Three-bedroom home with screened lanai and garden near the intracoastal
  waterway, Palm Coast, FL" — grounded ("close to … the intracoastal waterway").
- **`downsizer`: "Three-bedroom single-storey home with screened lanai and garden in Palm Coast, FL"
  — NOT grounded.** The listing says "single-family", never "single-storey". The headline check
  cannot see it (no digit, no capital, not in the claim lexicon) — the bounded-lexicon limit already
  recorded in §6.14; the typed claim contract is FOLLOW-1311. Served on localhost; reported, not
  fixed here (the checks stay as they are by ruling).

**Not addressed (the body, out of scope):** 7 of 18 AFTER bodies were FAILED/REFUSED (`residual_tag`
×4, `truncated`, `unsupported_amenity`) and 4 NEUTRAL; BEFORE 6 FAILED/REFUSED-on-format and 3 claim
refusals. These are the description prompt's outcomes, untouched by FOLLOW-1315.

**Spend.** Local `llm_calls` for the fixture listing: BEFORE $0.4296 (19 description + 6 headline
calls), AFTER $0.4634 (20 + 8). Total $0.893.

## Cross-references

FOLLOW-471 · FOLLOW-560 · FOLLOW-816 · FOLLOW-817 · FOLLOW-818 · FOLLOW-820 · FOLLOW-822 (the drift
in §4.1) · FOLLOW-875 (the AC(1) correction) · FOLLOW-876 · FOLLOW-1072 (the AC(3) causal
correction) · FOLLOW-212 (calibration) · **FOLLOW-1075 (AC(5)'s second blocker + the AC(1)
verdict-string fix, §4.1/§5.2)** · `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §3.5 / §3.8 / §7 /
§9.1 / §9.2 · Rule Q · Rule AR · Rule AY · RETRO-301 §4a LG-2 / §4b BUG-1
