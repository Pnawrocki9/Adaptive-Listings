# Local pilot environment — SDK on a localhost listing page [FOLLOW-816]

Reproducible bring-up of the Adaptive Listings critical path against a **local** copy of the pilot
listing page. This is the substrate FOLLOW-818 and FOLLOW-819 run on, and it is the stage the
project is deliberately in: localhost-first validation, with the production deploy as an explicit
exit gate (FOLLOW-820 / ESC-020 Resolution, CEO 2026-06-10). Nothing here touches production.

Written by someone who had the environment in front of them; every command below was executed and
every hop verdict in §6 is a pasted observation, not a claim.

---

## 0. What this is, and what it is not

|            |                                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Is**     | A real Chromium driving the real SvelteKit listing page, loading the real built SDK bundle, POSTing to the real ingest Worker (`wrangler dev`), which writes to a real ClickHouse 25.8 with the real migration chain applied. |
| **Is not** | A staging environment. **A genuine staging ingest / ClickHouse does not exist** — see §7. The decision endpoint is the local mock (`scripts/dev/mock-decision-server.mjs`), not the Decision API.                             |
| **Is not** | A CI test. It needs five external processes CI does not have. `scripts/dev/local-pilot-session.mjs` is deliberately in `scripts/dev/`, not in a `*.spec.ts`.                                                                  |

---

## 1. Which tree, which commit

The Estalara-app side is **local-only** — no GitHub remote, and nothing in it may be committed,
branched or pushed. Two candidate trees exist on this machine; they are not interchangeable.

| Tree                                               | Verdict                                                                                                                                                                                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/home/asipi/Projects/Estalara-app-new/web-master` | **Use this one.** Current snapshot (files dated 2026-07-11/12), carries `brands/`, `publicEnv.ts`, the Vitest suite, and a `.svelte-kit` build. Its `core-master/src/main/resources/application-dev.properties` was set up 2026-07-11. |
| `/home/asipi/Projects/Estalara-app/web-master`     | Older 2026-05-31 snapshot, kept for its `HANDOFF_ESTALARA_ADAPTIVE.md` and as the only tree with git history (`9d2df9d`). Do not run it.                                                                                               |

`Estalara-app-new` is **not a git repository**, so there is no commit to name. Proved-state is
recorded by content hash instead (`sha256sum`, first 16 hex chars):

```
ab4ec92d2f9e4158  src/routes/(buyer)/[lang]/listing/[slug]/+page.svelte
fb1708b9f63e4378  src/app.html          # carries the dev-only override — see §4
ff797a3043023c37  .env
```

> **Correction to the FOLLOW-816 stub.** The stub states "the committed `web-master` HEAD already
> contains these edits behind `PUBLIC_ESTALARA_SDK_ENABLED`". It does not. In the only tree that has
> git at all (`Estalara-app`), the slot edits are **uncommitted working-tree modifications** —
> `git show HEAD:'src/routes/(buyer)/[lang]/listing/[slug]/+page.svelte' | grep -c data-estalara`
> returns `0`. The edits exist only as untracked local state in both trees and would be lost by a
> `git checkout .` or a fresh unzip.

### Slots actually present

Three elements, four attributes — **there is no CTA slot** in either tree, contrary to the stub's
"four A1 slot edits (`data-estalara-listing-id` + headline + description + CTA slots)":

```text
# three separate, non-nested elements — opening tags only, verbatim from the SSR'd HTML
<div class="max-w-7xl mx-auto …" data-estalara-listing="" data-estalara-listing-id="839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c">
<h1  class="order-4 md:order-none …"  data-estalara-slot="headline">
<div class="text-base text-gray-700 …" data-estalara-slot="description">
```

The slot attributes are gated on `PUBLIC_ESTALARA_SDK_ENABLED === 'true'` (`.env:36`). The SDK
`<script>` in `app.html` is **not** gated — it loads on every page regardless of the flag.

---

## 2. Prerequisites

Docker, Java 21, Node ≥ 22, pnpm 9, and a Doppler login with access to `estalara-adaptive-listings`
config `dev` (only for the mock decision server's `ANTHROPIC_API_KEY`; without it the mock serves
fallback copy and the environment still comes up).

---

## 3. Bring-up

Six processes. Order matters only in that ClickHouse must be migrated before the ingest Worker
starts writing, and the mock server must be up before the browser loads the page.

### 3.1 App stack containers (Postgres / Keycloak / MinIO / Redis)

```bash
cd /home/asipi/Projects/Estalara-app-new
CF=infrastructure-master/dev/docker-compose.combined.yaml
docker-compose -p dev -f "$CF" up -d
```

If the containers already exist from a previous session, `up -d` fails with a name conflict — start
them instead, which is the normal post-reboot path:

```bash
docker start estalara_postgres estalara_keycloak estalara_minio estalara_redis
```

Verify the seeded listings are present (they are the fixtures the whole run depends on):

```bash
docker exec estalara_postgres psql -U myuser -d estalara -t \
  -c "select slug, status from listing order by id limit 10;"
