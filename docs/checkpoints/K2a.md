# Checkpoint K2a — Phase 2 first batch (R1–R4, R7; R5 and R9 merged before the series) (2026-10-18)

**Plan:** `docs/PLAN-LOCALHOST-COMPLETION-2026-10-17.md`. **Verdict: **VERDICT**.** **SHA of
record:** `main` `bed16746` (#1028; every PR below is merged). **Rollback target before K2a:** tag
`k1-green` (`40405410`). **Tag:** `k2a-green` on the merge commit of this ledger.

The plan defines K2a as "after R1–R4, R7". R5 (#1027, a script + runbook, no runtime path) and R9
(#1028, Stripe removal under `apps/control-plane/src`) were also merged before the series, so the
single series below is the series of record for both batches; R9's own series obligation (pathspec)
is discharged by it. R5's integration proof on the stack (issue → KV → ingest 2xx; revoke → 401)
stays a K2b gate.

## What this batch shipped

| PR               | Ticket           | Change                                                                                                                                                                                                                                                   |
| ---------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1023 `89d65f9e` | FOLLOW-1323 (R1) | `app/api/internal/schema` and `packages/platform-templates` deleted (workspace, turbo, tsconfig, lockfile); ml-engineer row in CLAUDE.md                                                                                                                 |
| #1024 `2c10f7b4` | FOLLOW-1324 (R2) | `apps/data-quality` deleted with its CI matrix row, `required-checks.txt` entry, Modal `REGISTRY`, secret-keys and cron-heartbeat wiring; `modal app stop estalara-schema-validation` = handover row 5                                                   |
| #1025 `42f13a94` | FOLLOW-1325 (R3) | registrations page, `api/registrations`, public `/register` and its `PUBLIC_PREFIXES` entry deleted; `tenant_registrations` table and schema file kept (DROP = handover row 10); `/api/v1/consent/platform-registration` stays                           |
| #1026 `229a9c33` | FOLLOW-1326 (R4) | demo sessions (`api/demo/sessions*`, `admin/demo-sessions`), the agency mockup site and `lib/mockup-listings` deleted; archetype simulator (`api/demo/override`, `admin/tenants/[id]/demo`) kept; residue `lib/demo-session-revocation.ts` → FOLLOW-1347 |
| #1027 `12680fe4` | FOLLOW-1327 (R5) | `apps/control-plane/scripts/issue-tenant-api-key.mts` + `docs/runbooks/API_KEY_ISSUANCE.md` (mint / rotate / revoke; same SHA-256 as production; `pending→active` + embedding seed on first issue); handover row 12                                      |
| #1028 `bed16746` | FOLLOW-1331 (R9) | `lib/stripe.ts`, `api/webhooks/stripe`, tests and env entries deleted; `tenants.plan` stays; handover row 9; also undates the `description/route.ts` doc-comment and completes handover row 13                                                           |
| #1029 `72836f9e` | FOLLOW-1329 (R7) | `getTenantById` moved next to the tenant hub (`admin/tenants/[id]/data.ts`, split commit first), then the fleet list `admin/tenants/page.tsx`, `getTenantsList` and `api/admin/diagnostics/first-party-tenant` deleted; `/admin/tenants` → 307 hub       |

## The four controls

| #   | Control                      | Instrument                                                        | Result                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Differentiator works         | FOLLOW-819 series, README §5.27                                   | **I1**                                                                                                                                                                                                                                                                                             |
| I2  | Multi-tenant surface shrinks | `scripts/check-single-tenant.sh --ratchet` on `main` `bed16746`   | **PASS, total 204 (K1) → 173**; `paths_present` 11 → 9, `routes_inventory` 95 → 94, `id_getTenantsList` 0; every removed path of this batch = 0 (see the STOP-rule check)                                                                                                                          |
| I3  | Real app end to end          | not required at K2a by the plan (next: K2c N3-lite)               | K0 record stands; this batch touched no buyer-path code (the `/api/adapt` demo path lost only the demo-session revocation writers, the reader is unchanged)                                                                                                                                        |
| I4  | Backoffice usable            | N2 `admin-nav-reachability.test.ts` (CI) on every PR of the batch | **GREEN** — `admin-nav-reachability.test.ts` green in CI on all seven PRs (sidebar sanity, inventory floor 15 after R7, `HIDDEN_BY_DESIGN` empty) and in the local subset run; `/admin/tenants` 307 → hub covered by `admin/tenants/route` tests; Playwright smoke re-run at K2b with the stack up |

## Offline gates on merged `main` (stack down)

| Gate                                                                                                                                 | Result                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/db` vitest                                                                                                                 | 12 files / 144 tests passed (with the local Postgres up; two DB-backed suites time out in `beforeAll` while the container is still booting)                                          |
| `packages/shared` vitest                                                                                                             | 608 tests passed                                                                                                                                                                     |
| control-plane vitest (admin pages + nav, demo override, config, analytics rollup, middleware, staff rank, tracer auth, Sentry sites) | 41 files / 311 tests passed                                                                                                                                                          |
| `getTenantById` split (R7 first commit)                                                                                              | `admin/tenants/[id]/data.test.ts` + `admin/page.test.tsx` + `admin/tenants/[id]/page.test.tsx` green (in the run above)                                                              |
| `check-mirror-files.sh`                                                                                                              | pass — all mirror pairs in sync, 11 register entries latent                                                                                                                          |
| `check-deployment-surfaces.mjs`                                                                                                      | pass — 7 register rows, every `apps/*` surface present                                                                                                                               |
| `check-measured-premises.mjs`                                                                                                        | 4 findings at `bed16746`, all MP-006 (its two `relied_on_by` files left with `apps/data-quality`); retired by this PR → 0                                                            |
| CI (the PR-checks verifier, PM gate)                                                                                                 | #1023, #1024, #1025, #1026, #1027, #1028, #1029 all exit 0 (several after a merge of `main`; #1027 once exit 4 → merge-main, #1029 once a false exit 3 → main checkout pulled first) |

## STOP-rule check (plan K2a)

- "N1 does not shrink = a PR did not remove what it declares": N1 shrank 204 → 173 and every path
  this batch removed reads 0 (`app/api/internal/schema`, `packages/platform-templates`,
  `apps/data-quality`, `app/register`, `api/registrations`, `admin/registrations`, demo sessions,
  mockup, `admin/tenants/page.tsx`, diagnostics). Condition not triggered.
- "`@ts-expect-error` or a stub to make it compile": grep of the batch diff for `@ts-expect-error`
  and `TODO(stub` = 0 new. The one residue is a plain note (not `@deprecated`) on `demoSessions`,
  because a live reader remains — filed as FOLLOW-1347, not stubbed.
- → **K2b may start** (R5 integration proof on the stack → R6 detection chain, Opus).

## Findings that change later phases (recorded, not fixed here)

1. **Ignored residue of deleted apps inflates local gates.** The main checkout still held `.turbo`,
   `dist`, `node_modules`, `.venv`, `__pycache__` of `apps/decision-api`, `apps/llm-gateway`,
   `apps/stream-consumer`, `apps/data-quality`, `packages/platform-templates` and five older
   packages; N1 counted 13 `paths_present` (baseline 11) and `check-deployment-surfaces.mjs`
   reported three phantom apps until `git clean -fdX` on those directories. CI (clean checkout) was
   never affected. Add to bring-up hygiene (FOLLOW-1233/1246): warn on an `apps/*`/`packages/*`
   directory with zero tracked files.
2. **Handover row 13 landed truncated** in #1026 (Step cell only); completed in #1028. The handover
   table is edited by every removal PR — the next conflict-prone edit should append rows, not
   rewrite them.
3. **DB-backed `packages/db` suites need the container warm**: two suites fail their 10 s
   `beforeAll` while `al_pg_local` is still starting; a second run passes. Not a product defect.
4. **Series bring-up warm-up** (K1 finding 3) still open: expect a first-run RED on the chat arm.

## Evidence (session scratchpad, not committed)

`scratchpad/k2a/{sha.txt,n1.log,mirror.log,surfaces.log,premises.log,vitest-db.log,vitest-shared.log,vitest-cp.log}`,
`scratchpad/k2a/run{1..N}.{json,log,fresh}`.
