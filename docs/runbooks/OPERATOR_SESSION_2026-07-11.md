# OPERATOR SESSION — Pilot Ignition (FOLLOW-553, Sprint 23 Wave 0)

> ⚠️ **SUPERSEDED by [`OPERATOR_SESSION_2026-07-12.md`](./OPERATOR_SESSION_2026-07-12.md)** — the
> refresh adds Step 0 (FOLLOW-556 Modal ClickHouse secret, merged 2026-07-12), a pre-flight access
> checklist, per-step rollbacks, and the now-merged Wave 1 context. Execute from the 07-12 version;
> this file is kept for history.

**Owner:** Piotr (steps 1–5) + Rafał (step 6). **Estimated time:** 2–4h total (steps 1–5 ≈ 90 min,
step 6 is Rafał's deploy). **Source:** Full-Stack Audit 2026-07-11 finding A3-F-01 — the pilot
go-live checklist was 0/6 complete; every learning/measurement loop is dead in prod until this
session runs. **Ticket:** FOLLOW-553 (`backlog/QUEUE.md` Sprint 23).

**Rules of engagement:** run the steps IN ORDER (step 4 depends on 3; step 2 is independent but
cheapest to verify while CH creds are loaded). Paste REAL output into every attestation point — Rule
AA: nothing here flips to DONE on intent alone. Never paste raw secret values anywhere.

---

## Step 1 — ClickHouse migration 0015 → prod (closes FOLLOW-449 AC1/AC2)

Follow the exact, already-prepared command sequence in **`docs/runbooks/clickhouse-migrations.md` §
"Prod Attestation — migration 0015 (`intent_events.session_id`) — STUB, OPERATOR MUST COMPLETE"** (≈
line 295). Summary of the sequence (the runbook section is authoritative — use it, not this
summary):

1. Load prod CH creds from Doppler
   (`doppler secrets get CLICKHOUSE_URL/USER/PASSWORD --config prd --plain` into env vars).
2. `DESCRIBE TABLE intent_events` — BEFORE snapshot.
3. If `session_id` absent: apply `infra/clickhouse/migrations/0015_intent_events_session_id_fix.sql`
   (idempotent).
4. `doppler run --config prd -- bash infra/clickhouse/scripts/migrate.sh` — backfill 0016→0020
   (0018's RENAME is already applied per the 0019 attestation; 0020 applied 2026-07-09).
5. `DESCRIBE TABLE intent_events` — AFTER; **must show `session_id String DEFAULT ''`**.
6. Trigger one real `intent.snapshot` (live SDK session or the mock decision harness on :9100), then
   `SELECT count() FROM intent_events` — **must be > 0**. This has been 0 since 2026-06-12.

**Attestation:** paste steps 2/3-4/5/6 output into the four `<<< OPERATOR MUST RUN AND PASTE >>>`
markers in `clickhouse-migrations.md` and set the Verdict line.

## Step 2 — Feedback endpoint go-live (closes FOLLOW-450 operator leg; un-freezes the bandit)

```bash
doppler secrets set FEEDBACK_ENDPOINT_ENABLED=true --config prd
# Provision if missing (check first with: doppler secrets --config prd | grep -E 'ADAPT_API_KEY|OPS_TENANT_ID|DATABASE_URL_ADMIN'):
doppler secrets set ADAPT_API_KEY='<generate a strong random key>' --config prd
doppler secrets set OPS_TENANT_ID='<pilot/ops tenant UUID>' --config prd
doppler secrets set DATABASE_URL_ADMIN='<Supabase IPv4 POOLER url — NOT the IPv6 direct host>' --config prd

# Redeploy control-plane so Vercel picks up the flag, then prove a REAL weight delta:
doppler run --config prd -- pnpm feedback:canary
```

**Attestation:** the canary must print an `ab_bandit_weights` alpha/beta delta (before ≠ after).
Paste the output into the FOLLOW-450 close note in QUEUE.md. Until this runs, Thompson sampling is
uniform-random (weights frozen at Beta(1,1)).

## Step 3 — ESC-034: embed-seed Modal go-live (CORRECTED path — do NOT follow the old runbook)

Per the ESC-034 correction of 2026-07-06 (`backlog/ESCALATIONS.md`): the Redpanda-poller path is
dead; the live path is direct HTTPS, same pattern as the description flow.

1. In **Vercel prod** (control-plane project): set `MODAL_EMBED_SEED_URL` to the deployed Modal
   endpoint URL for `listing_embed_seed_requested_endpoint` (mirror how `MODAL_DESCRIPTION_URL` is
   set — Modal dashboard → app `estalara-description-generator` → web endpoints).
2. Confirm `INTERNAL_API_SECRET` is present in Modal `estalara-secrets` (already required by the
   live description endpoint — verify, don't assume).
3. Smoke: trigger an onboarding-overflow embed-seed event; check Modal logs + Sentry
   `tags.area:onboarding tags.sink:modal-embed-seed`.
4. Mark **ESC-034 RESOLVED** in `backlog/ESCALATIONS.md` with the smoke evidence.

## Step 4 — Seed `listing_embeddings` for the pilot tenant (un-djb2s the reorder path)

With step 3 live: trigger the embed-seed for the pilot tenant's listings (re-run schema activation
for the tenant, or call `POST /api/listings/embed` with the `INTERNAL_API_SECRET` bearer — see
`apps/control-plane/src/app/api/listings/embed/route.ts` contract and
`docs/runbooks/SDK_PRODUCTION_INTEGRATION.md`).

**Attestation (Supabase SQL):**

```sql
SELECT count(*) FROM listing_embeddings WHERE tenant_id = '<pilot tenant UUID>';
-- must be > 0; audit state on 2026-07-11: 0 (100% djb2 fallback)
```

Then load one listing page and confirm a cosine-path log line (`console.debug` in
`adapt/route.ts:612` — structured telemetry arrives with FOLLOW-560).

## Step 5 — ESC-028: 4 Upstash CI secrets (~10 min)

1. Create ONE test Upstash Redis instance (free tier).
2. GitHub → Settings → Secrets → Actions: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
   `UPSTASH_REDIS_URL`, `UPSTASH_REDIS_TOKEN` — **all four pointing at that same instance** (the
   parity IS the test).
3. Add the same four to Doppler dev/stg/prd.
4. Re-run `redis-shadow-smoke.yml` — it auto-switches to hard-fail mode and must pass. Mark
   **ESC-028 RESOLVED**.

## Step 6 — ESC-020: Estalara-app DOM hooks deploy (RAFAŁ)

Hand-off contract (from ESC-020 + `docs/runbooks/SDK_PRODUCTION_INTEGRATION.md`):

1. Deploy `web-master` HEAD (≥ `9d2df9d`) to production `app.estalara.com`. **CRITICAL: do NOT
   deploy the local uncommitted `src/app.html` override pointing at `localhost:9100`.**
2. Set `PUBLIC_ESTALARA_SDK_ENABLED` in the prod environment.
3. Verify:

```bash
curl -s https://app.estalara.com/en/listing/<any-listing-url> | grep -c "data-estalara"
# was 0 on 2026-06-06; must be > 0 after deploy
```

This is the ONLY step allowed to trail the session (Rafał's calendar) — but live measurement starts
only when it lands.

---

## Post-session bookkeeping (paste your outputs, then hand back to the agents)

1. Fill every attestation point above (runbook stubs + ticket close notes).
2. Flip `FOLLOW-449` and `FOLLOW-450` → `DONE` in QUEUE.md (attestation links in the close notes);
   mark ESC-034 + ESC-028 RESOLVED; update ESC-020 with Rafał's deploy date; refresh the
   `backlog/STATUS.md` go-live checklist table. (Or simply paste the outputs to the coordinator
   session and say "zamknij księgowość Wave 0" — the orchestrator will do the bookkeeping and
   un-block FOLLOW-458/560/565 + the FOLLOW-471 re-audit gate.)
3. Answer the two standing CEO decisions when convenient: (Q-566) ingest origin allowlist vs
   documented trade-off; (Q-556) per-tenant description-generation quota preference.
