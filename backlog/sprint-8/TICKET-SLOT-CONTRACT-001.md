# TICKET-SLOT-CONTRACT-001 — Contract Test: LLM Prompt Slot Names Must Match Playbook Slot Names

**Sprint:** 8 **Agent:** qa-engineer **Priority:** P1 **Estimated hours:** 2 **Status:** READY
**Depends on:** TICKET-046 (merged PR #92), TICKET-ADP-002 (merged PR #70) **Promoted from:**
FOLLOW-003 (RETRO-001)

## Context

TICKET-046 fixed a `feature-section` → `feature` naming bug where `llm-gateway.ts` hardcoded slot
names in the Sonnet prompt independently from `archetypes/*.ts` slot definitions. The bug existed
across multiple files and was only caught manually during development.

This ticket adds a regression test that prevents future naming divergence between the LLM prompt
layer and the SDK playbook layer. It extracts slot names from both sources and asserts they form the
same set.

**References:**

- `apps/control-plane/src/lib/llm-gateway.ts` — contains hardcoded slot names in Sonnet prompt
  (search for `Available slots:`)
- `packages/sdk/src/core/playbooks/archetypes/*.ts` — slot definitions (the canonical source)
- RETRO-001 (`backlog/RETROSPECTIVES.md`) — finding 3c that generated this ticket

## Acceptance criteria

- [ ] Test file `apps/control-plane/src/lib/__tests__/llm-gateway-slot-contract.test.ts` exists
- [ ] Test reads all `packages/sdk/src/core/playbooks/archetypes/*.ts` via fs and extracts unique
      `slot` string values using a regex or AST parse
- [ ] Test reads `llm-gateway.ts` and extracts slot names referenced in the Sonnet prompt string
      (the `Available slots:` line or equivalent)
- [ ] Assertion: the set of playbook slot names equals the set of prompt slot names (symmetric
      difference must be empty)
- [ ] Test runs in `pnpm --filter control-plane test` CI gate (not skipped, not `.skip`)
- [ ] Test fails if a new archetype introduces a slot name not listed in the LLM prompt

## Implementation notes

The test should use Node's `fs.readFileSync` to read archetype files and `llm-gateway.ts` at test
time (not import them — avoids circular module issues). Regex approach for extraction is fine for
this contract test; full AST parse is not required.

```typescript
// Approximate structure
import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';

describe('LLM gateway slot name contract', () => {
  it('prompt slot names match playbook slot names', () => {
    // Extract from archetypes
    const archetypeFiles = globSync('packages/sdk/src/core/playbooks/archetypes/*.ts', {
      cwd: REPO_ROOT,
    });
    const playbookSlots = new Set<string>();
    for (const file of archetypeFiles) {
      const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');
      const matches = content.matchAll(/slot:\s*['"]([^'"]+)['"]/g);
      for (const m of matches) playbookSlots.add(m[1]);
    }

    // Extract from llm-gateway.ts
    const gatewayContent = fs.readFileSync(GATEWAY_PATH, 'utf-8');
    const promptSlotLine = gatewayContent.match(/Available slots:\s*([^\n]+)/)?.[1] ?? '';
    const promptSlots = new Set(
      promptSlotLine
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

    // Contract assertion
    const diff = [...playbookSlots].filter((s) => !promptSlots.has(s));
    expect(diff).toEqual([]);
  });
});
```

The `neutral` archetype has no slots — ensure it doesn't accidentally contribute empty strings to
`playbookSlots`.
