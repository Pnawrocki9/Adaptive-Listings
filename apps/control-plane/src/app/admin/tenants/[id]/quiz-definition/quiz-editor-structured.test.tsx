/**
 * Tests for the structured EN | PL quiz editor (FOLLOW-1362 C2): side-by-side columns and PL
 * gating, `next` dropdown, question add/remove/rename, leaf picker, trait screens, the
 * Confirmation tab, the lint panel (client + server issues), read-only mode, the invalid-active
 * banner and 409 handling. The older suggest / form-roundtrip flows live in
 * `quiz-definition-editor.test.tsx`.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/quiz-editor-structured.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { QuizDefinition } from '@estalara/shared';
import { DEFAULT_QUIZ_DEFINITION_V2 } from '@estalara/shared';

import { StaffQuizDefinitionEditor } from './quiz-definition-editor';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';

/** q_a (root) → q_b → q_c; leaves carry weights so the Confirmation tab has two results. */
const TREE: QuizDefinition = {
  schema_version: 1,
  root: 'q_a',
  languages: ['en', 'pl'],
  questions: [
    {
      id: 'q_a',
      prompt_i18n: { en: 'A?', pl: 'A PL?' },
      answers: [
        { id: 'a1', label_i18n: { en: 'a1', pl: 'a1 pl' }, weights: {}, next: 'q_b' },
        { id: 'a2', label_i18n: { en: 'a2', pl: 'a2 pl' }, weights: {}, next: null },
      ],
    },
    {
      id: 'q_b',
      prompt_i18n: { en: 'B?', pl: 'B PL?' },
      answers: [
        { id: 'b1', label_i18n: { en: 'b1', pl: 'b1 pl' }, weights: {}, next: 'q_c' },
        {
          id: 'b2',
          label_i18n: { en: 'b2', pl: 'b2 pl' },
          weights: { yield_hunter: 1 },
          next: null,
        },
      ],
    },
    {
      id: 'q_c',
      prompt_i18n: { en: 'C?', pl: '' },
      answers: [
        {
          id: 'c1',
          label_i18n: { en: 'c1', pl: 'c1 pl' },
          weights: { family_buyer: 1 },
          next: null,
        },
        { id: 'c2', label_i18n: { en: 'c2', pl: 'c2 pl' }, weights: {}, next: null },
      ],
    },
  ],
};

interface Stub {
  get: Record<string, unknown>;
  put?: { status: number; body: unknown };
}

