/**
 * FOLLOW-1357 — quiz widget v2: trait screen, confirmation + one correction, EN | PL switcher,
 * run identity, timings and the `POST /api/quiz/run` pings.
 *
 * Drives the REAL `renderQuizWidget` in a real (jsdom) shadow root with the served EN + PL
 * default (`DEFAULT_QUIZ_DEFINITION_V2`, which carries `confirm`) and the SDK built-in (which
 * does not), and the REAL `postQuizRunPing`. Every ping the widget reports is validated with the
 * shared `QuizRunPingSchema` that package Q3 (FOLLOW-1358) parses.
 *
 * @module packages/sdk/src/__tests__/follow-1357.test
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuizDefinition } from '@estalara/shared';
import {
  DEFAULT_QUIZ_DEFINITION_V2,
  IntentSnapshotPayloadSchema,
  QuizEventPayloadSchema,
  QuizRunPingSchema,
} from '@estalara/shared';

import { postQuizCompletionPing, postQuizRunPing } from '../core/adapt.js';
import type { QuizAnswerPath, QuizRunPingFields } from '../core/adapt.js';
import type { SdkConfig } from '../core/config.js';
import { emitIntentSnapshot } from '../core/intent-snapshot.js';
import { applyQuizLeaf, initIntentState } from '../core/intent.js';
import type { CollectedEvent } from '../core/events.js';
import { eraseCachedQuizConfig } from '../core/quiz-config.js';
import { QUIZ_LANGUAGE_STORAGE_KEY } from '../ui/quiz-session-state.js';
import {
  BUILTIN_QUIZ_DEFINITION_HASH,
  DEFAULT_QUIZ_DEFINITION,
  newQuizRunId,
  renderQuizWidget,
} from '../ui/quiz-widget.js';
import type { QuizResolvedArchetype, QuizRunOutcome, QuizWidgetConfig } from '../ui/quiz-widget.js';

const SESSION_ID = 'a'.repeat(64);
const HASH = 'f'.repeat(64);

const SDK_CONFIG: SdkConfig = {
  apiKey: 'test-follow1357-api-key',
  ingestUrl: 'https://ingest.estalara.com/v1/events',
  debug: false,
  consentState: 'legitimate_interest',
  language: 'en',
  accentColor: '#6c5ce7',
  decisionApiUrl: 'https://api.example.com/api',
  tenantId: '550e8400-e29b-41d4-a716-446655440000',
};

interface Harness {
  root: ShadowRoot;
  pings: QuizRunPingFields[];
  completed: [QuizResolvedArchetype, QuizAnswerPath, QuizRunOutcome][];
  dismissed: number;
  cleanup: () => void;
}

function mount(
  definition: QuizDefinition = DEFAULT_QUIZ_DEFINITION_V2,
  extra: Partial<QuizWidgetConfig> = {},
): Harness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const h: Harness = { root, pings: [], completed: [], dismissed: 0, cleanup: () => undefined };
  h.cleanup = renderQuizWidget(
    root,
    {
      accentColor: '#000',
      language: 'en',
      definition,
      definitionHash: HASH,
      definitionVersion: 4,
      onRunEvent: (p) => h.pings.push(p),
      ...extra,
    },
    (leaf, path, outcome) => h.completed.push([leaf, path, outcome]),
    () => {
      h.dismissed += 1;
    },
  );
  return h;
}

const q = (h: Harness, sel: string): HTMLElement[] => [
  ...h.root.querySelectorAll<HTMLElement>(sel),
];
const answers = (h: Harness): HTMLElement[] => q(h, '.estalara-quiz-answer');
const question = (h: Harness): string =>
  h.root.querySelector('.estalara-quiz-question')?.textContent ?? '';
const cta = (h: Harness): HTMLButtonElement | null =>
  h.root.querySelector<HTMLButtonElement>('.estalara-quiz-cta');
const click = (el: HTMLElement | null | undefined): void => {
  if (!el) throw new Error('element not found');
  el.click();
};

/** Root answer `root`, then (optionally) a second single answer, then the trait screen ticks. */
function walk(h: Harness, rootIdx: number, second: number | null, ticks: number[]): void {
  click(answers(h)[rootIdx]);
  if (second !== null) {
    click(answers(h)[second]);
    click(cta(h));
  }
  for (const t of ticks) click(answers(h)[t]);
  click(cta(h));
}