```

Expect four `ACTIVE` rows. If empty, seed them:
`docker exec -i estalara_postgres psql -U myuser -d estalara -v ON_ERROR_STOP=1 < infrastructure-master/dev/seed_listings.sql`.

### 3.2 Backend (Spring Boot, :8081)

```bash
cd /home/asipi/Projects/Estalara-app-new/core-master
( setsid bash -c "./gradlew bootRun --args='--spring.profiles.active=dev' \
    > /tmp/estalara-backend.log 2>&1" < /dev/null & )
```

Ready when `curl -s localhost:8081/actuator/health` returns `{"status":"UP"}` — roughly 40 s.

### 3.3 Frontend (SvelteKit, :5173)

```bash
cd /home/asipi/Projects/Estalara-app-new/web-master
( setsid bash -c "pnpm dev > /tmp/estalara-frontend.log 2>&1" < /dev/null & )
```

Dev login, if the UI is needed interactively: `peter@estalara.com` / `Estalara123!`.

### 3.4 Mock decision server (:9100) — serves the SDK bundle too

Build the bundle first; the mock serves it from `packages/sdk/dist/`:

```bash
cd <adaptive-listings>
pnpm --filter @estalara/shared build && pnpm --filter @estalara/sdk build
doppler run -p estalara-adaptive-listings -c dev -- node scripts/dev/mock-decision-server.mjs
```

Verify: `curl -s localhost:9100/mock/status` and
`curl -so /dev/null -w '%{http_code}\n' localhost:9100/estalara-sdk.iife.js` → `200`.

### 3.5 ClickHouse (:8123) — the real schema, applied locally

Same image and the same `LOCAL=1` path CI uses, so a divergence here is a divergence CI would also
see:

```bash
docker run -d --name estalara_ch_local -p 8123:8123 \
  -e CLICKHOUSE_USER=default -e CLICKHOUSE_PASSWORD=clickhouse \
  clickhouse/clickhouse-server:25.8

cd <adaptive-listings>
LOCAL=1 CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_PASSWORD=clickhouse \
  ./infra/clickhouse/scripts/migrate.sh
```

Expect nine objects created, including `events`, `intent_events`, `adaptation_decisions`.

### 3.6 Ingest Worker (:8787) — real Worker, local KV/DO/queues

Secrets go in `apps/ingest/.dev.vars` (gitignored by this ticket — **never commit it**):

```bash
cd <adaptive-listings>/apps/ingest
printf 'CLICKHOUSE_USER = "default"\nCLICKHOUSE_PASSWORD = "clickhouse"\n' > .dev.vars
```

Seed the api-key → tenant record the Worker authenticates against. `--preview false` is required:
the binding declares both an id and a preview id and wrangler refuses to guess.

```bash
npx wrangler kv key put --binding KV_API_KEYS --local --preview false \
  --persist-to .wrangler/state "api_key:pilot-key" \
  '{"tenant_id":"839ecbd1-0000-4000-8000-000000000001","scopes":["write:events"],"label":"FOLLOW-816 local pilot","allowed_origins":["http://localhost:5173"]}'

npx wrangler dev --local --port 8787 --persist-to .wrangler/state \
  --var ENVIRONMENT:development CLICKHOUSE_URL:http://localhost:8123 CLICKHOUSE_DATABASE:default
```

Verify: `curl -s localhost:8787/health` →
`{"status":"ok","service":"estalara-ingest","environment":"development"}`.

Two traps worth stating, because both fail _closed_ and look like SDK bugs:

- `allowed_origins` semantics are three-state. `[...]` allows exactly those origins, `[]` denies
  **every** cross-origin browser request, absent/`null` inherits the env list.
  `http://localhost:5173` is in the inherited dev list (`origin-gate.ts` `DEV_EXTRA_ORIGINS`) only
  while `ENVIRONMENT !== 'production'`.
