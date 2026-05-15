# Cold Start Protection — Adaptation Pipeline Redesign (v1)

**Status:** DRAFT — pending Piotr's review of templates and impl plan. **Date:** 2026-05-15.
**Authors:** Opus 4.7 (template authoring + impl design), reviewed by Piotr. **Supersedes:** Master
Design E.7.1 / E.7.3 (current "template_fallback returns Opus archetype template as direct render"
behaviour).

---

## 1. Problem statement

The current Master Design E.7.3 flow renders the static `PlaybookEntry.copy_template.en` directly to
the buyer on cache miss (and always for Tier 1). Two failure modes:

1. **Factual drift.** Each listing is unique. A static archetype template — even a 150-word one with
   placeholders — cannot honour the agency's specific framing, the genuine standout features, or the
   local context that the agent's own copy captures. Substituting it on first visit feels synthetic
   and demotes the listing.
2. **Brand risk.** First-time visitors to a listing form a quality impression in the first 3
   seconds. A generic template rendered while Sonnet warms (~3–8s) means the very first impression —
   the one that determines whether the buyer scrolls or leaves — is the weakest version of the page.

The product implication: **the buyer-adapted copy must replace the agent's copy only when we have
evidence it is materially better.** Otherwise, the agent's copy stands.

## 2. Cold Start Protection — the new flow

```
Buyer arrives at listing L with archetype A and locale loc:
  cache_key = desc:{tenant_id}:{listing_id}:{archetype}:{locale}

  IF Redis.GET(cache_key) is non-empty:
    # Sonnet has previously generated for this (listing, archetype) pair
    return {
      description: cached.text,
      source: 'ai_cached',
      generated_at: cached.generated_at
    }

  ELSE IF listing.description is non-empty:
    # Cold start with agent original available.
    # Includes: first ever visit, archetype not seen here before, or cache expired.
    enqueue_sonnet_job({
      tenant_id, listing_id, archetype, locale, cache_key,
      seeds: {
        original_agent_copy: listing.description,           # SEED 1 — factual ground truth
        archetype_template:  PlaybookEntry.copy_template[locale], # SEED 2 — Opus pattern (locale-matched)
        listing_context:     listing.fields                  # SEED 3 — facts (bedrooms, price, yield, …)
      }
    })
    return {
      description: listing.description,    # the agent's original copy, untouched
      source: 'original_agent_copy',
      generated_at: listing.updated_at
    }

  ELSE:
    # Edge case: agent has not supplied description copy for this listing at all.
    # Render the Opus template in the requested locale, with placeholders resolved
    # from listing_context. Still enqueue Sonnet (passing empty SEED 1) so the
    # second buyer gets an AI-grounded version generated from template + context only.
    enqueue_sonnet_job({
      tenant_id, listing_id, archetype, locale, cache_key,
      seeds: {
        original_agent_copy: '',                            # SEED 1 empty — prompt notes "no original"
        archetype_template:  PlaybookEntry.copy_template[locale],
        listing_context:     listing.fields
      }
    })
    return {
      description: resolve_placeholders(PlaybookEntry.copy_template[locale], listing.fields),
      source: 'template_fallback',
      generated_at: listing.updated_at
    }
```

**Key invariants:**

- When the agent's `listing.description` exists, the buyer sees that on cache miss. The template is
  NEVER substituted for an existing agent original.
- The Opus-authored `copy_template.{en|pl|es}` renders directly only in the missing-original edge
  case — never when the agent has supplied copy.
- The first buyer of every (listing, archetype) pair where the agent has supplied copy always sees
  the agent's original. Sonnet generation runs in the background and is cached for the second buyer
  onwards.
- When TTL expires (Tier 2: 72h; Tier 3: 48h), the next buyer falls back gracefully — to the agent's
  original if it still exists, otherwise to the locale template.
- Locale selection: `PlaybookEntry.copy_template[locale]` falls back to `.en` if the requested
  locale is not authored for that archetype.

**`source` enum (revised v1.7.1 — three values):**

| Value                 | Meaning                                                                                 | Status                       |
| --------------------- | --------------------------------------------------------------------------------------- | ---------------------------- |
| `ai_cached`           | Sonnet output, Redis cache hit                                                          | Unchanged                    |
| `original_agent_copy` | Agent's untouched copy from `listing.description` (cold start path)                     | **NEW (v1.7)**               |
| `template_fallback`   | Opus template, placeholders resolved from `listing_context`. ONLY for missing-original. | **REUSED**, narrowed meaning |
| `ai_generated`        | Reserved, unused                                                                        | Legacy compat                |

## 3. Tier gating (revised)

