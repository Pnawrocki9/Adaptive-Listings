# External-Brand Go-Live — Compliance Technical-Layer Check

**Date:** 2026-07-25 **Author:** Compliance Engineering **Ticket:** FOLLOW-653 **CEO ruling
(binding, do not re-litigate):** 2026-07-25 (session 58) — client contracts cover
controller/processor roles; DPIA and controller-role analysis are OUT of scope for this document.
This check verifies ONLY the technical artifacts, in-repo, with file:line evidence (Operating
Principle 5 — verify, don't guess).

## Context

Three external client brands are onboarding now (domains not yet known). Per the CEO's single-tenant
re-brand model (memory `project_single_tenant_rebrand_model`,
`docs/DECISION-BRIEF-MOAT-2026-07-24.md`, `docs/DECISION-BRIEF-FACADES-622-623-2026-07-24.md`), each
brand is a **full white-label re-deployment of `app.estalara.com` on the client's own domain** — the
same SvelteKit app, same DOM, one shared Postgres/ClickHouse data pool, one `tenants` row per brand.
Tenant identity is resolved from `api_key`/`tenant_id`, never from the serving host
(DOMAIN-INDEPENDENCE ruling).

**Load-bearing repo-boundary fact, confirmed for this check:** the `app.estalara.com` product itself
(the investor-facing registration form, consent checkbox, and any Privacy Policy page) is **not in
this repository**. It is a separately-maintained, no-code SvelteKit product edited outside
Adaptive-Listings (see `docs/MASTER_DESIGN.md` "app.estalara.com (żywy produkt) — NIE jest
modyfikowany poza standardowym snippetem loadera"; `backlog/FOLLOW_UPS.md` FOLLOW-652 AC-2 names the
deployment side as "outside this repo"). This repo owns: the embeddable SDK (`packages/sdk`), the
control-plane API (`apps/control-plane`, incl. `/api/config`, `/api/quiz/public-config`,
`/api/v1/consent/*`, `/api/dsr/*`), and the disclosure-text templates (`docs/compliance/`). Several
of the ticket's four axes therefore have a hard verification ceiling: this repo can prove what the
API/SDK layer does; it cannot prove what the out-of-repo app renders. That ceiling is called out
per-axis below, not glossed over.

## Verdict table

| #   | Axis                                                                                   | Verdict                                                    | Evidence |
| --- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------- |
| 1   | Privacy policy surfacing on client-domain deployments                                  | **PARTIAL / OPERATOR-GATED**                               | §1 below |
| 2   | Consent umbrella (FOLLOW-373 lineage) works on client domains, no hardcoded "Estalara" | **CLOSED IN CODE 2026-07-28** (was GAP; two open items)    | §2 below |
| 3   | Per-user opt-out (§H.9/FOLLOW-372) reachable on client brands                          | **OK** (contrary to the ticket's premise — see correction) | §3 below |
| 4   | DSR flows tenant-agnostic across brands                                                | **OK, with one concrete gap**                              | §4 below |

---

## 1. Privacy policy surfacing — PARTIAL / OPERATOR-GATED

**What this repo verifiably provides:**

- The disclosure text tenants/brands must publish lives in
  `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` (§1 general disclosure, §4 storage-key table, §6
  platform-registration disclosure).
- `GET /api/quiz/public-config` is tenant-parameterized end-to-end: it resolves the tenant from the
  request's API key, not the host, and optionally emits a `brand` slice (`primary_color`,
  `logo_url`, `white_label` — `packages/shared/src/schemas/presentation-config.ts:45-49`, producer
  `apps/control-plane/src/app/api/quiz/public-config/route.ts:212-224`, consumer
  `packages/sdk/src/index.ts:1039` for the quiz-card logo). This is genuinely brand-agnostic — no
  domain or "Estalara" hardcode found in this path.
- The consent banner's "Learn more" link is snippet-configurable per deployment (`data-privacy-url`
  → `packages/sdk/src/core/config.ts:213` → `privacyPolicyUrl` →
  `packages/sdk/src/ui/consent-banner.ts:247-255`), so each brand's deployment CAN point it at its
  own Privacy Policy page. No hardcoded URL found in the SDK.
- The SDK's own visible UI copy (consent banner, quiz widgets, micro-poll, profiling toggle) does
  **not** hardcode the string "Estalara" anywhere — grep across `packages/sdk/src/ui/*.ts`
  (non-test) returns zero matches for a literal `Estalara` in rendered copy.