/** Stub `fetch`: GET returns the state below; PUT returns `put` (default 200 version 8). */
function stubFetch({ get, put }: Stub) {
  const fn = vi.fn((_url: string, init?: { method?: string }) => {
    if (init?.method === 'PUT') {
      const p = put ?? { status: 200, body: { version: 8 } };
      return Promise.resolve({
        ok: p.status < 400,
        status: p.status,
        json: () => Promise.resolve(p.body),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          tenant_id: TENANT_ID,
          version: 7,
          definition: DEFAULT_QUIZ_DEFINITION_V2,
          warnings: { unreachable_archetypes: [] },
          can_write: true,
          invalid_active: false,
          raw: null,
          lint: null,
          ...get,
        }),
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function renderEditor(stub: Stub) {
  const fetchMock = stubFetch(stub);
  render(<StaffQuizDefinitionEditor tenantId={TENANT_ID} />);
  await screen.findByText(/Active version|No saved definition/);
  return fetchMock;
}

function draft(): QuizDefinition {
  const el = screen.getByTestId('quiz-definition-json');
  if (!(el instanceof HTMLTextAreaElement)) throw new Error('draft textarea not found');
  return JSON.parse(el.value) as QuizDefinition;
}

function change(testId: string, value: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

const saveButton = () => screen.getByRole('button', { name: /publish/i });

/** Publish… then confirm in the dialog (the former one-click Save). */
function publish(): void {
  fireEvent.click(saveButton());
  fireEvent.click(screen.getByTestId('publish-dialog-confirm'));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EN | PL columns and PL gating', () => {
  it('renders EN and PL inputs per text and a PL n/m meter per question', async () => {
    await renderEditor({ get: { definition: TREE } });
    expect(screen.getByTestId('qf-prompt-q_a')).toHaveProperty('value', 'A?');
    expect(screen.getByTestId('qf-prompt-pl-q_a')).toHaveProperty('value', 'A PL?');
    expect(screen.getByTestId('qf-label-pl-q_b-b2')).toHaveProperty('value', 'b2 pl');
    expect(screen.getByTestId('pl-meter-q_a').textContent).toBe('PL 3/3');
    expect(screen.getByTestId('pl-meter-q_c').textContent).toBe('PL 2/3');
  });

  it('a missing PL text blocks Save and typing it unblocks Save', async () => {
    await renderEditor({ get: { definition: DEFAULT_QUIZ_DEFINITION_V2 } });
    expect(saveButton()).toHaveProperty('disabled', false);

    change('qf-label-pl-q_purpose-unsure', '');
    expect(saveButton()).toHaveProperty('disabled', true);
    expect(within(screen.getByTestId('lint-errors')).getByText('empty_label')).toBeDefined();

    change('qf-label-pl-q_purpose-unsure', 'Nie wiem');
    expect(saveButton()).toHaveProperty('disabled', false);
    expect(screen.queryByTestId('lint-errors')).toBeNull();
  });

  it('EN edits keep working through the existing testids and leave PL alone', async () => {
    await renderEditor({ get: { definition: TREE } });
    change('qf-prompt-q_a', 'Changed?');
    expect(draft().questions[0]!.prompt_i18n).toEqual({ en: 'Changed?', pl: 'A PL?' });
  });
});

describe('languages', () => {
  it('EN and PL are fixed; ES can be toggled into languages', async () => {
    await renderEditor({ get: { definition: TREE } });
    fireEvent.click(screen.getByTestId('lang-es'));
    expect(draft().languages).toEqual(['en', 'pl', 'es']);
    fireEvent.click(screen.getByTestId('lang-es'));
    expect(draft().languages).toEqual(['en', 'pl']);
  });
});

describe('next dropdown', () => {
  it('excludes the question itself and its ancestors', async () => {
    await renderEditor({ get: { definition: TREE } });
    const options = (id: string) =>
      within(screen.getByTestId(id))
        .getAllByRole('option')
        .map((o) => (o as HTMLOptionElement).value);
    expect(options('qf-next-q_b-b1')).toEqual(['', 'q_c']);
    expect(options('qf-next-q_c-c1')).toEqual(['']);
    expect(options('qf-next-q_a-a2')).toEqual(['', 'q_b', 'q_c']);
  });

  it('choosing a question or "End of quiz" writes next', async () => {
    await renderEditor({ get: { definition: TREE } });
    change('qf-next-q_a-a2', 'q_c');
    expect(draft().questions[0]!.answers[1]!.next).toBe('q_c');
    change('qf-next-q_a-a2', '');
    expect(draft().questions[0]!.answers[1]!.next).toBeNull();
  });
});

describe('question add / remove / rename', () => {
  it('removing a question nulls the inbound next, flags it, and root cannot be removed', async () => {
    await renderEditor({ get: { definition: TREE } });
    expect(screen.getByTestId('qf-remove-q_a')).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByTestId('qf-remove-q_c'));
    const def = draft();
    expect(def.questions.map((q) => q.id)).toEqual(['q_a', 'q_b']);
    expect(def.questions[1]!.answers[0]!.next).toBeNull();
    expect(screen.getByTestId('form-notice').textContent).toContain('q_b/b1');
  });

  it('renaming a question rewrites root and every next', async () => {
    await renderEditor({ get: { definition: TREE } });
    change('qf-id-q_b', 'q_mid');
    fireEvent.blur(screen.getByTestId('qf-id-q_b'));
    let def = draft();
    expect(def.questions[0]!.answers[0]!.next).toBe('q_mid');
    expect(def.questions[1]!.id).toBe('q_mid');

    change('qf-id-q_a', 'q_start');
    fireEvent.blur(screen.getByTestId('qf-id-q_a'));
    def = draft();
    expect(def.root).toBe('q_start');
  });

  it('a clashing rename is refused with a visible notice', async () => {
    await renderEditor({ get: { definition: TREE } });
    change('qf-id-q_b', 'q_c');
    fireEvent.blur(screen.getByTestId('qf-id-q_b'));
    expect(screen.getByTestId('form-notice').textContent).toMatch(/already exists/);
    expect(draft().questions.map((q) => q.id)).toEqual(['q_a', 'q_b', 'q_c']);
  });

  it('"Add question" appends an orphan that the lint reports and that blocks Save', async () => {
    await renderEditor({ get: { definition: DEFAULT_QUIZ_DEFINITION_V2 } });
    fireEvent.click(screen.getByTestId('add-question'));
    expect(draft().questions).toHaveLength(DEFAULT_QUIZ_DEFINITION_V2.questions.length + 1);
    expect(within(screen.getByTestId('lint-errors')).getByText('orphan_question')).toBeDefined();
    expect(saveButton()).toHaveProperty('disabled', true);
  });
});

describe('leaf picker and weights', () => {
  it('"Resolves to" writes weights {X: 1}; Advanced holds the raw weights', async () => {
    await renderEditor({ get: { definition: TREE } });
    expect(screen.getByTestId('qf-resolves-q_c-c1')).toHaveProperty('value', 'family_buyer');
    expect(screen.getByTestId('qf-resolves-q_c-c2')).toHaveProperty('value', '');

    change('qf-resolves-q_c-c2', 'retiree_relocator');
    expect(draft().questions[2]!.answers[1]!.weights).toEqual({ retiree_relocator: 1 });

    change('qf-weight-q_c-c2-retiree_relocator', '0.5');
    expect(draft().questions[2]!.answers[1]!.weights).toEqual({ retiree_relocator: 0.5 });
    expect(screen.getByTestId('qf-resolves-q_c-c2')).toHaveProperty('value', '__custom__');
  });
});

describe('trait screen', () => {
  it('a multi question shows trait checkboxes and no branching controls', async () => {
    await renderEditor({ get: { definition: DEFAULT_QUIZ_DEFINITION_V2 } });
    expect(screen.queryByTestId('qf-next-t_home-premium')).toBeNull();
    const box = screen.getByTestId('qf-trait-t_home-premium-works_from_home');
    expect(box).toHaveProperty('checked', false);
    fireEvent.click(box);
    expect(
      draft()
        .questions.find((q) => q.id === 't_home')!
        .answers.find((a) => a.id === 'premium')!.traits,
    ).toEqual(['premium', 'works_from_home']);
  });

  it('switching a question to a trait screen clears its weights and next', async () => {
    await renderEditor({ get: { definition: TREE } });
    change('qf-kind-q_c', 'multi');
    const c = draft().questions[2]!;
    expect(c.kind).toBe('multi');
    expect(c.answers.every((a) => a.next === null && Object.keys(a.weights).length === 0)).toBe(
      true,
    );
    expect(screen.getByTestId('qf-trait-q_c-c1-premium')).toBeDefined();
  });
});

describe('Confirmation tab', () => {
  it('edits names / sentences (EN | PL) and alternatives per reachable result', async () => {
    await renderEditor({ get: { definition: TREE } });
    fireEvent.click(screen.getByTestId('tab-confirmation'));
    expect(screen.getByTestId('confirmation-tab')).toBeDefined();
    expect(screen.getByTestId('cf-card-family_buyer')).toBeDefined();
    expect(screen.getByTestId('cf-card-yield_hunter')).toBeDefined();

    change('cf-name-en-family_buyer', 'Family buyer');
    change('cf-name-pl-family_buyer', 'Kupujący dla rodziny');
    change('cf-sentence-pl-family_buyer', 'Szukasz domu dla rodziny');
    fireEvent.click(screen.getByTestId('cf-alt-family_buyer-yield_hunter'));
    // One alternative is not a valid confirm: held back, the form stays, a hint is shown.
    expect(draft().confirm!.alternatives.family_buyer).toBeUndefined();
    expect(screen.getByTestId('cf-alt-hint-family_buyer')).toBeDefined();
    expect(screen.getByTestId('cf-alt-family_buyer-yield_hunter')).toHaveProperty('checked', true);
    fireEvent.click(screen.getByTestId('cf-alt-family_buyer-first_time_buyer'));

    const confirm = draft().confirm!;
    expect(confirm.names_i18n.family_buyer).toEqual({
      en: 'Family buyer',
      pl: 'Kupujący dla rodziny',
    });
    expect(confirm.sentences_i18n.family_buyer).toEqual({ pl: 'Szukasz domu dla rodziny' });
    expect(confirm.alternatives.family_buyer).toEqual(['yield_hunter', 'first_time_buyer']);
    // An alternative that is not a reachable result still needs a name.
    expect(screen.getByText(/also need a name/)).toBeDefined();
    expect(screen.getByTestId('cf-name-en-first_time_buyer')).toBeDefined();
  });

  it('a result without a confirmation name is reported by the lint and blocks Save', async () => {
    await renderEditor({ get: { definition: TREE } });
    const errors = within(screen.getByTestId('lint-errors'));
    expect(errors.getAllByText('confirm_missing').length).toBeGreaterThan(0);
    expect(saveButton()).toHaveProperty('disabled', true);
  });
});

describe('lint panel', () => {
  it('shows warnings without blocking Save', async () => {
    const def = structuredClone(DEFAULT_QUIZ_DEFINITION_V2);
    delete def.confirm!.alternatives.yield_hunter;
    await renderEditor({ get: { definition: def } });
    expect(
      within(screen.getByTestId('lint-warnings')).getByText('confirm_missing_alternatives'),
    ).toBeDefined();
    expect(saveButton()).toHaveProperty('disabled', false);
  });

  it("renders the server's 400 issues[] after a rejected save", async () => {
    const fetchMock = await renderEditor({
      get: { definition: DEFAULT_QUIZ_DEFINITION_V2 },
      put: {
        status: 400,
        body: {
          error: {
            code: 'validation_failed',
            message: 'Invalid quiz definition',
            issues: [
              {
                code: 'confirm_missing_name',
                path: ['confirm', 'names_i18n', 'yield_hunter'],
                message: 'server says the name is missing',
              },
            ],
          },
        },
      },
    });
    publish();
    const panel = await screen.findByTestId('server-issues');
    expect(within(panel).getByText('confirm_missing_name')).toBeDefined();
    expect(within(panel).getByText(/server says the name is missing/)).toBeDefined();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'PUT')).toBe(true);
  });
});

describe('save contract', () => {
  it('sends the loaded active version as base_version and source "editor"', async () => {
    const fetchMock = await renderEditor({ get: { definition: DEFAULT_QUIZ_DEFINITION_V2 } });
    publish();
    await screen.findByText('Definition saved!');
    const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')!;
    const body = JSON.parse((put[1] as unknown as { body: string }).body) as {
      base_version: number | null;
      source: string;
      definition: QuizDefinition;
    };
    expect(body.base_version).toBe(7);
    expect(body.source).toBe('editor');
    expect(body.definition.root).toBe('q_purpose');
  });

  it('a tenant with no saved definition starts from the built-in default and sends base_version null', async () => {
    const fetchMock = await renderEditor({ get: { version: null, definition: null } });
    expect(draft().root).toBe(DEFAULT_QUIZ_DEFINITION_V2.root);
    publish();
    await screen.findByText('Definition saved!');
    const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')!;
    expect(JSON.parse((put[1] as unknown as { body: string }).body)).toMatchObject({
      base_version: null,
    });
  });

  it('409 shows "someone else published version N" and Reload re-fetches', async () => {
    const fetchMock = await renderEditor({
      get: { definition: DEFAULT_QUIZ_DEFINITION_V2 },
      put: {
        status: 409,
        body: {
          error: { code: 'version_conflict', message: 'moved', active_version: 9 },
        },
      },
    });
    publish();
    const banner = await screen.findByTestId('version-conflict');
    expect(banner.textContent).toContain('Someone else published version 9');
    expect(banner.textContent).toContain('not saved');

    const getsBefore = fetchMock.mock.calls.filter((c) => c[1]?.method !== 'PUT').length;
    fireEvent.click(screen.getByTestId('reload-definition'));
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter((c) => c[1]?.method !== 'PUT').length).toBe(
        getsBefore + 1,
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId('version-conflict')).toBeNull();
    });
  });
});

