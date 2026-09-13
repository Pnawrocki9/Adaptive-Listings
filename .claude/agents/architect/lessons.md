# Architect lessons log

## 2026-07-20 / superadmin-tenant-access (PROPOSED-0018)

**What I decided:** Generalize the ADR-0013 tracer pattern — URL-scoped `/admin/tenants/[id]/*` +
one `resolveTenantAccess(req, { allowStaffOverride })` helper — rather than un-blocking staff from
`/dashboard` wholesale or a session impersonation switch. Reuse the existing append-only
`staff_audit_log` table for staff writes. Left the 2026-06-01 `generation_model` global-only lock
intact by default and pushed the per-tenant-override reversal to a CEO open question.

**Where a spec risked describing behavior with no owner:** The whole ADR is a behavioral spec with
no implementing code yet. Mitigated by listing FOLLOW-590..599 stubs inline (helper, per-feature
ports, audit wiring) so every behavior the ADR describes has a named future owner before any of it
is ratified — no §-level spec ships without a phased ticket attached. The single load-bearing risk
is invariant 5 (staff writes use a service-role client that bypasses RLS), which I bound to a
mandatory per-route "staff query is tenant-filtered" test case so it cannot ship un-owned.

**A guardrail I'd add:** For any ADR that opens a staff/service-role write path around RLS, require
the implementing ticket to include a cross-tenant-leak negative test as an explicit acceptance
criterion — not left to reviewer memory.

## 2026-06-11 / FOLLOW-275

**What I decided:** Adopted option (b) — SDK runtime GET for post-activation-mutable quiz config —
over option (a) snippet-threading + dashboard re-emission surface. New PROPOSED route
`GET /api/quiz/public-config` (API-key auth, CORS-open, 5-min TTL). Snippet retains only immutable
tenant binding fields. Retired `data-quiz-enabled` and `data-micro-polls-enabled` snippet attributes
as config transport.

**Where a spec risked describing behavior with no owner:** The ADR documents an auth sub-decision
(path (i) vs path (ii)) that is explicitly delegated to the backend-engineer. Without a dated FOLLOW
stub for that sub-decision, there is a risk the sub-ADR requirement gets missed. Mitigated by
writing the choice explicitly into both the ADR Risks section and the backend-engineer handoff note,
making the sub-decision owner visible in two surfaces.

**A guardrail I'd add:** When an ADR delegates an auth-model sub-decision to an implementing agent,
the ADR MUST name the implementing agent AND require that agent to document their choice in the PR
description (not just in code). The risk otherwise: the sub-decision gets made silently in code
without review visibility.

## 2026-06-14 / FOLLOW-309 + FOLLOW-310 (ADR-0013)

**What I decided:** (1) SSE admin auth via existing `sb-access-token` cookie —
`verifyTracerAdminAuth` already calls `getAuthClaims` which reads the cookie; the only fix is
removing the erroneous `?token=` query param from the page. (2) New `GET /api/admin/intent/config`
returning row `id` so the Weight Editor can PUT-update rather than POST-create.
`AdminIntentConfigResponseSchema` added to `packages/shared`; SDK-facing
`IntentConfigResponseSchema` unchanged. (3) Test-integrity constraint: fix-ticket tests must drive
the real route handler or derive fixtures from the typed schema — no hand-authored response shapes.

**Where a spec risked describing behavior with no owner:** The CEO/CPO decision on per-tenant weight
editing scope (global-only vs per-tenant in Sprint 17) was left open in the ADR as an explicit flag
rather than silently choosing one. If this decision is not answered before FOLLOW-309 starts, the
implementor will either scope-creep or under-deliver. The ADR names this explicitly.

