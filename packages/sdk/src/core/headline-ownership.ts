/**
 * Shared ownership registry for `[data-estalara-slot="headline"]` elements.
 *
 * FOLLOW-795 / RETRO-244 §4a LG-5(a): two independent modules can each want to attach a
 * MutationObserver-backed resilience watchdog to the SAME headline element:
 *
 *   - `adapt.ts`'s generic directive pipeline (playbook headline text — always available
 *     from cold start, emitted by 17 of 18 playbooks).
 *   - `adapt-description.ts`'s per-listing LLM headline pipeline (ADR-0009 — only
 *     available once `fetchDescription` resolves a non-empty per-listing headline).
 *
 * Two independent observers on the same element must NEVER coexist — each would treat
 * the other's write as a "revert" of its own desired text and re-assert forever. Before
 * this ticket, `adapt.ts` avoided that fight by unconditionally never arming resilience
 * for `headline` — but `adapt-description.ts`'s ownership is CONDITIONAL, so the majority
 * case (cold start / generation failure / uncached listing / neutral archetype / opt-out)
 * left the slot with NO observer at all, and the playbook headline permanently
 * unrecoverable on any framework revert.
 *
 * This module is the single source of truth for "who currently owns element X's headline
 * slot", so the generic pipeline can arm resilience whenever `adapt-description.ts` has
 * NOT (yet) taken ownership, and `adapt-description.ts` can hand off cleanly — evicting
 * the generic watchdog FIRST — the instant a per-listing headline arrives.
 *
 * @module @estalara/sdk/core/headline-ownership
 */

/**
 * Deliberately module-local (not exported): only the three accessors below cross the
 * module boundary, so exporting the alias would be a Rule I "zero non-test importers"
 * violation. Declaration emit inlines it into the accessors' public signatures.
 */
type HeadlineOwner = 'generic' | 'description';

const _owner = new WeakMap<HTMLElement, HeadlineOwner>();

/** Returns the module that currently owns `el`'s headline resilience, or undefined if neither. */
export function getHeadlineOwner(el: HTMLElement): HeadlineOwner | undefined {
  return _owner.get(el);
}

/** Record `el` as owned by `owner`. Called by whichever module just armed its observer. */
export function setHeadlineOwner(el: HTMLElement, owner: HeadlineOwner): void {
  _owner.set(el, owner);
}

/** Clear ownership bookkeeping for `el` — called on teardown by either module. */
export function clearHeadlineOwner(el: HTMLElement): void {
  _owner.delete(el);
}
