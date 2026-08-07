# Modal Embed-Seed Consumer Go-Live Runbook (FOLLOW-435 / FOLLOW-436)

**Owner:** devops-engineer **Last updated:** 2026-06-30 **References:** FOLLOW-435, FOLLOW-436,
RETRO-141, RETRO-142, ESC-034

---

## Purpose

Activate the durable embed-seed Modal consumer that was shipped code-complete in FOLLOW-435 (PRs
#389 + #390) but left unprovisioned. Without this runbook being executed, any activation with more
than 50 listings (`MAX_INLINE_SEED`) silently produces no embeddings for the overflow batch — the
Redpanda message is published but nothing consumes it.

**Forward-safety context:** As of 2026-06-30 nothing populates `schema.listing_ids` in prod, so the
overflow path is never triggered by real traffic yet. This is pre-provisioning before the first
large-catalog tenant activation.

---

## STOP — read these code bugs before proceeding

Two structural bugs were discovered during wiring verification for FOLLOW-436. Neither is a secrets
or configuration problem — they are code-level issues that make a safe go-live impossible with the
current codebase. **Do not attempt the deploy steps below until these bugs are resolved in a
separate code-fix ticket (see ESC-034).**

### BUG 1 — CRITICAL ORPHAN: `main.py` deploys nothing

File: `apps/llm-gateway/src/main.py`

The canonical deploy entry point per `backlog/HANDOFFS.md` (line 242) and
`backlog/sprint-0/TICKET-009.md` (line 144) is `modal deploy apps/<app>/src/main.py`. However,
`apps/llm-gateway/src/main.py` is a placeholder stub containing only `SERVICE_NAME`,
`SERVICE_VERSION`, and a `get_service_info()` function. It does **not** import `modal`, define a
`modal.App`, or import `generate_description.py` or `consume_embed_seed_requests.py`.

Running `modal deploy apps/llm-gateway/src/main.py` would deploy a Modal app with **zero functions**
— neither the existing description consumer nor the new embed-seed consumer would be registered.

### BUG 2 — CRITICAL APP-NAME COLLISION: deploying one consumer wipes the other

File A: `apps/llm-gateway/src/jobs/generate_description.py` line 210 File B:
`apps/llm-gateway/src/jobs/consume_embed_seed_requests.py` line 84

Both files independently create `app = modal.App("estalara-description-generator")`. These are
separate Python objects that share the same Modal app name string.

When you run `modal deploy <file>`, Modal registers **exactly** the functions decorated in that file
under the named app — it does **not** merge with a prior deployment. Deploying File B wipes the
`generate_description` and `consume_description_requests` functions that were registered by File A.
The description generation pipeline stops working.

### Required code fix (pre-go-live)

A code-fix PR (backend-engineer or ml-engineer) must:

1. Extract the shared `modal.App` object into a single location (e.g.,
   `apps/llm-gateway/src/jobs/_app.py`):
   ```python
   import modal
   app = modal.App("estalara-description-generator")
   ```
2. Both `generate_description.py` and `consume_embed_seed_requests.py` import `app` from that shared
   file rather than creating their own.
3. `apps/llm-gateway/src/main.py` imports both consumer modules so
   `modal deploy apps/llm-gateway/src/main.py` picks up all three decorated functions in one
   deployment.

Until that fix is merged, do not proceed with Steps 2 and 3 of this runbook.

---

## Pre-conditions (all must be true before running)

1. The code-fix for BUG 1 + BUG 2 is merged to `main` and the branch is up to date.
2. You are authenticated to Modal with an account that has write access to the `estalara` workspace:
   `modal token set --token-id <ID> --token-secret <SECRET>` (IDs stored in Doppler as
   `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET`).
3. You have access to Doppler config `prd` to retrieve `INTERNAL_API_SECRET`: `doppler me` must
   succeed and `doppler secrets get INTERNAL_API_SECRET --config prd` must return a non-empty value.
4. You know the control-plane base URL for the target environment:
   - **prod:** `https://admin.estalara.com`
   - **non-prod:** a Vercel **preview** deployment URL (no trailing slash). Corrected 2026-08-07
     (FOLLOW-878 / ESC-052): this said "staging". There is no staging environment — a Vercel preview
     is a preview build of the control-plane and it reads the **same** Supabase/ClickHouse as
     production. Treat any run against it as a production write.

---

## Step 1 — Provision the three secrets in Modal `estalara-secrets`

The Modal secret `estalara-secrets` already exists (it is used by `consume_description_requests`).
You need to **add** three keys to it without overwriting the existing keys.

**Preferred method — Modal web console (safest, no risk of wiping existing keys):**

1. Navigate to https://modal.com/secrets
2. Click on `estalara-secrets`
3. Click **Edit**
4. Add or update the following three key-value pairs:

| Key                                 | Value                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REDPANDA_TOPIC_LISTING_EMBEDDINGS` | `estalara.listing-embeddings`                                                                                                                                                         |
| `EMBED_API_BASE_URL`                | `https://admin.estalara.com` (prod) or a Vercel preview URL (**not** a staging environment — none exists, FOLLOW-878/ESC-052) — **no trailing slash**                                 |
| `INTERNAL_API_SECRET`               | Copy from Doppler `prd`: `doppler secrets get INTERNAL_API_SECRET --config prd --plain` (do **not** mint a new value — the control-plane and the consumer must share the same secret) |

5. Save. The existing Redpanda broker/credential keys (`REDPANDA_BROKERS`, `REDPANDA_SASL_USERNAME`,
   `REDPANDA_SASL_PASSWORD`, etc.) are not changed.

**Alternative — CLI (WARNING: `modal secret create` REPLACES the entire secret):**

If you use the CLI, you must include **all** existing keys alongside the three new ones, or the
existing keys will be lost. Retrieve the existing keys from the Modal dashboard first, then run:

```bash
# DANGER: this replaces ALL keys in estalara-secrets.
# You MUST include all existing keys (REDPANDA_BROKERS, REDPANDA_SASL_USERNAME, etc.)
# alongside the three new ones.
modal secret create estalara-secrets \
  REDPANDA_TOPIC_LISTING_EMBEDDINGS=estalara.listing-embeddings \
  EMBED_API_BASE_URL=<CONTROL_PLANE_BASE_URL> \
  INTERNAL_API_SECRET=<VALUE_FROM_DOPPLER_PRD> \
  REDPANDA_BROKERS=<EXISTING_VALUE> \
  REDPANDA_SASL_USERNAME=<EXISTING_VALUE> \
  REDPANDA_SASL_PASSWORD=<EXISTING_VALUE> \
  REDPANDA_SASL_MECHANISM=<EXISTING_VALUE> \
  REDPANDA_TLS=<EXISTING_VALUE> \
  ANTHROPIC_API_KEY=<EXISTING_VALUE> \
  SENTRY_DSN=<EXISTING_VALUE>
  # ... include every other key that already exists in the secret
```

Use `<VALUE>` as a placeholder — never commit or log actual secret values.

### Step 1 verification

After saving, in the Modal web console confirm that `estalara-secrets` now shows the three new keys.
Do not display the values — key presence is sufficient.

---

## Step 2 — Deploy `apps/llm-gateway`

**This step requires BUG 1 and BUG 2 to be fixed first (see STOP section above).**

Once the code fix is merged:

```bash
# From the repo root, with Modal authenticated:
modal deploy apps/llm-gateway/src/main.py
```

Expected output from Modal (approximate):

```
Deploying app estalara-description-generator ...
Created function consume_description_requests (schedule: every 30s)
Created function generate_description
Created function consume_embed_seed_requests (schedule: every 30s)
Deployed app estalara-description-generator in ~Xs
```

The critical line is `Created function consume_embed_seed_requests (schedule: every 30s)`. If it is
absent from the output, the consumer was not registered — do not proceed to Step 3.

**Verify in Modal dashboard:**

1. Navigate to https://modal.com/apps/estalara-description-generator
2. Confirm three functions are listed including `consume_embed_seed_requests`
3. Confirm it shows a schedule of `every 30 seconds`
4. Confirm it shows `Secret: estalara-secrets`

---

## Step 3 — Smoke verification (AC-5 / AC-6)

### 3a — Trigger an activation with overflow

You need a tenant activation where `schema.listing_ids` carries more than 50 listing IDs. Today no
real tenant has this field populated, so the test must be run against the local pilot substrate
(`docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md`; there is no staging environment — FOLLOW-878/ESC-052)
or by temporarily patching the demo tenant's schema to include >50 listing IDs.

**What to look for in Modal logs:**

In the Modal dashboard → `estalara-description-generator` → `consume_embed_seed_requests` → Logs,
within 30 seconds of the activation you should see:

```
consume_embed_seed_requests.processing tenant=<tenant-id> listing_count=<N>
consume_embed_seed_requests.embed_ok tenant=<tenant-id> listing=<listing-id>
...
consume_embed_seed_requests.done processed=1 embed_ok=<N> embed_fail=0
```

The control-plane activation log (Vercel) should show the overflow warning:

```
[seed-listing-embeddings] OVERFLOW: tenant=<id> has <N> listings beyond MAX_INLINE_SEED=50. Enqueueing to estalara.listing-embeddings for Modal processing (FOLLOW-435).
```

### 3b — Verify `/api/listings/embed` upserts

After the Modal run completes, confirm that the overflow listing IDs received embeddings in the
Postgres `listing_embeddings` table (via Supabase admin or the existing listing-embed lookup logic).
Each listing_id logged as `embed_ok` must have a corresponding row.

### 3c — Sentry telemetry check

If any embed call fails, Sentry will receive an event with these tags:

```
area: onboarding
sink: modal-embed-seed
kind: embed_failed
```

In Sentry → Issues, filter with: `tags.area:onboarding tags.sink:modal-embed-seed`

For a fully successful smoke run there should be **zero events** under this filter. If events
appear, inspect the `tenant_id` and `listing_id` extras for the failing listing and compare the
`EMBED_API_BASE_URL` value in `estalara-secrets` against the actual control-plane URL.

---

## Rollback / abort

If the deploy causes the description generation pipeline to degrade (e.g.,
`consume_description_requests` disappears from the Modal app), re-deploy the prior working version:

```bash
# Re-deploy only the description generator to restore it
# (only valid if BUG 2 is not yet fixed — stops the embed consumer)
modal deploy apps/llm-gateway/src/jobs/generate_description.py
```

If `estalara-secrets` was accidentally overwritten with the CLI (missing existing keys):

1. Retrieve the lost values from the Doppler `prd` config and Modal dashboard history.
2. Re-run `modal secret create estalara-secrets` with all keys.
3. Re-deploy the app.

---

## Post-execution

After a successful smoke run:

1. Append an attestation entry below (date, operator, Modal run URL, result).
2. File a PR updating `.env.example` if `REDPANDA_TOPIC_LISTING_EMBEDDINGS` is not yet documented
   there (gap identified during FOLLOW-436 wiring review — see `backlog/ESCALATIONS.md` ESC-034).
3. PM: mark FOLLOW-436 DONE in `backlog/QUEUE.md`.

---

## Prod Attestation

_(Append here after go-live.)_

**Date:** **Operator:** **Environment:** **Modal run URL:** **Verdict:**
