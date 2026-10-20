/**
 * Tests for the quiz editor tools (FOLLOW-1362 C3): the simulator (EN / PL, confirmation screen,
 * all-paths table), the versions panel (list, diff, restore, revert, 409), the publish dialog,
 * the browser-local draft (restore prompt, autosave, clear-on-publish, unload guard),
 * import / export and read-only mode.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/quiz-editor-tools.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { QuizDefinition } from '@estalara/shared';
import { DEFAULT_QUIZ_DEFINITION_V2 } from '@estalara/shared';

import { StaffQuizDefinitionEditor } from './quiz-definition-editor';
import { draftKey } from './use-local-draft';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const DEF = DEFAULT_QUIZ_DEFINITION_V2;

const VERSION_ROWS = [
  {
    version: 7,
    is_active: true,
    created_at: '2026-10-20T10:00:00.000Z',
    created_by: 'aaaaaaaa-1111',
    question_count: 9,
    answer_count: 30,
    sha256: 'abcdef0123456789',
    valid: true,
  },
  {
    version: 6,
    is_active: false,
    created_at: '2026-10-19T10:00:00.000Z',
    created_by: 'bbbbbbbb-2222',
    question_count: 9,
    answer_count: 29,
    sha256: '0123456789abcdef',
    valid: true,
  },
];

interface Stub {
  get?: Record<string, unknown>;
  activate?: { status: number; body: unknown };
  deactivate?: { status: number; body: unknown };
  put?: { status: number; body: unknown };
}

type Call = [string, { method?: string; body?: string } | undefined];

function reply(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

function stubFetch(stub: Stub = {}) {
  const older: QuizDefinition = {
    ...DEF,
    questions: DEF.questions.map((q) =>
      q.id === 'q_home' ? { ...q, prompt_i18n: { ...q.prompt_i18n, en: 'An older prompt' } } : q,
    ),
  };
  const fn = vi.fn((url: string, init?: Call[1]) => {
    if (url.includes('/versions')) {
      if (url.includes('&version=')) {
        return reply(200, { ...VERSION_ROWS[1], definition: older, raw: null, lint: null });
      }
      return reply(200, { tenant_id: TENANT_ID, versions: VERSION_ROWS });
    }
    if (url.includes('/activate')) {
      return reply(stub.activate?.status ?? 200, stub.activate?.body ?? { version: 8 });
    }
    if (url.includes('/deactivate')) {
      return reply(stub.deactivate?.status ?? 200, stub.deactivate?.body ?? {});
    }
    if (init?.method === 'PUT')
      return reply(stub.put?.status ?? 200, stub.put?.body ?? { version: 8 });
    return reply(200, {
      tenant_id: TENANT_ID,
      version: 7,
      definition: DEF,
      warnings: { unreachable_archetypes: [] },
      can_write: true,
      invalid_active: false,
      raw: null,
      lint: null,
      ...stub.get,
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function renderEditor(stub: Stub = {}) {
  const fetchMock = stubFetch(stub);
  render(<StaffQuizDefinitionEditor tenantId={TENANT_ID} />);
  await screen.findByText(/Active version|No saved definition/);
  fireEvent.click(screen.getByTestId('versions-toggle'));
  await screen.findByTestId('version-row-7');
  return fetchMock;
}

const calls = (fn: ReturnType<typeof stubFetch>): Call[] => fn.mock.calls as unknown as Call[];
const putsTo = (fn: ReturnType<typeof stubFetch>, part: string): Call[] =>
  calls(fn).filter((c) => c[1]?.method === 'PUT' && c[0].includes(part));

function textarea(): HTMLTextAreaElement {
  const el = screen.getByTestId('quiz-definition-json');
  if (!(el instanceof HTMLTextAreaElement)) throw new Error('no textarea');
  return el;
}

/** Edit the draft JSON through the Advanced textarea. */
function editDraft(mutate: (d: QuizDefinition) => QuizDefinition): void {
  const next = mutate(JSON.parse(textarea().value) as QuizDefinition);
  fireEvent.change(textarea(), { target: { value: JSON.stringify(next, null, 2) } });
}

