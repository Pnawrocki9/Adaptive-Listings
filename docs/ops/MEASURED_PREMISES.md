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
- **watch_status:** watched — `BRAND_PROVISIONING.md` §Step 6 now BLOCKS on re-measuring this entry
  (FOLLOW-952). The trigger and the obligation live in the same place, which is the only shape that
  has worked here.
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
- **watch_status:** out-of-repo-only — Editing a Vercel env var leaves no trace this repo can read.
  The third arm — "anything begins failing with `first_party_unverified`" — is observable only in
  runtime logs, and its Sentry channel is itself absent [MP-004], so its silence carries zero bits.
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
- **relied_on_by:** `apps/control-plane/src/app/api/admin/diagnostics/first-party-tenant/route.ts`
  (the route this entry is MEASURED WITH — a rename of its response fields silently breaks the
  operator instruction above, RETRO-270 §5c); `apps/control-plane/src/lib/origin-policy.ts` (the
  `'unverified'` deny branch being unreachable in prod);
  `apps/control-plane/src/lib/brand-identity.ts`
- **falsified_means:** first-party requests are refused `first_party_unverified` the moment MP-001
  stops holding, and four of six callers collapse that into a 401 on a correct API key (FOLLOW-943).

## MP-003 — Doppler `prd` holds the correct live tenant UUID for `FIRST_PARTY_TENANT_ID`

- **claim:** The `prd` Doppler config's `FIRST_PARTY_TENANT_ID` matches the live first-party tenant
  id. **Doppler is not the store read at runtime** — Vercel is (MP-002). This entry exists because
  the two stores are unsynced and drift between them is the documented failure shape.
- **measured_on:** 2026-08-11
- **revalidate_by:** 2026-11-11
- **revalidate_on:** either store's value is edited
- **watch_status:** out-of-repo-only — Doppler and Vercel are both external stores; neither emits
  anything the repo sees.
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
- **watch_status:** out-of-repo-only — Creating a Sentry project and setting a DSN in Vercel happens
  entirely outside this repo. CI has no Vercel read path, so no gate can notice.
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
- **watch_status:** out-of-repo-only — `wrangler secret put` against the production Worker leaves no
  repo-visible artefact.
- **measure_with:** `doppler run -- npx wrangler secret list --env production` — the `--env` is
  load-bearing; the bare form reports "Worker does not exist"
- **relied_on_by:** `apps/ingest/src/handlers/events.ts`;
  `apps/ingest/src/observability-signals.test.ts`; `docs/runbooks/INGEST_WORKER_DEPLOY.md`
- **falsified_means:** ingest Sentry captures are live, and the "known and currently empty" site
  count that test asserts is no longer the whole story.

## MP-006 — the only active production tenant has no `sample_listing_url`

- **claim:** In production Postgres, the single active tenant's `sample_listing_url` is NULL or
  empty, so the daily schema-validation job falls back to `https://app.estalara.com`, is 302'd to
  the public marketing page `/en`, and validates a page that is not a listing.
- **measured_on:** 2026-08-08
- **revalidate_by:** 2026-11-06
- **revalidate_on:** any tenant sets `sample_listing_url`, or a second active tenant is created —
  either changes what the job actually fetches
- **watch_status:** out-of-repo-only — Both arms are production Postgres state; CI has no read path
  to it.
- **measure_with:** `SELECT id, name, sample_listing_url FROM tenants WHERE status = 'active';`
  against production
- **relied_on_by:** `apps/data-quality/src/crons/schema_validation.py` (the fallback narrative);
  `apps/data-quality/src/crons/test_schema_validation.py` (`TestProdRegressionAppEstalara`, a golden
  regression pinned to this exact prod condition)
- **falsified_means:** the golden regression is pinned to a condition that no longer exists, so it
  passes while testing nothing — and the drift-detection job is validating a real listing page whose
  failure modes were never characterised.

## MP-007 — the description slot is not reachable in production

- **claim:** No production traffic path reaches the description-slot adaptation, so
  `DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT` gates a path that is latent rather than live.
- **measured_on:** 2026-08-13
- **revalidate_by:** 2026-11-11
- **revalidate_on:** a tenant enables the description slot, or `Estalara-app` ships the
  `data-estalara-description` hook to production (ESC-020 §Step 6 is the event that would do it)
- **watch_status:** out-of-repo-only — `Estalara-app` is a separate, non-GitHub codebase (ESC-020),
  so the hook shipping there is invisible from here.
- **measure_with:** inspect the deployed tenant page for a `data-estalara` description slot, and
  check `adaptation_decisions` in production for rows whose applied directives include the
  description slot
