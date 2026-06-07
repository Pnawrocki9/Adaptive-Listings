/**
 * Quiz widget v2.0 — branching decision tree.
 *
 * Q1 (gate): 4 options → INWESTOR / WŁASNY_UZYTKU / CROSS_BORDER branch, or neutral (skip).
 * Each branch has Q2 (and optionally Q3) leading to exactly one leaf archetype.
 *
 * 17 non-neutral leaf archetypes:
 *   INWESTOR:       yield_hunter, portfolio_builder, golden_visa_buyer,
 *                   vacation_rental_investor, flip_investor, commercial_investor
 *   WŁASNY_UZYTKU:  first_time_buyer, family_buyer, upsizer, downsizer, luxury_buyer, remote_worker
 *   CROSS_BORDER:   retiree_relocator, diaspora_buyer, lifestyle_expat,
 *                   second_home_buyer, student_parent
 *
 * On leaf resolution: calls `onComplete` with the resolved archetype (or 'neutral').
 * On dismiss: calls `onDismiss`.
 *
 * @module @estalara/sdk/ui/quiz-widget
 */

import type { Archetype } from '../core/intent.js';

/** All 17 non-neutral leaf archetypes plus 'neutral' for Q1-D skip. */
export type QuizResolvedArchetype = Archetype;

export interface QuizWidgetConfig {
  accentColor: string;
  language: 'en' | 'pl' | 'es';
}

// ─── I18n content ─────────────────────────────────────────────────────────────

interface QuizQuestion {
  question: string;
  answers: string[];
}

interface QuizLang {
  q1_gate: QuizQuestion;
  inwestor_q2: QuizQuestion;
  inwestor_q3: QuizQuestion;
  own_use_q2: QuizQuestion;
  own_use_q3: QuizQuestion;
  cross_border_q2: QuizQuestion;
  cross_border_q3: QuizQuestion;
  cta_next: string;
  cta_finish: string;
  skip: string;
}

export const QUIZ_CONTENT: Record<'en' | 'pl' | 'es', QuizLang> = {
  en: {
    q1_gate: {
      question: 'What are you looking for?',
      answers: [
        'Investment property',
        'A home for myself or my family',
        'Buying abroad / cross-border',
        'Just browsing',
      ],
    },
    inwestor_q2: {
      question: 'What is your investment focus?',
      answers: [
        'Rental income (yield)',
        'Vacation rental',
        'Flip / renovation',
        'Commercial / portfolio',
      ],
    },
    inwestor_q3: {
      question: 'What is your target return?',
      answers: [
        'Steady yield above market average',
        'Long-term portfolio growth',
        'Golden visa / residency pathway',
      ],
    },
    own_use_q2: {
      question: 'What describes your situation best?',
      answers: ['First-time buyer', 'Growing family', 'Upsizing', 'Downsizing'],
    },
    own_use_q3: {
      question: 'What matters most to you?',
      answers: [
        'Location and community',
        'Luxury finishes and prestige',
        'Remote-work setup',
        'Value for money',
      ],
    },
    cross_border_q2: {
      question: 'Why are you buying abroad?',
      answers: ['Retiring or relocating', 'Second / holiday home', 'Supporting a student'],
    },
    cross_border_q3: {
      question: 'What is your primary goal?',
      answers: [
        'Retire and settle permanently',
        'Stay connected to home country',
        'Lifestyle and travel base',
      ],
    },
    cta_next: '→',
    cta_finish: 'Find my match',
    skip: 'Skip',
  },
  pl: {
    q1_gate: {
      question: 'Czego szukasz?',
      answers: [
        'Nieruchomość inwestycyjna',
        'Dom dla siebie lub rodziny',
        'Zakup za granicą',
        'Tylko przeglądam',
      ],
    },
    inwestor_q2: {
      question: 'Na czym skupia się Twoja inwestycja?',
      answers: [
        'Przychód z najmu (yield)',
        'Wynajem wakacyjny',
        'Flipping / renowacja',
        'Komercja / portfel',
      ],
    },
    inwestor_q3: {
      question: 'Jaki jest Twój docelowy zwrot?',
      answers: [
        'Stabilny yield powyżej rynku',
        'Długoterminowy wzrost portfela',
        'Golden visa / ścieżka rezydencji',
      ],
    },
    own_use_q2: {
      question: 'Co najlepiej opisuje Twoją sytuację?',
      answers: [
        'Kupuję po raz pierwszy',
        'Rosnąca rodzina',
        'Przeprowadzam się do większego',
        'Zmniejszam metraż',
      ],
    },
    own_use_q3: {
      question: 'Co jest dla Ciebie najważniejsze?',
      answers: [
        'Lokalizacja i społeczność',
        'Luksusowe wykończenie i prestiż',
        'Praca zdalna',
        'Cena i wartość',
      ],
    },
    cross_border_q2: {
      question: 'Dlaczego kupujesz za granicą?',
      answers: ['Emerytura lub relokacja', 'Drugi dom / wakacyjny', 'Wsparcie dla studenta'],
    },
    cross_border_q3: {
      question: 'Jaki jest Twój główny cel?',
      answers: [
        'Osiedlić się na stałe',
        'Pozostać w kontakcie z krajem',
        'Baza lifestyle / podróże',
      ],
    },
    cta_next: '→',
    cta_finish: 'Znajdź dopasowanie',
    skip: 'Pomiń',
  },
  es: {
    q1_gate: {
      question: '¿Qué buscas?',
      answers: [
        'Propiedad de inversión',
        'Una vivienda para mí o mi familia',
        'Comprar en el extranjero',
        'Solo estoy mirando',
      ],
    },
    inwestor_q2: {
      question: '¿Cuál es tu enfoque de inversión?',
      answers: [
        'Ingresos por alquiler (rentabilidad)',
        'Alquiler vacacional',
        'Reforma / inversión rápida',
        'Comercial / cartera',
      ],
    },
    inwestor_q3: {
      question: '¿Cuál es tu rentabilidad objetivo?',
      answers: [
        'Rentabilidad estable por encima del mercado',
        'Crecimiento de cartera a largo plazo',
        'Visado dorado / residencia',
      ],
    },
    own_use_q2: {
      question: '¿Qué describe mejor tu situación?',
      answers: [
        'Comprador por primera vez',
        'Familia en crecimiento',
        'Mudarse a algo más grande',
        'Reducir tamaño',
      ],
    },
    own_use_q3: {
      question: '¿Qué es lo más importante para ti?',
      answers: [
        'Ubicación y comunidad',
        'Acabados de lujo y prestigio',
        'Trabajo en remoto',
        'Precio y valor',
      ],
    },
    cross_border_q2: {
      question: '¿Por qué compras en el extranjero?',
      answers: [
        'Jubilación o reubicación',
        'Segunda vivienda / vacacional',
        'Apoyo a un estudiante',
      ],
    },
    cross_border_q3: {
      question: '¿Cuál es tu objetivo principal?',
      answers: [
        'Establecerse permanentemente',
        'Mantener vínculos con el país de origen',
        'Base de estilo de vida / viajes',
      ],
    },
    cta_next: '→',
    cta_finish: 'Encontrar mi opción',
    skip: 'Omitir',
  },
};

