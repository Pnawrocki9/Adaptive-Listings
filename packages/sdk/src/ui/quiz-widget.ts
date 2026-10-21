/**
 * Quiz widget v2 — definition-driven walk on the shared state machine, trait screen,
 * self-confirmation + one correction, EN | PL switcher, run pings (MASTER_DESIGN §E.4 v3.0,
 * FOLLOW-1357; walker history: FOLLOW-639 / ADR-0019 D5).
 *
 * The answer→archetype mapping lives in DATA — the tenant's served `QuizDefinition` (the SDK
 * ships no built-in tree since FOLLOW-1370: no served definition, no card). The widget asks
 * `nextStep` (`@estalara/shared` `quiz-walk.ts`, the ONE walker shared with the admin simulator)
 * what to show:
 *   - `question` — a `single` question (root: a click commits; otherwise select then CTA) or a
 *     `multi` trait screen (checkboxes, chrome "None of these" exclusive, CTA always enabled;
 *     always the last question, recorded as `number[]`);
 *   - `confirm`  — the result screen: "Based on your answers: **{name}** — {sentence}. Is that
 *     right?" with two equal buttons; "Not quite" offers the leaf's `alternatives` + "None of
 *     these — show me everything" (= `neutral`, `none_of_these`); exactly one correction; × or
 *     `pagehide` applies the leaf as `unconfirmed`;
 *   - `done`     — no confirmation (a `neutral` leaf, or no `confirm` texts for the leaf — e.g.
 *     an old served row): the run stays `completed`.
 *
 * Classes the FOLLOW-819 harness relies on: answers (single and trait options) are
 * `.estalara-quiz-answer`; the result screen is `.estalara-quiz-result` with
 * `.estalara-quiz-confirm` / `.estalara-quiz-reject` / `.estalara-quiz-option` — never
 * `.estalara-quiz-answer`, which the harness loop clicks.
 *
 * `onComplete(leaf, path, outcome)` fires ONCE per run, after the confirmation is resolved
 * (ESC-086 item 4). `config.onRunEvent` receives every run transition (`shown`, `dismissed`,
 * `completed`, `confirmed`, `corrected`, `unconfirmed`) for `POST /api/quiz/run`.
 *
 * @module @estalara/sdk/ui/quiz-widget
 */

import type {
  CanonicalArchetypeId,
  QuizDefinition,
  QuizLanguage,
  QuizPathStep,
  TraitId,
  WidgetPlacement,
} from '@estalara/shared';
import {
  DEFAULT_QUIZ_PLACEMENT,
  QUIZ_RUN_MAX_MS,
  longestPathFrom,
  nextStep,
  resolveArchetypeFromPath,
  resolveLabel,
} from '@estalara/shared';

import type { Archetype } from '../core/intent.js';
import { quizAnswerSteps } from '../core/adapt.js';
import type { QuizAnswerPath, QuizRunPingFields } from '../core/adapt.js';
import { placementToCss } from './placement.js';
import { readQuizLanguage, writeQuizLanguage } from './quiz-session-state.js';

/** A resolved leaf archetype (a canonical non-neutral archetype, or 'neutral'). */
export type QuizResolvedArchetype = Archetype;

/**
 * How the buyer answered the result screen (ESC-086 item 4); `null` = no confirmation step was
 * offered (a `neutral` leaf, or a definition without `confirm` texts for the leaf).
 */
type QuizConfirmation = 'confirmed' | 'corrected' | 'unconfirmed' | 'none_of_these';

/** The third `onComplete` argument (ESC-086 item 4) [FOLLOW-1357]. */
export interface QuizRunOutcome {
  confirmation: QuizConfirmation | null;
  /** The archetype to apply: the leaf, the chosen alternative, or `neutral` ("None of these"). */
  final_archetype: QuizResolvedArchetype;
  /** Traits the walk recorded, canonical order. */
  traits: TraitId[];
  quiz_run_id: string;
  definition_hash: string;
  /** The active quiz language at the end of the run (the switcher wins over `quiz_config`). */
  language: QuizLanguage;
}

