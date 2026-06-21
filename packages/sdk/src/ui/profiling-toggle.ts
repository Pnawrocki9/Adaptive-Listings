/**
 * Per-user profiling opt-out toggle — FOLLOW-372 / Master Design §H.9.
 *
 * Renders a persistent, keyboard-operable, ARIA-labelled toggle inside the
 * Shadow DOM at bottom-left of the viewport. Visible to logged-in users on
 * app.estalara.com when AL adaptation is active.
 *
 * States:
 *   ON  — personalizacja / profilowanie aktywne (adaptation running)
 *   OFF — adaptation disabled (AL profiling + DOM mutation suspended)
 *
 * Scope boundary (AL-DOM only):
 * This toggle controls ONLY Adaptive-Listings DOM adaptation.
 * app.estalara.com buying-intent identification, lead ranking, and agent-facing
 * chat summaries are NOT affected (those are covered by mandatory registration
 * consent per §H.8 and are outside this toggle's scope).
 *
 * Implemented with vanilla DOM (no Preact). Uses inline styles to avoid a
 * separate style element — keeps bundle delta minimal (budget: <40KB gzip).
 *
 * DO NOT edit consent-banner.ts copy/disclosures here — that is the
 * compliance-engineer lane (FOLLOW-373).
 *
 * @module @estalara/sdk/ui/profiling-toggle
 */

import type { QuizLanguage } from '@estalara/shared';

export interface ProfilingToggleOptions {
  /**
   * UI language for toggle labels.
   * Uses `QuizLanguage` from `@estalara/shared` — canonical `['en','pl','es']` union.
   * Never repeat the literal set in SDK files.
   */
  language: QuizLanguage;
  /** Accent color for active-state indicator (hex, rgb, or CSS color). */
  accentColor: string;
  /** Initial opt-out state: true = opted out (adaptation OFF). */
  initialOptedOut: boolean;
  /** Called whenever the user flips the toggle. Receives new opted-out state. */
  onChange: (optedOut: boolean) => void;
}

/**
 * Per-locale copy. 3 fields per locale to minimise bundle bytes.
 * ARIA label is computed: `title + ': ' + on|off`.
 */
const COPY = {
  en: { title: 'Personalization', on: 'active', off: 'disabled' },
  pl: { title: 'Personalizacja', on: 'aktywna', off: 'wyłączona' },
  es: { title: 'Personalización', on: 'activa', off: 'desactivada' },
} as const;

export interface ProfilingToggleController {
  /** Remove the toggle from the Shadow DOM. */
  destroy: () => void;
  /** Current opt-out state (true = opted out / adaptation OFF). */
  isOptedOut: () => boolean;
}

/**
 * Render the profiling opt-out toggle inside the provided Shadow Root.
 *
 * The toggle is positioned bottom-left and is always accessible via keyboard
 * (Tab + Space/Enter). Uses a native <input type="checkbox"> for browser-native
 * focus and activation handling. Uses inline styles (not a <style> block) to
 * minimise bundle size impact.
 *
 * The toggle does NOT control app.estalara.com buying-intent / lead-ranking /
 * agent chat-summary processing (those are covered by mandatory registration
 * consent per §H.8).
 *
 * @param shadowRoot - The Shadow DOM root to inject the toggle into.
 * @param options    - Toggle configuration including callbacks and branding.
 * @returns          A controller with `destroy()` and `isOptedOut()`.
 */
export function renderProfilingToggle(
  shadowRoot: ShadowRoot,
  options: ProfilingToggleOptions,
): ProfilingToggleController {
  const copy = COPY[options.language];
  let optedOut = options.initialOptedOut;

  /** Compound ARIA label from title + state. */
  function ariaLabel(out: boolean): string {
    return `${copy.title}: ${out ? copy.off : copy.on}`;
  }

  // Container — fixed bottom-left, inline styles via setAttribute to avoid a <style> block
  // (setAttribute('style', ...) is the type-safe alternative to cssText assignment)
  const container = document.createElement('div');
  container.setAttribute('data-estalara-profiling-toggle', '');
  container.setAttribute(
    'style',
    'position:fixed;bottom:16px;left:16px;background:#1a1a2e;color:#fff;' +
      'border-radius:10px;padding:8px 12px;display:flex;align-items:center;gap:8px;' +
      'font-family:system-ui,sans-serif;font-size:12px;z-index:9998;pointer-events:auto;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.3)',
  );

  // Label text
  const labelEl = document.createElement('span');
  labelEl.setAttribute('data-estalara-toggle-status', '');
  labelEl.textContent = `${copy.title}: ${optedOut ? copy.off : copy.on}`;
  labelEl.setAttribute('style', 'font-size:11px;color:#c0bfcd;white-space:nowrap');

  // Native checkbox — keyboard-operable (Tab, Space, Enter) by default
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = !optedOut;
  checkbox.setAttribute('aria-label', ariaLabel(optedOut));
  checkbox.setAttribute('aria-checked', String(!optedOut));
  checkbox.setAttribute('role', 'switch');
  checkbox.setAttribute('data-estalara-toggle-checkbox', '');
  checkbox.setAttribute(
    'style',
    `width:32px;height:16px;cursor:pointer;accent-color:${options.accentColor}`,
  );

  checkbox.addEventListener('change', () => {
    optedOut = !checkbox.checked;
    labelEl.textContent = `${copy.title}: ${optedOut ? copy.off : copy.on}`;
    checkbox.setAttribute('aria-label', ariaLabel(optedOut));
    checkbox.setAttribute('aria-checked', String(!optedOut));
    options.onChange(optedOut);
  });

  container.appendChild(labelEl);
  container.appendChild(checkbox);
  shadowRoot.appendChild(container);

  return {
    destroy() {
      try {
        container.remove();
      } catch {
        // ignore
      }
    },
    isOptedOut: () => optedOut,
  };
}
