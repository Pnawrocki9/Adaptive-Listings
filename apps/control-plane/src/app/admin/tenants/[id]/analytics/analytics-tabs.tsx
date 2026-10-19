'use client';

/**
 * AnalyticsTabs — the tab strip of `/admin/tenants/[id]/analytics` (FOLLOW-1334).
 *
 * "Overview" is the server-rendered five-panel A/B view plus the decision-telemetry panels (passed
 * in as `overview`, so the server page keeps owning the tenant lookup and the rollup read). "Pilot"
 * (adapted vs holdout CTA lift, inquiry starts, funnel, per-archetype lift) and "Quiz" (quiz
 * completions) are the two surfaces the agency `/dashboard` had that `/admin` did not; both mount
 * the SAME shared components the agency pages use, with an explicit `tenantId` so every GET carries
 * `tenant_id` and the staff-override routes fence their queries to that tenant (ADR-0018 §1).
 *
 * Only the selected tab mounts, so an unopened tab issues no requests.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/analytics/analytics-tabs
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

import { PilotView } from '@/components/analytics/pilot-view';
import { QuizAnalyticsView } from '@/components/analytics/quiz-analytics-view';

export type AnalyticsTabId = 'overview' | 'pilot' | 'quiz';

const TABS: readonly { id: AnalyticsTabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'pilot', label: 'Pilot' },
  { id: 'quiz', label: 'Quiz' },
];

/** Narrow an untrusted `?tab=` value to a tab id (anything else → Overview). */
export function parseAnalyticsTab(raw: string | undefined): AnalyticsTabId {
  return TABS.some((t) => t.id === raw) ? (raw as AnalyticsTabId) : 'overview';
}

export interface AnalyticsTabsProps {
  tenantId: string;
  initialTab: AnalyticsTabId;
  /** The server-rendered Overview content. */
  overview: ReactNode;
}

export function AnalyticsTabs({ tenantId, initialTab, overview }: AnalyticsTabsProps) {
  const [tab, setTab] = useState<AnalyticsTabId>(initialTab);

  return (
    <div>
      <div role="tablist" aria-label="Analytics views" className="mb-6 flex gap-2 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.id
                ? 'border-purple-600 text-purple-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && overview}
      {tab === 'pilot' && <PilotView tenantId={tenantId} />}
      {tab === 'quiz' && <QuizAnalyticsView tenantId={tenantId} />}
    </div>
  );
}
