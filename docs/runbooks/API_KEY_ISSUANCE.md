# API-key issuance runbook (single tenant) — FOLLOW-1327

Operator procedure for minting, rotating, revoking and listing the tenant's API keys with
`apps/control-plane/scripts/issue-tenant-api-key.mts`. It replaces the key part of
`POST /api/schema/activate`, which FOLLOW-1328 deleted (plan Phase 2 R6). For the single tenant
(ESC-085) it also supersedes `docs/runbooks/BRAND_PROVISIONING.md` §Step 2 (the key half) and the
key-capture prerequisite of its §Step 6.

No secret value appears in this document. Variable and binding names only.

## 1. What the old route did, and where each part went

`POST /api/schema/activate` did five things in one call. This is where each one lives now:

| What the route did                                                                 | Now                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upsert the detected schema into `tenant_site_schemas`                              | Not done here. The table stays (R6 keeps it). Locally, `seed-local-tenant.mts` writes the fixture row.                                                        |
| Promote `tenants.status` `pending → active` (only while still `pending`)           | `issue`, using the same predicate, in the same transaction as the key insert. It flips once. Later issues leave the status alone.                             |
| Return the live public key masked, or mint `est_pub_…` and return the raw key once | `issue` mints `est_pub_<32 hex>` and stores `SHA-256(raw)` in `api_keys.hashed_key`, the same hash the route stored. It refuses if a live key already exists. |
| Bust the Redis tenant-schema cache                                                 | Not needed: no schema is written.                                                                                                                             |
| `seedListingEmbeddingsForActivation(tenant, schema)` in `after()`                  | `issue` calls the same function once after the commit, with the tenant's latest stored schema (or none), then reports the result (§6).                        |

The route never wrote the ingest Worker's `KV_API_KEYS`. Neither does the script, but it **prints
the exact record**, because the KV key is the raw API key and that is the only moment it exists
(§4).

## 2. Prerequisites

- A checkout of the repo with dependencies installed (`pnpm install`).
- `DATABASE_URL_ADMIN` for the target Postgres. For production it comes from Doppler `prd`; run the
  command under `doppler run --config prd -- …`. The script prints only `host:port` and **refuses a
  non-loopback host unless you pass `--confirm-production`**.
- For the embedding seed (§6): `INTERNAL_API_SECRET`, `NEXT_PUBLIC_APP_URL` (the control plane the
  seed calls), and `DEMO_TENANT_ID` when the tenant's listings come from the fixture manifest.
  Without `INTERNAL_API_SECRET` the seed is skipped and the script says so. That is not an error.
- For the KV write (§4): `CLOUDFLARE_API_TOKEN` with KV write scope (`docs/runbooks/cloudflare.md`).
- The tenant row exists (`list` or the admin backoffice shows its id).

Invoke the script directly to keep its exit codes:

```bash
pnpm exec tsx apps/control-plane/scripts/issue-tenant-api-key.mts <subcommand> …
```

`pnpm issue-api-key <subcommand> …` runs the same command, but `pnpm run` turns every non-zero exit
into 1.

Exit codes: `0` done · `1` refused or failed, nothing written · `2` key issued and valid, but the
embedding seed was not confirmed complete (§6). After exit 2, **do not re-issue**.

Output: diagnostics go to **stderr**. The one-time secret block goes to **stdout**, and nothing else
is written there. Do not redirect stdout to a file you keep. Copy the values out of the terminal.

## 3. Issue the SDK (public) key

```bash
doppler run --config prd -- pnpm exec tsx apps/control-plane/scripts/issue-tenant-api-key.mts \
  issue --tenant <tenant-uuid> --label "Estalara web" \
  --allowed-origins https://app.estalara.com,https://estalara.com \
  --confirm-production
```

- `--allowed-origins` sets this key's browser allow-list. It is written to
  `api_keys.allowed_origins` (Postgres source of truth, read by the control plane's origin gate) and
  to the KV record's `allowed_origins` (ingest's origin gate). Without it, the tenant's
  `tenants.allowed_origins` is used. If that column is also the `[]` default, the script **refuses
  before writing anything**: Postgres `[]` means "not configured", but KV `[]` means deny-all.
  `--on-empty deny-all|inherit-env` overrides this explicitly. `inherit-env` is correct only for the
  first-party tenant (`FIRST_PARTY_TENANT_ID` on the Worker). The FOLLOW-658 semantics are in
  `docs/runbooks/BRAND_PROVISIONING.md` §Step 6.
- Default scopes are `read:events,write:events`. Pass `--scopes a:b,…` to change them.
- If a live public key already exists, the script refuses. Use `rotate` (§5) instead, or
  `--additional` if you deliberately want a second live key.

The stdout block contains: `key_id`, the **raw api key**, the KV key name `api_key:<raw key>` and
the KV value JSON. Where the raw key goes:

- **Estalara app (`web-master`) env:** `PUBLIC_ESTALARA_API_KEY` (with `PUBLIC_ESTALARA_TENANT_ID` =
  the tenant uuid). The loader tag renders it as `data-api-key`. See
  `docs/runbooks/SDK_PRODUCTION_INTEGRATION.md`.
- **Ingest Worker:** the `KV_API_KEYS` record (§4).

## 4. Write the ingest KV record (`KV_API_KEYS`)

The ingest Worker authenticates `X-Estalara-API-Key` only against `KV_API_KEYS`
(`apps/ingest/src/auth.ts`). Until this record exists, ingest answers `401 unknown_key` for the new
key.

Put the printed JSON in a temporary file that only you can read. Then write it under the printed key
name, using `--path` so the value never appears in a process list:

