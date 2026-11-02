# Estalara app patches

Changes to the real application (`~/Projects/Estalara-gitlab-2026-08-17`, a local checkout without
git), delivered as diffs so the CTO applies a diff and not a modified tree (plan Phase 5). The tree
on this machine already carries them; the snapshot taken before Phase 5 is
`~/Projects/Estalara-snapshot-2026-11-02-before-phase5.tar.gz`.

## `core-master`: signed conversions and the listing webhook (FOLLOW-1339, FOLLOW-1340)

`core-master-follow-1339-1340.patch` applies from inside `core-master` with
`patch -p1 < core-master-follow-1339-1340.patch`. It touches only `core-master`.

### What it does

| Trigger                                                                                                                                                                            | Sent                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A buyer newly registers for a live presentation: the register button (`CalendarServiceImpl.createLiveEnrollmentEvent`) or a first join (`LivestreamServiceImpl.joinLivestreamIVS`) | `live.signup` to `/v1/events`, signed; payload `slot_uuid` (the live's uuid), `event_kind: live_presentation`; `listing_id` |
| A buyer starts a conversation with an agent (`ConversationCreatedEvent` with `initiatorRole = BUYER`)                                                                              | `inquiry.completed` to `/v1/events`, signed; payload `channel: conversation`                                                |
| An agent saves a listing: every `PUT /listing`, and a `PATCH` that changes the price or the place                                                                                  | `POST /api/webhooks/listing-updated` with `X-Webhook-Secret`; the control plane advances the listing's revision             |

Everything runs after commit on an `@Async` thread, with a 2 s connect timeout, a 5 s request
timeout and at most 3 sends (re-sent only after a 5xx or a network failure, each freshly signed). A
failure is one log line and never reaches registration, conversation creation or the listing save.
Log lines carry the event type, a random event id, the status and the failure kind: never the
session id, the login, the key, the secret or the signature.

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

This patch does not touch `web-master`, and without the change below no conversion is ever emitted.

1. Add a helper that returns the header only while consent is granted. The SDK mints a session id
   even on the denial path (`consent-flow.ts` flushes the `consent.denied` audit event under one),
   so the presence of a session id is **not** proof of consent:

   ```ts
   /** Sent only on the two requests that convert; see docs/handover/estalara-app-patches/README.md. */
   export function estalaraConversionHeaders(): Record<string, string> {
     try {
       if (localStorage.getItem('estalara_consent') !== 'granted') return {};
       const raw = sessionStorage.getItem('__estalara_session__');
       const id = raw ? (JSON.parse(raw) as { sessionId?: unknown }).sessionId : undefined;
       return typeof id === 'string' ? { 'X-Estalara-Session-Id': id } : {};
     } catch {
       return {};
     }
   }
   ```

2. Pass it as the generated client's `options` argument at these calls and no others. Do not add it
   to a shared axios interceptor: it must not reach any other endpoint.

   | Call                        | File                                                                                                                                              |
   | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `createOrFindConversation`  | `src/lib/ui/listing/Agent.svelte`, `src/routes/(buyer)/[lang]/listing/[slug]/+page.svelte`, `src/routes/(buyer)/[lang]/agent/[slug]/+page.svelte` |
   | `createLiveEnrollmentEvent` | `src/routes/(buyer)/[lang]/listing/[slug]/+page.svelte` (two calls)                                                                               |
   | `joinLivestream`            | `src/routes/live/[id]/+page.svelte`                                                                                                               |

### Configuration

All six are env only, with no default. All empty means nothing is sent. A partly set or malformed
group logs an error at startup, naming the setting and never its value, and stays disabled.

| Env                                 | Property                                           | Meaning                                                                        |
| ----------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `AL_INGEST_URL`                     | `adaptive-listings.ingest-url`                     | Ingest origin; `/v1/events` is appended                                        |
| `AL_SERVER_API_KEY`                 | `adaptive-listings.server-api-key`                 | A server key whose KV record carries `hmac_secret`; never the page-visible one |
| `AL_SERVER_HMAC_SECRET`             | `adaptive-listings.hmac-secret`                    | That record's `hmac_secret`, hex                                               |
| `AL_TENANT_ID`                      | `adaptive-listings.tenant-id`                      | The single tenant's id, for the webhook body                                   |
| `AL_LISTING_UPDATED_WEBHOOK_URL`    | `adaptive-listings.listing-updated-webhook-url`    | Full URL of `/api/webhooks/listing-updated`                                    |
| `AL_LISTING_UPDATED_WEBHOOK_SECRET` | `adaptive-listings.listing-updated-webhook-secret` | The control plane's `LISTING_UPDATED_WEBHOOK_SECRET`                           |

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
