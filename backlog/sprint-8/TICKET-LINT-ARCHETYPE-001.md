# TICKET-LINT-ARCHETYPE-001 — Lint: All Non-Neutral Archetypes Must Have copy_template.en

**Sprint:** 8 **Agent:** sdk-engineer **Priority:** P2 **Estimated hours:** 1 **Status:** READY
**Depends on:** TICKET-046 (merged PR #92) **Promoted from:** FOLLOW-004 (RETRO-001)

## Context

TICKET-046 added `PlaybookEntry.copy_template.en` to all 17 non-neutral archetypes. Future archetype
additions (Sprint 11+, locale expansions) could accidentally omit this field or ship a stub. This
ticket adds a test assertion that enforces the invariant at CI time.

**References:**

- `packages/sdk/src/__tests__/playbooks.test.ts` — existing test suite (add here)
- `packages/sdk/src/core/playbooks/types.ts` — `PlaybookEntry.copy_template` field
- `packages/sdk/src/core/playbooks/index.ts` — `ALL_PLAYBOOKS` export

## Acceptance criteria

- [ ] In `packages/sdk/src/__tests__/playbooks.test.ts`, add an `it.each` test over all 17
      non-neutral archetypes (exclude `neutral`)
- [ ] Assertion: `entry.copy_template.en.length > 50` for every non-neutral archetype
- [ ] Assertion: `entry.copy_template.en` does not start with `TODO` or `PLACEHOLDER` (catches
      stubs)
- [ ] Test runs in `pnpm --filter @estalara/sdk test` CI gate (not skipped, not `.skip`)
- [ ] Test fails if a new non-neutral archetype is added without a `copy_template.en` of sufficient
      length

## Implementation notes

Add to the existing `describe('playbooks', ...)` block in `playbooks.test.ts`. The test should
import `ALL_PLAYBOOKS` and filter to non-neutral archetypes:

```typescript
const nonNeutralPlaybooks = ALL_PLAYBOOKS.filter((p) => p.archetype !== 'neutral');

describe('copy_template invariants', () => {
  it.each(nonNeutralPlaybooks)('$archetype has valid copy_template.en', (entry) => {
    expect(entry.copy_template.en.length).toBeGreaterThan(50);
    expect(entry.copy_template.en).not.toMatch(/^(TODO|PLACEHOLDER)/i);
  });
});
```

This is a one-file change — approximately 10 lines added to an existing test file.
