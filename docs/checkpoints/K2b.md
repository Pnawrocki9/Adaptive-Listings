# Checkpoint K2b — Phase 2 second batch (R5 proof, R6, R2) (2026-10-18)

**Plan:** `docs/PLAN-LOCALHOST-COMPLETION-2026-10-17.md`. **Verdict: GREEN.** **SHA of record:**
`main` `a47018ce` (#1033, R6 FOLLOW-1328 merged). **Rollback target before K2b:** tag `k2a-green`
(`4d3c00fd`). **Tag:** `k2b-green` on the merge commit of this ledger.

## Entry gate — R5 integration proof on the stack (runbook §7), 2026-10-18 on `bed16746`

| Step                                                                      | Result                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 `issue --tenant <ops> --label k2b --allowed-origins :5173 --additional` | exit 0, `key_id` `2bd32acd-…`, raw key 40 chars (never logged)                                                                                                                                                                                                                                                                           |
| 2 `wrangler kv key put --local … api_key:<raw>`                           | written to the Worker's local store (same flags as `localhost-up.sh`)                                                                                                                                                                                                                                                                    |
| 3 `POST /v1/events` with the key, `Origin: http://localhost:5173`         | **200**; same request with `Origin: https://evil.example` → **403**                                                                                                                                                                                                                                                                      |
| 4 `revoke --key-id …` + `kv key delete`                                   | exit 0 ("Postgres verifiers reject it now; ingest … once its KV entry is deleted"); repeat step 3 → **401** `unknown_key`                                                                                                                                                                                                                |
| 5 `pnpm --filter=@estalara/ingest test:integration:clickhouse`            | local 2/4 — the two failures are environment pins (local `estalara_ch_local` carries a persisted `date_time_input_format=best_effort`, `changed=1`; the suite's negative control expects a fresh container's `basic`). CI `clickhouse-smoke` (fresh `clickhouse/clickhouse-server:25.8`) is the gate of record: green on #1027 and #1033 |
| `list --tenant <ops>`                                                     | the revoked row shows `revoked=2026-10-18…`; the seeded `pilot-…-key` untouched                                                                                                                                                                                                                                                          |

Evidence: `scratchpad/k2b/r5-proof.{sh,log}`, `scratchpad/k2b/ingest-integration.log`.

## What this batch shipped

| PR               | Ticket           | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1024 `2c10f7b4` | FOLLOW-1324 (R2) | merged in the K2a batch; its K2b gate items (CI matrix row, `required-checks.txt` entry, Modal `REGISTRY`, cron-heartbeat wiring removed in the same PR) verified by the PR-checks verifier exit 0 and `check-gate-exit-codes.sh` on `main`                                                                                                                                                                                                                                                                                 |
| #1033 `a47018ce` | FOLLOW-1328 (R6) | detection chain deleted: wizard, `dashboard/onboarding/detect`, `dashboard/detection`, `api/detect`, `api/schema/activate`, `shared/schemas/detect.ts`, `packages/sdk/src/auto-detect/**` (37 files) + `DetectionResult` export + package sub-path exports, `demo-integration.yml`, `sprint-9-5-demo.spec.ts`, the `corpus-gate` CI job + its register line; orphan `invalidateTenantSchemaCache` removed; **`lib/ssrf.ts` deleted** (false KEEP premise — see finding 1); `TOTAL_SITES` 105 → 103; 82 files, −10,180 lines |

## The four controls

| #   | Control                      | Instrument                                                                 | Result                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Differentiator works         | FOLLOW-819 series, README §5.28                                            | **GREEN** — runs 2, 3, 4 `7/7 run=GREEN` `[FRESH]` at `a47018ce`; run 1 RED on AC(8) (chat-shim cold start, hop 3 `/health` no answer + first extraction all-null; same class as K1 run 1) and `[DIRTY]` (an untracked `packages/sdk/corpus-report.json` dated June, whose gitignore line R6 removed — deleted; finding 6) |
| I2  | Multi-tenant surface shrinks | `scripts/check-single-tenant.sh --ratchet` on `main` `a47018ce`            | **PASS, total 173 → 161**; `paths_present` 9 → **0** (every removal path of the plan's N1 list now absent); `dashboard_pages` 9 → 7; `routes_inventory` 94 → 90; `routes_unlisted` 0                                                                                                                                       |
| I3  | Real app end to end          | not required at K2b (next: K2c N3-lite)                                    | K0 record stands; the SDK IIFE never bundled auto-detect (bundle 40,397 B unchanged), so the real-app loader is byte-identical                                                                                                                                                                                             |
| I4  | Backoffice usable            | N2 nav test in CI on #1033; `admin-nav-reachability.test.ts` locally 28/28 | **GREEN** — the two deleted `/dashboard` pages were agency surfaces (M2 removes the rest); Playwright smoke re-run at K3 with the stack up                                                                                                                                                                                 |

## Offline gates (agent on the R6 branch at `6866cc24`; PM spot checks on merged `main`)

| Gate                                                                                                                                                                               | Result                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| shared / SDK / control-plane typecheck + lint                                                                                                                                      | exit 0 each                                                                                             |
| shared vitest 27 files / 608; SDK vitest 78 / 1127; control-plane: touched set 14 / 191, `app/admin` 28, `src/lib` 62 / 1066, `src/app/api` 82/82, listing-details family 17 / 138 | pass (one earlier `src/app/api` run hit a single hook-timeout under memory pressure, untouched folders) |
| `pnpm --filter=@estalara/sdk build:check`                                                                                                                                          | 40,397 B gzip (limit 43,136; unchanged vs main)                                                         |
| `check-rule-i.sh`                                                                                                                                                                  | 126 → 109 violations, **0 new** vs main                                                                 |
| `check-rule-h.sh origin/main`, `check-follow555-session-auth.sh`, `check-gate-exit-codes.sh`, `check-deployment-surfaces.mjs`, `check-measured-premises.mjs`                       | pass / pass / pass (8 routing consumers agree) / OK 7 rows / OK 16 premises                             |
| `pnpm e2e:smoke`                                                                                                                                                                   | 11 files passed, 1 skipped (387 tests)                                                                  |
| CI (the PR-checks verifier, PM gate; run from the PR worktree because the PR removes a registered gate)                                                                            | #1033 exit 0 (77 checks, the removed gate absent from both the register and the rollup)                 |

## STOP-rule check (plan K2b)

- "ingest rejects the R5 key": no — 200 with the issued key, 403 on a foreign origin, 401 only after
  revoke + KV delete. Condition not triggered.
- "series RED on AC(1)/(2)/(3) → revert to `k2a-green`, check SDK init (auto-detect could have been
  load-bearing)": not triggered — no AC(1)/(2)/(3) RED in any run; the single RED was AC(8) on the
  cold first run and did not recur.
- Registered gate removed with its job in the same PR; the verifier from the PR worktree confirms
  the register and the workflows agree. `check-gate-exit-codes.sh` pass.
- → **K2c may start** (R8 rollup contract test first; R10 merge after the CEO's C1/C2; R11).

## Findings that change later phases (recorded, not fixed here)

1. **The plan's KEEP of `lib/ssrf.ts` rested on a false premise.** `listing-details.ts` deliberately
   never called `checkSsrf` (its docblock says the guard would reject the loopback backend) and
   `api/detect` was the only importer, so keeping the file was one new Rule I symbol. Deleted in R6;
   posture unchanged. **FOLLOW-1309 (Phase 6 S3) is amended**: build the private-IP /
   redirect-to-private / DNS-rebind guard on the `listing-details` fetch itself, with a loopback
   allowance for the localhost substrate.
2. **`inquiry_submit_selector` is a host-snippet attribute, not a schema field** (Rule L). The SDK
   reads `data-inquiry-submit-selector` only from its own script tag; the deleted `buildSnippet()`
   was the only reader of `schema.inquiry_submit_selector`. No seed added. The Estalara app patch
   set (Phase 5 X3) must carry the attribute if `inquiry.started` is wanted.
3. **Stale `buildSnippet()` / `DetectionPreview` comments** remain in
   `packages/sdk/src/core/{intent-weights,quiz-config,config}.ts`, six SDK test files and
   `tests/integration/intent-weights-live.smoke.test.ts`; Rule X's "production install-snippet base"
   has no generator left in the repo → P3 docs stub FOLLOW-1349.
4. **Local ClickHouse profile drift**: `estalara_ch_local` carries a persisted
   `date_time_input_format=best_effort` that no repo script sets; the ingest integration suite's
   negative control therefore fails locally only. Reset the user profile at the next container
   rebuild (bring-up hygiene FOLLOW-1233/1246).
5. **R6 removed the `corpus-report.json` gitignore line while the file still existed in dev
   checkouts** (a June artefact of the deleted `test:corpus`); the harness refused to grade run 1 as
   `[DIRTY]` until it was deleted. Nothing regenerates it. Bring-up hygiene (FOLLOW-1233/1246): fail
   the preflight on an untracked file under `packages/*` or `apps/*` with the file named.
6. **Bookkeeping owed at K2c:** MASTER_DESIGN §B.4/§B.5 status rows ("still in the tree at HEAD")
   and §V.3.4 (brand-identity, R10);
   `.claude/agents/{ml-engineer,backend-engineer,pm-orchestrator}.md` `apps/auto-detect` mentions;
   the `auto-detect` commit scope in CLAUDE.md; the unused `E2E_BEARER_TOKEN` repository secret
   (CTO/CEO repo-config cleanup, optional).

## Evidence (session scratchpad, not committed)

`scratchpad/k2b/{r5-proof.sh,r5-proof.log,ingest-integration.log,run{1..N}.{json,log,fresh}}`,
`scratchpad/verify-1033.log`.
