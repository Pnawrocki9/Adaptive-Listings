# ADR-0008: Detection→Adaptation runtime bridge, no-code tenant integration, and AI-Vision quality strategy

## Status

PROPOSED — 2026-06-01 (CEO-directed; awaiting architect/Council sign-off). Extends ADR-0004 /
ADR-0006 / ADR-0007 (canonical `/api/adapt`). Relates to FOLLOW-159 (implementation) and FOLLOW-160
(Plan B).

## Context

The Auto-Detect pipeline (`packages/sdk/src/auto-detect`, 10 deterministic techniques + AI Vision
fallback) produces `TenantSiteSchema.detail_schema.slot_selectors` — CSS selectors for the headline
/ CTA / description on a tenant's **existing** DOM. The runtime adaptation engine, however, only
mutates elements carrying `data-estalara-slot` attributes (`TextDirective` → `[data-estalara-slot]`;
`ClassDirective` rejects non-`[data-estalara-*]` selectors). Nothing applied the detected
`slot_selectors` at runtime, so detail-page adaptation never fired on any tenant that did not
hand-place `data-estalara-*` markup. (Index-page reorder already bridged this gap via
`IndexSchema.container_selector`; detail-page text/CTA/description did not.) This is the same
producer↔consumer "half-wire" pattern previously closed for `inquiry_submit_selector` (FOLLOW-127).

Two CEO directives frame the solution:

1. **`app.estalara.com` is the live production product and must remain no-code.** Its source is
   never edited beyond the standard SDK loader snippet. Adaptation must be driven entirely by
   detection.
2. **Adaptation must include the long-form `description`**, not only headline/CTA.

Verification findings (this session, all reproduced against the real `app.estalara.com` listing):

- Client-side deterministic detection returns `confidence 0 / null schema` for `app.estalara.com`
  (bespoke SvelteKit + Tailwind — no JSON-LD / data-testid / MUI / WordPress patterns to match).
- The AI Vision technique sends **HTML text only** (first 50 KB) to `claude-sonnet-4-6`, despite the
  §B.5.1 design specifying **screenshot + HTML**. Run against `app.estalara.com` it returned
  `detection_confidence 0.3` (below the 0.5 accept threshold → `null`) and **speculative, generic
  class selectors** (`.property-title`, `.contact-agent`, `.listing-description`) that do not match
  Tailwind utility markup. End-to-end probe: `headline` resolved (via the `h1` fallback) to the
  **price** element (`385,000 USD` — wrong), `cta` and `description` did not resolve at all.

Conclusion: **HTML-text AI Vision is insufficient for bespoke, non-semantic (Tailwind) sites.** The
detected-selector → DOM-modification machinery is sound; the gap is (a) a runtime bridge and (b)
detection quality for bespoke sites.

## Decision

**1. Runtime augment applicator (the bridge) — IMPLEMENTED (FOLLOW-159).**

> **Status note (FOLLOW-801, 2026-08-03).** The module named below was replaced by
> `packages/sdk/src/core/annotate-slots.ts` in FOLLOW-340, and that rewrite **silently dropped the
> "unique-match only" clause this ADR specifies**. The omission was harmless until FOLLOW-796
> restored the `cta_primary → cta` translation, at which point broad producer selectors
> (`a[href*="contact"]`) began overwriting — and MutationObserver-enforcing — every contact link on
> a tenant page. FOLLOW-801 restores the clause for **translated** slots; identity keys (`headline`,
> `description`) still annotate every match, which this ADR did not anticipate and which remains
> open. The decision text below stands as written; only the module name is stale. Broader
> reconciliation of this file is owned by FOLLOW-804 — do not duplicate it here.

`packages/sdk/src/core/augment.ts` `annotateDetectedSlots(schema)` resolves each
`detail_schema.slot_selectors` entry (primary → ordered fallbacks; unique-match only; never
overrides existing markup; never throws) and self-annotates the matched element with
`data-estalara-slot`. Slot mapping: `headline → "headline"`, `cta_primary → "cta"`,
`description → "description"`. After annotation the existing engine adapts the elements with **no
tenant markup**:

- **headline / cta** → `/adapt` playbook `TextDirective`s via `applyDirectives`.
- **description** → the dedicated `GET /api/adapt/description` pipeline (Master Design E.7),
  consumed by `packages/sdk/src/core/description.ts` and written as `textContent` (XSS-safe) into
  the annotated element. (Producer↔consumer parity: every detail slot the detector emits is also
  modified.)

