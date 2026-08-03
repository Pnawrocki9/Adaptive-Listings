/**
 * Runtime slot self-annotation (FOLLOW-340).
 *
 * Reads the resolved `slot_selectors` from the `/api/adapt` response and uses
 * `querySelectorAll` to find matching DOM nodes, then sets `data-estalara-slot`
 * on each match so that `applyDirectives()` can target them on pages that do NOT
 * carry hand-coded slot attributes.
 *
 * Design constraints:
 *   - Idempotent: skips nodes that already carry a `data-estalara-slot` attribute.
 *   - Never throws onto the host page: every DOM access is inside a try-catch.
 *   - Only annotates; never removes or rewrites existing slot attributes.
 *   - Root defaults to `document.documentElement` for full-page coverage.
 *   - FOLLOW-796: translates the DETECTION slot vocabulary to the ADAPTATION slot
 *     vocabulary before writing the attribute (see `SLOT_NAME_TRANSLATION`).
 *
 * @module @estalara/sdk/core/annotate-slots
 */

import { pushEvent } from './adapt.js';

/**
 * Detection-vocabulary slot KEY → adaptation-vocabulary slot NAME (FOLLOW-796).
 *
 * Two vocabularies meet in this module and they are NOT the same set:
 *
 *   - PRODUCER (detection): `TenantSiteSchema.detail_schema.slot_selectors` keys, typed
 *     in `packages/shared/src/tenant-site-schema.ts` as
 *     `headline | tagline | cta_primary | cta_secondary | description | features_list`.
 *     Every auto-detect technique (`packages/sdk/src/auto-detect/techniques/*.ts`) and the
 *     curated server schema emit `cta_primary` for the primary call-to-action. The
 *     control-plane passes these keys through VERBATIM (`lib/tenant-schema.ts` →
 *     `api/adapt/route.ts` → `AdaptationDirectives.slot_selectors`).
 *   - CONSUMER (adaptation): the `slot` values that `applyDirectives()` queries as
 *     `[data-estalara-slot="<slot>"]` (`core/adapt.ts`). Playbook directives
 *     (`core/playbooks/archetypes/*.ts`) use `headline | cta | feature` only; the
 *     per-listing description/headline pipeline (`core/adapt-description.ts`) additionally
 *     queries `description` and `headline`.
 *
 * Writing the producer key verbatim made every `cta` directive miss (`cta_primary ≠ cta`)
 * on genuinely un-instrumented (self-annotated) tenants — only `headline` and `description`
 * landed, because those two keys coincide across both vocabularies by naming accident.
 * This table is the SINGLE choke-point for the rename (per-technique fixes were rejected:
 * 11 techniques + the curated DB schema all feed this one function).
 * See `docs/MASTER_DESIGN.md` §"Most detekcja→adaptacja" — `cta_primary→cta` was the
 * documented mapping from 2026-06-01 that the FOLLOW-340 rewrite dropped.
 *
 * Keys not listed here are annotated VERBATIM (identity), which keeps `headline` and
 * `description` working and leaves any future/unknown key harmlessly namespaced.
 *
 * ── `feature` is deliberately NOT in this table (FOLLOW-796 AC-1/AC-3) ──
 * The playbook `feature` directive is OUT OF SCOPE for self-annotation, by three
 * independent reasons, each verified against `main`:
 *   1. NO PRODUCER. `features_list` is declared in the typed schema but nothing emits it:
 *      no auto-detect technique writes a `features_list` selector, and no curated schema in
 *      the repo carries one. Mapping `features_list → feature` would add a consumer for a
 *      signal that has no production producer (the half-wire shape Rule L exists to stop).
 *   2. ALREADY DOCUMENTED OUT OF SCOPE. `docs/MASTER_DESIGN.md` records
 *      `features_list` / `tagline` as out of scope for v1 — "neither detected nor adapted".
 *   3. DESTRUCTIVE SEMANTICS. `features_list` names a feature-LIST container, while a
 *      `feature` directive is a `TextDirective` that overwrites `el.textContent`. Annotating
 *      a list container as `feature` would collapse the tenant's entire feature list into a
 *      single directive string — a brand-safety regression, not an adaptation.
 * Consequence (current, documented, asserted by `follow-796-slot-name-translation.test.ts`):
 * a `feature` directive emits `adapt.skipped {reason: 'no_slot_elements'}` on a self-annotated
 * tenant. Making it reachable requires a detection-side producer first; that is a separate
 * ticket, not a rename.
 */
const SLOT_NAME_TRANSLATION: Readonly<Record<string, string>> = {
  cta_primary: 'cta',
};

