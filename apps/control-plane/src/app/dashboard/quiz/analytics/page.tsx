// TODO Sprint 5: fetch real data from ClickHouse

import { DAILY_COMPLETIONS, QUIZ_STATS } from './mock-data';

const completionRate = Math.round((QUIZ_STATS.completions / QUIZ_STATS.impressions) * 100);
const maxDaily = Math.max(...DAILY_COMPLETIONS.map((d) => d.count));

export default function QuizAnalyticsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Quiz Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">
          Last 30 days · Mock data — real data available in Sprint 5
        </p>
      </div>

      {/* Stats row */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-2xl font-bold text-gray-900">{QUIZ_STATS.impressions}</div>
          <div className="mt-0.5 text-xs text-gray-500">Impressions</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-2xl font-bold text-gray-900">{QUIZ_STATS.completions}</div>
          <div className="mt-0.5 text-xs text-gray-500">Completions</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-2xl font-bold text-blue-600">{completionRate}%</div>
          <div className="mt-0.5 text-xs text-gray-500">Completion Rate</div>
        </div>
        <div className="rounded-xl border border-green-100 bg-green-50 p-4">
          <div className="text-2xl font-bold text-green-700">
            +{QUIZ_STATS.conversion_lift_pct}%
          </div>
          <div className="mt-0.5 text-xs text-green-600">Inquiry Lift</div>
        </div>
      </div>

      {/* Daily completions chart */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">
          Daily Completions — Last 7 Days
        </h2>
        <div className="flex items-end gap-2 h-32">
          {DAILY_COMPLETIONS.map(({ day, count }) => (
            <div key={day} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-xs text-gray-600">{count}</span>
              <div
                className="w-full rounded-t bg-blue-500"
                style={{ height: `${String(Math.round((count / maxDaily) * 100))}%` }}
              />
              <span className="text-xs text-gray-400">{day}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Archetype distribution */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">Archetype Distribution</h2>
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex justify-between text-xs text-gray-600">
              <span>Investor</span>
              <span>{QUIZ_STATS.investor_pct}%</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-purple-500"
                style={{ width: `${String(QUIZ_STATS.investor_pct)}%` }}
              />
            </div>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs text-gray-600">
              <span>Personal / Family</span>
              <span>{QUIZ_STATS.personal_pct}%</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-blue-400"
                style={{ width: `${String(QUIZ_STATS.personal_pct)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Conversion lift */}
      <div className="rounded-xl border border-green-200 bg-green-50 p-5">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Conversion Lift</h2>
        <p className="text-sm text-gray-600">
          Listings shown to visitors who completed the quiz had a{' '}
          <strong className="text-green-700">
            +{QUIZ_STATS.conversion_lift_pct}% inquiry rate
          </strong>{' '}
          compared to listings shown without quiz completion.
        </p>
        <p className="mt-2 text-xs text-gray-400">
          Mock data — real attribution analysis in Sprint 5
        </p>
      </div>
    </div>
  );
}
