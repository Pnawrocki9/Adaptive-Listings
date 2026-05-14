# TICKET-036 — Pre-Built Platform Templates Expansion (50+ Platforms)

**Sprint:** 2.5 **Agent:** ml-engineer **Priority:** P2 **Estimated hours:** 6 **Status:** BLOCKED
**Depends on:** TICKET-034 (core templates — type structure and `matchPlatform` helper must exist
before adding more templates) **Unblocks:** (none — P2, not on critical path)

## Context

TICKET-034 ships 5 core templates (one per target region: ES/UK/PL/US/UAE). Master Design B.4.4
targets 15 templates at MVP and 80+ in Y2. This ticket fills in the MVP gap: the remaining 10+
regional templates to reach 15+ coverage, plus WordPress theme fingerprints that cover the ~40% of
the real estate market running on WordPress.

This is a P2 content ticket. No new code patterns are introduced — only new template entries
following the `PlatformTemplateSchema` structure established in TICKET-034. Do not start until
TICKET-034 is merged; branch off that PR if it is not yet merged to main.

The templates in this ticket are sourced from:

1. The Master Design B.4.4 code block (Fotocasa, Pisos.com, Zoopla, OLX.pl, Realtor.com, Redfin,
   Property Finder, Dubizzle, WordPress Houzez/Realtyna/Estatik/WP-Residence/RealHomes)
2. The corpus fixtures in `packages/sdk/src/auto-detect/__fixtures__/` — ground-truth files for
   fixtures 003-zoopla, 010-realtor-com, 011-olx-pl already exist and contain verified selectors.
   Use those as the authoritative source for selector values; do not guess.

**References:**

- `docs/MASTER_DESIGN.md` section B.4.4 — KNOWN_PLATFORMS code block (selector values for all listed
  platforms)
- `packages/platform-templates/src/templates/index.ts` — registry to extend (post-TICKET-034)
- `packages/platform-templates/src/types.ts` — `PlatformTemplateSchema` (read-only)
- `packages/sdk/src/auto-detect/__fixtures__/` — ground-truth JSON for verified selectors
- TICKET-034 — must be merged (or this ticket must branch off it)

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **Minimum 15 total templates after this ticket merges.** The `templates` array must contain at
   least 15 entries (5 from TICKET-034 + 10 new ones from this ticket). The preferred target is 20
   templates covering all platforms listed in Master Design B.4.4.

2. **Regional coverage — at least 2 templates per region.** Each of the five target regions (ES, UK,
   PL, US, UAE) must have at least 2 templates after this ticket:

   | Region      | Already in TICKET-034 | Add in this ticket                 |
   | ----------- | --------------------- | ---------------------------------- |
   | Spain (ES)  | `idealista-es`        | `fotocasa-es`, `pisos-com-es`      |
   | UK          | `rightmove-uk`        | `zoopla-uk`, `onthemarket-uk`      |
   | Poland (PL) | `otodom-pl`           | `olx-pl`, `gratka-pl`              |
   | US          | `zillow-us`           | `realtor-com-us`, `redfin-us`      |
   | UAE         | `bayut-uae`           | `propertyfinder-ae`, `dubizzle-ae` |

3. **WordPress theme templates.** Add at least 3 WordPress theme templates using `domSignatures`
   (not hostname matchers, since these themes appear across arbitrary domains):

   | Template ID           | Theme                 | `domSignatures`                     | `hostnameMatchers` |
   | --------------------- | --------------------- | ----------------------------------- | ------------------ |
   | `wordpress-houzez`    | WordPress + Houzez    | `['houzez', 'houzez-theme']`        | `[]`               |
   | `wordpress-realtyna`  | WordPress + Realtyna  | `['realtyna', 'realtyna-wpl']`      | `[]`               |
   | `wordpress-realhomes` | WordPress + RealHomes | `['realhomes', 'inspiry-property']` | `[]`               |

   WordPress theme confidence is `0.95` (slightly below known-hostname platforms at `0.99`).

