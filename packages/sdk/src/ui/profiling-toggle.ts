/**
 * Per-user profiling opt-out toggle — FOLLOW-372 / Master Design §H.9.
 *
 * Renders a persistent, keyboard-operable, ARIA-labelled toggle inside the
 * Shadow DOM. Placement, label texts (i18n) and the "Powered by Estalara"
 * attribution are per-brand configurable (FOLLOW-641 / FOLLOW-651 / ADR-0019);
 * an unconfigured tenant renders at bottom-left, byte-identical to pre-FOLLOW-641.
 * Visible to logged-in users on app.estalara.com when AL adaptation is active.
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

import type {
  LabelI18n,
  OptOutWidgetConfig,
  QuizLanguage,
  WidgetPlacement,
} from '@estalara/shared';
import { DEFAULT_OPTOUT_PLACEMENT } from '@estalara/shared';

import { placementToCss } from './placement.js';

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
  /**
   * Per-brand placement (FOLLOW-641 / ADR-0019 D2). Corner + px offsets. Omit to keep
   * `DEFAULT_OPTOUT_PLACEMENT` (`bottom-left`, 16/16 — byte-identical to pre-FOLLOW-641).
   */
  placement?: WidgetPlacement;
  /**
   * Per-brand i18n label overrides (FOLLOW-641 / ADR-0019 D2). Each bag is resolved for the
   * active `language` with an `'en'` fallback; an absent bag (or missing language) falls back
   * to the hardcoded per-locale COPY (byte-identical to pre-FOLLOW-641).
   *   - `on`   → the active-state word (default e.g. "active").
   *   - `off`  → the disabled-state word (default e.g. "disabled").
   *   - `aria` → the full aria-label override (default `"<title>: <on|off>"`).
   *
   * Typed as the shared slice's `labels` shape so the SDK consumer and the wire schema cannot
   * drift (Rule L). `LabelI18n` is retained as a named import for the `resolveBag` helper below.
   */
  labels?: NonNullable<OptOutWidgetConfig['labels']>;
  /**
   * Whether to render the discreet "Powered by Estalara" attribution (FOLLOW-651). Defaults
   * to `true`; the caller passes `false` when `brand.white_label === true`. This is the first
   * real consumer of the brand `white_label` flag (RETRO-214 HALF_WIRE_P).
   */
  showAttribution?: boolean;
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

  // FOLLOW-641: resolve per-brand label overrides for the active language with an `'en'`
  // fallback, then the hardcoded per-locale COPY. Absent overrides → byte-identical to today.
  const resolveBag = (bag: LabelI18n | undefined, fallback: string): string =>
    bag?.[options.language] ?? bag?.en ?? fallback;
  const onWord = resolveBag(options.labels?.on, copy.on);
  const offWord = resolveBag(options.labels?.off, copy.off);
  const ariaOverride = options.labels?.aria
    ? resolveBag(options.labels.aria, '')
    : '';

  /** State text shown in the toggle: `"<title>: <on|off word>"`. */
  function stateText(out: boolean): string {
    return `${copy.title}: ${out ? offWord : onWord}`;
  }

  /** Compound ARIA label: the per-brand override if set, else `"<title>: <state>"`. */
  function ariaLabel(out: boolean): string {
    return ariaOverride !== '' ? ariaOverride : stateText(out);
  }

  // FOLLOW-641 / ADR-0019 D2: position from the tenant placement, else the default
  // bottom-left 16/16 (byte-identical to the pre-FOLLOW-641 hardcoded position).
  const placementCss = placementToCss(options.placement ?? DEFAULT_OPTOUT_PLACEMENT);

  // Container — fixed corner, inline styles via setAttribute to avoid a <style> block
  // (setAttribute('style', ...) is the type-safe alternative to cssText assignment).
  // `flex-wrap:wrap` lets the FOLLOW-651 attribution drop to its own line below the row.
  const container = document.createElement('div');
  container.setAttribute('data-estalara-profiling-toggle', '');
  container.setAttribute(
    'style',
    `position:fixed;${placementCss};background:#1a1a2e;color:#fff;` +
      'border-radius:10px;padding:8px 12px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;' +
      'font-family:system-ui,sans-serif;font-size:12px;z-index:9998;pointer-events:auto;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.3)',
  );

  // Label text
  const labelEl = document.createElement('span');
  labelEl.setAttribute('data-estalara-toggle-status', '');
  labelEl.textContent = stateText(optedOut);
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
    labelEl.textContent = stateText(optedOut);
    checkbox.setAttribute('aria-label', ariaLabel(optedOut));
    checkbox.setAttribute('aria-checked', String(!optedOut));
    options.onChange(optedOut);
  });

  container.appendChild(labelEl);
  container.appendChild(checkbox);

  // FOLLOW-651: discreet "Powered by Estalara" attribution, rendered BY DEFAULT. Suppressed
  // only when the caller passes `showAttribution: false` (i.e. `brand.white_label === true`).
  // `flex-basis:100%` drops it to its own line below the label+checkbox row.
  if (options.showAttribution !== false) {
    const attribution = document.createElement('span');
    attribution.setAttribute('data-estalara-attribution', '');
    attribution.textContent = 'Powered by Estalara';
    attribution.setAttribute(
      'style',
      'flex-basis:100%;font-size:9px;color:#8a89a3;letter-spacing:.02em;white-space:nowrap',
    );
    container.appendChild(attribution);
  }

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
