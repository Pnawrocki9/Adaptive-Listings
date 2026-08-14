# Ingest Worker — verified production deploy (FOLLOW-690)

**Status:** executed end-to-end 2026-07-26 (session 61, CEO at the keyboard for every mutation).
Every step below was actually run that day — nothing here is aspirational (Rule AH). Context and
evidence for WHY this was needed: ESC-043 in `backlog/ESCALATIONS.md` (prod ran 2026-05-29 code for
two months; 14 merged ingest commits were not live).

## Operator model

All commands run from `apps/ingest/`. Wrangler is authenticated headless — there is no
`wrangler login` on this machine:

```bash
doppler run --project estalara-adaptive-listings --config prd -- npx wrangler <cmd>
```

(`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` live in Doppler `prd`; token acts as
piotr@estalara.com.)

## 1. Pre-flight (read-only — do ALL of it before any mutation)

1. **What changed since the running binary:**
   `git log -p --since=<last-deploy-date> -- apps/ingest/wrangler.toml` → enumerate every binding
   added. Cross-check the `Env` type in `apps/ingest/src/types.ts` — every binding/secret the code
   requires must have a source (toml var, account resource, or `wrangler secret list`).
2. **Account resources:** `wrangler kv namespace list` (ids must match toml),
   `wrangler queues list`, `wrangler secret list --env production`. Optional secrets that degrade
   gracefully when absent (verified in code 2026-07-26): `SENTRY_DSN_INGEST` (Sentry no-op),
   `MODAL_CHAT_NLP_URL` (chat-NLP dispatch skipped), `REDPANDA_*` (skipped when `REDPANDA_REST_URL`
   var is `""`).
3. **Record the rollback target:** `wrangler deployments list --env production` → note the current
   100% Version ID verbatim.
4. **Live-traffic sample:** `wrangler tail --env production` for 3–5 min; record origins seen. If
   real traffic arrives from an origin outside the allow-list about to be enforced, STOP — that is a
   CEO call.
5. Build workspace deps (`pnpm --filter @estalara/shared build`) and confirm `git status` is clean
   for `apps/ingest` + `packages/shared` against `origin/main`.

## 2. Missing account resources