/** A ping as the caller would send it, validated against the Q3 schema. */
function parsePing(p: QuizRunPingFields | undefined): ReturnType<typeof QuizRunPingSchema.parse> {
  if (!p) throw new Error('no such ping');
  return QuizRunPingSchema.parse({
    ...p,
    tenant_id: SDK_CONFIG.tenantId,
    session_id: SESSION_ID,
    sdk_version: '0.0.0',
  });
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('trait (multi) step', () => {
  it('renders checkboxes plus an exclusive chrome "None of these"; the CTA is always enabled', () => {
    const h = mount();
    click(answers(h)[0]); // main_here → q_home
    click(answers(h)[0]); // first
    click(cta(h)); // → t_home
    const opts = answers(h);
    expect(opts.map((o) => o.textContent)).toEqual([
      'Children will live with me',
      "I'll work from home 2+ days a week",
      "I'm looking at the top end of the market",
      'None of these',
    ]);
    expect(opts.every((o) => o.getAttribute('role') === 'checkbox')).toBe(true);
    expect(cta(h)?.disabled).toBe(false);
    expect(cta(h)?.textContent).toBe('Continue');

    click(answers(h)[0]);
    click(answers(h)[2]);
    expect(answers(h).map((o) => o.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'true',
      'false',
    ]);
    click(answers(h)[3]); // None of these — clears the ticks
    expect(answers(h).map((o) => o.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'false',
      'true',
    ]);
    click(answers(h)[1]); // a trait tick clears "None of these"
    expect(answers(h).map((o) => o.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);
  });

  it('records number[] for the trait step and ends the walk (no confirm → done at once)', () => {
    const h = mount(DEFAULT_QUIZ_DEFINITION);
    walk(h, 0, 1, [2, 0]); // main_here → up → premium + children
    expect(h.completed).toHaveLength(1);
    const [leaf, path, outcome] = h.completed[0] ?? [];
    expect(leaf).toBe('family_buyer');
    expect(path).toEqual({
      question_ids: ['q_purpose', 'q_home', 't_home'],
      answer_indexes: [0, 1, [0, 2]],
    });
    expect(outcome?.traits).toEqual(['premium', 'has_children']);
    expect(outcome?.confirmation).toBeNull();
    expect(h.root.querySelector('.estalara-quiz-card')).toBeNull();
  });

  it('"None of these" records an empty selection', () => {
    const h = mount(DEFAULT_QUIZ_DEFINITION);
    walk(h, 2, null, [5]); // second → t_second → None (index 5 = chrome option)
    const [leaf, path, outcome] = h.completed[0] ?? [];
    expect(leaf).toBe('second_home_buyer');
    expect(path?.answer_indexes).toEqual([2, []]);
    expect(outcome?.traits).toEqual([]);
  });

  it('the progress counter counts questions only (not the confirmation)', () => {
    const h = mount();
    expect(h.root.querySelector('.estalara-quiz-progress')?.textContent).toBe('1 / 3');
    click(answers(h)[0]);
    expect(h.root.querySelector('.estalara-quiz-progress')?.textContent).toBe('2 / 3');
    click(answers(h)[0]);
    click(cta(h));
    expect(h.root.querySelector('.estalara-quiz-progress')?.textContent).toBe('3 / 3');
    click(cta(h));
    expect(h.root.querySelector('.estalara-quiz-progress')).toBeNull();
  });
});

describe('confirmation + correction', () => {
  it('shows the result screen — never with .estalara-quiz-answer — and confirms', () => {
    const h = mount();
    walk(h, 3, 0, [1]); // invest → long → buying_from_abroad
    expect(h.completed).toHaveLength(0);
    const result = h.root.querySelector('.estalara-quiz-result');
    expect(result?.textContent).toBe(
      "Based on your answers: Long-term rental investment — you're buying to earn income from " +
        'long-term tenants, and nobody in your household will live there. Is that right?',
    );
    expect(result?.querySelector('strong')?.textContent).toBe('Long-term rental investment');
    expect(answers(h)).toHaveLength(0);
    expect(q(h, '.estalara-quiz-confirm')[0]?.textContent).toBe("Yes, that's me");
    expect(q(h, '.estalara-quiz-reject')[0]?.textContent).toBe('Not quite');
    expect(cta(h)).toBeNull();

    click(q(h, '.estalara-quiz-confirm')[0]);
    expect(h.completed).toHaveLength(1);
    const [leaf, , outcome] = h.completed[0] ?? [];
    expect(leaf).toBe('yield_hunter');
    expect(outcome).toMatchObject({
      confirmation: 'confirmed',
      final_archetype: 'yield_hunter',
      traits: ['buying_from_abroad'],
      definition_hash: HASH,
      language: 'en',
    });
    expect(h.pings.map((p) => p.event)).toEqual(['shown', 'completed', 'confirmed']);
    const confirmed = parsePing(h.pings[2]);
    expect(confirmed.confirmed_archetype).toBe('yield_hunter');
    expect(confirmed.resolved_archetype).toBe('yield_hunter');
    expect(typeof confirmed.result_ms).toBe('number');
    expect(confirmed.offered).toBeUndefined();
    expect(h.root.querySelector('.estalara-quiz-card')).toBeNull();
  });

  it('"Not quite" offers the alternatives; picking one is `corrected` with it and `offered`', () => {
    const h = mount();
    walk(h, 3, 0, []);
    click(q(h, '.estalara-quiz-reject')[0]);
    const options = q(h, '.estalara-quiz-option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Holiday-let investment',
      'Renovate and resell',
      'Home for a student',
      'None of these — show me everything',
    ]);
    expect(h.root.querySelector('.estalara-quiz-result')?.textContent).toBe(
      'Which fits you better?',
    );
    expect(answers(h)).toHaveLength(0);
    click(options[1]);
    const [leaf, , outcome] = h.completed[0] ?? [];
    expect(leaf).toBe('yield_hunter');
    expect(outcome?.confirmation).toBe('corrected');
    expect(outcome?.final_archetype).toBe('flip_investor');
    const corrected = parsePing(h.pings[2]);
    expect(corrected).toMatchObject({
      event: 'corrected',
      confirmed_archetype: 'flip_investor',
      resolved_archetype: 'yield_hunter',
      offered: ['vacation_rental_investor', 'flip_investor', 'student_parent'],
    });
  });

  it('"None of these" → neutral, `none_of_these`', () => {
    const h = mount();
    walk(h, 3, 0, []);
    click(q(h, '.estalara-quiz-reject')[0]);
    click(q(h, '.estalara-quiz-option').at(-1));
    const [, , outcome] = h.completed[0] ?? [];
    expect(outcome?.confirmation).toBe('none_of_these');
    expect(outcome?.final_archetype).toBe('neutral');
    expect(parsePing(h.pings[2])).toMatchObject({
      event: 'corrected',
      confirmed_archetype: 'none_of_these',
    });
  });

  it('× on the result screen applies the leaf as `unconfirmed`', () => {
    const h = mount();
    walk(h, 4, null, [0]);
    click(h.root.querySelector<HTMLElement>('.estalara-quiz-close'));
    const [leaf, , outcome] = h.completed[0] ?? [];
    expect(leaf).toBe('student_parent');
    expect(outcome?.confirmation).toBe('unconfirmed');
    expect(outcome?.final_archetype).toBe('student_parent');
    expect(h.dismissed).toBe(0);
    const unconfirmed = parsePing(h.pings[2]);
    expect(unconfirmed.event).toBe('unconfirmed');
    expect(unconfirmed.confirmed_archetype).toBeUndefined();
  });

  it('pagehide on the result screen → `unconfirmed` exactly once', () => {
    const h = mount();
    walk(h, 1, 1, []);
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pagehide'));
    expect(h.completed).toHaveLength(1);
    expect(h.completed[0]?.[2].confirmation).toBe('unconfirmed');
    expect(h.pings.map((p) => p.event)).toEqual(['shown', 'completed', 'unconfirmed']);
  });

  it('pagehide during the walk sends nothing (the run stays `shown`)', () => {
    const h = mount();
    click(answers(h)[0]);
    window.dispatchEvent(new Event('pagehide'));
    expect(h.pings.map((p) => p.event)).toEqual(['shown']);
    expect(h.completed).toHaveLength(0);
  });

  it('a neutral leaf gets no confirmation', () => {
    const h = mount();
    click(answers(h)[5]); // Not sure yet
    expect(h.completed[0]?.[2]).toMatchObject({ confirmation: null, final_archetype: 'neutral' });
    expect(h.pings.map((p) => p.event)).toEqual(['shown', 'completed']);
  });

  it('a served definition without `confirm` has no confirmation step (stays `completed`)', () => {
    const noConfirm: QuizDefinition = { ...DEFAULT_QUIZ_DEFINITION_V2 };
    delete noConfirm.confirm;
    const h = mount(noConfirm);
    walk(h, 3, 0, []);
    expect(h.root.querySelector('.estalara-quiz-result')).toBeNull();
    expect(h.completed[0]?.[2].confirmation).toBeNull();
    expect(h.pings.map((p) => p.event)).toEqual(['shown', 'completed']);
  });
});

describe('EN | PL language switcher', () => {
  it('is shown for a two-language definition and re-renders the current step in PL', () => {
    const h = mount();
    const switcher = q(h, '.estalara-quiz-lang button');
    expect(switcher.map((b) => b.textContent)).toEqual(['EN', 'PL']);
    click(switcher[1]);
    expect(question(h)).toBe('Do czego ma służyć ta nieruchomość?');
    expect(h.root.querySelector('.estalara-quiz-progress')?.textContent).toBe('1 / 3');
    expect(h.root.querySelector('.estalara-quiz-skip')?.textContent).toBe('Pomiń');
    expect(sessionStorage.getItem(QUIZ_LANGUAGE_STORAGE_KEY)).toBe('pl');
    expect(q(h, '.estalara-quiz-lang button').map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
    ]);

    // persists across steps, the trait screen chrome and the result screen
    click(answers(h)[3]);
    expect(question(h)).toBe('Jak ta nieruchomość ma na siebie zarabiać?');
    click(answers(h)[2]);
    click(cta(h));
    expect(answers(h).at(-1)?.textContent).toBe('Żadne z powyższych');
    expect(cta(h)?.textContent).toBe('Dalej');
    click(cta(h));
    expect(h.root.querySelector('.estalara-quiz-result')?.textContent).toBe(
      'Na podstawie Twoich odpowiedzi: Remont i sprzedaż — kupujesz, żeby wyremontować ' +
        'nieruchomość i sprzedać ją z zyskiem, a nie żeby ją zatrzymać. Zgadza się?',
    );
    expect(q(h, '.estalara-quiz-confirm')[0]?.textContent).toBe('Tak, to ja');
    expect(q(h, '.estalara-quiz-reject')[0]?.textContent).toBe('Nie do końca');
    click(q(h, '.estalara-quiz-reject')[0]);
    expect(q(h, '.estalara-quiz-option').map((o) => o.textContent)).toEqual([
      'Inwestycja pod najem długoterminowy',
      'Inwestycja pod najem wakacyjny',
      'Inwestycja w lokal komercyjny',
      'Żadne — pokaż wszystkie oferty',
    ]);
    // switching back on the correction screen re-renders it in EN
    click(q(h, '.estalara-quiz-lang button')[0]);
    expect(h.root.querySelector('.estalara-quiz-result')?.textContent).toBe(
      'Which fits you better?',
    );
    click(q(h, '.estalara-quiz-option')[0]);
    expect(h.completed[0]?.[2].language).toBe('en');
    expect(h.pings.map((p) => p.language)).toEqual(['en', 'pl', 'en']);
  });

  it('a stored choice overrides quiz_config.language on the next card', () => {
    sessionStorage.setItem(QUIZ_LANGUAGE_STORAGE_KEY, 'pl');
    const h = mount(DEFAULT_QUIZ_DEFINITION_V2, { language: 'en' });
    expect(question(h)).toBe('Do czego ma służyć ta nieruchomość?');
    expect(h.pings[0]?.language).toBe('pl');
  });

  it('a stored language the definition lacks is ignored', () => {
    sessionStorage.setItem(QUIZ_LANGUAGE_STORAGE_KEY, 'pl');
    const h = mount(DEFAULT_QUIZ_DEFINITION, { language: 'en' });
    expect(question(h)).toBe('What will this property be for?');
    expect(q(h, '.estalara-quiz-lang')).toHaveLength(0);
  });

  it('consent denial erases the choice with the cached quiz config', () => {
    sessionStorage.setItem(QUIZ_LANGUAGE_STORAGE_KEY, 'pl');
    eraseCachedQuizConfig();
    expect(sessionStorage.getItem(QUIZ_LANGUAGE_STORAGE_KEY)).toBeNull();
  });
});

