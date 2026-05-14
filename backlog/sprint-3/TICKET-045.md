# TICKET-045 — E2E Test: Full Observer Flow (page.view → scroll → cta.clicked)

**Sprint:** 3 **Agent:** qa-engineer **Priority:** P0 **Estimated hours:** 4 **Status:** BLOCKED
**Depends on:** TICKET-039 (Playwright integration tests), TICKET-041 (consent banner), TICKET-042
(Decision API integration in sidebar) **Unblocks:** Sprint 3 DONE

## Context

This ticket completes the Sprint 3 exit criteria: a full E2E happy-path test that validates the
entire Tier 1 Observer flow from page load through consent, behavioral signal collection, archetype
detection, directive fetch, and sidebar display.

This test runs against the **demo fixture page** (or `packages/sdk/e2e/fixtures/index.html`) with
real mock servers for ingest and decision API. It does NOT require ClickHouse — it verifies the
SDK-side flow only.

**References:**

- `packages/sdk/e2e/sdk.spec.ts` — existing SDK tests (read first)
- `packages/sdk/e2e/serve.js` — mock server for ingest + decision API
- `packages/sdk/e2e/fixtures/index.html` — HTML fixture
- `packages/sdk/playwright.config.ts` — Playwright config
- TICKET-039 test patterns (sidebar-widget.spec.ts)
- TICKET-041 consent banner (must be accepted in E2E flow)

## What to build

New test file: `packages/sdk/e2e/observer-e2e.spec.ts`

### Full happy-path test

```typescript
test('Full Tier 1 Observer flow: consent → page.view → scroll → archetype detect → sidebar show', async ({
  page,
}) => {
  // Step 1: Load test fixture page
  await page.goto('/');

  // Step 2: Consent banner appears (TICKET-041)
  const consentBanner = page
    .locator('[data-estalara-host]')
    .locator('css=.estalara-consent-banner');
  await expect(consentBanner).toBeVisible({ timeout: 5000 });

  // Step 3: Accept consent
  const acceptBtn = consentBanner.locator('css=.estalara-consent-banner__accept');
  await acceptBtn.click();
  await expect(consentBanner).not.toBeVisible();

  // Step 4: page.view event dispatched to ingest
  // (mock server records events — check via page.evaluate or mock server state)
  const pageViewEvent = await waitForIngestEvent(page, 'page.view');
  expect(pageViewEvent).toBeDefined();

  // Step 5: Scroll past listing cards to trigger listing.viewed events
  for (let i = 0; i < 3; i++) {
    await page.locator(`.listing-card:nth-child(${i + 1})`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  }

  // Step 6: listing.viewed events dispatched
  const listingViewedEvents = await getIngestEvents(page, 'listing.viewed');
  expect(listingViewedEvents.length).toBeGreaterThanOrEqual(1);

  // Step 7: Decision API called with session + intent state
  const decisionCall = await waitForDecisionApiCall(page);
  expect(decisionCall.tenant_id).toBeDefined();
  expect(decisionCall.session_id).toBeDefined();

  // Step 8: Mock Decision API returns yield_hunter archetype
  // (pre-configured mock in serve.js returns yield_hunter at confidence 0.85)
  // Assert: sidebar widget appears with archetype label
  const sidebar = page.locator('[data-estalara-host]').locator('css=.estalara-sidebar');
  await expect(sidebar).toBeVisible({ timeout: 8000 });
  await expect(sidebar).toContainText('Yield Hunter');

  // Step 9: Click CTA element on the page
  await page.locator('[data-estalara-slot="cta"]').first().click();

  // Step 10: cta.clicked event dispatched
  const ctaEvent = await waitForIngestEvent(page, 'cta.clicked');
  expect(ctaEvent).toBeDefined();
});
```

### Helper functions (add to `packages/sdk/e2e/helpers.ts`)

```typescript
// waitForIngestEvent — polls mock server state for event of given type
// waitForDecisionApiCall — waits for the mock decision endpoint to be called
// getIngestEvents — returns all captured events of given type
```

## Acceptance criteria

- [ ] `packages/sdk/e2e/observer-e2e.spec.ts` exists with the full happy-path test
- [ ] `packages/sdk/e2e/helpers.ts` exports `waitForIngestEvent`, `waitForDecisionApiCall`,
      `getIngestEvents` utilities
- [ ] Test passes in `pnpm --filter @estalara/sdk test:e2e`
- [ ] Test covers all 10 steps above in order
- [ ] Consent banner is accepted in step 3 (test explicitly tests the gated flow)
- [ ] Mock server in `serve.js` is updated to record event history and expose `GET /mock-state`
      endpoint that returns all captured events (for assertions)
- [ ] Test is deterministic (no `await page.waitForTimeout(N)` hardcoded — use `waitForSelector`
      with conditions instead; the 300ms delay in step 5 is acceptable for scroll simulation)
- [ ] Test runs in CI (`pnpm --filter @estalara/sdk test:e2e` in `.github/workflows/ci.yml`)

## Sprint 3 exit criteria gate

This ticket is the last dependency for Sprint 3 DONE. When this test passes in CI:

- `@estalara/sdk@1.0.0-beta.1` is ready to publish (trigger TICKET-043 workflow)
- Sprint 3 complete — Tier 1 Observer widget is shipped and verifiable end-to-end
