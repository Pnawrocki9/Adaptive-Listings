# ADR-0010 — Archetype-fit gate: the description model may decline to adapt (NEUTRAL verdict)

**Status:** Accepted  
**Date:** 2026-06-03  
**Deciders:** Piotr Nawrocki (CEO)  
**Cross-references:** §E.7, ADR-0009, prompt v1.8 → v1.9

---

## Context

The v1.8 adaptive-listing prompt (`generate_description.py`) always produced an archetype-adapted
description for whatever (listing, archetype) pair it received. Its anti-hallucination whitelist
stopped the model inventing facts, but it could not stop the model from **spinning genuinely
mismatched verified facts** to fit an archetype the property does not serve — e.g. presenting a
2-bed, 32nd-floor lock-and-leave investment condo (no outdoor space, urban-nightlife setting) to a
`family_buyer`. The result reads as plausible but quietly misleads the reader: the copy implies the
property suits a buyer it does not.

The intent engine can mis-assign an archetype (low-confidence cold-start, ambiguous signals), and
even a correct archetype can land on a listing whose facts contradict that buyer's core needs. v1.8
had no way to say "this is the wrong buyer — don't adapt."

## Decision

**The description prompt (v1.9) runs an archetype-fit gate and may return a NEUTRAL verdict, in
which case no description is generated and the DOM stays in its neutral, unmodified state.**

Specifically:

1. **Prompt v1.9** adds an `<archetype_fit_gate>` and requires the output to open with
   `<adaptation_verdict>FIT|NEUTRAL</adaptation_verdict>`.
   - **NEUTRAL** — the verified facts fundamentally contradict the archetype's core needs. The model
     must NOT reframe/"rescue" the listing; it returns only the verdict plus an optional
     `<neutral_reason>` snake_case code (for analytics), and no description body.
   - **FIT** — at least one honest, appealing angle exists; the model writes the description as in
     v1.8 (whitelist + ±10% length policy unchanged). Minor mismatch is still FIT (do not overclaim,
     do not invent the missing pieces).

2. **Modal job** (`generate_description.py`): `_parse_adaptation_verdict()` reads the verdict.
   - NEUTRAL → return `("", [])`. This is handled exactly like an empty response: **no Redis
     write**, idempotent retry-safe, and — because the caller early-returns on an empty description
     before `_generate_headline` — **the per-listing headline is suppressed too**. The endpoint then
     serves `template_fallback` (the agent's original copy) and the SDK leaves the slots untouched.
   - FIT → strip the verdict tag, then parse the body + `<verified_facts_used>` as in v1.8.
   - A **missing** verdict tag defaults to FIT (backward-safe: a non-compliant/legacy output is
     treated as a normal description, never as a silent neutral).

3. **Mock decision harness** (`scripts/dev/mock-decision-server.mjs`) mirrors this: it strips the
   verdict/`neutral_reason` tags from FIT output and, on NEUTRAL, shows the listing's original copy
   and emits no adapted headline — so the demo reflects production behaviour.

## Scope / limitation

The NEUTRAL verdict produced here governs **only the description pipeline (description + per-listing
headline)**. The broader synchronous adaptation (`/api/adapt` playbook directives for `cta`,
`feature`, and the cold-start headline directive) is decided upstream from the archetype itself and
is **not** affected by this gate. Full "neutral DOM for a mismatched buyer" therefore requires the
upstream archetype decision to also be neutral; this ADR closes the gap only for the LLM-generated
long-form copy, which is where the misleading-spin risk is highest.

## Consequences

**Positive:**

- Listings are no longer spun to fit a buyer the facts contradict — the page stays honest.
- Reuses the existing empty-response path (no new write/skip machinery); zero new latency.
- Fail-safe default: a missing/garbled verdict still yields a normal FIT description.

**Negative / trade-offs:**

- Some (listing, archetype) pairs now receive **no** adapted description/headline (by design). On a
  borderline call the model may choose NEUTRAL and forgo a legitimate adaptation.
- The `<neutral_reason>` is currently **logged only** (not persisted to ClickHouse). We cannot yet
  measure the NEUTRAL rate per (tenant, archetype) from the data warehouse — a follow-up should add
  a `verdict` / `neutral_reason` column to `description_generations` so NEUTRAL frequency is
  observable (it ties naturally into the §T Conversion Label Loop instrumentation).

## Alternatives considered

**Keep v1.8 (always adapt):** Rejected — it is the misleading-spin behaviour this ADR fixes.

**A separate classifier/gate service in front of the description call:** Rejected for now — heavier
(extra model call + service), when the generation model already has all the verified facts in
context and can make the fit decision in the same call at no extra latency.

**Persist the NEUTRAL verdict immediately (ClickHouse column):** Deferred to a follow-up — valuable
for observability but not required for the behavioural change; logged in the interim.
