# FOLLOW-197 — CHAT-003: SDK listeners for chat/live events + registered user lead_id

**Sprint:** 15 **Agent:** sdk-engineer **Priority:** P0 **Estimated hours:** 5 **Status:** READY
**Source:** Audit F-04, CHAT-003, Q4 redesign (2026-06-06) **Promoted:** 2026-06-05 **Updated:**
2026-06-06

---

## Context

Both `estalara:chat:message-sent` and `estalara:live-signup` CustomEvents are already dispatched by
Estalara-app (FOLLOW-196 DONE). The SDK side — listeners, intent updates, ingest dispatch, and
registered user lead_id derivation — is not yet implemented.

**Key redesign (2026-06-06):** ChatBot is available only to registered (authenticated) users. This
means chat signals come with a stable Keycloak `user_uuid`. The SDK must:

1. Derive a pseudonymous `lead_id` from `user_uuid` (sha256 hash, first 16 chars)
2. Filter out signals from agents (`is_agent === true`) — we want investor signals only
3. Store `lead_id` in sessionStorage for use in adapt requests and feedback pings
4. Populate `lead_id` in ingest event payloads and `POST /api/adapt` body

## Scope

In `packages/sdk/src/index.ts`, after `setupObservers()`:

### 1. Lead ID derivation helper

```typescript
async function deriveLeadId(userUuid: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userUuid));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}
```

### 2. Registered user init (check authStore via localStorage 'kc_token')

At SDK init: check `localStorage.getItem('kc_token')`. If present and valid, parse JWT, extract
`sub` (userUuid), derive `lead_id`, store in sessionStorage as `__estalara_lead_id__`.

### 3. Event listeners

```typescript
window.addEventListener('estalara:chat:message-sent', async (e: CustomEvent) => {
  if (e.detail.is_agent) return; // ignore agent activity
  const leadId = e.detail.user_uuid ? await deriveLeadId(e.detail.user_uuid) : null;
  if (leadId) sessionStorage.setItem('__estalara_lead_id__', leadId);
  applyBehavioralSignal(currentIntentState, 'chat.message.sent', e.detail);
  dispatchEvent({ type: 'chat.message.sent', ...e.detail, lead_id: leadId });
});

window.addEventListener('estalara:live-signup', async (e: CustomEvent) => {
  if (e.detail.is_agent) return;
  const leadId = e.detail.user_uuid ? await deriveLeadId(e.detail.user_uuid) : null;
  sendFeedback({ converted: true, outcome: 'live.signup', lead_id: leadId, ...e.detail });
  dispatchEvent({ type: 'live.signup', ...e.detail, lead_id: leadId });
});
```

### 4. Propagate lead_id to adapt requests

In `fetchDirectives()`: add `lead_id: sessionStorage.getItem('__estalara_lead_id__') ?? ''` to POST
body.

### 5. Default feedbackEvents

Update `registerFeedbackListener` default from `['inquiry.completed']` to
`['live.signup', 'chat.contact_initiated', 'inquiry.completed']`.

## Cross-session benefit

Registered user: `lead_id` derived from Keycloak UUID → stable across devices and sessions →
adaptation_decisions.lead_id populated → conversion_labels linkable to the same investor even across
multiple site visits → highest-quality MOAT training data.

## Acceptance criteria

- [ ] SDK derives `lead_id` from `kc_token` on init when user is logged in
- [ ] `estalara:chat:message-sent` with `is_agent=true` is silently ignored
- [ ] `estalara:chat:message-sent` with `is_agent=false` updates intent state + dispatches ingest
      event
- [ ] `estalara:live-signup` triggers feedback ping with `lead_id` and `outcome='live.signup'`
- [ ] `lead_id` included in `/api/adapt` POST body
- [ ] `lead_id` included in ingest event payloads
- [ ] Anonymous users (no `kc_token`) continue using `xid` — no regression
- [ ] Integration test covers registered + anonymous paths
- [ ] Tests pass, CI green

## Definition of Done

- Branch `sdk-engineer/FOLLOW-197-chat003-sdk-listeners`
- Commits referencing [FOLLOW-197]
- PR; CI green
- `promoted_to_queue: true` in `backlog/FOLLOW_UPS.md`
