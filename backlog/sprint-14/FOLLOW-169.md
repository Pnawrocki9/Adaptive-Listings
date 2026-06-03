# FOLLOW-169 — Bring `_generate_headline` to the description's anti-hallucination grounding bar (ADR-0009)

**Sprint:** 14 **Agent:** ml-engineer **Priority:** P2 **Estimated hours:** 4 **Status:** READY
**Source retro:** RETRO-028 §3 (LG-1, LG-2, DG-1) **Source ticket:** TICKET-DESC-001 (PR #182) /
ADR-0009 **Promoted:** 2026-06-03 (by human request)

---

## Context

The per-listing headline LLM call `_generate_headline`
(`apps/llm-gateway/src/jobs/generate_description.py` ~`:864`) uses **only an inline "do not invent"
user-message instruction**, with **no system prompt** and **no `<verified_facts_used>` audit block**
— a strictly weaker contract than the description path (`_generate_with_sonnet`), which ships the
full v1.8 XML whitelist system prompt + a fact-inventory build step + a machine-parsed audit block
logged to ClickHouse.

The headline is the single most prominent buyer-facing string, so a hallucinated
number/distance/named-entity in it has **no audit trail, no parse-time detection, and no
compliance/fair-housing record**.

Two adjacent items fold in:

- **LG-2:** the SDK headline branch (`packages/sdk/src/core/adapt-description.ts` ~`:244`) applies
  the headline without the `source === 'ai_cached'` guard the description requires (harmless today,
  latent divergence).
- **DG-1:** stale cache-key-format docstrings (`generate_description.py` module docstring; the
  `cache_key` field doc in `packages/shared/src/schemas/description.ts`) still describe the
  pre-FOLLOW-161 key shape without the `:{model}` (and `:demo:{model}`) suffix.

## Scope

### In scope

- Strengthen `_generate_headline` grounding to the description's whitelist bar.
- Add a headline anti-hallucination test analogous to the description's.
- Gate the SDK headline branch on `source === 'ai_cached'` (or a route-invariant test).
- Fix the stale cache-key-format docstrings.

### Out of scope

- Cross-language contract parity gate (FOLLOW-168).
- Production backend auth / grounding-source reachability (ESC-019) — note that until ESC-019 is
  resolved the headline is generated from an empty `original_description` in prod regardless of this
  ticket; this ticket hardens the _contract_, ESC-019 fixes the _source_.

## Acceptance criteria

The ticket is DONE when ALL of these are true:

- [ ] AC1: The headline call grounds in the same whitelist as the description — minimally a system
      prompt mirroring the v1.8 hard-rules, OR the description's already-built verified-fact
      inventory passed into the headline call instead of re-grounding from raw inputs.
- [ ] AC2: A headline asserting a fact absent from `original_description` + `listing_context` is
      detectable or suppressed (post-generation fact check, or audit-block parse), with a test
      analogous to the description's anti-hallucination test.
- [ ] AC3: The SDK headline branch is gated on `source === 'ai_cached'` for symmetry with the
      description, OR a route-invariant test asserts a non-null headline is only ever returned on
      `ai_cached`.
- [ ] AC4: The stale `desc:{...}:{locale}` cache-key-format docstrings are updated to include the
      `:{model}` (and `:demo:{model}`) suffix.
- [ ] AC5: Lint, typecheck, tests pass in CI (Python + SDK suites).

## Test plan

- Unit (Python): headline anti-hallucination test — assert an injected unsupported fact is
  suppressed/flagged.
- Unit (SDK): headline applied only on `ai_cached` (or route-invariant equivalent).
- Docstring/format assertions if practical.

## Definition of Done (universal)

- [ ] Branch named `ml-engineer/FOLLOW-169-<slug>`
- [ ] Conventional commits referencing [FOLLOW-169]
- [ ] PR opened with FOLLOW-169 in title
- [ ] All ACs verified
- [ ] CI green (typecheck, lint, test, build)
- [ ] `promoted_to_queue: true` and status synced in `backlog/FOLLOW_UPS.md`
- [ ] `retro_completed` handled by PM post-merge
