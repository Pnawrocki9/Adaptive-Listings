# FOLLOW-101 — chat.intent.detected → Bayesian prior bridge in SDK intent.ts

**Agent:** ml-engineer (lead) + sdk-engineer (review) **Priority:** P1 **Estimated hours:** 4
**Depends on:** FOLLOW-087 (DONE — PR #255), FOLLOW-100 (DONE — PR #254) **Branch:**
`ml-engineer/FOLLOW-101-chat-intent-prior-bridge` **Model:** opus-4.7-xhigh **Sprint:** 13b

---

## Context

FOLLOW-087 shipped the two-tier chat NLP pipeline (`apps/intent-engine`). After processing a
`chat.message.sent` event, the intent engine writes a `ChatIntentDetectedPayload` to Upstash Redis
at `shadow:{tenant_id}:{session_id}:chat_intent`.

FOLLOW-100 shipped `applyChatIntentPrior(state, intentDimensions)` in
`packages/sdk/src/core/intent.ts` and the `CHAT_INTENT_LIKELIHOODS` constant. The function is
exported but has no caller yet.

FOLLOW-101 closes the loop: the control-plane `/api/adapt` route reads the shadow key on every adapt
call, forwards the flattened `intent_dimensions` in the `AdaptResponse`, and the SDK calls
`applyChatIntentPrior` with it.

**Shadow-only constraint (Sprint 13):** this is SHADOW data — it updates the SDK intent state but is
NOT used to serve different directives to the pilot tenant. The adaptation output is still purely
behavioral. The shadow prior updates `IntentState` for disagreement-rate analysis only. The
`detectMismatch` path (quiz vs chat) can fire `quiz.mismatch` signals as designed.

---

## Architecture: data flow

```
chat.message.sent (SDK ingest) → ClickHouse
                               → Modal process_chat_message (FOLLOW-087)
                                   → Redis shadow:{tenant}:{session}:chat_intent

SDK fetchDirectives() POST /api/adapt
  ↓ control-plane adapt route (FOLLOW-101 Part A):
    read shadow:{tenant}:{session}:chat_intent from Upstash
    → AdaptResponse includes chat_intent_dimensions: Record<string, string> | null
  ↓ SDK (FOLLOW-101 Part B):
    if chat_intent_dimensions: applyChatIntentPrior(currentIntentState, chat_intent_dimensions)
    → IntentState updated (confidence, archetype, optionally chat_mismatch)
    → if chat_mismatch: dispatch quiz.mismatch ingest event
```

---

## Part A — Control-plane changes

### AC-1: Read shadow Redis key in adapt route

In `apps/control-plane/src/app/api/adapt/route.ts`, after validating the request:

1. Read from Upstash Redis using the existing `description-cache.ts` pattern (same `getRedisBase()`
   helper or a new `chat-intent-cache.ts` module). The key is:
   `shadow:{tenant_id}:{session_id}:chat_intent`

2. If the key exists, parse the JSON value as `ChatIntentDetectedPayload` from
   `apps/intent-engine/src/schemas.py` (TypeScript mirror). The relevant fields are:

   ```ts
   interface ShadowChatIntent {
     intent_dimensions: {
       purchase_purpose?: string | null;
       urgency?: string | null;
       budget_band?: string | null;
       family_stage?: string | null;
       geo_priority?: string | null;
       feature_priority?: string | null;
       cross_border?: string | null;
       finance_complexity?: string | null;
       decision_role?: string | null;
       risk_appetite?: string | null;
       emotional_state?: string | null;
       tax_aware?: boolean | null;
     };
     archetype_hint?: string;
     confidence?: number;
   }
   ```

3. Flatten `intent_dimensions` into a `Record<string, string>` for `applyChatIntentPrior`:
   - Skip null/undefined values
   - Convert boolean `tax_aware` to string: `true` → `'true'`, `false` omit (false = unknown)
   - Result: `{ purchase_purpose: 'investment', geo_priority: 'school_district', ... }`

4. Include in `AdaptResponse`:

   ```ts
   chat_intent_dimensions?: Record<string, string>;  // null when no shadow data
   ```

   The field is OPTIONAL and only present when shadow data exists for the session. Absence means "no
   chat NLP result yet" — the SDK ignores it (no change to intent state).

**Failure posture:** Redis read failure is fail-open — log at `console.warn`, return
`chat_intent_dimensions: null`. Never block the adapt response.

### AC-2: Zod schema update for AdaptResponse

In `packages/shared/src/schemas/adapt.ts` (or wherever `AdaptResponseSchema` is defined), add:

```ts
chat_intent_dimensions: z.record(z.string()).optional().nullable(),
```

This is an additive, backward-compatible change (optional field).

### AC-3: Tests (control-plane)

Add tests to the adapt route test suite:

1. When Redis contains a valid shadow key → response includes `chat_intent_dimensions` with
   flattened dimensions.
2. When Redis key absent → response has no `chat_intent_dimensions` (or `null`).
3. When Redis throws → response proceeds with `chat_intent_dimensions: null`.

---

## Part B — SDK changes

### AC-4: Call applyChatIntentPrior in adapt.ts

In `packages/sdk/src/core/adapt.ts`, after a successful `fetchDirectives()` response:

1. If `response.chat_intent_dimensions` is truthy and non-empty:

   ```ts
   import { applyChatIntentPrior } from './intent.js';
   // ...
   currentIntentState = applyChatIntentPrior(currentIntentState, response.chat_intent_dimensions);
   ```

2. If `applyChatIntentPrior` returns a state with `chat_mismatch` defined, dispatch a
   `quiz.mismatch` ingest event:

   ```ts
   if (currentIntentState.chat_mismatch) {
     eventQueue.push({
       type: 'quiz.mismatch',
       payload: {
         quiz_archetype: currentIntentState.chat_mismatch.quiz_archetype,
         chat_archetype: currentIntentState.chat_mismatch.chat_archetype,
       },
       ts: Date.now(),
     });
   }
   ```

   Note: `quiz.mismatch` event type must exist in the shared event schema (see AC-5).

3. After updating intent state, persist it to sessionStorage (following the FOLLOW-176 pattern — the
   rehydration path already exists, just ensure it runs after chat-intent update).

### AC-5: quiz.mismatch ingest event schema (if not yet present)

Check `packages/shared/src/schemas/events/quiz.ts`. If `quiz.mismatch` event type is absent, add:

```ts
export const QuizMismatchPayloadSchema = z.object({
  quiz_archetype: z.string(),
  chat_archetype: z.string(),
});
export const QuizMismatchEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('quiz.mismatch'),
  payload: QuizMismatchPayloadSchema,
});
export type QuizMismatchEvent = z.infer<typeof QuizMismatchEventSchema>;
```

Add it to the `EventSchema` discriminated union in `events/index.ts`. Update `EVENT_TYPES` count.

### AC-6: Tests (SDK)

In `packages/sdk/src/__tests__/adapt.test.ts` (or a new `chat-intent-bridge.test.ts`):

1. Mock `fetchDirectives` returning `chat_intent_dimensions: { purchase_purpose: 'investment' }` →
   verify `applyChatIntentPrior` is called (spy) and intent state is updated.
2. Mock returning no `chat_intent_dimensions` → `applyChatIntentPrior` not called.
3. Mismatch path: mock returns chat archetype ≠ quiz archetype, quiz_answered=true → `quiz.mismatch`
   event dispatched.
4. Persist: after chat-intent update, sessionStorage contains updated intent state.

---

## Out of scope for FOLLOW-101

- Writing to the MAIN Redis intent namespace (shadow-only for Sprint 13)
- Pushing results via webhook (polling on adapt call is sufficient)
- ClickHouse query in the batch cron (stubbed in FOLLOW-087, tracked separately)
- Real adaptation behavior change for the pilot tenant (SHADOW only)

---

## Files to create / modify

| File                                                                           | Action                                           |
| ------------------------------------------------------------------------------ | ------------------------------------------------ |
| `apps/control-plane/src/app/api/adapt/route.ts`                                | Read shadow Redis key, include in AdaptResponse  |
| `apps/control-plane/src/lib/chat-intent-cache.ts`                              | New helper (fail-open Redis read)                |
| `packages/shared/src/schemas/adapt.ts` (or equivalent)                         | Add optional `chat_intent_dimensions` to schema  |
| `packages/shared/src/schemas/events/quiz.ts`                                   | Add `quiz.mismatch` event type (if absent)       |
| `packages/shared/src/schemas/events/events.ts` (index)                         | Register `quiz.mismatch` in discriminated union  |
| `packages/sdk/src/core/adapt.ts`                                               | Call `applyChatIntentPrior` after adapt response |
| `packages/sdk/src/__tests__/adapt.test.ts` (or new file)                       | AC-6 tests                                       |
| `apps/control-plane/src/app/api/adapt/__tests__/route.test.ts` (or equivalent) | AC-3 tests                                       |

---

## PR requirements

- Branch: `ml-engineer/FOLLOW-101-chat-intent-prior-bridge`
- Commit: `feat(intent): chat.intent.detected → Bayesian prior bridge [FOLLOW-101]`
- All real CI gates green: Typecheck, Lint, Format, Rule H, Rule J, Cross-language
- `pnpm --filter @estalara/sdk test` coverage ≥80%
- `pnpm --filter @estalara/control-plane test` passing
- Step 5c: grep for `chat_intent_dimensions` must show ≥1 non-test producer (route.ts) AND ≥1
  non-test consumer (adapt.ts)

---

## Retrospective analyst note

After merge, spawn retrospective-analyst on this PR. Key integration check: producer in route.ts
(control-plane) reaches consumer in adapt.ts (SDK) via AdaptResponse schema. This is the pattern
where half-wires historically occur (FOLLOW-097→114→127→141 chain).