**A guardrail I'd add:** Before writing an admin GET contract, always check whether the admin UI
pages use cookie-based or header-based auth. If the middleware gates the page route on cookie-based
JWT, the API routes under `/api/admin/` are served to the same browser session and the cookie is
automatically present. A consumer-side test that mocks `global.fetch` with a hand-authored shape
CANNOT detect a route-method mismatch (405), a missing field, or a wrong content-type. The rule
should be: admin UI page tests must import and call the real route handler, not mock the fetch
boundary.

## 2026-06-15 / FOLLOW-324 (PR #308 bundle-size trade-off review)

**What I decided:** Recommend Option 1 (accept the split, merge PR #308 as-is) with two required
follow-ups: (a) `buildSnippet()` must be updated to emit the `<script>` for
`estalara-detect.iife.js` when cold-start detection is desired, and (b) a tenant migration guide
must document which embed tier gets the companion script automatically vs optionally. The cold-start
archetype hints are a Bayesian warm-start, not a load-bearing primitive — the session works without
them and converges to the same archetype within 3–5 behavioral signals. Option 2 (lazy network fetch
in init) introduces CDN hosting complexity, SRI management, and a new failure mode (CDN down) that
reduces reversibility without meaningfully improving the tenant experience.

**Where a spec risked describing behavior with no owner:** The detect-bundle comment says "The
Decision API's server-side schema is used instead" when `__EStalaraDetect` is absent — but there is
no server-side path that converts the stored `tenant_site_schema` into `archetype_hints` and injects
them into the `/api/adapt` response. The `archetype_hint` field is populated solely by the SDK's
client-side Bayesian state. Without the detect script, that hint defaults to `'neutral'`. The
comment is aspirationally correct (the server COULD do this) but describes behavior no code
implements. This needs either a dated FOLLOW stub or a correction to the comment.

**A guardrail I'd add:** When a bundle-split move silences a feature (rather than just moving it),
the PR description MUST explicitly state what happens to existing tenants who don't add the second
script, and `buildSnippet()` MUST be audited to confirm whether the new artifact should appear in
the generated snippet. Failing this, the "opt-in" framing silently downgrades all existing tenants.

## 2026-07-01 / FOLLOW-443 (ADR-0015)

**What I decided:** Use the existing `resolveApiKey()` pattern (SHA-256 indexed lookup on
`api_keys.hashed_key`) already implemented in `quiz/public-config/route.ts` — no new column, no new
env var, no migration, no SDK change. Extract to `lib/api-key-auth.ts` for shared use. Retain HMAC
body sig as defense-in-depth. Derive `tenantId` from the DB row, reject `body.tenant_id`
mismatch 403. Ops bypass permanently scoped to `OPS_TENANT_ID`.

**Critical discovery during design:** The ESC-035 filing (and schema docstring) stated `hashed_key`
is argon2id, implying O(n) brute scan was required. Code audit (`seed-local-tenant.mts:73` +
`quiz/public-config/route.ts:156`) revealed it is SHA-256 with a unique index. An entire "Option B
new column" design was drafted and then discarded after reading the code. The lesson: ALWAYS grep
actual seeder/auth code before accepting a schema comment as ground truth.

**Where a spec risked describing behavior with no owner:** None in the final ADR — the fix is
limited to one new shared lib file and two route changes, all with a 12-case test matrix. The Master
Design §V.3.2 update is explicitly delegated to architect post-PR-merge (named, not floated).

**A guardrail I'd add:** Security ADRs MUST grep the live auth code (seeders, existing route
helpers) before designing a new auth scheme. A wrong schema comment caused a full "new column +
migration + env var + key rotation" design to be drafted before the code audit showed SHA-256 was
already there. Rule: "read the seeder and the closest working auth route before writing the ADR."

