/**
 * Quiz widget v3.0 — generic definition-driven tree walker (FOLLOW-639 / ADR-0019 D5).
 *
 * The answer→archetype mapping is no longer a hardcoded `resolveArchetype()` switch over
 * fixed `QUIZ_CONTENT`: it now lives in DATA — a `QuizDefinition` (the tenant's served,
 * fully editable tree, or the built-in `DEFAULT_QUIZ_DEFINITION` fallback). This renderer is
 * a GENERIC walker that:
 *   1. Starts at `definition.root` and follows each selected answer's `next` until a leaf
 *      (`next: null`), accumulating the selected answers' `weights` vectors.
 *   2. Reduces the accumulated vector to a SINGLE resolved archetype by argmax
 *      (`reduceWeightsToArchetype`, the ONE shared source of truth for the reduction; empty /
 *      all-zero ⇒ `neutral`, ties broken by canonical order).
 *
 * The downstream persistence contract is UNCHANGED (ADR-0019 D5): `onComplete(resolved)` still
 * feeds `applyQuizLeaf` → `persistResolvedArchetype` (non-neutral only, FOLLOW-554) →
 * `postQuizCompletionPing` byte-for-byte — only the mapping SOURCE moved from code to data.
 *
 * `DEFAULT_QUIZ_DEFINITION` reproduces the pre-ADR-0019 tree EXACTLY (the same 17 non-neutral
 * leaves + neutral skip), expressed in the definition format and reduced by the same argmax —
 * so an unconfigured tenant resolves the identical archetype for every path (proven by the
 * parity test). It is EN-only (ADR-0019 D6 "minimal EN-only default tree"); the previous
 * PL/ES `QUIZ_CONTENT` strings move server-side (a brand localises by saving a definition with
 * its own `label_i18n`), banking the net-bundle-win the ADR sequences before FOLLOW-641.
 *
 * @module @estalara/sdk/ui/quiz-widget
 */

import type { QuizDefinition, QuizLanguage, QuizQuestion } from '@estalara/shared';
import { reduceWeightsToArchetype } from '@estalara/shared';

import type { Archetype } from '../core/intent.js';

/** A resolved leaf archetype (one of the 17 non-neutral archetypes, or 'neutral'). */
export type QuizResolvedArchetype = Archetype;

export interface QuizWidgetConfig {
  accentColor: string;
  language: QuizLanguage;
  /**
   * The quiz tree to walk — the tenant's served `quiz_definition` slice, or
   * `DEFAULT_QUIZ_DEFINITION` when the tenant configured none (ADR-0019 D4/D5).
   */
  definition: QuizDefinition;
  /**
   * Tenant brand logo URL shown atop the quiz card (FOLLOW-623 / ADR-0019).
   *
   * `string | null`, never `undefined` (ADR-0019 D-nullability). `null` (or omitted) renders
   * no logo — byte-identical to pre-ADR-0019.
   */
  logoUrl?: string | null;
}

// ─── UI chrome i18n (question/answer strings live in the definition) ────────────

/**
 * Widget CHROME labels — the small non-content strings (CTA + skip) not carried by the
 * definition. Kept multilingual (tiny) so a served non-EN definition still gets localised
 * chrome. Question/answer text comes from the definition's `prompt_i18n` / `label_i18n`.
 */
const CHROME_LABELS: Record<QuizLanguage, { next: string; finish: string; skip: string }> = {
  en: { next: '→', finish: 'Find my match', skip: 'Skip' },
  pl: { next: '→', finish: 'Znajdź dopasowanie', skip: 'Pomiń' },
  es: { next: '→', finish: 'Encontrar mi opción', skip: 'Omitir' },
};

// ─── Built-in default definition (EN-only) — reproduces the pre-ADR-0019 tree ──

