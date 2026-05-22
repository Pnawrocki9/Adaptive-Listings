# FOLLOW-055 — End-to-end integration test: detect → activate → adapt → SDK

**Sprint:** 10 **Agent:** qa-engineer **Priority:** P0 **Estimated hours:** 5 **Status:**
IN_PROGRESS **Model:** sonnet-4.6 **Branch:** `qa-engineer/FOLLOW-055-e2e-demo-test`

## Context

Sprint 9.5 shipped 6 PRs touching the full onboarding + adaptation pipeline. Each PR tested its
slice in isolation with heavy mocking. **No test verifies the assembled flow** — the chain that the
investor demo depends on:

```
POST /api/detect
  → POST /api/schema/activate
    → snippet rendered with valid data-tenant-id + data-api-key
      → POST /api/adapt returns variant + ReorderDirective
        → SDK applyDirectives() mutates DOM
          → POST /api/adapt/feedback fires (post-FOLLOW-041 landing)
```

From RETRO-005 §4c: "the sprint's whole-product promise is 'investor demo works end-to-end' but no
test verifies the assembly."

**Approach:** Playwright spec running against `localhost:3000` (or a Vercel Preview URL) with:

- Anthropic AI Vision mocked (deterministic — return a known fixture schema)
- OpenAI embeddings mocked (fixed 1024-dim vectors so cosine scores are deterministic)
- Real Next.js routes (detect, activate, adapt) — no server mocks
- JSDOM or real browser for SDK apply + DOM mutation assertions

## Acceptance criteria

1. **Spec file at `tests/e2e/sprint-9-5-demo.spec.ts`** (Playwright).

2. **Setup: test tenant + seeded data.**
   - Create a test tenant via the Supabase admin client (or use fixture `est_test_e2e_tenant`).
   - Seed `ab_bandit_weights` with 3 arms (control/v1/v2, Beta(1,1)) for one archetype.
   - Seed `listing_embeddings` with 5 listings using fixed vectors (e.g. `[0.1, 0.2, ..., 0.0]`
     repeated to 1024 dims). Seed `archetype_embeddings` with a matching fixed vector for
     `yield_hunter` so cosine similarity produces a deterministic ordering.

3. **Step 1 — detect.** POST to `/api/detect` with `{ url: 'https://example.com' }` and the test
   tenant JWT. Mock Anthropic (MSW or `vi.mock`) to return a fixed `TenantSiteSchema`:

   ```json
   {
     "container_selector": "[data-estalara-listings-grid]",
     "item_selector": "[data-estalara-listing-id]",
     "reorder_capable": true,
     "detection_confidence": 0.99,
     "detection_source": "data_estalara"
   }
   ```

   Assert: response status 200, `schema.container_selector` matches fixture.

4. **Step 2 — activate.** POST to `/api/schema/activate` with the schema from step 1 and tenant JWT.
   Assert:
   - Response status 200
   - `snippet` contains `data-tenant-id="<test-tenant-id>"`
   - `snippet` contains `data-api-key=` with a non-empty key

5. **Step 3 — adapt.** POST to `/api/adapt` with:
   - Valid tenant JWT + `archetype_hint: 'yield_hunter'`
   - `listing_ids: ['listing-001', 'listing-002', 'listing-003', 'listing-004', 'listing-005']`
     Assert:
   - Response status 200
   - `variant` field present and non-empty string
   - `directives` array contains at least one `TextDirective`
   - `directives` array contains a `ReorderDirective` (type: `'reorder'`)
   - ReorderDirective `scores` array is sorted descending (cosine math — not random)
   - **If FOLLOW-041 has landed:** assert the response body has `variant` that matches the
     sessionStorage-cached value (test as a conditional — skip if SDK version < FOLLOW-041).

6. **Step 4 — SDK DOM mutation.** Using Playwright's browser context:
   - Render a minimal HTML page with 5 listing cards (each with `data-estalara-listing-id`) and a
     container `data-estalara-listings-grid`
   - Load the SDK (bundled or from `packages/sdk/src/index.ts` via Vite in test mode)
   - Call `applyDirectives(response.directives, context)`
   - Assert: the first card's `data-estalara-listing-id` matches the highest-scored listing from
     step 3's ReorderDirective (DOM order changed)
   - Assert: at least one slot's text content changed (TextDirective applied)

7. **Step 5 — feedback ping (conditional).** If `FOLLOW-041` has landed (detect via
   `typeof window.sessionStorage.getItem('estalara_variant:TEST_SESSION') !== 'undefined'`):
   - Dispatch `inquiry.completed` event on the page
   - Assert: `fetch` was called with URL `/api/adapt/feedback` and body containing
     `{ converted: true, variant: <the served variant> }`

8. **CI integration.** The spec runs in `pnpm test:e2e` (existing Playwright config at
   `playwright.config.ts`). It must be tagged so it only runs when the full stack is up — add `@e2e`
   or use `projects: ['e2e']` config. Add to the CI `e2e` job or create a new `demo-integration` job
   that runs on pushes to `apps/control-plane/**` or `packages/sdk/**`.

9. **Mocking strategy.** Use MSW (if already in the project) or `vi.spyOn(global, 'fetch')` for
   Anthropic and OpenAI calls only. All Estalara API routes hit the real Next.js server.

10. **No flakes.** The test must pass 5 consecutive runs without modification. Use deterministic
    fixtures (fixed vectors, fixed JWT, fixed archetype) to ensure reproducibility.

## Key files to read before starting

- `apps/control-plane/src/app/api/detect/route.ts` — detect endpoint (POST body schema, response
  shape)
- `apps/control-plane/src/app/api/schema/activate/route.ts` — activate endpoint
- `apps/control-plane/src/app/api/adapt/route.ts` — adapt endpoint (variant + ReorderDirective)
- `packages/sdk/src/core/adapt.ts` — `AdaptResponse`, `fetchDirectives()`, `applyDirectives()`
- `playwright.config.ts` — existing Playwright setup
- `tests/e2e/` — existing e2e specs for pattern reference

## Definition of done

- `tests/e2e/sprint-9-5-demo.spec.ts` committed and passing in CI
- `gh pr checks <pr-number> --watch` all SUCCESS (ignore: Doppler, Rule I, Python tests)
- PM-orchestrator validates all AC items and comments:
  `PM-validated. CI green. Ready for human review.`
- QUEUE.md: FOLLOW-055 → `READY_FOR_REVIEW`
