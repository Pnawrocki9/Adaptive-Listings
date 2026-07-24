# Admin surface audit — admin.estalara.com (control-plane) — 2026-07-24

**Author:** PM orchestrator (session 57) · **Method:** 4 parallel read-only Explore probes,
code-traced with file:line evidence, classifying every admin + tenant-dashboard page/control as
WIRED / FACADE (producer-only or mock-shown-as-real) / BROKEN / READ-ONLY. **Scope:** ~18 `admin/**`
pages + ~12 `dashboard/**` pages + ~50 API routes.

## Bottom line

The admin surface is **mostly WIRED and honest.** Mock data appears only when a backing env var is
unset (dev/CI), is deterministic, tagged `data_source:'mock'`, badged "MOCK DATA" in the UI, and
routes fail-loud (500, no silent mock) when the env IS configured. Of ~30 surfaces, only a **handful
are genuinely incomplete** — listed below. This is the definitive done-list.

## Real gaps (need work)

| Gap                                                                                                                                                                                      | Sev               | Type                                | Evidence                                                                                        | Status                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `allowed_origins` written by settings page, enforced NOWHERE (ingest CORS is hardcoded env list); advertised as SDK-origin security control                                              | **P1**            | FACADE (security-shaped)            | `api/config/route.ts:299`; `ingest/src/router.ts:69-73`; `MASTER_DESIGN §V.3.4`                 | **FOLLOW-622** (open, needs enforce-vs-de-scope decision)                                                     |
| `brand_config` (colors/logo/white-label) written by settings page, zero runtime consumers                                                                                                | **P1**            | FACADE (producer-only)              | `api/config/route.ts`; grep: no reader                                                          | **FOLLOW-623** (open, decision)                                                                               |
| Demo-session **revoke** writes `revoked_at` but the runtime gate `verifyDemoJwt` never checks it → a revoked demo token keeps serving until its JWT `exp` (up to 7d)                     | **P2** (security) | FACADE (producer-only)              | `demo/sessions/[id]/revoke/route.ts:75-79`; `demo-jwt-verify.ts:104-122`; `adapt/route.ts:1142` | **FOLLOW-636** (filed 2026-07-24)                                                                             |
| Bandit A/B "learning" is FROZEN in prod (feedback 503-gated) → `ab_bandit_weights.estimated_rate` static 0.5 forever; analytics dashboard renders these with NO "not-learning" indicator | **P2**            | mock-shown-as-real (real-but-inert) | `adapt/feedback/route.ts:262-269`; `dashboard/analytics/page.tsx:630`; audit F-02               | **FOLLOW-637** (filed 2026-07-24). Real fix = operator flip `FEEDBACK_ENDPOINT_ENABLED` (FOLLOW-450 / Wave 0) |
| `/api/config` missing-row returns fabricated defaults @200; 0-row PATCH returns "saved"                                                                                                  | P3                | correctness                         | `api/config/route.ts:186-191`                                                                   | **FOLLOW-627** (open)                                                                                         |

## Operational / non-code (Piotr-side)

- **Confirm prod envs set** — `CLICKHOUSE_URL`, `DATABASE_URL_ADMIN`/`_DIRECT`. Every analytics/
  audit/labels/pilot surface silently shows badged deterministic mock when its env is unset; in a
  prod deploy missing an env, realistic-looking KPIs render (mitigated only by the badge). Verify
  presence in every non-dev deploy.
- **Un-freeze the bandit** — flip `FEEDBACK_ENDPOINT_ENABLED=true` (Wave 0, FOLLOW-450 code merged).
  Until then A/B analytics is inert (see FOLLOW-637 for the honesty indicator meanwhile).
- **Chat un-shadow** — ESC-042 (`modal deploy apps/intent-engine` + `MODAL_CHAT_NLP_URL` wiring).
- **Reconcile migration 0015 status** — the tracer probe found `backlog/ESCALATIONS.md:617` says
  0015 IS applied to prod; the earlier MOAT probe cited `backlog/STATUS.md:3437` "OPERATOR-PENDING".
  These conflict. Verify actual prod ClickHouse state (`intent_events` count) and fix whichever
  backlog record is stale. Affects the "intent_events prod count=0" claim.

## Honest stubs / future features (NOT deceptive — low priority)

- Detection dashboard "Edit manually" / "Save & activate" buttons are `alert()` placeholders
  self-labeled "coming in AUTO-007/008" (`dashboard/detection/page.tsx:344-360`). The REAL wired
  activate path is the onboarding wizard (`/api/schema/activate` flips `tenants.status`→active).
- Demo-sessions "Force Stop" + registrations "Approve/Reject" buttons are `disabled` with
  explanatory tooltips — honest, not facades.
- `p95Latency` always renders "—" on the real path (column absent, FOLLOW-445).
- Dead code: `lib/demo-session-store.ts` (zero importers) — safe to delete.

## Verified WIRED / honest (no action) — the bulk of the surface

- **Settings:** generation-model picker (global, CEO-locked) → WIRED end-to-end to Modal generation.
- **On/off AL:** `al_enabled` + audited toggle + runtime enforcement → WIRED (FOLLOW-633, this
  session).
- **Config editors** (settings/quiz/demo, admin + dashboard): data-loss-safe (FOLLOW-624/630).
- **Analytics / lift / audit / labels** (admin + dashboard): real ClickHouse/Postgres, fail-loud,
  badged mock only when env unset. Label reclassify feeds calibration + the LoRA corpus (real
  consumer).
- **Intent-weight config** (per-tenant + global, incl. `admin/tracer/weights`): WIRED — SDK reads it
  and applies to the Bayesian archetype classifier at cold-start.
- **Tracer** (sessions/history/export/SSE stream): real CH `intent_events` + PG `intent_sessions`,
  honest `data_source` badges, fail-loud/503 when unconfigured. Producer = ingest Worker dual-write.
- **Pilot dashboard:** real CH queries, fail-loud, badged mock in dev; shows honest zero (not
  fabricated) in prod with empty tables.
- **Detection / onboarding activate / listing answers:** real persistence.
- **Demo mockup:** honestly labeled demo, not masquerading as live.
- **Tenant list/detail, admin home, demo-sessions display, registrations display:** READ-ONLY real
  data.

## Plan to finish admin.estalara.com

1. **CEO decision (gating):** enforce-vs-de-scope for FOLLOW-622 (`allowed_origins`) + FOLLOW-623
   (`brand_config`). These are the only P1s and both are product calls.
2. **Fix (workers), after (1):** FOLLOW-622/623 per decision; FOLLOW-636 (revoke enforcement);
   FOLLOW-637 (bandit-frozen indicator); FOLLOW-627 (missing-row).
3. **Operational (Piotr):** confirm prod envs; flip `FEEDBACK_ENDPOINT_ENABLED`; ESC-042 chat
   deploy; reconcile 0015 status.
4. **Hygiene:** delete `demo-session-store.ts`; file future-feature stubs (AUTO-007/008, FOLLOW-445)
   if still wanted.