4. **Selector accuracy.** For any platform that has a corpus fixture in
   `packages/sdk/src/auto-detect/__fixtures__/`, the selectors in the template must match the
   `css_selector` values in the corresponding ground-truth JSON. Run `pnpm test:corpus` and confirm
   100% pass rate after adding the templates.

5. **All new templates pass Zod validation.** The existing test in
   `packages/platform-templates/__tests__/templates.test.ts` (from TICKET-034) iterates
   `listTemplates()` and runs `PlatformTemplateSchema.parse(t)`. All templates added here must pass
   without changes to the test.

6. **`matchPlatform` tests extended.** Add one new test per new region template to
   `packages/platform-templates/__tests__/match.test.ts`. Each test verifies hostname matching works
   for the new platform's primary domain.

7. **Test coverage >= 80%.** Library quality bar.

8. **`pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass locally.**

## Files to touch

| File                                                  | Action                                    |
| ----------------------------------------------------- | ----------------------------------------- |
| `packages/platform-templates/src/templates/index.ts`  | EXTEND — add 10+ new template entries     |
| `packages/platform-templates/__tests__/match.test.ts` | EXTEND — one test per new template        |
| `packages/sdk/src/auto-detect/__fixtures__/`          | READ ONLY — reference for selector values |

## Implementation notes

- **Source of truth for selectors**: for platforms that have a corpus fixture, read
  `*-ground-truth.json` to find the correct `css_selector` values. For platforms without a fixture
  (Fotocasa, Pisos.com, Gratka, PropertyFinder, Dubizzle), use the selectors from the Master Design
  B.4.4 code block or add a `// TODO: verify against live site` comment — do not fabricate selector
  values.
- **`locale` field**: populate this for all regional templates (`es-ES` for Spain, `en-GB` for UK,
  `pl-PL` for Poland, `en-US` for US, `en-AE` for UAE). This field is optional in the schema but is
  used by the NLP feature parser (B.5.3) to select the correct locale for number/currency parsing.
- **WordPress theme `domSignatures`**: use class name fragments that are unique to each theme and
  present in the `<link>` or `<script>` tag `href`/`src` attributes, not in listing card markup.
  Theme-identifying attributes are more stable than listing card class names.
- **No new code patterns**: this ticket is purely data. If any change to `matchPlatform` logic or
  `PlatformTemplate` types is needed to support the new templates, escalate to the architect rather
  than silently modifying the type contract.

## Test expectations

### Unit tests (required)

1. **Template count.** `listTemplates().length >= 15` after this ticket.

2. **Zoopla hostname match.** `matchPlatform('https://www.zoopla.co.uk/for-sale/123', '')` returns
   `{ templateId: 'zoopla-uk', confidence: 0.99 }`.

3. **Realtor.com hostname match.**
   `matchPlatform('https://www.realtor.com/realestateandhomes-detail/123', '')` returns
   `{ templateId: 'realtor-com-us', confidence: 0.99 }`.

4. **WordPress Houzez DOM signature match.**
   `matchPlatform('https://custom-agency.com', '<link href="/wp-content/themes/houzez/style.css">')`
   returns `{ templateId: 'wordpress-houzez', confidence: 0.95 }`.

5. **OLX Poland hostname match.** `matchPlatform('https://www.olx.pl/nieruchomosci/123', '')`
   returns `{ templateId: 'olx-pl', confidence: 0.99 }`.

6. **All templates pass Zod schema.** Iterate `listTemplates()`, run `PlatformTemplateSchema.parse`
   on each. Assert no exceptions thrown for any of the 15+ templates.

## Branch naming

`ml-engineer/TICKET-036-platform-templates-expansion`

## PR title format

`feat(platform-templates): expand to 15+ templates — ES/UK/PL/US/UAE regions + WordPress themes [TICKET-036]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- `pnpm test:corpus` passes at 100% (no regression on existing 24-platform corpus).
- PM-orchestrator validates AC items above.
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
