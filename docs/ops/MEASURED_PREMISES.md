# Measured premises — the register

A **measured premise** is a claim about a live environment that this repository cannot verify from
its own contents: a row count in production Postgres, whether an environment variable is set in
Vercel, what a deployed response header actually says. Code and runbooks are written on top of these
claims, and the claims go stale silently.

This file is where they live, and `scripts/check-measured-premises.mjs` is the control that reads
it.

---

## The decision this file records [FOLLOW-946 AC(4), answered by FOLLOW-952]

**Question, as filed:** _"State whether a PR that changes how a live request is authorised should
require a measured premise before merge, and if so where that control would live."_

**Answer: YES, and the control is this register plus a CI gate — not the PR template.**

The reasoning, stated so it can be argued with rather than inherited:

1. **A PR-body questionnaire is not a control.** Rule AU's only enforcement was a question answered
   by the claimant, and it failed to prevent its own recurrence one PR later (RETRO-268 §6) — the
   same author honoured it in one file and violated it in another, in one session. A control whose
   only reader is the person it constrains measures nothing.
2. **The estate's evidence points one way.** Five consecutive origin/header defects were found by
   manual `curl` AFTER merge (FOLLOW-929 → 936 → 941 → 942 → 953). Every one of them was a live-
   environment fact that no test could hold.
3. **The estate already has the working shape.** FOLLOW-945 converted two prose registers into
   machine-checked ones. This is that pattern applied to a third.

**What the gate can and cannot do, stated rather than implied.** CI has no read path to production
Postgres, Vercel, or Cloudflare, so it can **never** re-measure a premise. It enforces the only
thing a repo-side control can: that every premise is **written down, dated, owned, cited, and not
past its expiry**. Re-measuring stays human work. The gate's contribution is that the human work
becomes _visible and overdue_ instead of _forgotten_.

**Corollary — where the control does NOT live.** Not in `docs/CONVENTIONS.md` prose, and not as a
new PR-template checkbox. Both were available before this ticket and neither would have caught the
two in-source measurements that prompted it.

### The mechanism-assertion bar [RETRO-268 §6, folded into FOLLOW-952]

A ticket or PR body may assert an **outcome** on the strength of a probe. It may **not** assert a
**mechanism** on the same evidence. To claim a mechanism you need a discriminating experiment — one
whose control differs from the subject _only_ on the axis under test — or you must write the word
**hypothesis** and leave it open.

The instance that minted this: PR #722 eliminated a hypothesis using `/consent-text.json` as a
control, but that path is a **static `public/` asset** while the subject is **function-served**, and
static-vs-function was the very axis under test. The elimination was invalid and the outcome was
still reported as a mechanism.

### Measurements do not belong in shipped source

A comment in `origin-policy.ts` asserting what production Postgres holds is a claim with no reader,
no owner and no expiry — it ships to production and ages in place. Shipped source may **cite** a
premise ID; it may not **restate** the measurement. The gate enforces the citation direction for
dated claims (see its own scope note).

---

## Format

Each entry is one `## MP-NNN — <claim>` section with these fields, all required:

| field             | meaning                                                                          |
| ----------------- | -------------------------------------------------------------------------------- |
| `claim`           | the fact, stated so it can be false                                              |
| `measured_on`     | ISO date the measurement was actually taken                                      |
| `revalidate_by`   | ISO date after which the gate goes RED                                           |
| `revalidate_on`   | the event that invalidates it sooner than the date — `none` if there is none     |
| `measure_with`    | the exact command/call that re-takes it, so the gate's failure is self-servicing |
| `relied_on_by`    | what breaks — file paths, not vibes                                              |
| `falsified_means` | what is actually true about the system if the claim is false                     |

