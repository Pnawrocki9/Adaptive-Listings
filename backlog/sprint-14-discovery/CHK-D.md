# CHK-D — Chat & Live-Signup Architecture Analysis

## Estalara-app (NEW REPO) — Discovery Day, 2026-05-30

---

## A. Chat Architecture

### A.1 Chat widget component

The AI chat widget is:

- Component: `ChatBot`
- File: `/home/asipi/Projects/Estalara-app/web-master/src/lib/ui/chatbot/ChatBot.svelte`
- Embedded on:
  `/home/asipi/Projects/Estalara-app/web-master/src/routes/(buyer)/[lang]/listing/[slug]/+page.svelte`
  (line 871-873)

```svelte
<!-- ChatBot Component -->
{#if property?.uuid}
  <ChatBot context={property.uuid} />
{/if}
```

There is a second, separate human-to-human messaging system (`ChatView.svelte`, route
`(buyer)/(private)/messages/`) which uses `POST /api/v1/conversation/message`. These are two
distinct systems.

### A.2 Chat technology

**Pure custom SvelteKit + Server-Sent Events (SSE), no third-party widget.**

Key evidence from `package.json`:

- `@microsoft/fetch-event-source` — SSE client that allows custom headers (required because browser
  `EventSource` cannot send `Authorization`)
- `amazon-ivs-chat-messaging` — used only in the in-LIVE meeting chat (`MeetingChat.svelte`), not in
  the AI bot
- No Intercom, Drift, Crisp, or Tawk dependency present

The `ChatBot.svelte` calls the backend directly via `fetch()` streaming:

```typescript
// ChatBot.svelte lines 350-351
const responseParams = await $chatAiParamsCreatorStore?.processQuestion(
  localeAcceptedByAPI($locale) as ProcessQuestionLocaleEnum,
  chatRequest,
);
fetch(BASE_PATH + responseParams?.url, {
  method: options?.method,
  body: options?.data,
  headers: options?.headers as Record<string, string> | undefined,
});
```

Response is consumed as a streaming `ReadableStream`, parsed as `data: {"message":"<chunk>"}` SSE
frames.

### A.3 Backend chat endpoint

File:
`/home/asipi/Projects/Estalara-app/core-master/src/main/kotlin/com/time2show/core/controller/ChatAIController.kt`

```
POST /api/v1/ai/chat
Content-Type: application/json
Authorization: Bearer <keycloak-jwt>
Produces: text/event-stream (SSE) | application/json (errors)

Body: { "listingUuid": "<UUID>", "message": "<string, max 1500 chars>" }

Response (stream): data: {"message": "<chunk>"}\n\n
Response (error 429): {"retryAfter": N} + Retry-After header
Response (error 422): agency context missing
Response (error 400): validation errors as RequestMessage[]
```

History endpoint:

```
GET /api/v1/ai/chat?listing-uuid=<UUID>&page=0&size=20
Authorization: Bearer <keycloak-jwt>
Response: ChatHistoryListResponseTO { history: ChatMessageTO[], totalElements, totalPages, size, page }
```

The controller has `@PreAuthorize("hasAuthority('agent')")` — authentication is **required** and
restricted to users with `agent` role. Anonymous users cannot use the AI chat.

The backend service (`ChatAIServiceImpl.kt`) runs a full RAG pipeline (Spring AI + pgvector + Cohere
reranker). It stores all messages in Postgres (`ChatMessageEntity`). There is no webhook emitted
after processing.

### A.4 Existing client-side hook for SDK

**There is NO existing CustomEvent, postMessage, or store subscription that the SDK can intercept
today.**

The `ChatBot.svelte` `sendMessage()` function mutates an internal `messages: Message[]` array and
calls `streamResponse()` directly. Nothing is dispatched to `window` or `document`.

