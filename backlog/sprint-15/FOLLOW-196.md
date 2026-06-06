# FOLLOW-196 — CHAT-001/002: CustomEvent hooks in Estalara-app [DONE — verify payload extension]

**Sprint:** 15 **Agent:** sdk-engineer (Estalara-app repo) **Priority:** P0 **Estimated hours:** 2
**Status:** DONE **Source:** Audit F-04, CHK-D §A.4 **Promoted:** 2026-06-05 **Closed:** 2026-06-06

---

## Resolution

Both CustomEvent dispatches are already implemented in Estalara-app:

**CHAT-001 — `estalara:chat:message-sent`** File:
`web-master/src/lib/ui/chatbot/ChatBot.svelte:284-300`

```javascript
window.dispatchEvent(
  new CustomEvent('estalara:chat:message-sent', {
    detail: { message, listing_id: context, char_count, locale, timestamp },
  }),
);
// Comment in code: "See Adaptive Listings Plan v3.1 §0 (D-4) and CHAT-001 ticket"
```

ChatBot is gated `{#if isAuthenticated}` — fires for registered investors and agents.

**CHAT-002 — `estalara:live-signup`** File:
`web-master/src/lib/ui/listing/LiveSessions.svelte:162-195`
`window.dispatchEvent(new CustomEvent('estalara:live-signup', {detail: {slot_uuid, listing_id, timestamp}}))`
fires after successful `bookSlot()`.

## Required follow-up (scope of sdk-engineer Estalara-app)

Extend BOTH CustomEvent detail payloads to include registered user identity fields:

```javascript
user_uuid: $authStore.userUuid ?? null,   // Keycloak UUID for lead_id derivation
is_agent: $authStore.isAgent ?? false,    // SDK must ignore signals from agents
```

This is required for FOLLOW-197 (SDK listener) to derive `lead_id` and filter agent signals. Effort:
**S** (1h)

## Acceptance criteria

- [ ] `estalara:chat:message-sent` detail includes `user_uuid` and `is_agent`
- [ ] `estalara:live-signup` detail includes `user_uuid` and `is_agent`
- [ ] `estalara:listing:favorited` (FOLLOW-210) includes same fields when implemented
- [ ] Verified in browser console on local Estalara-app