describe('run identity, timings and ping shapes', () => {
  it('every ping of a run carries one uuid, the forwarded hash and version, and parses', () => {
    const h = mount();
    walk(h, 0, 0, [0]);
    click(q(h, '.estalara-quiz-confirm')[0]);
    const ids = new Set(h.pings.map((p) => p.quiz_run_id));
    expect(ids.size).toBe(1);
    for (const p of h.pings) {
      const body = parsePing(p);
      expect(body.definition_hash).toBe(HASH);
      expect(body.definition_version).toBe(4);
    }
    const completed = parsePing(h.pings[1]);
    expect(completed).toMatchObject({
      event: 'completed',
      resolved_archetype: 'first_time_buyer',
      traits: ['has_children'],
      answer_path: [
        { question_id: 'q_purpose', answer_index: 0 },
        { question_id: 'q_home', answer_index: 0 },
        { question_id: 't_home', answer_indexes: [0] },
      ],
    });
    expect(completed.step_ms).toHaveLength(3);
  });

  it('the built-in reports builtin-en-v2 and a null version', () => {
    const h = mount(DEFAULT_QUIZ_DEFINITION, {
      definitionHash: undefined,
      definitionVersion: undefined,
    });
    expect(h.pings[0]).toMatchObject({
      definition_hash: BUILTIN_QUIZ_DEFINITION_HASH,
      definition_version: null,
    });
    expect(BUILTIN_QUIZ_DEFINITION_HASH).toBe('builtin-en-v2');
  });

  it('a served definition without a forwarded hash reports `unhashed`', () => {
    const h = mount(DEFAULT_QUIZ_DEFINITION_V2, { definitionHash: undefined });
    expect(h.pings[0]?.definition_hash).toBe('unhashed');
  });

  it('step_ms is rounded to 100 ms and capped at 600 000; result_ms likewise', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
    const h = mount();
    vi.advanceTimersByTime(1234);
    click(answers(h)[0]);
    vi.advanceTimersByTime(700_000);
    click(answers(h)[0]);
    click(cta(h));
    vi.advanceTimersByTime(49);
    click(cta(h));
    vi.advanceTimersByTime(2_360);
    click(q(h, '.estalara-quiz-confirm')[0]);
    expect(parsePing(h.pings[1]).step_ms).toEqual([1200, 600_000, 0]);
    expect(parsePing(h.pings[2]).result_ms).toBe(2400);
  });

  it('Skip / × before the leaf → `dismissed` with last_step, no onComplete', () => {
    const h = mount();
    click(answers(h)[0]);
    click(h.root.querySelector<HTMLElement>('.estalara-quiz-skip'));
    expect(h.dismissed).toBe(1);
    expect(h.completed).toHaveLength(0);
    expect(parsePing(h.pings[1])).toMatchObject({
      event: 'dismissed',
      last_step: 1,
    });

    const h2 = mount();
    click(h2.root.querySelector<HTMLElement>('.estalara-quiz-close'));
    expect(parsePing(h2.pings[1])).toMatchObject({
      event: 'dismissed',
      last_step: 0,
    });
  });

  it('newQuizRunId falls back to a valid v4 uuid without crypto.randomUUID', () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('unavailable');
    });
    for (let i = 0; i < 50; i++) {
      expect(newQuizRunId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });
});

