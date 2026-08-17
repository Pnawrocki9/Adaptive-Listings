/**
 * Quiz trigger widget — sticky button that prompts buyer to take
 * the v2.0 branching decision-tree quiz.
 *
 * Shown after 30 seconds on ANY page type where the SDK is loaded. Suppressed
 * for the rest of the session after quiz completion (sessionStorage, in lockstep
 * with the session-scoped archetype). Dismissible (sets localStorage flag for 24h)
 * without completing.
 *
 * FOLLOW-273 (2026-06-11): `QuizTriggerConfig.language` and `QUIZ_LABELS` key type now use
 * `QuizLanguage` imported from `@estalara/shared` instead of the inline `'en'|'pl'|'es'`
 * literal. `QUIZ_LANGUAGE_VALUES` is the single canonical source of truth.
 */

import type { QuizLanguage, WidgetPlacement } from '@estalara/shared';
import { DEFAULT_QUIZ_PLACEMENT } from '@estalara/shared';

import { placementToCss } from './placement.js';

export interface QuizTriggerConfig {
  accentColor: string;
  /**
   * Optional glyph rendered left of the label.
   *
   * Omit (the default) to get the built-in inline SVG mark — a house with a sparkle, drawn in
   * `currentColor` so it inherits the button's text color and therefore works on any brand
   * background. Pass a string to render that text instead (e.g. an emoji), which is what the
   * SDK did before FOLLOW-1014.
   */
  icon?: string;
  language: QuizLanguage;
  /**
   * Background color for the sticky trigger button (FOLLOW-623 / ADR-0019).
   *
   * The trigger has no per-widget color of its own, so per the ADR-0019 D4 precedence the
   * tenant's `brand.primary_color` becomes its color. Omit to keep the `TRIGGER_BG` default.
   * This is distinct from `accentColor`, which styles the quiz card, not the trigger.
   */
  backgroundColor?: string;
  /**
   * Sticky-trigger placement (FOLLOW-640 / ADR-0019 D2). Corner + px offsets from the
   * tenant's `quiz_placement` slice. Omit to keep `DEFAULT_QUIZ_PLACEMENT`
   * (`bottom-left`, 24/96 — raised clear of the opt-out toggle by FOLLOW-1014).
   */
  placement?: WidgetPlacement;
}

export const QUIZ_LABELS: Record<QuizLanguage, { trigger: string; dismiss: string }> = {
  en: {
    trigger: 'Find your match →',
    dismiss: '×',
  },
  pl: {
    trigger: 'Znajdź dopasowanie →',
    dismiss: '×',
  },
  es: {
    trigger: 'Encuentra tu coincidencia →',
    dismiss: '×',
  },
};

/**
 * Delay (ms) after SDK init before showing the quiz trigger.
 * Hardcoded at 30s per FOLLOW-257 AC3 (FOLLOW-199 tracks per-tenant configurability separately).
 */
export const QUIZ_TRIGGER_DELAY_MS = 30_000;

/**
 * Schedule the quiz trigger to appear after QUIZ_TRIGGER_DELAY_MS on any page.
 * Suppressed permanently after quiz completion. Respects 24h dismissal cooldown.
 * Returns a cancel function that clears the timer.
 */
export function scheduleQuizTrigger(onTrigger: () => void): () => void {
  if (isQuizCompleted() || isQuizDismissed()) {
    return () => {
      // already completed or dismissed — nothing to cancel
    };
  }
  const timerId = setTimeout(() => {
    if (!isQuizCompleted() && !isQuizDismissed()) {
      onTrigger();
    }
  }, QUIZ_TRIGGER_DELAY_MS);

  return () => {
    clearTimeout(timerId);
  };
}

const DISMISS_STORAGE_KEY = '__estalara_quiz_dismissed__';
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const COMPLETED_STORAGE_KEY = '__estalara_quiz_completed__';

/**
 * Check if the quiz trigger was dismissed recently (24h localStorage check).
 */