The minimal hook needed: a
`window.dispatchEvent(new CustomEvent('estalara:chat:message-sent', { detail: { listingUuid, message } }))`
call inserted at the top of the `sendMessage()` function (line 266 of `ChatBot.svelte`), and a
`window.dispatchEvent(new CustomEvent('estalara:chat:contact-initiated', ...))` on the **first**
user message (when `messages.filter(m => m.from === 'user').length === 0` before append).

### A.5 AI-only vs human-agent split / when contact_initiated fires

**There is only one AI agent, no human handoff.** The `ChatBot` connects exclusively to
`POST /api/v1/ai/chat` (RAG + LLM, no human agent routing). There is a separate human messaging
system (`MessageController` / `ChatView.svelte`) but it is a standalone DM system, not a handoff
from the AI chat. The AI chat and the human messaging are completely decoupled — users can contact
the listing agent via a separate "messages" flow, not via a handoff from the AI bot.

`chat.contact_initiated` definition implication: because there is no AI-to-human handoff, the event
should fire on the **first message the user sends to the AI chat for a given listing session**. This
is the moment of buyer intent expression. There is no "first message to human" concept in this
system.

---

## B. Live Events Architecture

### B.1 LIVE events surface

File: `/home/asipi/Projects/Estalara-app/web-master/src/lib/ui/listing/LiveSessions.svelte`

LIVE sessions are tied to listings through the calendar system. The listing page fetches
`CalendarLiveEventTO[]` from `GET /api/v1/listing/{uuid}/events` (called via
`ListingControllerApi.getListingEvents()`). Each `CalendarLiveEventTO` has `eventType`
discriminating between `LIVE_PRESENTATION`, `LIVE_PRESENTATION_REGISTRATION`, and `LEAVE`.

There is no separate `live_events` table visible from the frontend — the calendar API joins live
sessions to listings.

### B.2 "Zapisz się na LIVE" CTA

The CTA is the `bookSlot` button inside `LiveSessions.svelte` (line 375-387):

```svelte
<button
  on:click={isAuthenticated ? () => bookSlot(slot) : openLoginRequiredPopup}
  class="bg-blue-600 ... text-white ...">
  {$_('listing.sessions.bookSession')}
</button>
```

Polish i18n key `listing.sessions.bookSession` — this is the "Zapisz się na LIVE" button.

On click: calls `bookSlot(slot)` → calls `onBook(slot.uuid)` prop callback → in `+page.svelte` at
line 238-248:

```typescript
async function onBook(slotUuid: string): Promise<void> {
  await calendarApiClient.createLiveEnrollmentEvent(
    $locale?.toUpperCase() as CreateLiveEnrollmentEventLocaleEnum,
    { uuidLive: slotUuid },
  );
  await loadListingEvents();
}
```

On success: shows `svelte-french-toast` success toast (`showSuccessToast`). No modal, no calendar
pop-up. Direct POST, then silent list refresh.

### B.3 Backend live-signup endpoint

File:
`/home/asipi/Projects/Estalara-app/core-master/src/main/kotlin/com/time2show/core/controller/CalendarController.kt`

```
POST /api/v1/calendar/event/live/enrollment
Content-Type: application/json
Authorization: Bearer <keycloak-jwt> (any authenticated user, no agent restriction)

Body: CreateLiveEnrollmentEventRequestTO { uuidLive: String }

Response 200: empty body on success
Response 400/404: RequestMessage[]
```

No webhook is emitted. No outbound event is published. The enrollment is persisted to Postgres only.

Matching DELETE:

```
DELETE /api/v1/calendar/event/live/enrollment?live-uuid=<UUID>
```

### B.4 Existing client-side event after signup

**There is NO CustomEvent or postMessage dispatched after successful live enrollment.** The success
path in `bookSlot()` (lines 176-178 of `LiveSessions.svelte`) only calls `showSuccessToast(...)` and
`setSlotRegistration(slot.uuid, true)` (internal Svelte state).

