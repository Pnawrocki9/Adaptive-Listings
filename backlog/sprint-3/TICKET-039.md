# TICKET-039 — SDK Integration Tests (Playwright + Host Page Fixture)

**Sprint:** 3 **Agent:** qa-engineer **Priority:** P0 **Estimated hours:** 6 **Status:** BLOCKED
**Depends on:** TICKET-037 (sidebar widget), TICKET-038 (tsup gate) **Unblocks:** TICKET-045

## Context

The SDK has a Playwright test harness at `packages/sdk/e2e/` with `sdk.spec.ts`,
`adapt-dom-mutations.spec.ts`, `observer-flow.spec.ts`, and a host page fixture at
`packages/sdk/e2e/fixtures/index.html`. These tests cover behavioral signal collection and DOM
mutations. This ticket adds integration tests specifically for the **sidebar widget** and the
**Shadow DOM isolation guarantee**.

**References:**

- `packages/sdk/e2e/sdk.spec.ts` — existing SDK tests (read for patterns)
- `packages/sdk/e2e/fixtures/index.html` — HTML fixture for the test host page
- `packages/sdk/playwright.config.ts` — Playwright config
- `packages/sdk/e2e/serve.js` — mock server for ingest + decision API

## What to build

New test file: `packages/sdk/e2e/sidebar-widget.spec.ts`

### Test coverage required

```typescript
// Test 1: Shadow DOM mount
test('SDK mounts Shadow DOM host on the host page', async ({ page }) => {
  // Assert: [data-estalara-host] element exists in the DOM
  // Assert: it has a shadow root (open mode)
});

// Test 2: Sidebar shows after fetchDirectives returns non-neutral archetype
test('Sidebar appears when Decision API returns archetype with confidence >= 0.6', async ({
  page,
}) => {
  // Intercept /mock-decision to return { archetype: 'yield_hunter', confidence: 0.85, directives: [...] }
  // Assert: .estalara-sidebar becomes visible inside Shadow DOM
  // Assert: archetype name 'Yield Hunter' appears in sidebar text
});

// Test 3: Sidebar close button hides it
test('Sidebar close button hides the sidebar', async ({ page }) => {
  // Open sidebar as above, click × button
  // Assert: sidebar is no longer visible
});

// Test 4: Shadow DOM isolation — host page CSS does NOT leak into widget
test('Host page CSS does not bleed into Shadow DOM widget', async ({ page }) => {
  // Inject `<style>* { color: red !important; }</style>` into host page
  // Assert: sidebar text color is NOT rgb(255, 0, 0)
});

// Test 5: Shadow DOM isolation — widget CSS does NOT leak into host page
test('Widget CSS does not bleed out to host page', async ({ page }) => {
  // Check that a host page <h1> element has its natural color (not affected by widget CSS)
});

// Test 6: Drag handle moves the sidebar
test('Drag handle allows vertical repositioning', async ({ page }) => {
  // Find .estalara-sidebar__drag-handle inside Shadow DOM
  // Simulate drag: mousedown at handle, mousemove 50px down, mouseup
  // Assert: sidebar top position changed by ~50px
});
```

## Acceptance criteria

- [ ] `packages/sdk/e2e/sidebar-widget.spec.ts` exists with the 6 test cases above
- [ ] All 6 tests pass in `pnpm --filter @estalara/sdk test:e2e`
- [ ] Shadow DOM bleed-through test explicitly fails if any CSS leaks across the boundary
- [ ] Tests use the existing mock server from `packages/sdk/e2e/serve.js` — add a new
      `/mock-decision-widget` route that returns a `yield_hunter` archetype response with sample
      directives
- [ ] All tests are deterministic (no flaky timing — use `page.waitForSelector` with appropriate
      conditions, not hardcoded `sleep`)
- [ ] Tests run in CI (verify they are included in `pnpm --filter @estalara/sdk test:e2e`)

## Notes

The Shadow DOM query pattern in Playwright: use `page.locator('[data-estalara-host]')` to get the
host element, then pierce the shadow root using `>>` combinator or `locator.evaluate()`:

```typescript
const shadowHost = page.locator('[data-estalara-host]');
const sidebar = shadowHost.locator('css=.estalara-sidebar'); // Playwright auto-pierces shadow DOM
```

Playwright 1.x automatically pierces open shadow roots for CSS selectors, so standard
`page.locator()` calls work inside shadow roots for open-mode shadows.
