/**
 * Lightweight behavioral observer — Tier 1 (Observer) mode.
 *
 * Sets up:
 *   - Scroll depth tracking (25/50/75/100% milestones)
 *   - IntersectionObserver for listing card impressions
 *   - Click tracking on CTA buttons
 *   - Click tracking on inquiry submit button (inquiry.started)
 *
 * Returns a cleanup function to remove all listeners.
 *
 * @module @estalara/sdk/core/observer
 */

import type { SdkConfig } from './config.js';
import type { CollectedEvent } from './events.js';
import { collectScrollDepth } from './events.js';

const SCROLL_MILESTONES = [25, 50, 75, 100] as const;

export interface ObserverOptions {
  /**
   * CSS selector for the inquiry form submit button (e.g.
   * `[data-estalara-slot='inquiry-submit']`).  When provided, a click on the
   * matched element emits an `inquiry.started` event.  Sourced from the
   * tenant's detected site schema (`inquiry_submit_selector`).
   */
  inquirySubmitSelector?: string;
}

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

  const firedMilestones = new Set<number>();

  function onScroll(): void {
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
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  cleanupFns.push(() => {
    window.removeEventListener('scroll', onScroll);
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
                  listing_id: (entry.target as HTMLElement).dataset.listingId ?? '',
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

      // Observe elements marked as listing cards
      document.querySelectorAll('[data-estalara-listing]').forEach((el) => {
        io.observe(el);
      });

      cleanupFns.push(() => {
        io.disconnect();
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
    function onInquirySubmitClick(e: MouseEvent): void {
      try {
        const target = e.target as HTMLElement | null;
        const submitBtn = target?.closest(inquirySubmitSelector) as HTMLElement | null;
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
