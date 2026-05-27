/**
 * The 2-question investor intent quiz widget.
 * Rendered inside Shadow DOM when buyer clicks the trigger.
 *
 * Q1: Purpose (personal / investment)
 * Q2: Horizon (≤3 months / >1 year)
 *
 * On completion: dispatches quiz.event to ingest and calls onComplete with answers.
 */

export interface QuizAnswers {
  purpose: 'personal' | 'investment';
  horizon: 'short' | 'long';
}

export interface QuizWidgetConfig {
  accentColor: string;
  language: 'en' | 'pl' | 'es';
}

export const QUIZ_CONTENT = {
  en: {
    q1: {
      question: 'What brings you here today?',
      answers: [
        'Looking for a home for myself or my family',
        'Exploring as an investment opportunity',
      ],
    },
    q2: {
      question: 'When are you hoping to make a decision?',
      answers: ['Within the next 3 months', 'More than a year from now / Just exploring'],
    },
    cta: 'Find my match',
    skip: 'Skip',
  },
  pl: {
    q1: {
      question: 'Co Cię tu sprowadza?',
      answers: ['Szukam domu dla siebie lub rodziny', 'Rozglądam się za inwestycją'],
    },
    q2: {
      question: 'Kiedy planujesz podjąć decyzję?',
      answers: ['W ciągu najbliższych 3 miesięcy', 'Za ponad rok / Dopiero się rozglądam'],
    },
    cta: 'Znajdź dopasowanie',
    skip: 'Pomiń',
  },
  es: {
    q1: {
      question: '¿Qué te trae por aquí?',
      answers: ['Busco una vivienda para mí o mi familia', 'Estoy explorando como inversión'],
    },
    q2: {
      question: '¿Cuándo esperas tomar una decisión?',
      answers: ['En los próximos 3 meses', 'En más de un año / Solo explorando'],
    },
    cta: 'Encontrar mi opción',
    skip: 'Omitir',
  },
};

export function renderQuizWidget(
  shadowRoot: ShadowRoot,
  config: QuizWidgetConfig,
  onComplete: (answers: QuizAnswers) => void,
  onDismiss: () => void,
): () => void {
  try {
    const content = QUIZ_CONTENT[config.language];

    const style = document.createElement('style');
    style.textContent = `
      .estalara-quiz-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.45);
        display: flex;
        align-items: flex-end;
        justify-content: center;
        z-index: 2147483647;
        pointer-events: auto;
        padding: 0 0 32px;
      }
      .estalara-quiz-card {
        background: #fff;
        border-radius: 16px;
        padding: 28px 24px 24px;
        max-width: 400px;
        width: calc(100% - 32px);
        box-shadow: 0 8px 32px rgba(0,0,0,0.22);
        position: relative;
      }
      .estalara-quiz-close {
        position: absolute;
        top: 12px;
        right: 16px;
        background: transparent;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: #6b7280;
        line-height: 1;
      }
      .estalara-quiz-question {
        font-size: 16px;
        font-weight: 600;
        color: #111827;
        margin: 0 0 16px;
      }
      .estalara-quiz-answers {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 20px;
      }
      .estalara-quiz-answer {
        padding: 12px 16px;
        border: 2px solid #e5e7eb;
        border-radius: 10px;
        background: #fff;
        font-size: 14px;
        text-align: left;
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s;
        color: #374151;
      }
      .estalara-quiz-answer:hover,
      .estalara-quiz-answer.selected {
        border-color: ${config.accentColor};
        background: #f0f4ff;
      }
      .estalara-quiz-cta {
        width: 100%;
        padding: 12px;
        background: ${config.accentColor};
        color: #fff;
        border: none;
        border-radius: 9999px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        opacity: 0.5;
        transition: opacity 0.15s;
      }
      .estalara-quiz-cta:enabled { opacity: 1; }
      .estalara-quiz-skip {
        display: block;
        margin: 12px auto 0;
        background: transparent;
        border: none;
        color: #9ca3af;
        font-size: 13px;
        cursor: pointer;
        text-decoration: underline;
      }
      .estalara-quiz-progress {
        font-size: 12px;
        color: #9ca3af;
        margin-bottom: 12px;
      }
    `;
    shadowRoot.appendChild(style);

    let step: 1 | 2 = 1;
    let purposeAnswer: 'personal' | 'investment' | null = null;
    let horizonAnswer: 'short' | 'long' | null = null;

    const overlay = document.createElement('div');
    overlay.className = 'estalara-quiz-overlay';

    const card = document.createElement('div');
    card.className = 'estalara-quiz-card';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'estalara-quiz-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => {
      cleanup();
      onDismiss();
    });

    function buildStep(): void {
      card.innerHTML = '';
      card.appendChild(closeBtn);

      const progress = document.createElement('div');
      progress.className = 'estalara-quiz-progress';
      progress.textContent = `${String(step)} / 2`;
      card.appendChild(progress);

      const q = step === 1 ? content.q1 : content.q2;
      const currentAnswer = step === 1 ? purposeAnswer : horizonAnswer;

      const question = document.createElement('p');
      question.className = 'estalara-quiz-question';
      question.textContent = q.question;
      card.appendChild(question);

      const answersDiv = document.createElement('div');
      answersDiv.className = 'estalara-quiz-answers';

      q.answers.forEach((text, idx) => {
        const btn = document.createElement('button');
        btn.className = 'estalara-quiz-answer';
        if (
          (step === 1 && currentAnswer === (idx === 0 ? 'personal' : 'investment')) ||
          (step === 2 && currentAnswer === (idx === 0 ? 'short' : 'long'))
        ) {
          btn.classList.add('selected');
        }
        btn.textContent = text;
        btn.addEventListener('click', () => {
          if (step === 1) {
            purposeAnswer = idx === 0 ? 'personal' : 'investment';
          } else {
            horizonAnswer = idx === 0 ? 'short' : 'long';
          }
          buildStep();
        });
        answersDiv.appendChild(btn);
      });
      card.appendChild(answersDiv);

      const canProceed = step === 1 ? purposeAnswer !== null : horizonAnswer !== null;

      if (step === 1) {
        const cta = document.createElement('button');
        cta.className = 'estalara-quiz-cta';
        cta.textContent = '→';
        cta.disabled = !canProceed;
        cta.addEventListener('click', () => {
          step = 2;
          buildStep();
        });
        card.appendChild(cta);
      } else {
        const cta = document.createElement('button');
        cta.className = 'estalara-quiz-cta';
        cta.textContent = content.cta;
        cta.disabled = !canProceed;
        cta.addEventListener('click', () => {
          if (purposeAnswer && horizonAnswer) {
            cleanup();
            onComplete({ purpose: purposeAnswer, horizon: horizonAnswer });
          }
        });
        card.appendChild(cta);
      }

      const skip = document.createElement('button');
      skip.className = 'estalara-quiz-skip';
      skip.textContent = content.skip;
      skip.addEventListener('click', () => {
        cleanup();
        onDismiss();
      });
      card.appendChild(skip);
    }

    buildStep();
    overlay.appendChild(card);
    shadowRoot.appendChild(overlay);

    function cleanup(): void {
      try {
        overlay.remove();
        style.remove();
      } catch {
        // already removed
      }
    }

    return cleanup;
  } catch {
    return () => {
      // nothing to clean up
    };
  }
}