**What this repo cannot verify (hard ceiling):**

- Whether an actual Privacy Policy PAGE exists per client-domain deployment, and whether it contains
  the §1/§4 disclosures with brand-correct wording, is decided entirely on the out-of-repo
  `app.estalara.com` side. No evidence either way is available from this codebase. This is the
  single largest verification gap for this axis — see PROPOSED STUB C.

**Fix applied in this PR (real gap found and closed):**

- `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §4 was missing a real, shipped SDK storage key:
  `__estalara_profiling_opt_out__` (`packages/sdk/src/core/profiling-opt-out.ts:30`, shipped
  2026-06-21 in PR #337 / FOLLOW-372). It was never added to the table, and the CI gate that is
  supposed to catch this (`scripts/check-privacy-notice-keys.sh`, `privacy-notice-keys-sync` job,
  FOLLOW-230) only scans for constants ending in `_STORAGE_KEY`, `_KEY_PREFIX`, or `_DISMISS_KEY` —
  `PROFILING_OPT_OUT_KEY` matches none of those three suffixes, so the gate never flagged it. This
  is exactly the Rule N failure mode the gate exists to prevent (RETRO-036 CB-1), just outside the
  gate's current regex coverage. **Fixed in this PR:** added the row (with grep-verified lifetime,
  storage type, and erase-on-denial behavior — verified at `packages/sdk/src/index.ts:292` and
  `:355`), bumped the template to v1.5, added an implementation note, updated the revision history.
  See PROPOSED STUB B for closing the CI gate's blind spot itself.

---

## 2. Consent umbrella (FOLLOW-373 lineage) — CLOSED IN CODE 2026-07-28 (was: GAP)

> **[FOLLOW-685 / FOLLOW-699 / FOLLOW-713, 2026-07-28]** The gap this section documented when it was
> written has since been built out by PRs #624, #629, #631, #632, #633 and #634. What remains open
> here is **not** the per-brand identity mechanism — that ships — but the two items called out
> inline below (PROPOSED STUB A item 3, and item (c) of the out-of-repo confirmation in §"Scope"),
> both of which prescribed a flow that is now the **wrong** one. The rest of this section is
> retained as the historical record of why the work was commissioned; read the two inline
> corrections as authoritative where they conflict with the surrounding prose.
>
> **The canonical registration flow is GET-then-echo, recorded once in `backlog/HANDOFFS.md` →
> FOLLOW-374 §"What Rafał needs to do", Step 1.** That is the single place the decision lives; this
> document defers to it and must not restate it.

**What works, tenant-agnostic:**

- `POST /api/v1/consent/platform-registration`
  (`apps/control-plane/src/app/api/v1/consent/platform-registration/route.ts`) requires and
  validates `tenant_id` as a UUID (`lib.ts:54-59`), never infers it from a header, origin, or
  hardcoded constant. It writes `consentRecords` scoped to that `tenant_id` (`route.ts:264-274`).
  Mechanically, any brand's `tenant_id` works.
- HMAC auth (`route.ts:112-132`) and replay-nonce handling are also tenant-agnostic.

**Concrete, grep-verified gaps:**

1. **Canonical text hardcodes the vendor identity with no brand-substitution mechanism.**
   `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §6.1 (the text the consent checkbox is supposed to
   present) reads: _"you consent to the Estalara Adaptive Listings service (provided by Time2Show,
   Inc.) processing your information..."_ — literal, no placeholder. The `tenants` table does carry
   a free-text `name` column (`packages/db/src/schema/tenants.ts:26`), but grep confirms it is used
   **only** in internal admin/analytics surfaces
   (`apps/control-plane/src/app/admin/tenants/data.ts:87`,
   `apps/control-plane/src/app/admin/demo-sessions/data.ts:74`,
   `apps/control-plane/src/app/api/admin/analytics/rollup/data.ts:129`) — it is never surfaced to
   `/api/quiz/public-config`, `BrandConfigSchema`, or the consent-recording endpoint. There is
   currently no data path in this repo that could parameterize the disclosure text with the brand's
   own name even if the out-of-repo app wanted to consume one.
