# Remediation & Go-Live Plan — 2026-07-12 (2–4 weeks)

**Basis:** `docs/AUDIT-2026-07-12.md` (findings F-01…F-16) merged with `backlog/QUEUE.md` Sprint 23
waves. **Goal:** turn the dormant intelligence ON in prod and make the pilot _measurable_ — not a
rebuild. **Anchor:** MASTER_DESIGN v4.3 §Snapshot.1. Owners use the 9-agent roster; "operator" =
Piotr + Rafał (manual, non-delegable).

## Guiding logic

The audit's central fact: **the foundation is sound; the differentiator is switched off in prod.**
So the plan front-loads the single unblock (FOLLOW-553 Wave 0), pairs every "switch-on" with its
measurement so we don't turn the loop on blind, then enriches signal once real pilot data exists.
Sequence is dependency-driven, not effort-driven.

**Three gates:**

- **Gate A (end Wk1): "Loop is live."** Feedback enabled, embeddings seeded, auth real, CH
  migrations applied, chat consumer deployed. Bandit no longer `Beta(1,1)`; affinity no longer djb2.
- **Gate B (end Wk2): "Pilot is measurable."** Conversion metric correct (F-01), cosine-vs-djb2 +
  lift telemetry emitting, latency capped.
- **Gate C (Wk4): "Clean re-audit."** FOLLOW-471 gate passes; no open Critical/High on the buyer
  path.

---

## Week 1 — Switch the loop on (Gate A)

| Item                                                                                                                      | Type                | Owner                      | Depends on        | Verify / gate                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **FOLLOW-553 Wave 0** — feedback-enable, CH migrations apply, embedding-seed run, real API-key auth, chat consumer deploy | QUEUE P0 (operator) | **operator**               | —                 | Bandit draws ≠ uniform; `archetype_embeddings.embedding` non-NULL; `/api/adapt` rejects demo-JWT-only; `intent_events` count > 0 |
| **F-05** confirm cosine engages after seed; decide dead `embedding.ts` (wire or delete)                                   | finding             | ml-engineer + sdk-engineer | FOLLOW-553 (seed) | `computeCosineSimilarity` path hit in logs, not `deterministicScore`                                                             |
| **F-09** verify CH migrations `holdout_group/variant/archetype/intent_events` live in prod                                | finding             | data-engineer              | FOLLOW-553        | analytics queries 200, not 500                                                                                                   |
| **FOLLOW-554 / F-02** quiz-skip SoT bug                                                                                   | QUEUE P1            | sdk-engineer               | —                 | test: skip path writes correct sessionStorage archetype                                                                          |
| **FOLLOW-555 / F-14** enumerate + fix the 6 auth routes                                                                   | QUEUE P1            | backend-engineer           | —                 | each route classified browser vs Bearer; browser routes on `getUser()`                                                           |
| **FOLLOW-556** LLM daily spend cap (description/headline path)                                                            | QUEUE P1            | ml-engineer                | —                 | cap enforced; over-cap → fail-loud, not silent                                                                                   |
| **F-01** emit `inquiry.completed` into `eventQueue` (not only feedback-ping)                                              | finding             | sdk-engineer               | —                 | event round-trips to ClickHouse `events`; cta-lift leg populates                                                                 |

**Parallelism:** operator (Wave 0) runs alongside the four delegable code tickets. F-01 + FOLLOW-554
are the fastest wins — schedule first.

---

## Week 2 — Make the pilot measurable (Gate B)

| Item                                                                                         | Type     | Owner                                  | Depends on       | Verify / gate                                                       |
| -------------------------------------------------------------------------------------------- | -------- | -------------------------------------- | ---------------- | ------------------------------------------------------------------- |
| **FOLLOW-560** cosine-vs-djb2 scoring telemetry                                              | QUEUE P2 | ml-engineer                            | FOLLOW-553, F-05 | dashboard shows % sessions on cosine vs hash                        |
| **FOLLOW-458** deploy chat shadow-consumer (now unblocked)                                   | QUEUE    | devops-engineer                        | FOLLOW-553       | consumer receives events                                            |
| **F-08** replace Redpanda no-op transport (direct-Modal per ADR-0016 or CF Queue → consumer) | finding  | backend-engineer + data-engineer       | FOLLOW-458       | `chat.message.sent` reaches `process_chat_message` in prod          |
| **F-04** deploy Modal `apps/intent-engine` in CI phase; keep shadow until DPIA sign-off      | finding  | devops-engineer + ml-engineer          | F-08             | `Function.lookup` resolves; shadow write observed                   |
| **F-11 (start)** move `/api/adapt` branches 3&4 to async/precompute; cache 24h spend         | finding  | ml-engineer + architect                | FOLLOW-556       | p95 measured < 100ms on medium/low-similarity sessions              |
| **FOLLOW-557 / 558** DSR completeness (chat-intent Redis key; disclose quiz/intent tables)   | QUEUE P2 | compliance-engineer + backend-engineer | FOLLOW-553       | DSR erase covers shadow key; access export lists new tables         |
| **FOLLOW-559** ingest server-side consent gate                                               | QUEUE P2 | backend-engineer                       | —                | opt-out event rejected server-side per §H.9                         |
| **F-12** mock badge on quiz-analytics tiles                                                  | finding  | backend-engineer                       | —                | tiles show `MockDataBadge`                                          |
| **F-13** param-bind `admin/labels` model_version filter                                      | finding  | backend-engineer                       | —                | no raw string interpolation                                         |
| **F-15** default `<adaptation_verdict>` to NEUTRAL                                           | finding  | ml-engineer                            | —                | missing tag → no description written                                |
| **F-03** port fact-whitelist into directive prompts                                          | finding  | ml-engineer                            | —                | directive prompt carries whitelist; test with planted hallucination |

