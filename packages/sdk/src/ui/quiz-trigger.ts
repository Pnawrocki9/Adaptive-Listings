/**
 * Quiz trigger widget — sticky button that prompts buyer to take
 * the v2.0 branching decision-tree quiz.
 *
 * Shown after 30 seconds on ANY page type where the SDK is loaded.
 * Dismissible (sets localStorage flag for 24h).
 */

export interface QuizTriggerConfig {
  accentColor: string;
  icon: string;
  language: 'en' | 'pl' | 'es';
}

export const QUIZ_LABELS = {
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
 * FOLLOW-199: per-tenant timer configurability tracked separately.
 * Rule L: data-quiz-trigger attribute was removed in FOLLOW-257 (no producer
 * or runtime consumer existed); this constant is the sole timer source.
 */
export const QUIZ_TRIGGER_DELAY_MS = 30_000;

/**
 * Schedule the quiz trigger to appear after QUIZ_TRIGGER_DELAY_MS on any page.
 * Respects the 24h dismissal cooldown. Calls `onTrigger` when the timer fires
 * (if not dismissed). Returns a cancel function that clears the timer.
 */
export function scheduleQuizTrigger(onTrigger: () => void): () => void {
  if (isQuizDismissed()) {
    return () => {
      // already dismissed — nothing to cancel
    };
  }
  const timerId = setTimeout(() => {
    if (!isQuizDismissed()) {
      onTrigger();
    }
  }, QUIZ_TRIGGER_DELAY_MS);

  return () => {
    clearTimeout(timerId);
  };
}

const DISMISS_STORAGE_KEY = '__estalara_quiz_dismissed__';
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

function markQuizDismissed(): void {
  try {
    localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
  } catch {
    // localStorage unavailable — ignore
  }
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

    const style = document.createElement('style');
    style.textContent = `
      .estalara-trigger {
        position: fixed;
        bottom: 24px;
        right: 24px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 18px;
        background: ${config.accentColor};
        color: #fff;
        border: none;
        border-radius: 9999px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(0,0,0,0.18);
        z-index: 2147483647;
        pointer-events: auto;
        transition: opacity 0.2s;
      }
      .estalara-trigger:hover { opacity: 0.9; }
      .estalara-trigger-dismiss {
        background: transparent;
        border: none;
        color: rgba(255,255,255,0.8);
        font-size: 18px;
        cursor: pointer;
        padding: 0 0 0 4px;
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