2. **Silent default masks non-canonical text in the audit trail — an integrity risk introduced by
   white-labeling.** `route.ts:270`:
   `consentTextHash: body.consent_text_hash ?? CANONICAL_CONSENT_TEXT_HASH`. When the caller (the
   out-of-repo app-side implementation, per-brand) omits `consent_text_hash`, the system silently
   records the hash of the **Estalara-branded English §6.1 text** as if that were what was shown —
   regardless of what text a white-label brand's deployment actually displayed. At one first-party
   tenant this default was harmless (the canonical text and the displayed text were always the same
   thing). At three external brands, if any deployment renders brand-substituted text but forgets to
   compute and send its own hash, the `consent_records` audit trail will misrepresent what the
   investor actually saw — a fabricated compliance record, not merely a missing one.

**Verdict: GAP** — both the missing brand-substitution data path and the silent-default audit-hash
behavior are real, verifiable, and specific to the external-brand expansion (neither was a problem
at one first-party tenant). See PROPOSED STUB A.

---

## 3. Per-user opt-out (§H.9/FOLLOW-372) — OK, correcting the ticket's premise

The ticket brief (and, verified independently, `backlog/FOLLOW_UPS.md` FOLLOW-641 and
`docs/adr/ADR-0019-per-tenant-presentation-config.md`, both authored the same session, 2026-07-24)
state that "the SDK renders NO visitor-facing toggle UI" for the profiling opt-out. **This is
factually incorrect against `HEAD`** — verified independently in this ticket, not assumed:

- `packages/sdk/src/ui/profiling-toggle.ts` implements a full keyboard-operable, ARIA-labelled
  Shadow-DOM toggle (`renderProfilingToggle()`), wired to
  `packages/sdk/src/core/profiling-opt-out.ts` (`setProfilingOptOut`/`isProfilingOptedOut`).
- It is mounted **unconditionally** whenever a Shadow DOM host exists, post-consent:
  `packages/sdk/src/index.ts:1051`
  (`profilingToggle = renderProfilingToggle(shadowHost.root, {...})`), inside the `if (shadowHost)`
  block at init step 5b — no tenant flag, brand config, or feature gate guards it (grep confirms no
  `optOutEnabled`/`opt_out_widget` conditional exists in `index.ts` or `config.ts`).
- It correctly enforces the §H.9 scope: opting out suspends adaptation-directive fetches
  (`index.ts:1024`, `if (config.decisionApiUrl && !profilingOptedOut)`) and drops behavioral events
  from the queue (multiple `if (profilingOptedOut) return;` guards, e.g. `index.ts:1092`, `:1206`,
  `:1368`, `:1598`), while explicitly NOT affecting buying-intent/lead-ranking/chat-summary
  processing, per its own docstring.
- It is reversible (`onChange` re-triggers `refreshDirectives()` on opt-in, `index.ts:1058-1061`)
  and its storage key is now disclosed in the Privacy Notice (this PR — see §1 above).
- Because SDK mounting is domain-independent (tenant resolved from `api_key`, not host — the
  DOMAIN-INDEPENDENCE ruling), this toggle is reachable on **every** brand deployment today, not
  just `app.estalara.com`'s own domain. Shipped in PR #337 / FOLLOW-372, merged 2026-06-21 — over a
  month before FOLLOW-641/ADR-0019 were filed.

**Verdict: OK.** The compliance-required mechanism (a visible, reversible, reachable per-user
opt-out) already exists and works on every brand today. What genuinely remains open — and is the
only part of FOLLOW-641 that is still accurate — is **AC-2 of FOLLOW-641**: per-brand appearance
(colors), placement, and label i18n via the presentation-config ADR (`opt_out_widget` slice, not yet
added — `packages/shared/src/schemas/presentation-config.ts:71` shows it commented out, "added with
its SDK consumer"). That is a cosmetic/admin-UX gap, not a reachability or compliance gap. See
PROPOSED STUB D to correct the two documents that overstate the gap.

---

## 4. DSR flows — OK, with one concrete gap

**Tenant-agnosticism, grep-verified across all five routes:**

- `apps/control-plane/src/app/api/dsr/initiate/route.ts`: `tenantId = claims.tenant_id` from the
  staff JWT (`:101`); the session-ownership check is scoped
  `and(eq(sessionEmbeddings.sessionId, session_id), eq(sessionEmbeddings.tenantId, tenantId))`
  (`:142-144`). No hardcoded tenant.
- `apps/control-plane/src/app/api/dsr/access/route.ts`, `.../erase/route.ts`,
  `.../portability/route.ts`: all resolve `tenantId` from the OTP-verification record
  (`verifyAndConsumeOtp` → `record.tenantId`), then scope every downstream query
  (`sessionEmbeddings`, `consentRecords`, `conversionLabels`, `engagementScores`, `quizCompletions`,
  `intentSessions`, ClickHouse disclosure) to `record.tenantId` — dozens of
  `eq(<table>.tenantId, record.tenantId)` call sites, zero hardcoded tenant/domain literals found.
- `apps/control-plane/src/app/api/dsr/mutation-poll/route.ts`: iterates rows carrying their own
  `tenantId` (`:204`, `:274`, `:340`); auth is a Vercel cron-secret check (`:78`), unrelated to
  tenant identity.
- Reachability from a client-domain deployment is a non-issue for `access`/`erase`/`portability`:
  the data subject reaches them via a direct link into the shared `apps/control-plane` host (emailed
  OTP flow), not via a fetch from the client's own domain, so no CORS/origin dependency applies (the
  separately-tracked `allowed_origins` de-scope/re-enable, FOLLOW-622/642, governs SDK→ingest
  traffic, not this).

