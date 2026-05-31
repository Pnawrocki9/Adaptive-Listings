# CHK-B — Adapt-Slot Audit

**Date:** 2026-05-30 **Author:** sdk-engineer **Purpose:** Discovery Day check to determine FIX-014
scope for v1.0 pilot on app.estalara.com

---

## 1. Grep Summary

### Search terms used

`data-estalara-slot`, `data-estalara-listing-id`, `data-estalara-listing`, `data-estalara-cta`,
`data-estalara-section`, `data-estalara-listing-content`, `data-estalara-inquiry-form`,
`data-estalara-yield`, `data-estalara-bedrooms`, `data-estalara-price`

Excluded: `node_modules`, `dist`, `.svelte-kit`, `build`, `test-results`, `.claude/`

---

## 2. Repo 1 — Adaptive-Listings Monorepo

### 2a. Source files (active markers, not test/fixture/doc)

| File                                                      | Markers found                                                                                                     | Classification                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/shared/src/directives.ts`                       | `data-estalara-slot` (in JSDoc comments/string literals describing selector patterns), `data-estalara-listing-id` | Comments/docstrings — not rendered DOM                                                       |
| `packages/shared/src/schemas/events/listing-observe.ts`   | `data-estalara-cta` (in JSDoc comment)                                                                            | Comment — not rendered DOM                                                                   |
| `packages/sdk/src/auto-detect/detect-inquiry-selector.ts` | `data-estalara-slot='inquiry-submit'` (CSS selector strings), `data-estalara-listing-id` (CSS selector string)    | Source logic — selector strings passed to `querySelector`, not HTML attributes placed in DOM |

### 2b. Test files / fixtures

| File                                                                     | Markers found                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/sdk/e2e/fixtures/index.html`                                   | `data-estalara-listing`, `data-estalara-listing-id`, `data-estalara-slot="headline"`, `data-estalara-slot="feature"`, `data-estalara-slot="cta"`, `data-estalara-yield`, `data-estalara-bedrooms`, `data-estalara-cta="book-viewing"` |
| `packages/sdk/e2e/fixtures/inquiry.html`                                 | `data-estalara-slot='inquiry-submit'`                                                                                                                                                                                                 |
| `packages/sdk/e2e/adapt-dom-mutations.spec.ts`                           | `data-estalara-slot="headline"`, `data-estalara-slot="feature"`, `data-estalara-yield`, `data-estalara-bedrooms`                                                                                                                      |
| `packages/sdk/e2e/inquiry-observer.spec.ts`                              | `data-estalara-slot="inquiry-submit"`                                                                                                                                                                                                 |
| `packages/sdk/e2e/observer-flow.spec.ts`                                 | `data-estalara-cta`                                                                                                                                                                                                                   |
| `packages/sdk/src/__tests__/adapt.test.ts`                               | `data-estalara-slot`, `data-estalara-listing-id`, `data-estalara-bedrooms`, `data-estalara-yield` (all set via `setAttribute` in test DOM)                                                                                            |
| `packages/sdk/src/__tests__/observer-inquiry.test.ts`                    | `data-estalara-slot='inquiry-submit'`                                                                                                                                                                                                 |
| `packages/sdk/src/__tests__/event-contract.test.ts`                      | `data-estalara-listings`                                                                                                                                                                                                              |
| `packages/sdk/src/__tests__/config.test.ts`                              | `data-estalara-slot='inquiry-submit'`                                                                                                                                                                                                 |
| `packages/sdk/src/auto-detect/__tests__/detect-inquiry-selector.test.ts` | `data-estalara-slot="inquiry-submit"`, `data-estalara-listing-id`, `data-estalara-slot="price"`                                                                                                                                       |
| `packages/sdk/src/auto-detect/__tests__/pipeline.test.ts`                | `data-estalara-listing-id`, `data-estalara-slot="price"`                                                                                                                                                                              |
| `packages/sdk/src/auto-detect/__tests__/techniques.test.ts`              | `data-estalara-listing-id`                                                                                                                                                                                                            |

### 2c. Documentation / backlog files

Many `.md` files in `backlog/` and `docs/` contain adapt-slot references — these are planning docs,
specs, and tickets, not source code.

