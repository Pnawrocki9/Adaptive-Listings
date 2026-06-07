/**
 * Micro-poll bottom-toast widget — single yes/no intent prompt used as a quiz supplement.
 *
 * Shown after quiz dismiss or 90s session dwell when:
 *   - `micro_polls_enabled === true` in config
 *   - Full quiz NOT completed this session
 *   - Micro-poll not already shown this session
 *   - 24h localStorage cooldown not active
 *
 * Three default questions in Polish, shown in sequence across listing views.
 * Shadow DOM only — never touches tenant DOM.
 *
 * Storage: `__estalara_micro_poll_dismissed__` (localStorage, 24h TTL).
 * Mode A compliance: only stores a timestamp (no identifier). `removeItem` is
 * called on consent denial/withdrawal via the exported `eraseMicroPollDismissal()`
 * function, which `index.ts` must call from the consent-denied path.
 *
 * @module @estalara/sdk/ui/micro-poll
 */

export interface MicroPollQuestion {
  /** Stable key used as the `question` field in the `micro_poll.answered` signal. */
  key: string;
  /** Question text shown to the user. */
  text: string;
}

export interface MicroPollConfig {
  /** Accent color for the yes-button. Hex string, e.g. '#2563EB'. */
  accentColor: string;
  /** Ordered list of questions shown in sequence. */
  questions?: readonly MicroPollQuestion[];
}

/** Default three Polish micro-poll questions, shown in sequence. */
export const DEFAULT_MICRO_POLL_QUESTIONS: readonly MicroPollQuestion[] = [
  {
    key: 'purpose_investment',
    text: 'Czy ta nieruchomość ma być inwestycją?',
  },
  {
    key: 'family_buyer',
    text: 'Czy szukasz nieruchomości dla rodziny z dziećmi?',
  },
  {
    key: 'vacation_rental_investor',
    text: 'Czy planujesz wynajem krótkoterminowy?',
  },
];

export const MICRO_POLL_DISMISS_KEY = '__estalara_micro_poll_dismissed__';
const MICRO_POLL_DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if the micro-poll is in its 24h dismissal cooldown.
 * Uses `globalThis.localStorage` to avoid esbuild dead-code elimination.
 */
export function isMicroPollDismissed(): boolean {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(
      MICRO_POLL_DISMISS_KEY,
    );
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    if (isNaN(ts)) return false;
    return Date.now() - ts < MICRO_POLL_DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

/** Mark the micro-poll as dismissed (sets 24h cooldown). */
function markMicroPollDismissed(): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(
      MICRO_POLL_DISMISS_KEY,
      String(Date.now()),
    );
  } catch {
    // localStorage unavailable — ignore
  }
}

/**
 * Remove the micro-poll dismissal key from localStorage.
 * Must be called on consent denial / withdrawal to satisfy Mode A compliance.
 */
export function eraseMicroPollDismissal(): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.removeItem(MICRO_POLL_DISMISS_KEY);
  } catch {
    // localStorage unavailable — ignore
  }
}

/**
 * Render a micro-poll bottom-toast into the provided shadow root.
 *
 * The toast is a small fixed bar at the bottom of the screen — NOT a full overlay.
 * It shows `question.text` with a Yes / No button pair and a dismiss (×) control.
 *
 * On answer: calls `onAnswer(question.key, 'yes' | 'no')` and removes the toast.
 * On dismiss: sets the 24h localStorage cooldown, calls `onDismiss()`, removes toast.
 *
 * Returns a cleanup function that removes the toast without triggering callbacks.
 */
export function renderMicroPoll(
  shadowRoot: ShadowRoot,
  config: MicroPollConfig,
  question: MicroPollQuestion,
  onAnswer: (questionKey: string, answer: 'yes' | 'no') => void,
  onDismiss: () => void,
): () => void {
  try {
    const style = document.createElement('style');
    style.textContent = `
      .estalara-micro-poll {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: #fff;
        border-top: 2px solid ${config.accentColor};
        box-shadow: 0 -2px 16px rgba(0,0,0,0.12);
        padding: 14px 20px;
        display: flex;
        align-items: center;
        gap: 12px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        pointer-events: auto;
        box-sizing: border-box;
        flex-wrap: wrap;
      }
      .estalara-micro-poll__question {
        flex: 1 1 200px;
        font-size: 14px;
        font-weight: 500;
        color: #111;
        margin: 0;
        min-width: 0;
      }
      .estalara-micro-poll__actions {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-shrink: 0;
      }
      .estalara-micro-poll__btn-yes {
        padding: 8px 18px;
        background: ${config.accentColor};
        color: #fff;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.15s;
      }
      .estalara-micro-poll__btn-yes:hover { opacity: 0.88; }
      .estalara-micro-poll__btn-no {
        padding: 8px 14px;
        background: transparent;
        color: #444;
        border: 1px solid #ccc;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s;
      }
      .estalara-micro-poll__btn-no:hover { background: #f0f0f0; }
      .estalara-micro-poll__dismiss {
        background: transparent;
        border: none;
        color: #888;
        font-size: 20px;
        cursor: pointer;
        padding: 2px 4px;
        line-height: 1;
        flex-shrink: 0;
      }
      .estalara-micro-poll__dismiss:hover { color: #444; }
    `;
    shadowRoot.appendChild(style);

    const toast = document.createElement('div');
    toast.className = 'estalara-micro-poll';
    toast.setAttribute('role', 'dialog');
    toast.setAttribute('aria-label', question.text);

    const questionEl = document.createElement('p');
    questionEl.className = 'estalara-micro-poll__question';
    questionEl.textContent = question.text;

    const actions = document.createElement('div');
    actions.className = 'estalara-micro-poll__actions';

    const btnYes = document.createElement('button');
    btnYes.className = 'estalara-micro-poll__btn-yes';
    btnYes.textContent = 'Tak';
    btnYes.setAttribute('aria-label', 'Tak');

    const btnNo = document.createElement('button');
    btnNo.className = 'estalara-micro-poll__btn-no';
    btnNo.textContent = 'Nie';
    btnNo.setAttribute('aria-label', 'Nie');

    const btnDismiss = document.createElement('button');
    btnDismiss.className = 'estalara-micro-poll__dismiss';
    btnDismiss.textContent = '×';
    btnDismiss.setAttribute('aria-label', 'Zamknij');

    actions.appendChild(btnYes);
    actions.appendChild(btnNo);

    toast.appendChild(questionEl);
    toast.appendChild(actions);
    toast.appendChild(btnDismiss);
    shadowRoot.appendChild(toast);

    function cleanup(): void {
      try {
        toast.remove();
        style.remove();
      } catch {
        // already removed
      }
    }

    function handleYes(e: Event): void {
      e.stopPropagation();
      cleanup();
      onAnswer(question.key, 'yes');
    }

    function handleNo(e: Event): void {
      e.stopPropagation();
      cleanup();
      onAnswer(question.key, 'no');
    }

    function handleDismiss(e: Event): void {
      e.stopPropagation();
      markMicroPollDismissed();
      cleanup();
      onDismiss();
    }

    btnYes.addEventListener('click', handleYes);
    btnNo.addEventListener('click', handleNo);
    btnDismiss.addEventListener('click', handleDismiss);

    return () => {
      btnYes.removeEventListener('click', handleYes);
      btnNo.removeEventListener('click', handleNo);
      btnDismiss.removeEventListener('click', handleDismiss);
      cleanup();
    };
  } catch {
    return () => {
      // nothing to clean up
    };
  }
}
