/**
 * FOLLOW-1357 — the quiz widget v2 through the REAL `init()` (`_initForTest`): the served EN + PL
 * definition with its forwarded hash → the walk → confirm / "None of these" → the intent-loop
 * wiring: run pings in order (`POST /api/quiz/run`), the FINAL archetype applied and pinned (or
 * nothing pinned for "None of these"), traits in the persisted state, on `/api/adapt` and on
 * `intent.snapshot`, and one `quiz.event` per run in the real ingest batch — every ingest event
 * validated with the `EventSchema` the ingest Worker parses with.
 *
 * @module packages/sdk/src/__tests__/follow-1357-init.test
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_QUIZ_DEFINITION_V2, EventSchema, QuizRunPingSchema } from '@estalara/shared';

import { _initForTest } from '../index.js';
import { PROFILING_OPT_OUT_KEY } from '../core/profiling-opt-out.js';
import { intentStateStorageKey, resolvedArchetypeStorageKey } from '../core/session.js';

const SESSION_ID = 'a'.repeat(64);
const HASH = 'f'.repeat(64);
const API_KEY = 'test-follow1357-init-api-key';
const DECISION_API_URL = 'https://api.example.com/api';
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';

const ADAPT_RESPONSE = {
  adapt_decision_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  session_id: SESSION_ID,
  archetype: 'neutral',
  confidence: 0.5,
  similarity: 0.5,
  tier: 1,
  source: 'playbook',
  generated_at: '2026-10-19T00:00:00.000Z',
  directives: [],
  ttl_seconds: 300,
  variant: 'control',
};

function mockFetch(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((url: string) => {
    const json = (body: unknown): Promise<unknown> =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    if (url.includes('/quiz/public-config')) {
      return json({
        quiz_enabled: true,
        language: 'en',
        accent_color: '#6c5ce7',
        data_source: 'db',
        quiz_definition: DEFAULT_QUIZ_DEFINITION_V2,
        definition_hash: HASH,
        definition_version: null,
      });
    }
    if (url.includes('/intent/config')) return json(null);
    if (url.includes('/adapt/description')) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    }
    if (url.includes('/adapt')) return json(ADAPT_RESPONSE);
    return json({});
  });
}

/** JSON bodies of every request whose URL contains `path`, in call order. */
function bodiesTo(fetchMock: ReturnType<typeof vi.fn>, path: string): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(([url]) => typeof url === 'string' && url.includes(path))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, unknown>);
}

/** Every event of every ingest batch sent so far. */
function ingestEvents(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  return bodiesTo(fetchMock, '/v1/events').flatMap(
    (b) => (b.events as Record<string, unknown>[] | undefined) ?? [],
  );
}

function insertScript(): void {
  const script = document.createElement('script');
  script.dataset.apiKey = API_KEY;
  script.dataset.decisionUrl = DECISION_API_URL;
  script.dataset.tenantId = TENANT_ID;
  document.head.appendChild(script);
}

/** Boot the real SDK with consent and a seeded session; resolve the quiz card's shadow root. */
async function bootQuiz(fetchMock: ReturnType<typeof vi.fn>): Promise<ShadowRoot> {
  localStorage.setItem('estalara_consent', 'granted');
  sessionStorage.setItem(
    '__estalara_session__',
    JSON.stringify({ sessionId: SESSION_ID, startedAt: Date.now(), pageCount: 1 }),
  );
  insertScript();
  vi.stubGlobal('fetch', fetchMock);
  await _initForTest();
  let root: ShadowRoot | null = null;
  await vi.waitFor(() => {
    document.querySelectorAll('[data-estalara-host]').forEach((host) => {
      if (host.shadowRoot?.querySelector('.estalara-quiz-card')) root = host.shadowRoot;
    });
    expect(root).not.toBeNull();
  });
  return root as unknown as ShadowRoot;
}

