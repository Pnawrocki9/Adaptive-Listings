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
  ConsentTextLocale,
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
 * Per-locale copy, one short string per field to minimise bundle bytes.
 * ARIA label is computed: `title + ': ' + on|off`.
 *
 * `withdraw` is the withdrawal control (FOLLOW-1316, R24), a separate act from the toggle, whose
 * words imply no deletion (R38). It promises nothing about "all data", since the consent log and
 * earlier quiz rows outlive it (design review §4, R35), and tells no buyer they were recognised (R42).
 * `data` is the one access-and-export control (ESC-092 D) [FOLLOW-1445]; `dataFail` replaces its
 * label when the download fails, and the button stays for a retry.
 */
const COPY = {
  en: {
    title: 'Personalization',
    on: 'active',
    off: 'disabled',
    withdraw: 'Withdraw consent',
    reopen: 'Turn on personalization',
    data: 'Download my data',
    dataFail: 'Download failed, try again',
  },
  pl: {
    title: 'Personalizacja',
    on: 'aktywna',
    off: 'wyłączona',
    withdraw: 'Wycofaj zgodę',
    reopen: 'Włącz personalizację',
    data: 'Pobierz moje dane',
    dataFail: 'Nie udało się pobrać, spróbuj ponownie',
  },
  es: {
    title: 'Personalización',
    on: 'activa',
    off: 'desactivada',
    withdraw: 'Retirar el consentimiento',
    reopen: 'Activar la personalización',
    data: 'Descargar mis datos',
    dataFail: 'No se pudo descargar, inténtalo de nuevo',
  },
} as const;

/**
 * The way back from `denied` (ESC-092 B-d, FOLLOW-1446): a small persistent chip, a real `<button>`
 * in the Shadow DOM, where the toggle sits by default. It reads and sends nothing; its click is the
 * caller's (show the first-visit banner again). Not a dialog: the page stays usable around it.
 *
 * @param shadowRoot - The Shadow DOM root to render into.
 * @param language   - UI language of the label.
 * @param onClick    - Called on a click.
 */
export function renderReopenChip(
  shadowRoot: ShadowRoot,
  language: QuizLanguage,
  onClick: () => void,
): void {
  const chip = document.createElement('button');
  chip.setAttribute('data-estalara-reopen', '');
  chip.textContent = COPY[language].reopen;
  chip.setAttribute(
    'style',
    `position:fixed;${placementToCss(DEFAULT_OPTOUT_PLACEMENT)};background:#1a1a2e;color:#fff;` +
      'border:0;border-radius:10px;padding:6px 10px;font:12px system-ui,sans-serif;' +
      'z-index:9998;pointer-events:auto;cursor:pointer;text-decoration:underline',
  );
  chip.addEventListener('click', onClick);
  shadowRoot.appendChild(chip);
}

export interface ProfilingToggleController {
  /** Remove the toggle from the Shadow DOM. */
  destroy: () => void;
  /** Current opt-out state (true = opted out / adaptation OFF). */
  isOptedOut: () => boolean;
  /**
   * Show the withdrawal control, once; one click runs `onWithdraw` (FOLLOW-1316, R24). `text` is the
   * served consent text; it adds the explanation and the result sentences when it arrives, and the
   * control never waits for it (FOLLOW-1444).
   */
  showWithdraw: (
    onWithdraw: () => Promise<boolean>,
    text: Promise<ConsentTextLocale | undefined>,
  ) => void;
  /**
   * Show the "Download my data" control after the withdrawal control; each click runs `onData`, and
   * a false result changes the label to the failure text (FOLLOW-1445).
   */
  showData: (onData: () => Promise<boolean>) => void;
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
  const ariaOverride = options.labels?.aria ? resolveBag(options.labels.aria, '') : '';

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
  let attribution: HTMLElement | null = null;
  if (options.showAttribution !== false) {
    attribution = document.createElement('span');
    attribution.setAttribute('data-estalara-attribution', '');
    attribution.textContent = 'Powered by Estalara';
    attribution.setAttribute(
      'style',
      'flex-basis:100%;font-size:9px;color:#8a89a3;letter-spacing:.02em;white-space:nowrap',
    );
    container.appendChild(attribution);
  }

  shadowRoot.appendChild(container);

  /** A full-width, underlined text `<button>` above the attribution (FOLLOW-1444, FOLLOW-1445). */
  function linkButton(attr: string, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.setAttribute(attr, '');
    button.textContent = label;
    button.setAttribute(
      'style',
      'flex-basis:100%;padding:0;border:0;background:none;color:#fff;font:inherit;' +
        'text-align:left;text-decoration:underline;cursor:pointer',
    );
    container.insertBefore(button, attribution);
    return button;
  }

  return {
    showWithdraw(onWithdraw, text) {
      if (container.querySelector('[data-estalara-withdraw]')) return;
      let words: ConsentTextLocale | undefined;
      const button = linkButton('data-estalara-withdraw', copy.withdraw);
      // FOLLOW-1444: the controls go at once, so nothing writes after the denial; the container
      // becomes a status region showing the in-bundle state text, then the served result sentence.
      button.addEventListener('click', () => {
        container.setAttribute('role', 'status');
        container.textContent = stateText(true);
        void onWithdraw().then((ok) => {
          const result = ok ? words?.withdrawDone : words?.withdrawFail;
          if (result) container.textContent = result;
        });
      });
      // One sentence above the button, once the text arrives; nothing if it never does.
      void text.then((t) => {
        words = t;
        if (t?.withdrawWhy && button.isConnected) {
          const why = document.createElement('span');
          why.textContent = t.withdrawWhy;
          why.setAttribute('style', 'flex-basis:100%;font-size:11px;color:#c0bfcd');
          container.insertBefore(why, button);
        }
      });
    },
    showData(onData) {
      const button = linkButton('data-estalara-data', copy.data);
      button.addEventListener('click', () => {
        void onData().then((ok) => {
          button.textContent = ok ? copy.data : copy.dataFail;
        });
      });
    },
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
