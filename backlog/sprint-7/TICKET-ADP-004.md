# TICKET-ADP-004 — SDK Tier 1 DOM Mutations

**Sprint:** 7 — Phase 2 **Agent:** sdk-engineer **Branch:** `feat/adp-004-sdk-tier1-dom-mutations`
**Commit prefix:** `[TICKET-ADP-004]` **Priority:** P0 — HIGHEST (ADP-002 and DQS-001 depend on
this) **Estimated hours:** 10 **Depends on:** TICKET-ADP-003 (DONE @ ecf5d4b)

## Context

ADP-001 produced `TextDirective` and `ClassDirective` types in `packages/shared/src/directives.ts`.
ADP-003 produced 18 archetype playbooks in `packages/sdk/src/core/playbooks/`. The Decision API at
`GET /api/adapt` returns `AdaptationDirectives` with these types.

`packages/sdk/src/core/adapt.ts` has an `applyDirectives()` stub that partially works for text but
is wrong for class directives (uses `directive.slot` and `directive.value` instead of
`directive.selector`, `directive.add`, `directive.remove`). This ticket implements the full body.

## Key files to read before writing

1. `packages/sdk/src/core/adapt.ts` — current stub (DO NOT overwrite SSR guard or outer try/catch)
2. `packages/shared/src/directives.ts` — canonical TextDirective, ClassDirective, ArchetypeId
3. `packages/sdk/src/core/events.ts` — event queue pattern (CollectedEvent)
4. `packages/sdk/src/core/session.ts` — SessionState
5. `packages/sdk/src/index.ts` — how the SDK wires session, events, observers
6. `apps/control-plane/src/lib/mockup-listings.ts` — mock data values for data-attributes

## Behavior spec

### 1. Update function signature

Change `applyDirectives(directives: Directive[])` to accept `(TextDirective | ClassDirective)[]`
imported from `@estalara/shared`. Also add session context for event logging:

```typescript
export function applyDirectives(
  directives: (TextDirective | ClassDirective)[],
  context: { archetypeId: ArchetypeId; confidence: number; sessionId: string },
): void;
```

Remove the local `Directive` interface (or mark deprecated with a comment if other code depends on
it).

### 2. TextDirective handling

- Find all elements matching `[data-estalara-slot="<slot>"]` (querySelectorAll, not just first)
- Replace `textContent` (NOT innerHTML — XSS safety)
- Placeholder interpolation: if the directive value contains `{token}` patterns and the target
  element has a `data-estalara-<token>` attribute, substitute the value.
  - Attribute name mapping: `{school_rating}` → `data-estalara-school-rating` (kebab-case tokens)
  - If a token cannot be resolved, leave `{token}` literal in output and emit `adapt.skipped`
    warning

### 3. ClassDirective handling

- Find all elements matching `directive.selector` (the `selector` field, NOT `slot`)
- Apply `classList.remove(...directive.remove)` then `classList.add(...directive.add)` (add wins)
- Selector MUST match `[data-estalara-*]` pattern only. Reject any other selector with
  `adapt.skipped` event and skip the directive. Check with:
  `if (!/^\[data-estalara-[^\]]+\]/.test(directive.selector)) { /* reject */ }`

### 4. Event logging

Push to the SDK event queue for every application and skip. Use the `CollectedEvent` type from
`packages/sdk/src/core/events.ts`. Expose a module-level `queueAdaptEvent(event: CollectedEvent)`
helper (or call the existing queue mechanism — trace how index.ts collects events and follow that
pattern).

For every successful application:

```typescript
{ type: 'adapt.applied', payload: { slot_or_selector: string, archetype: ArchetypeId, confidence: number }, ts: number }
```

For every skip/failure:

```typescript
{ type: 'adapt.skipped', payload: { reason: string, slot_or_selector: string }, ts: number }
```

### 5. Idempotency

Track applied directive fingerprints per session using a module-level `Set<string>`. Fingerprint:
`${type}:${slot_or_selector}:${archetypeId}`. If `applyDirectives` is called again with the same
directive, skip DOM mutation AND event emission. Export `resetAdaptState()` that clears the Set, and
call it when a new session is initialized in `src/index.ts`.

### 6. DOM ready guarantee

If `document.readyState === 'loading'`, queue the directives and apply them on `DOMContentLoaded`.
Use `{ once: true }` option to avoid listener leak across multiple calls.

## Type alignment

The `fetchDirectives()` function currently returns `AdaptResponse` with `directives: Directive[]`.
After this ticket, update its return type to reflect the real API shape. The Decision API now
returns `AdaptationDirectives` from `packages/shared`. Either:

- Change `fetchDirectives()` to return `AdaptationDirectives | null`, OR
- Keep a local response type but update `directives` field to `(TextDirective | ClassDirective)[]`

Prefer option A — less drift from the canonical shared type.

## Demo page integration

Update `apps/control-plane/src/app/dashboard/demo/mockup/page.tsx` listing cards. Read
`apps/control-plane/src/lib/mockup-listings.ts` first for actual mock values.

On each listing `<h2>` (headline), add data attributes reflecting the listing's real mock values:

```tsx
<h2
  data-estalara-slot="headline"
  data-estalara-yield={String(listing.yield_pct ?? '')}
  data-estalara-bedrooms={String(listing.bedrooms)}
  data-estalara-area={String(listing.area_m2)}
>
  {listing.title}
</h2>
```

On the feature section div (where tags are rendered), add:

```tsx
<div data-estalara-slot="feature-section">Investment Highlights</div>
```

On the listing card wrapper Link element, add:

```tsx
data-estalara-listing-id={listing.slug}
```

(The `data-estalara-listing` attribute is already there per existing code — keep it.)

On the CTA if present — add `data-estalara-slot="cta"` to the View Listing button/link.

## Tests required

### Unit tests (add `// @vitest-environment jsdom` at top of test file)

Create `packages/sdk/src/__tests__/adapt.test.ts` (or update existing if present):

1. TextDirective with no placeholders → element textContent replaced exactly
2. TextDirective with `{bedrooms}` placeholder, element has `data-estalara-bedrooms="4"` → "4BR
   Home"
3. TextDirective with `{unknown_token}`, no matching data attribute → literal `{unknown_token}` in
   output, `adapt.skipped` event emitted
4. ClassDirective → `add` classes applied, `remove` classes removed, correct order
5. ClassDirective with disallowed selector (`.tenant-class`) → rejected, `adapt.skipped` event
   emitted, NO DOM mutation
6. Idempotent: calling `applyDirectives` twice with same directives → DOM mutation applied once,
   events emitted once
7. Missing slot → silent skip, no error thrown, `adapt.skipped` event emitted

### Playwright E2E

Create `packages/sdk/e2e/adapt-dom-mutations.spec.ts`:

1. Load the demo mockup page (or a minimal fixture)
2. Mock `GET /api/adapt` to return a `yield_hunter` response with a headline directive
3. Assert that at least one `[data-estalara-slot="headline"]` element textContent changes
4. Assert no JS errors in console

## DONE criteria

- [ ] Full `applyDirectives()` body with all 6 requirements above
- [ ] Type alignment: function accepts `(TextDirective | ClassDirective)[]`, no local Directive type
      mismatch in the happy path
- [ ] `resetAdaptState()` exported and called on new session in `src/index.ts`
- [ ] Demo mockup page has `data-estalara-*` attributes wired to real mock values
- [ ] Unit tests pass with `@vitest-environment jsdom`
- [ ] E2E Playwright test passes
- [ ] CI green on PR
- [ ] After merge: pm-orchestrator runs `pnpm --filter @estalara/sdk build` on main, verifies dist/
