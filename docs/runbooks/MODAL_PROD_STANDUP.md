# Modal Prod Stand-Up Runbook (ESC-036)

**Owner:** devops-engineer · **Filed by:** pm-orchestrator (session 9) · **Date:** 2026-07-02
**References:** ESC-036, FOLLOW-436, FOLLOW-458, FOLLOW-460, `docs/runbooks/vendor-accounts.md`,
`docs/runbooks/modal-embed-seed-consumer-golive.md`

> This runbook is the plan for standing up the Modal ML layer in production. It supersedes/extends
> the embed-seed runbook (which assumed the layer was already live). **Execution is operator-only**
> (Piotr/Rafał) — it requires vendor-console access and prod secrets. Nothing here is auto-run.

---

## 0. Verified reality (2026-07-02)

- The only Modal account available (CEO `pnawrocki9`, sole profile in `~/.modal.toml`) has **0 apps
  and 0 secrets**. There is **no CI workflow** that deploys Modal
  (`grep 'modal deploy' .github/workflows` = 0).
- Per `vendor-accounts.md §3`, the intended Modal workspace is named **`estalara`** (members:
  Piotr/Rafał/Krystian), authed by `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET`. **`pnawrocki9` is not that
  workspace.**
- Doppler `prd` (verified via `doppler secrets --config prd --only-names`) is **missing** every
  Modal runtime secret: `MODAL_TOKEN_ID/SECRET`, `REDPANDA_*` (client + SASL), `UPSTASH_*`,
  `SENTRY_DSN`, `INTERNAL_API_SECRET`, `CLICKHOUSE_URL/HOST`. It DOES have `ANTHROPIC_API_KEY`,
  `DATABASE_URL`, `DATABASE_URL_ADMIN/DIRECT`, `CLICKHOUSE_USER/PASSWORD`, `OPENAI_API_KEY`,
  `CLOUDFLARE_*`, `SUPABASE_*`.
- **Both ends of the description pipeline are dark**, not just Modal:
  - _Publish end_: control-plane `/api/adapt/description` publishes `description.requested` only if
    `REDPANDA_REST_URL` is set — it is **not** in Vercel prod → the event is never published.
  - _Consume end_: the Modal `consume_description_requests` poller (30 s schedule) is not deployed.
- Consequence: full per-listing **AI description generation does not run in prod** (only
  `template_fallback`). Directive-level DOM adaptation (headline/CTA/slots) **does** work — it calls
  Anthropic directly from the control-plane (`llm-gateway.ts`, needs only `ANTHROPIC_API_KEY`, which
  is set). That is why it worked on localhost while Modal stayed empty.

**The code is fine** (BUG 1/BUG 2 from the embed-seed runbook are fixed —
`apps/llm-gateway/src/jobs/_app.py` now owns the shared `modal.App`). This is purely an
infra/provisioning gap.

---

## 1. Scope & phasing (by pilot priority)

| Phase | Modal app                                                  | Purpose                          | Secret(s)                             | Priority                                         |
| ----- | ---------------------------------------------------------- | -------------------------------- | ------------------------------------- | ------------------------------------------------ |
| **A** | `estalara-description-generator` (`apps/llm-gateway`)      | AI description body + embed-seed | `estalara-secrets`                    | **P0** — unblocks descriptions + FOLLOW-460      |
| B     | `estalara-intent-engine` (`apps/intent-engine`)            | intent NLP (batch/realtime)      | `estalara-secrets`                    | P1                                               |
| C     | `estalara-schema-validation` (`apps/data-quality`)         | daily drift cron                 | `estalara-secrets`                    | P2 — FOLLOW-458                                  |
| C     | `estalara-stream-consumer-events` (`apps/stream-consumer`) | live chat NLP                    | `redpanda-creds` + `clickhouse-creds` | **Deferred** — CEO Q2 = shadow-only (FOLLOW-458) |

Do **Phase A** first; it delivers the core "adaptive description" feature and closes FOLLOW-460's
operator leg. B/C follow once A is proven.

---

## 2. FIRST action — locate or create the `estalara` Modal workspace

`pnawrocki9` is empty and is (almost certainly) not the canonical workspace. Before anything:

1. Log into https://modal.com as Piotr and check the **workspace switcher** (top-left) for an
   `estalara` workspace (you may have a pending invite per `vendor-accounts.md §3.1`).