**Concrete gap — DSR emails are 100% hardcoded to "Estalara" regardless of brand:**

- `apps/control-plane/src/app/api/dsr/initiate/route.ts:209`:
  `subject: 'Your Estalara data request'`.
- `apps/control-plane/src/app/api/dsr/initiate/route.ts:211`:
  `<p>You requested access to your personal data processed by Estalara.</p>`.
- `apps/control-plane/src/lib/email/resend.ts:17`:
  `const DEFAULT_FROM = 'Estalara <noreply@contact.estalara.com>'`, and the `dsr/initiate` call site
  (`route.ts:207-217`) does not pass a `from` override, even though `sendEmail()` already accepts
  one (`resend.ts:19-24`, `opts.from ?? DEFAULT_FROM`). A data subject of a white-label brand who
  has never otherwise seen the name "Estalara" would receive a DSR verification email that
  introduces an unexplained third party — a brand-consistency and (potentially) transparency
  problem, not just cosmetic, since the email is the data subject's entry point into exercising
  their statutory rights.

**Context, not a new brand-specific gap (pre-existing, applies equally to the single first-party
tenant):** there is no self-service UI anywhere in this repo for either DSR initiation (staff-only,
JWT-gated — no admin dashboard page found under `apps/control-plane/src/app/admin` or `dashboard`
that calls `/api/dsr/initiate`) or OTP redemption (`access`/`erase`/`portability` are bare API
endpoints with zero consuming pages in `apps/control-plane/src/app`). "DSR reachable from a
client-domain deployment" is therefore true only in the narrow sense of "the API is tenant-correct
and not domain-gated" — there is no client-domain-facing DSR UI for a data subject to use, on any
brand, today. Not filing a new stub for this since it predates the white-label epic and is unrelated
to per-brand correctness; flagging for awareness only.

**Verdict: OK** (tenant isolation is real and correct) **with one concrete gap** (hardcoded email
branding) — see PROPOSED STUB A (bundles naturally with the consent-hash fix, same underlying need
for a per-brand display name + sender identity).

---

## Prioritized gap list

1. **P1 — DSR + consent emails/hash hardcode "Estalara"; consent-hash default can fabricate an audit
   record for non-canonical text.** (Axis 2 + 4). Real risk, grep-verified, worsens specifically
   because of the 3-brand expansion. → PROPOSED STUB A.
2. **P1 — Cannot verify in-repo whether the out-of-repo `app.estalara.com` white-label deployments
   will actually render brand-correct Privacy Policy pages and §6.1 consent text before go-live.**
   (Axis 1 + 2). Not fixable from this repo; needs an explicit HANDOFF confirmation. → PROPOSED STUB
   C; mark the go-live QA gate UNSATISFIABLE until answered, per the compliance-engineer guardrail
   on disguised-P0 pre-flight gates.
3. **P2 — CI gate blind spot**: `privacy-notice-keys-sync` missed a real shipped storage key for
   over a month because its regex only covers three specific suffixes. → PROPOSED STUB B.
4. **P3 — Documentation drift**: FOLLOW-641 and ADR-0019 both overstate the per-user opt-out gap
   (claim "no toggle UI" when one has shipped and been live since 2026-06-21). Low risk (doesn't
   understate a compliance gap — the opposite direction), but wastes planning effort and could cause
   someone to rebuild working code. → PROPOSED STUB D.

