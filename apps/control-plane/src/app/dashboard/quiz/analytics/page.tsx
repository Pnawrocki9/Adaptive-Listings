/**
 * /dashboard/quiz/analytics — agency quiz analytics (FOLLOW-1000). The view itself lives in
 * `components/analytics/quiz-analytics-view` and is shared with the "Quiz" tab of
 * `/admin/tenants/[id]/analytics` (FOLLOW-1334); this route only mounts it session-scoped.
 *
 * @module apps/control-plane/src/app/dashboard/quiz/analytics/page
 */

import { QuizAnalyticsView } from '@/components/analytics/quiz-analytics-view';

export default function QuizAnalyticsPage() {
  return <QuizAnalyticsView />;
}