**Monorepo conclusion:** All adapt-slot markers in `packages/sdk/` are either SDK source logic (CSS
selector strings) or test fixtures. Zero markers exist in any production-rendered HTML outside of
E2E test fixtures.

---

## 3. Repo 2 — Estalara-app (SvelteKit, app.estalara.com)

### 3a. Adapt-slot markers in source files

**Result: ZERO `data-estalara-*` attributes exist anywhere in `src/`.**

The grep returned no output. Confirmed with a direct attribute search:

```
grep -r "data-estalara" /home/asipi/Projects/Estalara-app/web-master/src/ → (no output)
```

### 3b. SDK script tag present

`src/app.html` (the SvelteKit shell, rendered globally) **does** load the Estalara SDK:

```html
<!-- Estalara Adaptive Listings SDK -->
<script
  src="https://admin.estalara.com/sdk.js"
  data-api-key="000-app-estalara"
  data-decision-url="https://admin.estalara.com/api"
  async
></script>
```

The SDK is loaded on every page. No `data-estalara-tier` attribute is set — tier defaults to
whatever the SDK resolves from the loader.

---

## 4. Listing Page Route Structure

### 4a. Listing detail page

**Route:** `src/routes/(buyer)/[lang]/listing/[slug]/+page.svelte`

**DOM structure (top to bottom):**

1. **`<svelte:head>`** — SEO tags: `<title>`, meta description, OG, Twitter card, canonical,
   hreflang alternates
2. **Loading / error / not-found states** — guarded by `{#if isLoading}` etc.
3. **`<header>`** — Hero: `<MediaViewer>` (photo slideshow component) + "See all photos" button
   overlay
4. **Property Header card** — `bg-white rounded-2xl`: flag icon + `<h1>` with
   `{formattedPrice} {currency}`, street address/city/region, beds/baths/area feature chips,
   save-to-favourites button, share button
5. **Two-column grid (`lg:grid-cols-3`)**:
   - **Left column (lg:col-span-2)**:
     - Description card — `listing.whatsSpecial` section, highlight tags, description paragraphs,
       days-on-Estalara badge
     - AI Assistant CTA card — gradient banner with "AI" badge, 4 tag chips, pulse AI button (this
       is purely decorative; the real chat opens from the floating button)
     - Map section (conditional on lat/lon) — `<Map>` component
     - Facts & Features section — grid of 6+ sub-sections (bedrooms/bathrooms, features, materials,
       heating/cooling, parking, utilities)
   - **Right column (lg:col-span-1)**:
     - `<LiveSessions>` + `<Agent>` card — live sessions calendar + agent profile
6. **`<footer>`** (desktop only, `hidden lg:block`) — full-bleed property image with dark overlay,
   "See all from agent" text, "Estalara Marketplace" button (`on:click={navigateToAgent}`)
7. **`<ChatBot context={property.uuid} />`** — floating chat widget (bottom-right), only visible to
   agents (`{#if isAgent}`)

### 4b. Listing list/grid page

**Route:** `src/routes/(buyer)/[lang]/+page.svelte`

Renders a filter bar (price presets, country, area range) + `<ListingGallery>` component. No
adapt-slot markers.

---

## 5. Live-Signup CTA Location (for FIX-006)

The "Zapisz się na LIVE" functionality is rendered by `src/lib/ui/listing/LiveSessions.svelte`,
which is mounted inside the right-column agent card on the listing detail page.

**Exact button in template:**

```svelte
<!-- When session has not started and user is not registered -->
<button on:click={isAuthenticated ? () => bookSlot(slot) : openLoginRequiredPopup}>
  {$_('listing.sessions.bookSession')}
</button>
```

Translation keys:

- `listing.sessions.bookSession` → EN: "Book session" / PL: "Zarezerwuj sesję"
- `listing.sessions.joinNow` → EN: "Join now" / PL: "Dołącz teraz"
- `listing.sessions.liveNowCta` → EN: "The live tour is on! Join now..." / PL: "Transmisja trwa!..."