describe('read-only mode (can_write: false)', () => {
  it('disables every input and hides Save and Suggest', async () => {
    await renderEditor({ get: { definition: TREE, can_write: false } });
    expect(screen.getByTestId('read-only-banner')).toBeDefined();
    expect(screen.queryByRole('button', { name: /publish/i })).toBeNull();
    expect(screen.queryByTestId('suggest-weights')).toBeNull();
    for (const id of [
      'qf-prompt-q_a',
      'qf-prompt-pl-q_a',
      'qf-label-pl-q_a-a1',
      'qf-next-q_a-a1',
      'qf-resolves-q_c-c1',
      'qf-id-q_a',
      'quiz-definition-json',
      'add-question',
    ]) {
      expect(screen.getByTestId(id)).toHaveProperty('disabled', true);
    }
    fireEvent.click(screen.getByTestId('tab-confirmation'));
    expect(screen.getByTestId('cf-name-en-family_buyer')).toHaveProperty('disabled', true);
  });
});

describe('invalid active definition', () => {
  const RAW = { schema_version: 1, root: 'q_gone', questions: [] };

  it('blocks editing with a banner that shows the raw JSON — no silent starter', async () => {
    await renderEditor({
      get: { definition: null, invalid_active: true, raw: RAW, version: 4 },
    });
    expect(screen.getByTestId('invalid-active-banner')).toBeDefined();
    expect(screen.getByTestId('invalid-active-raw').textContent).toContain('q_gone');
    expect(screen.queryByTestId('question-form')).toBeNull();
    expect(screen.getByTestId('question-form-unavailable')).toBeDefined();
    expect(saveButton()).toHaveProperty('disabled', true);
    expect(screen.getByTestId('quiz-definition-json')).toHaveProperty('value', '');
  });

  it('"Load built-in default" loads DEFAULT_QUIZ_DEFINITION_V2 and re-enables Save', async () => {
    await renderEditor({
      get: { definition: null, invalid_active: true, raw: RAW, version: 4 },
    });
    fireEvent.click(screen.getByTestId('load-default'));
    expect(screen.queryByTestId('invalid-active-banner')).toBeNull();
    expect(draft()).toEqual(DEFAULT_QUIZ_DEFINITION_V2);
    expect(saveButton()).toHaveProperty('disabled', false);
  });
});
