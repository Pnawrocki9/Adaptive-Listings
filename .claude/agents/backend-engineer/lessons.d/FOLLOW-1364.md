- **2026-10-20 / FOLLOW-1364** · Built `/api/cron/quiz-retention` (13-month purge of `quiz_runs` +
  `quiz_completions`, batched CTE deletes, CRON_SECRET auth, 42P01 tolerated and reported). · Risks
  weighed: mutating cron needs auth in the same PR (secretEquals, idempotent as replay defense);
  Sentry gets a rebuilt Error with SQLSTATE only, never the drizzle error; a Next route file must
  not export non-handler constants (kept the window const module-private). · Guardrail I'd add: a
  gate that fails when a retention number in ROPA/DPIA/notice/handover differs from the cron's
  constant (today the sync is by hand).
