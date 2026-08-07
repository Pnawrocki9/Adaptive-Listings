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
| 10 (server gate)               | **RED**   | peak confidence **0.3655**, server gate **> 0.6** (`route.ts:86,275`), only hint ever sent: `neutral`. **Not** the SDK floor — see §9.  |
| 10 (DOM applied)               | **RED**   | headline and description byte-identical before/after — the endpoint returned `directives: []`.                                          |
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
- **hop 10 (server gate)** — fails whenever the confidence in the decision **response** does not
  clear the server-side `CONFIDENCE_THRESHOLD`. The assertion reads that threshold **and its
  comparison operator** out of `apps/control-plane/src/app/api/adapt/route.ts` at run time
  (`readServerConfidenceGate()`), and throws loudly if the constant is renamed — so it cannot
  silently drift, and it cannot go green where production would answer `[]`. It reports the SDK's
  own `aboveFloor` disjunction alongside as **evidence**, never as the pass condition (§9).
- **hop 10 (directives returned)** — fails when the decision response carries zero directives. This
  is the assertion with no threshold arithmetic in it at all, and the one a permissive mock cannot
  manufacture a green for: a `[]` response is the red whatever the confidence was.
- **hop 10 (DOM applied)** — fails when no `[data-estalara-slot]` text changed. Distinct from the
  two above: it is the only one that would catch directives that arrive but are never painted.
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

