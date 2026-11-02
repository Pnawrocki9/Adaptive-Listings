# web-master patches: X3 (FOLLOW-1341) and X4 (FOLLOW-1342)

Apply from the directory that CONTAINS `web-master/` (the Estalara app root,
`~/Projects/Estalara-gitlab-2026-08-17`), against the pre-Phase-5 snapshot
(`~/Projects/Estalara-snapshot-2026-11-02-before-phase5.tar.gz`):

    patch -p1 < web-master-x4-debug-from-env.patch
    patch -p1 < web-master-x3-cta-feature-slots.patch

Both were dry-run applied to a copy of the snapshot files. The repo has no git. `core-master`
patches (X1/X2) are delivered separately by another agent.

## X4 `data-debug` from env (FOLLOW-1342)

| File                           | Before                                  | After                                                  |
| ------------------------------ | --------------------------------------- | ------------------------------------------------------ |
| `src/lib/publicEnv.ts`         | no `debug` field in `estalara`          | `debug: env.PUBLIC_ESTALARA_DEBUG === 'true'`          |
| `src/routes/+layout.svelte:61` | `s.setAttribute('data-debug', 'true');` | `if (cfg.debug) s.setAttribute('data-debug', 'true');` |

Default is off: with `PUBLIC_ESTALARA_DEBUG` unset the attribute is never set. `hooks.server.ts`
already omits it, so the SSR-injected loader and the client injector agree. A dev who wants it sets
`PUBLIC_ESTALARA_DEBUG=true`. The existing `.env` is not edited, and `.env.example` carries no
`PUBLIC_ESTALARA_*` lines, so none were added.

The AC grep (`data-debug="true"`) cannot see `setAttribute('data-debug', 'true')`. Use the live
check: N3 hop `no_debug_attribute` (`scripts/dev/real-app-acceptance.mjs`) runs
`document.querySelectorAll('[data-debug="true"]')` on the page.

## X3 `cta` and `feature` slots (FOLLOW-1341)

Every marker is gated on the same flag as `headline`/`description` (`estalaraEnabled` =
`PUBLIC_ESTALARA_SDK_ENABLED === 'true'`). With the flag off, the DOM is byte-identical to today (an
empty spread adds no attribute) apart from whitespace inside the `Section` `<h2>` (see below).

| Slot      | Element                                                                                                | File                                                              |
| --------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `cta`     | mobile sticky bar button `listing.contactBar.cta` ("Ask about this property"), calls `scrollToContact` | `StickyContactBar.svelte` (new prop `ctaSlot`)                    |
| `cta`     | desktop "Send a message" button, no live sessions scheduled, calls `requestLiveTour()`                 | `[slug]/+page.svelte`                                             |
| `cta`     | desktop "Send a message" button, sessions scheduled, calls `requestLiveTour('...OtherTime')`           | `[slug]/+page.svelte`                                             |
| `feature` | the `<h2>` of the Amenities section (`listing.amenitiesTitle`)                                         | `Section.svelte` (new prop `estalaraSlot`), `[slug]/+page.svelte` |

Why these elements. The SDK's text directive does `el.textContent = value`
(`packages/sdk/src/core/adapt.ts`, `applyTextDirective`), so a slot must be an element whose whole
content is one text label and whose handler lives on the element itself. All three `cta` buttons
contain only the translated label (no icon child to be wiped), and their `on:click` handlers are
attached to the `<button>`, which is not replaced, so the contact and live-tour handlers keep
working. `disabled` still follows `isRequestingLiveTour`. The `LiveSessions` book/join/leave buttons
and the `Agent` phone/WhatsApp links are deliberately not marked: they carry icons or per-session
state. `feature` is a single-line heading, not the `AmenitiesGrid` container, because a text
directive on a list would collapse the list (the reason `annotate-slots.ts` refuses to self-annotate
`features_list`).

How each selector reaches the SDK. This tenant is instrumented by hand: the app writes
`data-estalara-slot="<name>"` itself and the SDK reads `[data-estalara-slot="cta"]` /
`[data-estalara-slot="feature"]` in `applyTextDirective` (`core/adapt.ts:476`). The directive names
`cta` and `feature` come from the archetype playbooks in
`packages/shared/src/playbooks/archetypes/*` (`{ slot: 'cta', ... }`, `{ slot: 'feature', ... }`).
No `slot_selectors` entry and no SDK or loader config is involved, so there is no new `data-*`
option on the loader snippet. `annotate-slots.ts` skips nodes that already carry the attribute. The
app.html pre-paint cloak (`[data-estalara-slot]{visibility:hidden!important}`) now also covers these
elements, for at most 1500 ms and only for a session that already resolved a non-neutral archetype.

Points for review (not decided here):

- Copy fit. Playbook `cta` strings read like "Request Commercial Pack" or "Download Expat Relocation
  Guide", and `feature` like "Your First Step". On this page the `cta` buttons open a message to the
  agent or scroll to the contact card, and the `feature` heading sits over the amenities grid. The
  directive grounding rules (ESC-076) apply to what the LLM writes; whether the buttons should be
  restricted to message-shaped labels is a product call.
- `Section.svelte` now renders `<h2>\n{name}\n</h2>` (prettier layout for the conditional spread),
  so every Section heading gains surrounding whitespace text nodes. Layout is unchanged (block
  element, collapsible whitespace), but a test that compares `h2.textContent` exactly would need
  `.trim()`.
- The SDK's `cta.clicked` observer only fires for `[data-estalara-cta]`. These patches do not add
  that attribute; adding it is a separate signal decision.
- Svelte keeps a reference to its own label text node. After the SDK sets `textContent`, a later
  locale switch updates the detached node. The SDK's resilience observer re-applies its copy, so the
  adapted label persists across the switch until the next reset.

