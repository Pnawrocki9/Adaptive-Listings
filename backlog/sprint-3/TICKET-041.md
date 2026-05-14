# TICKET-041 — Consent Banner Component (GDPR/CCPA)

**Sprint:** 3 **Agent:** sdk-engineer **Priority:** P1 **Estimated hours:** 6 **Status:** BLOCKED
**Depends on:** TICKET-037 (Shadow DOM sidebar widget) **Unblocks:** TICKET-045

## Context

The SDK collects behavioral signals (scroll depth, clicks, listing views) that are personal data
under GDPR and CCPA. Before collecting, the SDK must check consent state and present a consent
banner if consent has not been granted or denied.

Master Design section G defines the consent flow. The consent banner is the first UI element shown
in the Shadow DOM before any data collection begins.

Per the privacy-by-design principle: if `consent_state !== 'granted'`, no events are dispatched to
the ingest worker.

**References:**

- `packages/sdk/src/core/session.ts` — session storage; add `consent_state` field
- `packages/sdk/src/core/events.ts` — `dispatchEvents()` must gate on consent_state
- `packages/sdk/src/index.ts` — consent check before step 4 (event collection)
- `packages/sdk/src/ui/shadow-host.ts` — Shadow DOM host for rendering the banner
- `docs/MASTER_DESIGN.md` section G (Consent & Privacy)

## What to build

### 1. Consent storage

In `packages/sdk/src/core/session.ts`:

```typescript
export type ConsentState = 'granted' | 'denied' | 'pending';

export function getConsentState(): ConsentState {
  return (localStorage.getItem('estalara_consent') as ConsentState) ?? 'pending';
}

export function setConsentState(state: 'granted' | 'denied'): void {
  localStorage.setItem('estalara_consent', state);
  // Emit consent event to session storage for cross-tab awareness
}
```

### 2. Consent banner component

New file: `packages/sdk/src/ui/consent-banner.ts`

```typescript
export interface ConsentBannerOptions {
  language: 'en' | 'pl';
  accentColor: string;
  privacyPolicyUrl?: string;
  onGranted: () => void;
  onDenied: () => void;
}

export function renderConsentBanner(
  shadowRoot: ShadowRoot,
  options: ConsentBannerOptions,
): () => void; // returns cleanup function
```

Banner UI (bottom of viewport, full-width, 80px height):

- Text: "We personalize this page to match your buying intent. [Learn more ↗]"
- "Accept" button (accent color, primary)
- "Decline" button (text-only, secondary)
- When accepted: calls `setConsentState('granted')`, calls `options.onGranted()`, removes banner
- When declined: calls `setConsentState('denied')`, calls `options.onDenied()`, removes banner

### 3. SDK initialization gate

In `packages/sdk/src/index.ts`, BEFORE step 4 (event collection):

```typescript
// Check consent before collecting any data
const consentState = getConsentState();
if (consentState === 'pending') {
  // Show banner — do NOT proceed with data collection until granted
  await new Promise<void>((resolve) => {
    renderConsentBanner(shadowHost.root, {
      language: quizConfig.language,
      accentColor: quizConfig.accentColor,
      onGranted: () => {
        setConsentState('granted');
        resolve();
      },
      onDenied: () => {
        setConsentState('denied'); /* don't resolve — halt SDK */
      },
    });
  });
} else if (consentState === 'denied') {
  // Consent previously denied — halt SDK initialization entirely
  return;
}
// consentState === 'granted' — proceed normally
```

### 4. Emit consent events

When consent is granted or denied, push a `consent.granted` or `consent.denied` event to the
`eventQueue` (these events are allowed to be sent even with `consent_state = 'denied'`, as they are
the minimum required for compliance accounting).

## Acceptance criteria

- [ ] `packages/sdk/src/ui/consent-banner.ts` exists and exports `renderConsentBanner`
- [ ] Banner renders in Shadow DOM (not on host page DOM) — CSS fully isolated
- [ ] `getConsentState()` / `setConsentState()` exported from `session.ts`
- [ ] When consent is `'pending'`, the SDK shows the banner BEFORE collecting any events
- [ ] When consent is `'denied'`, the SDK halts initialization and dispatches NO events to ingest
- [ ] When consent is `'granted'`, normal SDK initialization proceeds
- [ ] `consent.granted` and `consent.denied` events are pushed to the event queue and flushed
- [ ] `localStorage.getItem('estalara_consent')` persists across page loads (no re-prompt)
- [ ] Unit test: `consent-banner.test.ts` covers granted/denied/pending state transitions
- [ ] E2E Playwright test: add to `sidebar-widget.spec.ts` — verify banner appears before signals
      are sent, accepting it unblocks data collection, declining stops it

## Notes

- The `privacyPolicyUrl` attribute on the `<script>` tag should map to `data-privacy-url` in
  `config.ts` so agencies can link to their own policy
- This is GDPR-adjacent but the full DPIA/ROPA + DSR endpoints are Sprint 9 work
  (TICKET-GDPR-001/002). This ticket only covers the consent gate in the SDK.
- Do NOT implement consent withdrawal UI (the "change my mind" flow) in this ticket — that requires
  the control-plane DSR endpoints which are Sprint 9.
