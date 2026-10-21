/**
 * FOLLOW-1372 — accessibility of the quiz card, on the REAL `renderQuizWidget` (jsdom shadow root):
 *   - a non-modal dialog (`role="dialog"`) named by the current question / result text;
 *   - the EN | PL switch: real buttons with `aria-pressed`, keyboard focus kept on the switch
 *     after it re-renders the card (and on an answer after a selection);
 *   - Escape = × on every step: `dismissed` before the result screen, `unconfirmed` on it;
 *   - touch targets ≥ 44 px and text contrast ≥ 4.5:1 in the shipped stylesheet (the rendered
 *     sizes are measured in a real browser by `e2e/quiz-card.spec.ts`).
 *
 * @module packages/sdk/src/__tests__/follow-1372.test
 */

// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_QUIZ_DEFINITION_V2 } from '@estalara/shared';

import type { QuizRunPingFields } from '../core/adapt.js';
import { renderQuizWidget } from '../ui/quiz-widget.js';

interface Harness {
  root: ShadowRoot;
  pings: QuizRunPingFields[];
  completed: number;
  dismissed: number;
}

function mount(): Harness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const h: Harness = { root, pings: [], completed: 0, dismissed: 0 };
  renderQuizWidget(
    root,
    {
      accentColor: '#000',
      language: 'en',
      definition: DEFAULT_QUIZ_DEFINITION_V2,
      definitionHash: 'f'.repeat(64),
      onRunEvent: (p) => h.pings.push(p),
    },
    () => {
      h.completed += 1;
    },
    () => {
      h.dismissed += 1;
    },
  );
  return h;
}

const card = (h: Harness): HTMLElement => {
  const el = h.root.querySelector<HTMLElement>('.estalara-quiz-card');
  if (!el) throw new Error('no card');
  return el;
};
const all = (h: Harness, sel: string): HTMLElement[] => [
  ...h.root.querySelectorAll<HTMLElement>(sel),
];
const one = (h: Harness, sel: string): HTMLElement => {
  const el = h.root.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`${sel} not found`);
  return el;
};
const escape = (target: HTMLElement): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
};

/** Walk main_here → first → no traits: the result screen of the served tree. */
function toResult(h: Harness): void {
  all(h, '.estalara-quiz-answer')[0]?.click();
  all(h, '.estalara-quiz-answer')[0]?.click();
  h.root.querySelector<HTMLElement>('.estalara-quiz-cta')?.click();
  h.root.querySelector<HTMLElement>('.estalara-quiz-cta')?.click();
  expect(h.root.querySelector('.estalara-quiz-result')).not.toBeNull();
}

