# AI Council Checkpoint — Sprint 12 Definition

**Date:** 2026-05-24  
**Session:** `~/ai-council/sessions/20260524_224944`  
**Decision maker:** Piotr Nawrocki (CEO)  
**Approved sprint:** Sprint 12 — Controlled pilot launch on app.estalara.com  
**Sprint theme:** "Controlled pilot launch on app.estalara.com. Lane A hardening completes
pilot-critical infrastructure (ClickHouse DSR integration test, cron auth, demo CI fail-loud, DSR
alerting). Lane B onboards app.estalara.com via Magic Link + shadow mode. Lane C measures CTA lift +
inquiry starts vs holdout."

---

## Decision Memo Summary

Sprint 11 delivered all 5 P1 pilot-blockers (FOLLOW-063/068/069/039/040). The EU pilot gate is
cleared (RODO Art. 17 ClickHouse hard-delete shipped, VERCEL_CRON_SECRET provisioned). The AI
Council Checkpoint assessed readiness for a controlled pilot launch and approved Sprint 12.

**Decision:** Launch a controlled pilot on app.estalara.com (Estalara's own domain) rather than an
external tenant. This de-risks the first real-traffic run: the team controls the site, can roll back
immediately, and owns incident response. Pilot is free (no billing infrastructure needed). Scope is
EU-region-only per existing infrastructure verification.

---

## Blocking Questions Resolved by Piotr

| Question                   | Resolution                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| Which site for the pilot?  | app.estalara.com (own domain, maximum control)                                                 |
| Paid or free pilot?        | Free — no billing infrastructure needed for Sprint 12                                          |
| Which region first?        | EU (infrastructure verified via FOLLOW-081 scope; full multi-jurisdiction compliance deferred) |
| Production or staging?     | Production (app.estalara.com is production)                                                    |
| Who owns incidents?        | Piotr Nawrocki                                                                                 |
| Primary metric?            | CTA lift (adapted sessions vs 10% holdout)                                                     |
| Secondary metric?          | Inquiry starts                                                                                 |
| VERCEL_CRON_SECRET status? | Provisioned in Vercel + Doppler 2026-05-24                                                     |

---

## Top 3 Risks Confirmed

1. **ClickHouse mutation-poll contract unverified (FOLLOW-081, P1).** The Vercel-Cron poller shipped
   by FOLLOW-039 polls `system.mutations` to detect erasure completion. No integration test
   exercises this against a real ClickHouse instance — only unit mocks. Until FOLLOW-081 ships, EU
   pilot confidence in the Art. 17 erasure flow depends on code inspection alone. **Mitigation:**
   FOLLOW-081 is the first Lane A gate; Lane B cannot start until it passes.

2. **demo-integration CI still soft-skips (FOLLOW-079).** After FOLLOW-068, the E2E CI job exists
   but silently exits 0 without running tests (pending ESC-009 secret provisioning). A regression in
   the detect→activate→adapt→SDK chain would not be caught by CI until FOLLOW-079 flips this to
   fail-loud. **Mitigation:** FOLLOW-079 is in Lane A; ESC-009 manual secret provisioning (~20 min)
   unblocks it.

3. **Shadow mode window required before live adaptation.** Lane B specifies 3-5 days of shadow mode
   (adaptation runs but no DOM mutations injected) to collect baseline behavioral data before CTA
   lift measurement begins. If this window is skipped, the holdout comparison lacks a meaningful
   pre-pilot baseline. **Mitigation:** TICKET-PILOT-001 explicitly requires shadow mode validation
   before activation; TICKET-PILOT-002 runbook includes a go/no-go checklist enforcing this.

---

## Sprint Scope Agreed

**10 tickets across 3 lanes + 2 P2 carry-overs:**

### Lane A — Pilot-critical hardening (P1, gates Lane B)

- FOLLOW-081: ClickHouse mutation-poll integration test (data-engineer, 3h, opus-4.7-xhigh)
- FOLLOW-079: Tighten demo-integration.yml fail-loud (devops-engineer, 1h, sonnet-4.6)
- FOLLOW-075: VERCEL_CRON_SECRET enforcement on /api/dsr/mutation-poll (backend-engineer +
  compliance-engineer, 1h, sonnet-4.6)
- FOLLOW-078: DSR failure alerting via Sentry (compliance-engineer + devops-engineer, 1.5h,
  sonnet-4.6)

### Lane B — Pilot onboarding on app.estalara.com (P1, blocked until Lane A complete)

- TICKET-PILOT-001: SDK install + Magic Link activation + shadow mode 3-5 days (sdk-engineer +
  backend-engineer, 4h, sonnet-4.6)
- TICKET-PILOT-002: Activation runbook + go/no-go checklist + incident response (architect, 2h,
  sonnet-4.6)

### Lane C — Pilot ROI instrumentation (P1, parallel with Lane B)

- TICKET-PILOT-003: CTA lift dashboard — baseline vs adapted, holdout comparison, conversion funnel
  (data-engineer, 4h, opus-4.7-xhigh)
- TICKET-PILOT-004: Inquiry starts tracking — event mapping + dashboard panel (backend-engineer, 2h,
  sonnet-4.6)

### P2 carry-over from Sprint 11

- FOLLOW-073: Master Design §V.3.3 INTERNAL_API_SECRET threat model (compliance-engineer, 1h,
  sonnet-4.6)
- FOLLOW-074: README local dev setup (architect, 1h, sonnet-4.6)

---

## References

- Sprint 12 tickets: `backlog/QUEUE.md` Sprint 12 section
- Master Design v2.5: `docs/MASTER_DESIGN.md` §Snapshot.1 Update 2026-05-24 (Sprint 12 OPEN)
- Sprint 11 retro: `backlog/RETROSPECTIVES.md` RETRO-007
- RETRO-007 follow-ups: `backlog/FOLLOW_UPS.md` FOLLOW-075..085
- ESC-009 (E2E_BEARER_TOKEN provisioning): `backlog/ESCALATIONS.md`