No protected-class/proxy-steering copy review was needed (no copy changes touch adaptation content
in this PR). No new retention promise was made without a paired TTL — the one disclosure added
(`__estalara_profiling_opt_out__`) documents existing, already-implemented erase-on-denial behavior;
no new behavior was asserted.

---

## PROPOSED STUBS

_(Not added to `backlog/FOLLOW_UPS.md` — parallel workers are touching backlog files this session.
PM to promote/file these.)_

### PROPOSED STUB A — Per-brand identity for DSR/consent emails + required (not defaulted) consent-text hash for non-canonical text

**Priority:** P1 · **Recommended agent:** backend-engineer + compliance-engineer (joint) · **Depends
on:** none (can start now; land before first external brand's investors can trigger a DSR or
register) **Regulatory basis:** GDPR Art. 5(2) accountability (consent records must reflect what was
actually shown), Art. 12 (transparent, brand-consistent communication to data subjects).

**Scope:**

1. Surface a per-brand display name to the surfaces that currently hardcode "Estalara": either reuse
   `tenants.name` or add a dedicated field to `brand_config`/`BrandConfigSchema` if `tenants.name`
   is deemed unsuitable for public display (compliance-engineer to confirm which, based on how
   `tenants.name` is currently populated — verify before choosing).
2. `apps/control-plane/src/app/api/dsr/initiate/route.ts`: parameterize the OTP email subject/body
   with the brand name (fall back to "Estalara" only for the first-party tenant); pass a per-brand
   `from` to `sendEmail()` (mechanism already exists, `resend.ts:19-24`, just unused here).
3. `apps/control-plane/src/app/api/v1/consent/platform-registration/route.ts`: make
   `consent_text_hash` **required** (400 on omission) for any `tenant_id` other than the first-party
   Estalara tenant, instead of silently defaulting to `CANONICAL_CONSENT_TEXT_HASH`. Add a red-first
   test proving the silent-default path is closed for non-first-party tenants.

   > **[DONE — superseded 2026-07-28, FOLLOW-713]** Shipped, and in a stronger form than this item
   > asked for. `consent_text_hash` is required for non-first-party tenants (FOLLOW-654 leg 2), a
   > provably-wrong hash is refused with `422 consent_text_hash_fabricated` (FOLLOW-684/697), and
   > the omission path no longer defaults to `CANONICAL_CONSENT_TEXT_HASH` for a provisioned tenant
   > (FOLLOW-707). **But this item's framing — that the caller authors its own hash and the server
   > merely stops defaulting — is not the canonical flow.** The caller GETs the text and echoes the
   > returned hash; see `backlog/HANDOFFS.md` → FOLLOW-374, Step 1. Separately still open:
   > `CANONICAL_CONSENT_TEXT_HASH` is a hand-typed placeholder, not a digest (FOLLOW-704, P0), so
   > records already written on the old default path attest no text (FOLLOW-706).