**2. Schema delivery to the SDK — `/adapt` response carries `slot_selectors` (B1) — PLANNED.**
Because client-side detection yields nothing for bespoke sites, the SDK receives the **activated
server schema's** `detail_schema.slot_selectors` as an **additive, optional** field on the
`/api/adapt` response (canonical per ADR-0004/0006/0007). The SDK feeds it to
`annotateDetectedSlots` inside `refreshDirectives` before applying directives. This avoids an extra
round-trip (the SDK already calls `/adapt`) and is backward-compatible (absent field → current
behaviour). Requires extending `getTenantSchema` (today returns a reorder-only
`TenantSiteSchemaMin`) to include `detail_schema.slot_selectors`.

**3. Plan A — curated activated schema for bespoke tenants (incl. the pilot) — PLANNED
(FOLLOW-159).** For tenants where automated detection cannot produce accurate selectors (verified
for `app.estalara.com`), the activated `tenant_site_schemas` row is **hand-authored / curated**:
real, human-verified CSS selectors targeting the tenant's actual DOM. This is still no-code from the
tenant's perspective — the selectors live in Estalara's DB, not the tenant's source. The
applicator + description consumer (item 1) then work unchanged.

**4. Plan B — true screenshot-based AI Vision for self-serve — DEFERRED (FOLLOW-160).** Realign the
AI Vision technique to the §B.5.1 design (screenshot + HTML → Claude Vision) so automated detection
produces accurate detail selectors for bespoke sites without hand-authoring. This is the path to
scalable self-serve onboarding; the pilot does not block on it.

## Update 2026-06-01 — A1 (minimal stable hooks) adopted for the first-party pilot

After verifying that `app.estalara.com` has **zero stable selector hooks** (no `id`/`data-*`; only
Tailwind utility + Svelte-hashed scoped classes; the only `<h1>` is the price, not a title), the CEO
chose **A1: add minimal canonical hooks** to the listing template rather than rely on a fragile
curated structural schema. This is the standard Tier-2 "declarative slots" integration and is
appropriate because app.estalara.com is Estalara's own first-party site.

- **Implemented** in the Estalara-app repo
  (`web-master/src/routes/(buyer)/[lang]/listing/[slug]/+page.svelte`), flag-gated by
  `PUBLIC_ESTALARA_SDK_ENABLED` (prod byte-identical when off). Hooks added:
  `data-estalara-listing(+ -id)` on the listing root, `data-estalara-slot="description"` on the
  existing description block, and a minimal `data-estalara-slot="headline"` element (no title
  element exists). CTA deferred (trivially addable). Production handoff:
  `web-master/HANDOFF_ESTALARA_ADAPTIVE.md`.
- **Consequence for this ADR's items 2 & 3:** with `data-estalara-slot` hooks present, the SDK
  detects them as Tier-3 native (confidence 1.0) and adapts via the **direct** path — headline via
  `/adapt` playbook directives, description via the `/api/adapt/description` consumer (FOLLOW-159).
  So the **curated server schema (Plan A) and the `/adapt` `slot_selectors` field (B1) are NOT
  needed for app.estalara.com**. They remain scoped to **third-party tenants where we cannot add
  hooks**, alongside Plan B (FOLLOW-160). The runtime applicator (`augment.ts`) stays valuable for
  those hookless third-party sites.

## Consequences

- **Positive:** detail-page adaptation (headline/CTA/description) works no-code; the pilot is
  unblocked via a curated schema; the apply layer is source-agnostic (serves both curated and
  AI-detected schemas); the `/adapt` change is additive (no breaking contract change).
- **Negative / risks:** curated selectors for Tailwind sites are **fragile** (utility classes /
  structure can change) — mitigated by `detail_schema.slot_selectors` fallbacks, the daily
  Continuous Schema Validation cron (§B.6) flagging drift, and the applicator's unique-match guard
  (skips rather than mis-targets). Until Plan B lands, every bespoke tenant needs a curated schema —
  this does not scale to self-serve and MUST be tracked as such.
- **Contract:** `/api/adapt` gains an optional `slot_selectors` field — documented in
  `docs/INTERFACES.md` and the SDK `adaptResponseSchema` when B1 is implemented.

## Alternatives considered

- **Edit `app.estalara.com` to add `data-estalara-*` markup (original FIX-014).** Rejected by CEO:
  app.estalara.com is the live product and must stay no-code; superseded by FOLLOW-159.
- **Description via a `/adapt` playbook directive** (uniform with headline/cta). Rejected: a
  dedicated tiered/LLM/cached description pipeline already exists (E.7); a second path would
  duplicate it.
- **Dedicated `GET /api/schema/slots` endpoint** instead of the `/adapt` additive field. Rejected
  for the pilot: adds a round-trip; the SDK already calls `/adapt`. May revisit for decoupling.
- **Ship HTML-text AI Vision as-is for the pilot.** Rejected: verified to produce wrong/unresolved
  selectors for app.estalara.com.