Minimal hook needed:
`window.dispatchEvent(new CustomEvent('estalara:live:signup', { detail: { slotUuid, listingUuid } }))`
inserted immediately after `showSuccessToast(...)` in the `bookSlot()` function.

---

## C. SDK Estalara Integration Today

### C.1 SDK load location

File: `/home/asipi/Projects/Estalara-app/web-master/src/app.html`

```html
<!-- Estalara Adaptive Listings SDK -->
<script
  src="https://admin.estalara.com/sdk.js"
  data-api-key="000-app-estalara"
  data-decision-url="https://admin.estalara.com/api"
  async
></script>
```

The script tag is present in `app.html` and loads globally on every page. `data-api-key` is
`000-app-estalara` (a pilot/test key). `data-decision-url` points to
`https://admin.estalara.com/api`.

### C.2 SDK init status from code analysis

Several concerns are detectable from static analysis:

1. **Auth guard mismatch**: `ChatBot.svelte` is only rendered when `isAgent` is true (line 419:
   `{#if isAgent}`). However `data-api-key="000-app-estalara"` suggests a single tenant key. There
   is no conflict here — the SDK observes the page, not Keycloak roles.

2. **`async` attribute**: The SDK loads asynchronously. The listing page loads via SvelteKit
   client-side navigation. Both `ChatBot` and `LiveSessions` mount after hydration, so the SDK will
   already be initialized before user interaction. No race condition detected.

3. **No conflicting CSP or CORS headers visible** from `app.html` or `vite.config.ts` that would
   block the SDK.

4. **`posthog-js`** is also loaded (package.json dep) — there may be duplicate analytics
   instrumentation if SDK also fires conversion events to PostHog. Not a blocker but should be
   noted.

---

## D. Recommended Integration Design

### Summary of constraints

| Concern                          | Finding                                        |
| -------------------------------- | ---------------------------------------------- |
| Chat technology                  | Custom SSE, full control                       |
| Chat widget                      | Single Svelte component, no third-party iframe |
| Live signup                      | Single Svelte component, direct POST, no modal |
| Existing CustomEvent hooks       | None in either system                          |
| Backend webhooks                 | None emitted by either system                  |
| Auth requirement for chat        | Keycloak JWT required + `agent` role           |
| Auth requirement for live signup | Keycloak JWT required (any authenticated user) |

### Option X — Pure client-side hook (CustomEvent in Estalara-app, SDK listens)

**Mechanism**: Add 3 lines to Estalara-app frontend. No backend changes.

- In `ChatBot.svelte` `sendMessage()`: dispatch `estalara:chat:contact-initiated` on first message,
  dispatch `estalara:chat:message-sent` on every send.
- In `LiveSessions.svelte` `bookSlot()`: dispatch `estalara:live:signup` on success.
- SDK adds `window.addEventListener('estalara:chat:message-sent', ...)` etc.

**Effort**: 1 day (Estalara-app side) + 0.5 day (SDK event listener side) = **1.5 days total**.

**Pros**: Minimal blast radius. No backend change. Fully reversible. Works immediately.

**Cons**: Auth-gated — chat is only accessible when `isAgent=true` in Keycloak. If buyer role cannot
access chat, `chat.message.sent` events will never fire for the buyer population. This is the
critical unknown.

**BLOCKER RISK**: The `ChatBot.svelte` renders only when `isAgent` is true (line 419). This means
only agent-role users (property agents) see the chat widget. Buyers who are the primary target for
`chat.contact_initiated` do not see the widget at all. This is either a business logic issue in
Estalara-app (the widget should also be visible to non-agent authenticated buyers) or the intended
use case is that agents use the AI chat to prepare answers. Needs CEO/CTO clarification before
CHAT-001.

### Option Y — Backend webhook (core-master POSTs to ingest on chat/live-signup)

**Mechanism**: Add Spring `@EventListener` or Kafka/Redpanda producer in `ChatAIServiceImpl` after
`processQuestion` persists the message, and in `CalendarService` after enrollment. POST to Adaptive
Listings ingest endpoint.

