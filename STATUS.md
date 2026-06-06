# PM Orchestrator Status

**Last updated:** 2026-06-06

## Current sprint: Sprint 15 OPEN

**21 tickets total in `backlog/sprint-15/` (FOLLOW-191 through FOLLOW-211). 5 new Track E signal
enrichment tickets added 2026-06-06.**

Tracks:

- Track A (Pilot unblock, Week 1): FOLLOW-191 (P0), FOLLOW-192 (P0), FOLLOW-193 (P0), FOLLOW-194
  (P1) — all READY
- Track B (Signal bridges + Quiz v2.0, Week 2–3): FOLLOW-195 (P0), FOLLOW-196 (P0), FOLLOW-197 (P0),
  FOLLOW-198 (P1), FOLLOW-199 (P1), FOLLOW-200 (P1), FOLLOW-201 (P1), FOLLOW-202 (P2) — all READY
- Track C (Description cache redesign, Week 3–4): FOLLOW-203 (P1), FOLLOW-204 (P1) — both READY
- Track D (Background, Week 4–5): FOLLOW-205 (P2), FOLLOW-206 (P3) — both READY
- Track E (Signal enrichment, Week 2–3): FOLLOW-207 (P2), FOLLOW-208 (P2), FOLLOW-209 (P2),
  FOLLOW-210 (P1), FOLLOW-211 (P1) — all READY. FOLLOW-209 depends_on FOLLOW-199. FOLLOW-210 is
  co-assigned (Estalara-app CustomEvent + SDK listener); PM must run step 5d integration check
  before READY_FOR_REVIEW.

## Open escalations (age in days)

| ESC     | Title                                                                  | Filed      | Age |
| ------- | ---------------------------------------------------------------------- | ---------- | --- |
| ESC-009 | Provision E2E_BEARER_TOKEN GitHub Actions secret                       | 2026-05-24 | 12d |
| ESC-010 | DOPPLER_TOKEN_DEV must be provisioned in GitHub Actions                | 2026-05-24 | 12d |
| ESC-019 | Production listing-details API requires auth (descriptions ungrounded) | 2026-06-03 | 2d  |

ESC-019 is addressed by FOLLOW-192 (Sprint 15, P0). ESC-009 and ESC-010 are infrastructure secrets
requiring human action — they do not block Sprint 15 tickets that are independent of Doppler/E2E CI.

## CI check counter (current session)

No active PRs being validated this session. CI check counter: 0/5. Fix iteration counter: 0/3.

## Human decisions required before Sprint 15 can fully execute

- **Audit Q2**: Internal URL vs service token for listing-details API (blocks FOLLOW-192)
- **Audit Q3**: Vercel Pro plan confirmation for DSR cron restore (blocks FOLLOW-193 cron half)
- **Audit Q4**: Is ChatBot visible to buyer role users? (affects FOLLOW-196 scope)
- **ESC-009**: E2E_BEARER_TOKEN provisioning (affects CI for QA tickets)
- **ESC-010**: DOPPLER_TOKEN_DEV provisioning (affects CI for tickets using Doppler)