2026-07-26 finding: the queues `estalara-events-retry` / `estalara-events-retry-dlq` (required since
FOLLOW-482, #449) did not exist — the account had zero queues.

**Trap:** `wrangler queues create` on the repo-pinned wrangler **3.114** fails with
`The specified queue settings are invalid.` — the old client sends a request shape today's API
rejects. Queue creation is client-agnostic (it is just an account resource), so use wrangler 4
ad-hoc for this ONE command; the deploy itself works fine on 3.114:

```bash
doppler run --project estalara-adaptive-listings --config prd -- npx --yes wrangler@4 queues create estalara-events-retry
doppler run --project estalara-adaptive-listings --config prd -- npx --yes wrangler@4 queues create estalara-events-retry-dlq
```

Queue creation is purely additive — the running Worker does not see it.

## 3. Staged deploy

```bash
doppler run --project estalara-adaptive-listings --config prd -- npx wrangler deploy --env staging
doppler run --project estalara-adaptive-listings --config prd -- npx wrangler deploy --env production
```

- **2026-08-07 (FOLLOW-878 / ESC-052 RESOLVED, CEO option 2):** re-verified, still accurate — and
  now permanent. Localhost-first is official for the data plane, so a real staging is not coming;
  Doppler `stg` was byte-identical to `prd` and is retired by FOLLOW-873. Note the `--config prd` in
  the command above is not a typo: it is the only config that carries `CLOUDFLARE_*`.
- Staging is a **bundle/API smoke only**: `[env.staging]` deliberately declares no KV/DO/queue
  bindings (wrangler envs do NOT inherit them — the warnings are expected), and
  `ingest-staging.estalara.com` has no DNS record. A green `Uploaded`+`Deployed` is the whole
  signal.
- On the production output, EYEBALL the bindings list before calling it done: both KV namespaces,
  `RATE_LIMITER`, both queue producers AND `Consumer for estalara-events-retry`, route
  `ingest.estalara.com/*`. Record the new Version ID.

## 4. Post-deploy behavioral probes (the standing regression tests)

Zero-persistence by construction: the event `type` `page_view` is deliberately invalid (real is
`page.view`), so a request that passes every gate is still rejected by schema validation and writes
nothing.

**Probe B — origin gate live + first-party classification correct:**

```bash
curl -s -X POST https://ingest.estalara.com/v1/events \
  -H "Content-Type: application/json" -H "X-Estalara-API-Key: 000-app-estalara" \
  -H "Origin: http://localhost:5173" \
  -d '{"events":[{"type":"page_view","session_id":"diag-probe","ts":"2026-01-01T00:00:00.000Z"}]}'
```

MUST return 403 `forbidden_origin`. Failure modes: reaches schema validation = the origin gate is
not deployed; 403 `origin_policy_unconfigured` = `FIRST_PARTY_TENANT_ID` mis-set (the guard
mis-classifies Estalara as external) → roll back.

**Probe C — first-party traffic passes:**

Same curl with `-H "Origin: https://app.estalara.com"` → MUST pass both gates and be rejected ONLY
by `Invalid discriminator value` schema errors (`accepted:0, rejected:1`). ANY 403 here =
first-party traffic is being dropped → roll back immediately.

Fingerprint check: the discriminator list in probe C's response reflects the deployed schema —
post-#595 code lists `live.signup` / `intent.snapshot` / `adapt.description.*`; the 2026-05 binary
did not. A longer list is direct proof the new bundle is serving.

## 5. Rollback

```bash
doppler run --project estalara-adaptive-listings --config prd -- npx wrangler rollback --env production
```

Execute immediately on: probe C returning any 403, `/health` non-200, or
`origin_policy_unconfigured` firing for the first-party tenant. Roll back first, debug after.

## Executed 2026-07-26 — record

| Item                   | Value                                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| Old (rollback) version | `6b943785-2d32-4ace-b76e-580d950ed662` (2026-05-29 code + later secrets) |
| New version            | `e64dd0c3-89ef-44a7-849c-47a4883ea6a6`                                   |
| Queues created         | `estalara-events-retry`, `estalara-events-retry-dlq` (via wrangler@4)    |
| Pre-deploy traffic     | 2 samples (45s + 4min): zero requests                                    |
| Probe B before / after | reached schema validation / **403 `forbidden_origin`**                   |
| Probe C                | schema-only rejection, `accepted:0` — first-party passes                 |
| Rollback needed        | no                                                                       |

## Sentry signal register — every named alarm this Worker raises [FOLLOW-937]

**Read this before assuming the Worker is observable.** All **thirteen** signals below are **INERT
in production**, for three independent reasons, any one of which is sufficient:

1. `SENTRY_DSN_INGEST` is unset in prod, and `apps/ingest/src/observability.ts` returns the
   **un-instrumented** handler when the DSN is falsy — so `captureMessage` is a no-op, not a delayed
   send. **This is OBSERVED, not asserted (FOLLOW-944 AC(4)); the measurement, its command and its
   re-take trigger live in the register as [MP-005]:**

   ```
   $ cd apps/ingest && doppler run -- npx wrangler secret list --env production
   [ { "name": "CLICKHOUSE_PASSWORD", "type": "secret_text" },
     { "name": "CLICKHOUSE_USER",     "type": "secret_text" },
     { "name": "FIRST_PARTY_TENANT_ID", "type": "secret_text" } ]
   ```

   Three secrets; **`SENTRY_DSN_INGEST` is absent.** ⚠️ `--env production` is load-bearing: the
   top-level `name` in `wrangler.toml` is `estalara-ingest`, which does **not** exist on the
   account, so a bare `wrangler secret list` answers _"This Worker does not exist"_ and reads like a
   broken setup rather than a wrong flag. Re-run this probe and update the date rather than trusting
   the sentence above it.

2. `apps/ingest/wrangler.toml` declares neither `logpush` nor `tail_consumers`, so the `logger`
   fallback only reaches somebody actively holding a `wrangler tail`. **(Corrected 2026-08-12,
   FOLLOW-944 AC(3): this reason used to be false for `consent_gate_rejected`, which had NO logger
   line at all — its only non-Sentry trace was the per-event entry in the HTTP `rejected[]` array,
   which goes to the CALLER, never to an operator. The compliance-relevant signal was the least
   observable of the five. A `logger.warn` was added, so reason 2 is now true of all thirteen.)**
3. There is no automated prod deploy for this Worker (FOLLOW-938), so the newest signals may not be
   running at all.

| signal                            | fires when                                                                                  | consumer              |
| --------------------------------- | ------------------------------------------------------------------------------------------- | --------------------- |
| `first_party_tenant_id_malformed` | `FIRST_PARTY_TENANT_ID` is set but unparseable — the origin gate is degrading               | **none** (FOLLOW-693) |
| `origin_policy_unconfigured`      | a non-first-party tenant has no origin policy; requests are refused fail-closed             | **none**              |
| `origin_gate_rejected`            | a browser `Origin` was refused for the resolved tenant                                      | **none**              |
| `consent_gate_rejected`           | a profiling-class event was dropped because `consent_state` grants no lawful basis          | **none**              |
| `schema_rejected`                 | a batch carried events failing `EventSchema`; `has_consent_event` marks the compliance case | **none**              |

Raised as `captureException(new Error('name'))` — **all eight were already shipping and none was
visible to the register** until FOLLOW-944 widened its detector:

| signal                                    | fires when                                                                          | consumer |
| ----------------------------------------- | ----------------------------------------------------------------------------------- | -------- |
| `clickhouse_push_failed_post_ack`         | ClickHouse dropped a batch AFTER the client was ACKed — the event is lost, no retry | **none** |
| `intent_snapshot_clickhouse_rejected`     | ClickHouse refused an intent snapshot; the session projection is incomplete         | **none** |
| `intent_snapshot_clickhouse_write_failed` | the snapshot ClickHouse write threw (network/transport) rather than refusing        | **none** |
| `intent_snapshot_supabase_rejected`       | Supabase refused the intent-session upsert; a later read may see a stale archetype  | **none** |
| `intent_snapshot_supabase_write_failed`   | the intent-session upsert threw (network/transport) rather than refusing            | **none** |
| `events_retry_message_malformed`          | a queued retry message could not be parsed — the batch it carried is dropped        | **none** |
| `events_retry_unknown_schema_version`     | a retry message carried an unknown schema version — producer/consumer deploy skew   | **none** |
| `events_retry_reinsert_failed`            | the retry consumer could not re-insert a batch — this is the END of the retry path  | **none** |

**"Consumer: none" is a recorded decision, not an oversight** — that is FOLLOW-937 AC(2). Naming it
here is what keeps the next reader from mistaking a producer for observability.

**This table is enforced.** `apps/ingest/src/observability-signals.test.ts` fails if a signal is
produced in the source and missing here, if a row names a signal nothing produces, if the probe
command above disappears, or if the `observed <date>` stamp is removed. A fourteenth signal cannot
be added silently in either shape.

**What changed in the enforcement, and why (FOLLOW-944).** The gate used to assert that this file
contained the sentence _"`SENTRY_DSN_INGEST` is unset in prod"_. That is a doc substring standing in
for a state: set the Cloudflare secret without editing this markdown — the likely order, since they
live in different systems — and the gate stayed green while every `consumer: none` above was false.
It could only go red once somebody already knew enough to edit the doc. It now requires the PROBE
and a DATE instead, because a repo test cannot read a Worker secret (Rule AU item 3) but it can
refuse to let the claim be unreproducible.

**Known residual, stated rather than papered over:** a signal introduced as
`captureMessage(SOME_CONST, …)` or with a template-literal name would still evade the detector.
There are zero such sites today (measured 2026-08-12).

**To arm the channel:** set `SENTRY_DSN_INGEST`, deploy, then verify by OBSERVING a signal arrive in
staging — do not conclude from the code that it would. Then revisit every `consumer` cell above.

## Known follow-ups (out of scope here)

- `SENTRY_DSN_INGEST` is unset in prod → the FOLLOW-658 guard's Sentry alerting channel is mute
  (guard still 403s; it just cannot page anyone). Set the secret to arm it. **This mutes all
  thirteen signals in the register above, not only the FOLLOW-658 guard's.**
- No production deploy **pipeline** exists (`deploy-staging.yml` is manual, staging-only, never
  green) — ESC-043 required-action item 4, a separate decision.
- FOLLOW-678 (canonicalize the `FIRST_PARTY_TENANT_ID` comparison — trim + lower-case both operands,
  reject/degrade-to-unset a malformed env, warn once per isolate) is fixed in code as of this
  entry's follow-up PR; re-run Probe B + C after any FIRST_PARTY_TENANT_ID change regardless — they
  remain the standing regression test for a WRONG-but-well-formed value, which is still not
  distinguishable from an intentional `explicit` scoping by construction (see
  `BRAND_PROVISIONING.md` §Step 0's post-flip verification, added by the same ticket).
