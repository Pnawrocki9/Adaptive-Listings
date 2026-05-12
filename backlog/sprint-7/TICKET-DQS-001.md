# TICKET-DQS-001 — Convergence Metrics

**Sprint:** 7 — Phase 2 **Agent:** data-engineer **Branch:** `feat/dqs-001-convergence-metrics`
**Commit prefix:** `[TICKET-DQS-001]` **Priority:** P1 **Estimated hours:** 8 **Depends on:**
TICKET-ADP-004 (must be merged first)

## CRITICAL: commitlint update MUST be commit 1

The `DQS-` prefix is not in `commitlint.config.cjs`. Every commit on this branch will fail CI
commitlint unless you add it first.

**Commit 1 on this branch MUST update `commitlint.config.cjs`:**

Current regex (line ~104):

```
/\[TICKET-(?:FIX-|INFRA-|DEMO-|ADM-|QUIZ-|DB-|EMB-|ARCH-|ADP-)?\d+\]|\[ESCALATION\]/
```

Updated regex:

```
/\[TICKET-(?:FIX-|INFRA-|DEMO-|ADM-|QUIZ-|DB-|EMB-|ARCH-|ADP-|DQS-)?\d+\]|\[ESCALATION\]/
```

Also update the error message string to include `[TICKET-DQS-XXX]` in the examples list.

Commit message for this change:
`chore(ci): add DQS- prefix to commitlint ticket-reference rule [TICKET-DQS-001]`

## Context

Per-session convergence metrics feed the Detection Quality Score (DQS). This is the data foundation
for Sprint 8's A/B framework. This ticket builds the SDK tracking module, the event schema, ingest
routing, and ClickHouse DDL.

## What to build

### 1. SDK module: `packages/sdk/src/core/dqs.ts` (new file)

```typescript
import type { ArchetypeId } from '@estalara/shared';

export type DqsSnapshot = {
  session_id: string;
  prediction_stability_score: number; // 0.0–1.0
  convergence_time_events: number | null; // null = not yet converged
  signal_density_per_min: number;
  final_archetype: ArchetypeId | 'neutral';
  final_confidence: number;
  total_events: number;
};

export class DqsTracker {
  private predictions: ArchetypeId[] = [];
  private eventTimes: number[] = [];
  private convergenceEventCount: number | null = null;
  private consecutiveCount = 0;
  private lastArchetype: ArchetypeId | null = null;

  constructor(private readonly sessionId: string) {}

  update(archetypeId: ArchetypeId, confidence: number): void;
  snapshot(): DqsSnapshot;
  reset(): void;
}
```

**Metric definitions:**

- `prediction_stability_score`: fraction of last 5 predictions that match current prediction. [A, A,
  B, A, A] with current=A → 4/5 = 0.8
- `convergence_time_events`: count of events until same archetype appeared 3 consecutive times. [A,
  B, A, A, A] → converges at event 5, value = 5. `null` if not yet converged.
- `signal_density_per_min`: events per minute in the session, capped at 10.0.
  `min(total_events / session_minutes, 10)`
- `final_archetype`: current top archetype (last updated)
- `final_confidence`: last confidence score passed to `update()`

### 2. Event emission

The `DqsTracker` should be instantiated once per session in `packages/sdk/src/index.ts` (do NOT
auto-instantiate in dqs.ts). Emit `session.quality.snapshot` event:

- Every 5th behavioral event (page.view, scroll.depth, cta.clicked, listing.impression, etc.)
- On session end (beforeunload or session.end event)

Event payload format: `DqsSnapshot` wrapped in a `CollectedEvent` from events.ts:

```typescript
{ type: 'session.quality.snapshot', payload: dqsTracker.snapshot(), ts: Date.now() }
```

**Integration approach:** Add a simple counter in `packages/sdk/src/index.ts` in the existing event
dispatch path. When `eventQueue.length % 5 === 0 && eventQueue.length > 0`, push a snapshot event.

### 3. Event schema: `packages/shared/src/schemas/session-quality.ts` (new file)

```typescript
import { z } from 'zod';

export const SessionQualitySnapshotSchema = z.object({
  type: z.literal('session.quality.snapshot'),
  session_id: z.string(),
  prediction_stability_score: z.number().min(0).max(1),
  convergence_time_events: z.number().int().positive().nullable(),
  signal_density_per_min: z.number().min(0).max(10),
  final_archetype: z.string(),
  final_confidence: z.number().min(0).max(1),
  total_events: z.number().int().nonneg(),
});

export type SessionQualitySnapshot = z.infer<typeof SessionQualitySnapshotSchema>;
```

Register in the event type discriminated union in `packages/shared/src/schemas/events/index.ts` (or
wherever the union lives). Also re-export from `packages/shared/src/schemas/index.ts`.

### 4. Ingest Worker routing

In `apps/ingest/`, add handling for `session.quality.snapshot` event type. Follow the existing
pattern for how other event types are forwarded to ClickHouse. Check the Worker source files
(`apps/ingest/src/`) for the event routing pattern.

### 5. ClickHouse DDL: `infra/clickhouse/migrations/0005_create_session_quality.sql`

```sql
CREATE TABLE IF NOT EXISTS session_quality (
  session_id                 String,
  tenant_id                  String,
  prediction_stability_score Float32,
  convergence_time_events    UInt16,
  signal_density_per_min     Float32,
  final_archetype            LowCardinality(String),
  final_confidence           Float32,
  total_events               UInt32,
  ts                         DateTime64(3, 'UTC')
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (tenant_id, session_id, ts);
```

Note: if ADP-002's 0004 migration doesn't exist yet, use 0004. Check existing migration count:
`ls infra/clickhouse/migrations/` — use the next sequential number.

## Coordination note

The `DqsTracker` integrates with the SDK's session/event flow. If any integration requires changes
to the SDK core that feel risky to existing behavior, write to `backlog/ESCALATIONS.md` and
implement a standalone integration point instead. The goal is non-intrusive integration.

## Tests

### Unit tests (`packages/sdk/src/__tests__/dqs.test.ts`)

1. `prediction_stability_score`: [A, A, B, A, A] → 0.8 (4/5 match current=A)
2. `convergence_time_events`: [A, B, A, A, A] → 5 (converges at event 5)
3. `signal_density_per_min`: 8 events in 60s → 8.0; 15 events in 60s → 10.0 (capped)
4. `snapshot()` returns valid `DqsSnapshot` shape after N updates
5. `reset()` clears state, next `snapshot()` shows fresh zeroed values

### Integration tests

1. SDK emits `session.quality.snapshot` on every 5th behavioral event
2. Zod schema accepts valid snapshot, rejects invalid (missing field, out-of-range score)
3. Ingest Worker correctly routes `session.quality.snapshot` type

## DONE criteria

- [ ] `commitlint.config.cjs` updated with `DQS-` prefix (commit 1 on branch)
- [ ] `packages/sdk/src/core/dqs.ts` with `DqsTracker` implementing all 4 metrics
- [ ] `packages/shared/src/schemas/session-quality.ts` Zod schema added
- [ ] Event type union updated to include `session.quality.snapshot`
- [ ] Ingest Worker forwards `session.quality.snapshot` to ClickHouse
- [ ] `0004_create_session_quality.sql` (or 0005 depending on ADP-002 migration) DDL added
- [ ] All unit and integration tests pass
- [ ] CI green, PR merged
