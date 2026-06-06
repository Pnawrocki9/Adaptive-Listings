# FOLLOW-198 — Cross-language event contract parity gate (FOLLOW-168 completion)

**Sprint:** 15 **Agent:** qa-engineer + backend-engineer **Priority:** P1 **Estimated hours:** 3
**Status:** READY **Source:** FOLLOW-168 (Sprint 14), Audit addendum **Promoted:** 2026-06-05

---

## Context

FOLLOW-168 (Sprint 14, status READY in `backlog/sprint-14/FOLLOW-168.md`) establishes a CI gate
ensuring the `DescriptionRequestedEvent` contract does not drift between the TypeScript publisher
(Zod schema in `packages/shared`) and the Python consumer (`apps/llm-gateway`). This ticket either
confirms FOLLOW-168 is complete and the gate is live, or finishes it if Sprint 14 did not close it.

Per the audit addendum, half-wires between TS producers and Python consumers are a documented
pattern risk (FOLLOW-097→114→127→141 cautionary chain). A shared JSON schema as single source of
truth eliminates this class of silent contract drift.

**If FOLLOW-168 is already DONE (Sprint 14 merged):** This ticket is a verification pass only —
confirm the gate is wired as a real CI check and fails on schema drift. Close immediately.

**If FOLLOW-168 is NOT done:** This ticket completes it.

## Scope

- Confirm current status of FOLLOW-168 in Sprint 14.
- If not done: implement a shared JSON schema (or Zod→JSON export) for `DescriptionRequestedEvent`
  that is imported by both the TypeScript Zod parser and validated by the Python consumer in
  `apps/llm-gateway`.
- Add a CI gate (e.g., `pnpm cross-language-contract` or a GitHub Actions step) that fails if the
  TypeScript schema and Python schema for `DescriptionRequestedEvent` are out of sync.
- The gate must be a REAL merge check (not a soft-skip) so drift causes CI failure on every PR.

## Acceptance criteria

- [ ] AC1: CI gate `cross-language-contract` passes on the current main branch.
- [ ] AC2: A deliberate drift (e.g., add a required field to the TS schema but not the Python
      validator) causes the CI gate to fail.
- [ ] AC3: Gate is wired as a real merge-blocking check in `.github/workflows/`.
- [ ] AC4: PR description confirms whether this completes FOLLOW-168 or is a new implementation.

## Definition of Done

- [ ] Branch `qa-engineer/FOLLOW-198-cross-language-contract`; commits referencing [FOLLOW-198]; PR
      opened; CI green.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [FOLLOW-168 Sprint 14 status] · **produces:** [protection against TS↔Python contract
drift on all future PRs]
