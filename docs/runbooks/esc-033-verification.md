# Runbook — ESC-033 verification (fire-and-forget writes survive Vercel suspension)

**Escalation:** ESC-033 (P1) — control-plane `/api/adapt` silently not writing
`adaptation_decisions` in prod. **Fix:** FOLLOW-431 (PR #379, merge commit `3a0f802`) — all
fire-and-forget sinks deferred past the HTTP response via `afterResponse()`
(`apps/control-plane/src/lib/after-response.ts`, which wraps `next/server` `after()`). **Purpose of
this runbook:** prove the fix in production. This is the final closure step for ESC-033.

---

## What we are proving

Before the fix, an un-awaited `fetch` issued after `return NextResponse.json(...)` was not
guaranteed to flush before the Vercel function instance was suspended. Empirical proof in ESC-033: a
burst of 8 `/api/adapt` requests landed only **1/8** rows in `adaptation_decisions` (identical
credentials every call → not auth; the variance was instance-lifecycle timing). After the fix, **all
N** requests in a burst must land.

---

## Step 0 — confirm prod is running the fix

The merge of PR #379 to `main` (commit `3a0f802`) triggers a control-plane redeploy on Vercel.
Before testing, confirm the current **Production** deployment is from `3a0f802` (or later) and is
**Ready**:

- Vercel → project `adaptive-listings-control-plane` → latest Production deployment → commit
  `3a0f802`+, status Ready. Allow ~2–3 min after merge.
- CLI: `npx vercel ls adaptive-listings-control-plane --prod` (or `vercel inspect <dpl_id>`).

If prod is still on an older commit, wait for the deploy to finish before continuing.

---

## Step 1 — credentials (verified recipe, 2026-06-29)

| Var                   | Where (verified)                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ADAPT_API_KEY`       | **Doppler config `prd`** (NOT readable from Vercel — it is a Sensitive var, `vercel env pull` returns empty)                                                       |
| `CLICKHOUSE_USER`     | **Doppler config `prd`** — value is `ingest_worker` in prod (NOT `default`)                                                                                        |
| `CLICKHOUSE_PASSWORD` | **Doppler config `prd`** — the `ingest_worker` password                                                                                                            |
| `CLICKHOUSE_URL`      | **NOT in Doppler and Sensitive in Vercel.** Get the host from the ClickHouse Cloud console / an operator: `https://hl0kc83gt4.eu-west-1.aws.clickhouse.cloud:8443` |

Doppler is the source of truth for the three secrets; inject them with `doppler run --config prd --`
so nothing is written to disk and no value is printed. `CLICKHOUSE_URL` must be supplied separately
(pass it as a literal into the command). The Doppler config is named **`prd`** (not `prod`).

> Why not `vercel env pull`? `ADAPT_API_KEY`, `CLICKHOUSE_URL`, `CLICKHOUSE_USER`,
> `CLICKHOUSE_PASSWORD` are all marked **Sensitive** in Vercel, so
> `vercel env pull --environment=production` writes them as empty strings. Use Doppler for the
> secrets and obtain the URL out-of-band.

---

## Step 2 — send a burst of 10 requests

Each request uses a unique `session_id` with a shared prefix so the rows can be counted. Parameters
are chosen so a row is **always** written (no `profiling_opt_out`, no consent-skip, non-`neutral`
archetype).

```bash
CH_URL="https://hl0kc83gt4.eu-west-1.aws.clickhouse.cloud:8443"
doppler run --config prd -- bash -c '
CH_URL="'"$CH_URL"'"
RUN="smoke-esc033-$(date +%s)"; echo "RUN=$RUN"
for i in $(seq 1 10); do
  c=$(curl -sS -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${ADAPT_API_KEY}" \
    "https://admin.estalara.com/api/adapt?session_id=${RUN}-${i}&archetype=luxury_buyer&confidence=0.9&similarity=0.9&tier=2")
  echo "req $i -> HTTP $c"
done
echo "=== wait 15s for after() writes ==="; sleep 15
echo "=== count ==="
curl -sS "$CH_URL" -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
  --data-binary "SELECT count() FROM adaptation_decisions WHERE session_id LIKE '"'"'${RUN}-%'"'"'"
'
```

This single `doppler run` block does the burst, the wait, and the count together (the original
step-by-step variant below is equivalent if you prefer to export the vars manually).

All 10 must return `HTTP 200`. Record the printed `RUN`.

**Request contract (GET `/api/adapt`):**

- Required query params: `session_id`, `archetype`, `confidence` (0–1), `similarity` (0–1), `tier`
  (1|2|3).
- Auth: `Authorization: Bearer <ADAPT_API_KEY>`. If `ADAPT_API_KEY` is unset in prod, any non-empty
  Bearer token is accepted (presence-only auth) — do not rely on this.
- A row is written only when the request is NOT `profiling_opt_out=1` and NOT a consent-skip
  (`consent_mode_enabled=true` + skip state). The burst above intentionally sends neither.
- Optional: add `-H "x-tenant-id: <tenant-uuid>"` to attribute rows to a real tenant; otherwise
  `tenant_id` logs as `unknown` (still a valid row).

---

## Step 3 — wait ~15 s

`afterResponse` runs the write **after** the response is sent; allow time for the ClickHouse INSERT.

```bash
sleep 15
```

---

## Step 4 — count rows in prod ClickHouse

```bash
curl -sS "${CLICKHOUSE_URL}" \
  -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
  --data-binary "SELECT count() FROM adaptation_decisions WHERE session_id LIKE '${RUN}-%'"
```

Optional detail:

```bash
curl -sS "${CLICKHOUSE_URL}" \
  -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
  --data-binary "SELECT session_id, variant, source, ts FROM adaptation_decisions WHERE session_id LIKE '${RUN}-%' ORDER BY ts FORMAT TSV"
```

---

## Step 5 — interpretation

- **`10` → ESC-033 CLOSED** ✅ — the fix works; every write survives instance suspension.
- **`1`–`9`** → fix incomplete OR prod not yet on the fixed deploy. Re-check Step 0; pull Sentry
  (control-plane project, tags `kind:insert_rejected` / `kind:network`) — `logDecisionAsync` is now
  fail-loud, so any rejected INSERT leaves a trace there.
- **`0`** → something else (wrong `CLICKHOUSE_URL`/creds, deploy without the fix, or a regression).
  Verify creds with a bare `SELECT count() FROM adaptation_decisions` and confirm the prod deploy
  commit.

---

## Cleanup (optional)

Smoke rows are tagged by the `smoke-esc033-*` `session_id` prefix and are harmless analytics noise.
To remove them (ClickHouse mutation; only if you want a clean table):

```bash
curl -sS "${CLICKHOUSE_URL}" \
  -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
  --data-binary "ALTER TABLE adaptation_decisions DELETE WHERE session_id LIKE 'smoke-esc033-%'"
```

---

## Related

- `backlog/ESCALATIONS.md` → ESC-033 (RESOLVED)
- `docs/runbooks/clickhouse-migrations.md` (prod ClickHouse curl-API access pattern)
- `apps/control-plane/src/lib/after-response.ts` (the fix)
