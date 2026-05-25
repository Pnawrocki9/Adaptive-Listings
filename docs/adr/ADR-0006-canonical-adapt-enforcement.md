# ADR-0006: Canonical /api/adapt Enforcement

## Status

PROPOSED — 2026-05-25

Follow-on to **ADR-0004** (Canonical /api/adapt Endpoint, ACCEPTED 2026-05-17). ADR-0004 remains in
force; this ADR does not supersede it — it adds the runtime-enforcement decision ADR-0004 deferred,
and brings forward the Worker deprecation review.

> **Draft for ratification.** Items marked `DECISION NEEDED` are open and must be resolved before
> this ADR moves to ACCEPTED. Tracked by FOLLOW-105 (Sprint 13a Lane A, P0).

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
3. **Worker `/api/adapt` disposition — `DECISION NEEDED`** (this ADR picks one, bringing forward the
   ADR-0004 §Consequences 30-day review now due ~2026-06-16):
   - (a) **Retire** the Worker `/api/adapt` route entirely (preferred — removes the divergence
     surface; Worker keeps only the edge holdout gate / telemetry relay).
   - (b) **Proxy** the Worker route to the canonical control-plane endpoint (keeps the edge URL but
     removes the 3-bucket logic).
   - (c) **Hard-fail** archetype-selection calls at the Worker (`410`/explicit error) while leaving
     the holdout gate intact.
4. **CI guard.** Add a regression gate (extend Rule H / Rule J — `scripts/check-rule-h.sh`,
   `scripts/check-mirror-files.sh`, `CONVENTIONS_PATCH.md`) asserting: (i) no production caller
   reaches Worker `detectArchetype()` for archetype selection, and (ii) the SDK→canonical request
   schema does not drift from the canonical `/api/adapt` response contract.
5. **Contract reconciliation — `DECISION NEEDED`.** Reconcile the live control-plane response field
   names with the ADR-0004 documented contract (or update ADR-0004's contract block to match
   reality, whichever the architect rules correct), so the "stable contract" claim is true.

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
- On ACCEPTED: update this status, set ADR-0004 status note to reference ADR-0006 as the enforcing
  follow-on, flip Master Design §Snapshot.7 risk #1 OPEN → RESOLVED, and add this ADR to the index.
- Cross-references: ADR-0004 (canonical decision), ADR-0005 (Modal apps disposition),
  `docs/MASTER_DESIGN.md` §B.9 / §C.1 / §C.4 / §Snapshot.7.