| Tier | Source on cache hit | Source on cache miss (agent original exists)                     | Source on cache miss (no agent original)             | Endpoint exposed                                                     |
| ---- | ------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| 1    | n/a                 | n/a                                                              | n/a                                                  | **No** — Tier 1 Observer never mutates description; reads from page. |
| 2    | `ai_cached`         | `original_agent_copy` + enqueue Sonnet (TTL 72h, max_tokens 450) | `template_fallback` + enqueue Sonnet w/ empty SEED 1 | Yes                                                                  |
| 3    | `ai_cached`         | `original_agent_copy` + enqueue Sonnet (TTL 48h, max_tokens 600) | `template_fallback` + enqueue Sonnet w/ empty SEED 1 | Yes                                                                  |

Locale handling: each tier serves the request in the locale requested by the SDK. Templates exist in
EN, PL, and ES (per `docs/specs/cold-start-archetype-templates-v1.md`). Other locales fall back to
EN at the template-selection step, while Sonnet still attempts generation in the requested locale
(using the EN template as voice seed).

Rationale for Tier 1 change: Tier 1 = "read-only sidebar widget, no DOM mutation" (CLAUDE.md). The
original spec wired Tier 1 through `/api/adapt/description` returning `template_fallback`, but Tier
1 by definition doesn't replace the description in the host DOM — so the endpoint call was
redundant. Removing it shaves a network round-trip on every Tier 1 listing impression.

## 4. The three Sonnet seeds — prompt construction

`apps/llm-gateway/src/jobs/generate_description.py` already accepts `copy_template` and
`listing_context` keys (lines 178–189). The new flow adds `original_agent_copy` as a third explicit
seed. The prompt has two branches conditioned on whether SEED 1 is non-empty.

### 4.1. Standard branch — SEED 1 (agent original) present

```
SYSTEM:
You are a real estate copywriter specialising in buyer-persona-adapted descriptions.
Rewrite an estate agent's original property description so it resonates with a specific
buyer archetype. You must:
  1. Preserve every factual claim in the agent's original (no invented features, no
     adjusted prices, no fabricated metrics).
  2. Adopt the voice, rhythm, and emphasis of the provided archetype pattern.
  3. Surface the property facts most relevant to this archetype's motivations.
  4. Write in the requested locale ({locale}). If the archetype template seed is in
     a different locale, use it for voice/rhythm only — the output must be in {locale}.
Output ONLY the rewritten description — no introductory phrases, no meta-commentary,
no labels, no quotation marks.

USER:
Archetype: {archetype}
Locale: {locale}

Copywriting focus for this archetype:
{_ARCHETYPE_GUIDANCE[archetype]}

Archetype voice pattern (use as stylistic template — do NOT copy verbatim; reshape
around the agent's facts):
{archetype_template}      # ← SEED 2: Opus-authored copy_template[locale] (fallback to .en)

Property facts (the agent's original copy is the source of truth; treat every claim
here as a fact you may keep, condense, or emphasise — never contradict):
{original_agent_copy}     # ← SEED 1: agent's pristine description (non-empty)

Structured listing context (additional facts; do NOT invent values not present here):
{listing_context_json}    # ← SEED 3: bedrooms, price, yield, etc.

Write a ~{target_words}-word property description for a {archetype} buyer in {locale}.
```

### 4.2. Missing-original branch — SEED 1 empty

```
SYSTEM:
(same as 4.1, but adjust rule 1 below)
You are a real estate copywriter specialising in buyer-persona-adapted descriptions.
The agent has not supplied an original description for this listing. Generate a
property description grounded strictly in the archetype voice pattern and the
structured listing context provided. You must:
  1. Do not invent any property feature, price, yield, or other claim not present
     in the listing context.
  2. Adopt the voice, rhythm, and emphasis of the provided archetype pattern.
  3. Output in the requested locale ({locale}).
Output ONLY the description — no introductory phrases, no meta-commentary.

USER:
Archetype: {archetype}
Locale: {locale}

Copywriting focus for this archetype:
{_ARCHETYPE_GUIDANCE[archetype]}

Archetype voice pattern (use as stylistic template):
{archetype_template}      # ← SEED 2

Structured listing context (the ONLY source of factual claims):
{listing_context_json}    # ← SEED 3

[No SEED 1 — the agent has not authored a description for this listing.]

Write a ~{target_words}-word property description for a {archetype} buyer in {locale}.
```

### 4.3. Seed priorities summary

The three-seed prompt is the heart of Cold Start Protection: SEED 1 anchors the rewrite to truth,
SEED 2 supplies the voice, SEED 3 fills gaps. In the standard branch Sonnet is doing **adaptation**;
in the missing-original branch Sonnet is doing **generation from structured facts only**, which is
the riskier path — the missing-original case should be rare in production and the templates were
authored with that direct-render scenario in mind.

## 5. Impl plan — code modifications

### 5.1. Endpoint (apps/control-plane)

**File:** `apps/control-plane/src/app/api/adapt/description/route.ts` (NEW)

