'use client';

/**
 * /dashboard/listings/:id/answers — Agency FAQ answer management UI.
 *
 * Allows agency staff to create, edit, and delete per-listing FAQ answers.
 * These answers are stored with OpenAI embeddings and retrieved via cosine
 * similarity RAG at adapt time to populate `listingContext` in the LLM prompt.
 *
 * @module apps/control-plane/src/app/dashboard/listings/[id]/answers/page
 */

import { useEffect, useState, use } from 'react';

interface AnswerRow {
  id: string;
  tenantId: string;
  listingId: string;
  question: string;
  answer: string;
  createdAt: string;
  updatedAt: string;
}

interface EditState {
  answerId: string;
  question: string;
  answer: string;
}

export default function AnswersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: listingId } = use(params);

  const [answers, setAnswers] = useState<AnswerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Add-form state
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');
  const [addStatus, setAddStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [addError, setAddError] = useState('');

  // Edit state — null means no row is being edited
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editStatus, setEditStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [editError, setEditError] = useState('');

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // We derive tenantId from the JWT embedded in the cookie (the dashboard
  // middleware injects x-tenant-id for us, but for fetch() calls to the API
  // we rely on the browser sending the sb-access-token cookie automatically).
  // The `:id` route param is the listing's external identifier, not the tenant.
  // The tenant ID required for the API path comes from the JWT claims which the
  // middleware resolves and embeds as x-tenant-id. We read it from a meta tag
  // injected by the dashboard layout (fallback: empty string forces 403).
  function getTenantId(): string {
    if (typeof document === 'undefined') return '';
    const meta = document.querySelector<HTMLMetaElement>('meta[name="x-tenant-id"]');
    return meta?.content ?? '';
  }

  async function loadAnswers(): Promise<void> {
    setLoading(true);
    setError('');
    const tenantId = getTenantId();
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/answers?listing_id=${encodeURIComponent(listingId)}`,
      );
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? 'Failed to load answers.');
        return;
      }
      const data = (await res.json()) as AnswerRow[];
      setAnswers(data);
    } catch {
      setError('Network error. Please refresh.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAnswers();
  }, [listingId]); // listingId is the only external dep — loadAnswers reads it via closure

  async function handleAdd(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setAddStatus('saving');
    setAddError('');
    const tenantId = getTenantId();
    try {
      const res = await fetch(`/api/tenants/${tenantId}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listingId, question: newQuestion, answer: newAnswer }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setAddError(body.error ?? 'Failed to save.');
        setAddStatus('error');
        return;
      }
      setNewQuestion('');
      setNewAnswer('');
      setAddStatus('idle');
      await loadAnswers();
    } catch {
      setAddError('Network error. Please try again.');
      setAddStatus('error');
    }
  }

  async function handleEdit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!editState) return;
    setEditStatus('saving');
    setEditError('');
    const tenantId = getTenantId();
    try {
      const res = await fetch(`/api/tenants/${tenantId}/answers/${editState.answerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: editState.question, answer: editState.answer }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setEditError(body.error ?? 'Failed to update.');
        setEditStatus('error');
        return;
      }
      setEditState(null);
      setEditStatus('idle');
      await loadAnswers();
    } catch {
      setEditError('Network error. Please try again.');
      setEditStatus('error');
    }
  }

  async function handleDelete(answerId: string): Promise<void> {
    setDeletingId(answerId);
    const tenantId = getTenantId();
    try {
      const res = await fetch(`/api/tenants/${tenantId}/answers/${answerId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? 'Failed to delete.');
        return;
      }
      await loadAnswers();
    } catch {
      setError('Network error. Could not delete.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">FAQ Answers</h1>
        <p className="mt-1 text-sm text-gray-500">
          Listing: <span className="font-mono font-medium">{listingId}</span>
        </p>
        <p className="mt-1 text-sm text-gray-500">
          Add question/answer pairs that help buyers get relevant, personalised copy. These answers
          are retrieved at adapt time and injected into the AI prompt.
        </p>
      </div>

      {/* Add form */}
      <div className="mb-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Add Answer</h2>
        <form onSubmit={(e) => void handleAdd(e)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Question</label>
            <textarea
              required
              rows={2}
              value={newQuestion}
              onChange={(e) => {
                setNewQuestion(e.target.value);
              }}
              placeholder="e.g. What is the rental yield?"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Answer</label>
            <textarea
              required
              rows={3}
              value={newAnswer}
              onChange={(e) => {
                setNewAnswer(e.target.value);
              }}
              placeholder="e.g. 6.5% gross yield based on current market rent."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {addStatus === 'error' && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{addError}</div>
          )}
          <button
            type="submit"
            disabled={addStatus === 'saving'}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {addStatus === 'saving' ? 'Saving…' : 'Add Answer'}
          </button>
        </form>
      </div>

      {/* List */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : answers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
          <p className="text-sm font-medium text-gray-600">
            No FAQ answers yet. Add the first one to help buyers get relevant copy.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {answers.map((row) =>
            editState?.answerId === row.id ? (
              // Edit form inline
              <li key={row.id} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-blue-300">
                <form onSubmit={(e) => void handleEdit(e)} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Question</label>
                    <textarea
                      required
                      rows={2}
                      value={editState.question}
                      onChange={(e) => {
                        setEditState((s) => (s ? { ...s, question: e.target.value } : null));
                      }}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Answer</label>
                    <textarea
                      required
                      rows={3}
                      value={editState.answer}
                      onChange={(e) => {
                        setEditState((s) => (s ? { ...s, answer: e.target.value } : null));
                      }}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  {editStatus === 'error' && (
                    <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                      {editError}
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={editStatus === 'saving'}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {editStatus === 'saving' ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditState(null);
                        setEditStatus('idle');
                      }}
                      className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </li>
            ) : (
              <li key={row.id} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
                <div className="mb-2 flex items-start justify-between gap-4">
                  <p className="text-sm font-semibold text-gray-900">{row.question}</p>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditState({
                          answerId: row.id,
                          question: row.question,
                          answer: row.answer,
                        });
                        setEditStatus('idle');
                      }}
                      className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={deletingId === row.id}
                      onClick={() => void handleDelete(row.id)}
                      className="rounded border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {deletingId === row.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-600">{row.answer}</p>
                <p className="mt-2 text-xs text-gray-400">
                  Updated {new Date(row.updatedAt).toLocaleDateString()}
                </p>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
