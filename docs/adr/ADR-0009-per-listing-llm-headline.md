# ADR-0009 — Per-listing LLM-generated headline via the description pipeline

**Status:** Accepted  
**Date:** 2026-06-03  
**Deciders:** Piotr Nawrocki (CEO), Rafał Palak (CTO)  
**Cross-references:** §E.7, ADR-0008

---

## Context

The synchronous `/api/adapt` endpoint returns a playbook-level headline directive per archetype (the
same ~3 A/B variants for every listing in that archetype). This gives a fast cold-start experience
but produces copy that is generic across all listings of an archetype — it does not reflect the
individual property's data.

The local demo (`scripts/dev/mock-decision-server.mjs`, function `generate()`) already generates a
per-listing headline alongside the long-form description by making a small separate LLM call
grounded in the listing's `original_description` and `listing_context`. The CEO directive is to ship
this behaviour in production.

An async description pipeline already exists (Modal job → Redis cache → `GET /api/adapt/description`
→ SDK `adapt-description.ts`). It uses an "original-first / warm cache" pattern: the SDK shows the
playbook headline/description immediately and replaces it once the Modal job has populated Redis.
Extending this pipeline to also produce and serve a per-listing headline is the lowest-risk path: it
reuses the existing Modal job, Redis key, HTTP endpoint, SDK module, and model-precedence chain
(FOLLOW-166 / FOLLOW-161), and adds no new latency to the synchronous adapt path.

---

## Decision

**The per-listing headline is produced by the existing async description pipeline.**

Specifically:

1. **Modal job** (`apps/llm-gateway/src/jobs/generate_description.py`): after generating the
   description, makes a second small LLM call (`_generate_headline`) that produces one headline
   (~max 90 chars, no quotes), strictly grounded in `original_description` + `listing_context`,
   framed for the archetype's voice. Uses the **same resolved model** as the description
   (`_resolve_generation_model` output — DEMO override > global admin default > static default).
   Headline generation failure is **non-fatal**: the description is still written to Redis;
   `headline` is written as `null` in the cache entry.

2. **Redis cache entry**: the `headline` field is added alongside `text` and `generated_at` in the
   JSON stored at the existing `desc:{tenant}:{listing}:{archetype}:{locale}:{model}` key. No new
   cache key. Model/demo switches regenerate both description and headline.

3. **`GET /api/adapt/description`** route: on cache hit, returns `headline` from the cached entry
   (or `null` when absent/failed). On cache miss (cold-start), returns `headline: null`.

4. **SDK** (`packages/sdk/src/core/adapt-description.ts`): when the response `headline` is a
   non-empty string, applies it to all `[data-estalara-slot="headline"]` elements via `textContent`
   (XSS-safe, no paragraph wrapping), with MutationObserver re-apply resilience and loop-guard — the
   same observer machinery as the description. When `headline` is null/absent, headline slots are
   **left untouched**.

---

## Headline A/B / bandit trade-off (CEO's explicit choice)

The playbook-level headline directive was the subject of an A/B / bandit variant experiment
(headline variants per archetype, `PlaybookEntry.headline_variants`, §E.7 bandit loop).

**This ADR supersedes the headline A/B/bandit variant experiment for warmed listings.**

Once the Modal job has populated Redis (typically within seconds of first page load), the SDK
applies the per-listing LLM headline, which is grounded in the specific property's data. The
archetype-level bandit variants no longer meaningfully compete: per-listing relevance is the primary
copy signal, and the single LLM call does not produce variants.

The bandit loop **continues to operate** for:

- **Cold-start views** (before the cache warms): the playbook headline directive is still the first
  thing the visitor sees, and any bandit feedback collected during cold-start remains valid signal
  for the playbook copy.
- **Other adapted slots** (`cta`, `feature`, etc.): the bandit operates unchanged on all non-
  headline slots regardless of cache state.

This trade-off is the CEO's explicit choice: per-listing factual relevance over headline A/B lift
measurement for warmed visitors.

---

## Consequences

**Positive:**

- Headlines are now per-listing rather than per-archetype — more relevant, less generic.
- No new latency on the synchronous adapt path.
- Reuses the existing description cache key, model-routing chain, and SDK module — minimal new
  surface area.
- Headline generation failure is non-fatal: cold-start behaviour is identical to before.

**Negative / trade-offs:**

- One additional Anthropic API call per listing-archetype-model cache miss (~$0.001–0.003 per Haiku
  call for 60-token headlines; bounded by the existing description pipeline's call rate).
- Headline A/B lift measurement for warmed visitors is no longer available (described above).
- Pre-ADR-0009 Redis entries do not have a `headline` field; these entries will serve
  `headline: null` until they expire and are regenerated — one TTL cycle (72h Tier 2 / 48h Tier 3)
  to fully propagate.

---

## Alternatives considered

**Generate the headline inline in `/api/adapt` (synchronous, blocking):**  
Rejected. Adds LLM latency (~200–500ms) to the synchronous adapt response that must complete in
<80ms p95. Violates the cold-start latency budget.

**Store headline in a separate Redis key:**  
Rejected. Would require the SDK to make a second HTTP request per listing, doubling API calls and
adding complexity. Riding the existing description key is strictly simpler and ensures atomic
consistency: description and headline are always from the same LLM generation.

**New A/B variants per listing (multi-armed bandit on per-listing headlines):**  
Out of scope for MVP. A/B on per-listing LLM copy would require storing N variants per listing in
Redis, a variant assignment store, and outcome attribution back to the listing level. Deferred
post-MVP.
