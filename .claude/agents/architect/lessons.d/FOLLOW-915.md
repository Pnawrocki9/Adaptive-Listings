# FOLLOW-915 — architect lesson (2026-08-08)

- **Date / ticket:** 2026-08-08 / FOLLOW-915 AC(0) (ESC-051 collision with ADR-0011).
- **What I decided:** The ADR-0011 addendum sentence blocking FOLLOW-915 was two propositions fused:
  a compliance rule (tenant data fetches post-consent — re-affirmed) and an ordering consequence
  about `fetchQuizConfig()` misreadable as a universal ban ("the banner cannot wait for _any_ fetch"
  — superseded as a general claim). Wrote ADR-0021: identifier-free static consent-text asset,
  fetched pre-consent on the pending path only, banner awaits it, fail-closed with no fallback text.
  Answered the residual compliance question from the existing DPIA (§6.1 ePrivacy
  strictly-necessary + the pre-existing pre-consent `sdk.js` request to the same origin), so ESC-056
  stayed unspent; compliance countersign on the scope reading gates the implementation PR instead.
- **Where a spec risked describing behavior with no owner:** The D3 identifier-free constraint is
  the entire compliance foundation and the likeliest future erosion point (someone adds `?tenant=`
  or a locale path segment for branding). I made it self-defending: D3 names the new-ADR-plus-
  compliance-review trigger, and AC(1) must assert the request URL/headers byte-exactly in a test —
  the constraint has an owner (the test), not just a paragraph.
- **A guardrail I'd add:** When an ADR sentence records a _consequence_ of a decision next to the
  decision itself, tag it ("consequence, not rule") or future readers will enforce the consequence
  as an independent rule after its premise changes. This is the second time a fused compliance+
  engineering sentence blocked a ticket (FOLLOW-278's locale constraint was the first casualty of
  the same sentence); if it recurs once more, propose it for CONVENTIONS_PATCH.md.