- **2026-07-30 / FOLLOW-735** · Ruled that an empty chat-intent extraction never neutralises a
  stored prior, and that the merge rule is keyed on _content_ (all-null dims), not on the
  `data_source` provenance label — which collapsed a 4-constraint "atomic merge" problem into a
  single `SET … NX`. The unlock was noticing the decision needs **no read of the prior**: once you
  never read, the race, the TTL refresh, and the second-write-path defects that killed three
  `/code-review` rounds all disappear at once. Also widened the rule past the reported symptom
  (neutral-success "hi" clobbers priors more often than outages do) — worth stating loudly in the
  ADR, because it is a behaviour change the ticket did not ask for. · **Where a spec risked
  describing behaviour with no owner:** the §D.1.1 patch. It is a runtime rule with zero
  implementing code at HEAD, so it ships with an explicit "⚠️ SPEC, NOT YET IMPLEMENTED AT HEAD"
  block naming FOLLOW-736 (dated) and an AC in that ticket to _delete the warning_ on merge — a
  self-clearing Rule-H marker, not a permanent disclaimer. Also refused to let my own "every
  interface needs shared Zod" guardrail pass silently: the payload has no `packages/shared` schema,
  so FOLLOW-737 owns that gap rather than the ADR pretending it's covered. · **Guardrail I'd add:**
  when a merge/precedence rule is proposed for shared state, first ask "does the decision depend on
  the stored value at all?" — if not, forbid the read outright; the read is what manufactures the
  atomicity, TTL and validation problems. Second: a predicate that must not see field X should take
  a parameter _type_ that excludes X, rather than a comment saying not to look at it.