**Why `revalidate_by` is a hard failure and not a warning.** A warning is the unenforced human
obligation this ticket was filed about (`BRAND_PROVISIONING.md`'s _"Re-verify this the moment §Step
6 is run"_, which nothing read). The remedy when it fires is to **re-measure and update the date**,
or to delete the entry and the code that leans on it — never to push the date without running
`measure_with`.

**Why 90 days.** Long enough not to be busywork, short enough that a premise cannot survive a whole
sprint cycle unexamined. It is a default, not a law: an entry may carry a shorter horizon, and
`revalidate_on` is usually the trigger that fires first.

---

## MP-001 — production has no tenant or API key with a populated `allowed_origins`

- **claim:** In production Postgres, every row of `tenants.allowed_origins` and every unrevoked row
  of `api_keys.allowed_origins` is empty or NULL, so no live request reaches the configured-origins
  branch of `resolveOriginDecision`.
- **measured_on:** 2026-08-10
- **revalidate_by:** 2026-11-11
- **revalidate_on:** `docs/runbooks/BRAND_PROVISIONING.md` §Step 6 is run for ANY tenant — that run
  is precisely what makes the column live
- **measure_with:** `SELECT id, name, allowed_origins FROM tenants;` and
  `SELECT tenant_id, allowed_origins FROM api_keys WHERE revoked_at IS NULL;` against production
- **relied_on_by:** `apps/control-plane/src/lib/origin-policy.ts` (the fail-open unconfigured
  branch, and the FOLLOW-946 first-party clause being latent rather than live);
  `docs/runbooks/BRAND_PROVISIONING.md` §Step 6
- **falsified_means:** the FOLLOW-946 first-party clause is REACHABLE on live traffic, so
  `FIRST_PARTY_TENANT_ID` being wrong stops being latent and becomes a first-party lockout — the
  outage FOLLOW-951 made fail-closed against.

## MP-002 — Vercel Production `FIRST_PARTY_TENANT_ID` resolves to a real, active tenant

- **claim:** The `FIRST_PARTY_TENANT_ID` value served to the Production deployment is a well-formed
  UUID that resolves to an existing, active tenant row — not unset, blank, malformed, or
  well-formed-but-wrong — so `firstPartyStatus === 'unverified'` is not live in production.
- **measured_on:** 2026-08-12
- **revalidate_by:** 2026-11-11
- **revalidate_on:** `FIRST_PARTY_TENANT_ID` is edited or rotated, a Vercel environment is added, or
  anything begins failing with `first_party_unverified`
- **measure_with:** `GET https://admin.estalara.com/api/admin/diagnostics/first-party-tenant` (staff
  auth; reports STATUS, never the value). Expect
  `{"env_status":"valid","resolves_to_known_tenant":true,"tenant_status":"active","tenant_lookup_error":false}`
  — `tenant_lookup_error:false` is what makes the DB leg a measurement rather than a default. **Two
  traps, both previously hit:** (a) `vercel env ls production` showing
  `FIRST_PARTY_TENANT_ID  Encrypted  Production` rules out `unset` and nothing else — `Encrypted` is
  a fact about the value being unreadable, not about the variable being correct; (b) `vercel env ls`
  and `vercel env pull` are DIFFERENT calls — pull returns this variable empty, but it also returns
  46 of 55 variables empty including `NODE_ENV`, so an empty pull is a tool artefact and NOT
  evidence the variable is blank. That inference nearly became a false drift alarm. Use the
  diagnostic route: it is the only call that measures all four failure modes at once.
- **relied_on_by:** `apps/control-plane/src/lib/origin-policy.ts` (the `'unverified'` deny branch
  being unreachable in prod); `apps/control-plane/src/lib/brand-identity.ts`
- **falsified_means:** first-party requests are refused `first_party_unverified` the moment MP-001
  stops holding, and four of six callers collapse that into a 401 on a correct API key (FOLLOW-943).

## MP-003 — Doppler `prd` holds the correct live tenant UUID for `FIRST_PARTY_TENANT_ID`

- **claim:** The `prd` Doppler config's `FIRST_PARTY_TENANT_ID` matches the live first-party tenant
  id. **Doppler is not the store read at runtime** — Vercel is (MP-002). This entry exists because
  the two stores are unsynced and drift between them is the documented failure shape.
- **measured_on:** 2026-08-11
- **revalidate_by:** 2026-11-11
- **revalidate_on:** either store's value is edited
- **measure_with:** `doppler run --config prd -- printenv FIRST_PARTY_TENANT_ID`
- **relied_on_by:** `apps/control-plane/src/lib/origin-policy.ts` (the two-unsynced-stores warning)
- **falsified_means:** the two stores disagree, so any operator reasoning from Doppler is reasoning
  about a value production never sees.

## MP-004 — `SENTRY_DSN_CONTROL_PLANE` is absent from every Vercel environment

- **claim:** No Vercel environment defines `SENTRY_DSN_CONTROL_PLANE`, so every control-plane Sentry
  capture site is a no-op and the SILENCE of those signals carries zero bits.
- **measured_on:** 2026-08-12
- **revalidate_by:** 2026-11-11
- **revalidate_on:** ESC-057 is actioned (Sentry org + projects created and a DSN set) — which is
  exactly what makes this claim false without any code change
- **measure_with:** `vercel env ls production` / `preview` / `development`, grepping for
  `SENTRY_DSN_CONTROL_PLANE`
- **relied_on_by:** `apps/control-plane/src/lib/brand-identity.ts`;
  `apps/control-plane/src/lib/adapt-get-auth.ts`; `docs/runbooks/BRAND_PROVISIONING.md`
- **falsified_means:** the signals ARE delivered, so their absence becomes evidence — and reasoning
  written on "silence proves nothing" is needlessly pessimistic rather than wrong.

## MP-005 — `SENTRY_DSN_INGEST` is not set on the production ingest Worker

- **claim:** The production ingest Worker has no `SENTRY_DSN_INGEST` secret, so its Sentry captures
  are no-ops.
- **measured_on:** 2026-08-12
- **revalidate_by:** 2026-11-11
- **revalidate_on:** ESC-057 is actioned, or any `wrangler secret put` naming this key
- **measure_with:** `doppler run -- npx wrangler secret list --env production` — the `--env` is
  load-bearing; the bare form reports "Worker does not exist"
- **relied_on_by:** `apps/ingest/src/handlers/events.ts`;
  `apps/ingest/src/observability-signals.test.ts`; `docs/runbooks/INGEST_WORKER_DEPLOY.md`
- **falsified_means:** ingest Sentry captures are live, and the "known and currently empty" site
  count that test asserts is no longer the whole story.
