---
id: TICKET-006
title: Add packages/platform-templates TS placeholder (NEW v1.1)
sprint: 0
priority: P1
agent: devops-engineer
status: READY
estimated_hours: 2
depends_on: [TICKET-001]
produces: [TICKET-007, TICKET-032]
affects_files:
  - "packages/platform-templates/**"
  - "pnpm-workspace.yaml"
context_files:
  - docs/MASTER_DESIGN.md (sections B.4.2, B.5.1 — platform fingerprint Layer 3)
  - packages/shared/* (existing pattern to mirror)
  - .claude/agents/devops-engineer.md
  - .claude/agents/ml-engineer.md
labels: [foundation, p1, infra, auto-onboarding, v1.1]
---

# TICKET-006: Add packages/platform-templates TS placeholder

## Summary

Create the `packages/platform-templates/` TypeScript package placeholder. This will eventually hold pre-built CSS selectors for 50+ known real-estate platforms (Idealista, Rightmove, Otodom, Zillow, Bayut + 10+ WordPress themes). Without this layer, every detection request would need expensive AI Vision calls. Layer 3 (platform fingerprint) covers ~25% of sites for free.

Like TICKET-005, this is a placeholder only. Actual templates ship in TICKET-032.

## Context

Master Design v1.1 section B.5.1 defines a layered detection strategy:

| Layer | Method | Coverage | Cost |
|---|---|---|---|
| L1 | Schema.org JSON-LD | ~40% | $0 |
| L2 | Microdata | ~10% | $0 |
| **L3** | **Platform fingerprint** | **~25%** | **$0** |
| L4 | Heuristic detection | ~15% | $0 |
| L5 | AI Vision (Claude) | 100% fallback | $0.33 |

L3 needs a library of templates: hostname/DOM signature → pre-validated selectors. That's `packages/platform-templates/`.

This brings us from 9 to 10 packages.

## Scope

### In scope
- Create directory `packages/platform-templates/` with this structure:
  ```
  packages/platform-templates/
  ├── README.md           # describes purpose, links to B.4.2/B.5.1
  ├── package.json        # name: @estalara/platform-templates
  ├── tsconfig.json       # extends repo base
  ├── src/
  │   ├── index.ts        # exports: matchPlatform(url, html) → MatchResult | null
  │   ├── types.ts        # PlatformTemplate, MatchResult types (Zod schemas)
  │   └── templates/
  │       └── index.ts    # placeholder: empty registry, ready for real templates
  └── tests/
      ├── matcher.test.ts # smoke test that matchPlatform returns null when nothing matches
      └── types.test.ts   # smoke test on Zod schemas
  ```
- `package.json` lists `zod` as a peer dep (assume already in monorepo from TICKET-001)
- Bundle is ESM-only, exports only the public API

### Out of scope
- Actual platform templates (Idealista, Rightmove, etc.) — TICKET-032 ships 15 starter templates
- Validation pipeline (running selectors against sample listings) — TICKET-035
- Any AI/Vision logic — that's `apps/auto-detect/`

## Acceptance criteria

- [ ] AC1: `packages/platform-templates/package.json` exists with name `@estalara/platform-templates`, version `0.0.1`, type `module`, main pointing to `dist/index.js`
- [ ] AC2: `src/types.ts` exports Zod schemas: `PlatformTemplateSchema` (id, name, hostnameMatchers, domSignatures, selectors, confidence) and `MatchResultSchema` (templateId, confidence, fields)
- [ ] AC3: `src/index.ts` exports `matchPlatform(url: string, html: string): MatchResult | null` — returns null in placeholder; signature stable for downstream
- [ ] AC4: `src/templates/index.ts` exports `templates: PlatformTemplate[]` (empty array placeholder)
- [ ] AC5: `tests/matcher.test.ts` has at least 3 tests: returns null for empty html, returns null for unmatched hostname, types are correctly inferred from Zod
- [ ] AC6: Build succeeds (`pnpm --filter @estalara/platform-templates build`)
- [ ] AC7: Lint, typecheck, test, format all pass for the new package
- [ ] AC8: All other CI checks still green
- [ ] AC9: PR title `chore(infra): add packages/platform-templates placeholder [TICKET-006]`

## Implementation guidance

Mirror `packages/shared/` exactly for `package.json`, `tsconfig.json`, build config (tsup). The only differences are name, description, and the public API.

`src/types.ts`:

```typescript
import { z } from 'zod';

export const HostnameMatcherSchema = z.union([
  z.string(),                          // exact match: "idealista.com"
  z.object({ pattern: z.string() }),   // regex: { pattern: "*.idealista.*" }
]);
export type HostnameMatcher = z.infer<typeof HostnameMatcherSchema>;

export const SelectorSchema = z.object({
  primary: z.object({
    type: z.enum(['css', 'xpath', 'json_path']),
    value: z.string(),
  }),
  fallbacks: z.array(z.object({
    type: z.enum(['css', 'xpath', 'json_path']),
    value: z.string(),
  })).default([]),
  parser: z.enum(['text', 'number', 'currency', 'array', 'json']).default('text'),
});
export type Selector = z.infer<typeof SelectorSchema>;

export const PlatformTemplateSchema = z.object({
  id: z.string(),                                    // 'wordpress-houzez', 'idealista-es'
  name: z.string(),                                  // human-readable: 'WordPress + Houzez Theme'
  hostnameMatchers: z.array(HostnameMatcherSchema),
  domSignatures: z.array(z.string()).default([]),    // CSS selectors that prove platform
  selectors: z.record(SelectorSchema),               // field → selector strategy
  confidence: z.number().min(0).max(1),              // baseline confidence when matched
  locale: z.string().optional(),                     // 'es-ES', 'en-GB', etc.
});
export type PlatformTemplate = z.infer<typeof PlatformTemplateSchema>;

export const MatchResultSchema = z.object({
  templateId: z.string(),
  templateName: z.string(),
  confidence: z.number().min(0).max(1),
  matchedSignatures: z.array(z.string()),
});
export type MatchResult = z.infer<typeof MatchResultSchema>;
```

`src/index.ts`:

```typescript
import { templates } from './templates/index.js';
import type { MatchResult } from './types.js';

export * from './types.js';
export { templates };

/**
 * Match a URL + HTML against the platform template registry.
 * 
 * Layer 3 of the detection pipeline (Master Design B.5.1).
 * Real implementation lands in TICKET-032; placeholder always returns null.
 */