```bash
umask 077; f="$(mktemp)"; "${EDITOR:-vi}" "$f"   # paste the JSON value line
cd apps/ingest
pnpm exec wrangler kv key put --binding KV_API_KEYS --env production --path "$f" "api_key:<raw key>"
rm -f "$f"
```

Localhost uses the Worker's local store (the same flags `scripts/dev/localhost-up.sh` uses):
`--binding KV_API_KEYS --local --preview false --persist-to .wrangler/state`, run in `apps/ingest`.

## 4a. Server key for signed conversions (`--server`)

A host backend that posts server-confirmed conversions (FOLLOW-1203) needs its own key, with a
secret for signing:

```bash
… issue --tenant <tenant-uuid> --label "Estalara backend (signed)" --server [--confirm-production]
```

- The key is `est_srv_…`, `api_keys.type = 'secret'`. Default scope: `write:events`.
- The KV record carries a new `hmac_secret` (32 random bytes, hex). That secret is stored only in
  the KV record and in the stdout block. Postgres never sees it.
- The KV record carries `allowed_origins: []`. A server caller sends no `Origin`, so the browser
  gate denies any browser use of a leaked server key, while signed server calls are unaffected.
- The host backend signs each request as `apps/ingest/src/auth.ts` specifies:
  `X-Estalara-Signature: hmac-sha256:<hex HMAC-SHA-256(hex-decode(hmac_secret), timestamp + "\n" + nonce + "\n" + body)>`,
  plus `X-Estalara-Timestamp` (unix ms) and a unique `X-Estalara-Nonce`. Keep the raw key and the
  secret in that backend's secret store, never on a page.

## 5. Rotate, revoke, list

```bash
… rotate --key-id <uuid> [--grace-hours 24] [--label "…"]
… revoke --key-id <uuid> [--reason "leaked"]
… list   --tenant <uuid>
```

- **rotate** mints a replacement key. It has the same tenant, type, scopes and origins, and a new
  `hmac_secret` for server keys. The script prints the new key once, with its KV record. The old row
  gets `rotated_at`, and then:
  - with `--grace-hours 0` (the default), `revoked_at` is set now;
  - with `--grace-hours N`, `expires_at` is set to now + N hours. A future `revoked_at` is never
    used, because every verifier treats any non-null `revoked_at` as dead.

  Order: write the new KV record (§4), deploy the new `PUBLIC_ESTALARA_API_KEY`, and once the grace
  ends, delete the old KV entry.

- **revoke** sets `revoked_at`. Running it again on a revoked key is a no-op. **Postgres verifiers
  reject the key immediately. Ingest keeps accepting it until its KV entry is deleted**, because
  ingest reads only KV:

  ```bash
  cd apps/ingest && pnpm exec wrangler kv key delete --binding KV_API_KEYS --env production "api_key:<old raw key>"
  ```

  The script cannot do this deletion. Postgres holds only the hash, and the KV key is the raw key.
  If the old raw key is lost, find its entry with
  `wrangler kv key list --binding KV_API_KEYS --env production --prefix api_key:est_pub_` and match
  the last four characters shown by `list`.

- **list** prints the id, type, `prefix…last4`, scopes, origins and the created / expires / rotated
  / revoked times to stderr. It never prints a hash or a raw key.

## 6. The embedding seed

`issue` calls `seedListingEmbeddingsForActivation` once after the commit, as the route did on every
activation. It embeds the listings named in the stored schema (`listing_ids`). If the tenant is
`DEMO_TENANT_ID`, it embeds the fixture manifest instead. It writes through
`POST /api/listings/embed` on the control plane at `NEXT_PUBLIC_APP_URL`.

- `embedding seed skipped: …` means it was not configured (no `INTERNAL_API_SECRET`, or no listings
  to seed). Exit 0.
- `failed>0` or `requeued>0` means **exit 2**. The key is valid. Do not re-issue. A requeued listing
  was handed to `POST /api/internal/listings/embed-seed`, which runs in the control plane, so this
  process cannot confirm it finished. Check the control-plane log. For the fixture manifest, re-run
  with `pnpm seed:listings` (same env), then verify with `pnpm db:assert:cosine`.

## 7. K2b integration proof (localhost; FOLLOW-1327 AC)

On a running localhost stack (`scripts/dev/localhost-up.sh`; the local DB on `127.0.0.1:5433`):

1. `DATABASE_URL_ADMIN=postgresql://supabase_admin:postgres@127.0.0.1:5433/postgres pnpm exec tsx apps/control-plane/scripts/issue-tenant-api-key.mts issue --tenant 00000000-0000-0000-0000-0000000000e2 --label k2b --allowed-origins http://localhost:5173 --additional`.
   `--additional` is needed because the local seed already holds a live public key.
2. Write the printed record into the local KV (§4, `--local` flags), then restart nothing. The
   Worker reads KV on every request.
3. Point the SDK at the new key (`PUBLIC_ESTALARA_API_KEY` in the Estalara app env, or the fixture's
   `data-api-key`) and load a page. Alternatively, send the event `POST` directly:
   `curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8787/v1/events -H 'Origin: http://localhost:5173' -H "X-Estalara-API-Key: <raw key>" -H 'Content-Type: application/json' --data @<one valid event batch>`
   → `2xx`. The same request with `Origin: https://evil.example` → `403`.
4. `revoke --key-id <id>`, delete the KV entry, repeat step 3 → `401`.
5. `pnpm --filter=@estalara/ingest test:integration:clickhouse` green.
