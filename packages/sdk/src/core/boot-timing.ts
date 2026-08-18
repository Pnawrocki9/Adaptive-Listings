/**
 * Boot-path timing marks (FOLLOW-1033).
 *
 * FOLLOW-1027 established that the buyer-visible flicker window is ~95% **SDK boot** and only
 * tens of milliseconds of network — and it established that by instrumenting the SDK by hand and
 * then throwing the instrumentation away. That is why the follow-up question ("so which part of
 * boot?") could not be answered without redoing the work, and why an applied-copy cache was built
 * against a premise about proportions that measurement later killed.
 *
 * This module makes the decomposition permanent and cheap. It records `performance.mark()`s at the
 * boot milestones and reports the deltas on the `estalara:adapt:settled` event that the host's
 * anti-flicker cloak already listens for — so a measurement harness needs no debug build, no
 * console scraping, and no code edit.
 *
 * The one number that matters most is `preInit`: navigation → first line of SDK code. Nothing
 * inside this package can shrink it, because the loader is injected `async` from the host's
 * root-layout `onMount` and therefore cannot start until after hydration and first paint. If
 * `preInit` dominates, the fix belongs on the HOST, not here — and that is worth knowing before
 * anyone optimises code that is not on the critical path.
 *
 * @module @estalara/sdk/core/boot-timing
 */

/** Namespace for every mark, so host pages can filter ours out of their own. */
const PREFIX = 'estalara:';

/** Boot milestones, in the order they occur. Local: Rule I is wired-or-dead, and no caller
 * outside this module names the type — `mark('init-start')` passes a literal. */
type BootMark =
  | 'init-start'
  | 'config-fetch-start'
  | 'config-fetch-end'
  | 'adapt-start'
  | 'settled';

/**
 * Record a boot milestone.
 *
 * Never throws: `performance` is absent in some embedded webviews, and a missing timing mark must
 * never be the reason a buyer's page fails to adapt.
 *
 * @param name - The milestone to stamp.
 */
export function mark(name: BootMark): void {
  try {
    performance.mark(PREFIX + name);
  } catch {
    // performance unavailable — timings are best-effort, the product is not
  }
}

/** Milliseconds since navigation start for each recorded milestone, plus derived spans. */
type BootTimings = Record<string, number>;

/**
 * Build the timing report: absolute offsets from navigation start, plus the spans that answer
 * "where did boot go".
 *
 * `preInit` is deliberately first. It is navigation → the SDK's own first line, i.e. host
 * hydration + loader injection + bundle fetch + parse, and it is the term this package cannot
 * influence.
 *
 * @returns Millisecond offsets/spans, rounded; `{}` when the Performance API is unavailable.
 */
export function bootTimings(): BootTimings {
  try {
    const at = (name: BootMark): number | undefined =>
      performance.getEntriesByName(PREFIX + name, 'mark')[0]?.startTime;

    const initStart = at('init-start');
    if (initStart === undefined) return {};

    const out: BootTimings = { preInit: Math.round(initStart) };

    const span = (label: string, from?: number, to?: number): void => {
      if (from !== undefined && to !== undefined) out[label] = Math.round(to - from);
    };

    const cfgStart = at('config-fetch-start');
    const cfgEnd = at('config-fetch-end');
    const adaptStart = at('adapt-start');
    const settled = at('settled');

    span('initToConfig', initStart, cfgStart);
    span('configFetch', cfgStart, cfgEnd);
    span('configToAdapt', cfgEnd ?? initStart, adaptStart);
    span('adapt', adaptStart, settled);
    span('total', 0, settled);

    return out;
  } catch {
    return {};
  }
}
