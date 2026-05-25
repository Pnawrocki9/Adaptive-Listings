# ADR-0006: Canonical /api/adapt Enforcement

## Status

ACCEPTED — 2026-05-25 (**CEO-ratified 2026-05-25**). **APPROVED_TO_IMPLEMENT: true.**

> Flipped PROPOSED → ACCEPTED by FOLLOW-105 substep 1b–1d (branch
> `feat/follow-105-1bcd-canonical-adapt-enforcement`), which landed the implementation: snippet
> `data-decision-url` fix, `adapt_decision_id`, SDK Zod validation, Worker `410 Gone` + structured
> logging, the live-wins ADR-0004 contract update, and the CI Rule H drift/410 gate.

Follow-on to **ADR-0004** (Canonical /api/adapt Endpoint, ACCEPTED 2026-05-17). ADR-0004 remains in
force; this ADR does not supersede it — it adds the runtime-enforcement decision ADR-0004 deferred,
and brings forward the Worker deprecation review.

> **CEO ratified all former `DECISION NEEDED` items 2026-05-25** (Worker disposition = phased;
> contract reconciliation = live-wins). Tracked by FOLLOW-105 (Sprint 13a Lane A, P0).

## Context

ADR-0004 decided that `apps/control-plane/src/app/api/adapt/route.ts` is THE canonical adapt
endpoint (18-archetype playbook + LLM + RAG + A/B holdout) and that the Cloudflare Worker
`apps/decision-api` is scoped to "edge holdout gate + telemetry relay only" — its 3-bucket
`detectArchetype()` stub "MUST NOT be called for archetype selection in production."

That decision is **documentary, not enforced**. Two gaps remain:

1. **No runtime guarantee the SDK targets the canonical path.** The SDK derives its adapt URL from
   the embed snippet: `config.decisionApiUrl` is read from the script tag's `data-decision-url`
   attribute (`packages/sdk/src/core/config.ts:80`) and the request is sent to
   `decisionApiUrl + "/adapt"` (`packages/sdk/src/core/adapt.ts:507`). Whatever host the snippet
   generator writes into `data-decision-url` decides the route. If that value points at the Worker,
   the pilot silently downgrades to 3-bucket behavior — even after Lane C ships 18-archetype intent
   (FOLLOW-099/100/087/101). The snippet generator's emitted host is **not yet verified**
   (FOLLOW-105 substep 1a; candidate `apps/control-plane/src/lib/tenant-schema.ts`, to be located).

2. **No CI guard against re-divergence.** Nothing prevents a future change from reintroducing
   production archetype-selection logic in the Worker, or from drifting the two response shapes
   further apart. (ADR-0004 documents a canonical response contract — `adapt_decision_id`,
   `archetype`, `holdout`, `variant_index`, `directives`, `slot_copy`, `timing_ms`,
   `explainability_id` — but the live control-plane response already differs in field naming; that
   drift is in scope to reconcile.)

ADR-0004 §Consequences scheduled a Worker deprecation review at 30 days (i.e. **~2026-06-16**). The
Lane B pilot launch on app.estalara.com needs the route disposition settled **before** that date, so
this ADR brings the review forward.

This is a §Snapshot.7 risk #1 item (dual `/api/adapt`) and AI Council Ticket 4 (P0), ratified by CEO
2026-05-25.

## Decision

1. **Re-affirm ADR-0004 §1:** control-plane `/api/adapt` is the sole production adapt path.
2. **Enforce SDK targeting at generation time.** The embed snippet generator MUST emit the
   control-plane host into `data-decision-url`. A generated snippet that points anywhere else is a
   bug. FOLLOW-105 substep 1a audits the generator + the deployed app.estalara.com snippet to
   confirm the live value.
3. **Worker `/api/adapt` disposition — RATIFIED: phased retirement** (brings forward the ADR-0004
   §Consequences 30-day review, originally due ~2026-06-16):
   - **Phase 1 (this ADR, FOLLOW-105): hard-fail with `410 Gone` + structured logging** (option 3c).
     Worker `/api/adapt` returns `410 Gone` with body
     `{ error: 'deprecated', canonical: 'https://control-plane.estalara.com/api/adapt', since: '2026-05-25' }`
     and logs each call with a stack trace (internal callers) or User-Agent (external callers) so
     any residual traffic source is identifiable.
   - **Phase 2 (FOLLOW-107, Sprint 14, P3, ~1h): full retirement** (option 3a) after a 7-day
     monitoring window confirms zero traffic to Worker `/api/adapt`.
   - **If traffic is observed during Phase 1:** Phase 2 is deferred, the source is identified, and a
     proxy (option 3b) is considered as a last resort.
