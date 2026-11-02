# Checkpoint K4b — Phase 4 P7: the returning buyer, on localhost (2026-11-02)

**Plan:** `docs/PLAN-LOCALHOST-COMPLETION-2026-10-17.md` (Faza 4). **Verdict: GREEN on localhost.
Production is not passed** (ESC-090, `docs/compliance/FOLLOW-1316-signed-review.md` section 8).
**SHA of record:** `main` `93cfa9bb` (#1133). **Previous checkpoint:** K4a, tag `k4a-green`.
**Tag:** `k4b-green` on the merge commit of this ledger. **Next:** Phase 5 (Estalara app X1 to X4),
K5 with the CEO.

## The four controls

| #   | Control    | Instrument                       | Result                                                                                                   |
| --- | ---------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| I1  | Mechanism  | Series, README §5.72             | **GREEN**: runs 277, 279, 281, `green=9 total=9`, `[FRESH]`, at `a28ffa36`, code identical to `93cfa9bb` |
| I2  | Surface    | `check-single-tenant.sh --final` | **PASS**, total 0                                                                                        |
| I3  | Real app   | N3, first use, at `492e3c08`     | **`GREEN_K4B`**: 13 hops green, the signed inquiry hop `UNMEASURED:phase5`                               |
| I4  | Backoffice | `pnpm run test:backoffice`       | **GREEN**: 9 passed, 5 skipped (the staff-session rows skipped since K3)                                 |

## AC(9), negative controls

Each is paired with a positive restore on the same xid in the same run. In runs 272 to 281, all ten:
restore `llm_tweaked`, `privacyViolations: []`.

- Same xid with no consent: no xid on the wire, no restore, key untouched.
- Withdrawal through the real control: key and local xid gone, replay `miss`.
- DSR erase: `/api/dsr/initiate` refuses every caller today, so this ran on a **seeded**
  verification row. It does not show that a buyer can start a DSR.
- A non-persistable quiz result: the key is deleted and stays gone.
- The raw xid absent from request URLs, `events`, `adaptation_decisions`, `llm_calls`,
  `intent_events` and Redis key names.

The Lua scripts ran on real Redis by hand (adapt 57, profile routes 35, DSR erase 23), because CI
runs only a JavaScript mirror (FOLLOW-1451). Hosted Upstash is unverified.

## N3 on the real app

`~/Projects/Estalara-gitlab-2026-08-17` on `:5173` and `:8081`, tree hash `0314f009…`: consent
click, quiz to `yield_hunter` through the served tree and confirmation, `llm_tweaked`, headline and
description changed in the DOM, `ai_cached` after a cold miss, and a new context with the same xid
`restored` on its first `/api/adapt`.

- One run only. The first attempt failed its preflight because the control plane was in swap. The
  second run passed.
- The restore took 2 fresh contexts: the first read `miss`. N3 allows up to 3. Why the first missed
  is not established; the write is after-response, so timing is the likely cause.
- `no_debug_attribute` is truly green: `hooks.server.ts` injects the loader with no `data-debug`,
  and the `setAttribute` line in `+layout.svelte` is a fallback that does not run. X4 still has that
  line to remove.
- `inquiry.completed` cannot be measured before X1: the app has no signed emitter. So "from K4" in
  the plan reads "from K5" in practice.

## Recorded, not hidden

- **Series reds on the way.** README §5.70 to §5.72: AC(8) hop 4 in run 266, cause unknown; AC(10)
  in 257 and AC(7) in 259 on a superseded version under memory pressure, cause not established.
- **The signed review is by an agent, not a lawyer.** Conditions for production: P-1 to P-11, with
  code in FOLLOW-1444 to 1446.
- **SDK budget.** 43,128 of 43,136 B. The next SDK change needs an ESC or a trim.
- **FOLLOW-1431 is open.** A listing's own address with a sensitive street name is mostly refused.
- **Stack.** `al-real-down.sh --restore-fixture` left the Vite frontend on `:5173` again (as in K0);
  stopped by exact match.
