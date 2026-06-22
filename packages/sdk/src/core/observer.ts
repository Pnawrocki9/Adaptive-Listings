/**
 * Lightweight behavioral observer — Tier 1 (Observer) mode.
 *
 * Sets up:
 *   - Scroll depth tracking (25/50/75/100% milestones)
 *   - IntersectionObserver for listing card impressions
 *   - Click tracking on CTA buttons
 *   - Click tracking on inquiry submit button (inquiry.started)
 *   - IntersectionObserver-based photo dwell tracking (photo.dwell) — FOLLOW-099
 *   - Click tracking on feature-expand elements (feature.expanded) — FOLLOW-099
 *   - Input/click tracking on mortgage calculator widget (mortgage_calc.used) — FOLLOW-099
 *   - Form submit/change tracking on search-filter slots (filter.applied) — FOLLOW-099
 *
 * Returns a cleanup function to remove all listeners.
 *
 * @module @estalara/sdk/core/observer
 */

import type { SdkConfig } from './config.js';
import type { CollectedEvent } from './events.js';
import { collectScrollDepth } from './events.js';
import { FILTER_APPLIED_FACETS } from '@estalara/shared';
import type { FilterAppliedFacet } from '@estalara/shared';

const SCROLL_MILESTONES = [25, 50, 75, 100] as const;

/** Minimum continuous visibility (ms) before photo.dwell fires. FOLLOW-099. */
const PHOTO_DWELL_THRESHOLD_MS = 2000;

export interface ObserverOptions {
  /**
   * CSS selector for the inquiry form submit button (e.g.
   * `[data-estalara-slot='inquiry-submit']`).  When provided, a click on the
   * matched element emits an `inquiry.started` event.  Sourced from the
   * tenant's detected site schema (`inquiry_submit_selector`).
   */
  inquirySubmitSelector?: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Map an arbitrary form field name to a FilterAppliedFacet enum value.
 * Returns undefined when the name cannot be mapped to a known facet.
 * Used by setupFilterAppliedObserver to normalise raw form field names.
 */
function resolveFilterFacet(fieldName: string): FilterAppliedFacet | undefined {
  const lower = fieldName.toLowerCase();
  // Direct membership check — cast is safe because FILTER_APPLIED_FACETS is the authoritative list.
  if ((FILTER_APPLIED_FACETS as readonly string[]).includes(lower)) {
    return lower as FilterAppliedFacet;
  }
  // Prefix-based heuristics for common form field naming conventions.
  if (lower.includes('price') || lower.includes('budget')) return 'price_range';
  if (lower.includes('bedroom') || lower.includes('bed')) return 'bedrooms';
  if (lower.includes('bathroom') || lower.includes('bath')) return 'bathrooms';
  if (lower.includes('property_type') || lower.includes('prop_type')) return 'property_type';
  if (lower.includes('location') || lower.includes('area') || lower.includes('neighbourhood'))
    return 'location';
  if (lower.includes('amenity') || lower.includes('amenities') || lower.includes('pool'))
    return 'amenities';
  if (lower.includes('yield') || lower.includes('investment')) return 'investment_yield';
  if (lower.includes('commercial')) return 'commercial';
  return undefined;
}

/**
 * Infer the mortgage calculator input type from an element's name / id / data attributes.
 * Returns 'unknown' when inference fails.
 */
function resolveMortgageInputType(
  el: HTMLElement,
): 'loan_amount' | 'interest_rate' | 'term' | 'down_payment' | 'unknown' {
  // `name` is optional on HTMLElement (only present on form elements); `id` is always string.
  // Prefer the typed cast to access .name; fall back to id then data-field attribute.
  // HTMLInputElement.name and HTMLElement.id are always strings (never undefined).
  // Prefer name → id → data-field attribute (last may be undefined).
  const inputName = (el as HTMLInputElement).name;
  const name = (inputName || el.id || (el.dataset.field ?? '')).toLowerCase();
  if (name.includes('loan') || name.includes('amount') || name.includes('principal'))
    return 'loan_amount';
  if (name.includes('interest') || name.includes('rate')) return 'interest_rate';
  if (name.includes('term') || name.includes('year') || name.includes('duration')) return 'term';
  if (name.includes('down') || name.includes('deposit')) return 'down_payment';
  return 'unknown';
}

// ─── Individual observer factories (exported for unit testing — Rule H satisfied
//     by their inclusion in setupObservers below) ─────────────────────────────

/**
 * Photo dwell observer (FOLLOW-099).
 *
 * Uses IntersectionObserver to track when a photo image enters the viewport.
 * A per-element timeout fires `photo.dwell` after PHOTO_DWELL_THRESHOLD_MS of
 * continuous visibility.  The timer is cancelled when the element leaves the
 * viewport before the threshold elapses.
 *
 * Payload uses PhotDwellPayloadSchema shape: `{ photo_id, dwell_ms }`.
 *
 * Selectors observed:
 *   - `[data-estalara-slot="photos"] img` — images inside photo container slots
 *   - `img[data-photo-id]`                — directly-marked photo images
 *
 * @returns Cleanup function that disconnects the observer and cancels pending timers.
 */
export function setupPhotoDwellObserver(
  _config: SdkConfig,
  onEvent: (event: CollectedEvent) => void,
): () => void {
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
    return function noCleanup() {
      // Non-browser or no IntersectionObserver support
    };
  }

