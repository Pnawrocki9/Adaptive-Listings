# Estalara app patches

Changes to the real application (`~/Projects/Estalara-gitlab-2026-08-17`, a local checkout without
git), delivered as diffs so the CTO applies a diff and not a modified tree (plan Phase 5). The tree
on this machine already carries them; the snapshot taken before Phase 5 is the `tar.gz` of
2026-11-02 in `~/Projects/`, named `before-phase5`.

## `core-master`: signed conversions and the listing webhook (FOLLOW-1339, FOLLOW-1340)

`core-master-follow-1339-1340.patch` applies from inside `core-master` with
`patch -p1 < core-master-follow-1339-1340.patch`. It touches only `core-master`.

### What it does

| Trigger                                                                                                                                                                            | Sent                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A buyer newly registers for a live presentation: the register button (`CalendarServiceImpl.createLiveEnrollmentEvent`) or a first join (`LivestreamServiceImpl.joinLivestreamIVS`) | `live.signup` to `/v1/events`, signed; payload `slot_uuid` (the live's uuid), `event_kind: live_presentation`; `listing_id`       |
| A buyer starts a conversation with an active agent (`ConversationCreatedEvent` with `initiatorRole = BUYER`, `recipientRole = AGENT`)                                              | `inquiry.completed` to `/v1/events`, signed; payload `channel: conversation`                                                      |
| An agent saves a listing: every `PUT /listing`, and a `PATCH` that changes the price or the place or publishes the listing (status moves to `ACTIVE`)                              | `POST /api/webhooks/listing-updated` with `X-Webhook-Secret`, as a durable job; the control plane advances the listing's revision |

An active agent, or anyone who can manage the listing (a collaborator or agency admin, with or
without the agent role), emits no `live.signup`.

**The two conversions stay in memory, on purpose.** The session id must not be stored, so they get
no durable job. They run after commit on the bounded `adaptiveListingsExecutor` (2 threads, queue
100), with a 5 s deadline on each whole exchange and at most 3 sends. A re-send follows a 5xx, a
network failure or a 429, each freshly signed, and a 429's `Retry-After` is honoured up to 10 s. A
failure is one log line and never reaches registration or conversation creation. Log lines carry the
event type, a random event id, the status and the failure kind: never the session id, the login, the
key, the secret or the signature.

**The webhook is a durable job,** because it is the control plane's only change signal for a
permanent cache (`apps/control-plane/src/lib/description-pg-cache.ts`): a lost call means old copy
until the next save. The `LISTING_UPDATED_WEBHOOK` row is written in the save's own transaction
through the existing `async_job` table, with no migration. Each attempt makes up to 3 sends. A
failed attempt waits on the shared backoff (30 s doubling to 32 min) and is picked up by the
safety-net poller, so a retry can come up to 15 min after its backoff ends. The 12 attempts span at
least about 3 h, across a restart of either side. Then the job goes to `DEAD_LETTER`, the existing
admin alert fires, and it can be retried from the admin API.

### The session id comes in a header, and only on these requests

The buyer's session id lives in `sessionStorage['__estalara_session__']` of the tab (the SDK's own
value, per tab). The front end hands it over in one request header:

```
X-Estalara-Session-Id: <the SDK's sessionId>
```

- **Why a header and not a cookie.** A cookie would be a new cookie needing its own record in the
  compliance documents, would go on every request to the host rather than the two that convert, and
  would be shared across tabs, while the session is per tab and the holdout arm is keyed on it. DPIA
  states that the system never reads cookies.
- **No `xid`.** ESC-090 ruling 4: the cross-session id does not go on events. The event carries
  `session_id` only; lift stays per session.
- **The backend** reads the header on the request thread, validates it (32 to 64 chars of
  `[A-Za-z0-9-]`, otherwise it is treated as absent), holds it in memory for the one event and
  neither stores nor logs it. CORS allows the header.
- **Without a valid header nothing is sent.** The registration or conversation proceeds as normal,
  one `al_conversion_skipped reason=no_session` line is logged, and the conversion is not counted.
  It is never sent under a made-up session.

### What `web-master` must do

Without the header no conversion is ever emitted. The change is delivered separately as
`web-master-x1-conversion-header.patch` in this directory, on branch
`sdk-engineer/FOLLOW-1341-web-master-slots`. It adds `estalaraConversionHeaders()`, which returns
the header only while consent is granted (the SDK mints a session id on the denial path too), and
passes it at the conversion calls only, never from a shared interceptor.

### Configuration

The six `AL_*` values are env only, with no default. All empty means nothing is sent. A partly set
or malformed group, including an `AL_TENANT_ID` that is not a UUID, logs an error at startup, naming
the setting and never its value, and stays disabled.

