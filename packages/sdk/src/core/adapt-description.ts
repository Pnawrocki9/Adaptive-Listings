/**
 * Long-form description + per-listing headline adaptation (ADR-0009).
 *
 * Fetches and applies archetype-adapted listing descriptions AND headlines from the
 * Decision API, with MutationObserver resilience against framework re-renders
 * (SvelteKit, React, Vue) that reconcile DOM changes away.
 *
 * Endpoint: GET <decisionApiUrl>/adapt/description
 *   ?listing_id=<id>&archetype=<archetype>&locale=<locale>
 *   Authorization: Bearer <apiKey>
 *
 * Description response: applied only when source === "ai_cached" AND description is non-empty.
 * Headline response: applied to [data-estalara-slot="headline"] elements when headline is
 *   a non-empty string. On null/absent, leaves headline slots untouched (playbook headline
 *   directive from /api/adapt stays in effect as the cold-start fallback).
 *
 * Loop-guard (description slots): disconnect → write → reconnect pattern.
 *   The observer is disconnected before our write and immediately reconnected after, so
 *   our own DOM mutations are invisible to the observer. External mutations (framework
 *   reconciliation) are caught and re-asserted via a debounced rAF. A rafPending flag
 *   (bit 1) ensures at most one rAF is scheduled per revert burst, preventing a flicker
 *   storm when the framework issues rapid successive mutations.
 *
 * Loop-guard (headline slots): unchanged flag-based approach (single textContent write,
 *   lower mutation frequency, works reliably for static-text slots).
 *
 * @module @estalara/sdk/core/adapt-description
 */

import type { SdkConfig } from './config.js';
import type { CollectedEvent } from './events.js';
import type { ArchetypeId } from '@estalara/shared';

interface DescriptionResponse {
  description: string | null;
  /** Per-listing LLM-generated headline (ADR-0009). Null on cold-start / generation failure. */
  headline?: string | null;
  source: 'ai_cached' | 'original' | 'template_fallback';
  locale: string;
  generated_at: string | null;
}

/** State for description slots — disconnect/reconnect loop-guard, no flag needed. */
interface DescSlotState {
  obs: MutationObserver;
  /** Normalised fingerprint: paragraphs.join('\x00') — includes separators to survive
   *  Svelte text-node reconstruction that may concatenate paragraph text differently. */
  fp: string;
  /** rafPending — bit 1. Prevents multiple rAFs queuing for the same revert burst. */
  f: number;
}

/** State for headline slots — flag-based loop-guard (textContent write is atomic). */
interface HeadlineSlotState {
  obs: MutationObserver;
  dt: string; // desired textContent
  f: number; // flags: 1=applying, 2=rafPending
}

let _eventQueue: CollectedEvent[] | null = null;
/** Observer state for [data-estalara-slot="description"] elements. */
const _slotMap = new Map<HTMLElement, DescSlotState>();
/** Observer state for [data-estalara-slot="headline"] elements (ADR-0009). */
const _headlineSlotMap = new Map<HTMLElement, HeadlineSlotState>();

const EVT = 'adapt.description.';

export function setDescriptionEventQueueRef(queue: CollectedEvent[]): void {
  _eventQueue = queue;
}

function pushEvent(type: string, payload: Record<string, unknown>): void {
  _eventQueue?.push({ type, payload, ts: Date.now() });
}