/**
 * The built-in default quiz tree (ADR-0019 D5/D6), expressed in the `QuizDefinition` format
 * and reduced by the shared argmax so it resolves the SAME archetype as the old
 * `resolveArchetype()` switch for every path (parity test: `quiz-widget.test.ts`).
 *
 * Weight scheme: a branch/gate answer contributes `{}` (0); a base own-use answer contributes
 * `1` to its archetype; an override own-use Q3 answer contributes `2` so it beats the base on
 * argmax (the old "Q3-B → luxury, Q3-C → remote, else confirm base" rule); leaf answers on the
 * investor/cross-border branches contribute `1` to their single archetype.
 */
export const DEFAULT_QUIZ_DEFINITION: QuizDefinition = {
  schema_version: 1,
  root: 'q1_gate',
  languages: ['en'],
  questions: [
    {
      id: 'q1_gate',
      prompt_i18n: { en: 'What are you looking for?' },
      answers: [
        {
          id: 'invest',
          label_i18n: { en: 'Investment property' },
          weights: {},
          next: 'inwestor_q2',
        },
        {
          id: 'home',
          label_i18n: { en: 'A home for myself or my family' },
          weights: {},
          next: 'own_use_q2',
        },
        {
          id: 'abroad',
          label_i18n: { en: 'Buying abroad / cross-border' },
          weights: {},
          next: 'cross_border_q2',
        },
        { id: 'browse', label_i18n: { en: 'Just browsing' }, weights: {}, next: null },
      ],
    },
    {
      id: 'inwestor_q2',
      prompt_i18n: { en: 'What is your investment focus?' },
      answers: [
        {
          id: 'yield',
          label_i18n: { en: 'Rental income (yield)' },
          weights: {},
          next: 'inwestor_q3',
        },
        {
          id: 'vacation',
          label_i18n: { en: 'Vacation rental' },
          weights: { vacation_rental_investor: 1 },
          next: null,
        },
        {
          id: 'flip',
          label_i18n: { en: 'Flip / renovation' },
          weights: { flip_investor: 1 },
          next: null,
        },
        {
          id: 'commercial',
          label_i18n: { en: 'Commercial / portfolio' },
          weights: { commercial_investor: 1 },
          next: null,
        },
      ],
    },
    {
      id: 'inwestor_q3',
      prompt_i18n: { en: 'What is your target return?' },
      answers: [
        {
          id: 'steady',
          label_i18n: { en: 'Steady yield above market average' },
          weights: { yield_hunter: 1 },
          next: null,
        },
        {
          id: 'portfolio',
          label_i18n: { en: 'Long-term portfolio growth' },
          weights: { portfolio_builder: 1 },
          next: null,
        },
        {
          id: 'golden',
          label_i18n: { en: 'Golden visa / residency pathway' },
          weights: { golden_visa_buyer: 1 },
          next: null,
        },
      ],
    },
    {
      id: 'own_use_q2',
      prompt_i18n: { en: 'What describes your situation best?' },
      answers: [
        {
          id: 'first_time',
          label_i18n: { en: 'First-time buyer' },
          weights: { first_time_buyer: 1 },
          next: 'own_use_q3',
        },
        {
          id: 'family',
          label_i18n: { en: 'Growing family' },
          weights: { family_buyer: 1 },
          next: 'own_use_q3',
        },
        {
          id: 'upsize',
          label_i18n: { en: 'Upsizing' },
          weights: { upsizer: 1 },
          next: 'own_use_q3',
        },
        {
          id: 'downsize',
          label_i18n: { en: 'Downsizing' },
          weights: { downsizer: 1 },
          next: 'own_use_q3',
        },
      ],
    },
    {
      id: 'own_use_q3',
      prompt_i18n: { en: 'What matters most to you?' },
      answers: [
        { id: 'location', label_i18n: { en: 'Location and community' }, weights: {}, next: null },
        {
          id: 'luxury',
          label_i18n: { en: 'Luxury finishes and prestige' },
          weights: { luxury_buyer: 2 },
          next: null,
        },
        {
          id: 'remote',
          label_i18n: { en: 'Remote-work setup' },
          weights: { remote_worker: 2 },
          next: null,
        },
        { id: 'value', label_i18n: { en: 'Value for money' }, weights: {}, next: null },
      ],
    },
    {
      id: 'cross_border_q2',
      prompt_i18n: { en: 'Why are you buying abroad?' },
      answers: [
        {
          id: 'retiring',
          label_i18n: { en: 'Retiring or relocating' },
          weights: {},
          next: 'cross_border_q3',
        },
        {
          id: 'second_home',
          label_i18n: { en: 'Second / holiday home' },
          weights: { second_home_buyer: 1 },
          next: null,
        },
        {
          id: 'student',
          label_i18n: { en: 'Supporting a student' },
          weights: { student_parent: 1 },
          next: null,
        },
      ],
    },
    {
      id: 'cross_border_q3',
      prompt_i18n: { en: 'What is your primary goal?' },
      answers: [
        {
          id: 'settle',
          label_i18n: { en: 'Retire and settle permanently' },
          weights: { retiree_relocator: 1 },
          next: null,
        },
        {
          id: 'connected',
          label_i18n: { en: 'Stay connected to home country' },
          weights: { diaspora_buyer: 1 },
          next: null,
        },
        {
          id: 'lifestyle',
          label_i18n: { en: 'Lifestyle and travel base' },
          weights: { lifestyle_expat: 1 },
          next: null,
        },
      ],
    },
  ],
};