describe('postQuizRunPing — consent, opt-out, tenant, transport', () => {
  const fields: QuizRunPingFields = {
    quiz_run_id: '3f1e2d4c-5b6a-4789-8abc-def012345678',
    event: 'shown',
    language: 'en',
    definition_hash: HASH,
    definition_version: null,
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sends nothing without profiling consent', async () => {
    await postQuizRunPing(SDK_CONFIG, SESSION_ID, fields, false);
    localStorage.setItem('estalara_consent', 'denied');
    await postQuizRunPing(SDK_CONFIG, SESSION_ID, fields, false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing under the §H.9 opt-out', async () => {
    localStorage.setItem('estalara_consent', 'granted');
    await postQuizRunPing(SDK_CONFIG, SESSION_ID, fields, true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing without a tenant id (the route would 403 the placeholder)', async () => {
    localStorage.setItem('estalara_consent', 'granted');
    const noTenant: SdkConfig = { ...SDK_CONFIG };
    delete noTenant.tenantId;
    await postQuizRunPing(noTenant, SESSION_ID, fields, false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with consent: one signed keepalive POST to /api/quiz/run with the identity fields', async () => {
    localStorage.setItem('estalara_consent', 'granted');
    await postQuizRunPing(SDK_CONFIG, SESSION_ID, fields, false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/api/quiz/run');
    expect(init.keepalive).toBe(true);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Estalara-Signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(headers.Authorization).toBe(`Bearer ${SDK_CONFIG.apiKey}`);
    expect(QuizRunPingSchema.parse(JSON.parse(init.body as string))).toEqual({
      ...fields,
      tenant_id: SDK_CONFIG.tenantId,
      session_id: SESSION_ID,
      sdk_version: '0.0.0',
      consent_state: 'consented',
    });
  });

  it('never rejects and logs nothing when the request fails', async () => {
    localStorage.setItem('estalara_consent', 'granted');
    fetchMock.mockRejectedValue(new Error('404 / offline'));
    const warn = vi.spyOn(console, 'warn');
    await expect(postQuizRunPing(SDK_CONFIG, SESSION_ID, fields, false)).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('downstream shapes', () => {
  it('the completion ping leaves the trait step out (quiz_completions is unchanged)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);
    postQuizCompletionPing(SDK_CONFIG, SESSION_ID, 'family_buyer', 'pl', false, {
      question_ids: ['q_purpose', 'q_home', 't_home'],
      answer_indexes: [0, 1, [0, 2]],
    });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const sent = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(sent).toMatchObject({
      branch: 'q_home',
      q1_answer: 0,
      q2_answer: 1,
      q3_answer: null,
      answer_path: [
        { question_id: 'q_purpose', answer_index: 0 },
        { question_id: 'q_home', answer_index: 1 },
      ],
    });
  });

  it('intent.snapshot carries the quiz traits and still parses', () => {
    const queue: CollectedEvent[] = [];
    const state = {
      ...applyQuizLeaf(initIntentState(), 'family_buyer'),
      quiz_traits: ['has_children' as const],
    };
    emitIntentSnapshot(state, {
      eventQueue: queue,
      chatTurns: 0,
      quizCompleted: true,
      quizLeaf: 'family_buyer',
    });
    const payload = IntentSnapshotPayloadSchema.parse(queue[0]?.payload);
    expect(payload.traits).toEqual(['has_children']);
  });

  it('quiz.event accepts the new steps and fields, including the built-in hash', () => {
    const payload = {
      step: 'corrected',
      trigger: 'auto_open',
      archetype: 'neutral',
      confidence: 0.5,
      quiz_run_id: '3f1e2d4c-5b6a-4789-8abc-def012345678',
      resolved_archetype: 'yield_hunter',
      definition_hash: BUILTIN_QUIZ_DEFINITION_HASH,
    };
    // kept, not stripped, by the schema the ingest Worker validates with (EventSchema)
    expect(QuizEventPayloadSchema.parse(payload)).toEqual(payload);
    expect(QuizEventPayloadSchema.safeParse({ step: 'completed' }).success).toBe(true);
  });
});