const withPrompt = (d: QuizDefinition): QuizDefinition => ({
  ...d,
  questions: d.questions.map((q) =>
    q.id === 'q_home' ? { ...q, prompt_i18n: { ...q.prompt_i18n, en: 'A brand new prompt' } } : q,
  ),
});

function walkToConfirm(): void {
  fireEvent.click(screen.getByTestId('sim-answer-main_here'));
  fireEvent.click(screen.getByTestId('sim-answer-first'));
  fireEvent.click(screen.getByTestId('sim-multi-continue'));
}

const LEAF = 'first_time_buyer';
const ALTS: string[] =
  Object.entries(DEF.confirm?.alternatives ?? {}).find(([k]) => k === LEAF)?.[1] ?? [];
const alt0 = ALTS[0] ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('simulator', () => {
  it('walks the draft in EN to the confirmation screen and shows the alternatives', async () => {
    await renderEditor();
    walkToConfirm();
    expect(screen.getByTestId('sim-breadcrumb').textContent).toContain('→');
    expect(screen.getByTestId('sim-result').textContent).toContain(LEAF);
    const text = screen.getByTestId('sim-confirm-text').textContent;
    expect(text).toContain('Based on your answers:');
    expect(text).toContain('First-time buyer');
    expect(text).toContain('Is that right?');
    fireEvent.click(screen.getByTestId('sim-not-quite'));
    const alts = screen.getByTestId('sim-alternatives');
    expect(ALTS.length).toBeGreaterThanOrEqual(2);
    for (const alt of ALTS) expect(within(alts).getByTestId(`sim-alt-${alt}`)).toBeDefined();
    fireEvent.click(screen.getByTestId(`sim-alt-${alt0}`));
    expect(screen.getByTestId('sim-resolution').textContent).toContain(`corrected to: ${alt0}`);
  });

  it('walks the draft in PL and renders the Polish confirmation copy', async () => {
    await renderEditor();
    fireEvent.click(screen.getByTestId('sim-lang-pl'));
    walkToConfirm();
    const text = screen.getByTestId('sim-confirm-text').textContent;
    expect(text).toContain('Na podstawie Twoich odpowiedzi:');
    expect(text).toContain('Pierwszy własny dom');
    expect(text).toContain('Zgadza się?');
    expect(screen.getByTestId('sim-not-quite').textContent).toBe('Nie do końca');
    fireEvent.click(screen.getByTestId('sim-yes'));
    expect(screen.getByTestId('sim-resolution').textContent).toContain('confirmed');
  });

  it('multi questions render checkboxes', async () => {
    await renderEditor();
    fireEvent.click(screen.getByTestId('sim-answer-main_here'));
    fireEvent.click(screen.getByTestId('sim-answer-first'));
    const box = screen.getByTestId('sim-answer-has_children');
    expect((box as HTMLInputElement).type).toBe('checkbox');
  });

  it('lists every root-to-leaf path and flags ties', async () => {
    await renderEditor();
    expect(screen.getAllByTestId('sim-path-row')).toHaveLength(14);
    expect(screen.queryByTestId('sim-tie')).toBeNull();
    editDraft((d) => ({
      ...d,
      questions: d.questions.map((q) =>
        q.id === 'q_purpose'
          ? {
              ...q,
              answers: q.answers.map((a) =>
                a.id === 'unsure' ? { ...a, weights: { yield_hunter: 1, flip_investor: 1 } } : a,
              ),
            }
          : q,
      ),
    }));
    expect(screen.getAllByTestId('sim-tie').length).toBeGreaterThanOrEqual(1);
  });
});

