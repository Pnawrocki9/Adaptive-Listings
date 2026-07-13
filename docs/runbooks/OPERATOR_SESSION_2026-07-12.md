# OPERATOR SESSION — Pilot Ignition (FOLLOW-553, Sprint 23 Wave 0)

**Refresh of `OPERATOR_SESSION_2026-07-11.md`** — supersedes it. Adds Step 0 (FOLLOW-556 Modal
ClickHouse secret, merged 2026-07-12) and folds in the now-merged Wave 1 code fixes. Execute from
this file.

**Owner:** Piotr (Steps 0–5) + Rafał (Step 6). **Time:** ~2h for Steps 0–5, Step 6 is Rafał's
deploy. **Ticket:** FOLLOW-553 (`backlog/QUEUE.md` Sprint 23). **Source:** Full-Stack Audit
2026-07-11 A3-F-01

- 2026-07-12 re-audit (`docs/AUDIT-2026-07-12.md`) — the pilot go-live checklist is 0/6 and every
  learning/measurement loop is dead in prod until this session runs.

## Why this session is THE unblock

Per `docs/AUDIT-2026-07-12.md`: the code foundation is sound (🟡 YELLOW), but the **intelligence is
switched OFF in prod**. This session turns it on:

- **Bandit frozen** at `Beta(1,1)` uniform-random ← feedback endpoint 503-gated → **Step 2**.
- **Affinity = djb2 hash**, not cosine ← `listing_embeddings` empty / embed-seed not live → **Steps
  3+4**.
- **`intent_events` count = 0** ← ClickHouse migration 0015 unapplied → **Step 1**.
- **Description spend cap dormant** ← Modal has no ClickHouse creds (new, FOLLOW-556) → **Step 0**.
- **Pilot DOM hooks not deployed** ← ESC-020 → **Step 6** (Rafał, may trail).

## Wave 1 code — MERGED, no operator action (context only)

These landed 2026-07-12 and change what you'll observe during the session:

- **FOLLOW-569** — the SDK now emits `inquiry.completed` to ingest, so once Step 1 lands the
  `cta-lift` conversion leg will populate (previously always empty).
- **FOLLOW-554** — a quiz _skip_ no longer wipes the source-of-truth archetype to `neutral`
  (adaptation stays on across a skip).
- **FOLLOW-555** — the 6+3 browser-session routes (`detect`, `schema/activate`, `admin/labels*`,
  `demo/*`, `generation-model`) accept the `@supabase/ssr` session, so the onboarding wizard +
  dashboards used in Steps 3/4 no longer 401 for a logged-in operator. A `pre-push` guard prevents
  regressions.
- **FOLLOW-556** — daily LLM spend circuit breaker on the description/headline path — **requires
  Step 0** to be active.

## Rules of engagement

- Run steps **in order**. Dependencies: 4←3, 3/0←CH creds loaded in 1. 2 and 5 are independent.
- **Paste REAL output** into every attestation point (Rule AA — nothing flips to DONE on intent).
- **Never paste raw secret values** anywhere. Use `doppler secrets set` / console UIs.
- Keep a terminal with prod CH creds exported for Steps 0/1/4 (load once, reuse).

## Pre-flight — access & tools (5 min)

Confirm you have all of these before starting (missing one blocks a step):

- [ ] **Doppler** access to config `prd` (`doppler setup` in repo; `doppler secrets --config prd`).
- [ ] **Vercel** prod access to the `control-plane` project (env vars).
- [ ] **Modal** console access to app `estalara-description-generator` (secrets + web endpoints).
- [ ] **GitHub** admin on `Pnawrocki9/Adaptive-Listings` (Actions secrets).
- [ ] **Supabase** SQL editor (pilot project) for the `listing_embeddings` counts.
- [ ] **ClickHouse** Cloud admin console (DDL grant — `ingest_worker` cannot apply migrations).
- [ ] Prod CH creds loaded to env:
  ```bash
  export CLICKHOUSE_URL="$(doppler secrets get CLICKHOUSE_URL   --config prd --plain)"
  export CLICKHOUSE_USER="$(doppler secrets get CLICKHOUSE_USER  --config prd --plain)"
  export CLICKHOUSE_PASSWORD="$(doppler secrets get CLICKHOUSE_PASSWORD --config prd --plain)"
  ```

---

## Step 0 — Modal ClickHouse creds → activate the FOLLOW-556 spend cap (NEW, ~5 min)

