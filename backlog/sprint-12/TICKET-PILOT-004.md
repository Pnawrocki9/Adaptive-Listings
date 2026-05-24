# TICKET-PILOT-004 — Inquiry starts tracking: event mapping from app.estalara.com forms

**Sprint:** 12  
**Lane:** C (ROI instrumentation — parallel with Lane B)  
**Agent:** backend-engineer  
**Model:** sonnet-4.6  
**Priority:** P1  
**Estimated hours:** 2  
**Branch:** `backend-engineer/TICKET-PILOT-004-inquiry-tracking`  
**Depends on:** TICKET-PILOT-001 (Lane B — SDK must be installed on app.estalara.com)  
**Note:** Can start spec/backend work now; final validation against real traffic requires
TICKET-PILOT-001

---

## Context

The pilot secondary metric is **inquiry starts**. The `inquiry.started` event schema already exists
in `packages/shared/src/schemas/events/inquiry.ts` (`InquiryStartedEventSchema`). However:

1. The `000-app-estalara` fixture (`packages/sdk/src/auto-detect/__fixtures__/000-app-estalara/`)
   does not currently define an inquiry form selector — the ground truth files only define listing
   card and detail page selectors.
2. The SDK auto-emit of `inquiry.started` requires the SDK to know where the inquiry form is on
   `app.estalara.com` and to detect when a user opens it.
3. There is no dashboard panel for "inquiry starts" — TICKET-PILOT-003 is building the CTA lift
   dashboard, and inquiry starts needs to be added as a panel there.

---

## Acceptance Criteria

### AC 1 — Identify the inquiry form on app.estalara.com

Examine the `000-app-estalara` fixture detail page ground truth (`detail-ground-truth.json`) to find
or add:

- `inquiry_form_selector`: CSS selector for the inquiry/contact form container on detail pages
- `inquiry_submit_selector`: CSS selector for the form submit button

If neither selector is present in the fixture, add them with placeholder values (e.g.
`[data-estalara-slot='inquiry-form']`) and document that Rafał (CTO) needs to add the
`data-estalara-*` attributes to the SvelteKit detail page component.

### AC 2 — SDK inquiry.started emission

Review `packages/sdk/src/core/` to find where behavioral observers are wired (likely
`packages/sdk/src/observers/` or similar). Add or verify that:

- The SDK emits `inquiry.started` when the inquiry form container becomes visible (Intersection
  Observer) OR when the user clicks into the form (focus/click observer)
- The event payload includes `form_variant: 'contact_v2'` (or whatever variant exists on
  app.estalara.com)
- This is gated on `consent_state` (same pattern as existing cta.clicked observers)

If an inquiry form observer already exists but is not wired into the SDK init flow, wire it. If it
doesn't exist, create a minimal implementation: click observer on `inquiry_submit_selector` → emit
`inquiry.started`.

### AC 3 — Inquiry starts API route

Create `apps/control-plane/src/app/api/pilot/inquiry-starts/route.ts`:

```ts
GET /api/pilot/inquiry-starts?tenant_id=<uuid>&window_days=<7|14|30>
```

Response:

```ts
{
  window_days: number;
  tenant_id: string;
  total_inquiry_starts: number;
  adapted_inquiry_starts: number;
  holdout_inquiry_starts: number;
  adapted_inquiry_rate: number; // inquiry.started / adapted sessions
  holdout_inquiry_rate: number;
  lift_pct: number | null; // null if insufficient holdout data
  daily_breakdown: Array<{
    date: string; // YYYY-MM-DD
    adapted: number;
    holdout: number;
  }>;
}
```

Query: join `events` (type = 'inquiry.started') with `adaptation_decisions` (holdout_group) on
(tenant_id, session_id). Same ClickHouse client pattern as TICKET-PILOT-003.

### AC 4 — Dashboard panel

Add an "Inquiry Starts" panel to the pilot dashboard (same page as TICKET-PILOT-003, coordinate on
page placement):

- Total inquiry starts (adapted + holdout combined) as a KPI card
- Adapted vs holdout rate comparison
- Daily trend chart (simple table — recharts not available)
- Lift % if data is sufficient (n ≥ 30 per group)

### AC 5 — 000-app-estalara fixture update

Update `packages/sdk/src/auto-detect/__fixtures__/000-app-estalara/detail-ground-truth.json` to add:

```json
"inquiry_form_selector": "[data-estalara-slot='inquiry-form']",
"inquiry_submit_selector": "[data-estalara-slot='inquiry-submit']"
```

Add a comment in the fixture file noting these are placeholder selectors pending Rafał's SvelteKit
implementation.

### AC 6 — Tests

- ≥3 SDK tests: inquiry form observer emits `inquiry.started` on trigger, event has correct payload
  shape, gated on consent_state
- ≥3 API route tests: auth check, empty data returns zeros, known fixture data returns correct rates

### AC 7 — Corpus CI gate

Run `pnpm test:corpus` in `packages/sdk` after any SDK changes to confirm the 24-platform
auto-detection corpus remains 100/100. The inquiry selector additions must not break detection
precision/recall.

---

## Key files to read first

- `packages/sdk/src/auto-detect/__fixtures__/000-app-estalara/detail-ground-truth.json` — current
  detail page selectors
- `packages/sdk/src/auto-detect/__fixtures__/000-app-estalara/index-ground-truth.json` — index page
  selectors (listing_card_selector, container_selector, etc.)
- `packages/shared/src/schemas/events/inquiry.ts` — `InquiryStartedEventSchema` and
  `InquiryCompletedEventSchema`
- `packages/sdk/src/core/` — SDK init and observer wiring
- `apps/control-plane/src/app/api/pilot/cta-lift/route.ts` (from TICKET-PILOT-003) — ClickHouse
  query pattern to follow

---

## Coordination with TICKET-PILOT-003

Both tickets create routes under `/api/pilot/` and panels on the pilot dashboard. Coordinate to
avoid conflicting dashboard code — use a simple import-based composition (each panel is its own
component, the page assembles them).

---

## Definition of Done

- [ ] `000-app-estalara` detail-ground-truth.json includes inquiry form selectors (placeholder
      values OK)
- [ ] SDK emits `inquiry.started` when inquiry form is opened/submitted
- [ ] `GET /api/pilot/inquiry-starts` route exists with correct response schema
- [ ] Dashboard panel for inquiry starts added
- [ ] `pnpm test:corpus` still 100/100
- [ ] ≥6 tests total (SDK + API)
- [ ] Standard CI green
