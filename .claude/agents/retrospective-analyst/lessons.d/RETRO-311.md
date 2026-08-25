# RETRO-311 — #850 (FOLLOW-1124 + FOLLOW-1125) — 2026-08-25

**Verdict recorded up front, because it is the unusual one:** the fix was **correct**. Three of the
previous four retros found the just-merged remediation incomplete, the brief named a specific rule
(AU) and a specific expectation (a third instance), and the honest answer was that
`measureThisRunAdaptedArm()` asserts what AC(5) claims on every axis I could construct. Saying so
plainly took more discipline than finding a defect would have.

## A finding I almost missed, and why

**FOLLOW-820 condition 1's clause 2 has no assertion anywhere in FOLLOW-819 — and I nearly graded
the PR against the version of condition 1 I had read in RETRO-310.** ESC-073 merged at `4dbff0aa`,
**one commit before** the PR under review, and it did not just resolve an ambiguity — it _added a
requirement_: "the holdout mechanism demonstrably separates the two arms (a control session receives
no directives, an adapted session does)". I only caught it because I opened `ESCALATIONS.md` to
check whether ESC-073 weakened anything in the PR (the brief asked), and read clause 2 while looking
for clause 4.

The generalisable habit: **when a ruling/escalation/ADR lands within a commit or two of the PR under
review, diff the ruling's text against the instrument, not against your memory of what the ruling
was about.** Everyone involved believes they know a fresh ruling; nothing has propagated yet. This
is now the second retro in three where the interesting finding sat in the gap between two adjacent
commits (RETRO-310's was FOLLOW-1106's session-id change expiring README §5.2's premise). I have
written it into Rule AZ clause 3 so it is not just my habit.

## An axis I had to trace twice

**The all-zero `tenant_id`.** The brief asked, pointedly, whether it was "a defect one layer down."
My first pass leaned yes — a producer emitting a field it cannot populate, every consumer obliged to
ignore it, smells exactly like the estate's usual half-wire. I wrote half a finding before going to
the source, and the source killed it: `packages/sdk/src/core/events.ts:19` documents the placeholder
explicitly, `apps/ingest/src/handlers/events.ts:417` overwrites it from the auth-resolved tenant,
and `handlers/events.ts:474-479` does the same for the intent sink. It is the **correct** posture —
a client-supplied tenant on an ingest wire is a cross-tenant write vector — and the sibling wire
proves the estate knows it (`/adapt` _rejects_ a mismatching `body.tenant_id`, FOLLOW-260).

The real finding was one level over and I would have missed it if I had shipped the first version:
`packages/shared/src/schemas/event.ts:61-62` documents the field as "Tenant that owns the event",
which is the opposite of what happens, and that is the contract the PR's author read before building
the predicate that produced a false RED. **A leading question in a brief is a hypothesis, not a
finding.** The brief itself warned me about manufacturing findings and I still had to catch myself.

## A meta-pattern in how gaps recur across agents

**Corrections land where the person who made the mistake was standing, not where the next reader
will be.** Four instances in this one merge:

- The tenant lesson went into the harness's own docblock; the envelope schema that misled the author
  is untouched, and `last-run.json` still renders the placeholder as `tenantId`.
- The abort handler's tally claim went into a comment beside code that cannot produce a tally.
- README §0's positive-lift requirement was corrected in the PR body, the commit message, the QUEUE
  banner and a code docblock — four places — and not in the one artefact a grader is told to read
  first.
- The `esc()` helper was extracted and applied to one of four sibling call sites.

That is the same shape as Rule AZ, one abstraction down: **the authoring path never consults the
consuming path.** Rule AZ addresses the document half. The code half is Rule S and it is being
violated at a steady rate.

## My own blind spot, filed against myself

**The P-NN pattern register is corrupt and I inherited the corruption without noticing until I went
to count.** Three distinct patterns were each minted "P-85 (NEW)" — RETRO-306 `:70558`, RETRO-307
`:70992`, RETRO-309 `:72197` — and RETRO-310 incremented "P-85" against only the third, orphaning
two patterns at an effective count of zero forever. Cause: those four retros were filed in one
batch, each read "the last 5 retros" from disk, and each sibling's §6 was not yet written when the
next picked its number. **That is Rule AG's parallel-append problem applied to my own register.**

Two operative consequences for the next run of this agent:

1. **Allocate `P-NN` the way `FOLLOW-NNN` is allocated** — against `origin/main`, before use — and
   when filing a batch, allocate all of the batch's pattern ids up front. Rule AN's enumeration does
   not currently include `P-NN`; the vehicle when this recurs is an AN amendment, not a new letter.
2. **Never quote a pattern's count without re-deriving it.** I nearly wrote "P-86, count 3" from
   RETRO-310's arithmetic alone. It happened to be right. P-85's was not.

Filed as **FOLLOW-1137** so the repair is a reviewable change rather than a silent edit to three
prior entries.

## Process notes worth carrying

- **`grep -c "^## Rule " CONVENTIONS_PATCH.md` before believing a brief's rule count.** The brief
  said 16; the register holds 51 (now 52). Not a repo defect — but a retro that reasons from a
  briefed number instead of the file is doing the thing it exists to prevent.
- **Rule AZ exhausts the AA–AZ letter space.** Rule 53 needs a scheme decision. Flagged in AZ's own
  trailing comment so the next promoter cannot miss it.
- **Record the controls that worked, at length.** This PR's commit split — shipping with an honest
  "no end-to-end run has been taken, so AC(5) is UNMEASURED" and then a later session _discharging_
  that note instead of inheriting it — is the FOLLOW-097→141 failure mode not happening, for the
  first time in this arc. A retro that only reports hits cannot detect that, and it is the single
  most reusable behaviour in the merge.