| Env                                 | Property                                                                | Meaning                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `AL_INGEST_URL`                     | `adaptive-listings.ingest-url`                                          | Ingest origin; `/v1/events` is appended                                                                        |
| `AL_SERVER_API_KEY`                 | `adaptive-listings.server-api-key`                                      | A server key whose KV record carries `hmac_secret`; never the page-visible one                                 |
| `AL_SERVER_HMAC_SECRET`             | `adaptive-listings.hmac-secret`                                         | That record's `hmac_secret`, hex                                                                               |
| `AL_TENANT_ID`                      | `adaptive-listings.tenant-id`                                           | The single tenant's id, for the webhook body                                                                   |
| `AL_LISTING_UPDATED_WEBHOOK_URL`    | `adaptive-listings.listing-updated-webhook-url`                         | Full URL of `/api/webhooks/listing-updated`                                                                    |
| `AL_LISTING_UPDATED_WEBHOOK_SECRET` | `adaptive-listings.listing-updated-webhook-secret`                      | The control plane's `LISTING_UPDATED_WEBHOOK_SECRET`                                                           |
| `CALLER_SIGNED_COLUMN_ENABLED`      | Not core-master: `true` on both the ingest Worker and the control plane | Without it no row carries `caller_signed` and the lift reads `disabled`; needs ClickHouse migration 0024 first |

`setenv_linux.sh` and `setenv_win.bat` carry the names, empty.

On localhost the values are the ones `scripts/dev/localhost-up.sh` generates:
`AL_INGEST_URL=http://localhost:8787`, `AL_SERVER_API_KEY=pilot-server-key`, the secret from
`.localhost-up/fixture-server-hmac-secret`, the webhook secret from
`.localhost-up/listing-updated-webhook-secret`, tenant `00000000-0000-0000-0000-0000000000e2`. The
real backend takes `:8081` from the fixture server, so stop that one first.

### The signature vector

`src/test/.../adaptivelistings/SignedEventVectors.kt` (core-master) and
`apps/ingest/src/signed-conversions.test.ts` (this repository) hold byte-identical copies of the two
request bodies, the secret, the timestamp, the nonce and the three expected signatures. The Kotlin
test asserts the signer produces them and the builder produces those bodies; the ingest test runs
them through the real `computeHmacSha256Hex`, `authenticateRequest` and `EventSchema`. Change one,
change both.

### Known limits

- **Conversions undercount, in both arms.** Being in memory, a conversion is lost when the backend
  restarts before the send, when the executor's queue is full, when ingest stays down past the three
  sends, or when a 429 asks for more than 10 s. Each case but the restart leaves one log line
  (`al_conversion_dropped` or `al_conversion_failed`); a restart leaves none. The count can only
  read low, and nothing recovers a lost one, since keeping it would mean storing the session id.
- **Conversation creation is the click, not the message.** The front end calls
  `createOrFindConversation` when the buyer presses contact (`Agent.svelte`) or request-a-live-tour
  (the listing page), then navigates to the thread with a draft. The conversion therefore counts a
  buyer who opened the thread, whether or not a message followed. This is what D-J names
  (`ConversationCreatedEvent`); its gloss "the first message creates the conversation" does not hold
  in this code.
- **Only a new pair converts.** A buyer who has ever written to this agent gets the existing thread
  and no event, so a returning buyer's contact in a later session is not counted, in either arm.
- **The header is the buyer's own claim.** The signature proves the backend saw a real registration
  or conversation, not that the session id is the buyer's. A logged-in buyer could send someone
  else's session id. It needs a real account and a new pair or registration each time.
- **A re-scrape sends no signal of its own.** It rewrites the listing's text and leaves it `DRAFT`,
  so the bump comes when the listing is published again. A publish counts only as a transition:
  `status` is mandatory on every `PATCH`, and a photo reorder on a live listing says `ACTIVE` too.
- **The conversation event has no `listing_id`:** the request names the agent, not a listing. The
  lift does not read it; `live.signup` carries it.

### Checking it against a running Worker

`ConversionEventLiveIngestTest` sends both events through the real client when `AL_LIVE_INGEST_URL`,
`AL_LIVE_API_KEY`, `AL_LIVE_HMAC_SECRET` and `AL_LIVE_SESSION_ID` are set, and is skipped otherwise.
Then read the rows: `select type, caller_signed, payload from events where session_id = '<id>'`.
Both must read `caller_signed = 1`. The Worker must run a build of `@estalara/shared` that holds
this ticket's schema: an older one answers `accepted: 0` for `channel: conversation`.

## Applying and undoing

`patch -p1 --dry-run < core-master-follow-1339-1340.patch` first. Undo with `patch -R -p1 < …`, then
delete `src/main/kotlin/com/time2show/core/service/adaptivelistings/` and
`src/test/kotlin/com/time2show/core/unit/service/adaptivelistings/` if `patch` leaves them empty.
