# Pilot Freeze Rule

**Status:** DRAFT for CEO ratification — 2026-05-25. Answers AI Council blocking question **B2**.
Source: AI Council session `20260525_143939`.

## Purpose

During the pilot CTA-lift **measurement window** on app.estalara.com, the pilot tenant's runtime
behavior must be frozen so the lift signal is not contaminated by concurrent Lane C work. This
document defines, per Sprint 13b ticket, what may merge, what must be shadow-only, and what is
prohibited while measurement is live.

The measurement window opens when TICKET-PILOT-001 flips the pilot tenant shadow→live and closes
when the headline CTA-lift readout is taken (per `docs/specs/PILOT_CTA_LIFT_METRIC_v1.md`).

## Available enforcement primitives (finding)

There is **no dedicated per-tenant feature-flag column** today. Freeze is enforced by
merge-discipline + tenant-gating using existing primitives (`packages/db/src/schema/tenants.ts`):

- `tenants.status` (`pending | active | suspended | canceled`) — coarse on/off.
- `tenants.brandConfig` / `tenants.quizConfig` (jsonb) — per-tenant config blobs.
- `tenants.consentRequired` (boolean).

`DECISION NEEDED`: whether to add a `tenants.pilot_frozen` (or a `config.pilot` jsonb key) for an
explicit runtime guard, or rely purely on merge-discipline for the v1 window. Recommendation: rely
on merge-discipline + a documented checklist for v1 (cheapest), add a flag only if a Lane C change
genuinely needs to ship to the pilot tenant mid-window.

## Classification of Sprint 13b (Lane C) work

| Ticket                                                      | Touches pilot tenant runtime?                | Classification during measurement window                                                                                     |
| ----------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| FOLLOW-099 (new SDK behavioral observers)                   | **Yes** — changes which events the SDK emits | **PROHIBITED** to ship to pilot tenant mid-window (changes the signal mix → contaminates funnel/denominator)                 |
| FOLLOW-103 (app.estalara.com DOM adaptation, slot coverage) | **Yes** — _is_ the pilot tenant's adaptation | **PROHIBITED** mid-window. Must land **before** the window opens (defines "adapted") or **after** it closes (next iteration) |
| FOLLOW-100 (SIGNAL_LIKELIHOODS / applyChatIntentPrior)      | Only if FOLLOW-099 events are live           | **SHADOW-ONLY** — may compute predictions but must not change served directives for the pilot tenant                         |
| FOLLOW-087 (chat NLP intent-engine)                         | No (separate service; emits to a namespace)  | **SHADOW-ONLY** — predictions logged to a separate namespace, no UX effect                                                   |
| FOLLOW-101 (chat.intent.detected → prior bridge)            | Only via shadow predictions                  | **SHADOW-ONLY**                                                                                                              |
| FOLLOW-102 (quiz ON/OFF toggle)                             | No, if default path unchanged                | **MERGEABLE** — backend + default-off path; must not enable the quiz on the pilot tenant mid-window                          |

## Rules

1. **Prohibited (FOLLOW-099, FOLLOW-103):** must not affect the pilot tenant while measurement is
   live. Branch-develop during the 13a shadow build; merge to the pilot tenant only before the
   window opens or after it closes.
2. **Shadow-only (FOLLOW-087/100/101):** predictions/events written to a **separate namespace**
   (e.g. a distinct event type or a `shadow=true` tag) with **zero** effect on served directives,
   DOM, dashboard semantics, or the pilot event schema. Enables post-pilot disagreement-rate
   analysis (the moat / 10x opportunity) without contaminating the readout.
3. **Mergeable (FOLLOW-102 + backend-only, tenant-gated work):** may merge, provided it is gated OFF
   for the pilot tenant and provably does not alter pilot-tenant runtime.
4. **No schema drift:** no change to the event types or `adaptation_decisions` columns the CTA-lift
   query depends on (`events.type='cta.clicked'`, `holdout_group`, `ad.ts`) during the window.
5. **No observer changes** affecting existing `cta.clicked` / `inquiry.started` emission unless
   covered by an isolation test proving no behavior change for the pilot tenant.

## `DECISION NEEDED`

- **Sign-off authority per category:** who approves a "mergeable" Lane C change touching the pilot
  tenant, and who can declare the measurement window open/closed (recommend: Piotr as incident
  owner).
- **Exact pilot tenant id** (the app.estalara.com tenant UUID) — to scope the gate precisely and
  confirm it is distinct from `DEMO_TENANT_ID` / `E2E_TENANT_ID`.
- Whether to add an explicit `pilot_frozen` runtime flag (see "Available enforcement primitives").

## Cross-references

- `docs/specs/PILOT_CTA_LIFT_METRIC_v1.md` (defines the measurement window).
- `docs/ops/PILOT_RUNBOOK.md` (go/no-go + abort).
- QUEUE.md Sprint 13b Lane C (freeze-sequencing note on FOLLOW-099/103).
