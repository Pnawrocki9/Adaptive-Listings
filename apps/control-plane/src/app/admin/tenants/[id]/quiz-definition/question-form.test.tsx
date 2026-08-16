/**
 * Tests for QuizQuestionForm (FOLLOW-1003) — the structured question editor over
 * a quiz draft, plus its pure update helpers.
 *
 * The integration half (typing in the form updates the JSON textarea and
 * round-trips) lives in quiz-definition-editor.test.tsx alongside the other
 * editor flows; this file covers the component in isolation and the helpers.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/question-form.test
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { QuizDefinition } from '@estalara/shared';

import { QuizQuestionForm, updateLabel, updatePrompt } from './question-form';

const DEF: QuizDefinition = {
  schema_version: 1,
  root: 'q_gate',
  languages: ['en'],
  questions: [
    {
      id: 'q_gate',
      prompt_i18n: { en: 'What are you looking for?' },
      answers: [
        {
          id: 'a_invest',
          label_i18n: { en: 'Investment property' },
          weights: { yield_hunter: 0.4 },
          next: 'q_focus',
        },
        { id: 'a_skip', label_i18n: { en: 'Just browsing' }, weights: {}, next: null },
      ],
    },
    {
      id: 'q_focus',
      prompt_i18n: { en: 'What is your focus?' },
      answers: [
        {
          id: 'a_yield',
          label_i18n: { en: 'Rental income' },
          weights: { yield_hunter: 1 },
          next: null,
        },
        {
          id: 'a_flip',
          label_i18n: { en: 'Flip / renovation' },
          weights: { flip_investor: 1 },
          next: null,
        },
      ],
    },
  ],
};

describe('updatePrompt / updateLabel (pure helpers)', () => {
  it('updatePrompt replaces only the targeted question prompt (en), immutably', () => {
    const out = updatePrompt(DEF, 'q_focus', 'New question?');
    expect(out.questions[1]!.prompt_i18n.en).toBe('New question?');
    expect(out.questions[0]!.prompt_i18n.en).toBe('What are you looking for?');
    expect(DEF.questions[1]!.prompt_i18n.en).toBe('What is your focus?'); // input untouched
    // Everything else preserved verbatim.
    expect(out.questions[1]!.answers).toEqual(DEF.questions[1]!.answers);
    expect(out.root).toBe('q_gate');
  });

  it('updateLabel replaces only the targeted answer label (en), immutably', () => {
    const out = updateLabel(DEF, 'q_focus', 'a_yield', 'Passive rental income');
    expect(out.questions[1]!.answers[0]!.label_i18n.en).toBe('Passive rental income');
    // Weights and branching on the edited answer untouched.
    expect(out.questions[1]!.answers[0]!.weights).toEqual({ yield_hunter: 1 });
    expect(out.questions[1]!.answers[1]!.label_i18n.en).toBe('Flip / renovation');
    expect(DEF.questions[1]!.answers[0]!.label_i18n.en).toBe('Rental income');
  });
});

describe('QuizQuestionForm', () => {
  it('renders every question and answer as inputs, with weights and branching visible', () => {
    render(<QuizQuestionForm definition={DEF} onChange={() => undefined} />);

    expect(screen.getByTestId('qf-prompt-q_gate')).toHaveProperty(
      'value',
      'What are you looking for?',
    );
    expect(screen.getByTestId('qf-label-q_focus-a_flip')).toHaveProperty(
      'value',
      'Flip / renovation',
    );
    // Weights summary and branching are visible context.
    expect(screen.getByText('yield_hunter: 1')).toBeDefined();
    expect(screen.getByText('→ q_focus')).toBeDefined();
    expect(screen.getAllByText('END').length).toBeGreaterThanOrEqual(1);
    // Root badge on the root question only.
    expect(screen.getByText('root')).toBeDefined();
  });

  it('typing in a prompt input calls onChange with the updated definition', () => {
    const onChange = vi.fn();
    render(<QuizQuestionForm definition={DEF} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('qf-prompt-q_focus'), {
      target: { value: 'What is your investment focus?' },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as QuizDefinition;
    expect(next.questions[1]!.prompt_i18n.en).toBe('What is your investment focus?');
  });

  it('typing in an answer label calls onChange with the updated definition', () => {
    const onChange = vi.fn();
    render(<QuizQuestionForm definition={DEF} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('qf-label-q_gate-a_skip'), {
      target: { value: 'Only looking around' },
    });
    const next = onChange.mock.calls[0]![0] as QuizDefinition;
    expect(next.questions[0]!.answers[1]!.label_i18n.en).toBe('Only looking around');
  });
});