// ─── Pure walk helpers (shared by the renderer + tests) ─────────────────────────

/** Resolve an i18n label for a language, falling back to `'en'` then the first present value. */
export function resolveLabel(
  bag: Partial<Record<QuizLanguage, string>>,
  lang: QuizLanguage,
): string {
  return bag[lang] ?? bag.en ?? Object.values(bag)[0] ?? '';
}

/** Index a definition's questions by id. */
function indexQuestions(def: QuizDefinition): Map<string, QuizQuestion> {
  return new Map(def.questions.map((q) => [q.id, q]));
}

/**
 * Resolve the leaf archetype for a sequence of answer selections (by answer index per
 * question), walking `definition` from its root. Pure — used by the renderer's completion
 * path and by the parity tests. Empty / all-zero accumulation ⇒ `neutral`.
 */
export function resolveArchetypeFromPath(
  def: QuizDefinition,
  answerIndices: number[],
): QuizResolvedArchetype {
  const byId = indexQuestions(def);
  let currentId: string | null = def.root;
  const acc: Record<string, number> = {};
  for (const idx of answerIndices) {
    if (currentId === null) break;
    const q = byId.get(currentId);
    if (!q) break;
    const ans = q.answers[idx];
    if (!ans) break;
    for (const [archetypeId, weight] of Object.entries(ans.weights)) {
      acc[archetypeId] = (acc[archetypeId] ?? 0) + weight;
    }
    currentId = ans.next;
  }
  return reduceWeightsToArchetype(acc);
}

/** Longest number of remaining questions reachable from `qid` (for the progress indicator). */
function longestPathFrom(def: QuizDefinition, qid: string): number {
  const byId = indexQuestions(def);
  const memo = new Map<string, number>();
  const visit = (id: string, seen: ReadonlySet<string>): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const q = byId.get(id);
    if (!q || seen.has(id)) return 0;
    const nextSeen = new Set(seen).add(id);
    let best = 0;
    for (const ans of q.answers) {
      const remaining = ans.next === null ? 0 : visit(ans.next, nextSeen);
      if (remaining > best) best = remaining;
    }
    const total = 1 + best;
    memo.set(id, total);
    return total;
  };
  return visit(qid, new Set<string>());
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

/**
 * Render the definition-driven quiz widget into the given Shadow Root.
 * Returns a cleanup function.
 */