- `ENVIRONMENT` must not be `production`, or the same request 403s with `forbidden_origin`.

---

## 4. The dev-only `app.html` override — NOT COMMITTED

`Estalara-app-new/web-master/src/app.html` points the SDK at localhost. This is a **local dev
override and must never reach any Estalara-app branch or deploy.** The tree has no git remote, so
there is nothing to accidentally push — but a future `git init`, a zip re-export, or a copy into a
tree that _does_ have a remote would carry it. ESC-020 already flags this trap.

Local (dev-only):

```html
<script
  src="http://localhost:9100/estalara-sdk.iife.js"
  data-api-key="pilot-key"
  data-tenant-id="pilot-tenant"
  data-decision-url="http://localhost:9100"
  data-ingest-url="http://localhost:8787/v1/events"
  data-debug="true"
  async
></script>
```

Production baseline, for diffing (`Estalara-app/web-master` git `9d2df9d`, `src/app.html`):

```html
<script
  src="https://admin.estalara.com/sdk.js"
  data-api-key="000-app-estalara"
  data-decision-url="https://admin.estalara.com/api"
  async
></script>
```

`data-ingest-url` pointing at `:8787` (the local ingest Worker) rather than `:9100` (the mock's
no-op 200 stub) is what makes hop 11 a real assertion instead of a stub echo. If it points at
`:9100`, every event is swallowed by a handler that returns 200 unconditionally and the run is
worthless.

Restore before any handover of the tree: revert `data-ingest-url` to the mock, or restore the whole
file from `git show 9d2df9d:src/app.html` in the sibling tree.

---

## 5. Run the scripted session

```bash
cd <adaptive-listings>
SESSION_JSON=/tmp/pilot-session.json node scripts/dev/local-pilot-session.mjs
# PASSES=4 lengthens the behavioral session; HEADLESS=false to watch it
```

Then read the data side, which the browser cannot see:

```bash
for t in events intent_events adaptation_decisions; do
  echo "$t: $(echo "SELECT count() FROM $t" | curl -s -u default:clickhouse http://localhost:8123/ --data-binary @-)"
done
```

---

## 6. Hop results as observed, and how each could have failed

Run of 2026-08-07 against the tree hashed in §1.

| Hop                            | Verdict   | Observation                                                                                                                             |
| ------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1 (hooks)                      | **GREEN** | 4 attributes on 3 elements — `data-estalara-listing`, `data-estalara-listing-id="839ecbd1-…"`, `slot="headline"`, `slot="description"`. |
| 1 (bundle)                     | **GREEN** | `GET http://localhost:9100/estalara-sdk.iife.js → 200`, 157 550 bytes; `window.Estalara` present.                                       |
| 4 (ingest ACK)                 | **GREEN** | 3/3 `POST http://localhost:8787/v1/events → 200`, Worker logged `events_accepted`.                                                      |
| 5 (decision call)              | **GREEN** | 3 × `POST http://localhost:9100/adapt → 200`.                                                                                           |
| 10 (floor)                     | **RED**   | peak confidence **0.3655**, floor **0.5**, only hint ever sent: `neutral`.                                                              |
| 10 (DOM applied)               | **RED**   | headline and description byte-identical before/after.                                                                                   |
| 11 (`intent.snapshot` emitted) | **GREEN** | census `{page.view:1, session.started:1, listing.viewed:2, scroll.depth:4, session.quality.snapshot:1, intent.snapshot:1}`.             |
| 11 (rows in ClickHouse)        | **RED**   | `events` 0, `intent_events` 0, `adaptation_decisions` 0. See §8.                                                                        |

How each hop could have failed, i.e. why these are assertions and not decoration:

- **hop 1 (hooks)** — fails if `PUBLIC_ESTALARA_SDK_ENABLED` is unset or the tree lacks the edits;
  the check counts live-DOM attributes and excludes the SDK's own `data-estalara-host` shadow host,
  so the SDK cannot satisfy its own assertion.
- **hop 1 (bundle)** — fails on a stale/absent `packages/sdk/dist` (the mock 500s with
  `SDK bundle not found`) or if the mock is down.
- **hop 4** — fails on an unseeded KV record (401 `unknown_key`), on `ENVIRONMENT=production` (403
  `forbidden_origin`), or if `data-ingest-url` still points at the mock (then the assertion passes
  against `:9100` and the check is meaningless — this is why the origin is asserted, not just the
  status).
