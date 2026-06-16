# FOLLOW-328 — Fix ClickHouse empty-username Basic auth (Code 516) across all control-plane CH reads

**Sprint:** 18 **Priority:** P0 (production down) **Status:** IN*PROGRESS **Agent:**
backend-engineer **Branch:** `backend-engineer/clickhouse-auth-username-fix-2` **PR:** \_pending*
**Source:** FOLLOW-316 implementation-guidance note (lines 92–96) + production incident:
`admin.estalara.com` returns `API error [500]: ClickHouse query failed` on every analytics/tracer
read.

---

## Summary

Every control-plane ClickHouse HTTP read built its own `Authorization: Basic base64(":" + password)`
header — an **empty username** before the colon. ClickHouse Cloud rejects an empty username with
`Code 516 AUTHENTICATION_FAILED`, so all CH-backed routes 500 in production. The ingest worker
(`apps/ingest/src/clickhouse-producer.ts`) already does the correct `base64(user:password)`; the
control-plane never did.

## Root cause

- ~12 call sites duplicated `Buffer.from(`:${password}`)` (empty username).
- No `CLICKHOUSE_USER` was read anywhere in the control-plane.
- The dev/CI passwordless path (`no password → no header`) masked this locally; only CH Cloud (which
  requires auth) surfaced the 516.

## Fix

- New shared module `apps/control-plane/src/lib/clickhouse-http.ts`:
  - `clickhouseAuthHeaders({user, password})` — emits `Basic base64(user:password)`; emits **no**
    header when password is empty (preserves dev/CI passwordless guard).
- All 12 control-plane CH read/insert sites migrated to call `clickhouseAuthHeaders` with the
  username before the colon. Each site continues to read `CLICKHOUSE_USER` (default `'default'`) /
  `CLICKHOUSE_PASSWORD` from env inline (Rule H: no unwired shared exports — only the auth helper
  the migration actually consumes is exported).
- Tracer/DSR/llm-gateway configs gained a `user` field; their tests updated.

## Deploy prerequisite (CRITICAL)

`CLICKHOUSE_USER` must be set in the Vercel **control-plane** project (Production + Preview) to the
correct ClickHouse Cloud user (`ingest_worker` per ops). Without it the code falls back to
`'default'`, which is the wrong user for this service and will still 516/authz-fail. Merging the
code alone does NOT fix production — the env var must exist before/at deploy.

## Acceptance criteria

- [x] **AC1** — No control-plane CH auth header uses an empty username; all use
      `base64(user:password)`.
- [x] **AC2** — Username sourced from `CLICKHOUSE_USER` (default `'default'`); password-absent path
      still sends no header.
- [x] **AC3** — Unit test guards the regression (old `:password` shape would fail).
- [x] **AC4** — `pnpm typecheck`, `pnpm lint` (no new errors), and control-plane vitest green.
- [ ] **AC5** — `CLICKHOUSE_USER` confirmed/set in Vercel control-plane env (Prod + Preview).
- [ ] **AC6** — After deploy, `admin.estalara.com` analytics/tracer reads return 200 (no 516/500).

## Notes

Closes the empty-username hazard called out in FOLLOW-316 implementation guidance (§lines 92–96).