export function isQuizDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    if (isNaN(ts)) return false;
    return Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Check if the quiz was completed in THIS session (sessionStorage, tab-lifetime).
 *
 * Session-scoped on purpose: the resolved archetype it produces also lives in sessionStorage
 * (Mode A — no cross-session profiling without re-consent). A permanent (localStorage) flag would
 * suppress the quiz forever while the archetype is wiped on the next session, leaving a returning
 * visitor stuck on `neutral` with no way to re-declare. Tying completion to the session keeps the
 * two in lockstep: within a session the quiz is not re-shown; a fresh session re-profiles.
 */
export function isQuizCompleted(): boolean {
  try {
    return sessionStorage.getItem(COMPLETED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Suppress the quiz trigger for the rest of THIS session after the buyer completes the quiz.
 * Survives in-tab navigation and same-tab reload (sessionStorage); a new tab / window / session
 * shows the quiz again, in lockstep with the session-scoped resolved archetype.
 */
export function markQuizCompleted(): void {
  try {
    sessionStorage.setItem(COMPLETED_STORAGE_KEY, '1');
  } catch {
    // sessionStorage unavailable — ignore
  }
}

function markQuizDismissed(): void {
  try {
    localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
  } catch {
    // localStorage unavailable — ignore
  }
}

// Default trigger color = the Estalara listing-page primary CTA (#ce2a4d). A tenant with
// `brand.primary_color` set overrides this via `config.backgroundColor` (ADR-0019 D4).
// Was #ef4444 (Tailwind red-500) until FOLLOW-1014 — that red never matched the product's CTA.
const TRIGGER_BG = '#ce2a4d';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Built-in trigger mark: a solid house with a sparkle, i.e. "a listing matched to you".
 *
 * Drawn as inline SVG rather than an emoji so it renders identically across platforms (emoji
 * are font-dependent and always look foreign on a styled button) and inherits the button's
 * text color through `currentColor`, which keeps it legible on any tenant brand background.
 * Built with `createElementNS` — the SDK never assigns markup through `innerHTML`.
 *
 * Geometry note: the house occupies the lower-left of the 24×24 box and the sparkle sits in
 * the upper-right corner clear of the roof line, so the two never visually collide.
 */
function createQuizIconSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const house = document.createElementNS(SVG_NS, 'path');
  house.setAttribute(
    'd',
    'M8.65 5.3a1.4 1.4 0 0 1 1.7 0l6.6 5.55c.32.27.5.66.5 1.07v7.33c0 .8-.65 1.45-1.45 1.45h-3.6a.7.7 0 0 1-.7-.7V16.4a1.35 1.35 0 0 0-1.35-1.35h-1.2A1.35 1.35 0 0 0 7.3 16.4v3.6a.7.7 0 0 1-.7.7H3.2c-.8 0-1.45-.65-1.45-1.45v-7.33c0-.41.18-.8.5-1.07l6.4-5.55Z',
  );
  svg.appendChild(house);

  const sparkle = document.createElementNS(SVG_NS, 'path');
  sparkle.setAttribute(
    'd',
    'M19 1.6C19 4.15 19.85 5 22.4 5C19.85 5 19 5.85 19 8.4C19 5.85 18.15 5 15.6 5C18.15 5 19 4.15 19 1.6Z',
  );
  svg.appendChild(sparkle);

  return svg;
}

/**
 * Render the quiz trigger button into the shadow root.
 * Returns a cleanup function.
 */
export function renderQuizTrigger(
  shadowRoot: ShadowRoot,
  config: QuizTriggerConfig,
  onTrigger: () => void,
): () => void {
  try {
    const labels = QUIZ_LABELS[config.language];

    // FOLLOW-623 / ADR-0019 D4: use the tenant brand color when provided, else TRIGGER_BG.
    const triggerBg = config.backgroundColor ?? TRIGGER_BG;

    // FOLLOW-640 / ADR-0019 D2: position from the tenant placement, else the default
    // bottom-left 24/96 (FOLLOW-1014 raised it clear of the opt-out toggle).
    const placementCss = placementToCss(config.placement ?? DEFAULT_QUIZ_PLACEMENT);

    const style = document.createElement('style');
    style.textContent = `
      /* FOLLOW-1014: sized and weighted like a host-page primary button
         (14px / 600 / 10-16px padding) instead of the previous 28px, 24-36px slab.
         font: inherit picks up the host page's typeface — the widget then reads as part
         of the site rather than as a third-party overlay. */
      .estalara-trigger {
        position: fixed;
        ${placementCss};
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 18px;
        background: ${triggerBg};
        color: #fff;
        border: none;
        border-radius: 9999px;
        font-family: inherit;
        font-size: 15px;
        font-weight: 600;
        line-height: 1.2;
        cursor: pointer;
        /* Navy-tinted shadow (the brand ink #111b2b) reads softer against the page than
           neutral black at the same opacity. */
        box-shadow:
          0 4px 6px rgba(17, 27, 43, 0.1),
          0 10px 24px rgba(17, 27, 43, 0.16);
        z-index: 2147483647;
        pointer-events: auto;
        transition:
          background-color 0.2s,
          box-shadow 0.2s,
          transform 0.2s;
      }
      .estalara-trigger:hover {
        transform: translateY(-1px);
        box-shadow:
          0 6px 10px rgba(17, 27, 43, 0.12),
          0 14px 30px rgba(17, 27, 43, 0.2);
      }
      .estalara-trigger:active { transform: translateY(0); }
      .estalara-trigger:focus-visible {
        outline: 2px solid #fff;
        outline-offset: -4px;
      }
      /* Respect a reduced-motion preference — the lift is decorative. */
      @media (prefers-reduced-motion: reduce) {
        .estalara-trigger { transition: none; }
        .estalara-trigger:hover { transform: none; }
      }
      .estalara-trigger-icon {
        display: flex;
        align-items: center;
      }
      .estalara-trigger-dismiss {
        background: transparent;
        border: none;
        color: rgba(255,255,255,0.75);
        font-size: 18px;
        cursor: pointer;
        padding: 0 0 0 6px;
        line-height: 1;
        transition: color 0.2s;
      }
      .estalara-trigger-dismiss:hover { color: #fff; }
    `;
    shadowRoot.appendChild(style);

    const wrapper = document.createElement('div');

    const btn = document.createElement('button');
    btn.className = 'estalara-trigger';
    btn.setAttribute('aria-label', labels.trigger);

    // The icon stays wrapped in a <span> even though it is now an SVG: the button's span
    // order (spans[0] = icon, spans[1] = label) is what callers and tests read to find the
    // label text.
    const iconSpan = document.createElement('span');
    iconSpan.className = 'estalara-trigger-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    if (config.icon) {
      iconSpan.textContent = config.icon;
    } else {
      iconSpan.appendChild(createQuizIconSvg());
    }

    const labelSpan = document.createElement('span');
    labelSpan.textContent = labels.trigger;

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'estalara-trigger-dismiss';
    dismissBtn.textContent = labels.dismiss;
    dismissBtn.setAttribute('aria-label', 'Dismiss');

    btn.appendChild(iconSpan);
    btn.appendChild(labelSpan);
    btn.appendChild(dismissBtn);
    wrapper.appendChild(btn);
    shadowRoot.appendChild(wrapper);

    function handleTrigger(e: Event): void {
      e.stopPropagation();
      wrapper.remove();
      style.remove();
      onTrigger();
    }

    function handleDismiss(e: Event): void {
      e.stopPropagation();
      markQuizDismissed();
      wrapper.remove();
      style.remove();
    }

    btn.addEventListener('click', handleTrigger);
    dismissBtn.addEventListener('click', handleDismiss);

    return () => {
      btn.removeEventListener('click', handleTrigger);
      dismissBtn.removeEventListener('click', handleDismiss);
      try {
        wrapper.remove();
        style.remove();
      } catch {
        // already removed
      }
    };
  } catch {
    return () => {
      // nothing to clean up
    };
  }
}
