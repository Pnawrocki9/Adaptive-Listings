# TICKET-ADP-001 — Decision API Real Logic

**Sprint:** 7  
**Agent:** backend-engineer  
**Reviewer:** qa-engineer (reviews tests before PR opens)  
**Priority:** P0  
**Estimated hours:** 10  
**Depends on:** TICKET-ARCH-001, TICKET-EMB-001, TICKET-DB-001  
**Branch:** `feat/adp-001-decision-api-real-logic`  
**Commit prefix:** `[TICKET-ADP-001]`

## Context files

- `apps/control-plane/src/app/api/` — existing Next.js API routes (no `adapt/` exists yet — create
  it)
- `packages/shared/src/errors.ts` — canonical `errorBody()` helper
- `packages/shared/src/index.ts` — shared exports
- `packages/sdk/src/core/intent.ts` — canonical `Archetype` type and `ARCHETYPE_NAMES`
- `infra/clickhouse/migrations/` — existing ClickHouse migration format (MergeTree, no
  ReplicatedMergeTree in CI)
- `docs/MASTER_DESIGN.md` section E.1 — decision tree
- `docs/CONVENTIONS_PATCH.md` — known lessons

## What to build

Replace the missing `GET /api/adapt` stub (it was referenced but never built — create the route
fresh at `apps/control-plane/src/app/api/adapt/route.ts`) with real decision-tree logic.

### Decision tree (Master Design E.1)

```
1. Is intent confidence > 0.6?
   NO  → return directives: [], source: 'default', log impression
   YES → proceed

2. Match buyer to nearest archetype via cosine similarity:
   similarity > 0.85  → use archetype's pre-computed playbook (source: 'playbook')
   0.6 < sim < 0.85   → use playbook + set source: 'llm_tweaked' (ADP-002 will add real LLM later)
   similarity < 0.6   → set source: 'llm_full', directives: [] (ADP-002 handles this)

3. For each adaptation element (Tier 1 scope only):
   a. Call getPlaybook(archetypeId) — see stub requirements below
   b. Return JSON directive

4. Return AdaptationDirectives JSON
```

### New file: `packages/shared/src/directives.ts`

```typescript
import type { Archetype } from '@estalara/sdk/core/intent';
// NOTE: ArchetypeId is an alias for Archetype — use whichever is canonical

export type ArchetypeId = Archetype;

export type TextDirective = {
  type: 'text';
  slot: string; // matches [data-estalara-slot="<slot>"]
  value: string;
  archetype: ArchetypeId;
  confidence: number;
};

export type ClassDirective = {
  type: 'class';
  selector: string; // e.g. '[data-estalara-listing-id="123"]'
  add: string[];
  remove: string[];
  archetype: ArchetypeId;
  confidence: number;
};

export type AdaptationDirectives = {
  session_id: string;
  archetype: ArchetypeId | 'neutral';
  confidence: number;
  similarity: number;
  tier: 1 | 2 | 3;
  directives: (TextDirective | ClassDirective)[];
  source: 'playbook' | 'llm_tweaked' | 'llm_full' | 'default';
  generated_at: string; // ISO timestamp
};
```

Export `directives.ts` from `packages/shared/src/index.ts`.

IMPORTANT: `ArchetypeId` in `packages/shared/src/directives.ts` must NOT create a circular
dependency. The `Archetype` type lives in `packages/sdk/src/core/intent.ts`. Since `packages/shared`
cannot import from `packages/sdk`, re-declare the full `ArchetypeId` union inline in `directives.ts`
(copy the 18 values + 'neutral' from `intent.ts`). Do NOT import from the sdk package.

### API route spec

```
GET /api/adapt?session_id=<id>&archetype=<id>&confidence=<float>&similarity=<float>&tier=<1|2|3>

200 → AdaptationDirectives JSON (always 200 for valid params, even when source is 'default')
400 → errorBody('INVALID_PARAMS', ...) using canonical error format from packages/shared/src/errors.ts
```

Required params: `session_id`, `archetype`, `confidence` (0–1 float), `similarity` (0–1 float),
`tier` (1, 2, or 3).

Return `confidence < 0.6` → `directives: [], source: 'default'`.

### Playbook stub (temporary, replaced by ADP-003)

Create `packages/sdk/src/core/playbooks/index.ts` as a STUB with this minimal interface:

```typescript
import type { Archetype } from '../intent.js';

export interface PlaybookDirective {
  slot: string;
  value: string;
}

export interface PlaybookEntry {
  archetype: Archetype;
  slots: PlaybookDirective[];
  feature_priority: string[];
  description: string;
}

/** Stub — returns empty playbook. ADP-003 will replace this with real data. */
export function getPlaybook(archetypeId: Archetype): PlaybookEntry {
  return {
    archetype: archetypeId,
    slots: [],
    feature_priority: [],
    description: `Stub playbook for ${archetypeId}`,
  };
}
```

This stub exists ONLY so ADP-001 tests compile. ADP-003 will replace it with real data.

### ClickHouse DDL migration

Add `infra/clickhouse/migrations/0003_create_adaptation_decisions.sql`:

```sql
-- Migration: 0003_create_adaptation_decisions
-- Logs every adaptation decision for analytics and A/B testing.

CREATE TABLE IF NOT EXISTS adaptation_decisions (
  session_id      String,
  tenant_id       String,
  archetype       LowCardinality(String),
  confidence      Float32,
  similarity      Float32,
  source          LowCardinality(String),
  tier            UInt8,
  directive_count UInt16,
  ts              DateTime64(3, 'UTC')
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (tenant_id, session_id, ts);
```

Note: Use `MergeTree()` (not `ReplicatedMergeTree`) — the migration runner substitutes for CI (same
pattern as 0001_create_events.sql).

### Next.js route.ts rules

- Export ONLY `GET`. No other named exports.
- No dynamic `import()` calls at module level.
- ClickHouse logging: fire-and-forget (do NOT await the ClickHouse insert — it must not block the
  response). Use try/catch and log errors to console.error silently.

### Tests required

1. Unit: decision tree — all 4 branches:
   - `confidence < 0.6` → `source: 'default'`, `directives: []`
   - `confidence >= 0.6`, `similarity > 0.85` → `source: 'playbook'`
   - `confidence >= 0.6`, `0.6 < similarity <= 0.85` → `source: 'llm_tweaked'`
   - `confidence >= 0.6`, `similarity <= 0.6` → `source: 'llm_full'`, `directives: []`
2. Unit: `AdaptationDirectives` Zod schema validation
3. Integration: `GET /api/adapt` with valid params → correct `AdaptationDirectives` shape
4. Edge case: missing required params → 400 with canonical error format

## Acceptance criteria

- [ ] `GET /api/adapt?session_id=abc&archetype=yield_hunter&confidence=0.75&similarity=0.90&tier=1`
      returns 200 with real `AdaptationDirectives` JSON
- [ ] All 4 decision tree branches are covered by unit tests
- [ ] `packages/shared/src/directives.ts` created with `TextDirective`, `ClassDirective`,
      `AdaptationDirectives`
- [ ] `ArchetypeId` union declared inline in `directives.ts` (no circular import from sdk)
- [ ] ClickHouse `adaptation_decisions` migration file exists at
      `infra/clickhouse/migrations/0003_create_adaptation_decisions.sql`
- [ ] Canonical `errorBody()` used for 400 responses
- [ ] Route exports ONLY `GET`
- [ ] CI green
