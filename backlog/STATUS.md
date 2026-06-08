# Status — 2026-06-08T23:00Z

_Rule I: a ticket is DONE only if its primary artifact has at least one non-test runtime caller._

## Active sprint: Sprint 16

**16 DONE** (FOLLOW-170/173/174/176/182/183/187/190/221/227/230/234/237/238/239/244), **0
IN_PROGRESS**, **1 READY_FOR_REVIEW** (FOLLOW-191 awaiting Rafal deploy ESC-020), **2 READY**
(FOLLOW-175 P1, FOLLOW-245 P2).

ESC-021 RESOLVED — FOLLOW-187 merged (PR #240, commit 7550520). ROPA v2.5 + DPIA v2.7 confirmed.

### FOLLOW-183 bounce details (PR #228)

Status: **BOUNCED — Gitleaks real gate failing.**

Real gates passed: Test Node 22, Typecheck, Lint, Format, Build control-plane, Rule H, Rule J,
ClickHouse migrations, Cross-language, Doppler, Vercel — all PASS.

Gitleaks FAILS on PR #228 branch but PASSES on main and on PR #227 (FOLLOW-230, merged today). Root
cause: `packages/db/src/upsert-conversion-label.test.ts` is outside the `.gitleaks.toml` allowlist
(`src/__tests__/` is allowlisted; `src/*.test.ts` is not). Data-engineer must move file to
`src/__tests__/` or add an allowlist entry.

CI-check counter: 1/5 | Fix-iteration counter: 1/3. PR comment posted at
https://github.com/Pnawrocki9/Adaptive-Listings/pull/228#issuecomment-4649064989.

## Currently IN_PROGRESS (0 of 3 max — 3 SLOTS AVAILABLE)

(none)

## Open escalations

| ID      | Age | Description                                                          | Blocking?                           |
| ------- | --- | -------------------------------------------------------------------- | ----------------------------------- |
| ESC-009 | 15d | E2E_BEARER_TOKEN secret not provisioned                              | demo-integration CI soft-skips only |
| ESC-010 | 15d | DOPPLER_TOKEN_DEV not provisioned                                    | doppler-verify CI soft-skips only   |
| ESC-020 | 3d  | Rafal must deploy web-master HEAD + PUBLIC_ESTALARA_SDK_ENABLED=true | FOLLOW-191 final verification only  |

## Sprint 16 status corrections applied 2026-06-08

The following tickets were merged but QUEUE.md showed stale statuses. All corrected atomically:

| Ticket     | Old status  | Correct status | PR   | Commit  |
| ---------- | ----------- | -------------- | ---- | ------- |
| FOLLOW-176 | READY       | DONE           | #217 | ea9d59c |
| FOLLOW-182 | IN_PROGRESS | DONE           | #222 | d7b9de7 |
| FOLLOW-174 | BLOCKED     | DONE           | #220 | 31afb16 |
| FOLLOW-190 | READY       | DONE           | #225 | 1d5829a |
| FOLLOW-227 | (new)       | DONE           | #226 | 4d3f1a4 |
| FOLLOW-230 | (new)       | DONE           | #227 | b62faae |

FOLLOW-187 title updated: Activity 14 → Activity 15 (collision fixed by FOLLOW-230).

## PRs merged today (2026-06-08)

- #225 FOLLOW-190 dwell-time confidence lift (sdk-engineer, merged 10:51)
- #226 FOLLOW-227 dwell rehydrate gate + cap (sdk-engineer, merged 11:42)
- #227 FOLLOW-230 ROPA renumber + privacy notice 8 keys + CI lint (compliance-engineer, merged
  11:46)

## Sprint 8 Rule I audit (legacy, 2026-05-17)

| Ticket      | Queue status | Rule I status                    |
| ----------- | ------------ | -------------------------------- |
| AB-001      | DONE         | PARTIAL (FOLLOW-007 resolved it) |
| REORDER-001 | DONE         | DONE                             |
| TICKET-046  | DONE         | PARTIAL (FOLLOW-007 resolved it) |
| ARCH-003    | DONE         | DONE                             |
| AGENCY-001  | DONE         | DONE                             |
| AB-004      | DONE         | DONE                             |