- **2026-08-07 / FOLLOW-881** · Corrected three Master_Design statements (§A.1.5 Component 1, the
  FOLLOW-354 ladder note before §E.7.1, §E.7.9→D.5) that described the SDK cold-start gate as a lone
  0.5 floor when shipped code is a disjunction with `signal_count >= 2` (`index.ts:827-829`), and
  recorded the server bar as strict `> 0.6` (`route.ts:275` is `<=`; exactly 0.6 → `[]`). Withdrew
  the note's "This is intentional" sentence — ESC-054 is unruled, so the SoT now names the open
  question instead of asserting intent. Found a fourth stale statement (§E.4.6: `<` vs `<=`,
  "tunable per-tenant" with no code, no `signal_count` branch) and a fifth in
  `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §9 (floor-as-sole-gate framing + 0.3655 "ceiling" that
  is really the t=0 prior); reported both as stubs rather than fixing out-of-AC. Also verified the
  FOLLOW-448 branch guard false-positives on worktree edits (it reads the main tree's HEAD, not the
  edited file's worktree HEAD) — confirmed by reading `.git/worktrees/follow-881/HEAD` directly. ·
  **Where a spec risked describing behavior with no owner:** the old "intentional" framing was an
  intent claim with no ruling behind it — ownership now pinned explicitly to ESC-054 in all three
  corrected passages. · **Guardrail I'd add:** any Master_Design sentence asserting a permissive
  behavior is "intentional" must cite the ruling (CEO/ADR/ESC-NNN) that made it so; absent a
  citation, write "shipped behavior, intent OPEN (ESC-NNN)". And: when correcting a numeric gate,
  grep the document for every occurrence of the constant's NAME and its VALUE — the fourth wrong
  statement was findable only by value (`0.6`), not by the constant name.

- **2026-08-14 / FOLLOW-954** · Rewrote §V.3.4 (control-plane CORS) against HEAD (`9c614f8c`): every
  claim in the prior text was wrong (fictitious `middleware/cors.ts`, a `adaptive.estalara.com`
  origin absent from the code, per-tenant enforcement framed as ingest-only, "wildcard NEVER
  allowed" falsified by three sites). Re-verified every cited file:line myself rather than trusting
  the ticket table — all held at HEAD. The interesting call was the reflect-vs-platform-only split:
  two open, mutually conflicting PRs (#733 opt-in registry, #734 opt-out method-aware) both change
  the exact mechanism the AC asked me to document, and pinning to either shape would have shipped a
  freshly-stale doc the moment one merged — the same defect class this ticket exists to fix. Wrote
  the axis as an INVARIANT ("a route may reflect only if every browser-reachable auth path on it
  runs the origin gate") instead, named both PRs and their shapes without picking a winner, and
  pointed at a `grep` command instead of a line number for the part that will move. Also: FOLLOW-649
  (told to re-scope-or-close) turned out to have exactly one surviving real finding after its other
  two premises inverted — but that finding (`adaptive.estalara.com` in the §V.1.1 diagram) was
  already inside the scope of a much older, still-open ticket (FOLLOW-154, filed 2026-05-29, never
  promoted) that a single grep for the host string surfaced with dozens of sibling hits across §U
  and §V. Closed FOLLOW-649 into FOLLOW-154 rather than re-scoping it to duplicate ownership of the
  same sweep. Also could not cite `docs/ops/MEASURED_PREMISES.md`'s `[MP-NNN]` tags for the live
  `FIRST_PARTY_TENANT_ID`/`allowed_origins` state (FOLLOW-952/PR #735) because that file is not yet
  in this branch's working tree — pointed at the doc and the reason instead of inventing a tag
  number. As the no-Bash agent: made real `Edit`/`Write` calls (the branch was already checked out,
  not `main`, so the branch guard never fired) but could not run `git commit`, `prettier`, or
  `eslint` myself — flagged this explicitly to the delegator rather than silently assuming it would
  happen. · **Where a spec risked describing behavior with no owner:** the reflect-vs-platform-only
  mechanism, almost — writing it at the data-structure level would have asserted a specific runtime
  behavior neither merged PR yet owns. Avoided by writing the invariant + both candidate owners +
  the unresolved-human-decision framing explicitly, so nothing in the doc claims a behavior that
  isn't either shipped or named-and-pending. · **Guardrail I'd add:** when an AC asks you to
  document a mechanism, check for open PRs touching the same function/file BEFORE writing — `grep`
  the backlog for the symbol name across FOLLOW_UPS.md, not just the code. A ticket like this one
  that explicitly flags the hazard is the exception; most won't, and the failure mode
  (freshly-dated, freshly-wrong doc) is identical either way.

- **2026-09-13 / FOLLOW-1148 (+1129, +1197), MASTER_DESIGN v4.12**
  - **What I decided:**
    - Split the gate into §P.0 (definition: rule, critical path, four conditions) and §Snapshot.0
      (status per condition, with citations). A `P.0` row in §Snapshot.1 points at both. This keeps
      §Y.3's "only §Snapshot asserts state" intact instead of writing status into §P.
    - Cited every harness run by recorded `source`, never by tally, because #894 retired the
      predicate that graded all the greens.
    - Recorded CEO rulings #2–#5 as one §E.3.4 block. Each item gives the ruling, the implementing
      ticket's requirements (attributed to the ticket, not the CEO), the HEAD behaviour with
      file:line, and the owning stub.
  - **Where a spec risked describing behavior with no owner:**
    - All four rulings are unbuilt at HEAD. Each is pinned to a dated stub (FOLLOW-1201…1204) with
      the current contrary code cited next to it, so no sentence reads as shipped.
    - Two things I could not ground and flagged instead of writing:
      - FOLLOW-1204's dilution query needs a cross-session id on server rows, but the xid is
        transmitted nowhere (FOLLOW-146).
      - D-4 also named `chat.contact_initiated`, which ruling #4 does not mention.
    - Also found that the harness's declared grade (`outcomes.adapted`, counted by `source` only) is
      looser than AC(1)'s `ok`. I wrote "read together with `ok`" rather than silently picking one.
  - **Guardrail I'd add:**
    - When a SoT section cites a test result, it must name the predicate version (commit or PR) that
      graded it. A tally without its grader goes stale the moment the grader changes, with no diff
      touching the sentence.
    - Split every ruling into "ruling text" and "implementing-ticket AC" before transcribing it, so
      AC details are never attributed to the CEO.