- **relied_on_by:** `packages/sdk/src/core/adapt-floor.ts`
- **falsified_means:** the constant is load-bearing on live traffic rather than latent, so the
  ESC-054 signal-count ruling starts changing what real visitors see — and any regression in it is a
  production behaviour change, not a dormant one.

## MP-008 — three `*.estalara.com` hostnames have no DNS record of their own

- **claim:** The three hostnames named in `packages/shared/src/domains.ts` have NO dedicated DNS
  record. They fall through the `*.estalara.com` wildcard to a non-Cloudflare host presenting a
  self-signed `CN=TRAEFIK DEFAULT CERT`, so nothing is served from them.
- **measured_on:** 2026-08-04
- **revalidate_by:** 2026-11-02
- **revalidate_on:** any of the three is provisioned, or the `*.estalara.com` wildcard target
  changes
- **watch_status:** watchable-but-unwatched — A scheduled job could run this entry’s own
  `measure_with` — `dig +short` on the three hosts plus the `CN=TRAEFIK DEFAULT CERT` subject check
  — and fail when any resolves to something real. That is a network probe of the kind
  `.github/workflows` already runs against prod (the consent-text and Modal effect probes), so it is
  buildable; it simply does not exist. Nearest gate shape: a new scheduled workflow beside
  `consent-text-effect-probe`.
- **measure_with:** `dig +short <host>` for each, then
  `openssl s_client -connect <host>:443 -servername <host> </dev/null 2>/dev/null | openssl x509 -noout -subject`
  — a `CN=TRAEFIK DEFAULT CERT` subject is the wildcard fall-through signature
- **relied_on_by:** `packages/shared/src/domains.ts` (FOLLOW-878 / ESC-052, CEO option 2)
- **falsified_means:** one of the three now resolves to something real, so constants documented as
  pointing at nothing are pointing at a live host — and any code that treats them as inert is wrong.

## MP-009 — the pre-FOLLOW-1001 production build baked `data_source: mock` into the /admin list pages

- **claim:** On the production deployment current at the time of measurement, `/admin/tenants`
  rendered `data_source: mock` (three fictional tenants whose Overview links 404) even though
  `DATABASE_URL_ADMIN` was present in Vercel Production env — because the Vercel build runs
  `pnpm turbo run build` with no `env` declared in `turbo.json` (strict env mode strips every
  non-`NEXT_PUBLIC_*` var from the build environment) and the /admin list pages (`tenants`,
  `registrations`, `demo-sessions`, `analytics`) were statically prerendered at build time, baking
  the "DB unconfigured → mock" branch into static HTML.
- **measured_on:** 2026-08-16
- **revalidate_by:** 2026-11-14
- **revalidate_on:** the first production deployment containing FOLLOW-1001's
  `export const dynamic = 'force-dynamic'` — which is exactly what makes the baked-mock half of this
  claim obsolete (the env-stripping half stays true until a turbo.json env allowlist lands)
- **watch_status:** out-of-repo-only — whether a given deployment serves baked static HTML or
  renders at request time is a property of the deployed artifact; CI has no Vercel read path.
- **measure_with:** log into `admin.estalara.com/sign-in`, open `/admin/tenants`, read the
  `data_source` badge; cross-check `vercel env ls production` for `DATABASE_URL_ADMIN`
- **relied_on_by:** `apps/control-plane/src/app/admin/admin-pages-dynamic.test.ts`;
  `apps/control-plane/src/app/admin/{tenants,registrations,demo-sessions,analytics}/page.tsx` (the
  FOLLOW-1001 docblocks cite this entry)
- **falsified_means:** the list pages render live data on the current deployment — either
  FOLLOW-1001 deployed (expected path) or the build environment gained the DB vars; the
  `force-dynamic` exports remain correct either way (an operator surface must not be build-frozen),
  but the docblocks' historical rationale is then history, not current state.

## MP-010 — production `/api/adapt` served 100% playbook fallback because every LLM directive was discarded as ungrounded

- **claim:** On the production control plane, ten consecutive `POST /api/adapt` calls across five
  archetypes produced **zero** surviving LLM directives: every response carried
  `"source": "playbook_fallback_llm_unavailable"` while the LLM was up, was called and was billed.
  Each discard was logged by FOLLOW-457's post-generation fact check as `hallucinated_number` or
  `hallucinated_proper_name` (e.g. `"7.2% Cap Rate"` for `yield_hunter`). The cause was not model
  quality: `listingContext` was built exclusively from the agency FAQ table and only for a caller
  sending BOTH `listing_id` and a 1536-dim `intent_vector` — which the SDK does not — so the model
  was asked to rewrite copy for a listing it had never been shown, while the base playbook
  directives it is told to improve upon demand figures
  (`"Rental Yield: {yield}% | Gross Income: {income}/yr"`) and nothing in the prompt said those
  figures had to come from the listing.
