# TICKET-DESC-PIVOT-001 v1.8 — Adaptive-listing system prompt rewrite

**Status:** IMPLEMENTED (working tree → branch
`ml-engineer/TICKET-DESC-PIVOT-001-v1.8-adaptive-prompt`) **Date:** 1 June 2026 **Author:** Piotr
Nawrocki (CEO) + Claude (Opus 4.8) **Supersedes:** the v1.7.1 system prompt in Appendix B of
`docs/specs/TICKET-DESC-PIVOT-001-v1.7.1.md` (that document remains the historical record of the
anti-hallucination + voice-pattern decisions).

---

## 1. Why v1.8

v1.7.1 shipped the right _contract_ (strict fact whitelist + `<verified_facts_used>` audit block)
but the prompt itself was a short, flat, prose ruleset with two weaknesses observed in generation
output:

1. **Fixed ~140-word target.** A listing whose agent original is 60 words or 320 words both got
   forced toward ~140 — either padded (toward hallucination pressure) or truncated (dropping
   verified facts the agent intended to convey).
2. **Thin voice/style guidance.** The copy read like generated marketing text ("nestled", "boasts",
   "stunning") rather than an experienced human copywriter writing for one specific buyer. No worked
   examples, so the model under-applied the cashflow-theme-without-data rule.

v1.8 keeps the exact same anti-hallucination contract and only strengthens _how_ the model writes.

## 2. What changed (v1.7.1 → v1.8)

| Aspect              | v1.7.1                                    | v1.8                                                                                                                                                                                                                    |
| ------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt structure    | Flat prose, numbered WHITELIST RULES      | Full XML-structured template: `objective / context / inputs / instructions / fact_whitelist_rules / voice_adaptation / style_guide / output_format / examples / exceptions / guardrails / priority / output_validation` |
| Length policy       | `Target length: ~140 words`               | Length **tracks `original_description` (±10% by word count)**; never drop a verified fact to hit a length; modest over-run allowed only to include verified facts from `listing_context`                                |
| Voice / style       | "Match the register of the voice pattern" | Dedicated `<style_guide>`: human register, lead with the archetype's strongest verified point, vary sentence length, **banned-cliché list** ("nestled", "boasts", "stunning", "a true gem", "won't last long", …)       |
| Examples            | None                                      | Three worked `<example>`s: investor/en (cashflow grounded in a real tenanted fact), investor/en (cashflow theme with **no** number → generic language only), lifestyle/es (native Spanish, not translated)              |
| Theme-without-data  | Rule 4 (cashflow-specific)                | Generalised in `fact_whitelist_rules` #4 to any theme (cashflow / schools / transport / prestige / lifestyle)                                                                                                           |
| Conflict resolution | Implicit                                  | Explicit `<priority>` order: (1) fact whitelist → (2) hard rules → (3) voice/archetype fit → (4) human authenticity → (5) length/format                                                                                 |
| Self-check          | None                                      | `<output_validation>` block the model runs silently before emitting                                                                                                                                                     |
| Anti-hallucination  | Whitelist + `<verified_facts_used>`       | **Unchanged** — identical contract, identical audit block                                                                                                                                                               |

## 3. Code change

`apps/llm-gateway/src/jobs/generate_description.py`

- `_SONNET_SYSTEM_PROMPT_TEMPLATE` replaced with the v1.8 XML template. Still parameterised on the
  two placeholders `{archetype}` and `{locale}`.
- **Substitution switched from `.format()` to `.replace()`.** The v1.8 body contains many literal
  braces and XML-ish tokens; `str.format` raises on any brace that is not a named field, so the two
  placeholders are now substituted with
  `.replace("{archetype}", archetype).replace("{locale}", locale)`.
- Module docstring header updated v1.7.1 → v1.8.
- File-level `# ruff: noqa: E501` added with a justifying comment: the prompt is intentionally long
  unwrapped prose; reflowing to satisfy E501 would insert newlines into the text the model receives.
  (ruff is not a CI gate — CI runs `pytest` only — so this is a local-cleanliness measure, not a CI
  fix.)

No change to: the user-prompt assembly, `_parse_verified_facts`, the Redis/ClickHouse write path,
TTLs, `max_tokens` (Tier 2 = 450, Tier 3 = 600), or the response contract.

## 4. Verification

- `python3 -m pytest src/jobs/test_generate_description.py` → **17 passed**. The suite asserts
  parser behaviour and hallucination resistance against mocked Sonnet output; it does not assert on
  the prompt template string, so the rewrite is structurally compatible.
- `python3 -m black --check` → clean. `python3 -m ruff check` → clean (E501 silenced file-wide as
  above).

## 5. Open follow-ups / not in scope

- **Model is still hardcoded** at `generate_description.py` (`model="claude-sonnet-4-6"`). Making
  the generation model admin-selectable (single global default, no per-tenant override) is
  **FOLLOW-161** (P2) — out of scope here.
- No live end-to-end generation was run against the real Anthropic API as part of this change;
  validation is unit-level. A qualitative spot-check of v1.8 output across a few archetypes ×
  locales is recommended before relying on the new length/voice behaviour in the pilot.
- Master Design §E.7 still documents the v1.7.1 prompt shape. If the XML structure is considered
  canonical, a doc propagation pass on §E.7.4/§E.7.5 should follow (Operating Principle 2).