- `GET /api/adapt/description?listing_id=…&archetype=…&tier=…&locale=…`
- Auth: tenant-scoped Bearer JWT (same scheme as `/api/adapt`).
- Reject Tier 1 with 400 (`{"error":"description endpoint not available for Tier 1"}`).
- Fetch listing from Postgres (`listings` table) — need `description` and `updated_at` columns.
- Cache lookup at `desc:{tenant_id}:{listing_id}:{archetype}:{locale}`.
  - Hit → return `ai_cached`.
  - Miss + `listing.description` non-empty → emit Redpanda event with three seeds (SEED 1 =
    `listing.description`); return `original_agent_copy`.
  - Miss + `listing.description` empty → resolve placeholders in
    `PlaybookEntry.copy_template[locale]` (with EN fallback) against `listing.fields`; emit Redpanda
    event with three seeds (SEED 1 = ''), return `template_fallback` with the resolved template
    body.
- Placeholder resolver: `{token}` → `listing.fields[token]` if present, else drop the token and any
  immediately surrounding whitespace/punctuation that becomes superfluous. Idempotent.
- Latency budget: p95 < 100ms (cache hit), < 150ms (cache miss path — listing fetch + Redpanda
  produce + JSON serialise + placeholder resolution for fallback branch).

**Tests:** `route.test.ts` — at minimum:

- Tier 1 rejection.
- Cache hit returns `ai_cached`.
- Cache miss with agent original returns `original_agent_copy` AND produces a Redpanda message with
  all three seeds (mock the producer).
- Cache miss with empty `listing.description` returns `template_fallback` with placeholders resolved
  AND produces a Redpanda message with SEED 1 empty.
- Missing listing returns 404.
- Locale handling: PL and ES request returns the appropriate-locale template_fallback when
  applicable; unknown locale falls back to EN template body but locale param echoed in response.

### 5.2. Modal job (apps/llm-gateway)

**File:** `apps/llm-gateway/src/jobs/generate_description.py`

- Add `original_agent_copy: str` field to the `event` payload contract (line 171–181 docstring).
- Rewrite `_generate_with_sonnet()` (lines 233–321) to use the two-branch three-seed prompt from §4
  above. Branch on `original_agent_copy != ''`.
- Keep `_ARCHETYPE_GUIDANCE` (lines 48–124) — it complements rather than duplicates the template
  seeds. **Add PL and ES variants** of each guidance string keyed by `(archetype, locale)`. EN
  guidance is the authoritative copy; PL/ES are concise translations of the focus areas.
- Update `consume_description_requests()` required-fields check (line 459) to include
  `original_agent_copy` (can be empty string but must be present).
- Tests: update `test_generate_description.py` —
  - Standard-branch fixture: includes all three seeds non-empty; assert prompt contains "agent's
    original" anchor language and "do NOT contradict" guardrail.
  - Missing-original-branch fixture: SEED 1 empty; assert prompt contains "agent has not supplied"
    language and "do not invent any property feature" guardrail.
  - Locale fixtures: PL and ES requests use PL/ES `archetype_template` seed and PL/ES guidance.

### 5.3. Archetype templates (packages/sdk)

**Files:** all 18 of `packages/sdk/src/core/playbooks/archetypes/*.ts`.

Replace each `copy_template` block with the Opus-authored versions from
`docs/specs/cold-start-archetype-templates-v1.md` — **all three locales** (`en`, `pl`, `es`). The
`PlaybookEntry.copy_template` field type already permits all three (see
`packages/sdk/src/core/playbooks/types.ts`). **Do not** modify the `slots`, `listing_rules`,
`feature_priority`, or `signals` fields — those are unaffected by Cold Start Protection.

Add a JSDoc comment block above each `copy_template`:

```ts
/**
 * Sonnet prompt seed (SEED 2) for the description pipeline (Cold Start Protection,
 * Master Design E.7.7). Three locales authored by Opus 4.7. Rendered DIRECTLY to
 * a buyer only in the missing-original edge case (source: 'template_fallback');
 * otherwise serves as the voice pattern in the Sonnet three-seed prompt.
 * See docs/specs/cold-start-protection-v1.md §2 for flow.
 * Preserve voice/rhythm when editing — voice notes per archetype in
 * docs/specs/cold-start-archetype-templates-v1.md.
 */
copy_template: {
  en: '...',
  pl: '...',
  es: '...',
},
```

**Tests:** existing playbook tests assert presence of `copy_template.en`. Add per archetype:

- Presence test for `copy_template.pl` and `copy_template.es` (non-empty strings).
- Word-count test: 80–180 words for each locale (neutral allowed shorter).
- Placeholder-discipline test: every `{token}` in any locale appears in the archetype's row of the
  placeholder reference table (encoded as a fixture).