4. **CI guard.** Add a regression gate (extend Rule H / Rule J — `scripts/check-rule-h.sh`,
   `scripts/check-mirror-files.sh`, `CONVENTIONS_PATCH.md`) asserting: (i) no production caller
   reaches Worker `detectArchetype()` for archetype selection, and (ii) the SDK→canonical request
   schema does not drift from the canonical `/api/adapt` response contract.
5. **Contract reconciliation — RATIFIED: live wins.** Update the ADR-0004 contract block to match
   the live control-plane response (live implementation wins over draft documentation). Add a
   revision note to ADR-0004: _"Updated 2026-05-25 to reflect live implementation; original draft
   contract preserved in git history."_ This update is part of FOLLOW-105 substep 1b.

## Consequences

### Positive

- The pilot provably exercises the 18-archetype path; CTA-lift measures the real product, not a
  3-bucket fallback.
- Closes §Snapshot.7 risk #1 and the investor-diligence "which /api/adapt is real?" finding at the
  runtime level, not just on paper.
- CI gate prevents silent re-divergence.

### Negative

- Worker retirement/proxy is more than a doc change; FOLLOW-105 estimate is revised 6h → 8–10h.
- A proxy option (3b) adds an edge hop; retire (3a) is cleaner but requires confirming nothing else
  depends on the Worker adapt route.

## Alternatives Considered

1. **Documentation-only (ADR text, no enforcement)** — rejected. This is the current state; ADR-0004
   already documents the decision and the divergence still exists at runtime.
2. **Defer to the scheduled ~2026-06-16 review** — rejected. Lane B pilot launch precedes that date
   and cannot run on an ambiguous route.
3. **New ADR-0005** (as the AI Council originally framed it) — rejected. ADR-0005 is already
   `Modal Apps Disposition`; reusing the number collides, and the canonical decision already lives
   in ADR-0004. This ADR is the correct sequential number (ADR-0006) and is framed as enforcement.

## Implementation Notes

- Tracked by **FOLLOW-105** (Sprint 13a Lane A, P0, ~8–10h, opus-4.7-xhigh), substeps: 1a SDK
  config/runtime audit (read-only) → 1b this ADR to ACCEPTED → 1c Worker disposition implementation
  → 1d CI Rule H/J gate.
- Implementation files: `packages/sdk/src/core/config.ts`, `packages/sdk/src/core/adapt.ts`, the
  snippet generator (to be located), `apps/decision-api/src/app/api/adapt/route.ts`,
  `apps/control-plane/src/app/api/adapt/route.ts`.
- On ACCEPTED (actioned by FOLLOW-105 substep 1b/1c):
  - ✅ Status flipped to ACCEPTED (above).
  - ✅ ADR-0004 status note now references ADR-0006 as the enforcing follow-on (ADR-0004 §Status).
  - ✅ This ADR's index row updated to ACCEPTED in `docs/adr/README.md`.
  - ⏳ Master Design §Snapshot.7 risk #1 (dual `/api/adapt`) flips **OPEN → RESOLVED on PR merge** —
    the PM actions this when the FOLLOW-105 PR merges (not flipped in this PR per the phased-spawn
    STOP discipline).
- **Stale hostname correction (FOLLOW-105):** §Decision 3 above drafted the 410 body `canonical` as
  `https://control-plane.estalara.com/api/adapt`. That hostname is STALE — the live control-plane
  host is `admin.estalara.com` (`packages/shared/src/domains.ts` `CONTROL_PLANE_URL`). The shipped
  410 body uses `https://admin.estalara.com/api/adapt`.
- Cross-references: ADR-0004 (canonical decision), ADR-0005 (Modal apps disposition),
  `docs/MASTER_DESIGN.md` §B.9 / §C.1 / §C.4 / §Snapshot.7.

### Rollback procedure

If FOLLOW-105 enforcement causes a production incident:

1. **Immediate (5 min):** revert the FOLLOW-105 PR via `git revert` + redeploy.
2. **Worker side:** re-enable the `/api/adapt` handler from the previous commit.
3. **SDK side:** the snippet generator emits the previous host (control-plane was already correct —
   rollback only restores the Worker as a fallback).
4. **CI Rule H/J:** temporarily disable the FOLLOW-105 substep-1d gate until root cause is
   identified.
5. **Incident retrospective:** required within 48h; identify the gap in ADR-0006 testing.
