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
