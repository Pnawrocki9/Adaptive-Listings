/**
 * Per-(listing, archetype) cache of the copy the SDK actually applied (FOLLOW-1027).
 *
 * THE PROBLEM. The loader is injected `async` from the host page's `onMount`, so the SDK
 * cannot start until after hydration and first paint. The buyer therefore sees the tenant's
 * original copy, and then watches it change. Measured on the local stack against an
 * already-generated listing: original visible at 125 ms, adapted applied at 903 ms — **778 ms
 * of original copy**, with no LLM work in that window at all. Warming the server cache does
 * not touch that number; it is SDK boot plus one round trip.
 *
 * WHAT THIS FIXES. A buyer who returns to a listing they have already seen this session — or
 * navigates back to it — has no reason to wait for the network at all. The applied slot values
 * are stored here and re-applied the moment the SDK boots, before any fetch. Combined with the
 * host-side cloak (which un-cloaks on `estalara:adapt:settled`) the swap happens behind the
 * mask and the buyer never sees the original.
 *
 * SCOPE, deliberately narrow:
 *   - sessionStorage, so it dies with the tab and inherits the same consent lifecycle as every
 *     other AL profiling artefact (§H.9 erase clears it with the rest).
 *   - text slots only. Reorder and class directives depend on live DOM that may have changed.
 *   - keyed by BOTH listing and archetype, because the same listing reads differently to a
 *     yield_hunter and a family_buyer, and a stale cross-archetype hit would be a visible bug.
 *
 * @module @estalara/sdk/core/copy-cache
 */

import type { TextDirective } from '@estalara/shared';

/** Schema marker — bump to invalidate every cached entry after a shape change. */
const COPY_CACHE_VERSION = 1;

/** Cap the number of cached listings per session; oldest evicted first. */
const MAX_ENTRIES = 12;

const KEY_PREFIX = 'estalara_copy_';

interface CopyCacheEntry {
  v: number;
  /** slot → applied value. */
  s: Record<string, string>;
  savedAt: number;
}

function cacheKey(listingId: string, archetype: string): string {
  return `${KEY_PREFIX}${listingId}__${archetype}`;
}

/**
 * Remember the text values applied for this (listing, archetype) pair.
 *
 * Empty values are NOT stored: an empty directive means "this archetype does not fit this
 * listing" (ADR-0010's fit gate), and caching it would turn a deliberate no-op into a
 * persisted instruction to blank the slot on the next visit.
 *
 * @param listingId - The listing the copy belongs to.
 * @param archetype - The archetype the copy was generated for.
 * @param directives - Directives that were just applied.
 */
export function cacheAppliedCopy(
  listingId: string,
  archetype: string,
  directives: readonly { type: string; slot?: string; value?: string }[],
): void {
  const slots: Record<string, string> = {};
  for (const d of directives) {
    if (d.type !== 'text' || !d.slot) continue;
    const value = d.value ?? '';
    if (value.trim() === '') continue;
    slots[d.slot] = value;
  }
  if (Object.keys(slots).length === 0) return;

  try {
    const entry: CopyCacheEntry = { v: COPY_CACHE_VERSION, s: slots, savedAt: Date.now() };
    sessionStorage.setItem(cacheKey(listingId, archetype), JSON.stringify(entry));
    evictOldest();
  } catch {
    // sessionStorage unavailable or full — the cache is an optimisation, never a requirement
  }
}

/**
 * Apply previously-cached copy for this (listing, archetype) pair, synchronously.
 *
 * Called before the first `/adapt` request. The network result still arrives later and
 * overwrites this — the cache only removes the window in which the ORIGINAL copy is on screen.
 *
 * @param listingId - The listing being viewed.
 * @param archetype - The session's current archetype.
 * @returns The cached slot values that were applied, or null when there was no usable entry.
 */
export function readCachedCopy(
  listingId: string,
  archetype: string,
): Record<string, string> | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(listingId, archetype));
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<CopyCacheEntry>;
    if (entry.v !== COPY_CACHE_VERSION || !entry.s || typeof entry.s !== 'object') return null;
    const slots: Record<string, string> = {};
    for (const [slot, value] of Object.entries(entry.s)) {
      if (typeof value === 'string' && value.trim() !== '') slots[slot] = value;
    }
    return Object.keys(slots).length > 0 ? slots : null;
  } catch {
    return null;
  }
}

/** Turn cached slot values back into directives the normal apply path understands. */
export function cachedCopyToDirectives(
  slots: Record<string, string>,
  archetype: string,
): TextDirective[] {
  return Object.entries(slots).map(([slot, value]) => ({
    type: 'text' as const,
    slot,
    value,
    archetype: archetype as TextDirective['archetype'],
    // Cached copy carries no fresh confidence; it was already deemed applicable when stored.
    confidence: 1,
  }));
}

/** Drop the oldest entries once the cap is exceeded — bounded storage, no unbounded growth. */
function evictOldest(): void {
  try {
    const entries: { key: string; savedAt: number }[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith(KEY_PREFIX)) continue;
      let savedAt = 0;
      try {
        savedAt =
          (JSON.parse(sessionStorage.getItem(key) ?? '{}') as Partial<CopyCacheEntry>).savedAt ?? 0;
      } catch {
        /* unparseable entry sorts oldest and is evicted first */
      }
      entries.push({ key, savedAt });
    }
    if (entries.length <= MAX_ENTRIES) return;
    entries.sort((a, b) => a.savedAt - b.savedAt);
    for (const e of entries.slice(0, entries.length - MAX_ENTRIES)) {
      sessionStorage.removeItem(e.key);
    }
  } catch {
    // best-effort
  }
}

/** Remove every cached entry — used by the §H.9 / consent-withdrawal erase path. */
export function clearCachedCopy(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(KEY_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) sessionStorage.removeItem(key);
  } catch {
    // best-effort
  }
}
