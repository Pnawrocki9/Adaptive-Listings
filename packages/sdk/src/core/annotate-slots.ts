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
 *
 * @module @estalara/sdk/core/annotate-slots
 */

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
 * @param slotSelectors - Mapping `{ slotName → CSS_selector }` from
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

  for (const [slotName, cssSelector] of Object.entries(slotSelectors)) {
    if (!slotName || !cssSelector) continue;

    try {
      const matches = searchRoot.querySelectorAll<HTMLElement>(cssSelector);
      for (const el of Array.from(matches)) {
        // Idempotent: skip nodes that already carry a data-estalara-slot attribute
        if (el.hasAttribute('data-estalara-slot')) continue;
        el.setAttribute('data-estalara-slot', slotName);
        annotated += 1;
      }
    } catch (err) {
      // Invalid CSS selector, detached root, or browser restriction — log and continue.
      console.warn(
        `[estalara] annotateSlots: failed for slot "${slotName}" selector "${cssSelector}":`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return annotated;
}