// ─── State machine types ───────────────────────────────────────────────────────

type Branch = 'INWESTOR' | 'OWN_USE' | 'CROSS_BORDER';

/**
 * Resolve the leaf archetype from the collected answers.
 * Returns 'neutral' for Q1-D (skip).
 */
export function resolveArchetype(
  branch: Branch | null,
  q2Answer: number | null,
  q3Answer: number | null,
): QuizResolvedArchetype {
  if (branch === null) return 'neutral';

  if (branch === 'INWESTOR') {
    if (q2Answer === 0) {
      // Q2-A → Q3 required
      if (q3Answer === 0) return 'yield_hunter';
      if (q3Answer === 1) return 'portfolio_builder';
      if (q3Answer === 2) return 'golden_visa_buyer';
      return 'yield_hunter'; // defensive fallback
    }
    if (q2Answer === 1) return 'vacation_rental_investor';
    if (q2Answer === 2) return 'flip_investor';
    if (q2Answer === 3) return 'commercial_investor';
    return 'yield_hunter'; // defensive fallback
  }

  if (branch === 'OWN_USE') {
    // Q2 determines base; Q3 may override
    const base: QuizResolvedArchetype =
      q2Answer === 0
        ? 'first_time_buyer'
        : q2Answer === 1
          ? 'family_buyer'
          : q2Answer === 2
            ? 'upsizer'
            : 'downsizer';

    // Q3 override rule: B → luxury_buyer, C → remote_worker; A/D confirm base
    if (q3Answer === 1) return 'luxury_buyer';
    if (q3Answer === 2) return 'remote_worker';
    return base;
  }

  // CROSS_BORDER
  if (q2Answer === 0) {
    // Q2-A → Q3 required
    if (q3Answer === 0) return 'retiree_relocator';
    if (q3Answer === 1) return 'diaspora_buyer';
    if (q3Answer === 2) return 'lifestyle_expat';
    return 'retiree_relocator'; // defensive fallback
  }
  if (q2Answer === 1) return 'second_home_buyer';
  if (q2Answer === 2) return 'student_parent';
  return 'second_home_buyer'; // defensive fallback
}

/**
 * Compute the total step count (2 or 3) for a given branch and Q2 answer.
 * Returns 2 when Q3 is not required, 3 when it is.
 */