- **measured_on:** 2026-08-17
- **revalidate_by:** 2026-11-15
- **revalidate_on:** the first production deployment containing FOLLOW-1022 — which is precisely
  what is expected to falsify the 100%-fallback half of this claim
- **watch_status:** watchable-but-unwatched — a canary job probing production `/api/adapt` and
  asserting `source` does not match `*_llm_unavailable` would fire on this trigger from inside the
  repo; FOLLOW-1022's closing note asks for exactly that gate and it is not built yet.
- **measure_with:**
  `curl -sS -X POST https://admin.estalara.com/api/adapt -H 'content-type: application/json' -H "authorization: Bearer $DEMO_JWT" -d '{"tenant_id":"<uuid>", "session_id":"<id>","page_type":"listing_detail","archetype_hint":"yield_hunter", "listing_id":"<uuid>"}'`
  and read `"source":` in the response; repeat across archetypes, then read the control-plane logs
  for `hallucinated_number` / `hallucinated_proper_name`
- **relied_on_by:** `apps/control-plane/src/lib/listing-facts-context.ts`;
  `apps/control-plane/src/lib/llm-gateway.ts`; `apps/control-plane/src/app/api/adapt/route.ts`
- **falsified_means:** the LLM path survives its own fact check in production, so the grounding gap
  is not what emptied it — the fallbacks then have a different cause (key, gateway URL, timeout or
  an intentional cost gate) and FOLLOW-1022's fix is treating a symptom that was already gone.

---

## MP-011 — the SDK boot window is 91% "waiting for hydration to inject the loader", not network and not model

- **claim:** On the local pilot substrate, navigation → first adaptation decision (`settled`) took a
  median of **1295 ms** for a returning buyer with a resolved archetype, and **1468 ms** for a
  consented first decision. The decomposition, from the marks FOLLOW-1033 added:

  | span                                           | returning   | first decision | share    |
  | ---------------------------------------------- | ----------- | -------------- | -------- |
  | `preInit` (navigation → SDK's first line)      | **1174 ms** | **1338 ms**    | **~91%** |
  | of which: SDK bundle actually downloading      | 8 ms        | 7 ms           | 0.6%     |
  | of which: idle AFTER the page's own load event | **637 ms**  | **644 ms**     | ~49%     |
  | `configFetch` (quiz config + intent weights)   | 97 ms       | 103 ms         | ~7%      |
  | `adapt` (the decision round trip)              | 21 ms       | 20 ms          | ~1.5%    |

  The loader is injected `async` from the root layout's `onMount`, so the browser cannot even
  **request** the SDK until hydration finishes: the request started at ~1129 ms while the page's own
  `loadEventEnd` was ~490 ms. Emitting the identical tag server-side into `<head>` instead — same
  attributes, same `async`, still env-driven, via a `transformPageChunk` hook — moves the request to
  **~58 ms** and the settled decision to a median of **439 ms** (hardcoded control: 335 ms).
  Verified exactly one loader tag and one bundle request: the layout's existing
  `data-estalara-loader` idempotence guard makes the client-side injector stand down.

- **measured_on:** 2026-08-18
- **revalidate_by:** 2027-02-18
- **revalidate_on:** the host moving the loader (either direction), or a production build being
  measured — every number here is Vite **dev** mode, where hydration is unbundled and therefore
  slower than production. The SHARES are the durable finding; the absolute milliseconds are not.
- **watch_status:** watchable-and-watched — `packages/sdk/src/core/boot-timing.ts` reports the
  decomposition on the `estalara:adapt:settled` event's `detail` on every page load, so any
  regression is one listener away rather than a re-instrumentation exercise.
- **measure_with:** bring up the local stack per
  `~/Projects/Estalara-gitlab-2026-08-17/ADAPTIVE_LISTINGS_LOCAL.md`, then load a listing and read
  `event.detail` from `estalara:adapt:settled` (or `performance.getEntriesByName('estalara:…')`).
  Discard the first run — Vite's cold compile put `preInit` at 9170 ms once.
- **relied_on_by:** `docs/runbooks/SDK_PRODUCTION_INTEGRATION.md` §9 (cloak `CLOAK_MAX_MS`) and §10
  (loader placement); FOLLOW-1027; FOLLOW-1033
- **falsified_means:** if `preInit` stops dominating — most plausibly because a production build
  hydrates fast enough that the onMount injection is cheap — then loader placement is not the lever,
  and the next candidates are `configFetch` (~100 ms, and the adapt call needs only `language` out
  of it) and the bundle itself. Note that a falsification here does NOT restore the case for an
  SDK-side copy cache: `adapt` was 20 ms, so there is no round trip worth caching away.
