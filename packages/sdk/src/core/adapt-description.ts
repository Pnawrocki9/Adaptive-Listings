/**
 * Long-form description adaptation — fetches and applies archetype-adapted listing
 * descriptions from the Decision API, with MutationObserver resilience against
 * framework re-renders (SvelteKit, React, Vue) that reconcile DOM changes away.
 *
 * Endpoint: GET <decisionApiUrl>/adapt/description
 *   ?listing_id=<id>&archetype=<archetype>&locale=<locale>
 *   Authorization: Bearer <apiKey>
 *
 * Response: applied only when source === "ai_cached" AND description is non-empty.
 * Loop-guard: flags byte `f` — bit 1 = applying, bit 2 = rafPending.
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
  obs: MutationObserver;
  dt: string; // desired textContent = paragraphs.join("")
  f: number; // flags: 1=applying, 2=rafPending
}

let _eventQueue: CollectedEvent[] | null = null;
const _slotMap = new Map<HTMLElement, SlotObserverState>();

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

/** Write adapted text into slot, attach MutationObserver for framework-revert resilience. */
function applyAndObserveSlot(el: HTMLElement, paragraphs: string[]): () => void {
  _slotMap.get(el)?.obs.disconnect();

  const s: SlotObserverState = {
    obs: null as unknown as MutationObserver,
    dt: paragraphs.join(''),
    f: 0,
  };

  const reapply = (): void => {
    if (s.f & 1 || el.textContent === s.dt) return;
    s.f |= 1;
    render(el, paragraphs);
    void Promise.resolve().then(() => {
      s.f &= ~1;
    });
    pushEvent(EVT + 're', {});
  };

  const obs = new MutationObserver(() => {
    if (s.f || el.textContent === s.dt) return;
    s.f |= 2;
    requestAnimationFrame(() => {
      s.f &= ~2;
      reapply();
    });
  });

  render(el, paragraphs);
  obs.observe(el, { childList: true });
  s.obs = obs;
  _slotMap.set(el, s);
  return reapply;
}

/** Disconnect all active description observers. Call on SDK teardown. */
export function teardownDescriptionObservers(): void {
  for (const s of _slotMap.values()) s.obs.disconnect();
  _slotMap.clear();
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
  if (!slots.length) return;

  const listingId = document
    .querySelector<HTMLElement>('[data-estalara-listing-id]')
    ?.getAttribute('data-estalara-listing-id');

  if (!listingId) return;

  const resp = await fetchDescription(config, listingId, archetype);
  if (!resp) {
    pushEvent(EVT + 'skipped', {});
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- fetchDescription guards !resp.description
  const paragraphs = splitParagraphs(resp.description!);
  if (!paragraphs.length) return;

  slots.forEach((slot) => requestAnimationFrame(applyAndObserveSlot(slot, paragraphs)));

  pushEvent(EVT + 'applied', { listing_id: listingId, archetype });
}