4. Update `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §6 with an explicit `[Brand Name]`
   placeholder convention once the data path exists (compliance-engineer).

**Test cases:** (a) DSR OTP email for a non-first-party tenant contains the brand name, not
"Estalara"; (b) `POST /api/v1/consent/platform-registration` without `consent_text_hash` for a
non-first-party `tenant_id` returns 400; (c) same call for the first-party tenant still defaults
correctly (no regression).

### PROPOSED STUB B — Close the `privacy-notice-keys-sync` CI gate's regex blind spot

**Priority:** P2 · **Recommended agent:** compliance-engineer · **Depends on:** none.

**Scope:** `scripts/check-privacy-notice-keys.sh` only matches constants ending in `_STORAGE_KEY`,
`_KEY_PREFIX`, or `_DISMISS_KEY`. This ticket found a real, shipped, undisclosed key
(`PROFILING_OPT_OUT_KEY`) that the gate did not catch because its name ends in `_KEY` but not one of
those three literal suffixes. Broaden the regex to catch any `[A-Z_]+_KEY$` / `[A-Z_]+_KEY_PREFIX$`
pattern (or enumerate known key-holding modules explicitly), with a red-first fixture (a
`FOO_OPT_OUT_KEY` constant deliberately left undisclosed) proving the new regex catches this shape
before merging the broadened version.

**Test cases:** fixture constant `_OPT_OUT_KEY`-suffixed and undisclosed → gate fails; same fixture
disclosed → gate passes; existing `_STORAGE_KEY`/`_KEY_PREFIX`/`_DISMISS_KEY` fixtures unaffected
(no regression).

### PROPOSED STUB C — HANDOFF verification: out-of-repo `app.estalara.com` white-label deployments render brand-correct disclosures

**Priority:** P1 · **Recommended agent:** compliance-engineer (drafts the checklist), Rafał Palak /
CTO (confirms, owns the out-of-repo implementation) · **Depends on:** the 3 brands' domains/deploy
plans existing (per FOLLOW-652).

**Scope:** This repo cannot verify what the out-of-repo `app.estalara.com` white-label shell
renders. Before any of the 3 external brands goes live, get an explicit confirmation (recorded in
`backlog/HANDOFFS.md`, same pattern as the existing FOLLOW-373 HANDOFF) that each brand's
deployment: (a) publishes a Privacy Policy page containing the `PRIVACY_NOTICE_TEMPLATE.md` §1/§4
disclosures with the brand's own name substituted where the template currently says
"Estalara"/"Time2Show, Inc." (subject to whatever the client contract's controller/processor framing
requires — that legal call is explicitly not compliance-engineer's or this document's to make); (b)
presents the §6.1 registration consent checkbox with brand-correct wording; (c) **[CORRECTED
2026-07-28 — FOLLOW-685 AC-3 / FOLLOW-713 AC-3]** ~~always computes and sends its own
`consent_text_hash` to `/api/v1/consent/platform-registration` when displaying non-canonical text~~
— **GETs the consent text from `/api/v1/consent/platform-registration`, displays those exact bytes,
and echoes the returned `consent_text_hash` on the POST.** Authoring your own copy of the text and
hashing it produces evidence of nothing under Art. 7(1): it shows two systems agree on a string, not
that the string is what the data subject read. Computing your own hash remains acceptable **only**
for genuinely non-canonical copy (e.g. a translation), and such a record is written
flagged-as-unverified, not silently accepted. The flow is specified once, in `backlog/HANDOFFS.md` →
FOLLOW-374 Step 1; (d) sets `data-privacy-url` on the SDK snippet to that brand's own Privacy Policy
URL.

**Per the compliance-engineer guardrail:** until this HANDOFF confirmation is recorded, the
external-brand go-live QA gate for "privacy policy + consent text are brand-correct" must be marked
**UNSATISFIABLE-PENDING-HANDOFF**, not silently passed — this is a disguised P0 (a false disclosure
would be a false statement to data subjects), not a checklist nice-to-have.

### PROPOSED STUB D — Correct FOLLOW-641 and ADR-0019: the opt-out toggle widget already ships; only per-brand appearance remains

**Priority:** P3 · **Recommended agent:** compliance-engineer or architect (doc-only) · **Depends
on:** none.

**Scope:** `backlog/FOLLOW_UPS.md` FOLLOW-641 and
`docs/adr/ADR-0019-per-tenant-presentation-config.md` both state "the SDK renders NO visitor-facing
toggle UI" for the profiling opt-out. This is factually incorrect against `HEAD` (see Axis 3 above —
`packages/sdk/src/ui/profiling-toggle.ts`, live since PR #337 / 2026-06-21). Update both documents
to record AC-1 (the toggle widget itself) as DONE, and re-scope FOLLOW-641 to its accurate residual:
AC-2 only (per-brand colors, placement, label i18n via the `opt_out_widget` presentation-config
slice + admin editor fields). Re-estimate `estimated_hours` accordingly (likely well under the
current 8h, since the hardest part — the accessible widget + state wiring + §H.9 enforcement — is
already built).

---

## Files touched in this PR

- `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` — added missing `__estalara_profiling_opt_out__` row
  to §4, bumped to v1.5, added implementation note + revision history entry (real gap closed, grep-
  verified per the guardrail).
- `docs/compliance/EXTERNAL_BRAND_GOLIVE_CHECK-2026-07.md` — this report (new).

No application code was changed. `apps/ingest`, `packages/sdk`, `packages/shared` were read-only for
this ticket (parallel workers active there).

**NEXT:** PM to promote PROPOSED STUBS A–D to `backlog/FOLLOW_UPS.md`/QUEUE; PROPOSED STUB A and C
are P1 and should land before any of the 3 external brands' investors can trigger a DSR request or
complete registration.