describe('versions panel', () => {
  it('fetches the history only when opened, and shows a failed read as an error', async () => {
    const fn = stubFetch();
    const inner = fn.getMockImplementation()!;
    fn.mockImplementation((url: string, init?: Call[1]) =>
      url.includes('/versions') ? reply(500, {}) : inner(url, init),
    );
    render(<StaffQuizDefinitionEditor tenantId={TENANT_ID} />);
    await screen.findByText(/Active version/);
    expect(calls(fn).some((c) => c[0].includes('/versions'))).toBe(false);
    fireEvent.click(screen.getByTestId('versions-toggle'));
    await screen.findByText(/Failed to load versions: HTTP 500/);
    expect(screen.queryByText(/No saved versions/)).toBeNull();
  });

  it('lists versions and renders "Diff vs active" human-readably', async () => {
    await renderEditor();
    const row = screen.getByTestId('version-row-7');
    expect(row.textContent).toContain('active');
    expect(row.textContent).toContain('abcdef01');
    expect(row.textContent).toContain('9 / 30');
    fireEvent.click(screen.getByTestId('diff-6'));
    const diff = await screen.findByTestId('version-diff');
    expect(diff.textContent).toContain('Question q_home prompt (EN)');
    expect(diff.textContent).toContain('An older prompt');
  });

  it('Restore confirms, then PUTs activate with from_version and base_version and reloads', async () => {
    const fetchMock = await renderEditor();
    fireEvent.click(screen.getByTestId('restore-6'));
    expect(putsTo(fetchMock, '/activate')).toHaveLength(0);
    const getsBefore = calls(fetchMock).filter((c) => !c[1]?.method).length;
    fireEvent.click(screen.getByTestId('versions-confirm-confirm'));
    await waitFor(() => {
      expect(putsTo(fetchMock, '/activate')).toHaveLength(1);
    });
    const body = JSON.parse(putsTo(fetchMock, '/activate')[0]![1]!.body!) as unknown;
    expect(body).toEqual({ from_version: 6, base_version: 7 });
    await waitFor(() => {
      expect(calls(fetchMock).filter((c) => !c[1]?.method).length).toBeGreaterThan(getsBefore);
    });
  });

  it('a 409 on restore shows the reload prompt and changes nothing', async () => {
    const fetchMock = await renderEditor({
      activate: { status: 409, body: { error: { code: 'version_conflict' } } },
    });
    fireEvent.click(screen.getByTestId('restore-6'));
    fireEvent.click(screen.getByTestId('versions-confirm-confirm'));
    const banner = await screen.findByTestId('versions-conflict');
    expect(banner.textContent).toContain('Reload');
    const getsBefore = calls(fetchMock).filter((c) => !c[1]?.method).length;
    fireEvent.click(screen.getByTestId('versions-reload'));
    await waitFor(() => {
      expect(calls(fetchMock).filter((c) => !c[1]?.method).length).toBeGreaterThan(getsBefore);
    });
  });

  it('Revert to built-in default needs a confirm, then PUTs deactivate with base_version', async () => {
    const fetchMock = await renderEditor();
    fireEvent.click(screen.getByTestId('revert-default'));
    expect(putsTo(fetchMock, '/deactivate')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('versions-confirm-confirm'));
    await waitFor(() => {
      expect(putsTo(fetchMock, '/deactivate')).toHaveLength(1);
    });
    expect(JSON.parse(putsTo(fetchMock, '/deactivate')[0]![1]!.body!)).toEqual({
      base_version: 7,
    });
  });

  it('cancelling the confirm sends nothing', async () => {
    const fetchMock = await renderEditor();
    fireEvent.click(screen.getByTestId('revert-default'));
    fireEvent.click(screen.getByTestId('versions-confirm-cancel'));
    expect(screen.queryByTestId('versions-confirm')).toBeNull();
    expect(putsTo(fetchMock, '/deactivate')).toHaveLength(0);
  });
});

