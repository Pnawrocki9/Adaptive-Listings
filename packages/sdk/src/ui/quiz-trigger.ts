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

import type { QuizLanguage } from '@estalara/shared';

export interface QuizTriggerConfig {
  accentColor: string;
  icon: string;
  language: QuizLanguage;
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

// Quiz trigger color matches the listing-page CTA red (#ef4444 = Tailwind red-500).
const TRIGGER_BG = '#ef4444';

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

    const style = document.createElement('style');
    style.textContent = `
      .estalara-trigger {
        position: fixed;
        bottom: 24px;
        left: 24px;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 24px 36px;
        background: ${TRIGGER_BG};
        color: #fff;
        border: none;
        border-radius: 9999px;
        font-size: 28px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 4px 24px rgba(0,0,0,0.22);
        z-index: 2147483647;
        pointer-events: auto;
        transition: opacity 0.2s;
      }
      .estalara-trigger:hover { opacity: 0.9; }
      .estalara-trigger-dismiss {
        background: transparent;
        border: none;
        color: rgba(255,255,255,0.8);
        font-size: 28px;
        cursor: pointer;
        padding: 0 0 0 8px;
        line-height: 1;
      }
    `;
    shadowRoot.appendChild(style);

    const wrapper = document.createElement('div');

    const btn = document.createElement('button');
    btn.className = 'estalara-trigger';
    btn.setAttribute('aria-label', labels.trigger);

    const iconSpan = document.createElement('span');
    iconSpan.textContent = config.icon;
    iconSpan.setAttribute('aria-hidden', 'true');

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