The description/headline spend breaker (PR #520) reads/writes the shared `llm_calls` table from the
Modal job. Modal's `estalara-secrets` bundle has **no** ClickHouse creds today, so the breaker
**fails open (dormant)** until you add them.

1. Modal console → app **`estalara-description-generator`** → **Secrets → `estalara-secrets`** →
   add:
   - `CLICKHOUSE_URL` = the same value as Doppler prd `CLICKHOUSE_URL`
   - `CLICKHOUSE_USER` = Doppler prd `CLICKHOUSE_USER` (e.g. `ingest_worker`)
   - `CLICKHOUSE_PASSWORD` = Doppler prd `CLICKHOUSE_PASSWORD`
   - _(optional)_ `LLM_DAILY_SPEND_CAP_USD` — leave unset for the default `100` (parity with the TS
     cap).
2. Redeploy the Modal app so the new secret is live (`modal deploy apps/llm-gateway/src/jobs/...`,
   or the standard deploy path — devops on standby).
3. Smoke: trigger one real description generation (mock harness on :9100 or a live pilot listing),
   then confirm the call is recorded:
   ```bash
   curl -s "$CLICKHOUSE_URL" -u "$CLICKHOUSE_USER:$CLICKHOUSE_PASSWORD" \
     --data "SELECT count() FROM llm_calls WHERE source IN ('description','headline') AND ts >= now() - INTERVAL 1 DAY FORMAT TSV"
   # must be > 0 after a generation (was 0 — the description path never logged llm_calls before #520)
   ```

**Attestation:** paste the `count()` (before/after a generation) into the FOLLOW-556 close note.
**Rollback:** remove the three secrets → breaker returns to fail-open (no behaviour change vs
today).

## Step 1 — ClickHouse migration 0015 → prod (closes FOLLOW-449 AC1/AC2)

Authoritative sequence: **`docs/runbooks/clickhouse-migrations.md` § "Prod Attestation — migration
0015 (`intent_events.session_id`)"** (~line 295). Summary (use the runbook, not this summary):

1. CH creds already exported (pre-flight).
2. `DESCRIBE TABLE intent_events` — BEFORE snapshot.
3. If `session_id` absent: apply `infra/clickhouse/migrations/0015_intent_events_session_id_fix.sql`
   (idempotent) via the CH Cloud admin console (the `ingest_worker` prod user lacks the DDL grant).
4. `doppler run --config prd -- bash infra/clickhouse/scripts/migrate.sh` — backfill 0016→0020.
5. `DESCRIBE TABLE intent_events` — AFTER; **must show `session_id String DEFAULT ''`**.
6. Trigger one real `intent.snapshot` (live SDK session or mock harness :9100), then
   `SELECT count() FROM intent_events` — **must be > 0** (has been 0 since 2026-06-12).

**Attestation:** paste steps 2/3-4/5/6 into the four `<<< OPERATOR MUST RUN AND PASTE >>>` markers
in `clickhouse-migrations.md`; set the Verdict line. **Rollback:** 0015 is additive (`DEFAULT ''`) —
no rollback needed; a failed `migrate.sh` leaves the table unchanged.

## Step 2 — Feedback endpoint go-live (closes FOLLOW-450 leg; un-freezes the bandit)

```bash
# Check what's already set first:
doppler secrets --config prd | grep -E 'FEEDBACK_ENDPOINT_ENABLED|ADAPT_API_KEY|OPS_TENANT_ID|DATABASE_URL_ADMIN'

doppler secrets set FEEDBACK_ENDPOINT_ENABLED=true --config prd
# Provision any that are missing:
doppler secrets set ADAPT_API_KEY='<strong random key>' --config prd
doppler secrets set OPS_TENANT_ID='<pilot/ops tenant UUID>' --config prd
doppler secrets set DATABASE_URL_ADMIN='<Supabase IPv4 POOLER url — NOT the IPv6 direct host>' --config prd

# Redeploy control-plane (Vercel) so the flag is live, then prove a REAL weight delta:
doppler run --config prd -- pnpm feedback:canary
```

**Attestation:** the canary must print an `ab_bandit_weights` alpha/beta delta (before ≠ after) —
paste into the FOLLOW-450 close note. Until then Thompson sampling is uniform (`Beta(1,1)`).
**Rollback:** `doppler secrets set FEEDBACK_ENDPOINT_ENABLED=false --config prd` + redeploy.

## Step 3 — ESC-034: embed-seed Modal go-live (CORRECTED direct-HTTPS path)

Per the ESC-034 correction 2026-07-06 (`backlog/ESCALATIONS.md`) — the Redpanda-poller path is dead;
the live path is direct HTTPS (same as the description flow).

1. **Vercel prod** (control-plane): set `MODAL_EMBED_SEED_URL` to the deployed Modal endpoint URL
   for `listing_embed_seed_requested_endpoint` (Modal → app `estalara-description-generator` → web
   endpoints; mirror how `MODAL_DESCRIPTION_URL` is set).
2. Confirm `INTERNAL_API_SECRET` is present in Modal `estalara-secrets` (verify, don't assume).
3. Smoke: trigger an onboarding-overflow embed-seed event; check Modal logs + Sentry
   `tags.area:onboarding tags.sink:modal-embed-seed`.
4. Mark **ESC-034 RESOLVED** in `backlog/ESCALATIONS.md` with the smoke evidence.

## Step 4 — Seed `listing_embeddings` for the pilot tenant (un-djb2s the reorder path)

With Step 3 live: trigger the embed-seed for the pilot tenant (re-run schema activation for the
tenant, or `POST /api/listings/embed` with the `INTERNAL_API_SECRET` bearer — see
`apps/control-plane/src/app/api/listings/embed/route.ts` +
`docs/runbooks/SDK_PRODUCTION_INTEGRATION.md`).

**Attestation (Supabase SQL):**

```sql
SELECT count(*) FROM listing_embeddings WHERE tenant_id = '<pilot tenant UUID>';
-- must be > 0; audit state 2026-07-11: 0 (100% djb2 fallback)
```

Then load one listing page and confirm a cosine-path log line (`adapt/route.ts`; structured
telemetry lands with FOLLOW-560). **Rollback:** none needed (seeding is additive; djb2 remains the
safe fallback if empty).

## Step 5 — ESC-028: 4 Upstash CI secrets (~10 min)

1. Create ONE test Upstash Redis instance (free tier).
2. GitHub → Settings → Secrets → Actions: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
   `UPSTASH_REDIS_URL`, `UPSTASH_REDIS_TOKEN` — **all four at the same instance** (the parity IS the
   test).
3. Add the same four to Doppler dev/stg/prd.
4. Re-run `redis-shadow-smoke.yml` — it auto-switches to hard-fail mode and must pass. Mark
   **ESC-028 RESOLVED**.

## Step 6 — ESC-020: Estalara-app DOM hooks deploy (RAFAŁ)

Hand-off contract (ESC-020 + `docs/runbooks/SDK_PRODUCTION_INTEGRATION.md`):

1. Deploy `web-master` HEAD to production `app.estalara.com`. **CRITICAL: do NOT deploy the local
   uncommitted `src/app.html` override pointing at `localhost:9100`** (that is the dev demo loader
   we use locally — prod must point at `admin.estalara.com`).
2. Set `PUBLIC_ESTALARA_SDK_ENABLED` in the prod environment.
3. Verify:
   ```bash
   curl -s https://app.estalara.com/en/listing/<any-listing-url> | grep -c "data-estalara"
   # was 0 on 2026-06-06; must be > 0 after deploy
   ```

This is the ONLY step allowed to trail the session (Rafał's calendar) — but live measurement starts
only when it lands.

---

## Definition of Done (FOLLOW-553)

- [ ] Step 0: `llm_calls` records `source IN ('description','headline')` rows (cap active).
- [ ] Step 1: `intent_events` `session_id` column present; `count() > 0` after a live snapshot.
- [ ] Step 2: `feedback:canary` shows a real `ab_bandit_weights` delta (bandit learning).
- [ ] Step 3: ESC-034 smoke green → RESOLVED.
- [ ] Step 4: `listing_embeddings count > 0` for the pilot tenant; cosine reorder reached once.
- [ ] Step 5: `redis-shadow-smoke.yml` hard-fail mode passes → ESC-028 RESOLVED.
- [ ] Step 6: `data-estalara` count > 0 on prod `app.estalara.com` (may trail; Rafał's date
      committed).

## Post-session bookkeeping

1. Fill every attestation point (runbook stubs + ticket close notes).
2. Flip `FOLLOW-449` + `FOLLOW-450` → `DONE` (attestation links); FOLLOW-556 close note with the
   Step 0 `count()`; mark ESC-034 + ESC-028 RESOLVED; update ESC-020 with Rafał's date; refresh
   `backlog/STATUS.md`. **Or** paste the outputs to the coordinator session and say _"zamknij
   księgowość Wave 0"_ — the orchestrator does the bookkeeping and un-blocks FOLLOW-458/560/565 +
   the FOLLOW-471 re-audit gate.
3. Answer the two standing CEO decisions when convenient:
   - **Q-566** — ingest per-tenant origin allowlist vs the documented trade-off.
   - **Q-556** — per-tenant description-generation quota (defense-in-depth beyond the global cap).

---

\*Generated 2026-07-12. Supersedes OPERATOR_SESSION_2026-07-11.md. Anchored on FOLLOW-553 (QUEUE.md)

- docs/AUDIT-2026-07-12.md. Steps 0–6; not delegable to a worker agent.\*