describe('publish dialog', () => {
  it('shows the diff vs the active version and the propagation notice, then PUTs', async () => {
    const fetchMock = await renderEditor();
    editDraft(withPrompt);
    fireEvent.click(screen.getByTestId('publish-open'));
    const dialog = screen.getByTestId('publish-dialog');
    expect(within(dialog).getByTestId('publish-diff').textContent).toContain('A brand new prompt');
    const notice = within(dialog).getByTestId('publish-propagation').textContent;
    expect(notice).toContain('about 6 minutes');
    expect(notice).toContain('max-age=300');
    expect(notice).toContain('already open keep their cached quiz');
    expect(putsTo(fetchMock, 'quiz-definition?')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('publish-dialog-confirm'));
    await screen.findByText('Definition saved!');
    const put = putsTo(fetchMock, 'quiz-definition?')[0]!;
    expect(JSON.parse(put[1]!.body!)).toMatchObject({ base_version: 7, source: 'editor' });
  });

  it('cancel sends nothing', async () => {
    const fetchMock = await renderEditor();
    fireEvent.click(screen.getByTestId('publish-open'));
    fireEvent.click(screen.getByTestId('publish-dialog-cancel'));
    expect(screen.queryByTestId('publish-dialog')).toBeNull();
    expect(putsTo(fetchMock, 'quiz-definition?')).toHaveLength(0);
  });
});

describe('local draft', () => {
  it('offers to restore a newer stored draft, and Restore loads it', async () => {
    const stored = JSON.stringify(withPrompt(DEF), null, 2);
    window.localStorage.setItem(
      draftKey(TENANT_ID, 7),
      JSON.stringify({ text: stored, saved_at: '2026-10-20T11:00:00.000Z' }),
    );
    await renderEditor();
    expect(screen.getByTestId('local-draft-prompt')).toBeDefined();
    expect(textarea().value).not.toBe(stored);
    fireEvent.click(screen.getByTestId('restore-local-draft'));
    expect(textarea().value).toBe(stored);
    expect(screen.queryByTestId('local-draft-prompt')).toBeNull();
  });

  it('Discard drops the stored draft', async () => {
    window.localStorage.setItem(
      draftKey(TENANT_ID, 7),
      JSON.stringify({ text: JSON.stringify(withPrompt(DEF)), saved_at: '' }),
    );
    await renderEditor();
    fireEvent.click(screen.getByTestId('discard-local-draft'));
    expect(window.localStorage.getItem(draftKey(TENANT_ID, 7))).toBeNull();
    expect(screen.queryByTestId('local-draft-prompt')).toBeNull();
  });

  it('a draft stored against another base version is not offered', async () => {
    window.localStorage.setItem(
      draftKey(TENANT_ID, 6),
      JSON.stringify({ text: JSON.stringify(withPrompt(DEF)), saved_at: '' }),
    );
    await renderEditor();
    expect(screen.queryByTestId('local-draft-prompt')).toBeNull();
  });

  it('autosaves edits and clears the stored draft after a successful publish', async () => {
    await renderEditor();
    expect(window.localStorage.getItem(draftKey(TENANT_ID, 7))).toBeNull();
    editDraft(withPrompt);
    await waitFor(() => {
      expect(window.localStorage.getItem(draftKey(TENANT_ID, 7))).not.toBeNull();
    });
    fireEvent.click(screen.getByTestId('publish-open'));
    fireEvent.click(screen.getByTestId('publish-dialog-confirm'));
    await screen.findByText('Definition saved!');
    expect(window.localStorage.getItem(draftKey(TENANT_ID, 7))).toBeNull();
    expect(window.localStorage.getItem(draftKey(TENANT_ID, 8))).toBeNull();
  });

  it('guards unload only while the draft differs from the loaded version', async () => {
    await renderEditor();
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    editDraft(withPrompt);
    await waitFor(() => {
      const dirty = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(dirty);
      expect(dirty.defaultPrevented).toBe(true);
    });
  });

  it('survives a throwing localStorage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await renderEditor();
    editDraft(withPrompt);
    expect(textarea().value).toContain('A brand new prompt');
  });
});