The button has **no `id`, no `data-*` attribute, no stable CSS class** beyond Tailwind utility
classes. The only reliable selector is the parent slot context. FIX-006 will need to add a
`data-estalara-cta="live-signup"` attribute to this button (or instrument it via the LiveSessions
component's `bookSlot` call).

---

## 6. Chat Widget Location (for CHK-D)

`<ChatBot context={property.uuid} />` is rendered at the **bottom of the listing detail template**,
after the footer, outside all layout containers. It creates a
`fixed bottom-16 sm:bottom-6 right-4 sm:right-6 z-[9999]` floating button. The chat window opens as
an absolute-positioned panel above that button. **Only visible when `isAgent === true`** (line 419:
`{#if isAgent}`). The widget is a fully custom Svelte component — NOT the Estalara Observer widget.
It calls `ChatAiControllerApi` directly via REST/SSE stream.

---

## 7. FIX-014 Effort Verdict

> **⚠️ SUPERSEDED 2026-05-31 (CEO Piotr) → FOLLOW-159.** This verdict ("add `data-estalara-*`
> markers to the app.estalara.com templates") is no longer the chosen approach. app.estalara.com is
> the LIVE product and must stay **no-code** — its source is never edited beyond the standard SDK
> loader snippet. Adaptation is driven by detection: the SDK applies the already-detected
> `detail_schema.slot_selectors` (incl. `description`) at runtime. See **FOLLOW-159**. The findings
> below remain accurate as a description of the current DOM (0 markers), but the recommended action
> (hand-place markers) is rejected.

**Verdict: EFFORT L — "Build full slot integration from scratch" (3d)** _(historical — superseded,
see banner above)_

**Justification:**

| Criterion                         | Finding                                                      |
| --------------------------------- | ------------------------------------------------------------ |
| Markers on listing detail page    | **0** — zero `data-estalara-*` attributes anywhere in `src/` |
| Markers on listing grid/list page | **0**                                                        |
| Any partial instrumentation       | None                                                         |
| SDK loaded?                       | Yes — `app.html` loads `sdk.js` globally                     |

The SDK is already embedded in `app.html` and loads on every page. However the listing detail page
template (`(buyer)/[lang]/listing/[slug]/+page.svelte`) has no `data-estalara-slot`,
`data-estalara-listing-id`, `data-estalara-cta`, or any other adapt-slot attributes. Every mutable
surface — headline, price, description, feature tags, CTA buttons, inquiry form, live-signup button
— is unmarked.

FIX-014 must add markers to at minimum:

- `data-estalara-listing-id` on the listing container
- `data-estalara-slot="headline"` on the price+address `<h1>`
- `data-estalara-slot="description"` on the description block
- `data-estalara-slot="features"` on the feature chips section
- `data-estalara-slot="cta"` on the footer agent-redirect button
- `data-estalara-cta="live-signup"` on the `<LiveSessions>` book button (cross-component, requires
  editing `LiveSessions.svelte`)
- `data-estalara-listing` (boolean) on the listing container for Observer tier auto-detection

That is 7+ markers across 2 components (`+page.svelte` and `LiveSessions.svelte`), plus verification
that the SDK tier config in `app.html` is correct for Observer mode. Estimated effort: 3d (L).

---

## 8. Surprising Findings

1. **SDK is already loaded globally** — `app.html` has the
   `<script src="https://admin.estalara.com/sdk.js">` tag with `data-api-key="000-app-estalara"`.
   This is ahead of what was expected; it means FIX-014 does not need to add the loader tag, only
   the DOM markers.

2. **Chat widget is agent-only** — `ChatBot.svelte` only renders when `isAgent === true`. Buyers see
   no chat widget at all. CHK-D needs to account for this — event capture from chat interactions
   currently only fires for agent-role sessions.

3. **No inquiry form on listing detail page** — There is no contact/inquiry form on the listing
   detail page at all. The only conversion actions are: (a) save to favourites, (b) share, (c)
   book/join a live session, (d) navigate to agent page. The `data-estalara-inquiry-form` and
   `data-estalara-slot="inquiry-submit"` markers from the SDK test fixtures have no corresponding UI
   surface in the current SvelteKit app.

4. **Live-signup CTA has zero stable selectors** — The "Book session" button in
   `LiveSessions.svelte` has no `id`, no `data-*`, no named CSS class. Auto-detect heuristics would
   not find it reliably. A manual `data-estalara-cta="live-signup"` attribute must be added as part
   of FIX-014/FIX-006.