2. `modal profile list` locally — if only `pnawrocki9` shows, add the estalara workspace:
   - If it EXISTS: create a token there (https://modal.com/settings/tokens in that workspace) →
     `modal token set --token-id <ID> --token-secret <SECRET>` → `modal secret list` should show its
     secrets (e.g. `estalara-secrets`, `redpanda-creds`, `clickhouse-creds` if they were ever made).
   - If it does NOT exist: create it (`vendor-accounts.md §3.1`), invite Rafał/Krystian, mint a
     token, and store `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET` in Doppler **prd** (they are missing
     today):
     ```bash
     doppler secrets set MODAL_TOKEN_ID="<id>" --config prd
     doppler secrets set MODAL_TOKEN_SECRET="<secret>" --config prd
     ```
3. Confirm you are operating in the right place before Step 4: `modal secret list` must run in the
   `estalara` workspace.

> If it turns out the layer WAS deployed under some other account, stop and reconcile which account
> is canonical — do not create a parallel deployment.

---

## 3. Secret inventory for `estalara-secrets` (source-mapped)

Full key set the Phase-A/B consumers read (union of `generate_description.py`,
`consume_embed_seed_requests.py`, `intent-engine`, `data-quality`), plus FOLLOW-460's two additions.
`<from X>` = where to fetch the value. **Flagged gaps are not in Doppler prd today.**

| Key                                 | Value / Source                                                                                        | Status       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------ |
| `ANTHROPIC_API_KEY`                 | `doppler secrets get ANTHROPIC_API_KEY --config prd --plain`                                          | ✅ in prd    |
| `DATABASE_URL`                      | `doppler secrets get DATABASE_URL --config prd --plain`                                               | ✅ in prd    |
| `ENV`                               | literal `production`                                                                                  | set literal  |
| `SENTRY_DSN`                        | Sentry project → Settings → Client Keys (DSN)                                                         | ❌ gather    |
| `REDPANDA_BROKERS`                  | Redpanda Cloud console → cluster → **Kafka API** bootstrap (host:9092)                                | ❌ gather    |
| `REDPANDA_SASL_USERNAME`            | Redpanda Cloud → Security → SASL user                                                                 | ❌ gather    |
| `REDPANDA_SASL_PASSWORD`            | Redpanda Cloud → Security → SASL user                                                                 | ❌ gather    |
| `REDPANDA_SASL_MECHANISM`           | literal `SCRAM-SHA-256` (confirm in console)                                                          | set literal  |
| `REDPANDA_TLS`                      | literal `true`                                                                                        | set literal  |
| `REDPANDA_USERNAME`                 | **same value as** `REDPANDA_SASL_USERNAME` (see §6 naming note)                                       | ❌ dup       |
| `REDPANDA_PASSWORD`                 | **same value as** `REDPANDA_SASL_PASSWORD` (see §6 naming note)                                       | ❌ dup       |
| `REDPANDA_DESCRIPTIONS_TOPIC`       | literal `estalara.descriptions`                                                                       | set literal  |
| `REDPANDA_DESCRIPTIONS_GROUP`       | literal (e.g. `estalara-descriptions`)                                                                | set literal  |
| `REDPANDA_EMBED_GROUP`              | literal (e.g. `estalara-embed-seed`)                                                                  | set literal  |
| `REDPANDA_TOPIC_LISTING_EMBEDDINGS` | literal `estalara.listing-embeddings`                                                                 | set literal  |
| `UPSTASH_REDIS_URL`                 | Upstash console → database → REST URL                                                                 | ❌ gather    |
| `UPSTASH_REDIS_TOKEN`               | Upstash console → database → REST token                                                               | ❌ gather    |
| `EMBED_API_BASE_URL`                | `https://admin.estalara.com` (no trailing slash — confirm domain)                                     | set literal  |
| `INTERNAL_API_SECRET`               | **mint once** (`openssl rand -hex 32`); MUST also be set in Vercel prod (control-plane) + Doppler prd | ❌ mint+sync |
| `INTENT_BATCH_MODEL`                | literal `claude-sonnet-4-6` (per chat-NLP decision)                                                   | set literal  |
| `INTENT_REALTIME_MODEL`             | literal `claude-haiku-4-5-20251001`                                                                   | set literal  |
| `DESCRIPTION_CACHE_INTERNAL_SECRET` | **already generated + set in Vercel prod** — reuse the SAME value                                     | ✅ reuse     |
| `DESCRIPTION_CACHE_API_BASE_URL`    | `https://admin.estalara.com` (no trailing slash)                                                      | set literal  |

> The Redpanda topic/group names above are defaults the code falls back to; confirm against the
> actual topics created in Redpanda Cloud.

---

## 4. Also provision the PUBLISH end (Vercel prod — control-plane)

The Modal consumer is useless if the control-plane never publishes. Set in **Vercel prod** (these
are missing today):

- `REDPANDA_REST_URL` — Redpanda Cloud → **HTTP Proxy (pandaproxy)** REST endpoint (this is what
  `publishDescriptionRequested` posts to; distinct from the Kafka bootstrap used by Modal).
- `INTERNAL_API_SECRET` — the SAME value minted in §3 (control-plane and the embed consumer share
  it).
- (If the control-plane also does server-side Redis/Sentry: `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`, `SENTRY_DSN` — audit which the control-plane actually reads and set
  the ones it needs.)

```bash
cd apps/control-plane
printf '%s' '<redpanda-rest-url>'   | vercel env add REDPANDA_REST_URL production
printf '%s' '<internal-api-secret>' | vercel env add INTERNAL_API_SECRET production
```

---

## 5. Create the secret + deploy (Phase A)

**Create `estalara-secrets`** — prefer the **Modal web console** (add keys individually, no wipe
risk). CLI alternative REPLACES the whole secret, so it must list every key from §3:

```bash
# In the estalara workspace. DANGER: this replaces the whole secret — include ALL keys from §3.
modal secret create estalara-secrets \
  ANTHROPIC_API_KEY="$(doppler secrets get ANTHROPIC_API_KEY --config prd --plain)" \
  DATABASE_URL="$(doppler secrets get DATABASE_URL --config prd --plain)" \
  ENV=production \
  SENTRY_DSN='<from Sentry>' \
  REDPANDA_BROKERS='<host:9092>' \
  REDPANDA_SASL_USERNAME='<sasl-user>' REDPANDA_SASL_PASSWORD='<sasl-pass>' \
  REDPANDA_SASL_MECHANISM='SCRAM-SHA-256' REDPANDA_TLS='true' \
  REDPANDA_USERNAME='<same-sasl-user>' REDPANDA_PASSWORD='<same-sasl-pass>' \
  REDPANDA_DESCRIPTIONS_TOPIC='estalara.descriptions' \
  REDPANDA_DESCRIPTIONS_GROUP='estalara-descriptions' \
  REDPANDA_EMBED_GROUP='estalara-embed-seed' \
  REDPANDA_TOPIC_LISTING_EMBEDDINGS='estalara.listing-embeddings' \
  UPSTASH_REDIS_URL='<from Upstash>' UPSTASH_REDIS_TOKEN='<from Upstash>' \
  EMBED_API_BASE_URL='https://admin.estalara.com' \
  INTERNAL_API_SECRET='<minted, matches Vercel>' \
  INTENT_BATCH_MODEL='claude-sonnet-4-6' \
  INTENT_REALTIME_MODEL='claude-haiku-4-5-20251001' \
  DESCRIPTION_CACHE_INTERNAL_SECRET='<same value already in Vercel prod>' \
  DESCRIPTION_CACHE_API_BASE_URL='https://admin.estalara.com'
```

**Deploy** (BUG 1/BUG 2 already fixed — `main.py` imports both consumers via `_app.py`):

```bash
modal deploy apps/llm-gateway/src/main.py
```

Expected: functions `generate_description`, `consume_description_requests` (schedule 30 s),
`consume_embed_seed_requests` (schedule 30 s) all registered under `estalara-description-generator`.

---

## 6. Known naming inconsistency (fix or double-set)

`generate_description.py` reads `REDPANDA_SASL_USERNAME/PASSWORD`;
`data-quality/schema_validation.py` reads `REDPANDA_USERNAME/PASSWORD`. Until the code is unified,
`estalara-secrets` must carry **both** name pairs with the same values (reflected in §3/§5).
Recommend a small follow-up to standardize on one naming (candidate: fold into a P3 ticket).

---

## 7. CI workflow skeleton (prevent re-drift)

Add `.github/workflows/modal-deploy.yml` (needs `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET` as GitHub
secrets or via Doppler service token). Deploy on merges touching the Modal apps:

```yaml
name: Modal Deploy
on:
  push:
    branches: [main]
    paths: ['apps/llm-gateway/**', 'apps/intent-engine/**', 'apps/data-quality/**']
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      MODAL_TOKEN_ID: ${{ secrets.MODAL_TOKEN_ID }}
      MODAL_TOKEN_SECRET: ${{ secrets.MODAL_TOKEN_SECRET }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install modal
      - run: modal deploy apps/llm-gateway/src/main.py
      # add intent-engine / data-quality deploys as Phases B/C go live
```

---

## 8. Verification (end-to-end)

1. Modal dashboard → `estalara-description-generator` → 3 functions present, schedules 30 s, secret
   `estalara-secrets` attached.
2. Trigger a real per-listing description on prod (visit a pilot listing that hits
   `/api/adapt/description` cache-miss). Within ~60 s:
   - Modal logs for `consume_description_requests` show a processed `description.requested`.
   - Postgres prod: a new row appears in `description_cache_persistent` (this is FOLLOW-460's
     attestation — currently 0 rows).
3. If no row: check (a) `REDPANDA_REST_URL` set in Vercel (publish end), (b) topic name match
   `estalara.descriptions`, (c) `DESCRIPTION_CACHE_*` match on both sides (401 in Modal logs =
   secret mismatch).

---

## 9. Cost note

Per `vendor-accounts.md`, Modal MVP ≈ **$765/mo** (already a decided vendor — this is provisioning,
not a new-vendor decision). Redpanda Tier-1 (~$500/mo) and Upstash (~$300/mo) must be on paid tiers
for prod throughput. Confirm billing before go-live.

---

## 10. Attestation

_(Append after Phase A go-live: date, operator, Modal app URL, first `description_cache_persistent`
row id, verdict. Then PM marks FOLLOW-436 + FOLLOW-460 operator legs DONE and resolves ESC-036.)_