  const dwellTimers = new Map<Element, ReturnType<typeof setTimeout>>();

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLImageElement;
        if (entry.isIntersecting) {
          const timerId = setTimeout(() => {
            const photoId =
              el.dataset.photoId ??
              el.getAttribute('data-photo-id') ??
              el.src.split('/').pop()?.split('?')[0] ??
              '';
            onEvent({
              type: 'photo.dwell',
              payload: {
                photo_id: photoId,
                dwell_ms: PHOTO_DWELL_THRESHOLD_MS,
              },
              ts: Date.now(),
            });
            dwellTimers.delete(el);
          }, PHOTO_DWELL_THRESHOLD_MS);
          dwellTimers.set(el, timerId);
        } else {
          // Element left viewport before threshold — cancel timer
          const timerId = dwellTimers.get(el);
          if (timerId !== undefined) {
            clearTimeout(timerId);
            dwellTimers.delete(el);
          }
        }
      }
    },
    { threshold: 0.5 },
  );

  document.querySelectorAll('[data-estalara-slot="photos"] img').forEach((img) => {
    io.observe(img);
  });
  document.querySelectorAll('img[data-photo-id]').forEach((img) => {
    io.observe(img);
  });

  return () => {
    for (const timerId of dwellTimers.values()) {
      clearTimeout(timerId);
    }
    dwellTimers.clear();
    io.disconnect();
  };
}

/**
 * Feature-expanded observer (FOLLOW-099).
 *
 * Listens for click events on elements carrying a `data-feature` attribute
 * (e.g. amenity rows, energy certificates, feature disclosure triggers).
 * Fires `feature.expanded` with `{ feature, label? }` using the canonical
 * FeatureExpandedPayloadSchema field names (`feature` = the data-feature value,
 * `label` = trimmed text content capped at 100 chars).
 *
 * @returns Cleanup function that removes the document click listener.
 */
export function setupFeatureExpandedObserver(
  _config: SdkConfig,
  onEvent: (event: CollectedEvent) => void,
): () => void {
  if (typeof document === 'undefined') {
    return function noCleanup() {
      // Non-browser environment
    };
  }

  function onFeatureClick(e: MouseEvent): void {
    try {
      const target = e.target as HTMLElement | null;
      const featureEl = target?.closest('[data-feature]') as HTMLElement | null;
      if (!featureEl) return;

      const featureId = featureEl.dataset.feature ?? '';
      if (!featureId) return;

      // featureEl.textContent is string (may be empty) — trim and cap at 100 chars.
      // Omit label from payload when the trimmed text is empty.
      const trimmedText = featureEl.textContent.trim().slice(0, 100);
      const labelText = trimmedText.length > 0 ? trimmedText : undefined;

      onEvent({
        type: 'feature.expanded',
        payload: {
          feature: featureId,
          ...(labelText ? { label: labelText } : {}),
        },
        ts: Date.now(),
      });
    } catch {
      // Swallow — never propagate
    }
  }

  document.addEventListener('click', onFeatureClick);

  return () => {
    document.removeEventListener('click', onFeatureClick);
  };
}

