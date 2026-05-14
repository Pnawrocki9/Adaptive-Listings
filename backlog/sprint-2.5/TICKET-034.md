# TICKET-034 — Platform Templates Library (5 Core Templates)

**Sprint:** 2.5 **Agent:** ml-engineer **Priority:** P1 **Estimated hours:** 6 **Status:** BLOCKED
**Depends on:** TICKET-033 (Schema Discovery API — establishes what `template_id` looks like in the
detection output) **Unblocks:** TICKET-035, TICKET-036

## Context

`packages/platform-templates/` was scaffolded in Sprint 0 (TICKET-006, PR #11). The types and Zod
schemas exist in `packages/platform-templates/src/types.ts`. The template registry
(`src/templates/index.ts`) exports an empty array — the comment says "populated in TICKET-032" but
that reference was to an earlier ticket numbering. This ticket is the correct implementor.

Master Design B.4.4 targets 15 templates at MVP (top 3 platforms per region: ES/UK/PL/US/UAE). This
ticket delivers the first 5 — one per region — plus the `matchPlatform()` helper that the Vision
pipeline (TICKET-032) calls. TICKET-036 fills in the remaining 10+.

The `matchPlatform()` function is called from Python (TICKET-032) via the Node subprocess or via the
Next.js `/api/detect` endpoint. It must therefore also be importable from the compiled
`packages/platform-templates/dist/` build. The template data lives in TypeScript; no Python
reimplementation is needed.

**References:**

- `docs/MASTER_DESIGN.md` section B.4.4 — known platform selector examples (Idealista, Rightmove,
  Otodom, Zillow, Bayut) with exact CSS selectors
- `packages/platform-templates/src/types.ts` — `PlatformTemplate`, `MatchResult` Zod schemas (read
  before implementing — do not redefine types)
- `packages/platform-templates/src/templates/index.ts` — empty registry to populate
- `packages/platform-templates/src/index.ts` — main entry point (check existing exports)
- `packages/platform-templates/vitest.config.ts` — test runner already configured

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **Five reference templates implemented.** The `templates` array in `src/templates/index.ts`
   contains exactly these five entries, each conforming to `PlatformTemplateSchema`:

   | Template ID    | Platform          | Region | Hostname matchers |
   | -------------- | ----------------- | ------ | ----------------- |
   | `idealista-es` | Idealista (Spain) | ES     | `idealista.com`   |
   | `rightmove-uk` | Rightmove (UK)    | UK     | `rightmove.co.uk` |
   | `otodom-pl`    | Otodom (Poland)   | PL     | `otodom.pl`       |
   | `zillow-us`    | Zillow (US)       | US     | `zillow.com`      |
   | `bayut-uae`    | Bayut (UAE)       | UAE    | `bayut.com`       |

   Each template populates selectors for at minimum: `title`, `price`, `photos`, `features`,
   `location`. Selector values are taken from the Master Design B.4.4 code block (exact CSS
   selectors documented there). `confidence: 0.99` for all five (known platforms).

2. **`matchPlatform()` function.** Exported from `src/index.ts`:

   ```typescript
   function matchPlatform(url: string, html: string): MatchResult | null;
   ```

   Logic (in order):
   - Extract hostname from `url`. If any template's `hostnameMatchers` includes that exact hostname
     (or the hostname ends with it, e.g. `www.idealista.com` matches `idealista.com`), return that
     template as a match with `confidence: template.confidence`.
   - If no hostname match, iterate templates and check `domSignatures`: query each signature string
     against the `html` as a substring (or simple regex — not a full DOM parse, since this runs
     server-side on raw HTML strings). If all `domSignatures` are present in the HTML, return a
     match with `confidence: template.confidence * 0.9` (slight penalty for HTML-string matching vs.
     real hostname match).
   - If no template matches, return `null`. The function must not throw on malformed URLs — wrap
     `new URL(url)` in try/catch and return `null` on parse failure.

3. **`listTemplates()` helper.** Exported from `src/index.ts`:

   ```typescript
   function listTemplates(): PlatformTemplate[];
   ```

   Returns the full registry array. Used by the Vision pipeline to enumerate available templates.

4. **`getTemplate(id: string)` helper.** Exported from `src/index.ts`:

   ```typescript
   function getTemplate(id: string): PlatformTemplate | undefined;
   ```

   Returns the template with the given `id`, or `undefined` if not found.

5. **All exports type-safe.** All four exports (`templates`, `matchPlatform`, `listTemplates`,
   `getTemplate`) are correctly typed. No `any`. The package builds without TypeScript errors:
   `pnpm --filter @estalara/platform-templates build`.

6. **Unit tests in `packages/platform-templates/__tests__/`.** Vitest. See test expectations below.

7. **Test coverage >= 80%** (library bar, per quality gate in CLAUDE.md).

8. **`pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass locally.**

## Files to touch

| File                                                      | Action                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| `packages/platform-templates/src/templates/index.ts`      | REPLACE — populate `templates` array with 5 entries             |
| `packages/platform-templates/src/index.ts`                | EXTEND — export `matchPlatform`, `listTemplates`, `getTemplate` |
| `packages/platform-templates/src/match.ts`                | NEW — `matchPlatform` implementation                            |
| `packages/platform-templates/__tests__/match.test.ts`     | NEW — matchPlatform unit tests                                  |
| `packages/platform-templates/__tests__/templates.test.ts` | NEW — template schema validation tests                          |
| `packages/platform-templates/tests/smoke.test.ts`         | UPDATE — extend existing smoke test                             |

## Implementation notes

- **Selector values**: the Master Design B.4.4 code block shows real selectors for Idealista,
  Otodom, and Rightmove. For Zillow and Bayut, use the selectors from the corpus fixtures in
  `packages/sdk/src/auto-detect/__fixtures__/008-zillow/` and
  `packages/sdk/src/auto-detect/__fixtures__/012-bayut/` — read the ground-truth JSON files to find
  the correct selectors rather than guessing.
- **`domSignatures` population**: each template should have 2–3 DOM signature strings that uniquely
  identify the platform (e.g. for Idealista: `'main-info__title-main'`, `'info-data-price'`). These
  are substrings of the HTML, not CSS selectors requiring a DOM — keep them as class name fragments.
- **Build check**: the `tsconfig.build.json` already exists. After implementing, run
  `pnpm --filter @estalara/platform-templates build` and confirm the `dist/` output is generated
  before opening the PR.

## Test expectations

### Unit tests (required)

1. **All 5 templates pass Zod schema validation.** Iterate `listTemplates()` and run
   `PlatformTemplateSchema.parse(t)` on each. Assert no throw.

2. **Hostname match — exact.** Call `matchPlatform('https://www.idealista.com/inmueble/123', '')`
   Assert result is non-null, `templateId === 'idealista-es'`, `confidence === 0.99`.

3. **Hostname match — subdomain.** Call
   `matchPlatform('https://rightmove.co.uk/properties/123', '')` Assert result is non-null,
   `templateId === 'rightmove-uk'`.

4. **DOM signature fallback.** Call
   `matchPlatform('https://custom.com', '<div class="info-data-price">...')`. Assert result is
   non-null and `confidence < 0.99` (penalty applied).

5. **No match.** Call `matchPlatform('https://unknown-site.com', '<html>nothing here</html>')`.
   Assert result is `null`.

6. **Malformed URL.** Call `matchPlatform('not-a-url', '')`. Assert returns `null` without throwing.

7. **`getTemplate` by ID.** `getTemplate('zillow-us')` returns the Zillow template.
   `getTemplate('nonexistent')` returns `undefined`.

8. **`listTemplates` length.** `listTemplates().length === 5` (will increase in TICKET-036).

## Branch naming

`ml-engineer/TICKET-034-platform-templates-core`

## PR title format

`feat(platform-templates): 5 core platform templates + matchPlatform() helper [TICKET-034]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- PM-orchestrator validates AC items above.
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