/** Split text on '\n', trim, drop blank lines. */
export function splitParagraphs(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Write paragraphs into el as XSS-safe &lt;p&gt; elements. */
function render(el: HTMLElement, ps: string[]): void {
  el.textContent = '';
  ps.forEach((t) => {
    const p = document.createElement('p');
    p.textContent = t;
    el.append(p);
  });
}

/**
 * Compute a normalised text fingerprint for a description slot.
 *
 * Collects text from all direct-child <p> elements (the SDK's rendered structure).
 * If no <p> children exist (e.g. Svelte has reverted to raw text nodes), falls back
 * to the element's full textContent. The NUL separator ensures that two paragraphs
 * with different text cannot accidentally hash the same as a single concatenated string.
 */
function descFingerprint(el: HTMLElement): string {
  const ps = Array.from(el.querySelectorAll(':scope > p'));
  if (ps.length > 0) {
    // textContent on Element is string | null per lib.dom.d.ts; HTMLElement inherits Element.
    // Use empty-string fallback to keep the return type as string.
    return ps.map((p) => p.textContent || '').join('\x00');
  }
  return el.textContent || '';
}

/**
 * Write adapted paragraphs into slot and attach a MutationObserver that re-asserts
 * the adapted content on any external mutation (framework reconciliation).
 *
 * Loop-guard: disconnect → write → reconnect (synchronous).
 *   Our own writes are performed while the observer is disconnected, so they never
 *   trigger a re-apply loop. The observer is reconnected immediately after, so the
 *   next Svelte re-render is caught and re-asserted.
 *
 * Convergence: The rafPending flag (bit 1 of `s.f`) ensures at most one rAF is
 *   queued per revert burst. The fingerprint check in the rAF callback short-circuits
 *   if the content already matches (e.g. two rapid Svelte frames where the second
 *   one loses its race to the rAF).
 */
function applyAndObserveSlot(el: HTMLElement, paragraphs: string[]): () => void {
  _slotMap.get(el)?.obs.disconnect();

  const desiredFp = paragraphs.join('\x00');

  const s: DescSlotState = {
    obs: null as unknown as MutationObserver,
    fp: desiredFp,
    f: 0,
  };

  /**
   * Re-apply adapted paragraphs using disconnect → write → reconnect so that our
   * own DOM mutations are invisible to the observer (no infinite loop).
   */
  const reapply = (): void => {
    if (descFingerprint(el) === s.fp) return;
    s.obs.disconnect();
    render(el, paragraphs);
    s.obs.observe(el, { childList: true, subtree: true });
    pushEvent(EVT + 're', {});
  };

  const obs = new MutationObserver(() => {
    // Short-circuit: already showing adapted content (our reconnect fired this).
    if (descFingerprint(el) === s.fp) return;
    // Deduplicate: only one rAF per revert burst.
    if (s.f & 1) return;
    s.f |= 1;
    requestAnimationFrame(() => {
      s.f &= ~1;
      reapply();
    });
  });

  // Initial write: observer not yet active, no loop risk.
  render(el, paragraphs);
  obs.observe(el, { childList: true, subtree: true });
  s.obs = obs;
  _slotMap.set(el, s);
  return reapply;
}

/**
 * Write a single-line headline into el as XSS-safe textContent (no paragraph wrapping).
 * Used for [data-estalara-slot="headline"] elements.
 */
function renderHeadline(el: HTMLElement, text: string): void {
  el.textContent = text;
}

/** Write headline into slot, attach MutationObserver for framework-revert resilience. */
function applyAndObserveHeadlineSlot(el: HTMLElement, text: string): () => void {
  _headlineSlotMap.get(el)?.obs.disconnect();

  const s: HeadlineSlotState = {
    obs: null as unknown as MutationObserver,
    dt: text,
    f: 0,
  };

  const reapply = (): void => {
    if (s.f & 1 || el.textContent === s.dt) return;
    s.f |= 1;
    renderHeadline(el, text);
    void Promise.resolve().then(() => {
      s.f &= ~1;
    });
    pushEvent(EVT + 'headline.re', {});
  };

  const obs = new MutationObserver(() => {
    if (s.f || el.textContent === s.dt) return;
    s.f |= 2;
    requestAnimationFrame(() => {
      s.f &= ~2;
      reapply();
    });
  });

  renderHeadline(el, text);
  obs.observe(el, { childList: true, characterData: true, subtree: true });
  s.obs = obs;
  _headlineSlotMap.set(el, s);
  return reapply;
}

/** Disconnect all active description observers. Call on SDK teardown. */
export function teardownDescriptionObservers(): void {
  for (const s of _slotMap.values()) s.obs.disconnect();
  _slotMap.clear();
  for (const s of _headlineSlotMap.values()) s.obs.disconnect();
  _headlineSlotMap.clear();
}

async function fetchDescription(
  config: SdkConfig,
  listingId: string,
  archetype: string,
): Promise<DescriptionResponse | null> {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- caller guards !config.decisionApiUrl
  const url = `${config.decisionApiUrl!}/adapt/description?listing_id=${listingId}&archetype=${archetype}&locale=${config.language}`;
  const errEvt = EVT + 'error';
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${config.apiKey}` } });
  } catch {
    pushEvent(errEvt, { reason: 'ne' }); // guardrail K.2
    return null;
  }

  if (!res.ok) {
    pushEvent(errEvt, { reason: 'http_err', status: res.status });
    return null;
  }

  let resp: DescriptionResponse | null = null;
  try {
    const data = (await res.json()) as Record<string, unknown>;
    if (data.source) resp = data as unknown as DescriptionResponse;
  } catch {
    // fall through
  }
  if (!resp) {
    pushEvent(errEvt, { reason: 'br' });
    return null;
  }
  if (resp.source !== 'ai_cached' || !resp.description) return null;
  return resp;
}

/**
 * Fetch and apply archetype-adapted long-form description to all
 * [data-estalara-slot="description"] elements on the page.
 *
 * Gated on config.decisionApiUrl and archetype !== 'neutral'.
 * Listing ID from first [data-estalara-listing-id] on the page.
 * Attaches a MutationObserver per slot for resilience. Never throws.
 *
 * @param isStale FOLLOW-546 / RETRO-169: latest-wins staleness predicate propagated from the
 *   caller's in-flight guard (index.ts `latestRefreshId`). Consulted BEFORE any DOM slot
 *   mutation — both at entry and, critically, immediately after `fetchDescription` resolves —
 *   so a rapid cross-listing navigation that supersedes this fire-and-forget call while its
 *   own fetch is in flight cannot paint the stale archetype's copy onto the newer listing.
 *   Defaults to a never-stale predicate so callers with no in-flight-guard concept (e.g. the
 *   ~30 unit-test call sites) behave exactly as before.
 */
export async function applyDescriptionAdaptation(
  config: SdkConfig,
  archetype: ArchetypeId | 'neutral',
  isStale: () => boolean = () => false,
): Promise<void> {
  if (typeof document === 'undefined' || !config.decisionApiUrl) return;

  if (archetype === 'neutral') {
    pushEvent(EVT + 'skipped', { reason: 'neutral' });
    return;
  }

  // FOLLOW-546: defense-in-depth. There is no meaningful interleave window before the first
  // await in the synchronously-dispatched fire-and-forget call site (index.ts:805), but a
  // future caller that awaits before dispatch could make an entry-time supersession real.
  if (isStale()) {
    pushEvent(EVT + 'skipped', { reason: 'stale' });
    return;
  }

  const slots = document.querySelectorAll<HTMLElement>('[data-estalara-slot="description"]');
  if (!slots.length) return;

  const listingId = document
    .querySelector<HTMLElement>('[data-estalara-listing-id]')
    ?.getAttribute('data-estalara-listing-id');

  if (!listingId) return;

  const resp = await fetchDescription(config, listingId, archetype);

  // FOLLOW-546 / RETRO-169 LG-1: THE interleave window. The caller's `latestRefreshId` guard
  // (index.ts:737) already passed synchronously BEFORE this call was dispatched at :805, so it
  // cannot catch a navigation that supersedes us while `fetchDescription` above is in flight.
  // Re-check here — before mutating any description/headline slot — so a superseded rapid-nav
  // refresh can never paint this stale archetype's copy onto the newer listing's DOM.
  if (isStale()) {
    pushEvent(EVT + 'skipped', { reason: 'stale' });
    return;
  }

  if (!resp) {
    pushEvent(EVT + 'skipped', {});
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- fetchDescription guards !resp.description
  const paragraphs = splitParagraphs(resp.description!);
  if (!paragraphs.length) return;

  slots.forEach((slot) => requestAnimationFrame(applyAndObserveSlot(slot, paragraphs)));

  // ADR-0009: apply per-listing headline when present and non-empty.
  // Supersedes the playbook headline directive (applied earlier by /api/adapt).
  // When headline is null/absent, leave all headline slots untouched — the playbook
  // directive stays as the cold-start fallback.
  const headlineText = typeof resp.headline === 'string' ? resp.headline.trim() : '';
  if (headlineText) {
    const headlineSlots = document.querySelectorAll<HTMLElement>('[data-estalara-slot="headline"]');
    headlineSlots.forEach((slot) =>
      requestAnimationFrame(applyAndObserveHeadlineSlot(slot, headlineText)),
    );
    pushEvent(EVT + 'headline.applied', { listing_id: listingId, archetype });
  }

  pushEvent(EVT + 'applied', { listing_id: listingId, archetype });
}
