# TICKET-044 — SDK Demo Integration (Embed on Demo Listing Page)

**Sprint:** 3 **Agent:** sdk-engineer **Priority:** P1 **Estimated hours:** 4 **Status:** BLOCKED
**Depends on:** TICKET-037 (sidebar widget), TICKET-DEMO-002 (merged PR #48) **Unblocks:**
TICKET-045

## Context

TICKET-DEMO-002 (PR #48) shipped the demo mock-up listings page at
`apps/control-plane/src/app/dashboard/demo/mockup/page.tsx` with 12 mock listings and filters. This
ticket embeds the `@estalara/sdk` IIFE on that demo page so it initializes, fires events, and shows
the sidebar widget — giving agency prospects a live demo of the product.

**References:**

- `apps/control-plane/src/app/dashboard/demo/mockup/page.tsx` — demo listings page (embed target)
- `packages/sdk/dist/estalara-sdk.iife.js` — built SDK (must be built before running demo)
- `packages/sdk/e2e/fixtures/index.html` — example of how to embed the IIFE via `<script>` tag
- `docs/MASTER_DESIGN.md` section T (Demo Mode v5)

## What to build

### 1. SDK script tag in demo page

In `apps/control-plane/src/app/dashboard/demo/mockup/page.tsx`, add a `<Script>` tag (Next.js):

```tsx
import Script from 'next/script';

// Inside the component, before </body>:
<Script
  src="/sdk/estalara-sdk.iife.js"
  data-api-key="demo_key_placeholder"
  data-tenant-id="demo-tenant-00000000-0000-0000-0000-000000000000"
  data-tier="observer"
  data-debug="true"
  data-decision-url="/api/adapt"
  data-ingest-url="/api/ingest-stub"
  data-accent-color="#2563EB"
  data-language="en"
  strategy="afterInteractive"
/>;
```

### 2. Serve SDK from control-plane

Two options (choose based on simplicity):

**Option A (preferred for demo):** Copy the built `dist/estalara-sdk.iife.js` into
`apps/control-plane/public/sdk/estalara-sdk.iife.js` as part of the Turborepo build pipeline. Add to
`turbo.json` pipeline: `control-plane#build` depends on `@estalara/sdk#build` and copies the IIFE to
`public/sdk/`.

**Option B (simpler):** Use the CDN URL for the npm-published package once TICKET-043 ships. For the
demo, use a relative path with Option A.

Add a `turbo.json` script in `packages/sdk/package.json`:

```json
"copy:iife": "cp dist/estalara-sdk.iife.js ../../apps/control-plane/public/sdk/estalara-sdk.iife.js"
```

### 3. Demo API key validation stub

The demo page uses `data-api-key="demo_key_placeholder"`. The Decision API (`/api/adapt`) must not
reject this key during demo mode. Add a check in `apps/control-plane/src/app/api/adapt/route.ts`:

```typescript
// Allow demo key for authenticated demo pages
const DEMO_API_KEY = 'demo_key_placeholder';
const isDemoRequest = apiKey === DEMO_API_KEY && isDemoSession(req);
```

OR use the existing `DEMO_TENANT_ID` logic if it exists from TICKET-DEMO-001.

### 4. Mock listings with data-estalara-slot attributes

Add `data-estalara-slot="headline"`, `data-estalara-slot="cta"`, `data-estalara-slot="feature"`
attributes to the listing card components in `mockup/page.tsx` so the SDK can apply directives. Also
add `data-estalara-listing` and `data-estalara-listing-id` attributes for observer tracking.

## Acceptance criteria

- [ ] `apps/control-plane/public/sdk/estalara-sdk.iife.js` exists (populated by `build:copy-iife` or
      equivalent pipeline step)
- [ ] Demo page at `/dashboard/demo/mockup` loads the SDK via `<Script>` tag
- [ ] On page load, SDK initializes without throwing (verify via browser console, no
      `[Estalara]     Initialization error`)
- [ ] SDK fires a `page.view` event (verify in browser network tab to `/api/ingest-stub`)
- [ ] After scrolling past 3 listing cards, the SDK fires `listing.viewed` events
- [ ] If Decision API returns a non-neutral archetype, the sidebar widget appears
- [ ] Demo listing cards have `data-estalara-slot` attributes so directives can be applied
- [ ] The `/dashboard/demo/mockup` route is accessible to authenticated users (no auth regression)

## Notes

- This is a demo-mode integration — it does NOT need production SDK versioning
- The demo key (`demo_key_placeholder`) is not a secret and is safe to commit
- If the SDK is not yet npm-published (TICKET-043 pending), the build-and-copy approach (Option A)
  is correct for the demo. Switch to CDN after npm publish.