function click(root: ShadowRoot, sel: string, i = 0): void {
  const all = root.querySelectorAll<HTMLElement>(sel);
  const el = all[i < 0 ? all.length + i : i];
  if (!el) throw new Error(`${sel}[${String(i)}] not found`);
  el.click();
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  const w = window as Window & { __estalaraTeardown?: () => void };
  w.__estalaraTeardown?.();
  delete w.__estalaraTeardown;
  document.querySelectorAll('script[data-api-key], [data-estalara-host]').forEach((el) => {
    el.remove();
  });
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FOLLOW-1357 through the real init()', () => {
  it('confirm: ordered run pings, final archetype pinned, traits in state + /api/adapt + events', async () => {
    const fetchMock = mockFetch();
    const root = await bootQuiz(fetchMock);
    click(root, '.estalara-quiz-answer', 0); // main_here → q_home
    click(root, '.estalara-quiz-answer', 1); // up → family_buyer
    click(root, '.estalara-quiz-cta');
    click(root, '.estalara-quiz-answer', 0); // has_children
    click(root, '.estalara-quiz-cta');
    expect(root.querySelector('.estalara-quiz-result')).not.toBeNull();
    click(root, '.estalara-quiz-confirm');

    await vi.waitFor(() => {
      expect(bodiesTo(fetchMock, '/quiz/run').map((b) => b.event)).toEqual([
        'shown',
        'completed',
        'confirmed',
      ]);
    });
    for (const b of bodiesTo(fetchMock, '/quiz/run')) {
      const parsed = QuizRunPingSchema.parse(b);
      expect(parsed).toMatchObject({
        tenant_id: TENANT_ID,
        consent_state: 'consented',
        session_id: SESSION_ID,
        sdk_version: '0.0.0',
        definition_hash: HASH,
        definition_version: null,
      });
    }

    expect(
      JSON.parse(sessionStorage.getItem(resolvedArchetypeStorageKey(SESSION_ID)) ?? '{}'),
    ).toMatchObject({ archetype: 'family_buyer' });
    const stored = JSON.parse(
      sessionStorage.getItem(intentStateStorageKey(SESSION_ID)) ?? '{}',
    ) as { state?: unknown };
    expect(stored.state).toMatchObject({
      archetype: 'family_buyer',
      quiz_traits: ['has_children'],
      // FOLLOW-1359 (§E.4.4 v3.0): `confirmed` folds the leaf at 0.90; confidence = posterior.
      confidence: 0.9,
      probabilities: { family_buyer: 0.9 },
      quiz_answered: true,
      quiz_confirmed: true,
    });

    await vi.waitFor(() => {
      expect(bodiesTo(fetchMock, '/adapt').some((b) => Array.isArray(b.traits))).toBe(true);
    });
    expect(bodiesTo(fetchMock, '/adapt').find((b) => Array.isArray(b.traits))).toMatchObject({
      archetype_hint: 'family_buyer',
      traits: ['has_children'],
    });

    window.dispatchEvent(new Event('beforeunload'));
    await vi.waitFor(() => {
      expect(ingestEvents(fetchMock).some((e) => e.type === 'quiz.event')).toBe(true);
    });
    const quizEvents = ingestEvents(fetchMock).filter((e) => e.type === 'quiz.event');
    expect(quizEvents).toHaveLength(1);
    expect(EventSchema.parse(quizEvents[0]).payload).toMatchObject({
      step: 'confirmed',
      archetype: 'family_buyer',
      resolved_archetype: 'family_buyer',
      definition_hash: HASH,
    });
    const snapshot = ingestEvents(fetchMock).find((e) => e.type === 'intent.snapshot');
    expect(EventSchema.parse(snapshot).payload).toMatchObject({ traits: ['has_children'] });
  });

  it('"None of these": neutral, nothing pinned, quiz.event `corrected`', async () => {
    const fetchMock = mockFetch();
    const root = await bootQuiz(fetchMock);
    click(root, '.estalara-quiz-answer', 3); // invest
    click(root, '.estalara-quiz-answer', 0); // long
    click(root, '.estalara-quiz-cta');
    click(root, '.estalara-quiz-cta'); // no traits
    click(root, '.estalara-quiz-reject');
    click(root, '.estalara-quiz-option', -1);

    await vi.waitFor(() => {
      expect(bodiesTo(fetchMock, '/quiz/run').map((b) => b.event)).toEqual([
        'shown',
        'completed',
        'corrected',
      ]);
    });
    expect(bodiesTo(fetchMock, '/quiz/run')[2]).toMatchObject({
      confirmed_archetype: 'none_of_these',
      resolved_archetype: 'yield_hunter',
    });
    expect(sessionStorage.getItem(resolvedArchetypeStorageKey(SESSION_ID))).toBeNull();
    const stored = JSON.parse(
      sessionStorage.getItem(intentStateStorageKey(SESSION_ID)) ?? '{}',
    ) as { state?: unknown };
    // FOLLOW-1359: the pre-quiz state, unpinned, flagged `quiz_rejected`.
    expect(stored.state).toMatchObject({
      archetype: 'neutral',
      quiz_traits: [],
      quiz_answered: false,
      quiz_rejected: true,
    });

    window.dispatchEvent(new Event('beforeunload'));
    await vi.waitFor(() => {
      expect(ingestEvents(fetchMock).some((e) => e.type === 'quiz.event')).toBe(true);
    });
    const quizEvent = ingestEvents(fetchMock).find((e) => e.type === 'quiz.event');
    expect(EventSchema.parse(quizEvent).payload).toMatchObject({
      step: 'corrected',
      archetype: 'neutral',
      resolved_archetype: 'yield_hunter',
    });
  });

  it('FOLLOW-1359: a correction folds the CHOSEN archetype at 0.90; the leaf gets the rest', async () => {
    const fetchMock = mockFetch();
    const root = await bootQuiz(fetchMock);
    click(root, '.estalara-quiz-answer', 3); // invest
    click(root, '.estalara-quiz-answer', 0); // long → yield_hunter
    click(root, '.estalara-quiz-cta');
    click(root, '.estalara-quiz-cta'); // no traits
    click(root, '.estalara-quiz-reject');
    click(root, '.estalara-quiz-option', 1); // flip_investor

    await vi.waitFor(() => {
      expect(bodiesTo(fetchMock, '/quiz/run').map((b) => b.event)).toContain('corrected');
    });
    const stored = JSON.parse(
      sessionStorage.getItem(intentStateStorageKey(SESSION_ID)) ?? '{}',
    ) as { state?: { probabilities: Record<string, number> } };
    expect(stored.state).toMatchObject({
      archetype: 'flip_investor',
      confidence: 0.9,
      quiz_confirmed: true,
    });
    expect(stored.state?.probabilities.flip_investor).toBe(0.9);
    expect(stored.state?.probabilities.yield_hunter).toBeCloseTo(0.1 / 17, 12);
    await vi.waitFor(() => {
      expect(bodiesTo(fetchMock, '/adapt').some((b) => b.archetype_hint === 'flip_investor')).toBe(
        true,
      );
    });
  });

  it('FOLLOW-1359: × on the result screen folds the leaf as `completed` (0.72, unconfirmed)', async () => {
    const fetchMock = mockFetch();
    const root = await bootQuiz(fetchMock);
    click(root, '.estalara-quiz-answer', 3); // invest
    click(root, '.estalara-quiz-answer', 0); // long → yield_hunter
    click(root, '.estalara-quiz-cta');
    click(root, '.estalara-quiz-cta'); // no traits
    click(root, '.estalara-quiz-close');

    await vi.waitFor(() => {
      expect(bodiesTo(fetchMock, '/quiz/run').map((b) => b.event)).toContain('unconfirmed');
    });
    const stored = JSON.parse(
      sessionStorage.getItem(intentStateStorageKey(SESSION_ID)) ?? '{}',
    ) as { state?: unknown };
    expect(stored.state).toMatchObject({
      archetype: 'yield_hunter',
      confidence: 0.72,
      probabilities: { yield_hunter: 0.72 },
      quiz_answered: true,
      quiz_confirmed: false,
    });
  });

  it('opted out: the quiz never opens and no run ping is sent', async () => {
    localStorage.setItem(PROFILING_OPT_OUT_KEY, 'true');
    localStorage.setItem('estalara_consent', 'granted');
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    insertScript();
    await _initForTest();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const card = [...document.querySelectorAll('[data-estalara-host]')].some((host) =>
      host.shadowRoot?.querySelector('.estalara-quiz-card'),
    );
    expect(card).toBe(false);
    expect(bodiesTo(fetchMock, '/quiz/run')).toHaveLength(0);
  });
});
