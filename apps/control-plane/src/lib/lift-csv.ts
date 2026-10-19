/**
 * CSV rendering of the lift report (FOLLOW-1338, ruling D-K): one flat table, one row per
 * (section, date, arm), columns = the Pilot tab's figures.
 *
 *   - `summary` rows (2, adapted + holdout): the rolling window the panel shows — same counts the
 *     "Conversion Lift" panel is built from (`LiftResponse.conversion_breakdown` / `summary`).
 *   - `daily` rows (2 per UTC day, oldest first): the trend, from the per-day reader that also
 *     feeds `lift_daily_snapshots` (`buildLiftDayRows`).
 *
 * Rates are PERCENT (rate x 100, 2 dp) like the panel's "3.12%"; `relative_lift_pct` is the relative
 * lift in % (empty when the holdout rate is 0 - undefined, not 0). The adapted-vs-holdout lift,
 * p-value and confidence are carried on BOTH arm rows of a block.
 *
 * Injection (OWASP "CSV injection"): a STRING cell whose first character is `=`, `+`, `-`, `@`, tab
 * or CR gets a leading `'` so a spreadsheet reads text, not a formula. Numbers are emitted from
 * `number` values only (never from text), so `-12.5` stays a number.
 *
 * @module apps/control-plane/src/lib/lift-csv
 */

import type {
  ArmBreakdown,
  LiftDayRow,
  LiftResponse,
} from '@/app/api/dashboard/analytics/lift/route-helpers';

/** The header row, in order. */
const LIFT_CSV_COLUMNS = [
  'section',
  'date',
  'arm',
  'sessions',
  'conversions',
  'conversion_rate_pct',
  'live_signups',
  'live_signup_rate_pct',
  'agent_contacts',
  'agent_contact_rate_pct',
  'relative_lift_pct',
  'p_value',
  'confidence',
  'data_source',
  'conversion_source',
] as const;

type Cell = string | number | null;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** One RFC 4180 cell: injection-safe, quoted when it holds a delimiter, quote or line break. */
function csvCell(value: Cell): string {
  if (value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function pct(count: number | null, sessions: number): number | null {
  if (count === null) return null;
  return sessions > 0 ? Math.round((count / sessions) * 10000) / 100 : 0;
}

interface Provenance {
  data_source: LiftResponse['data_source'];
  conversion_source: LiftResponse['conversion_source'];
}

/**
 * @param report - the lift reader's response for the window (summary block).
 * @param daily  - the per-day rows for the same window (empty when no per-day data exists, e.g. the
 *   unconfigured mock state - never fabricated).
 */
export function buildLiftCsv(report: LiftResponse, daily: readonly LiftDayRow[]): string {
  const prov: Provenance = {
    data_source: report.data_source,
    conversion_source: report.conversion_source,
  };
  const lines: Cell[][] = [[...LIFT_CSV_COLUMNS]];

  const summaryRow = (arm: 'adapted' | 'holdout', b: ArmBreakdown | undefined): Cell[] => {
    const s = report.summary;
    return [
      'summary',
      null,
      arm,
      b?.sessions ??
        (arm === 'adapted' ? (s?.adapted_sessions ?? null) : (s?.holdout_sessions ?? null)),
      b?.conversions ?? null,
      b ? pct(b.conversions, b.sessions) : null,
      b?.live_signups ?? null,
      b ? pct(b.live_signups, b.sessions) : null,
      b?.agent_contacts ?? null,
      b ? pct(b.agent_contacts, b.sessions) : null,
      s?.relative_lift_pct ?? null,
      s?.p_value ?? null,
      s?.confidence ?? null,
      prov.data_source,
      prov.conversion_source,
    ];
  };
  lines.push(summaryRow('adapted', report.conversion_breakdown?.adapted));
  lines.push(summaryRow('holdout', report.conversion_breakdown?.holdout));

  for (const r of daily) {
    lines.push([
      'daily',
      r.day,
      r.arm,
      r.sessions,
      r.conversions,
      pct(r.conversions, r.sessions),
      r.live_signups,
      pct(r.live_signups, r.sessions),
      r.agent_contacts,
      pct(r.agent_contacts, r.sessions),
      r.relative_lift_pct,
      r.p_value,
      r.confidence,
      prov.data_source,
      prov.conversion_source,
    ]);
  }
  return lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
