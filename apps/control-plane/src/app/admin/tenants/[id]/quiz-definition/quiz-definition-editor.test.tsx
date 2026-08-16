/**
 * Tests for StaffQuizDefinitionEditor (FOLLOW-639 / ADR-0019 D7).
 *
 * The editor validates the definition CLIENT-SIDE with the SAME schema the server enforces:
 *   - HARD integrity errors (unknown archetype id) block Save and render a visible alert.
 *   - the NON-BLOCKING unreachable-archetype warning renders without blocking Save.
 *   - a failed initial GET is visibly distinguished and disables Save (no clobber).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/quiz-definition-editor.test
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { QuizDefinition } from '@estalara/shared';

import { StaffQuizDefinitionEditor } from './quiz-definition-editor';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';

// A valid definition reaching only yield_hunter + flip_investor (rest unreachable → warning).
const VALID_DEF: QuizDefinition = {
  schema_version: 1,
  root: 'q_gate',
  languages: ['en'],
  questions: [
    {
      id: 'q_gate',
      prompt_i18n: { en: 'What are you after?' },
      answers: [
        { id: 'a_yield', label_i18n: { en: 'Yield' }, weights: { yield_hunter: 1 }, next: null },
        { id: 'a_flip', label_i18n: { en: 'Flip' }, weights: { flip_investor: 1 }, next: null },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StaffQuizDefinitionEditor', () => {
  it('loads the active definition and shows the non-blocking unreachable warning', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            tenant_id: TENANT_ID,
            version: 2,
            definition: VALID_DEF,
            warnings: { unreachable_archetypes: ['student_parent'] },
          }),
      }),
    );

    render(<StaffQuizDefinitionEditor tenantId={TENANT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('unreachable-warning')).toBeDefined();
    });
    // Save is enabled for a valid definition.
    const saveButton = screen.getByRole('button', { name: /save definition/i });
    expect(saveButton).toHaveProperty('disabled', false);
  });

  it('HARD error (unknown archetype) renders a blocking alert and disables Save', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            tenant_id: TENANT_ID,
            version: 1,
            definition: VALID_DEF,
            warnings: { unreachable_archetypes: [] },
          }),
      }),
    );

    render(<StaffQuizDefinitionEditor tenantId={TENANT_ID} />);
    const textarea = await screen.findByTestId('quiz-definition-json');

    const badDef = structuredClone(VALID_DEF);
    badDef.questions[0]!.answers[0]!.weights = { not_real: 1 };
    fireEvent.change(textarea, { target: { value: JSON.stringify(badDef) } });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    const saveButton = screen.getByRole('button', { name: /save definition/i });
    expect(saveButton).toHaveProperty('disabled', true);
  });

  it('shows an error and disables Save when the initial GET fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal error' }),
      }),
    );

    render(<StaffQuizDefinitionEditor tenantId={TENANT_ID} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    const saveButton = screen.getByRole('button', { name: /save definition/i });
    expect(saveButton).toHaveProperty('disabled', true);
  });
});

/** Narrow the draft textarea via instanceof — survives both tsc and eslint's
 *  no-unnecessary-type-assertion autofix (a plain `as` cast does not). */
function getDraftTextarea(): HTMLTextAreaElement {
  const el = screen.getByTestId('quiz-definition-json');
  if (!(el instanceof HTMLTextAreaElement)) throw new Error('draft textarea not found');
  return el;
}

// ─── FOLLOW-1002 — LLM weight suggestions (suggest → review → apply) ─────────