- Market-correctness lint (lightweight): assert PL template doesn't contain literal "Help-to-Buy"
  (UK-specific); assert ES template doesn't contain literal "Golden Visa" except in repealed context
  (substring "tras la finalización" or similar disclaimer).

### 5.4. Listing schema (packages/db)

The endpoint needs `listings.description` and `listings.updated_at`. If `description` is not already
a column on `listings`, add it (text NOT NULL DEFAULT ''). Defer to backend-engineer to confirm
current schema.

### 5.5. Redpanda topic schema (packages/shared)

The `estalara.descriptions` event payload schema (likely in `packages/shared/src/events/`) needs
`original_agent_copy: string` added as a required field. Zod schema update + version bump on the
topic.

### 5.6. Cache invalidation (E.7.4 unchanged)

Existing `listing.updated` → `Redis DEL desc:{tenant}:{listing}:*` flow is unaffected. Cold Start
Protection makes invalidation more important: when an agent updates the source copy, all archetype
caches must drop so the next buyer of each archetype sees the new agent original (and Sonnet
regenerates against the new source).

### 5.7. Observability

ClickHouse `description_calls` table (or extend `llm_calls`) — add `source` column with values from
§2 table. Daily Grafana panel: `% of requests served as original_agent_copy` per tenant — high
values indicate (a) very fresh listings, (b) very fragmented archetype distribution per listing, or
(c) Sonnet job failures. Threshold alert: >40% sustained for >24h → on-call ping (likely Modal job
degraded).

## 6. Backlog impact — tickets to create

The PM orchestrator should generate these from this spec at next sprint planning:

| Ticket ID       | Owner               | Scope                                                                                                                                       |
| --------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| TICKET-COLD-001 | backend-engineer    | `/api/adapt/description` endpoint with two-branch cache miss (5.1) + listing schema migration (5.4) + placeholder resolver                  |
| TICKET-COLD-002 | ml-engineer         | Modal job two-branch three-seed prompt + payload contract update + `_ARCHETYPE_GUIDANCE` PL/ES additions (5.2)                              |
| TICKET-COLD-003 | sdk-engineer        | Swap 18 archetype `copy_template` blocks to Opus-authored EN/PL/ES versions (5.3) + tests for word count, placeholders, market-correctness  |
| TICKET-COLD-004 | data-engineer       | Redpanda topic schema bump + Zod (5.5) — `original_agent_copy` required field                                                               |
| TICKET-COLD-005 | data-engineer       | ClickHouse `source` column + Grafana panel + alert (5.7) — three values: `ai_cached`, `original_agent_copy`, `template_fallback`            |
| TICKET-COLD-006 | qa-engineer         | E2E across locales: first buyer in EN/PL/ES sees `original_agent_copy`, second buyer sees `ai_cached`. Plus missing-original path coverage. |
| TICKET-COLD-007 | compliance-engineer | Update DPIA — three-seed prompt logs `original_agent_copy` (PII review on agent copy)                                                       |

Note on COLD-007: agent-authored property copy is generally not PII, but may contain agent's name,
agent contact details, or third-party names. Compliance review required before the three-seed
payload hits Modal logs.

## 7. Migration / rollout

The current state of the codebase (as of commit b55c025):

- The `/api/adapt/description` endpoint **does not yet exist** in `apps/control-plane`. The
  Modal-side `generate_description.py` was merged in PR #112 but is not yet wired to a producer.
- Therefore there is **no backwards compatibility surface** to break. Cold Start Protection can be
  the only flow built — no feature flag, no dual-path migration.

The change is purely additive: existing `copy_template.en` values stay valid as Sonnet seeds.
Swapping them to Opus-authored versions (5.3) is an in-place improvement, not a contract break.

## 8. Open questions for human review

1. **Cache key collision when an agent updates listing copy.** §5.6 says invalidation handles this.
   Confirm: do we trust `listing.updated_at` enough to also include it as part of the cache key for
   natural invalidation? (e.g. `desc:{tenant}:{listing}:{updated_at_unix}:{archetype}:{locale}`).
   Argument for: zero-window invalidation. Argument against: cache thrash when agents tweak
   punctuation.
2. **Locale fallback.** If `original_agent_copy` is only in `en` but buyer requests `pl`, do we (a)
   translate first then adapt, (b) adapt in en then translate, (c) refuse and return en? Recommend
   (c) for MVP — simpler, factual integrity is highest priority.
3. **A/B testing.** Should we randomly serve `original_agent_copy` to 5% of cache-hit traffic for
   the first 30 days to measure lift? This is the only way to prove Cold Start Protection's economic
   value to tenants.

---

**End of v1.** The 18 archetype templates are in `docs/specs/cold-start-archetype-templates-v1.md` —
review there for voice/quality before TICKET-COLD-003 swaps them into the .ts files.