export interface QuizWidgetConfig {
  accentColor: string;
  /** `quiz_config.language`; a buyer's EN | PL switcher choice (sessionStorage) overrides it. */
  language: QuizLanguage;
  /**
   * The quiz tree to walk — the tenant's served `quiz_definition` slice (ADR-0019 D5). The SDK
   * has no built-in tree: no served definition → no card (FOLLOW-1370).
   */
  definition: QuizDefinition;
  /**
   * Forwarded public-config `definition_hash` of the served definition; absent → `'unhashed'`
   * (the SDK never hashes, ESC-086 item 3) [FOLLOW-1357].
   */
  definitionHash?: string | undefined;
  /** Forwarded public-config `definition_version`; absent → `null` [FOLLOW-1357]. */
  definitionVersion?: number | null | undefined;
  /** Receives every run transition (`POST /api/quiz/run`); absent → nothing is reported. */
  onRunEvent?: (ping: QuizRunPingFields) => void;
  /**
   * Tenant brand logo URL shown atop the quiz card (FOLLOW-623 / ADR-0019).
   *
   * `string | null`, never `undefined` (ADR-0019 D-nullability). `null` (or omitted) renders
   * no logo — byte-identical to pre-ADR-0019.
   */
  logoUrl?: string | null;
  /**
   * Whether to render the discreet "Powered by Estalara" attribution in the card footer
   * (FOLLOW-651). Defaults to `true`; the caller passes `false` when `brand.white_label ===
   * true`. First real consumer of the brand `white_label` flag (RETRO-214 HALF_WIRE_P).
   */
  showAttribution?: boolean;
  /**
   * Where the card is anchored (FOLLOW-640 / ADR-0019 D2). Absent → `DEFAULT_QUIZ_PLACEMENT`
   * (bottom-left 24/96, which clears the opt-out toggle beneath it).
   */
  placement?: WidgetPlacement;
}

// ─── UI chrome i18n (question/answer/confirmation texts live in the definition) ──

/**
 * Widget CHROME labels — the non-content strings not carried by the definition (the trait
 * screen's "None of these", the confirmation template and buttons, the correction texts —
 * `quiz-default-v2.ts` module doc). EN / PL / ES so a served definition gets localised chrome.
 */
const CHROME_LABELS: Record<
  QuizLanguage,
  {
    next: string;
    finish: string;
    skip: string;
    intro: string;
    cont: string;
    none: string;
    basedOn: string;
    isRight: string;
    yes: string;
    no: string;
    which: string;
    noneAll: string;
  }
> = {
  en: {
    next: '→',
    finish: 'Find my match',
    skip: 'Skip',
    intro: "Answer a few quick questions so we can show you listings that fit what you're after.",
    cont: 'Continue',
    none: 'None of these',
    basedOn: 'Based on your answers:',
    isRight: 'Is that right?',
    yes: "Yes, that's me",
    no: 'Not quite',
    which: 'Which fits you better?',
    noneAll: 'None of these — show me everything',
  },
  pl: {
    next: '→',
    finish: 'Znajdź dopasowanie',
    skip: 'Pomiń',
    intro:
      'Odpowiedz na kilka krótkich pytań, żebyśmy mogli pokazywać Ci oferty dopasowane do tego, czego szukasz.',
    cont: 'Dalej',
    none: 'Żadne z powyższych',
    basedOn: 'Na podstawie Twoich odpowiedzi:',
    isRight: 'Zgadza się?',
    yes: 'Tak, to ja',
    no: 'Nie do końca',
    which: 'Co pasuje lepiej?',
    noneAll: 'Żadne — pokaż wszystkie oferty',
  },
  es: {
    next: '→',
    finish: 'Encontrar mi opción',
    skip: 'Omitir',
    intro:
      'Responde unas preguntas rápidas para que podamos mostrarte propiedades que encajen con lo que buscas.',
    cont: 'Continuar',
    none: 'Ninguna de estas',
    basedOn: 'Según tus respuestas:',
    isRight: '¿Es correcto?',
    yes: 'Sí, soy yo',
    no: 'No exactamente',
    which: '¿Cuál encaja mejor contigo?',
    noneAll: 'Ninguna — muéstrame todo',
  },
};