describe('StaffQuizDefinitionEditor — suggest weights (FOLLOW-1002)', () => {
  it('POSTs the draft, renders proposals + rejections, and Apply merges weights into the JSON', async () => {
    const fetchMock = vi
      .fn()
      // initial GET
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ tenant_id: TENANT_ID, version: 1, definition: VALID_DEF }),
      })
      // suggest POST
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            model: 'claude-sonnet-4-6',
            suggestions: [
              {
                question_id: 'q_gate',
                answer_id: 'a_yield',
                weights: { yield_hunter: 0.9, portfolio_builder: 0.3 },
                rationale: 'Yield answer signals income-driven investing.',
              },
            ],
            rejected: [{ question_id: 'q_gate', answer_id: 'a_bogus', reason: 'no such pair' }],
          }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffQuizDefinitionEditor tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('suggest-weights')).toHaveProperty('disabled', false);
    });

    fireEvent.click(screen.getByTestId('suggest-weights'));
    await waitFor(() => {
      expect(screen.getByTestId('weight-suggestions')).toBeDefined();
    });

    // The POST went to the suggest endpoint with the CURRENT draft, tenant-fenced.
    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as { method?: string } | undefined)?.method === 'POST',
    );
    expect(String(postCall![0])).toContain('/suggest-weights');
    expect(String(postCall![0])).toContain(`tenant_id=${TENANT_ID}`);
    const postBody = JSON.parse((postCall![1] as { body: string }).body) as {
      definition: QuizDefinition;
    };
    expect(postBody.definition.root).toBe('q_gate');

    // Rationale + rejection are visible for review.
    expect(screen.getByText(/income-driven investing/)).toBeDefined();
    expect(screen.getByText(/no such pair/)).toBeDefined();

    // Apply merges the weights into the textarea draft — persistence untouched.
    fireEvent.click(screen.getByTestId('apply-suggestions'));
    const draft = JSON.parse(getDraftTextarea().value) as QuizDefinition;
    expect(draft.questions[0]!.answers[0]!.weights).toEqual({
      yield_hunter: 0.9,
      portfolio_builder: 0.3,
    });
    // Untargeted answer untouched; no PUT was issued by Apply.
    expect(draft.questions[0]!.answers[1]!.weights).toEqual({ flip_investor: 1 });
    expect(
      fetchMock.mock.calls.some((c) => (c[1] as { method?: string } | undefined)?.method === 'PUT'),
    ).toBe(false);
  });

  it('a failed suggest renders a visible error and leaves the draft untouched', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ tenant_id: TENANT_ID, version: 1, definition: VALID_DEF }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: () =>
          Promise.resolve({ error: { code: 'llm_unavailable', message: 'model call failed' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<StaffQuizDefinitionEditor tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('suggest-weights')).toHaveProperty('disabled', false);
    });
    const before = getDraftTextarea().value;

    fireEvent.click(screen.getByTestId('suggest-weights'));
    await waitFor(() => {
      expect(screen.getByText(/model call failed/)).toBeDefined();
    });
    expect(getDraftTextarea().value).toBe(before);
    expect(screen.queryByTestId('weight-suggestions')).toBeNull();
  });
});

// ─── FOLLOW-1003 — structured question form (form ↔ JSON round-trip) ─────────

describe('StaffQuizDefinitionEditor — question form (FOLLOW-1003)', () => {
  it('typing in the form updates the JSON draft; JSON edits flow back into the form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ tenant_id: TENANT_ID, version: 1, definition: VALID_DEF }),
      }),
    );

    render(<StaffQuizDefinitionEditor tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('question-form')).toBeDefined();
    });

    // Form edit → JSON textarea reflects it.
    fireEvent.change(screen.getByTestId('qf-prompt-q_gate'), {
      target: { value: 'Czego szukasz?' },
    });
    const draft = JSON.parse(getDraftTextarea().value) as QuizDefinition;
    expect(draft.questions[0]!.prompt_i18n.en).toBe('Czego szukasz?');
    // Weights untouched by a text edit.
    expect(draft.questions[0]!.answers[0]!.weights).toEqual({ yield_hunter: 1 });

    // JSON edit → form input reflects it (same state, both directions).
    const asJson = JSON.parse(getDraftTextarea().value) as QuizDefinition;
    asJson.questions[0]!.answers[0]!.label_i18n.en = 'Wynajem (yield)';
    fireEvent.change(getDraftTextarea(), {
      target: { value: JSON.stringify(asJson, null, 2) },
    });
    expect(screen.getByTestId('qf-label-q_gate-a_yield')).toHaveProperty(
      'value',
      'Wynajem (yield)',
    );
  });

  it('invalid JSON hides the form with a visible note instead of editing a broken draft', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ tenant_id: TENANT_ID, version: 1, definition: VALID_DEF }),
      }),
    );

    render(<StaffQuizDefinitionEditor tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('question-form')).toBeDefined();
    });

    fireEvent.change(getDraftTextarea(), { target: { value: '{ not valid json' } });
    expect(screen.queryByTestId('question-form')).toBeNull();
    expect(screen.getByTestId('question-form-unavailable')).toBeDefined();
  });
});