## Checks run

In `web-master`, Node 22.22.2, heap 1024:

- `prettier --write` on the five touched files (only `Section.svelte` changed formatting).
- `eslint` on the five files: exit 0.
- `svelte-kit sync && svelte-check --threshold error`: 4 errors, all pre-existing and outside the
  touched files (`hooks.server.ts` cookie types, `admin/nav.ts` heroicons, `DatePicker.svelte`,
  `AudioLevelVisualizer.svelte`); none in the touched files.

Only a live run can show: that `[data-estalara-slot="cta"]` and `="feature"` exist on the rendered
listing page (SSR spread with the env flag on), that the SDK writes them and emits `adapt.applied`
for `cta` and `feature` (and not `no_slot_elements`), that clicking the adapted button still scrolls
/ opens the live-tour conversation, that no `[data-debug="true"]` exists with
`PUBLIC_ESTALARA_DEBUG` unset (N3 `no_debug_attribute`), and that the page without adaptation is
unchanged. N3 currently grades only `headline_dom_changed` and `description_*`; it has no hop for
`cta`/`feature`, so K5 needs one if "both slots adapt" is to be asserted by the script.

## X1 front end: conversion session header (FOLLOW-1339)

Apply after the X3 and X4 patches (it is a diff against the state after them):

    patch -p1 < web-master-x1-conversion-header.patch

Spec: "What `web-master` must do" in `README.md` on branch
`backend-engineer/FOLLOW-1339-signed-events`.

Update (ESC-091 C-5, applied on localhost pending a CEO ruling): a buyer who refused the host's
optional analytics in `CookieConsent.svelte` sends no header. `$lib/stores/cookieStore` stores the
choice as JSON in `localStorage['cookieConsent']`, shape `{"necessary":true,"optional":<boolean>}`.
The helper now also returns `{}` unless that JSON parses and `optional === true`; an absent or
malformed value means no header. It reads `localStorage` directly, so it imports neither the store
nor posthog. N3 must therefore set, before the conversion step,
`localStorage.setItem('cookieConsent', JSON.stringify({necessary: true, optional: true}))`
(alongside the SDK's `estalara_consent` = `granted`).

New unit test `src/lib/estalaraConversionHeaders.test.ts` (vitest, happy-dom, 8 tests): granted with
optional true returns the SDK id; pending, denied, optional refused, optional absent, malformed
session JSON, a session without a string id, and throwing storage each return `{}`. Every negative
is paired with a positive assertion on the same fixture, so it cannot pass vacuously. Run:
`NODE_OPTIONS=--max-old-space-size=1024 vitest run src/lib/estalaraConversionHeaders.test.ts`.

New file `src/lib/estalaraConversionHeaders.ts` exports `estalaraConversionHeaders()`. It returns
`{ 'X-Estalara-Session-Id': <id> }` only while `localStorage['estalara_consent'] === 'granted'`,
with the id read from `sessionStorage['__estalara_session__'].sessionId`; otherwise (or on any
storage error) `{}`. Nothing is written to storage. It is passed as the generated client's last
argument, `{ headers: estalaraConversionHeaders() }`, at exactly these six calls:

| Call                        | File                                                                         | Count |
| --------------------------- | ---------------------------------------------------------------------------- | ----- |
| `createOrFindConversation`  | `src/lib/ui/listing/Agent.svelte`                                            | 1     |
| `createOrFindConversation`  | `src/routes/(buyer)/[lang]/agent/[slug]/+page.svelte`                        | 1     |
| `createOrFindConversation`  | `src/routes/(buyer)/[lang]/listing/[slug]/+page.svelte` (`requestLiveTour`)  | 1     |
| `createLiveEnrollmentEvent` | `src/routes/(buyer)/[lang]/listing/[slug]/+page.svelte` (`onBook`, `onJoin`) | 2     |
| `joinLivestream`            | `src/routes/live/[id]/+page.svelte`                                          | 1     |

No axios interceptor was touched.

Verified against code before editing:

- Consent: the SDK stores `'granted' | 'denied'` under `localStorage['estalara_consent']`; absent
  means `pending` (`packages/sdk/src/core/session.ts`, `getConsentState`). The spec is right.
- Session: `sessionStorage['__estalara_session__']` holds JSON
  `{ sessionId, startedAt, pageCount }`; `sessionId` is a UUID v4 (36 chars), or a 64-char hex from
  a pre-FOLLOW-1106 build. Both fit the backend's 32 to 64 char `[A-Za-z0-9-]` check. The spec is
  right.
- Generated client: all three methods are `(locale, body, options?: RawAxiosRequestConfig)` in
  `src/lib/api/api.ts`, and the param creator merges `options.headers` over the base headers
  (`{...localVarHeaderParameter, ...headersFromBaseOptions, ...options.headers}`). The spec is
  right.
- Call sites: `grep` over `src` finds exactly these six API calls, nothing else. The
  `joinLivestream` in `src/routes/(agent)/livestream/[id]/+page.svelte` is a local function that
  only navigates; it calls no API method and is correctly left alone.

Nothing in the spec was false. Note: `src/routes/live/[id]/+page.svelte` is not prettier-clean in
the snapshot (unrelated lines), so it was not reformatted, to keep the patch to the one call and the
import. The other four files and the new helper pass `prettier --check`; eslint exit 0 on all five;
`svelte-check` shows the same 4 pre-existing errors, none in these files.

Only a live run can show: that the browser sends the header on those six requests and on no other
(including the CORS preflight for `X-Estalara-Session-Id` against the real backend), that it is
absent after a denial or before consent, that the value equals the SDK's `session_id` for the tab,
and that the backend then emits `inquiry.completed` / `live.signup` under that session.
