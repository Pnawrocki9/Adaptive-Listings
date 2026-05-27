/**
 * Quiz trigger widget — sticky button that prompts buyer to take
 * the 2-question investor intent quiz.
 *
 * Shown after 3 listing views OR immediately if quiz_config.sticky_widget = true.
 * Dismissible (sets localStorage flag for 24h).
 */

export interface QuizTriggerConfig {
  accentColor: string;
  icon: string;
  language: 'en' | 'pl' | 'es';
}

export const QUIZ_LABELS = {
  en: {
    trigger: 'Find your match in 2 questions →',
    dismiss: '×',
  },
  pl: {
    trigger: 'Znajdź dopasowanie w 2 pytaniach →',
    dismiss: '×',
  },
  es: {
    trigger: 'Encuentra tu coincidencia en 2 preguntas →',
    dismiss: '×',
  },
};

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