**Effort**: 3-4 days (core-master Kotlin changes + new outbound HTTP client + secrets management +
test coverage).

**Pros**: Most reliable — fires even if JS is disabled, works for mobile apps, works for future
non-SvelteKit surfaces.

**Cons**: Requires core-master changes (separate repo, separate CI/CD, Kotlin codebase). Adds
network call in hot path of RAG endpoint. Introduces cross-service coupling.

### Option Z — Hybrid (client-side for events, backend for enrollment confirmation)

**Mechanism**:

- `chat.message.sent` + `chat.contact_initiated` via Option X CustomEvent (client-side)
- `live.signup` via a server-side webhook from CalendarController (Option Y, enrollment is not
  latency-sensitive)

**Effort**: 2 days frontend + 1.5 days backend = **3.5 days total**.

**Pros**: Best of both — fast iteration on chat events, reliable live-signup via backend.

**Cons**: Two integration paths to maintain.

### Recommendation: Option X, with blocker resolution first

**Recommend Option X** for the following reasons:

1. Speed — 1.5 days vs 3.5 days.
2. Reversibility — CustomEvent hooks are two-line additions, trivially reverted.
3. The Estalara-app frontend team owns both `ChatBot.svelte` and `LiveSessions.svelte`. Changes are
   in scope.
4. The SDK already loads on all pages — listener registration is zero risk.

**Prerequisite before implementation**: Resolve the `isAgent` guard blocker. If the AI chat is
intended for buyers (which D-2 implies), the Estalara-app team must remove or relax the
`{#if isAgent}` guard in `ChatBot.svelte` so buyer-role authenticated users can access the widget.
Until this is resolved, `chat.contact_initiated` events will never fire for the conversion funnel.

**Effort breakdown for Option X**:

- FIX-006 (if it is the `isAgent` guard fix): 0.5 days, Estalara-app team
- CHAT-001 (`chat.message.sent` + `chat.contact_initiated` hooks): 0.5 days, Estalara-app team
- CHAT-002 (`live.signup` hook): 0.5 days, Estalara-app team
- CHAT-003 (SDK event listener + ingest call): 0.5 days, sdk-engineer
- SCHEMA-001 (Zod schemas for new events): 0.5 days, architect + sdk-engineer

Total: **2.5 days**, achievable within Sprint 14.

---

## Blockers / Surprises

1. **BLOCKER: `isAgent` auth guard on ChatBot.** The AI chat (`ChatBot.svelte`) only renders when
   `isAgent === true`. Buyers cannot see or use the chat widget today. This directly blocks D-2
   (chat in v1.0). Requires Estalara-app code change and possibly Keycloak role policy review. Must
   be resolved before CHAT-001.

2. **NOTE: No CustomEvent infrastructure exists.** Neither `window.dispatchEvent` nor
   `document.dispatchEvent` is used anywhere in the application for SDK integration today. The
   CustomEvent approach is a green-field addition — low risk, but requires Estalara-app team
   availability.

3. **NOTE: Chat is AI-only, no human handoff.** `chat.contact_initiated` cannot mean "first message
   to human agent" because no human handoff exists. It must be defined as "first AI message per
   listing per session". This definition should be codified in SCHEMA-001.

4. **NOTE: Auth required for live signup.** `createLiveEnrollmentEvent` requires a Keycloak JWT. The
   `live.signup` event will only fire for authenticated users. Anonymous users see the "Zapisz się
   na LIVE" button but are redirected to login via `openLoginRequiredPopup()`. The SDK should record
   that anonymous-to-auth flow as an attribution signal. Not a blocker but an analytics gap.

5. **NOTE: `data-api-key="000-app-estalara"` is a pilot key.** Control plane should confirm this
   tenant is provisioned and active in Supabase before Sprint 14 events are expected to flow.
