# TICKET-ARCH-MD-001 — Apply MASTER_DESIGN v1.5 Patch + Bump to v1.6

**Sprint:** 8 **Agent:** architect **Priority:** P2 **Estimated hours:** 1 **Status:** READY
**Depends on:** TICKET-046 (merged PR #92) **Promoted from:** FOLLOW-005 (RETRO-001)

## Context

`docs/MASTER_DESIGN.md` is at version 1.4. A v1.5 patch document exists at
`docs/specs/MASTER_DESIGN_PATCH_v1_5.md` (243 lines) containing sections B.8, B.9, E.6, Sprint 7.5
spec updates, and Section P roadmap updates. This patch was prepared during Sprint 7.5 but never
applied to the main document body.

Per RETRO-001 finding 3d, the document version header references v1.4 but the retrospective loop and
several agents assume v1.6. This ticket applies the unapplied patch content to
`docs/MASTER_DESIGN.md` and bumps the version header to v1.6.

**References:**

- `docs/specs/MASTER_DESIGN_PATCH_v1_5.md` — source content to apply (B.8, B.9 sections)
- `docs/MASTER_DESIGN.md` — target document (currently v1.4)
- RETRO-001 (`backlog/RETROSPECTIVES.md`) — gap finding 3d that generated this ticket

## Acceptance criteria

- [ ] `docs/MASTER_DESIGN.md` version header changed from `1.4` to `1.6`
- [ ] Changelog entry added at the top of `MASTER_DESIGN.md` documenting v1.5 → v1.6 changes (B.8
      auto-onboarding schema discovery detail, B.9 continuous validation cron spec, E.6 placeholder
      resolution order, Sprint 7.5 completion)
- [ ] Section B.8 content from `MASTER_DESIGN_PATCH_v1_5.md` inserted at the correct location under
      the Auto-Onboarding section (after B.7, before B.9)
- [ ] Section B.9 content from `MASTER_DESIGN_PATCH_v1_5.md` inserted after B.8
- [ ] Section E.6 content (Placeholder Resolution Order) from the patch inserted under the
      Adaptation Engine section E
- [ ] `docs/specs/MASTER_DESIGN_PATCH_v1_5.md` updated with a note `status: applied` at the top so
      future readers know this patch is no longer pending
- [ ] No existing content in `MASTER_DESIGN.md` is removed — additions only (plus version bump and
      changelog entry)

## Implementation notes

Read the full patch file first (`docs/specs/MASTER_DESIGN_PATCH_v1_5.md`), then locate the correct
insertion points in `docs/MASTER_DESIGN.md` using section headers. The patch document contains
explicit "insert after section B.7" style markers.

Skip version 1.5 in the header — jump directly to 1.6, since the plan already refers to v1.6
throughout and 1.5 was never a stable released version (it was a patch document).