/**
 * Mortgage calculator observer (FOLLOW-099).
 *
 * Listens for `input` and `click` events bubbling up from inside
 * `[data-estalara-slot="mortgage"]` containers.  Fires `mortgage_calc.used`
 * with a payload shaped to match MortgageCalcUsedPayloadSchema:
 *   `{ down_payment_pct?, term_years?, monthly_payment?, interest_rate_pct? }`
 *
 * The payload field populated depends on the inferred input type.
 * When `input_type` is `loan_amount` or `unknown` the payload is intentionally
 * empty — the event still signals that the user interacted with the calculator.
 *
 * @returns Cleanup function that removes the document input and click listeners.
 */
export function setupMortgageCalcObserver(
  _config: SdkConfig,
  onEvent: (event: CollectedEvent) => void,
): () => void {
  if (typeof document === 'undefined') {
    return function noCleanup() {
      // Non-browser environment
    };
  }

  function buildMortgagePayload(
    inputType: 'loan_amount' | 'interest_rate' | 'term' | 'down_payment' | 'unknown',
    el: HTMLElement,
  ): Record<string, unknown> {
    const rawValue = (el as HTMLInputElement).value;
    const numValue = rawValue ? parseFloat(rawValue) : undefined;
    if (inputType === 'down_payment' && numValue !== undefined && !isNaN(numValue)) {
      return { down_payment_pct: numValue };
    }
    if (inputType === 'term' && numValue !== undefined && !isNaN(numValue)) {
      return { term_years: numValue };
    }
    if (inputType === 'interest_rate' && numValue !== undefined && !isNaN(numValue)) {
      return { interest_rate_pct: numValue };
    }
    // loan_amount and unknown: emit event with no numeric payload — interaction signal only
    return {};
  }

  function onMortgageInteraction(e: Event): void {
    try {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest('[data-estalara-slot="mortgage"]')) return;

      const inputType = resolveMortgageInputType(target);
      const payload = buildMortgagePayload(inputType, target);

      onEvent({
        type: 'mortgage_calc.used',
        payload,
        ts: Date.now(),
      });
    } catch {
      // Swallow — never propagate
    }
  }

  document.addEventListener('input', onMortgageInteraction);
  document.addEventListener('click', onMortgageInteraction);

  return () => {
    document.removeEventListener('input', onMortgageInteraction);
    document.removeEventListener('click', onMortgageInteraction);
  };
}

/**
 * Filter-applied observer (FOLLOW-099).
 *
 * Listens for `change` events on inputs/selects and `submit` events on forms
 * inside `[data-estalara-slot="search-filters"]` or `[data-estalara-slot="filters"]`
 * containers.
 *
 * Fires `filter.applied` with `{ facet, value? }` (FilterAppliedPayloadSchema).
 * Field names are normalised to the FilterAppliedFacet enum via resolveFilterFacet().
 * Fields whose names cannot be mapped to a known facet are silently dropped —
 * the enum is authoritative and unknown facets must not reach the intent engine.
 *
 * On form submit: one event is emitted per non-empty, recognisable field.
 * On change: one event per changed field.
 *
 * @returns Cleanup function that removes the document change and submit listeners.
 */
export function setupFilterAppliedObserver(
  _config: SdkConfig,
  onEvent: (event: CollectedEvent) => void,
): () => void {
  if (typeof document === 'undefined') {
    return function noCleanup() {
      // Non-browser environment
    };
  }

  const FILTER_SLOT_SELECTOR =
    '[data-estalara-slot="search-filters"], [data-estalara-slot="filters"]';

  function onFilterChange(e: Event): void {
    try {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest(FILTER_SLOT_SELECTOR)) return;

      // HTMLInputElement.name and .value are always strings (never undefined).
      // Prefer name → id → data-facet attribute as field identifier.
      const inputEl = target as HTMLInputElement;
      const fieldName = inputEl.name || target.id || (target.dataset.facet ?? '');
      const facet = resolveFilterFacet(fieldName);
      if (!facet) return;

      // `value` is always a string on form elements.
      const rawValue = inputEl.value;
      const payload: Record<string, unknown> = { facet };
      if (rawValue !== '') payload.value = rawValue;

      onEvent({ type: 'filter.applied', payload, ts: Date.now() });
    } catch {
      // Swallow — never propagate
    }
  }

  function onFilterSubmit(e: Event): void {
    try {
      const form = e.target as HTMLFormElement | null;
      if (!form) return;
      // The form itself may carry the slot, or it may be a child of a slotted container.
      const inSlot =
        form.closest(FILTER_SLOT_SELECTOR) !== null || form.matches(FILTER_SLOT_SELECTOR);
      if (!inSlot) return;

      // HTMLFormControlsCollection is array-like but iterable via for-of.
      for (const formEl of Array.from(form.elements)) {
        const el = formEl as HTMLInputElement | HTMLSelectElement;
        // `name` and `id` are always strings on form elements (may be empty).
        const fieldName = el.name || el.id;
        const facet = resolveFilterFacet(fieldName);
        if (!facet) continue;
        // `value` is always a string on form elements (may be empty).
        const rawValue = el.value;
        if (!rawValue) continue;
        onEvent({
          type: 'filter.applied',
          payload: { facet, value: rawValue },
          ts: Date.now(),
        });
      }
    } catch {
      // Swallow — never propagate
    }
  }

  document.addEventListener('change', onFilterChange);
  document.addEventListener('submit', onFilterSubmit);

  return () => {
    document.removeEventListener('change', onFilterChange);
    document.removeEventListener('submit', onFilterSubmit);
  };
}

