# TICKET-AGENCY-001 — Agency Answers RAG Pipeline (FAQ → LLM Context)

**Sprint:** 8 **Agent:** backend-engineer **Priority:** P1 **Estimated hours:** 8 **Status:** READY
**Depends on:** TICKET-ADP-002 (merged PR #70), TICKET-AB-001 (merged PR #80) **Unblocks:**
TICKET-DESC-001 (Sprint 9)

## Context

Master Design section E.6 describes Level 2 placeholder resolution: agency-provided listing data
(price, yield %, bedrooms, etc.) injected into LLM prompts at adapt time. Currently, the LLM
gateway's `LlmGatewayInput` has no `listingContext` field — the Haiku and Sonnet prompts cannot
reference agency-curated data. Adaptation copy is therefore generic, with placeholders like
`{yield}` left unresolved.

This ticket:

1. Creates an `answers` table for agency staff to store per-listing FAQ/metadata
2. Adds CRUD API endpoints under `/api/tenants/:id/answers`
3. Adds a RAG retrieval step in `llm-gateway.ts` (pgvector cosine similarity → top-3 FAQ injected
   into prompt context)
4. Adds a `/dashboard/listings/:id/answers` management UI for agency staff
5. Wires `listingContext` into `LlmGatewayInput` so both Haiku and Sonnet prompts can reference real
   listing data

**References:**

- `apps/control-plane/src/lib/llm-gateway.ts:25` — `LlmGatewayInput` interface to extend
- `packages/db/src/schema/_pgvector.ts` — `vector()` custom column helper (reuse, do not copy)
- `packages/db/src/schema/archetype_embeddings.ts` — reference for pgvector column pattern
- `packages/db/src/schema/tenants.ts` — `tenantId` FK reference
- `apps/control-plane/src/app/api/adapt/route.ts` — where `callLlmGateway()` is called (add
  `listingContext` retrieval here before the gateway call)
- Master Design E.6 — placeholder resolution order (Level 1 = DOM attrs, Level 2 = agency data,
  Level 3 = enrichment APIs, Level 4 = LLM inference, Level 5 = external APIs)
- RETRO-001 finding 3a — gap identified: `listingContext` missing from `LlmGatewayInput`

## Acceptance criteria

1. **`answers` table exists.** A new Drizzle table `packages/db/src/schema/answers.ts` with:
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
   - `listing_id text NOT NULL` (external listing identifier, no FK — tenants use their own IDs)
   - `question text NOT NULL`
   - `answer text NOT NULL`
   - `question_embedding vector(1536) NOT NULL` (OpenAI text-embedding-3-small)
   - `created_at timestamptz NOT NULL DEFAULT now()`
   - `updated_at timestamptz NOT NULL DEFAULT now()`
   - Index: `idx_answers_tenant_listing ON answers(tenant_id, listing_id)`
   - RLS: tenant can read/write only its own rows (mirror pattern from `tenant_site_schemas.ts`)
   - Migration generated via `pnpm --filter @estalara/db drizzle-kit generate`

2. **CRUD API.** Four route handlers under `apps/control-plane/src/app/api/tenants/[id]/answers/`:
   - `POST route.ts` — create answer; auto-embed `question` via OpenAI `text-embedding-3-small`
     before insert. Returns `201` + the created row.
   - `GET route.ts` — list all answers for `(tenant_id, listing_id)`. Query param:
     `?listing_id=<id>` (required). Returns `200` + array of rows (without embedding column).
   - `PATCH [answerId]/route.ts` — update `question`/`answer`; re-embed if `question` changed.
   - `DELETE [answerId]/route.ts` — delete by `answerId`. RLS enforces tenant isolation.
   - All routes require Bearer JWT auth (reuse existing `validateTenantAuth()` helper). Return `401`
     if token invalid, `403` if tenant mismatch, `404` if row not found.

3. **RAG retrieval in llm-gateway.** In `apps/control-plane/src/lib/llm-gateway.ts`:
   - Add `listingContext?: Record<string, string>` to `LlmGatewayInput` interface.
   - In `buildHaikuPrompt()` and `buildSonnetPrompt()`, when `listingContext` is non-empty, append a
     context block after the archetype description and before the slot instructions:

     ```
     Listing context (agency-provided):
     {key}: {value}
     {key}: {value}
     ...
     Use this data to fill placeholder tokens in copy (e.g., replace {yield} with the
     value from "yield" context key). If a key is missing, omit the token rather than
     guessing.
     ```

4. **`listingContext` populated at adapt time.** In `apps/control-plane/src/app/api/adapt/route.ts`
   (or wherever `callLlmGateway()` is invoked), before the gateway call:
   - If `listing_id` is present in the adapt request, query the `answers` table for rows matching
     `(tenant_id, listing_id)`.
   - Compute cosine similarity between the session's `intentVector` (from `session_embeddings` or
     the incoming intent signal) and each row's `question_embedding`.
   - Pass the top-3 highest-similarity answers as
     `listingContext: { [answer.question]: answer.answer }` into `LlmGatewayInput`.
   - If `listing_id` is absent or no answers exist, pass `listingContext: {}` (empty — prompts
     handle the missing-context case gracefully per AC 3).
   - This lookup must add <10ms p95 latency (single indexed pgvector query with limit 3).