---

## Weeks 3–4 — Enrich & harden, then re-audit (Gate C)

| Item                                                                                                                                     | Type                      | Owner                      | Depends on                        | Verify / gate                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------- | --------------------------------- | ---------------------------------------------------- |
| **FOLLOW-565 / F-07** signal enrichment wave 2 — wire high-value dead events (photo gallery, price compare, chat.opened, tour.requested) | QUEUE P2                  | sdk-engineer + ml-engineer | FOLLOW-553 (needs live lift data) | emitted → ingested → read; coverage rises from 27/52 |
| **FOLLOW-561 / F-06** archetype-ID full parity test (import single `ARCHETYPE_KEYS`)                                                     | QUEUE P3                  | qa-engineer                | —                                 | test fails if any of 6 locations drift               |
| **F-11 (finish)** async adapt path shipped + measured under load                                                                         | finding                   | ml-engineer                | Wk2 start                         | p95 < 100ms sustained                                |
| **FOLLOW-562** dashboard Panel 5 error surfacing                                                                                         | QUEUE P3                  | backend-engineer           | —                                 | errors shown, not zeros                              |
| **FOLLOW-564 / F-11** reconcile p95 bar with ADR-0004                                                                                    | QUEUE P3                  | architect                  | F-11                              | ADR updated                                          |
| **F-16 / FOLLOW-469** SDK bundle headroom (code-split/lazy-load)                                                                         | finding                   | sdk-engineer               | —                                 | gzip back under ~38KB                                |
| **F-10** label/remove `intent-ontology` + `platform-templates` stubs                                                                     | finding                   | architect                  | —                                 | §Snapshot.1 accurate; no dead exports (Rule I)       |
| **FOLLOW-563** test hygiene (smoke-ingest soft-skip)                                                                                     | QUEUE P3                  | qa-engineer                | —                                 | Rule Q positive-proof                                |
| **FOLLOW-566** per-tenant origin allowlist                                                                                               | QUEUE P3 (decision-gated) | backend-engineer           | **CEO ruling**                    | needed before 2nd tenant                             |
| **FOLLOW-471** clean re-audit gate                                                                                                       | QUEUE Wave 3              | pm-orchestrator            | all above                         | no open Critical/High on buyer path                  |

---

## Critical dependency chain (must be respected)

```
FOLLOW-553 (operator, Wk1) ──┬──▶ F-05 cosine verify ──▶ FOLLOW-560 telemetry
                             ├──▶ F-09 CH live ──▶ analytics real
                             ├──▶ FOLLOW-458 ──▶ F-08 transport ──▶ F-04 Modal deploy
                             └──▶ FOLLOW-565 signal enrichment (needs live lift data)
FOLLOW-556 ──▶ F-11 async adapt + spend cache ──▶ FOLLOW-564 ADR reconcile
(independent, start day 1): F-01, FOLLOW-554, FOLLOW-555, F-12, F-13, F-15, F-03
```

## Must-fix-before-pilot (hard gate)

FOLLOW-553 (full), **F-05** (kill djb2 fallback), **F-01** (conversion metric), **F-14** (auth
routes), **F-11** (at least cap latency). Everything else can trail a live pilot.

## Open decisions blocking the plan

1. **Has the embedding-seed Modal job ever run in prod?** If not, F-05 is Wk1-day-1, not a verify
   step.
2. **Pilot success metric + uplift target** — undefined; F-01/telemetry can't be judged without it.
3. **FOLLOW-566 origin allowlist** — CEO ruling needed before a 2nd tenant.
4. **DPIA scope for promoting chat shadow → live** (F-04) — needed before chat influences
   adaptation.

---

_Derived from docs/AUDIT-2026-07-12.md (F-01…F-16) + backlog/QUEUE.md Sprint 23. Owners are
proposed; PM-orchestrator to dispatch._