export function renderQuizWidget(
  shadowRoot: ShadowRoot,
  config: QuizWidgetConfig,
  onComplete: (resolvedArchetype: QuizResolvedArchetype) => void,
  onDismiss: () => void,
): () => void {
  try {
    const def = config.definition;
    const byId = indexQuestions(def);
    const chrome = CHROME_LABELS[config.language];

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
      .estalara-quiz-logo {
        display: block;
        max-height: 32px;
        max-width: 160px;
        margin: 0 auto 16px;
        object-fit: contain;
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
    // currentId:     the question currently shown (starts at the definition root).
    // answerPath:    the answer INDEX chosen at each visited question, in root→leaf order.
    //                The resolved archetype is `resolveArchetypeFromPath(def, answerPath)` — the
    //                SAME pure walk the parity tests assert, so the renderer and the tests share
    //                one reduction implementation (no drift).
    // selectedIndex: the answer highlighted on the CURRENT (non-root) question, or null.
    //
    // The root question navigates immediately on click (no CTA), matching the pre-ADR-0019
    // Q1 gate; non-root questions select then CTA-advance.
    let currentId: string = def.root;
    const answerPath: number[] = [];
    let selectedIndex: number | null = null;

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

    /** Record the selected answer and either advance to its `next` or complete at a leaf. */
    function applyAnswer(answerIndex: number): void {
      const q = byId.get(currentId);
      if (!q) return;
      const ans = q.answers[answerIndex];
      if (!ans) return;
      answerPath.push(answerIndex);
      if (ans.next === null || !byId.has(ans.next)) {
        cleanup();
        onComplete(resolveArchetypeFromPath(def, answerPath));
        return;
      }
      currentId = ans.next;
      selectedIndex = null;
      buildStep();
    }

    function buildStep(): void {
      const q = byId.get(currentId);
      if (!q) {
        // Malformed definition (should be impossible post-validation) — resolve from the path.
        cleanup();
        onComplete(resolveArchetypeFromPath(def, answerPath));
        return;
      }
      const isRoot = currentId === def.root;

      card.innerHTML = '';
      card.appendChild(closeBtn);

      // FOLLOW-623 / ADR-0019: brand logo atop the card when configured. Re-appended each step
      // because buildStep() clears the card. Absent/null → no logo (byte-identical).
      if (config.logoUrl) {
        const logo = document.createElement('img');
        logo.className = 'estalara-quiz-logo';
        logo.src = config.logoUrl;
        logo.alt = '';
        logo.setAttribute('aria-hidden', 'true');
        card.appendChild(logo);
      }

      const totalSteps = answerPath.length + longestPathFrom(def, currentId);
      const progress = document.createElement('div');
      progress.className = 'estalara-quiz-progress';
      progress.textContent = `${String(answerPath.length + 1)} / ${String(totalSteps)}`;
      card.appendChild(progress);

      const question = document.createElement('p');
      question.className = 'estalara-quiz-question';
      question.textContent = resolveLabel(q.prompt_i18n, config.language);
      card.appendChild(question);

      const answersDiv = document.createElement('div');
      answersDiv.className = 'estalara-quiz-answers';

      q.answers.forEach((ans, idx) => {
        const btn = document.createElement('button');
        btn.className = 'estalara-quiz-answer';
        if (!isRoot && selectedIndex === idx) {
          btn.classList.add('selected');
        }
        btn.textContent = resolveLabel(ans.label_i18n, config.language);
        btn.addEventListener('click', () => {
          if (isRoot) {
            // Root: navigate / complete immediately on click (matches the old Q1 gate).
            applyAnswer(idx);
          } else {
            selectedIndex = idx;
            buildStep();
          }
        });
        answersDiv.appendChild(btn);
      });
      card.appendChild(answersDiv);

      // Non-root questions show a CTA that advances/completes the selected answer.
      if (!isRoot) {
        const selectedAnswer = selectedIndex !== null ? q.answers[selectedIndex] : undefined;
        const isLeafSelected = selectedAnswer?.next === null;
        const cta = document.createElement('button');
        cta.className = 'estalara-quiz-cta';
        cta.textContent = isLeafSelected ? chrome.finish : chrome.next;
        cta.disabled = selectedIndex === null;
        cta.addEventListener('click', () => {
          if (selectedIndex !== null) applyAnswer(selectedIndex);
        });
        card.appendChild(cta);
      }

      const skip = document.createElement('button');
      skip.className = 'estalara-quiz-skip';
      skip.textContent = chrome.skip;
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
