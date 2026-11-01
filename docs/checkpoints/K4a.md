# Checkpoint K4a — Phase 4 P1–P6: the typed claim contract and grounding fidelity (2026-11-01)

**Plan:** `docs/PLAN-LOCALHOST-COMPLETION-2026-10-17.md` (Faza 4). **Verdict: GREEN, with one target
not clearly met (below) and control I3 not re-run.** **SHA of record:** `main` `179b4d4c` (#1126).
**Previous checkpoint:** KQ2, tag `kq2-passed`. **Tag:** `k4a-green` on the merge commit of this
ledger. **Next:** P7 FOLLOW-1316, K4b.

## What shipped since KQ2 for FOLLOW-1311

| PR                  | Part                                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| #1114, #1115        | Slices 0–1: frozen baseline and replay; one module for the claim rules |
| #1116, #1117        | Slices 2–3: loosenings; typed count, money, area, year, negation       |
| #1120               | Slice 4: closed attribute lexicon, `claims-v9`                         |
| #1123               | Slice 6: templates, prompt and personas point at the listing's words   |
| #1125               | Slice 5, narrowed: deterministic street claim, `claims-v10`            |
| #1118, #1121, #1122 | FOLLOW-1426 (tweak band on Sonnet), 1425, 1427 (refused-text guard)    |
| #1126               | FOLLOW-1345: AC(1b) grounding fidelity                                 |

## The four controls

| #   | Control    | Instrument                               | Result                                                                                                         |
| --- | ---------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| I1  | Mechanism  | Series, README §5.68                     | **GREEN**: runs 249–251, `green=8 total=8`, `[FRESH]`, AC(1b) PASS. `df7fb177` has the same tree as `179b4d4c` |
| I2  | Surface    | `scripts/check-single-tenant.sh --final` | **PASS**, total 0                                                                                              |
| I3  | Real app   | N3-lite on `:5173`                       | **Not run.** Carried from K2c. The new prompts have not been seen on the real app; N3 first runs at K4b        |
| I4  | Backoffice | `pnpm run test:backoffice`               | **GREEN**: 9 passed, 5 skipped (the staff-session rows skipped since K3)                                       |

## Offline gates of K4a

All at `179b4d4c`: `description-parity` 2473 of 2473 (100 %), `grounding-check.follow1314` 25,
`claim-containment` 16, `description-generator` 10, `llm-gateway.follow1305` 19,
`description-grounding.follow1317` 3, `claim-streets-names.follow1311` 106, claim `replay` 4,
`ac1b-verdict` 46. `check-gate-exit-codes.sh`, `check-mirror-files.sh`,
`check-deployment-surfaces.mjs`: pass.

`check-measured-premises.mjs` **fails**: dated measurements written in source by #1081 and later, in
`generation-models.ts` and the two FOLLOW-1377 test files. Not from this phase. It is a K7 gate and
runs only in the weekly hygiene workflow. FOLLOW-1430.

## FOLLOW-1311 targets

Fresh recording on `main` `28fdc551` (88 cases, USD 1.77), then a blind audit of the 56 served texts
with the 2026-10-26 definitions. One rater, one sample, mostly constructed listings.

| Target                                       | Result                                                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New body refusals at most 10 % of FIT        | **Met**: 5 of 57 on the frozen replay (8.8 %)                                                                                                                                  |
| Adapt refused slots at most 10 %             | **Met**: 0 of 84 fresh, 1 of 84 frozen                                                                                                                                         |
| New refusals at least 90 % true positives    | Met on the classified moves of slices 3 and 4; slice 5 added none                                                                                                              |
| Room-count contradictions zero               | Not contradicted: the one firm contradiction is a mistranslation                                                                                                               |
| Invented property facts from 13 to at most 6 | **Not clearly met**: 7 firm of 56 texts (12.5 %, target 6 of 45 = 13.3 %), plus 58 borderline. The earlier audit had no borderline class, so the columns are not like for like |

Same audit: firm external claims 1 (38 on 2026-10-26), firm contradictions 1 (20), wrong-language
texts 0. A paired audit on the same 60 listings, one rater, before and after slice 6: firm external
claims 30 to 2, firm invented facts 18 to 5, appeal 3.53 to 3.55, flatness 2.69 to 2.80.

## Recorded, not hidden

- **Slice 5 does less than the ticket said.** An independent review with 96 live calls stopped its
  body name judge: false on all 21 invented places, true on only 4 of 24 harmless or own-place
  cases, 5.2 % of replies cut off before any JSON. The judge and the adapt headline first-word rule
  were removed. "Located in Miami" on a body is a declared limit. The street rule refused nothing on
  176 recorded cases, so its precision is unmeasured.
- **Language.** 32 firm language errors on PL and ES pages, in 21 texts, many of them translated
  persona phrases ("matematyka wyjścia", "ogon najmu"). Buyer-visible. FOLLOW-1429.
- **Dryness.** `yield_hunter` reads flat, 4.29 of 5 on a small sample. A cost of slice 6.
- **Price.** 12 of 56 bodies state no price, none of them an investor text. The ruling is read as "a
  stated price is exact", as `description-generator.ts` records it.
- **Holdout cluster.** README §5.63: the chat arm drew holdout in 9 of 19 runs; no mechanism found,
  no failure masked.
- **FOLLOW-1427** has not fired live: no description was refused during its series.
- **N3 does not exist yet.** `scripts/dev/real-app-acceptance.mjs` is required by K4b. FOLLOW-1344.
