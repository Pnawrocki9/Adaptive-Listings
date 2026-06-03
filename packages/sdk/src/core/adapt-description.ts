/**
 * Long-form description adaptation — fetches and applies archetype-adapted listing
 * descriptions from the Decision API, with MutationObserver resilience against
 * framework re-renders (SvelteKit, React, Vue) that reconcile DOM changes away.
 *
 * Endpoint: GET <decisionApiUrl>/adapt/description
 *   ?listing_id=<id>&archetype=<archetype>&locale=<locale>
 *   Authorization: Bearer <apiKey>
 *
 * Response (source: "ai_cached" | "original" | "template_fallback"):
 *   Only applied when source === "ai_cached" AND description is non-empty.
 *   source === "original" → leave DOM completely untouched.
 *
 * Loop-guard strategy (three independent guards):
 *   1. state.applying — set before DOM write, cleared in next microtask.
 *   2. Text-equality check — skip if text already matches desired.
 *   3. state.rafPending — coalesce rapid bursts into one rAF callback.
 *
 * @module @estalara/sdk/core/adapt-description
 */

import type { SdkConfig } from './config.js';
import type { CollectedEvent } from './events.js';
import type { ArchetypeId } from '@estalara/shared';

interface DescriptionResponse {
  description: string | null;
  source: 'ai_cached' | 'original' | 'template_fallback';
  locale: string;
  generated_at: string | null;
}

interface SlotObserverState {
  el: HTMLElement;
  obs: MutationObserver;
  dt: string; // desired textContent = paragraphs.join("")
  ps: string[]; // paragraphs
  f: number; // flags: 1=applying, 2=rafPending
}

let _eventQueue: CollectedEvent[] | null = null;
const _activeObserverStates: SlotObserverState[] = [];

// Event type prefix — helps esbuild deduplicate; also documents the namespace.
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

/** Replace slot children with one <p> per paragraph (XSS-safe via textContent). */
function renderParagraphsIntoSlot(el: HTMLElement, paragraphs: string[]): void {
  el.replaceChildren(
    ...paragraphs.map((t) => {
      const p = document.createElement('p');
      p.textContent = t;
      return p;
    }),
  );
}

/** Get slot's textContent for change detection. */
const slotText = (el: HTMLElement): string => el.textContent || '';

/**
 * Write adapted text into slot (guarded write), then attach a MutationObserver
 * that re-applies if the host framework reverts the element.
 *
 * Returns the state + a doReapply closure for the initial hydration rAF.
 */
/** Returns a doReapply closure for the initial hydration rAF. */
function applyAndObserveSlot(el: HTMLElement, paragraphs: string[]): () => void {
  const xi = _activeObserverStates.findIndex((s) => s.el === el);
  if (xi >= 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- xi is a valid index (findIndex >= 0 above)
    _activeObserverStates[xi]!.obs.disconnect();
    _activeObserverStates.splice(xi, 1);
  }

  const s: SlotObserverState = {
    el,
    obs: null as unknown as MutationObserver,
    dt: paragraphs.join(''),
    ps: paragraphs,
    f: 0,
  };

  const reapply = (): void => {
    if (s.f & 1 || slotText(el) === s.dt) return;
    s.f |= 1;
    renderParagraphsIntoSlot(el, s.ps);
    void Promise.resolve().then(() => {
      s.f &= ~1;
    });
    pushEvent(EVT + 'reapplied', {});
  };

  const obs = new MutationObserver(() => {
    if (s.f || slotText(el) === s.dt) return;
    s.f |= 2;
    requestAnimationFrame(() => {
      s.f &= ~2;
      reapply();
    });
  });

  renderParagraphsIntoSlot(el, paragraphs);
  obs.observe(el, { childList: true, subtree: true });
  s.obs = obs;
  _activeObserverStates.push(s);
  return reapply;
}

/** Disconnect all active description observers. Call on SDK teardown. */
export function teardownDescriptionObservers(): void {
  for (const s of _activeObserverStates) s.obs.disconnect();
  _activeObserverStates.length = 0;
}

async function fetchDescription(
  baseUrl: string,
  apiKey: string,
  language: string,
  listingId: string,
  archetype: string,
): Promise<DescriptionResponse | null> {
  // listing_id, archetype, and language are server-controlled alphanumeric values — safe to embed directly.
  const url = `${baseUrl}/adapt/description?listing_id=${listingId}&archetype=${archetype}&locale=${language}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch {
    // Emit degraded signal — not swallowed silently (guardrail K.2).
    pushEvent(EVT + 'error', { reason: 'net_err' });
    return null;
  }

  if (!res.ok) {
    pushEvent(EVT + 'error', { reason: 'http_err', status: res.status });
    return null;
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    pushEvent(EVT + 'error', { reason: 'bad_resp' });
    return null;
  }

  if (
    typeof data !== 'object' ||
    data === null ||
    typeof (data as Record<string, unknown>).source !== 'string'
  ) {
    pushEvent(EVT + 'error', { reason: 'bad_resp' });
    return null;
  }

  const resp = data as DescriptionResponse;
  if (resp.source !== 'ai_cached' || !resp.description) return null;
  return resp;
}

/**
 * Fetch and apply archetype-adapted long-form description to all
 * [data-estalara-slot="description"] elements on the page.
 *
 * Gated on config.decisionApiUrl and archetype !== 'neutral'.
 * Listing ID from [data-estalara-listing][data-estalara-listing-id] or first
 * [data-estalara-listing-id]. Attaches a MutationObserver per slot for resilience.
 * Never throws.
 */
export async function applyDescriptionAdaptation(
  config: SdkConfig,
  archetype: ArchetypeId | 'neutral',
): Promise<void> {
  if (typeof document === 'undefined' || !config.decisionApiUrl) return;

  if (archetype === 'neutral') {
    pushEvent(EVT + 'skipped', { reason: 'neutral' });
    return;
  }

  const slots = document.querySelectorAll<HTMLElement>('[data-estalara-slot="description"]');
  if (!slots.length) {
    pushEvent(EVT + 'skipped', { reason: 'no_slot' });
    return;
  }

  const listingId =
    document
      .querySelector<HTMLElement>('[data-estalara-listing][data-estalara-listing-id]')
      ?.getAttribute('data-estalara-listing-id') ??
    document
      .querySelector<HTMLElement>('[data-estalara-listing-id]')
      ?.getAttribute('data-estalara-listing-id') ??
    null;

  if (!listingId) return;

  const resp = await fetchDescription(
    config.decisionApiUrl,
    config.apiKey,
    config.language,
    listingId,
    archetype,
  );
  if (!resp) {
    // source=original path — DOM untouched, emit observable skip signal.
    pushEvent(EVT + 'skipped', {});
    return;
  }

  // resp.description is guaranteed non-empty by fetchDescription's guard
  const paragraphs = splitParagraphs(resp.description ?? '');
  if (!paragraphs.length) return;

  for (const slot of slots) {
    const reapply = applyAndObserveSlot(slot, paragraphs);
    requestAnimationFrame(reapply);
  }

  pushEvent(EVT + 'applied', {
    listing_id: listingId,
    archetype,
    paragraph_count: paragraphs.length,
    locale: resp.locale,
  });
}
