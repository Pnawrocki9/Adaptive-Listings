# Ingest Error Codes Runbook

**Service:** `estalara-ingest` (Cloudflare Worker, `apps/ingest/`) **Implemented in:** TICKET-019
**See also:** [Observability runbook](./observability.md)

Every error response from the ingest service uses the canonical JSON shape:

```json
{
  "error": {
    "code": "<machine-readable code>",
    "message": "<human-readable description>",
    "request_id": "<UUID, also in X-Request-ID header>",
    "details": { "<optional structured context>": "..." }
  }
}
```

Clients SHOULD inspect `error.code` for machine-readable classification and `error.request_id` when
filing a support ticket or searching logs.

---

## Error code reference

### `validation_failed` — HTTP 400

**When it occurs:**

- Request body cannot be read (connection dropped mid-stream).
- Request body is not valid JSON.
- The top-level `events` field is absent, is not an array, or is empty.
- `Idempotency-Key` header is present but malformed (too short, too long, or contains
  non-ASCII-printable characters — see `idempotency.ts`).

**Details fields (when present):**

| Field         | Type   | Description                                 |
| ------------- | ------ | ------------------------------------------- |
| `limit_bytes` | number | Maximum allowed body size (1,048,576 bytes) |

**Client action:**

Fix the request before retrying. This error is not transient; retrying the same malformed request
will produce the same result. Check the SDK version is current if you are seeing unexpected
`validation_failed` for well-formed events — this may indicate an `EventSchema` mismatch between SDK
and server.

---

### `unauthorized` — HTTP 401

**When it occurs:**

- `X-Estalara-API-Key` header is missing from the request.
- The provided API key does not exist in `KV_API_KEYS`.
- The KV namespace lookup fails (infrastructure error).
- An `X-Estalara-Signature` header is present but the HMAC does not match.
- The request has no browser `Origin` and no valid signature (FOLLOW-1201 — a server-side caller
  MUST sign; the page-visible api key alone is not identity).
- A signed request's `X-Estalara-Timestamp` is more than 5 minutes from the Worker's clock, or its
  `X-Estalara-Nonce` was already seen for this tenant within the last 10 minutes (replay).

**Details fields (when present):**