// ─── Pure walk helpers (moved to @estalara/shared — FOLLOW-1356) ────────────────

/**
 * `resolveLabel` and `resolveArchetypeFromPath` live in `@estalara/shared`
 * (`schemas/quiz-walk.ts`). Re-exported under the same names so existing importers keep working.
 */
export { resolveArchetypeFromPath, resolveLabel };

/** A random v4 uuid: `crypto.randomUUID`, else a `Math.random` fallback in the same format. */
function newQuizRunId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
      (+c ^ ((Math.random() * 16) & (15 >> (+c / 4)))).toString(16),
    );
  }
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

/**
 * Render the definition-driven quiz widget into the given Shadow Root.
 *
 * @param onComplete - Called once at the end of the run: the walk's leaf, the walked path and
 *   the outcome (confirmation, final archetype, traits, run id, definition hash).
 * @param onDismiss - Called on Skip / × before the leaf.
 * @returns A cleanup function.
 */
export function renderQuizWidget(
  shadowRoot: ShadowRoot,
  config: QuizWidgetConfig,
  onComplete: (
    resolvedArchetype: QuizResolvedArchetype,
    path: QuizAnswerPath,
    outcome: QuizRunOutcome,
  ) => void,
  onDismiss: () => void,
): () => void {
  try {
    const def = config.definition;
    const confirm = def.confirm;
    const byId = new Map(def.questions.map((q) => [q.id, q]));
    const hash = config.definitionHash ?? 'unhashed';
    const runId = newQuizRunId();
    // The switcher lists the definition's languages that carry texts (CEO ruling Q-D).
    const langs = def.languages.filter((l) => byId.get(def.root)?.prompt_i18n[l]);
    const stored = readQuizLanguage();
    let lang: QuizLanguage = langs.find((l) => l === stored) ?? config.language;
    const text = (bag: Partial<Record<QuizLanguage, string>> | undefined): string =>
      bag ? resolveLabel(bag, lang) : '';

    const style = document.createElement('style');
    // Minified on purpose: a template literal ships verbatim (indentation and comments included)
    // and the gzip budget is tight (ESC-080) [FOLLOW-1357]. FOLLOW-1015: the overlay is
    // corner-anchored and sized to the card - deliberately NOT a full-viewport dimming scrim, which
    // would freeze the tenant's page on every load now that the card opens on its own. The intro
    // line explains the auto-opened card. The confirm / reject / option buttons share the answer
    // look, so the two result buttons carry equal visual weight (MASTER_DESIGN §E.4.2).
    const accent = config.accentColor;
    const choice =
      '.estalara-quiz-answer,.estalara-quiz-confirm,.estalara-quiz-reject,.estalara-quiz-option';
    style.textContent =
      `.estalara-quiz-overlay{position:fixed;${placementToCss(config.placement ?? DEFAULT_QUIZ_PLACEMENT)};width:min(400px,calc(100vw - 32px));z-index:2147483647;pointer-events:auto}` +
      '.estalara-quiz-card{background:#fff;border-radius:16px;padding:28px 24px 24px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.22);position:relative}' +
      '.estalara-quiz-close{position:absolute;top:12px;right:16px;background:0 0;border:none;font-size:20px;cursor:pointer;color:#6b7280;line-height:1}' +
      '.estalara-quiz-lang{position:absolute;top:10px;left:16px}' +
      '.estalara-quiz-lang button{background:0 0;border:none;padding:2px 4px;font-size:12px;cursor:pointer;color:#9ca3af}' +
      '.estalara-quiz-lang [aria-pressed=true]{color:#111827;font-weight:600}' +
      '.estalara-quiz-logo{display:block;max-height:32px;max-width:160px;margin:0 auto 16px;object-fit:contain}' +
      '.estalara-quiz-intro{font-size:14px;line-height:1.5;color:#4b5563;margin:0 0 14px}' +
      '.estalara-quiz-question{font-size:16px;font-weight:600;color:#111827;margin:0 0 16px}' +
      '.estalara-quiz-result{font-weight:400;line-height:1.5}' +
      '.estalara-quiz-answers{display:flex;flex-direction:column;gap:10px;margin-bottom:20px}' +
      `${choice}{padding:12px 16px;border:2px solid #e5e7eb;border-radius:10px;background:#fff;font-size:14px;text-align:left;cursor:pointer;transition:border-color .15s,background .15s;color:#374151}` +
      `${choice.replace(/,|$/g, ':hover,')}.estalara-quiz-answer.selected{border-color:${accent};background:#f0f4ff}` +
      ".estalara-quiz-answer[role=checkbox]::before{content:'\\2610  '}" +
      ".estalara-quiz-answer[aria-checked=true]::before{content:'\\2611  '}" +
      `.estalara-quiz-cta{width:100%;padding:12px;background:${accent};color:#fff;border:none;border-radius:9999px;font-size:15px;font-weight:600;cursor:pointer;opacity:.5;transition:opacity .15s}` +
      '.estalara-quiz-cta:enabled{opacity:1}' +
      '.estalara-quiz-skip{display:block;margin:12px auto 0;background:0 0;border:none;color:#9ca3af;font-size:13px;cursor:pointer;text-decoration:underline}' +
      '.estalara-quiz-progress{font-size:12px;color:#9ca3af;margin-bottom:12px}' +
      '.estalara-quiz-attribution{display:block;margin:14px auto 0;text-align:center;font-size:10px;color:#b0b4bd;letter-spacing:.02em}';
    shadowRoot.appendChild(style);

    // ── State ──────────────────────────────────────────────────────────────────
    //
    // path / questionPath: the selections and the question each was made on, root→leaf, pushed
    //   together so they cannot drift (FOLLOW-1020). `nextStep(def, { path })` decides what
    //   comes next — the same pure walk the shared tests and the admin simulator use.
    // stepMs: ms on each committed step (rounded to 100, capped); stepAt: when the current
    //   question was first shown (a re-render for a selection or a language switch keeps it).
    // selected / ticks / none: the pending selection on the current single / multi question.
    // resultAt: when the result screen was first shown (0 = not shown).
    let currentId: string = def.root;
    const path: QuizPathStep[] = [];
    const questionPath: string[] = [];
    const stepMs: number[] = [];
    let stepAt = Date.now();
    let selected: number | null = null;
    let ticks: number[] = [];
    let none = false;
    let resultAt = 0;
    let leaf: QuizResolvedArchetype = 'neutral';
    let traits: TraitId[] = [];
    let offered: CanonicalArchetypeId[] | undefined;
    let ended = false;
    let screen: () => void = renderQuestion;

    const overlay = document.createElement('div');
    overlay.className = 'estalara-quiz-overlay';
    const card = document.createElement('div');
    card.className = 'estalara-quiz-card';

    function el<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      cls: string,
      content?: string,
    ): HTMLElementTagNameMap[K] {
      const node = document.createElement(tag);
      node.className = cls;
      if (content !== undefined) node.textContent = content;
      return node;
    }
    function button(cls: string, content: string, onClick: () => void): HTMLButtonElement {
      const btn = el('button', cls, content);
      btn.addEventListener('click', onClick);
      return btn;
    }
    const ms = (since: number): number =>
      Math.min(QUIZ_RUN_MAX_MS, Math.round((Date.now() - since) / 100) * 100);
    const walked = (): QuizAnswerPath => ({
      question_ids: [...questionPath],
      answer_indexes: path.map((s) => (Array.isArray(s) ? [...s] : s)),
    });
    function ping(
      event: QuizRunPingFields['event'],
      fields: Partial<QuizRunPingFields> = {},
    ): void {
      config.onRunEvent?.({
        quiz_run_id: runId,
        event,
        language: lang,
        definition_hash: hash,
        definition_version: config.definitionVersion ?? null,
        ...fields,
      });
    }

    const closeBtn = button('estalara-quiz-close', '×', () => {
      if (resultAt) resolve('unconfirmed', null, leaf);
      else dismiss();
    });
    closeBtn.setAttribute('aria-label', 'Close');

    function dismiss(): void {
      if (ended) return;
      ended = true;
      ping('dismissed', { last_step: path.length });
      cleanup();
      onDismiss();
    }

    function finish(confirmation: QuizConfirmation | null, final: QuizResolvedArchetype): void {
      if (ended) return;
      ended = true;
      cleanup();
      onComplete(leaf, walked(), {
        confirmation,
        final_archetype: final,
        traits,
        quiz_run_id: runId,
        definition_hash: hash,
        language: lang,
      });
    }

    /** Close the result screen: one ping, then `onComplete` (idempotent via `ended`). */
    function resolve(
      event: 'confirmed' | 'corrected' | 'unconfirmed',
      confirmed: QuizRunPingFields['confirmed_archetype'] | null,
      final: QuizResolvedArchetype,
    ): void {
      if (ended) return;
      ping(event, {
        resolved_archetype: leaf,
        result_ms: ms(resultAt),
        ...(offered ? { offered } : {}),
        ...(confirmed ? { confirmed_archetype: confirmed } : {}),
      });
      finish(confirmed === 'none_of_these' ? 'none_of_these' : event, final);
    }

    // × is not the only way off the result screen: navigating away resolves it too.
    const onPageHide = (): void => {
      if (resultAt) resolve('unconfirmed', null, leaf);
    };

    function commit(step: QuizPathStep): void {
      path.push(step);
      questionPath.push(currentId);
      stepMs.push(ms(stepAt));
      stepAt = Date.now();
      selected = null;
      ticks = [];
      none = false;
      advance();
    }

    function advance(): void {
      const ns = nextStep(def, { path });
      if (ns.kind === 'question') {
        currentId = ns.questionId;
        screen = renderQuestion;
        screen();
        return;
      }
      leaf = ns.leaf;
      traits = ns.traits;
      ping('completed', {
        resolved_archetype: leaf,
        ...(path.length ? { answer_path: quizAnswerSteps(walked()) } : {}),
        traits,
        step_ms: [...stepMs],
      });
      if (ns.kind === 'confirm') {
        resultAt = Date.now();
        screen = renderResult;
        screen();
      } else {
        finish(null, leaf);
      }
    }

    /** Close button, EN | PL switcher and logo — the top of every screen. */
    function head(): void {
      card.innerHTML = '';
      card.appendChild(closeBtn);
      if (langs.length > 1) {
        const switcher = el('div', 'estalara-quiz-lang');
        for (const l of langs) {
          const b = button('', l.toUpperCase(), () => {
            lang = l;
            writeQuizLanguage(l);
            screen();
          });
          b.setAttribute('aria-pressed', String(l === lang));
          switcher.appendChild(b);
        }
        card.appendChild(switcher);
      }
      // FOLLOW-623 / ADR-0019: brand logo atop the card when configured.
      if (config.logoUrl) {
        const logo = el('img', 'estalara-quiz-logo');
        logo.src = config.logoUrl;
        logo.alt = '';
        logo.setAttribute('aria-hidden', 'true');
        card.appendChild(logo);
      }
    }

    /** FOLLOW-651: "Powered by Estalara" unless white-label. */
    function attribution(): void {
      if (config.showAttribution !== false) {
        card.appendChild(el('div', 'estalara-quiz-attribution', 'Powered by Estalara'));
      }
    }

    function renderQuestion(): void {
      const q = byId.get(currentId);
      if (!q) return; // nextStep only names questions that exist
      const chrome = CHROME_LABELS[lang];
      const multi = q.kind === 'multi';
      const isRoot = currentId === def.root;
      head();

      // The progress counter counts questions only — the confirmation is not a step.
      card.appendChild(
        el(
          'div',
          'estalara-quiz-progress',
          `${String(path.length + 1)} / ${String(path.length + longestPathFrom(def, currentId))}`,
        ),
      );
      // FOLLOW-1015: intro line on the first step only (the card opened on its own).
      if (isRoot) card.appendChild(el('p', 'estalara-quiz-intro', chrome.intro));
      card.appendChild(el('p', 'estalara-quiz-question', text(q.prompt_i18n)));

      const answers = el('div', 'estalara-quiz-answers');
      const option = (label: string, on: boolean, onClick: () => void): void => {
        const btn = button(
          on ? 'estalara-quiz-answer selected' : 'estalara-quiz-answer',
          label,
          onClick,
        );
        if (multi) {
          btn.setAttribute('role', 'checkbox');
          btn.setAttribute('aria-checked', String(on));
        }
        answers.appendChild(btn);
      };
      q.answers.forEach((ans, idx) => {
        const on = multi ? ticks.includes(idx) : selected === idx;
        option(text(ans.label_i18n), on, () => {
          if (multi) {
            // a trait tick clears the exclusive "None of these"
            none = false;
            ticks = on ? ticks.filter((i) => i !== idx) : [...ticks, idx];
          } else if (isRoot) {
            // Root: commit immediately on click (the original Q1 gate).
            commit(idx);
            return;
          } else {
            selected = idx;
          }
          renderQuestion();
        });
      });
      // The trait screen's exclusive "None of these" is chrome, not part of the definition.
      if (multi) {
        option(chrome.none, none, () => {
          none = !none;
          ticks = [];
          renderQuestion();
        });
      }
      card.appendChild(answers);

      // Non-root single questions and trait screens commit through the CTA; a trait screen's
      // CTA is always enabled (the screen is optional).
      if (multi || !isRoot) {
        const pick = selected === null ? undefined : q.answers[selected];
        const cta = button(
          'estalara-quiz-cta',
          multi ? chrome.cont : pick?.next === null ? chrome.finish : chrome.next,
          () => {
            if (multi) commit([...ticks].sort((a, b) => a - b));
            else if (selected !== null) commit(selected);
          },
        );
        cta.disabled = !multi && selected === null;
        card.appendChild(cta);
      }

      card.appendChild(button('estalara-quiz-skip', chrome.skip, dismiss));
      attribution();
    }

    function renderResult(): void {
      const chrome = CHROME_LABELS[lang];
      head();
      const p = el('p', 'estalara-quiz-question estalara-quiz-result');
      p.append(
        `${chrome.basedOn} `,
        el('strong', '', text(confirm?.names_i18n[leaf])),
        ` — ${text(confirm?.sentences_i18n[leaf])}. ${chrome.isRight}`,
      );
      card.appendChild(p);
      const choices = el('div', 'estalara-quiz-answers');
      choices.append(
        button('estalara-quiz-confirm', chrome.yes, () => {
          resolve('confirmed', leaf, leaf);
        }),
        button('estalara-quiz-reject', chrome.no, () => {
          screen = renderCorrection;
          screen();
        }),
      );
      card.appendChild(choices);
      attribution();
    }

    function renderCorrection(): void {
      const chrome = CHROME_LABELS[lang];
      head();
      card.appendChild(el('p', 'estalara-quiz-question estalara-quiz-result', chrome.which));
      // The alternatives are canonical ids (serve-schema guardrail 5).
      offered = (confirm?.alternatives[leaf] ?? []).filter(
        (a) => confirm?.names_i18n[a],
      ) as CanonicalArchetypeId[];
      const options = el('div', 'estalara-quiz-answers');
      for (const alt of offered) {
        options.appendChild(
          button('estalara-quiz-option', text(confirm?.names_i18n[alt]), () => {
            resolve('corrected', alt, alt);
          }),
        );
      }
      options.appendChild(
        button('estalara-quiz-option', chrome.noneAll, () => {
          resolve('corrected', 'none_of_these', 'neutral');
        }),
      );
      card.appendChild(options);
      attribution();
    }

    overlay.appendChild(card);
    shadowRoot.appendChild(overlay);
    window.addEventListener('pagehide', onPageHide);
    ping('shown');
    advance();

    function cleanup(): void {
      window.removeEventListener('pagehide', onPageHide);
      overlay.remove();
      style.remove();
    }

    return cleanup;
  } catch {
    return () => {
      // nothing to clean up
    };
  }
}