/** The accessible name a `role=dialog` with `aria-labelledby` gets. */
function dialogName(h: Harness): string {
  const ids = card(h).getAttribute('aria-labelledby') ?? '';
  return ids
    .split(' ')
    .map((id) => h.root.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
}

beforeEach(() => {
  sessionStorage.clear();
  document.body.innerHTML = '';
});

describe('FOLLOW-1372 a non-modal dialog, named by the step', () => {
  it('role="dialog", not modal, named by the question; still named after a step', () => {
    const h = mount();
    expect(card(h).getAttribute('role')).toBe('dialog');
    expect(card(h).getAttribute('aria-modal')).toBeNull();
    expect(dialogName(h)).toBe('What will this property be for?');
    all(h, '.estalara-quiz-answer')[0]?.click();
    expect(dialogName(h)).toBe(h.root.querySelector('.estalara-quiz-question')?.textContent);
    expect(dialogName(h)).not.toBe('');
  });

  it('on the result screen the dialog is named by the result question', () => {
    const h = mount();
    toResult(h);
    expect(dialogName(h)).toContain('Is that right?');
  });
});

describe('FOLLOW-1372 EN | PL switch — real buttons, keyboard focus kept', () => {
  it('the switch is two buttons with aria-pressed, in a labelled group', () => {
    const h = mount();
    const group = h.root.querySelector('.estalara-quiz-lang');
    expect(group?.getAttribute('role')).toBe('group');
    expect(group?.getAttribute('aria-label')).toBeTruthy();
    const langs = all(h, '.estalara-quiz-lang button');
    expect(langs.map((b) => b.tagName)).toEqual(['BUTTON', 'BUTTON']);
    expect(langs.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
  });

  it('activating PL with the keyboard keeps focus on the (re-rendered) PL button', () => {
    const h = mount();
    const pl = all(h, '.estalara-quiz-lang button')[1];
    pl?.focus();
    expect(h.root.activeElement).toBe(pl);
    pl?.click(); // Enter / Space on a <button> dispatch click
    const now = all(h, '.estalara-quiz-lang button')[1];
    expect(now?.getAttribute('aria-pressed')).toBe('true');
    expect(h.root.activeElement).toBe(now);
  });

  it('selecting an answer from the keyboard keeps focus on that answer', () => {
    const h = mount();
    all(h, '.estalara-quiz-answer')[0]?.click(); // root commits → q_home
    const second = all(h, '.estalara-quiz-answer')[1];
    second?.focus();
    second?.click();
    const after = all(h, '.estalara-quiz-answer')[1];
    expect(after?.classList.contains('selected')).toBe(true);
    expect(h.root.activeElement).toBe(after);
  });

  it('a re-render never takes focus that was outside the card', () => {
    const h = mount();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    all(h, '.estalara-quiz-lang button')[1]?.click();
    expect(document.activeElement).toBe(outside);
  });
});

describe('FOLLOW-1372 Escape = × on every step', () => {
  it('on a question: Escape dismisses exactly like ×', () => {
    const h = mount();
    escape(one(h, '.estalara-quiz-answer'));
    expect(h.dismissed).toBe(1);
    expect(h.pings.map((p) => p.event)).toEqual(['shown', 'dismissed']);
    expect(h.root.querySelector('.estalara-quiz-card')).toBeNull();
  });

  it('on the result screen: Escape resolves `unconfirmed` exactly like ×', () => {
    const h = mount();
    toResult(h);
    escape(one(h, '.estalara-quiz-confirm'));
    expect(h.completed).toBe(1);
    expect(h.dismissed).toBe(0);
    expect(h.pings.map((p) => p.event)).toEqual(['shown', 'completed', 'unconfirmed']);
  });

  it('other keys do nothing', () => {
    const h = mount();
    card(h).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(h.dismissed).toBe(0);
    expect(h.root.querySelector('.estalara-quiz-card')).not.toBeNull();
  });
});

describe('FOLLOW-1372 stylesheet: touch targets and contrast', () => {
  const css = (): string => {
    const h = mount();
    return h.root.querySelector('style')?.textContent ?? '';
  };
  /** The declarations of every rule whose selector list names `sel`, in source order. */
  const rule = (text: string, sel: string): string =>
    [...text.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => (m[1] ?? '').split(',').some((s) => s.trim() === sel))
      .map((m) => m[2] ?? '')
      .join(';');

  it.each([
    '.estalara-quiz-answer',
    '.estalara-quiz-confirm',
    '.estalara-quiz-reject',
    '.estalara-quiz-option',
    '.estalara-quiz-close',
    '.estalara-quiz-lang button',
  ])('%s is at least 44 px tall', (sel) => {
    expect(rule(css(), sel)).toMatch(/min-height:44px/);
  });

  it.each(['.estalara-quiz-close', '.estalara-quiz-lang button'])(
    '%s is at least 44 px wide',
    (sel) => {
      expect(rule(css(), sel)).toMatch(/min-width:44px/);
    },
  );

  /** WCAG relative-luminance contrast of `#rrggbb` on white. */
  const onWhite = (hex: string): number => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const l = 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    return 1.05 / (l + 0.05);
  };

  it.each([
    '.estalara-quiz-skip',
    '.estalara-quiz-progress',
    '.estalara-quiz-attribution',
    '.estalara-quiz-lang button',
  ])('%s text is ≥ 4.5:1 on the white card', (sel) => {
    const color = /(?:^|;)color:(#[0-9a-f]{6})/i.exec(rule(css(), sel))?.[1];
    expect(color).toBeDefined();
    expect(onWhite(color ?? '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});
