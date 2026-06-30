# PM Orchestrator — Session Status

**Date:** 2026-06-30 **Session:** FOLLOW-435 promoted to QUEUE.md (READY, co-assigned
backend-engineer+ml-engineer, P2). 0/3 in flight.

---

## Open Escalations (ages)

| ESC     | Title                                                     | Filed      | Age | Blocker?                                                               |
| ------- | --------------------------------------------------------- | ---------- | --- | ---------------------------------------------------------------------- |
| ESC-020 | Estalara-app DOM hooks committed but not deployed to prod | 2026-06-06 | 23d | Non-blocking per CEO 2026-06-10; Rafal (CTO) action required to deploy |
| ESC-028 | Redis shadow smoke secrets not provisioned                | 2026-06-23 | 6d  | Non-blocking (soft-skip, no CI failure); Piotr/Rafal action required   |

All other escalations ESC-001 through ESC-033 RESOLVED (ESC-032 resolved Phase 2; ESC-033 resolved
by FOLLOW-431 + prod verification).

---

## IN_PROGRESS tickets (0/3 max)

None. FOLLOW-434 closed this session. Next candidates: FOLLOW-435 (P2, durable Modal seed job,
backend-engineer+ml-engineer), FOLLOW-429 (P2, decision-api ctx.waitUntil, backend-engineer).

---

## CI check counter (current session)

FOLLOW-433 (PR #383): DONE — CI verified green; baseline non-blocking only (Rule I ×2 + Archetype
embeddings ×2). Counter closed at 1/5 CI checks, 0/3 fix iterations.

FOLLOW-434 (PR #385): DONE — CI verified green by human before merge; 1355/1355 tests; FF-sink guard
PASS; lint/typecheck/build green. Baseline non-blocking only (Rule I + Archetype embeddings —
pre-existing on main; Format fixed by PR #386). Counter closed at 1/5 CI checks, 0/3 fix iterations.

---

## Recent merges (most recent first)

- PR #386 (Format fix, pm-orchestrator): prettier-fix bookkeeping files to unblock Format check on
  main. Merged 2026-06-30 (bd60ffc).
- PR #385 (FOLLOW-434, backend-engineer): Cap seedListingEmbeddingsForActivation inline loop at
  MAX_INLINE_SEED=50 + Sentry overflow capture + JSDoc fix. 1355/1355 tests; FF-sink guard PASS.
  Merged 2026-06-30 (squash 3a226b4). RETRO-141 written. FOLLOW-435 filed.
- PR #383 (FOLLOW-433, backend-engineer): Wrapped 3 surviving ff sinks in afterResponse()
  (updateArmAsync + upsertConversionLabelAsync in feedback/route.ts, deleteSessionFromRedis in
  dsr/erase/route.ts). Added scripts/check-fire-and-forget-sinks.sh + CI hard-gate job. 62/62 tests
  passing. Merged 2026-06-29T17:35:35Z (squash). RETRO-140 written.
- PR #381 (FOLLOW-432, backend-engineer): Swept 6 control-plane fire-and-forget sinks into
  afterResponse(), added after-response.ts unit test, corrected FOLLOW-431 AC-1. Merged 2026-06-29.
  RETRO-139 written (spawned FOLLOW-433 + FOLLOW-434).
- PR #380 (ESC-033 verification runbook, devops-engineer): docs only. Merged 2026-06-29.
- PR #379 (FOLLOW-431, backend-engineer): Wrap 5 control-plane fire-and-forget sinks in after().
  Merged 2026-06-29. RETRO-138 written (spawned FOLLOW-432).
- PR #378 (FOLLOW-424 Phase 2 closure, data-engineer): gitleaks allowlist + ESC-032 attestation.
  Merged 2026-06-29.

## Queue state

- FOLLOW-434: DONE (PR #385, merge commit 3a226b4, merged 2026-06-30). RETRO-141 written. FOLLOW-435
  filed.
- FOLLOW-433: DONE (PR #383, merged 2026-06-29T17:35:35Z). RETRO-140 written.
- FOLLOW-432: DONE (PR #381, merge commit 3cb5c28, merged 2026-06-29). RETRO-139 written.
- Next free FOLLOW stub number: 436.
- FOLLOW-431: DONE (PR #379, merged 2026-06-29, prod-verified 10/10 burst writes).
- FOLLOW-435: READY in QUEUE.md (promoted 2026-06-30; P2, replace Sentry overflow stub in
  seed-listing-embeddings.ts with durable Modal seed job; backend-engineer+ml-engineer ~6h;
  depends_on FOLLOW-434 DONE). No worker assigned yet.
- FOLLOW-429: READY in FOLLOW_UPS.md (not yet promoted; scope widened to include ctx.waitUntil — P2
  backend-engineer, CF-Worker flush-axis analogue for decision-api reorder.ts:204). Next after
  FOLLOW-435 or in parallel.
- FOLLOW-430: READY in FOLLOW_UPS.md (not yet promoted; P3 sdk-engineer, 2h).
- P2 tickets READY (not yet promoted to QUEUE): FOLLOW-417, FOLLOW-418, FOLLOW-420, FOLLOW-421,
  FOLLOW-429.
- P3 tickets READY: FOLLOW-355, FOLLOW-399, FOLLOW-401, FOLLOW-408, FOLLOW-412, FOLLOW-413,
  FOLLOW-416, FOLLOW-430.
