# TICKET-032 — AI Vision Auto-Detect Pipeline

**Sprint:** 2.5 **Agent:** ml-engineer **Priority:** P0 **Estimated hours:** 10 **Status:** BLOCKED
**Depends on:** TICKET-030 (onboarding wizard, provides tenant_id + site_url at invocation time)
**Unblocks:** TICKET-033

## Context

Master Design sections B.4.3 and B.5.1 describe a layered detection strategy. The deterministic
layers (L1 Schema.org JSON-LD, L2 microdata, L3 platform fingerprint, L4 heuristics) are already
implemented in `packages/sdk/src/auto-detect/` (Sprint 7.5 — TICKET-AUTO-001 through AUTO-005,
corpus CI gate at 100%/100% on 24 platforms). Those techniques run in-browser and server-side.

This ticket implements the remaining layer: **L5 AI Vision** — a Modal serverless Python function
that takes a tenant URL, screenshots it with Playwright, sends the screenshot and HTML to Claude
Sonnet 4.6 Vision, and returns a structured schema. It also implements the cross-check logic: if the
deterministic detector already matched a known platform with confidence >= 0.85, the Vision pipeline
is skipped and the deterministic result is returned directly (saving the $0.33 Vision cost).

The output of this ticket is `apps/auto-detect/src/vision_pipeline.py` — a Modal app exposable as an
HTTP endpoint that TICKET-033's Next.js API route will invoke.

**References:**

- `docs/MASTER_DESIGN.md` sections B.4.3, B.5.1 — Vision detection flow and layered detection table
- `apps/auto-detect/src/main.py` — existing placeholder (replace, do not append)
- `packages/sdk/src/auto-detect/pipeline.ts` — deterministic pipeline entry point to cross-check
  against (TypeScript, invoked as a subprocess or via a pre-built output — see implementation notes)
- `packages/sdk/src/auto-detect/__fixtures__/` — 24-platform corpus for regression testing
- `packages/platform-templates/src/` — template types and registry (populated by TICKET-034)

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **Modal app structure.** `apps/auto-detect/src/vision_pipeline.py` defines a Modal app with:
   - A `@app.function` named `detect_listing_schema` decorated with appropriate resource settings
     (timeout 120s, memory 1024MB, allow Playwright browser install via `playwright` layer).
   - A `@app.local_entrypoint` for local testing.
   - The function is web-exposed via `@app.web_endpoint(method="POST")` at path `/detect`, accepting
     JSON body `{ "url": str, "tenant_id": str, "sample_listing_url": str | None }`.

2. **Step 1 — Playwright screenshot.** The function launches a Playwright Chromium headless browser,
   navigates to the provided URL with a 30-second timeout, and captures:
   - A full-page screenshot at 1920x1080 viewport (scroll the full page height).
   - The full DOM HTML (`page.content()`), truncated to 50KB for the Vision prompt. Both are
     obtained in a single browser session. Browser is closed after capture.