export function matchPlatform(url: string, html: string): MatchResult | null {
  // Placeholder: real matching logic in TICKET-032
  return null;
}
```

`src/templates/index.ts`:

```typescript
import type { PlatformTemplate } from '../types.js';

/**
 * Registry of pre-built platform templates.
 * Empty in this placeholder; populated in TICKET-032 (15 starter templates).
 */
export const templates: PlatformTemplate[] = [];
```

## Test plan

- Unit (3 tests minimum):
  1. `matchPlatform('https://example.com', '<html></html>')` returns null
  2. `matchPlatform('', '')` returns null
  3. `templates` is an array (length 0 in placeholder)
- Build: `pnpm --filter @estalara/platform-templates build` produces `dist/index.js`
- Type check: importing `PlatformTemplate` type from another package compiles

## Definition of Done

- [ ] Branch `devops-engineer/TICKET-006-platform-templates-placeholder`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI fully green via `gh pr checks <pr> --watch`
- [ ] `pnpm exec prettier --check .` clean
- [ ] HANDOFF to TICKET-007 (counts update) and TICKET-032 (real templates)

## Notes

- Like TICKET-005: small, mirror existing pattern, don't overthink. ~2h max.
- The Zod schemas you write here become the contract for TICKET-032 (real templates) and TICKET-035 (validation pipeline). Get the types right; this is the hardest part of this ticket.
