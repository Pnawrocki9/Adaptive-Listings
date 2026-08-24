# FOLLOW-1107 — 2026-08-24 — corpus correction after ESC-070 Path C shipped

**What I documented.** The four-document sweep the FOLLOW-1105 §4 tables specified: `dpia.md` v2.20
(new §2.2.1 as the single anchor), `lia-template.md` v2.0 (balancing test re-derived), `ropa.md`
v2.15 (Activity 2 rewritten and renamed), `PRIVACY_NOTICE_TEMPLATE.md` v1.8 (§1, the one user-facing
sentence, now true end-to-end). Plus ESC-071 and a Rule-AO forward note on the assessment.

**Where the correction could have drifted, and what stopped it.**

**The failure mode of a correction PR is symmetry: replacing one absolute with the opposite
absolute.** "Cross-session linking is technically impossible" is false; "the identifier is
unlinkable" would have been the same sentence with a new premise. The probe that killed it was cheap
and should be the first move in any corrective sweep: **grep for the OTHER identifiers before
writing the guarantee.** `grep -rn "lead_id" packages/shared/src/schemas/events/` returns
`chat.ts:47` and `live.ts:69` — a deterministic `SHA-256(user_uuid)` prefix, transmitted, durable
across sessions **by design** for authenticated visitors. One grep, and no absolute cross-session
sentence can be written honestly anywhere in the corpus. I wrote the guarantee as a property **of
the identifier** and enumerated three residual vectors instead.

**Verify the sentence you are ABOUT to make true, not just the one you are deleting.**
`PRIVACY_NOTICE_TEMPLATE.md:34` — "discarded when you close your browser tab" — was the sentence the
whole ticket said Path C had made true. It is true, but only because `sessionStorage` is tab-scoped
_and_ the id is now underivable; and there is a documented exception nobody had named: **browsers
restore `sessionStorage` when they restore a closed tab or a crashed session.** Chasing the
end-to-end chain (`generateSessionId` → `writeSession` → `SESSION_STORAGE_KEY` → browser semantics)
surfaced it. It went into the tenant implementation record, not into the visitor paragraph. If I had
verified only "the fingerprint is gone", the caveat would have shipped unnamed a second time.

**A correction sweep walks you past adjacent claims of the same class, and stopping is not
optional.** Correcting §13.1's identifier sentence put me next to §13.1's _retention_ sentence:
"retained for a maximum of 7 days, then deleted by the automated retention sweep." No sweep exists —
`events` has a 13-month TTL and `vercel.json` has three crons, none of them this. FOLLOW-140 has
carried it since 2026-05-28 as a deferred P1. **The reason it outranks its deferral now: unlike the
entire identifier finding, that promise is already rendered to data subjects**, byte-locked in three
locales. Filed ESC-071 rather than editing, because the remedy is a choice between a TTL and
re-wording a sign-off-bearing string. **Heuristic: sort unverified claims by whether a data subject
has already read them, not by how wrong they are.**

**Do not soften a template paragraph that must stay byte-aligned with a shipped string.** The
tempting fix for Privacy Notice §2 was to reword "7 days" into something defensible. That would have
made the template diverge from the live banner — a second defect wearing the costume of a fix. Left
byte-aligned, flagged **DO NOT PUBLISH**, escalated.

**Two findings I refused to sweep, and that refusal is the lesson.** (1) The Redis
`session:{session_id}:*` namespace the ROPA gave a 30-minute TTL has a deleter in the DSR path and
**no writer in the repo**. (2) `archetype_embeddings` is populated by an idempotent seeder over
fixed archetype definitions — there is no nightly DP aggregation over visitor sessions — so the
k-anonymity/DP control the corpus leans on in several places may be protecting nothing. Both are
real, both are outside the §4 work list, and both would have needed their own measurement to state
correctly. **Flagged in place, reported for ticketing, not swept.** A half-measured correction is
how this corpus acquired the defect in the first place.

**A guardrail I'd add.** Rule N currently binds the sentence to a symbol. It should also bind the
sentence to a **re-runnable check**: every concrete behavioural claim in the corpus should name
either a test that fails when the property is lost, or a grep with a stated expected result. §2.2.1
now carries a five-row property-to-test table; the reason that matters is that
`packages/sdk/src/__tests__/session.test.ts` contained a GREEN test asserting the exact defect
(`expect(id1).toBe(id2)`) for three months. A corpus anchored to symbol names would not have caught
that. A corpus anchored to test names would have had somewhere to look.