3. **Step 2 — Deterministic cross-check.** Before invoking Vision, the function calls the
   deterministic detection logic. Because the deterministic detector is TypeScript (`packages/sdk`),
   it is invoked by making an HTTP call to the `POST /api/detect` route in the Next.js control-plane
   (already live from AUTO-006, PR #77). Pass `{ url, html }` as the request body. If the response
   contains `detectionConfidence >= 0.85`, return that result immediately without proceeding to
   Vision. Record `detection_source: 'deterministic'` in the output.

4. **Step 3 — Claude Sonnet 4.6 Vision call.** If deterministic confidence is below 0.85, call the
   Anthropic API (`claude-sonnet-4-6`, `max_tokens: 2048`) with a multipart message containing the
   screenshot (base64 JPEG) and the HTML snippet. The prompt must request JSON output matching:

   ```json
   {
     "page_type": "property_listing | search_results | other",
     "platform_guess": "string | null",
     "elements": {
       "title": { "css_selector": "string", "confidence": 0.0 },
       "price": { "css_selector": "string", "confidence": 0.0, "currency": "string" },
       "photos": { "css_selector": "string", "confidence": 0.0 },
       "features": { "css_selector": "string", "confidence": 0.0 },
       "description": { "css_selector": "string", "confidence": 0.0 },
       "location": { "css_selector": "string", "confidence": 0.0 }
     },
     "adaptable_slots": ["headline", "photos", "features"]
   }
   ```

   Parse the JSON from the first content block. If parsing fails (malformed JSON), return an error
   result with `confidence: 0` rather than raising an exception.

5. **Step 4 — Template match cross-check.** After Vision returns, call `matchPlatform(url, html)`
   from `packages/platform-templates/` (TICKET-034). If a template matches with confidence >= 0.85,
   merge: use the template's selectors as the authoritative source and annotate
   `detection_source: 'platform_template'`. Otherwise annotate `detection_source: 'ai_vision'`.

6. **Output schema.** The function returns JSON:

   ```json
   {
     "template_id": "string | null",
     "detection_source": "deterministic | platform_template | ai_vision",
     "confidence": 0.0,
     "schema": {
       "title": { "css_selector": "string", "confidence": 0.0 },
       "price": { "css_selector": "string", "confidence": 0.0, "currency": "string" },
       "photos": { "css_selector": "string", "confidence": 0.0 },
       "features": { "css_selector": "string", "confidence": 0.0 },
       "description": { "css_selector": "string", "confidence": 0.0 },
       "location": { "css_selector": "string", "confidence": 0.0 }
     },
     "needs_review": ["list of low-confidence field names"],
     "screenshot_b64": "string | null"
   }
   ```

   `confidence` is the minimum across all required field confidences (title, price, photos).
   `needs_review` lists fields with per-field confidence < 0.7.

7. **Cost guard.** If `detection_source` is `deterministic` or `platform_template`, the Anthropic
   API must not be called. Add an assertion in the test suite verifying zero Vision API calls when
   deterministic confidence >= 0.85.

8. **Error handling.** Network timeouts, Playwright crashes, and Anthropic API errors are caught and
   returned as `{ "error": "string", "confidence": 0, "schema": {} }` rather than HTTP 500. The
   caller (TICKET-033) handles error results by marking detection as failed in the SSE stream.

9. **Corpus regression gate.** Run `pnpm test:corpus` (from TICKET-AUTO-005). The 24-platform corpus
   tests must remain green — this Python pipeline must not break any existing TypeScript auto-detect
   logic.

10. **Python test coverage >= 70%.** Tests in `apps/auto-detect/tests/test_vision_pipeline.py` using
    `pytest` and `unittest.mock`.

11. **`pyproject.toml` updated.** Add `playwright`, `anthropic`, `httpx` to the dependencies block.
    Confirm `build-backend = "setuptools.build_meta"` (NOT `setuptools.backends.legacy`).

## Files to touch

| File                                             | Action                                                         |
| ------------------------------------------------ | -------------------------------------------------------------- |
| `apps/auto-detect/src/vision_pipeline.py`        | NEW — Modal app with `detect_listing_schema` function          |
| `apps/auto-detect/src/main.py`                   | REPLACE placeholder with import + re-export of vision_pipeline |
| `apps/auto-detect/pyproject.toml`                | ADD — `playwright`, `anthropic`, `httpx` dependencies          |
| `apps/auto-detect/tests/test_vision_pipeline.py` | NEW — pytest test suite                                        |
| `apps/auto-detect/src/__init__.py`               | VERIFY — must exist and be non-empty (import guard)            |

## Implementation notes

- **Playwright in Modal**: use
  `modal.Image.debian_slim().run_commands("playwright install chromium")` or the
  `modal.Image.from_registry("mcr.microsoft.com/playwright/python:v1.44.0-jammy")` base image. Check
  Modal's current Playwright guidance before choosing — the image approach is simpler.
- **Calling the Next.js detect endpoint from Python**:
  `httpx.post(f"{CONTROL_PLANE_URL}/api/detect", json={"url": url, "html": html[:50000]})`. Read
  `CONTROL_PLANE_URL` from a Modal Secret named `estalara-control-plane` (add to `.env.example`). If
  the control-plane URL is unavailable in the Modal environment, fall back to running the heuristics
  inline (Schema.org JSON-LD parse in Python) rather than blocking the Vision step.
- **Anthropic client in Modal**: use `anthropic.Anthropic()` which reads `ANTHROPIC_API_KEY` from
  environment. Add `ANTHROPIC_API_KEY` to the `estalara-secrets` Modal Secret (already exists from
  TICKET-009 Terraform — verify before adding a duplicate).
- **Screenshot encoding**: `page.screenshot(full_page=True)` returns bytes. Encode to base64 with
  `base64.b64encode(screenshot_bytes).decode()`. Pass as `media_type: "image/jpeg"` in the Anthropic
  message (Playwright default is PNG — convert with Pillow or pass `type="jpeg"` to
  `page.screenshot`).

## Test expectations

### Unit tests (required, in `tests/test_vision_pipeline.py`)

1. **Deterministic short-circuit.** Mock the control-plane HTTP call to return
   `{ detectionConfidence: 0.95, ... }`. Assert `detect_listing_schema` returns without calling the
   Anthropic API (mock Anthropic client and assert `create` was not called).

2. **Vision fallback triggered.** Mock control-plane returning `{ detectionConfidence: 0.60 }`.
   Assert the Anthropic client `create` is called exactly once.

3. **Malformed Vision JSON.** Mock Anthropic to return `"not json"` as the content. Assert the
   function returns `{ "confidence": 0, "error": "json_parse_failed" }` without raising.

4. **Template match overrides Vision.** Mock `matchPlatform` to return a template with
   `confidence: 0.99`. Assert the output `detection_source` is `"platform_template"` and the
   template's selectors appear in the output schema.

5. **Needs-review population.** Construct a mock Vision response where `photos.confidence = 0.5`.
   Assert `"photos"` appears in `needs_review`.

6. **Playwright timeout.** Mock Playwright `page.goto` to raise `TimeoutError`. Assert the function
   returns an error result (not a Python exception propagated to the caller).

## Branch naming

`ml-engineer/TICKET-032-ai-vision-auto-detect-pipeline`

## PR title format

`feat(auto-detect): AI Vision Auto-Detect pipeline — Playwright screenshot + Sonnet 4.6 Vision + deterministic cross-check [TICKET-032]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- PM-orchestrator validates AC items above.
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
