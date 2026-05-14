# TICKET-ARCH-002 — Master Design v1.6: adaptation engine extensions (variants, placeholder resolution, description pipeline)

**Sprint:** 8 (companion to PLAYBOOK-001/TICKET-046, DESC-001/Sprint 9,
BANDIT-VARIANTS/post-Sprint 10) **Agent:** architect **Priority:** P1 **Estimated hours:** 2
**Status:** READY **Depends on:** TICKET-046 (merged via PR #92)

## Context

PR #92 (TICKET-046 / PLAYBOOK-001) landed two structural changes that are not yet documented in
`docs/MASTER_DESIGN.md`:

1. **`SlotDirective.variants.en[]`** — 3 copy alternatives per headline slot, consumed by the
   Thompson sampling bandit (`ab_bandit_weights` table from PR #80, exercised in TICKET-AB-001 /
   Sprint 8). Section E.2 currently says "templates: 50–100 archetypów x 3 wariantów per language"
   but nothing in section E describes the data shape, where the variants live, or how the bandit
   picks one.
2. **`PlaybookEntry.copy_template.en`** — static long-form description (~130–150 words) per
   archetype. Section E.2 says "Long-form copy (description) — Claude Sonnet 4.6 — tylko Tier 3
   Native, async pre-generation, cached" but does not specify the fallback strategy, the cache key
   shape, the Tier gating (Tier 1 fallback only, Tier 2 + Tier 3 AI-cached), or the endpoint
   contract.

Additionally, `MASTER_DESIGN_PATCH_v1_5.md` ships a section **E.6 — Placeholder Resolution Order**
that has not been pasted into the main document yet. That ordering is foundational for E.7
(description generation feeds Level 6 LLM resolution) and is referenced by TICKET-AGENCY-001
(Level 2) and Sprint 10 enrichment APIs (Level 5).

## Scope (this ticket)

In `docs/MASTER_DESIGN.md`:

1. **Header** — bump version `1.4` → `1.6`, add changelog entry summarising the three additions
   below. Do not touch v1.5 patch sections beyond what's required for E.6.

2. **E.2** — append a "Definicje terminów" subsection clarifying:
   - _slot_ — DOM position identified by `data-estalara-slot="<name>"`; three canonical names:
     `headline`, `cta`, `feature`. Note that the legacy `feature-section` value used in
     `yield-hunter.ts` was a bug, fixed in PR #92.
   - _wariant_ — alternative copy for the same slot; ≥3 per `headline` slot per archetype; consumed
     by the bandit (E.3). Distinct from locale.
   - _copy_template_ — static ~130–150 word property description per archetype; the seed for Sonnet
     generation (E.7) and the Tier 1 fallback.
   - _ListingContext_ — listing data resolved by AGENCY-001 (Level 2) or enrichment APIs (Level 5),
     passed to `interpolatePlaceholders()` (SDK) and the LLM gateway prompt.

   Add an "Implementacja 3 wariantów per slot" block with the concrete example from
   `yield-hunter.ts`:
   - `variant_0` (default, alias of `slots[i].en`)
   - `variant_1`
   - `variant_2`

3. **E.3** — append one paragraph describing how the bandit picks a variant: Thompson sampling per
   `(tenant_id, archetype, variant)` row in `ab_bandit_weights`; winner index selects
   `slots[i].variants.en[winningVariant]`; the resulting `TextDirective` carries a `variant_index`
   field for downstream attribution (post-Sprint 10 TICKET-BANDIT-VARIANTS). Cross-reference E.3.1
   (CATE) and E.3.2 (multi-objective).

4. **E.5 (Reserved)** — placeholder header (one line, "Reserved for future use") so the numbering
   remains stable for any later insertion. Keeps E.6 aligned with the v1.5 patch.

5. **E.6 — Placeholder Resolution Order** — paste verbatim from
   `docs/specs/MASTER_DESIGN_PATCH_v1_5.md` (the 7-level table). Add one sentence at the end
   cross-referencing E.7: "Level 6 (LLM) for long-form description goes through the pipeline
   described in E.7, not raw LiteLLM calls."

6. **E.7 — Long-form Description Pipeline** (new). Scope:
   - **Tier gating:** Tier 1 = `copy_template.en` static, no cache, no Modal job. Tier 2 =
     AI-generated, TTL 72h, max_tokens 450, priority normal. Tier 3 = AI-generated, TTL 48h,
     max_tokens 600, priority high.
   - **Endpoint:** `GET /api/adapt/description?listing_id=…&archetype=…&tier=…&locale=…` returns
     `{ description, source, locale, generated_at }` with
     `source ∈ { ai_cached, ai_generated, template_fallback }`.
   - **Flow:** Redis lookup `desc:{tenant_id}:{listing_id}:{archetype}:{locale}` → hit returns
     `ai_cached`; miss returns `template_fallback` immediately and enqueues a Modal job
     (`apps/modal/generate_description.py`, Sonnet 4.6).
   - **Invalidation:** `listing.updated` (Redpanda) → Redis DEL `desc:{tenant_id}:{listing_id}:*`.
   - **Cost envelope:** ~$0.006–0.009 per description; lazy = $0 until requested.
   - **Owner:** backend-engineer + ml-engineer, TICKET-DESC-001, Sprint 9.

## Out of scope

- B.8, B.9, Y, P sections of `MASTER_DESIGN_PATCH_v1_5.md` — these get a separate paste ticket (e.g.
  TICKET-ARCH-003). Sprint 7.5 docs already live in `docs/specs/SPRINT_7_5_SPEC.md`.
- Implementation of `/api/adapt/description`, `generate_description.py`, or Redis cache — those are
  TICKET-DESC-001 (Sprint 9), not this ticket.
- Wiring `variant_index` selection logic — that is TICKET-BANDIT-VARIANTS, post-Sprint 10.

## Acceptance criteria

- [ ] `docs/MASTER_DESIGN.md` version bumped to v1.6 with a clear changelog entry.
- [ ] E.2 contains the new definitions block + 3-variant implementation example.
- [ ] E.3 references the bandit's variant selection mechanism.
- [ ] E.6 (Placeholder Resolution Order, 7-level table) is present.
- [ ] E.7 (Long-form Description Pipeline) is present with the contract above.
- [ ] `grep -n "feature-section" docs/MASTER_DESIGN.md` returns at most one historical reference
      (the bugfix note in E.2). No new occurrences.
- [ ] No other sections modified; diff is doc-only.
- [ ] Branch `architect/TICKET-ARCH-002-master-design-v1-6` pushed; PR opened against `main`
      referencing PR #92.

## References

- PR #92 — TICKET-046 (PLAYBOOK-001 implementation)
- `docs/specs/MASTER_DESIGN_PATCH_v1_5.md` — source for E.6
- `/root/.claude/plans/na-mvp-robimy-18-mutable-cascade.md` — full plan with rationale
- `packages/sdk/src/core/playbooks/types.ts` — `SlotDirective.variants`,
  `PlaybookEntry.copy_template`
- `packages/sdk/src/core/playbooks/archetypes/yield-hunter.ts` — variants/copy_template reference