export function computeStepCount(branch: Branch | null, q2Answer: number | null): 2 | 3 {
  if (branch === null) return 2; // Q1 only, never used for progress display
  // Q3 is required when:
  //   INWESTOR: Q2-A (yield focus)
  //   OWN_USE: always (Q3 always asked)
  //   CROSS_BORDER: Q2-A (retiring/relocating)
  if (branch === 'INWESTOR') return q2Answer === 0 ? 3 : 2;
  if (branch === 'OWN_USE') return 3;
  // CROSS_BORDER
  return q2Answer === 0 ? 3 : 2;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

/**
 * Render the v2 quiz widget into the given Shadow Root.
 * Returns a cleanup function.
 */
export function renderQuizWidget(
  shadowRoot: ShadowRoot,
  config: QuizWidgetConfig,
  onComplete: (resolvedArchetype: QuizResolvedArchetype) => void,
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

    // ── State ──────────────────────────────────────────────────────────────────
    //
    // step:     1 = Q1 gate, 2 = branch Q2, 3 = branch Q3
    // branch:   null until Q1 answered (not neutral)
    // q2Answer: index of selected answer in Q2, null until answered
    // q3Answer: index of selected answer in Q3, null until answered
    let step: 1 | 2 | 3 = 1;
    let branch: Branch | null = null;
    let q2Answer: number | null = null;
    let q3Answer: number | null = null;

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

    function getStepCount(): 2 | 3 {
      if (step === 1) {
        // We don't know Q2 answer yet — show 2 as default until branch is resolved
        return branch !== null ? computeStepCount(branch, q2Answer) : 2;
      }
      return computeStepCount(branch, step >= 2 ? q2Answer : null);
    }

    function getCurrentQuestion(): QuizQuestion {
      if (step === 1) return content.q1_gate;
      if (step === 2) {
        if (branch === 'INWESTOR') return content.inwestor_q2;
        if (branch === 'OWN_USE') return content.own_use_q2;
        return content.cross_border_q2;
      }
      // step === 3
      if (branch === 'INWESTOR') return content.inwestor_q3;
      if (branch === 'OWN_USE') return content.own_use_q3;
      return content.cross_border_q3;
    }

    function getCurrentAnswer(): number | null {
      if (step === 1) return null; // Q1 navigates immediately on click
      if (step === 2) return q2Answer;
      return q3Answer;
    }

    function buildStep(): void {
      card.innerHTML = '';
      card.appendChild(closeBtn);

      // Progress indicator: step X / totalSteps
      // On Q1 we show "1 / 2" tentatively; it updates after branch is known.
      const totalSteps = getStepCount();
      const progress = document.createElement('div');
      progress.className = 'estalara-quiz-progress';
      progress.textContent = `${String(step)} / ${String(totalSteps)}`;
      card.appendChild(progress);

      const q = getCurrentQuestion();
      const currentAnswer = getCurrentAnswer();

      const question = document.createElement('p');
      question.className = 'estalara-quiz-question';
      question.textContent = q.question;
      card.appendChild(question);

      const answersDiv = document.createElement('div');
      answersDiv.className = 'estalara-quiz-answers';

      q.answers.forEach((text, idx) => {
        const btn = document.createElement('button');
        btn.className = 'estalara-quiz-answer';
        if (currentAnswer === idx) {
          btn.classList.add('selected');
        }
        btn.textContent = text;
        btn.addEventListener('click', () => {
          handleAnswerClick(idx);
        });
        answersDiv.appendChild(btn);
      });
      card.appendChild(answersDiv);

      const canProceed = step === 1 ? false : getCurrentAnswer() !== null;

      const isLastStep = step === 2 ? computeStepCount(branch, q2Answer) === 2 : step === 3;

      if (!isLastStep || step === 1) {
        // On Q1 we never show a CTA — answers navigate immediately.
        if (step !== 1) {
          const cta = document.createElement('button');
          cta.className = 'estalara-quiz-cta';
          cta.textContent = content.cta_next;
          cta.disabled = !canProceed;
          cta.addEventListener('click', () => {
            step = 3;
            buildStep();
          });
          card.appendChild(cta);
        }
      } else {
        const cta = document.createElement('button');
        cta.className = 'estalara-quiz-cta';
        cta.textContent = content.cta_finish;
        cta.disabled = !canProceed;
        cta.addEventListener('click', () => {
          const resolved = resolveArchetype(branch, q2Answer, q3Answer);
          cleanup();
          onComplete(resolved);
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

    function handleAnswerClick(idx: number): void {
      if (step === 1) {
        // Q1: navigate immediately
        if (idx === 0) {
          branch = 'INWESTOR';
          step = 2;
        } else if (idx === 1) {
          branch = 'OWN_USE';
          step = 2;
        } else if (idx === 2) {
          branch = 'CROSS_BORDER';
          step = 2;
        } else {
          // D → neutral, resolve immediately
          cleanup();
          onComplete('neutral');
          return;
        }
        buildStep();
        return;
      }

      if (step === 2) {
        q2Answer = idx;
        buildStep();
        return;
      }

      // step === 3
      q3Answer = idx;
      buildStep();
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