// ─── Main composite observer ──────────────────────────────────────────────────

export function setupObservers(
  config: SdkConfig,
  onEvent: (event: CollectedEvent) => void,
  options: ObserverOptions = {},
): () => void {
  const cleanupFns: (() => void)[] = [];

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    // Non-browser environment — return no-op cleanup
    return function noCleanup() {
      // Nothing to clean up in non-browser environments
    };
  }

  // ─── Scroll depth tracking ──────────────────────────────────────────────────
  // RAF throttle: coalesce all scroll events that fire within a single animation
  // frame into one DOM read. Without this, onScroll runs on every scroll tick
  // (~60 fps), causing unnecessary layout thrashing. FOLLOW-262.

  const firedMilestones = new Set<number>();
  let scrollRafId: number | null = null;

  function onScroll(): void {
    if (scrollRafId !== null) return;
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      try {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const docHeight =
          document.documentElement.scrollHeight - document.documentElement.clientHeight;
        if (docHeight <= 0) return;

        const depthPercent = Math.round((scrollTop / docHeight) * 100);

        for (const milestone of SCROLL_MILESTONES) {
          if (depthPercent >= milestone && !firedMilestones.has(milestone)) {
            firedMilestones.add(milestone);
            onEvent(collectScrollDepth(milestone));
          }
        }
      } catch {
        // Never throw — observer errors are silenced
      }
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  cleanupFns.push(() => {
    window.removeEventListener('scroll', onScroll);
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
  });

  // ─── Listing card impression tracking ──────────────────────────────────────

  try {
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              onEvent({
                type: 'listing.viewed',
                payload: {
                  listing_id:
                    (entry.target as HTMLElement).getAttribute('data-estalara-listing-id') ?? '',
                  element: entry.target.tagName.toLowerCase(),
                },
                ts: Date.now(),
              });
              io.unobserve(entry.target);
            }
          }
        },
        { threshold: 0.5 },
      );

      // Emit listing.viewed directly for a listing root element. Used by the client-side
      // navigation observer below, where the IntersectionObserver threshold can never be met:
      // a listing DETAIL root is taller than the viewport, so `threshold: 0.5` (50% visible)
      // is never satisfied and the IO callback would never fire. On navigation the root has
      // unambiguously appeared / changed, so we signal "viewed" directly instead of waiting
      // for an impression crossing that will not happen.
      const emitListingViewed = (el: HTMLElement): void => {
        onEvent({
          type: 'listing.viewed',
          payload: {
            listing_id: el.getAttribute('data-estalara-listing-id') ?? '',
            element: el.tagName.toLowerCase(),
          },
          ts: Date.now(),
        });
      };

      // Observe elements marked as listing cards
      document.querySelectorAll('[data-estalara-listing]').forEach((el) => {
        io.observe(el);
      });

      // Watch for listing elements added or mutated by SvelteKit/React client-side navigation.
      // querySelectorAll above only captures elements present at SDK init time.
      //
      // Two cases:
      //   childList  — framework unmounts+remounts the page component (new DOM node), e.g. when
      //                navigating listing → browse → listing. Emit listing.viewed directly (the
      //                IntersectionObserver never fires for a viewport-taller-than-50% detail root).
      //   attributes — framework reuses the same node but updates data-estalara-listing-id
      //                in-place (SvelteKit same-component navigation between listing slugs).
      const navMutObs = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
              if (!(node instanceof HTMLElement)) continue;
              if (node.hasAttribute('data-estalara-listing')) {
                emitListingViewed(node);
              }
              node.querySelectorAll<HTMLElement>('[data-estalara-listing]').forEach((el) => {
                emitListingViewed(el);
              });
            }
          } else if (
            mutation.type === 'attributes' &&
            mutation.attributeName === 'data-estalara-listing-id'
          ) {
            // SvelteKit updated listing_id on the existing element — fire listing.viewed directly
            // because IntersectionObserver already unobserved this node on the first view.
            const el = mutation.target as HTMLElement;
            if (el.hasAttribute('data-estalara-listing')) {
              emitListingViewed(el);
            }
          }
        }
      });
      navMutObs.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-estalara-listing-id'],
      });

      cleanupFns.push(() => {
        io.disconnect();
        navMutObs.disconnect();
      });
    }
  } catch {
    // IntersectionObserver not available — continue without it
  }

  // ─── CTA click tracking ────────────────────────────────────────────────────

  function onCtaClick(e: MouseEvent): void {
    try {
      const target = e.target as HTMLElement | null;
      const cta = target?.closest('[data-estalara-cta]') as HTMLElement | null;
      if (!cta) return;

      onEvent({
        type: 'cta.clicked',
        payload: {
          cta_id: cta.dataset.estalaraCta ?? '',
          href: (cta as HTMLAnchorElement).href || '',
          text: (cta.textContent || '').trim().slice(0, 100),
        },
        ts: Date.now(),
      });
    } catch {
      // Swallow — never propagate
    }
  }

  document.addEventListener('click', onCtaClick);
  cleanupFns.push(() => {
    document.removeEventListener('click', onCtaClick);
  });

  // ─── Inquiry submit click tracking ────────────────────────────────────────
  //
  // Emits `inquiry.started` when the user clicks the inquiry form submit
  // button identified by `options.inquirySubmitSelector`.  Only wired when
  // the selector is present (detail pages on app.estalara.com) and the
  // tenant has not opted out of tracking.
  //
  // Gate: skipped when consent_state is 'opted_out'.

  const inquirySubmitSelector = options.inquirySubmitSelector;
  if (inquirySubmitSelector && config.consentState !== 'opted_out') {
    // Capture as a const string for TypeScript narrowing inside the nested function.
    const resolvedSelector: string = inquirySubmitSelector;
    function onInquirySubmitClick(e: MouseEvent): void {
      try {
        const target = e.target as HTMLElement | null;
        const submitBtn = target?.closest(resolvedSelector) as HTMLElement | null;
        if (!submitBtn) return;

        onEvent({
          type: 'inquiry.started',
          payload: { form_variant: 'contact_v2' },
          ts: Date.now(),
        });
      } catch {
        // Swallow — never propagate
      }
    }

    document.addEventListener('click', onInquirySubmitClick);
    cleanupFns.push(() => {
      document.removeEventListener('click', onInquirySubmitClick);
    });
  }

  // ─── Photo dwell tracking (FOLLOW-099) ─────────────────────────────────────
  // Rule H: non-test caller — this line inside setupObservers() is the production call site.
  cleanupFns.push(setupPhotoDwellObserver(config, onEvent));

  // ─── Feature expanded tracking (FOLLOW-099) ────────────────────────────────
  // Rule H: non-test caller — this line inside setupObservers() is the production call site.
  cleanupFns.push(setupFeatureExpandedObserver(config, onEvent));

  // ─── Mortgage calculator tracking (FOLLOW-099) ─────────────────────────────
  // Rule H: non-test caller — this line inside setupObservers() is the production call site.
  cleanupFns.push(setupMortgageCalcObserver(config, onEvent));

  // ─── Filter applied tracking (FOLLOW-099) ──────────────────────────────────
  // Rule H: non-test caller — this line inside setupObservers() is the production call site.
  cleanupFns.push(setupFilterAppliedObserver(config, onEvent));

  if (config.debug) {
    console.log('[Estalara] Observers active');
  }

  return () => {
    for (const cleanup of cleanupFns) {
      try {
        cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }
  };
}