| Field    | Type   | Description                                                                                                                                                  |
| -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reason` | string | One of: `missing_key`, `unknown_key`, `kv_error`, `malformed_signature`, `signature_mismatch`, `stale_timestamp`, `replayed_nonce`, `unsigned_server_caller` |

**Client action:**

- `missing_key` / `unknown_key`: Include a valid `X-Estalara-API-Key` header. Public keys
  (`pk_live_xxx`) are embedded in the SDK at initialisation. Verify the key was copied correctly
  from the dashboard.
- `kv_error`: KV is temporarily unavailable. Retry with exponential backoff (the SDK does this
  automatically). If the error persists beyond 5 minutes, escalate to on-call (see
  [observability runbook](./observability.md)).
- `malformed_signature` / `signature_mismatch`: For server-side adapters — verify the HMAC secret
  matches what is stored in tenant config and that the signature is computed over
  `<X-Estalara-Timestamp>\n<X-Estalara-Nonce>\n<raw body>` (FOLLOW-1201 — not the body alone, and
  not re-serialised JSON). `malformed_signature` also means a signature was sent without its
  timestamp/nonce companions, or the api key record has no `hmac_secret` (a public key cannot sign).
- `unsigned_server_caller`: the request had no browser `Origin` and no signature. Browser SDK
  traffic always carries `Origin`; anything else must sign every request as above.
- `stale_timestamp`: re-sign with the current time (skew window ±5 min; check the producer's clock).
  `replayed_nonce`: a nonce is single-use for 10 minutes — generate a fresh one per request; a retry
  of a request that never got a response should reuse `Idempotency-Key`, not the nonce.

---

### `forbidden_origin` — HTTP 403 (FOLLOW-642)

**When it occurs:**

- The request carries a browser `Origin` header that is not permitted by the tenant's resolved
  origin policy (`apps/ingest/src/origin-gate.ts`). Enforced on `POST /v1/events` **before** any
  Redpanda/ClickHouse side effect. Requests with no `Origin` (server-side callers) skip the gate.

**Details fields (when present):**

| Field    | Type   | Description                   |
| -------- | ------ | ----------------------------- |
| `origin` | string | The rejected request `Origin` |

**Client action:**

Add the origin to the tenant's api-key KV record (`ApiKeyRecord.allowed_origins`) —
[BRAND_PROVISIONING §Step 6](./BRAND_PROVISIONING.md). If the origin is genuinely not yours, this is
the gate doing its job: a stolen api key used from another site.

---

### `origin_policy_unconfigured` — HTTP 403 (FOLLOW-658)

**When it occurs:**

- The tenant resolves to the `inherit` origin policy (its KV api-key record carries **no**
  `allowed_origins`) **and** it is not the tenant named by the Worker's `FIRST_PARTY_TENANT_ID`
  (compared canonicalized — trim + lower-case both sides, FOLLOW-678). `inherit` falls back to
  Estalara's _own_ env allow-list, so for any other brand it means the provisioning step that seeds
  the KV field never ran.
- Never fires when `FIRST_PARTY_TENANT_ID` is unset, blank, OR malformed — not a well-formed UUID
  once trimmed + lower-cased (guard disabled in all three cases — FOLLOW-658/678), nor for a tenant
  with an explicit list or an explicit `[]` (deny-all).
- **FIRING FOR THE FIRST-PARTY TENANT ITSELF (e.g. `app.estalara.com` traffic) is NOT this
  scenario** — it means `FIRST_PARTY_TENANT_ID` is set to a well-formed UUID that does **not** match
  the real first-party tenant id (a mistyped digit, or the wrong tenant's UUID pasted). This is NOT
  a benign default (FOLLOW-678): it 403s every first-party browser request. Fix: re-check the value
  against `tenants.id` for Estalara and re-run `BRAND_PROVISIONING.md` §Step 0's post-flip
  verification probe — do not just re-seed KV (§Step 6), which addresses the OTHER cause of this
  code and won't help here.

**Details fields (when present):**

| Field    | Type   | Description          |
| -------- | ------ | -------------------- |
| `origin` | string | The request `Origin` |

**Client action (operator, not the SDK):**

For an external brand missing its KV `allowed_origins`, seed the brand's api-key KV record —
`pnpm exec tsx apps/control-plane/scripts/project-allowed-origins.mts --tenant-id … --api-key … --apply`
— see [BRAND_PROVISIONING §Step 6](./BRAND_PROVISIONING.md). For the first-party tenant itself, see
the `FIRST_PARTY_TENANT_ID` mis-set case above instead. Either way this is a **provisioning / config
defect, not a client error**: retrying will not help. It is logged at Sentry level `error`
(`origin_policy_unconfigured`), unlike `forbidden_origin` which is a `warning`.

---

### `payload_too_large` — HTTP 413

**When it occurs:**

- `Content-Length` header declares a body larger than 1 MB (1,048,576 bytes).
- Actual request body after reading exceeds 1 MB.
- Batch contains more than 1,000 events.

**Details fields (when present):**

| Field         | Type   | Description                      |
| ------------- | ------ | -------------------------------- |
| `limit_bytes` | number | 1,048,576 — maximum body size    |
| `limit`       | number | 1,000 — maximum events per batch |

**Client action:**

Split the batch. The SDK buffers events and sends them in batches of at most 500 events by default.
If you are sending events from a server-side adapter, check the batch size before sending. The 1 MB
body limit is rarely hit in practice because a 1,000-event batch averages ~1 KB per event.

---

### `rate_limited` — HTTP 429

**When it occurs:**

The per-tenant sliding-window rate limiter (Durable Object, `rate-limiter.ts`) has determined that
accepting this batch would exceed the configured limit (default: 50,000 events per minute per
tenant).

**Details fields:**

| Field       | Type   | Description                                                |
| ----------- | ------ | ---------------------------------------------------------- |
| `limit`     | number | Configured events-per-minute limit for this tenant         |
| `remaining` | number | Remaining capacity in the current window (0 when rejected) |
| `reset_at`  | number | Epoch milliseconds when the window resets                  |

**Response header:** `Retry-After: <seconds>` is set on every 429 response.

**Client action:**

Back off and retry after `Retry-After` seconds. The SDK handles this automatically with jittered
exponential backoff. If your legitimate traffic consistently exceeds the limit, contact Estalara
support to increase the per-tenant cap.

---

### `redpanda_unavailable` — HTTP 503

**When it occurs:**

The Worker attempted to push validated events to Redpanda via the HTTP REST proxy (Pandaproxy) and
exhausted all retry attempts (up to 3, with backoff of 100ms / 500ms / 2,500ms). This can happen due
to:

- Redpanda cluster outage or maintenance window.
- Network partition between the Worker edge node and the Redpanda endpoint.
- Terminal 4xx from Pandaproxy (configuration mismatch — single attempt).

**Details fields:**

| Field             | Type   | Description                                                           |
| ----------------- | ------ | --------------------------------------------------------------------- |
| `attempts`        | number | Number of push attempts before giving up (1–3)                        |
| `upstream_status` | number | HTTP status from Pandaproxy (present when a TCP connection succeeded) |

**Client action:**

Retry using the `Idempotency-Key` header so duplicate delivery is avoided on server-side recovery.
The SDK includes automatic retry with idempotency keys. Check the
[observability runbook](./observability.md) for Redpanda health dashboards. Alert if
`redpanda_unavailable` sustained error rate exceeds 1% over a 5-minute window (SLO alert already
configured in Grafana Cloud).

---

### `internal_error` — HTTP 500

**When it occurs:**

An unexpected, unhandled exception propagated to the top-level `errorHandler` middleware. The full
stack trace is logged to the Worker's structured log sink and captured by Sentry with the
`request_id` as a tag.

**Client action:**

Retry with the `Idempotency-Key` header. If the error persists, file a support ticket with the
`request_id` from the response. The on-call engineer can look up the Sentry event using that ID.

**On-call action:**

1. Search Sentry for `request_id = <value from client>`.
2. Check structured logs: `request_id = <value>` in Grafana Cloud.
3. If the error is in the Redpanda path, consult the `redpanda_unavailable` section above.
4. If the error is in the auth or validation path, check for a bad deployment or schema mismatch.

---

## Idempotency notes

The ingest endpoint supports the `Idempotency-Key` request header (RFC 8959 recommendation). Key
requirements:

- Length: 32–128 characters.
- Character set: ASCII printable (0x20–0x7e).
- Recommended format: UUID v4 or v7 generated client-side per batch.

On cache hit (within the 24-hour deduplication window) the server returns the original response body
verbatim with an `Idempotency-Replay: true` response header. Only 2xx responses are cached — error
responses are never cached so the client can fix the request and retry without waiting for TTL
expiry.

**Consistency caveat:** The KV-backed deduplication store is eventually consistent. Two concurrent
requests with the same key may both be processed (last-writer-wins on the cache entry). This is
acceptable for at-least-once delivery; ClickHouse handles per-event deduplication downstream via
`ReplacingMergeTree` on `event_id`. If exactly-once semantics are required at the ingest layer, a
Durable Object-backed idempotency store (Sprint 7+) is the upgrade path.

---

## Escalation path

| Condition                                   | Action                                     |
| ------------------------------------------- | ------------------------------------------ |
| `kv_error` sustained > 2 min                | Page on-call, KV namespace may be degraded |
| `redpanda_unavailable` rate > 1% over 5 min | Page on-call, check Redpanda health        |
| `internal_error` rate > 0.1% over 5 min     | Page on-call, check Sentry                 |
| Any sustained 5xx from ingest               | Activate incident runbook                  |
