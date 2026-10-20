'use client';

/**
 * useSuggestWeights — FOLLOW-1002 "Suggest weights (AI)" (extracted from the editor in
 * FOLLOW-1362 C3): asks the LLM for weight proposals derived from the CURRENT draft and merges
 * ONLY weights into it on Apply. Nothing persists until the audited Publish.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/use-suggest-weights
 */

import { useState } from 'react';

import type { QuizDefinition, QuizLintIssue } from '@estalara/shared';

import { applySuggestions } from './apply-suggestions';
import type { SuggestResponse } from './weight-suggestions-panel';

/** The error envelope of a failed write (`409 version_conflict`, `400 validation_failed`, …). */
export interface WriteErrorBody {
  error?:
    | string
    | { code?: string; message?: string; issues?: QuizLintIssue[]; active_version?: number | null };
}

export function errorOf(
  body: WriteErrorBody,
  fallback: string,
): { code?: string | undefined; message: string } {
  if (typeof body.error === 'string') return { message: body.error };
  return { code: body.error?.code, message: body.error?.message ?? fallback };
}

export function useSuggestWeights({
  tenantId,
  definition,
  loaded,
  onApply,
}: {
  tenantId: string;
  definition: QuizDefinition | null;
  loaded: boolean;
  /** Receives the draft with the proposed weights merged in. */
  onApply: (merged: QuizDefinition) => void;
}) {
  // `suggest` holds the LAST proposal set; it is cleared on apply (the draft now embodies it)
  // but deliberately kept across hand-edits so staff can compare while tweaking.
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);
  const url = `/api/admin/tenants/quiz-definition/suggest-weights?tenant_id=${encodeURIComponent(tenantId)}`;

  async function request(): Promise<void> {
    if (definition === null || !loaded) return;
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as WriteErrorBody;
        setErrorMsg(errorOf(body, 'Failed to get suggestions.').message);
        setStatus('error');
        return;
      }
      setSuggest((await res.json()) as SuggestResponse);
      setStatus('idle');
    } catch {
      setErrorMsg('Network error. Please try again.');
      setStatus('error');
    }
  }

  function apply(): void {
    if (definition === null || suggest === null) return;
    onApply(applySuggestions(definition, suggest.suggestions));
    setSuggest(null);
  }

  return { status, errorMsg, suggest, request, apply };
}
