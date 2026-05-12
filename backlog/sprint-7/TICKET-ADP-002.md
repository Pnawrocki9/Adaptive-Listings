# TICKET-ADP-002 — LiteLLM Gateway

**Sprint:** 7 — Phase 2 **Agent:** backend-engineer **Branch:** `feat/adp-002-litellm-gateway`
**Commit prefix:** `[TICKET-ADP-002]` **Priority:** P1 **Estimated hours:** 8 **Depends on:**
TICKET-ADP-004 (must be merged first)

## Context

ADP-001 built the Decision API at `apps/control-plane/src/app/api/adapt/route.ts` with a full
4-branch decision tree. The branches `llm_tweaked` and `llm_full` currently return placeholder
directives. This ticket implements the real LLM gateway that populates those branches.

## What to build

`apps/control-plane/src/lib/llm-gateway.ts` — gateway function called when similarity is in the
middle range (see routing policy below).

### Routing policy

```
similarity > 0.85       → no LLM call, playbook unchanged (Phase 1 behavior, source: 'playbook')
0.6 < similarity ≤ 0.85 → Haiku 4.5: tweak 1-2 playbook directives based on session context
similarity ≤ 0.6, conf > 0.6 → Sonnet 4.6: generate directives from scratch
confidence ≤ 0.6        → no LLM call, return default (source: 'default')
```

### TypeScript interface

```typescript
// apps/control-plane/src/lib/llm-gateway.ts

import type { ArchetypeId, TextDirective } from '@estalara/shared';
import type { PlaybookEntry } from '@estalara/sdk/playbooks';

export type LlmGatewayInput = {
  archetypeId: ArchetypeId;
  confidence: number;
  similarity: number;
  basePlaybook: PlaybookEntry;
  sessionContext?: {
    recentEvents?: string[];
    quizAnswers?: { purpose: string; horizon: string };
  };
};

export type LlmGatewayOutput = {
  directives: TextDirective[];
  model: 'claude-haiku-4-5' | 'claude-sonnet-4-6';
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
};

export async function callLlmGateway(input: LlmGatewayInput): Promise<LlmGatewayOutput | null>;
```

Returns `null` on: missing API key, circuit breaker triggered, or any Anthropic API error. Never
throws in production paths.

### Environment

- Check if `@anthropic-ai/sdk` is already in workspace:
  `grep -r "@anthropic-ai/sdk" packages/ apps/ --include="package.json"` If not present, add to
  `apps/control-plane/package.json`.
- API key from `ANTHROPIC_API_KEY` env var. If missing: return `null`, log one startup warning.

### Circuit breaker

Daily spend cap: $100/day tracked via `llm_calls` ClickHouse table (DDL in this ticket). Query
rolling 24h sum of `cost_usd` before each call.

- `> $90`: emit warn log, proceed
- `>= $100`: return `null`, `source: 'playbook_fallback_llm_capped'`

### Prompt design

**Haiku (tweak) — under 500 tokens total input:**

```
You are an AI adapting real estate listing descriptions for a specific buyer archetype.
Archetype: {archetype_description}
Signals: {signals_list}
Current directives (JSON): {base_directives_json}
Buyer's recent actions: {recent_events}

Return a JSON array of TextDirective objects that improve upon the current directives.
Keep slot names unchanged. Output JSON only, no explanation.
Schema: [{"type":"text","slot":"<slot>","value":"<value>","archetype":"<id>","confidence":<float>}]
```

**Sonnet (full gen) — under 800 tokens total input:**

```
You are an AI generating real estate listing adaptations for a specific buyer archetype.
Archetype: {archetype_description}
Signals that define this archetype: {signals_list}
Available slots: headline, feature-section, cta
Buyer's recent actions: {recent_events}
Quiz answers: {quiz_answers}

Generate 2-3 TextDirective objects that would resonate with this buyer.
Output JSON only.
Schema: [{"type":"text","slot":"<slot>","value":"<value>","archetype":"<id>","confidence":<float>}]
```

Use Anthropic SDK JSON response mode if available. Otherwise, parse response and validate with Zod.

### ClickHouse DDL (add as `infra/clickhouse/migrations/0004_create_llm_calls.sql`)

```sql
CREATE TABLE IF NOT EXISTS llm_calls (
  session_id    String,
  tenant_id     String,
  archetype     LowCardinality(String),
  model         LowCardinality(String),
  tokens_in     UInt32,
  tokens_out    UInt32,
  cost_usd      Float32,
  latency_ms    UInt32,
  source        LowCardinality(String),
  ts            DateTime64(3, 'UTC')
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (tenant_id, session_id, ts);
```

### Wire into route.ts

In `apps/control-plane/src/app/api/adapt/route.ts`:

- For `llm_tweaked` branch: call `callLlmGateway()` with similarity, confidence, basePlaybook
- If non-null: use returned directives in response
- If null (cap or no key): source becomes `'playbook_fallback_llm_capped'` or
  `'playbook_fallback_llm_unavailable'`
- Log the call to ClickHouse `llm_calls` table (use existing ClickHouse client pattern from ingest)

### Tests

**Unit (mock `@anthropic-ai/sdk`):**

1. Gateway with mocked Anthropic SDK → returns expected `LlmGatewayOutput` shape
2. Missing `ANTHROPIC_API_KEY` → returns null without throwing
3. Circuit breaker: mock ClickHouse returning cost_sum > $100 → returns null
4. Routing: similarity=0.7, confidence=0.75 → Haiku selected; similarity=0.5, confidence=0.75 →
   Sonnet

**Integration (skip if no ANTHROPIC_API_KEY):**

1. GET /api/adapt with confidence=0.75, similarity=0.70 → calls gateway (or graceful fallback)
2. GET /api/adapt with confidence=0.75, similarity=0.50 → calls Sonnet gateway (or fallback)

## DONE criteria

- [ ] `callLlmGateway()` implemented with routing policy and circuit breaker
- [ ] Decision API wired to call gateway for tweak/full branches
- [ ] `llm_calls` ClickHouse DDL added as `0004_create_llm_calls.sql`
- [ ] Tests pass (unit with mocked SDK, integration skips gracefully if no key)
- [ ] CI green, PR merged