/**
 * Annotate DOM nodes by resolving CSS selectors from `slotSelectors` and
 * setting `data-estalara-slot=<slotName>` on each matched element that does
 * not already carry the attribute.
 *
 * Call this AFTER receiving the `/api/adapt` response and BEFORE calling
 * `applyDirectives()` so that directive-application can find the annotated nodes.
 *
 * Idempotent: safe to call on every `/api/adapt` response — nodes that already
 * carry `data-estalara-slot` are skipped, so repeated calls are a no-op.
 *
 * Fail-safe: any DOM error (invalid selector, missing root, browser restriction)
 * is caught and logged to `console.warn`. The function never throws onto the host
 * page regardless of input.
 *
 * Translating: the incoming keys are DETECTION-vocabulary slot names; the attribute is
 * written using the ADAPTATION-vocabulary name (`cta_primary` → `cta`, FOLLOW-796). See
 * `SLOT_NAME_TRANSLATION` above for the table and for why `feature` is out of scope.
 *
 * @param slotSelectors - Mapping `{ detectionSlotKey → CSS_selector }` from
 *   `AdaptationDirectives.slot_selectors` (FOLLOW-340). May be undefined/null —
 *   the function is a no-op in that case.
 * @param root - The subtree to search. Defaults to `document.documentElement`.
 *   Exposed for unit-testing with jsdom fragments.
 * @returns The count of nodes that were newly annotated (0 on any error or no match).
 */
export function annotateSlots(
  slotSelectors: Record<string, string> | undefined | null,
  root?: Element | Document,
): number {
  if (!slotSelectors || typeof document === 'undefined') return 0;

  const searchRoot: Element | Document =
    root ?? (typeof document !== 'undefined' ? document.documentElement : (null as never));

  let annotated = 0;

  for (const [schemaKey, cssSelector] of Object.entries(slotSelectors)) {
    if (!schemaKey || !cssSelector) continue;

    // FOLLOW-796: detection vocabulary → adaptation vocabulary. Unknown keys pass through.
    // `translated` stays undefined for identity keys — FOLLOW-801 gates only on translated ones.
    const translated = SLOT_NAME_TRANSLATION[schemaKey];
    const slotName = translated ?? schemaKey;

    try {
      const matches = searchRoot.querySelectorAll<HTMLElement>(cssSelector);

      // FOLLOW-801: TRANSLATED slots are annotated on an UNAMBIGUOUS match only.
      //
      // `ADR-0008` §Decision.1 always specified "unique-match only" for this bridge; the
      // FOLLOW-340 rewrite dropped it, and FOLLOW-796's translation turned that omission
      // from harmless into damaging. The producer selectors are broad by construction —
      // `a[href*="contact"]` (wordpress/json-ld), `[class*='cta'], [class*='button']`
      // (css-modules) — so on a real tenant page they match the nav link, the card CTA and
      // the footer link alike. Annotating all of them hands every one to
      // `applyTextDirective`, which overwrites `textContent` on each AND (since FOLLOW-791)
      // arms a MutationObserver per element that re-asserts that overwrite against the host
      // framework indefinitely. A nav "Contact us" becomes archetype copy and stays.
      //
      // Skipping wholesale (rather than annotating the first match) is deliberate: with >1
      // candidate there is no evidence which one is the CTA, and picking by document order
      // would silently overwrite an arbitrary node. Better to adapt nothing and say so.
      //
      // Only translated keys are gated. Identity keys (`headline`, `description`) kept
      // every-match behaviour from before FOLLOW-796, so narrowing them here would be an
      // unrelated behaviour change smuggled into a P1 fix — see FOLLOW-801's scope note and
      // the pin in `follow-801-slot-scope.test.ts`.
      if (translated !== undefined && matches.length > 1) {
        pushEvent({
          type: 'adapt.skipped',
          payload: {
            reason: 'ambiguous_slot_selector',
            slot_or_selector: slotName,
            match_count: matches.length,
          },
          ts: Date.now(),
        });
        continue;
      }

      for (const el of Array.from(matches)) {
        // Idempotent: skip nodes that already carry a data-estalara-slot attribute
        if (el.hasAttribute('data-estalara-slot')) continue;
        el.setAttribute('data-estalara-slot', slotName);
        annotated += 1;
      }
    } catch (err) {
      // Invalid CSS selector, detached root, or browser restriction — log and continue.
      console.warn(
        `[estalara] annotateSlots: failed for slot "${schemaKey}" selector "${cssSelector}":`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return annotated;
}
