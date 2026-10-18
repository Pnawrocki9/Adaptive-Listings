/**
 * Tests for DecisionTelemetryPanels — the scoring-path (FOLLOW-560) and reorder-withheld
 * (FOLLOW-1220) panels FOLLOW-1330 moved from the removed `/admin/analytics` page to the tenant
 * hub's Analytics page. Ported from that page's T3/T5–T9; the assertions are unchanged in intent:
 * a 'disabled' or 'error' source renders a REASON, never a fabricated zero.
 *
 * @module apps/control-plane/src/components/analytics/decision-telemetry-panels.test
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TenantAnalyticsRollup } from '@/app/api/admin/analytics/rollup/data';
import { DecisionTelemetryPanels } from './decision-telemetry-panels';

const LIVE_DATA: TenantAnalyticsRollup = {
  tenant_id: '11111111-1111-1111-1111-111111111111',
  window_days: 7,
  generated_at: '2026-07-24T00:00:00.000Z',
  rollup: {
    sessions: 250,
    adapted: 200,
    holdout: 50,
    ctaLift: 15.25,
    conversions: {
      adaptedN: 200,
      holdoutN: 50,
      adaptedConversions: 9,
      holdoutConversions: 1,
      preExposureConversions: 0,
      unsignedConversions: 2,
      ctaClickedSessions: 30,
    },
    quizCompletions: 30,
  },
  data_source: 'clickhouse',
  conversion_source: 'signed_events',
  quiz_data_source: 'live',
  scoringPathSplit: { cosine: 12, djb2_fallback: 7, djb2_guard: 5, not_applicable: 3 },
  scoring_path_source: 'live',
  reorderWithheld: {
    embeddings_missing: 41,
    embeddings_not_attempted: 13,
    embeddings_lookup_failed: 6,
  },
  reorder_withheld_source: 'live',
};

describe('DecisionTelemetryPanels — FOLLOW-560 / FOLLOW-1220 (moved by FOLLOW-1330)', () => {
  it('fail loud: a failed rollup renders its error and no panel', () => {
    render(
      <DecisionTelemetryPanels
        result={{ ok: false, status: 500, error: 'ClickHouse rollup query failed: HTTP 500' }}
      />,
    );

    expect(screen.getByText(/Error loading decision telemetry/i)).toBeDefined();
    expect(screen.getByText(/ClickHouse rollup query failed/i)).toBeDefined();
    expect(screen.queryByText(/scoring_path:/)).toBeNull();
    expect(screen.queryByText('cosine')).toBeNull();
    expect(screen.queryByText('withheld: embeddings missing')).toBeNull();
  });

  it('scoring path live: renders the four counts and the real-ranking share', () => {
    render(<DecisionTelemetryPanels result={{ ok: true, data: LIVE_DATA }} />);

    expect(screen.getByText('scoring_path: live')).toBeDefined();
    expect(screen.getByText('cosine')).toBeDefined();
    expect(screen.getByText('no cosine: embeddings missing')).toBeDefined();
    expect(screen.getByText('no cosine: not attempted')).toBeDefined();
    // 12 of the 24 RANKED decisions (cosine + both djb2 paths) used real embeddings; the 3
    // 'not_applicable' rows never built a ReorderDirective and are excluded from the share.
    expect(screen.getByText('50.0%')).toBeDefined();
  });

  it('scoring path disabled: renders the reason, never a zero split', () => {
    render(
      <DecisionTelemetryPanels
        result={{
          ok: true,
          data: { ...LIVE_DATA, scoringPathSplit: null, scoring_path_source: 'disabled' },
        }}
      />,
    );

    expect(screen.getByText('scoring_path: disabled')).toBeDefined();
    expect(screen.getByText(/SCORING_PATH_COLUMN_ENABLED is not set/i)).toBeDefined();
    expect(screen.getByText(/migration 0022/i)).toBeDefined();
    expect(screen.queryByText('no cosine: embeddings missing')).toBeNull();
  });

  it('scoring path error: renders an error reason distinct from the disabled one', () => {
    render(
      <DecisionTelemetryPanels
        result={{
          ok: true,
          data: { ...LIVE_DATA, scoringPathSplit: null, scoring_path_source: 'error' },
        }}
      />,
    );

    expect(screen.getByText('scoring_path: error')).toBeDefined();
    expect(screen.getByText(/scoring_path query failed/i)).toBeDefined();
    expect(screen.queryByText(/SCORING_PATH_COLUMN_ENABLED is not set/i)).toBeNull();
  });

  it('reorder withheld live: renders every reason count, with scoring_path disabled', () => {
    render(
      <DecisionTelemetryPanels
        result={{
          ok: true,
          data: { ...LIVE_DATA, scoringPathSplit: null, scoring_path_source: 'disabled' },
        }}
      />,
    );

    expect(screen.getByText('reorder_withheld: live')).toBeDefined();
    expect(screen.getByText('withheld: embeddings missing')).toBeDefined();
    expect(screen.getByText('41')).toBeDefined();
    expect(screen.getByText('withheld: not attempted')).toBeDefined();
    expect(screen.getByText('13')).toBeDefined();
    expect(screen.getByText('withheld: lookup failed')).toBeDefined();
    expect(screen.getByText('6')).toBeDefined();
  });

  it('reorder withheld error: renders a reason and no counts, never a zero', () => {
    render(
      <DecisionTelemetryPanels
        result={{
          ok: true,
          data: { ...LIVE_DATA, reorderWithheld: null, reorder_withheld_source: 'error' },
        }}
      />,
    );

    expect(screen.getByText('reorder_withheld: error')).toBeDefined();
    expect(screen.getByText(/reorder_withheld query failed/i)).toBeDefined();
    expect(screen.queryByText('withheld: embeddings missing')).toBeNull();
  });
});
