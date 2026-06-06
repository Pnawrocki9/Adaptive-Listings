# FOLLOW-206 — F-05/F-21: SQL escaping unification

**Sprint:** 15 **Agent:** backend-engineer **Priority:** P3 **Estimated hours:** 2 **Status:** READY
**Source:** Audit F-05, F-21 **Promoted:** 2026-06-05

---

## Context

Two different SQL escaping strategies exist for ClickHouse raw SQL in the same codebase:

- `apps/control-plane/src/app/api/adapt/route.ts:348` — uses `s.replace(/'/g, "\\'")` (backslash
  escaping)
- `apps/control-plane/src/lib/clickhouse-dsr.ts:99` — uses `s.replace(/'/g, "''")` (ANSI SQL
  standard `''` doubling)

The `''` doubling is the ANSI SQL standard and the correct approach for ClickHouse. The `\\'`
strategy is non-standard and fragile — a copy-paste error in security-sensitive code paths could
introduce a SQL injection vector. While not currently exploitable, two different conventions in the
same codebase increase long-term risk.

This is a Track D (background) cleanup. Low priority but should be done before any new ClickHouse
raw SQL is added.

## Scope

- In `apps/control-plane/src/app/api/adapt/route.ts:348`: update the string escaping in
  `logDecisionAsync` (and any other raw ClickHouse SQL in that file) from `\\'` to `''` doubling.
- Search the entire `apps/control-plane/src/` directory for any other occurrence of
  `replace(/'/g, "\\'")` in ClickHouse-targeted SQL strings and update them to `replace(/'/g, "''")`
  .
- Confirm no `\\'` escaping pattern remains in ClickHouse SQL code:
  `grep -rn "\\\\'" apps/control-plane/src/ --include="*.ts"`.
- Do not change non-ClickHouse SQL escaping (Postgres/Drizzle uses parameterized queries; no change
  needed there).

## Acceptance criteria

- [ ] AC1: No `\\'` pattern in any ClickHouse raw SQL string in `apps/control-plane/src/`. Grep
      confirms.
- [ ] AC2: All ClickHouse raw SQL uses `''` doubling for string escaping. Code review confirms
      consistency with `clickhouse-dsr.ts:99`.
- [ ] AC3: Existing tests for `logDecisionAsync` still pass (same escaping behavior for valid
      inputs, just via the correct mechanism). CI green.

## Definition of Done

- [ ] Branch `backend-engineer/FOLLOW-206-sql-escaping-unification`; commits referencing
      [FOLLOW-206]; PR opened; CI green.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [] · **produces:** [single canonical SQL escaping strategy for ClickHouse across all
code]