5. **Dashboard UI page.** Create
   `apps/control-plane/src/app/dashboard/listings/[id]/answers/page.tsx`:
   - Lists all FAQ answers for the listing.
   - "Add answer" form: question + answer text fields → calls `POST /api/tenants/:id/answers`.
   - Each row has Edit and Delete actions.
   - Uses existing dashboard layout, Tailwind styling consistent with existing pages.
   - No custom design system components required — `<input>`, `<textarea>`, `<button>` with Tailwind
     classes matching `apps/control-plane/src/app/dashboard/` patterns.
   - Empty state: "No FAQ answers yet. Add the first one to help buyers get relevant copy."

6. **Test coverage ≥70%.** Unit tests for:
   - `listingContext` injection in `buildHaikuPrompt()` / `buildSonnetPrompt()` (assert the context
     block appears in output when `listingContext` is non-empty; assert prompt is unchanged when
     `listingContext` is absent or empty)
   - RAG retrieval logic: mock `answers` table rows, assert top-3 selection by cosine score
   - API route: happy-path create → list → update → delete (mock DB + OpenAI embedding call)
   - RLS isolation: tenant A cannot read tenant B's answers (use two distinct tenant IDs)

7. **No `any` without inline disable + reason.**

8. **`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass locally.**

## Files to touch

| File                                                                      | Action                                                    |
| ------------------------------------------------------------------------- | --------------------------------------------------------- |
| `packages/db/src/schema/answers.ts`                                       | NEW — Drizzle table definition                            |
| `packages/db/src/schema/index.ts`                                         | Export new `answers` table                                |
| `packages/db/migrations/`                                                 | Generated migration from drizzle-kit                      |
| `apps/control-plane/src/lib/llm-gateway.ts`                               | Add `listingContext` to input interface + prompt builders |
| `apps/control-plane/src/app/api/adapt/route.ts`                           | Populate `listingContext` before gateway call             |
| `apps/control-plane/src/app/api/tenants/[id]/answers/route.ts`            | NEW — POST + GET handlers                                 |
| `apps/control-plane/src/app/api/tenants/[id]/answers/[answerId]/route.ts` | NEW — PATCH + DELETE                                      |
| `apps/control-plane/src/app/dashboard/listings/[id]/answers/page.tsx`     | NEW — management UI                                       |
| `apps/control-plane/src/lib/__tests__/llm-gateway.test.ts`                | Extend with `listingContext` cases                        |

## Implementation notes

- **Embedding call**: Use the same OpenAI client already present in the control-plane (grep for
  `openai` or `text-embedding` to find the existing client). Do NOT introduce a new client.
- **pgvector cosine query** (raw SQL via Drizzle `sql` template):
  ```sql
  SELECT question, answer,
    1 - (question_embedding <=> ${intentVector}::vector) AS similarity
  FROM answers
  WHERE tenant_id = ${tenantId} AND listing_id = ${listingId}
  ORDER BY question_embedding <=> ${intentVector}::vector
  LIMIT 3
  ```
  The `<=>` operator is cosine distance (pgvector). `1 - distance = similarity`.
- **Intent vector source**: The adapt route receives a session intent vector from the intent engine
  response. Use that vector directly. If unavailable, skip the RAG step and pass
  `listingContext: {}`.
- **Re-embed on question update**: Only re-call OpenAI if `question` field changes in PATCH. If only
  `answer` changes, reuse the existing `question_embedding`.

## Branch naming

`backend-engineer/TICKET-AGENCY-001-agency-answers-rag`

## PR title format

`feat(control-plane,db): agency answers table + RAG pipeline → LLM context [TICKET-AGENCY-001]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- PM-orchestrator validates AC items above.
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