> **Counting note (FOLLOW-875).** Those `N/8` figures are counts of **assertions**, not of hops —
> the script carries two hop-1 sub-checks, one global check and, at the time of that run, two hop-10
> sub-checks over three hop numbers. FOLLOW-875 added a third hop-10 assertion ("the decision
> endpoint returned at least one directive"), so a re-run of the table above reports out of **9**,
> and the two hop-10 reds become three. Reporting hops and assertions as distinct counts is
> FOLLOW-876 AC(4); this note exists so the `6/8` quoted in QUEUE.md and two stubs is not read
> against the current script.

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

The live session **never sent anything but `neutral`**, and every `/adapt` response carried
`directives: []`. Peak confidence was `0.3655`. And it is not a matter of browsing longer: a
`PASSES=4` session — four times the scrolling and gallery interaction — produced a **bit-identical**
peak (`0.36554663991975933`) and an identical event census.

### 9.1 Which gate actually bit (corrected 2026-08-07, FOLLOW-875)

The measurement above is right and reproducible. The **attribution** in the first version of this
section was wrong on two independent axes, and neither touches the number.

**1. The SDK's apply gate is a DISJUNCTION, and it did not suppress anything.**
`packages/sdk/src/index.ts:827-829`:

```ts
const aboveFloor =
  resp.confidence >= DOM_ADAPT_CONFIDENCE_FLOOR || // 0.5
  currentIntentState.signal_count >= DOM_ADAPT_MIN_SIGNAL_COUNT; // 2
```

`signal_count >= 2` alone opens it. It was true within the first second of the session: the
init-time `device_type.*` prior at `index.ts:1031-1036` runs through `applyBehavioralSignal()`,
which **increments `signal_count`**, so the session begins at 1 and the first scroll-depth milestone
makes it 2. `applyDirectives()` ran. So did `applyDescriptionAdaptation()` — it lives inside the
same block (`index.ts:851-856`). The floor suppressed nothing.

**2. The gate that decides whether directives exist is server-side and 0.1 higher — and strict.**
`apps/control-plane/src/app/api/adapt/route.ts:86` sets `CONFIDENCE_THRESHOLD = 0.6`, applied at
`route.ts:275` as:

```ts
if (confidence <= CONFIDENCE_THRESHOLD) return { directives: [], source: 'default' };
```

Note `<=`. **The bar is strictly greater than 0.6**; a session at exactly 0.6 gets `[]`. The value
compared is the **client-sent** `body.confidence ?? 0.5` (`route.ts:1224,1278`) — i.e. this SDK's
own intent state, echoed back into `resp.confidence`. The SDK states this itself at
`index.ts:731-737`. The server boundary is locked by `route.test.ts:267`.

**Why this matters beyond bookkeeping:** a differentiator that reaches **0.55** clears the 0.5 floor
this section used to name, flips the local harness green against the permissive mock, and still
receives `directives: []` from the real endpoint. The old assertion could manufacture a green
production would not honour. That is why hop 10 now asserts, against the threshold read out of
`route.ts` at run time, **both** sides of the exchange plus `directives.length > 0`.

> **Fidelity gap, found by running the corrected harness rather than by reading it (2026-08-07).**
> Production `route.ts` gates on the client-sent `body.confidence` and **echoes it** into
> `resp.confidence`, so on production the request and response numbers are the same. **The local
> mock does not echo it** — on a `neutral` hint it answers a fabricated `confidence: 0.1`
> (`scripts/dev/mock-decision-server.mjs:519`). An observed run: request **0.3655**, response
> **0.1**. So a response-only assertion measures the mock's fiction and a request-only assertion
> ignores the value `index.ts:828` reads. Hop 10 requires both to clear the gate. Add this to §0's
> "what this is not" list when reading any confidence number off a local run.

The conclusion **survives intact**: `0.3655 < 0.5 < 0.6`, so behavior alone did not adapt the DOM on
this page. Only the bar changed.

**Other conditions that empty `directives` before confidence is ever consulted** — not gates that
fired here, but load-bearing for anyone designing a session that must go green: per-tenant AL
OFF/suspended (`route.ts:1272-1287`), `?profiling_opt_out=1` (`route.ts:1210-1232`), the A/B holdout
arm, and the consent-skip gate for non-`granted` sessions. A FOLLOW-819 session must be
consent-granted, on an AL-enabled tenant, not opted out, and not in the holdout arm — otherwise the
confidence question never gets asked.

### 9.2 What 0.3655 actually is, and whether `> 0.6` is reachable (FOLLOW-875 AC-5)

**0.3655 is not a behavioral ceiling. It is the cold-start value, reached before the first
behavioral event, and behavior only pushed it down.**

Confidence in this engine is the posterior probability of the argmax archetype
(`classifyFromProbabilities` returns `maxProb`, `core/intent.ts:825`), with a ×1.2 bonus applied
only when the quiz has been answered (`withConfidenceBonus`, `:709-712`).
`BASE_PRIOR.neutral = 0.37` (`core/intent.ts:206`). The observed peak reproduces **bit-exactly**
from BASE_PRIOR under a single update — the `device_type.desktop` prior, damped by
`BEHAVIORAL_DAMPING = 0.3` (`packages/sdk/src/core/intent.ts:549`; the FOLLOW-875 stub's
`intent.ts:164` citation is a mis-reference — `:164` is the FOLLOW-212 calibration note on
`SWITCH_MARGIN`):

```
damped[k] = 1 + (SIGNAL_LIKELIHOODS['device_type.desktop'][k] - 1) × 0.3
posterior  = normalize(BASE_PRIOR × damped)
posterior.neutral = 0.36445 / 0.997 = 0.36554663991975933   ← identical to all 16 digits
```

So the peak was the **argmax of `neutral`** at the very first `/adapt` call. Every subsequent
behavioral signal lowered it: the reachable signals on a listing-detail page (`scroll.depth`,
`listing.viewed`) carry `neutral < 1.0` and `1.0` for the other seventeen, which bleeds mass off
`neutral` and spreads it evenly — flattening the distribution toward uniform (1/18 = 0.0556) without
ever producing a leader. `PASSES=4` was bit-identical for a stronger reason than saturation: the
peak is set at t=0 and more browsing cannot raise it.

**Independently confirmed on a different page.** While validating the corrected harness (2026-08-07)
the same script was pointed at a throw-away fixture page — a bare HTML file with the three slot
attributes and none of the pilot listing's content — served on `:9200` against the same mock. It
produced the identical peak, `0.36554663991975933`. A number that reproduces bit-for-bit across two
unrelated pages is not a property of the pilot listing; it is the cold-start prior.

**There is also a fixed point.** `applyDwellSignal` — the only real reinforcement mechanism
available on a detail page — returns the state unchanged while `archetype === 'neutral'`
(`core/intent.ts:1694`). Nothing on this page can create the non-neutral leader that dwell would
then reinforce.

**The judgement, stated plainly.** Clearing `> 0.6` from behavior alone is:

- **Not reachable on this page, in any session length.** Simulating the damped Bayesian update over
  the signal set this page emits: repeated `listing.viewed` needs **47** events merely to unseat
  `neutral` past the `SWITCH_MARGIN = 0.05` hysteresis, and **139** to exceed 0.6 — before the
  0.02/min decay toward uniform, which pulls the other way. On a single listing detail page this is
  not a long session, it is a different product.
- **Reachable in principle, off this page, via the two paths that bypass the damping.**
  `filter.applied` boosts the posterior **additively and undamped** (`applyFilterBoosts`,
  `core/intent.ts:911-966`): **7** same-facet events reach 0.640. `feature.expanded` applies an
  undamped multiplicative boost (e.g. `remote_worker *= 1.4`, `core/intent.ts:1117`): **11** events
  reach 0.651. Neither is emitted by a listing-detail page with no search/filter UI, which is why
  the measured session never saw them.
- **Therefore: for the pilot page as it exists today, quiz or chat input is required.** Quiz-leaf
  resolves at `min(0.85 × 1.2, 1.0) = 1.0` (`core/intent.ts:1321`) and clears the bar outright.

**Scope this claim precisely (FOLLOW-875 AC-3).** What was measured is: _one_ page, _five_
interaction types, several of which saturate by construction (`scroll.depth` = 4 one-shot
milestones; repeated gallery clicks contribute nothing), under `BEHAVIORAL_DAMPING = 0.3` — an
explicitly **unvalidated** constant whose own docblock defers calibration to FOLLOW-212 ("calibrate
post-pilot once ≥500 labelled sessions are available"). **`0.3655` is the first empirical datum on
that constant**, and it says something narrower and more useful than "behavior cannot work": it says
that under damping 0.3 the _cold-start prior itself_ out-masses anything this page's signals can
build. Untouched discriminators exist — cross-listing `applyListingViewRate`, `filter.applied`,
`listing.bookmarked`, dwell past the session cap, referrer/UTM priors — and FOLLOW-212 may
legitimately conclude that 0.3 is simply too aggressive. **Do not quote "structurally unreachable"
as a property of the system.**

Do not close hop 10 by injecting an archetype into the fixture. The two honest readings remain "quiz
or chat is required on this page" and "the damping/threshold pair is miscalibrated for behavior-only
sessions" — choosing between them is FOLLOW-819 + FOLLOW-212 work, and it must be argued against
`> 0.6`, not against 0.5.

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