function fileOf(content: string, name = 'quiz.json'): File {
  return new File([content], name, { type: 'application/json' });
}

function pickFile(file: File): void {
  fireEvent.change(screen.getByTestId('import-file'), { target: { files: [file] } });
}

describe('import / export', () => {
  it('rejects a file that is not JSON and leaves the draft alone', async () => {
    const fetchMock = await renderEditor();
    const before = textarea().value;
    pickFile(fileOf('{ nope'));
    const errors = await screen.findByTestId('import-errors');
    expect(errors.textContent).toContain('Not valid JSON');
    expect(textarea().value).toBe(before);
    expect(putsTo(fetchMock, 'quiz-definition?')).toHaveLength(0);
  });

  it('rejects a definition that fails authoring validation, listing the issues', async () => {
    await renderEditor();
    const before = textarea().value;
    pickFile(
      fileOf(JSON.stringify({ schema_version: 1, root: 'x', languages: ['en'], questions: [] })),
    );
    const errors = await screen.findByTestId('import-errors');
    expect(errors.querySelectorAll('li').length).toBeGreaterThan(0);
    expect(textarea().value).toBe(before);
  });

  it('notes dropped unknown keys, loads into the draft only, then publishes with source "import"', async () => {
    const fetchMock = await renderEditor();
    const withExtra = withPrompt({ ...DEF });
    const file = fileOf(JSON.stringify({ ...withExtra, mystery_field: 1 }));
    pickFile(file);
    const ok = await screen.findByTestId('import-ok');
    expect(ok.textContent).toContain('not published');
    expect(screen.getByTestId('import-dropped').textContent).toContain('mystery_field');
    expect(textarea().value).toContain('A brand new prompt');
    expect(textarea().value).not.toContain('mystery_field');
    expect(putsTo(fetchMock, 'quiz-definition?')).toHaveLength(0);

    fireEvent.click(screen.getByTestId('publish-open'));
    expect(screen.getByTestId('publish-dialog').textContent).toContain('imported file');
    fireEvent.click(screen.getByTestId('publish-dialog-confirm'));
    await screen.findByText('Definition saved!');
    expect(JSON.parse(putsTo(fetchMock, 'quiz-definition?')[0]![1]!.body!)).toMatchObject({
      source: 'import',
    });
  });

  it('exports the current draft as JSON that imports back unchanged', async () => {
    await renderEditor();
    editDraft(withPrompt);
    const blobs: Blob[] = [];
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn((b: Blob) => {
          blobs.push(b);
          return 'blob:test';
        }),
        revokeObjectURL: vi.fn(),
      }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByTestId('export-draft'));
    expect(blobs).toHaveLength(1);
    const exported = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => {
        resolve(typeof r.result === 'string' ? r.result : '');
      };
      r.readAsText(blobs[0]!);
    });
    expect(exported).toBe(textarea().value);

    editDraft(() => DEF);
    pickFile(fileOf(exported));
    await screen.findByTestId('import-ok');
    expect(textarea().value).toContain('A brand new prompt');
    expect(screen.queryByTestId('import-dropped')).toBeNull();
  });
});

describe('read-only mode', () => {
  it('keeps simulator, versions list, diff and export; hides every write control', async () => {
    await renderEditor({ get: { can_write: false } });
    expect(screen.getByTestId('read-only-banner')).toBeDefined();
    expect(screen.getByTestId('quiz-simulator')).toBeDefined();
    expect(screen.getByTestId('export-draft')).toBeDefined();
    expect(screen.getByTestId('diff-6')).toBeDefined();
    expect(screen.queryByTestId('publish-open')).toBeNull();
    expect(screen.queryByTestId('import-draft')).toBeNull();
    expect(screen.queryByTestId('import-file')).toBeNull();
    expect(screen.queryByTestId('revert-default')).toBeNull();
    expect(screen.queryByTestId('restore-6')).toBeNull();
    expect(textarea().disabled).toBe(true);
  });
});