- **hop 10** — fails whenever the archetype does not clear the floor; the assertion reads the floor
  off the SDK global rather than hardcoding `0.5`, so a change to `adapt-floor.ts` re-tunes it
  automatically.
- **hop 11 (emitted)** — the SDK emits `intent.snapshot` only every 5 behavioral signals; a shorter
  session yields zero and the check goes red.

**Negative control, executed rather than asserted.** A harness that reports green is only worth its
green if it can go red. The ingest Worker was killed and the identical command re-run:

```
$ kill $(ss -ltnp | grep ':8787' | grep -o 'pid=[0-9]*' | cut -d= -f2)
$ curl -s -m 3 http://localhost:8787/health          # → (no response)
$ node scripts/dev/local-pilot-session.mjs
[FAIL] hop 4 — SDK POSTed an event batch to ingest (http://localhost:8787) and got 2xx
5/8 hops green
```

6/8 → 5/8, and hop 4 flipped. The hop-4 assertion is load-bearing.

---

## 7. "Staging" does not exist — AC 2 is blocked, not deferred

FOLLOW-816 AC 2 asks for rows in **staging** `intent_events` and `adaptation_decisions`. Verified
against HEAD and against Doppler, there is no staging data environment to write to:

1. `apps/ingest/wrangler.toml` `[env.staging]` sets **`CLICKHOUSE_URL = ""`**. Empty URL trips the
   documented no-cred guard: events are validated and then **not persisted**. Even a reachable
   staging Worker writes zero rows by configuration.
2. `[env.staging]` declares **no KV, no Durable Object, no queue bindings**. Without `KV_API_KEYS`
   every request fails auth.
3. `ingest-staging.estalara.com` and `decision-staging.estalara.com` have **no DNS record**.
   `.github/workflows/deploy-staging.yml`'s own header says so and calls the workflow a
   "BUNDLE/UPLOAD SMOKE, not a test environment".
4. Doppler config `stg` contains **no `CLICKHOUSE_URL` / `CLICKHOUSE_USER` /
   `CLICKHOUSE_PASSWORD`**, no `ESTALARA_INGEST_URL`, no `ESTALARA_DECISION_API_URL`, no
   `FIRST_PARTY_TENANT_ID`. There is no staging ClickHouse service.
5. Doppler `stg.DATABASE_URL_ADMIN` is **byte-identical to `prd.DATABASE_URL_ADMIN`** (same sha256
   over the whole URL; same user, same `aws-0-eu-west-3.pooler.supabase.com`, same `postgres`
   database). "Staging Postgres" **is** production Postgres. See the escalation note in the
   FOLLOW-816 PR — this makes `db-migrate.yml`'s "staging first, then prod" gate non-protective.

The environment above therefore substitutes a **local** ClickHouse + a **local** ingest Worker. That
is strictly better than pointing the page at prod, and it is what actually exercised the schema
outside CI for the first time — which is where §8 came from. It is **not** a discharge of AC 2, and
this runbook does not claim it is.

---

## 8. Schema drift found — first exercise of the ClickHouse schema outside CI

**Every ClickHouse write from the real ingest path is rejected.** Two independent writers, one root
cause, and the browser sees HTTP 200 throughout because both writes are post-ACK.

`events` (`apps/ingest/src/clickhouse-producer.ts:134-135`):

```
Code: 27. DB::Exception: Cannot parse input: expected '"' before:
'Z","ingest_received_at":"2026-08-07T10:58:05.822Z",…' (while reading the value of key ts): (at row 1)
(CANNOT_PARSE_INPUT_ASSERTION_FAILED)
```

`intent_events` (`apps/ingest/src/handlers/intent-snapshot.ts`):

```
clickhouse_intent_events_status_400:Code: 27. DB::Exception: Cannot parse input: expected '"' before:
'Z","event_type":"intent.snapshot",…' (while reading the value of key event_at): (at row 1)
```

Root cause, proven by isolating the single variable:

- `events.ts` and `events.ingest_received_at` are `DateTime64(3, 'UTC')`; `intent_events.event_at`
  is the same family.
- The Worker serializes them with `new Date(ts).toISOString()` → `"2026-08-07T10:58:05.822Z"`.
- ClickHouse `date_time_input_format` defaults to **`basic`**, which rejects the trailing `Z`.
  Nothing in the repo sets it — `grep -rn 'date_time_input_format\|best_effort'` returns zero hits
  outside this document, and the insert URL (`clickhouse-producer.ts:178`) passes no settings.
