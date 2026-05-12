'use client';

/**
 * Site Detection page — Detection Preview UI (AUTO-006).
 *
 * Allows a tenant to paste a URL and run the auto-detection engine against it.
 * Results are shown in two panels:
 *   - Left:  Detection result summary (technique, confidence, selectors, data extractors)
 *   - Right: Raw `TenantSiteSchema` JSON preview
 *
 * States handled:
 *   1. initial   — URL input, no results yet
 *   2. loading   — spinner while fetch + detection runs
 *   3. not_impl  — detection engine not yet deployed (AUTO-003 pending)
 *   4. success   — detection results shown
 *   5. error     — generic error banner
 *
 * @module apps/control-plane/src/app/dashboard/detection/page
 */

import React, { useState } from 'react';
import type { DetectionResult } from '@estalara/sdk/auto-detect';

// ─── Types ────────────────────────────────────────────────────────────────────

type PageState =
  | { status: 'initial' }
  | { status: 'loading' }
  | { status: 'not_impl' }
  | { status: 'error'; message: string }
  | { status: 'success'; result: DetectionResult };

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center gap-2 text-blue-600">
      <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      <span className="text-sm font-medium">Detecting schema…</span>
    </div>
  );
}

interface ConfidenceBadgeProps {
  confidence: number;
}

function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 80
      ? 'bg-green-100 text-green-800'
      : pct >= 60
        ? 'bg-yellow-100 text-yellow-800'
        : 'bg-red-100 text-red-800';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}
    >
      {pct}%
    </span>
  );
}

interface ExtractorTableProps {
  extractors: Record<string, { primary?: string; type?: string }>;
}

