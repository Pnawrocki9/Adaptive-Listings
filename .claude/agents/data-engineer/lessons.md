# Data Engineer — Lessons Learned

---

## 2026-06-08 / FOLLOW-234

**What I built:** Vercel cron route `GET /api/internal/retention/conversion-labels` (schedule
`0 2 * * *`) that deletes `conversion_labels` rows where `labeled_at < NOW() - 13 months`, using the
same CRON_SECRET auth + fail-loud (Rule K.2) pattern as the existing DSR mutation-poll cron. Added
route to `vercel.json` crons array. Exported `thirteenMonthsAgo()` helper for testability. Updated
ROPA Retention Schedule (v2.3) and DPIA §2.5 (v2.5) to confirm enforcement is live.

**Vocabulary/seed/retention risks I weighed:**

- No new table — the `conversionLabels` schema already existed (migration 0019). The cron is the
  writer/enforcer for a retention promise that was previously aspirational. Self-check: writer
  evidence is the `db.delete(conversionLabels).where(lt(...))` call in the route.
- Chose `labeled_at` (not `created_at`) as the retention anchor — matches the ROPA/DPIA spec and
  HANDOFFS.md language ("from `labeled_at`"), and labeled_at is set by the CRM ingest webhook at the
  moment of label creation, so it correctly bounds the training pair's age.
- Chose calendar-month arithmetic (`setMonth(m - 13)`) over a fixed ms constant so the boundary
  doesn't drift against leap years. Documented and tested.
- The "nightly TTL cron" referenced in ropa.md for session_embeddings/engagement_scores also does
  not exist yet — but that's out of scope for FOLLOW-234. Did not introduce a new aspirational
  reference; the engagement_scores schema docstring still says "FOLLOW-193 AC1 — requires Vercel
  Pro, gated on CEO Q3 confirmation." Did not touch that.

**A guardrail I'd add:** When a compliance doc retention table row says "enforced by nightly cron"
but no cron route exists in `apps/control-plane/src/app/api/`, a CI check should flag the gap (grep
for cron path in vercel.json, confirm route file exists). This would have caught the
session_embeddings/engagement_scores aspirational cron reference before it drifted.