- The identical byte-for-byte payload is **accepted** when the setting is flipped:

```bash
# rejected (server default)
curl -s -u default:clickhouse "http://localhost:8123/?query=INSERT%20INTO%20events%20FORMAT%20JSONEachRow" --data-binary "$P"
# → Code: 27 …
# accepted
curl -s -u default:clickhouse "http://localhost:8123/?date_time_input_format=best_effort&query=INSERT%20INTO%20events%20FORMAT%20JSONEachRow" --data-binary "$P"
# → (empty) ; SELECT count() FROM events → 1
```

**Why CI never caught it:** `infra/clickhouse/scripts/smoke-test.sh:61` inserts `"ts":${TS}` — an
unquoted numeric epoch. That parses fine under `basic`. **CI validates a payload format the
production writer never produces**, so the gate has been green against a shape no real request has.

Ownership: this is a data/ingest defect, not an SDK one, and FOLLOW-822 owns drift. It is reported
here rather than patched around, per the ticket. Whether ClickHouse **Cloud** overrides the default
in its server profile — which would mean prod is unaffected and only local/CI are — is the first
thing to check, and it is one query:

```bash
doppler run -p estalara-adaptive-listings -c prd -- bash -c \
  'echo "SELECT value FROM system.settings WHERE name = '"'"'date_time_input_format'"'"'" |
   curl -s -u "$CLICKHOUSE_USER:$CLICKHOUSE_PASSWORD" "$CLICKHOUSE_URL/" --data-binary @-'
# expect: best_effort  → prod unaffected, local/CI-only defect
# expect: basic        → prod ingest→ClickHouse writes have been failing post-ACK; P0
```

---

## 9. Why hop 10 is red, and what it is not

The SDK's DOM-apply path is **not** the problem. It is green in CI:
`pnpm --filter @estalara/sdk exec playwright test e2e/adapt-dom-mutations.spec.ts` → 6/6 passed,
including "headline textContent changes to yield_hunter directive value after SDK init". The mock
decision server also returns a well-formed directive when asked with a confident non-neutral hint:

```bash
curl -s -X POST localhost:9100/adapt -H 'content-type: application/json' \
  -d '{…,"archetype_hint":"yield_hunter","confidence":0.9,…}'
# → {"archetype":"yield_hunter","confidence":0.92,"directives":[{"type":"text","slot":"headline","value":"3-bed, 2-bath Palm Coast home—strong seasonal rental demand…"}]}
```

With `"archetype_hint":"neutral"` the same endpoint correctly returns `"directives":[]`.

The live session **never sent anything but `neutral`**. Peak confidence was `0.3655` against
`DOM_ADAPT_CONFIDENCE_FLOOR = 0.5`. And it is not a matter of browsing longer: a `PASSES=4` session
— four times the scrolling and gallery interaction — produced a **bit-identical** peak
(`0.36554663991975933`) and an identical event census. The behavioral observers saturate:
`scroll.depth` caps at 4 one-shot depth milestones and repeated gallery clicks contribute nothing.

So on this page the archetype confidence reachable from behavioral signals alone has a ceiling of
≈0.366 against a 0.5 floor — **structurally unreachable, not merely not-yet-reached.** That is the
FOLLOW-819 hypothesis, measured. Do not close hop 10 by injecting an archetype into the fixture; the
honest readings are "quiz or chat is required to cross the floor" or "the floor is miscalibrated for
behavior-only sessions", and choosing between them is FOLLOW-819 + FOLLOW-212 work.

---

## 10. Teardown

```bash
docker stop estalara_ch_local && docker rm estalara_ch_local
docker stop estalara_postgres estalara_keycloak estalara_minio estalara_redis
pkill -f 'wrangler dev'; pkill -f mock-decision-server; pkill -f 'vite dev'; pkill -f bootRun
rm -f <adaptive-listings>/apps/ingest/.dev.vars
```

Leave the Estalara-app tree's `app.html` restored per §4.

---

## Cross-references

ESC-020 · FOLLOW-818 (staging feedback flip) · FOLLOW-819 (differentiator E2E) · FOLLOW-820 (prod
gate) · FOLLOW-822 (schema drift) · `docs/runbooks/SDK_PRODUCTION_INTEGRATION.md` ·
`scripts/dev/README.md` · `Estalara-app-new/infrastructure-master/dev/LOCAL_DEV_RESUME.md`