function ExtractorTable({ extractors }: ExtractorTableProps) {
  const entries = Object.entries(extractors);
  if (entries.length === 0) {
    return <p className="text-xs text-gray-400 italic">No extractors detected</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              Field
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              Selector
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              Type
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {entries.map(([field, strat]) => (
            <tr key={field}>
              <td className="px-3 py-2 font-mono text-xs text-gray-700">{field}</td>
              <td className="px-3 py-2 font-mono text-xs text-blue-700">{strat.primary ?? '—'}</td>
              <td className="px-3 py-2 text-xs text-gray-500">{strat.type ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SiteDetectionPage() {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<PageState>({ status: 'initial' });

  async function handleDetect(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!url.trim()) return;

    setState({ status: 'loading' });

    try {
      const res = await fetch('/api/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), tenant_id: 'anonymous' }),
      });

      if (res.status === 501) {
        setState({ status: 'not_impl' });
        return;
      }

      if (!res.ok) {
        const body = (await res.json()) as ApiErrorBody;
        setState({
          status: 'error',
          message: body.error?.message ?? `Request failed with status ${String(res.status)}`,
        });
        return;
      }

      const result = (await res.json()) as DetectionResult;
      setState({ status: 'success', result });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unexpected network error',
      });
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Site Detection</h1>
        <p className="mt-1 text-sm text-gray-500">
          Paste a listing page URL to auto-detect the site schema. The engine identifies CSS
          selectors for listing cards, prices, headlines, and more.
        </p>
      </div>

      {/* URL input */}
      <form onSubmit={(e) => void handleDetect(e)} className="mb-6 flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
          }}
          placeholder="https://www.example.com/properties"
          required
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={state.status === 'loading'}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
              clipRule="evenodd"
            />
          </svg>
          Detect
        </button>
      </form>

      {/* State: loading */}
      {state.status === 'loading' && (
        <div className="flex items-center justify-center py-16">
          <Spinner />
        </div>
      )}

      {/* State: not_impl — AUTO-003 not yet merged */}
      {state.status === 'not_impl' && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-5 py-4">
          <div className="flex gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="text-sm font-semibold text-yellow-800">Detection engine deploying</p>
              <p className="mt-1 text-sm text-yellow-700">
                Detection engine is being deployed. This page will be fully functional after
                AUTO-003 is merged.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* State: error */}
      {state.status === 'error' && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-5 py-4">
          <div className="flex gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="mt-0.5 h-5 w-5 shrink-0 text-red-500"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="text-sm font-semibold text-red-800">Detection failed</p>
              <p className="mt-1 text-sm text-red-700">{state.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* State: success — two-panel layout */}
      {state.status === 'success' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Left panel — Detection Results */}
          <div className="space-y-5">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-gray-800">Detection Summary</h2>

              <dl className="space-y-3">
                <div className="flex items-center justify-between">
                  <dt className="text-xs font-medium text-gray-500">Technique</dt>
                  <dd className="font-mono text-xs text-gray-800">{state.result.technique}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-xs font-medium text-gray-500">Confidence</dt>
                  <dd>
                    <ConfidenceBadge confidence={state.result.confidence} />
                  </dd>
                </div>
                {state.result.schema ? (
                  <>
                    <div className="flex items-center justify-between">
                      <dt className="text-xs font-medium text-gray-500">Listing card selector</dt>
                      <dd className="max-w-[55%] truncate text-right font-mono text-xs text-blue-700">
                        {state.result.schema.index_schema.listing_card_selector}
                      </dd>
                    </div>
                    {state.result.schema.index_schema.container_selector && (
                      <div className="flex items-center justify-between">
                        <dt className="text-xs font-medium text-gray-500">Container selector</dt>
                        <dd className="max-w-[55%] truncate text-right font-mono text-xs text-blue-700">
                          {state.result.schema.index_schema.container_selector}
                        </dd>
                      </div>
                    )}
                    {state.result.schema.framework_hint && (
                      <div className="flex items-center justify-between">
                        <dt className="text-xs font-medium text-gray-500">Framework</dt>
                        <dd className="text-xs text-gray-700">
                          {state.result.schema.framework_hint}
                        </dd>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
                    Schema is null — confidence below threshold. Manual review needed.
                  </div>
                )}
              </dl>
            </div>

            {/* Data extractors table */}
            {state.result.schema && (
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold text-gray-800">
                  Data Extractors (per card)
                </h2>
                <ExtractorTable
                  extractors={
                    state.result.schema.index_schema.data_extractors_per_card as Record<
                      string,
                      { primary?: string; type?: string }
                    >
                  }
                />
              </div>
            )}

            {/* Action buttons */}
            {state.result.schema && (
              <div className="flex gap-3">
                <button
                  type="button"
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  onClick={() => {
                    // Placeholder — inline edit modal in AUTO-007+
                    alert('Manual edit coming in AUTO-007');
                  }}
                >
                  Edit manually
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                  onClick={() => {
                    // Placeholder — save + activate will be wired in AUTO-008
                    alert('Save & activate coming in AUTO-008');
                  }}
                >
                  Save & activate
                </button>
              </div>
            )}

            {/* Non-fatal warnings */}
            {state.result.warnings.length > 0 && (
              <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
                <p className="mb-1 text-xs font-semibold text-orange-800">
                  Detection warnings ({state.result.warnings.length})
                </p>
                <ul className="list-inside list-disc space-y-0.5">
                  {state.result.warnings.map((w: string, i: number) => (
                    <li key={i} className="text-xs text-orange-700">
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Right panel — Schema JSON preview */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-800">
              Raw Schema JSON
              <span className="ml-2 text-xs font-normal text-gray-400">
                (visual overlay available after AUTO-004)
              </span>
            </h2>
            {state.result.schema ? (
              <pre className="max-h-[560px] overflow-auto rounded-lg bg-gray-950 p-4 text-xs text-green-400">
                {JSON.stringify(state.result.schema, null, 2)}
              </pre>
            ) : (
              <div className="flex h-48 items-center justify-center rounded-lg bg-gray-100 text-sm text-gray-500">
                No schema to display — detection returned null.
              </div>
            )}
          </div>
        </div>
      )}

      {/* State: initial — placeholder when nothing has been run yet */}
      {state.status === 'initial' && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 py-20 text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="mb-3 h-10 w-10 text-gray-400"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 0z"
            />
          </svg>
          <p className="text-sm font-medium text-gray-700">No detection run yet</p>
          <p className="mt-1 max-w-xs text-xs text-gray-400">
            Enter a URL above and click Detect to analyse the site schema.
          </p>
        </div>
      )}
    </div>
  );
}
