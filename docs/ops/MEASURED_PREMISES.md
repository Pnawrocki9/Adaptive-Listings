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
- **watch_status:** watched — as of 2026-08-20 [FOLLOW-1056]; corrected, this field said the gate
  "is not built yet" and it has existed since FOLLOW-1022:
  `.github/workflows/adapt-llm-source-smoke.yml` probes production `/api/adapt` on every push, PR
  and nightly at 04:20 UTC, and its secrets were provisioned on 2026-08-19 (ESC-062 RESOLVED), so
  the assertion is actually made. Its predicate was NARROWED in the same ticket: it is red for an
  unavailable LLM and **not** for a generation the fact check correctly refused, because that
  distinction now exists on the wire (`fallback_reason`) and previously did not — the gate went red
  three times on 2026-08-20, for two opposite causes: `32370637849` **attempt 1** and `32372181392`
  were fact-check refusals, `32370488989` (12:45) was a 90 s route-level timeout that never read a
  `source` at all (corrected 2026-08-21 [FOLLOW-1060] — see the addendum below; this field
  previously named two reds and the wrong pair of run ids). A third axis was OPEN until 2026-08-21
  and is now closed [FOLLOW-1059]: a canary GREEN did not prove the LLM band was exercised. The
  probe sent no `holdout_pct`, so the route defaulted it into the 10% A/B holdout, which returns
  `source: "default"` before any LLM call — and the predicate scored that as a pass. Measured over
  every canary decision row ever written: **15 of 136 (11.0%)** are `default` /
  `holdout_group = true`, the most recent being run `32422989097` at 2026-08-20 22:10:25, whose own
  log reads `verdict=generated source="default"`. The probe now sends `holdout_pct: 0`, and a
  response that never reached the band is a distinct RED (`band_not_exercised`) rather than a pass.
  The **register** half is separately watched: every generation outcome now writes an `llm_calls`
  row, so a fallback is countable after the fact and not only while a canary happens to be running.
- **measure_with:** (1) the live probe —
  `curl -sS -X POST https://admin.estalara.com/api/adapt -H 'content-type: application/json' -H "authorization: Bearer $DEMO_JWT" -d '{"tenant_id":"<uuid>", "session_id":"<id>","page_type":"listing_detail","archetype_hint":"yield_hunter", "listing_id":"<uuid>"}'`
  and read `"source":` **and `"fallback_reason":`** in the response; repeat across archetypes. (2)
  the register, which replaces "read the control-plane logs" for the rate itself [FOLLOW-1056] —
  against Doppler `prd`:
  `doppler run --project estalara-adaptive-listings --config prd -- bash -c 'curl -sS "$CLICKHOUSE_URL" -u "$CLICKHOUSE_USER:$CLICKHOUSE_PASSWORD" --data-binary "SELECT source, count() n FROM llm_calls WHERE source LIKE '\''llm\_%'\'' AND ts >= now() - INTERVAL 7 DAY GROUP BY source ORDER BY n DESC FORMAT TSVWithNames"'`
  — `llm_tweaked` / `llm_full` are SERVED generations; `*_fact_check_rejected` were generated and
  refused; `*_unavailable_malformed` answered unusably; `*_unavailable_error` never answered.
  Reading the control-plane logs for `hallucinated_number` / `hallucinated_proper_name` is still how
  you get the per-violation REASON, which the row does not carry.
- **relied_on_by:** `apps/control-plane/src/lib/listing-facts-context.ts`;
  `apps/control-plane/src/lib/llm-gateway.ts` (`GenerationOutcome`);
  `apps/control-plane/src/app/api/adapt/route.ts`;
  `tests/integration/adapt-llm-source-live.smoke.test.ts` (`verdictFor`)
- **falsified_means:** the LLM path survives its own fact check in production, so the grounding gap
  is not what emptied it — the fallbacks then have a different cause (key, gateway URL, timeout or
  an intentional cost gate) and FOLLOW-1022's fix is treating a symptom that was already gone.
- **addendum 2026-08-20 [FOLLOW-1056] — the 100%-fallback claim's SUCCESSOR number is now
  measurable, and one production reading corrects a retro.** Two things changed in the same PR:
  every generation outcome writes a row, and served/refused stopped sharing a `source`.

  **What is measurable retroactively, and what is not.** The fallback COUNT was never actually lost
  — `adaptation_decisions.source` has carried it all along, and RETRO-290 §9's "invisible to
  ClickHouse" is precise only about `llm_calls`. Trailing 7 days to 2026-08-20, production:
  `playbook_fallback_llm_unavailable` **115**, `llm_tweaked` **83**, `default` **22** — so **58% of
  in-band decisions still fall back** (115 / 198), a long way from the 100% this premise recorded
  and a long way from healthy. What was NOT recoverable before this change is the fallback's REASON,
  and the tokens/latency of a generation attempt that threw — those are gone for past rows and are
  available **going forward only**. No backfill is possible and none was attempted.

  **A one-off join settles the direction question anyway, and it contradicts RETRO-290 §9.** Joining
  each fallback decision to its session's generation rows (1:1 — 115 fallback rows, 115 distinct
  sessions, and zero sessions carrying both a fallback and a served decision, so the join cannot
  double-count):

  | trailing 7d, production         | n       | reading                                          |
  | ------------------------------- | ------- | ------------------------------------------------ |
  | fallback WITH a generation row  | **114** | the model answered and the output was not served |
  | fallback with NO generation row | **1**   | at most one true LLM-unavailable event           |

  The single row-less one is `esc063-probe-1787095032-1` at 2026-08-18 23:17. **The 2026-08-20 12:45
  canary red is NOT it**: its decision row is `canary-follow1022-1787230052593` at 12:47:35.117 and
  that session HAS a generation row (12:47:35.116, `llm_tweaked`, 902/215, 1934 ms). RETRO-290 §9
  read the two 12:47 `llm_calls` rows as two successes and inferred "generation never completed" for
  the failure; with `adaptation_decisions` joined in, one of those two rows is the failure's own
  rejection row. So **both** 2026-08-20 canary reds were fact-check refusals, not outages, and §9's
  exoneration of #798 rests on evidence that does not say what it was read to say. That is not a
  re-opening of #798 — a confirmed flag is a true positive by the judge's own verdict, and n is
  small — but the "LLM unavailable" reading of that red should not be carried forward. **This is
  exactly the conflation the ticket fixes**: an `llm_tweaked` row could not say whether it was
  served, so a careful reader with production access still got it backwards.

- **addendum 2026-08-21 (every query below executed 2026-08-20T22:08Z) [FOLLOW-1060] — the addendum
  above is right about the inference and wrong about three surrounding facts; every correction below
  was re-executed against the Actions API and production ClickHouse, not read from RETRO-291.** The
  central correction it makes to RETRO-290 §9 — that §9 read a rejection row as a second success —
  stands and is kept. What it got wrong is which red it was talking about.

  **1. There were THREE canary reds on 2026-08-20, not two.** Runs `32370488989` (12:45:19, push),
  `32370637849` **attempt 1** (12:47:01, push) and `32372181392` (13:04:02, push).
  `gh api repos/:owner/:repo/actions/runs/32370637849 --jq .run_attempt` → **2**, and the run's
  final conclusion is `success`: `gh run list` reports only the LATEST attempt, so a re-run erases
  its own first failure from every count derived that way. Both the "1 red in 39 runs" base rate in
  RETRO-290 and the count of two above are low for that reason.

  **2. The session named above belongs to the 12:47 red, not the 12:45 one.**
  `canary-follow1022-1787230052593` decodes to **12:47:32** UTC; the 12:45 red's session is
  `canary-follow1022-1787229951023` (**12:45:51**). Their production decision rows are opposite to
  the way the paragraph above reads them:

  | session                           | decision row (production `adaptation_decisions`)                    | red   |
  | --------------------------------- | ------------------------------------------------------------------- | ----- |
  | `canary-follow1022-1787229951023` | `2026-08-20 12:47:34.928` — **`llm_tweaked`**, v1                   | 12:45 |
  | `canary-follow1022-1787230052593` | `2026-08-20 12:47:35.117` — `playbook_fallback_llm_unavailable`, v1 | 12:47 |

  **3. The 12:45 red is therefore NOT a fact-check refusal — it is an availability event**, the one
  category the sentence "both were fact-check refusals, not outages" exonerates. Its canary step ran
  `12:45:49 → 12:47:21` (`gh api …/runs/32370488989/jobs`) and gave up on the 90 s client budget;
  the request it abandoned went on to serve **generated** copy 13 s later. Nothing about that red is
  evidence about `source`, in either direction — the client never saw a response to read. The
  route-level stall it does evidence is FOLLOW-1061.

  **#798 remains exonerated, for a corrected reason.** Not "generation never completed", and not
  "the fact check refused it": on the 12:45 red the batch was **served**, so that run says nothing
  about the fact check at all. The 12:47 and 13:04 reds are the fact-check-refusal ones.

  **4. The `115 / 198 = 58%` rate is arithmetically right and is a rate over the estate's own
  probes.** Re-run at 2026-08-20T22:08Z over the trailing 7 days, splitting the population by
  session id (`canary-%`, `esc063-probe%`, `%probe%`, `audit-%`, `%smoke%`, `%demo%`):

  | source                              | n   | of which synthetic |
  | ----------------------------------- | --- | ------------------ |
  | `playbook_fallback_llm_unavailable` | 115 | **114**            |
  | `llm_tweaked`                       | 90  | **90**             |
  | `default`                           | 23  | **22**             |

  Listing the remainder by hand leaves **exactly one** non-synthetic session in seven days —
  `b6a2508c…65040`, one `default` at 2026-08-16 19:26:52 and one fallback at 19:28:52. So the honest
  statement of this rate is: **it describes our own canaries and audit probes, not buyers.** Anyone
  reading 58% as a production fallback rate for real traffic — including a promotion decision on
  FOLLOW-1048 or FOLLOW-1051 — is reading a denominator of two real decisions.

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
- **watch_status:** watched — FOLLOW-1037 landed two watchers. (1) production: every settled page
  load now queues one `boot_timing` event (schema:
  `packages/shared/src/schemas/events/boot-timing.ts`) through the SAME ingest pipeline every other
  SDK event uses, so the decomposition reaches ClickHouse `events` (payload JSON) continuously
  instead of living only in a browser console — the saved query in
  `docs/runbooks/SDK_PRODUCTION_INTEGRATION.md` §11 reads it. (2) CI:
  `packages/sdk/e2e/ boot-timing-ceiling.spec.ts` (job "SDK E2E tests", `.github/workflows/ci.yml`)
  drives a real page to a real `estalara:adapt:settled` and fails if `detail` goes
  missing/non-numeric or `total` exceeds a deliberately loose 8000ms structural ceiling — it catches
  a regression class (a reintroduced multi-second hydration delay, a stuck retry) two-plus orders of
  magnitude bigger than this claim's own numbers, not drift in the numbers themselves. Correction
  from the original filing: the **Demo integration** (`demo-integration.yml`) job does NOT drive a
  real SDK boot — its "SDK" step replicates directive-application logic in JSDOM without loading the
  built bundle (see `tests/e2e/sprint-9-5-demo.spec.ts` lines 13-18, 471-472, which says
  browser-level assertion is deferred to the Playwright suite) — so the CI watcher above lives in
  the SDK's own Playwright suite instead, which is the harness that actually settles a real page.
  The other half of this claim — where the HOST puts the loader — still lives in a different repo
  and is still invisible from here; that part remains unwatched.
- **measure_with:** PRIMARY — query ClickHouse `events` where `type = 'boot_timing'`, per the saved
  query in `docs/runbooks/SDK_PRODUCTION_INTEGRATION.md` §11 (once real sessions have flowed through
  ESC-020's prod SDK activation). FALLBACK (local-stack, used to produce the numbers above, still
  valid where no production traffic exists yet): bring up the local stack per
  `~/Projects/Estalara-gitlab-2026-08-17/ADAPTIVE_LISTINGS_LOCAL.md`, then load a listing and read
  `event.detail` from `estalara:adapt:settled` (or `performance.getEntriesByName('estalara:…')`).
  Discard the first run — Vite's cold compile put `preInit` at 9170 ms once.
- **relied_on_by:** `docs/runbooks/SDK_PRODUCTION_INTEGRATION.md` §9 (cloak `CLOAK_MAX_MS`), §10
  (loader placement) and §11 (the saved ClickHouse query); FOLLOW-1027; FOLLOW-1033; FOLLOW-1037;
  `packages/sdk/e2e/boot-timing-ceiling.spec.ts`
- **falsified_means:** if `preInit` stops dominating — most plausibly because a production build
  hydrates fast enough that the onMount injection is cheap — then loader placement is not the lever,
  and the next candidates are `configFetch` (~100 ms, and the adapt call needs only `language` out
  of it) and the bundle itself. Note that a falsification here does NOT restore the case for an
  SDK-side copy cache: `adapt` was 20 ms, so there is no round trip worth caching away.

---

## MP-012 — after the #782 checker fix, the residual fact-check rejections split into true positives and three named false-positive classes

- **claim:** Probing production `/api/adapt` in the LLM band on 2026-08-19 (post-#782 deploy,
  `4327c65e`), the FOLLOW-457 checker rejected REAL hallucinations — `157m²` for a 158 m² listing,
  an invented "Santa Maria Building", an invented "270-Degree" figure, an invented "Gîte" usage
  claim — while grounded batches still died on exactly three classes: **unit abbreviation** (`SF`
  where the context writes `sq ft`), **Title-Case coinage** (`Income-Generating`, `Multi-Unit`), and
  **translation** (`Outbuildings` for a French context's `hangar`, `Storage` for `stockage`). With
  those classes in play, both probe listings (French `d3a81d0a…` and English `90a2127c…`) fell back
  on effectively every call.
- **measured_on:** 2026-08-19
- **revalidate_by:** 2027-02-19
- **revalidate_on:** any change to `GROUNDING_RULE`, `checkDirectiveFacts` or the grounding-text
  builder; or the first green run of the FOLLOW-1022 canary (which is this premise's own success
  condition — a green canary means the classes stopped dominating).
- **watch_status:** watchable-but-unwatched — the gate that could exist and does not: a scheduled
  query against ClickHouse `llm_calls` asserting the override rate stays below a threshold, wired
  into a workflow the way `adapt-llm-source-smoke.yml` wires the FOLLOW-1022 canary. **The two
  watchers this field previously named — the FOLLOW-1022 adapt canary and the Sentry
  `directive_fact_check_violation` capture — are REPLACED here because both are structurally blind
  to the number this premise is about**: both see only the batch's final outcome (discarded or not),
  which is identical whether the judge overrode a false-positive flag or the token scan never
  flagged anything, so neither can answer `overrides ÷ flags` — the FOLLOW-1041 stub traced this
  exactly (RETRO-285). `judgeNameGrounding` (`apps/control-plane/src/lib/llm-gateway.ts`) now writes
  the verdict as a distinct `source` on the SAME `llm_calls` row it already wrote per invocation
  (`JUDGE_VERDICT_SOURCE`: `fact_check_judge_override` / `_flag_confirmed` / `_unavailable_timeout`
  / `_unavailable_malformed` / `_unavailable_error` — a cap-exceeded flag never calls the judge, so
  it writes no row and cannot be double-counted as a verdict), so the ratio is now a ClickHouse
  query — see `measure_with` — with no CI workflow running it yet. **Narrowed 2026-08-20
  [FOLLOW-1056]:** the canary is no longer blind to _whether the batch was refused_ — it reads
  `fallback_reason` and distinguishes a refusal from an outage, and the generation row now carries
  `*_fact_check_rejected` — but the sentence above stands unchanged where it matters: neither the
  canary nor that row can say whether a flag was OVERRIDDEN, because an overridden flag produces a
  served batch indistinguishable from one that was never flagged. Only the judge's own row answers
  that, and it is still the sole source for this premise's number.
- **measure_with:** (1) the fact-check REJECTION RATE is a ClickHouse query as of 2026-08-20
  [FOLLOW-1056] and no longer needs `vercel logs` — against Doppler `prd`:
  `doppler run --project estalara-adaptive-listings --config prd -- bash -c 'curl -sS "$CLICKHOUSE_URL" -u "$CLICKHOUSE_USER:$CLICKHOUSE_PASSWORD" --data-binary "SELECT countIf(source LIKE '\''%_fact_check_rejected'\'') AS rejected, countIf(source IN ('\''llm_tweaked'\'',  '\''llm_full'\'')) AS served, rejected / (rejected + served) AS rejection_rate FROM llm_calls WHERE source LIKE '\''llm\_%'\'' AND ts >= now() - INTERVAL 7 DAY FORMAT TSVWithNames"'`.
  Reading `vercel logs admin.estalara.com --json` for `directive fact-check violation` lines is
  still required for the claim's own three false-positive CLASSES — the row says a batch was
  refused, not which violation code or which slot — so fire authenticated POSTs at
  `admin.estalara.com/api/adapt` with `similarity: 0.7` and a current catalog `listing_id` while
  tailing them. What changed is that the RATE no longer depends on a retention window, and a
  question first asked afterwards can now be answered. (2) the judge's override rate, against
  Doppler `prd`:
  `doppler run --project estalara-adaptive-listings --config prd -- bash -c 'curl -sS "$CLICKHOUSE_URL" -u "$CLICKHOUSE_USER:$CLICKHOUSE_PASSWORD" --data-binary "SELECT source, count() n FROM llm_calls WHERE source LIKE '\''fact_check_judge%'\'' AND ts >= now() - INTERVAL 7 DAY GROUP BY source ORDER BY n DESC FORMAT TSVWithNames"'`
  — **`overrides ÷ flags` = `fact_check_judge_override` ÷ (`fact_check_judge_override` +
  `fact_check_judge_flag_confirmed`), NOT ÷ the sum of every row this query returns.** Corrected
  2026-08-20 [FOLLOW-1056, discharging RETRO-289 §4d DG-3]: the three `_unavailable_*` buckets are
  flags the judge FAILED to adjudicate, so counting them in the denominator makes a judge that times
  out on 90% of calls look like a judge with a low override rate — the ratio would move while the
  fact check got strictly less effective. Report the unadjudicated count ALONGSIDE the ratio rather
  than inside it; it is not noise (a large one invalidates the ratio's sample), it is just not a
  verdict. The pre-#1041 `fact_check_judge` rows carry no verdict at all and belong in neither term.
  **Denominator caveat, and this is the one FOLLOW-1056 does NOT close:** these are PROPER-NAME
  flags that reached the judge, not all fact-check flags — `hallucinated_number` is a deterministic
  reject that never calls the judge, and a flag past `MAX_JUDGE_CALLS_PER_REQUEST` writes no row.
  For a BATCH-level denominator ("how often does the fact check refuse a generation at all") use
  `measure_with` (1)'s `%_fact_check_rejected` count, which is the number this premise could not
  produce before 2026-08-20.
- **relied_on_by:** `apps/control-plane/src/lib/llm-gateway.ts` `GROUNDING_RULE` (the three
  token-level prompt constraints exist because of these three classes) and `JUDGE_VERDICT_SOURCE`
  (the override-rate counter this premise now watches for); FOLLOW-1034; FOLLOW-1041; ESC-063
- **falsified_means:** if the canary stays red AFTER the prompt states the token-level constraints,
  the model cannot reliably confine itself to grounded tokens and the next step is a semantic
  entailment check (judge call) on the LLM band — a designed ticket, not a bigger word list. For the
  override-rate clause specifically: an override rate that trends toward 100% with no change in the
  token scan's own false-positive classes is the rubber-stamping judge FOLLOW-1041 exists to catch,
  not a sign the token scan improved.
- **addendum 2026-08-20 [FOLLOW-1042] — the `revalidate_on` trigger fired, and the "exactly three
  classes" enumeration was incomplete on the French probe listing.** `checkDirectiveFacts` changed,
  so this premise's own revalidation condition is met; the claim is NOT re-probed here (the
  `measure_with` production probe is still owed) but one clause is corrected rather than left
  standing. A **fourth**, purely mechanical class was live on `d3a81d0a…` alongside the three named
  ones: the grounding was tokenised on `[^a-z0-9-]+` and probed with an ASCII `\b`, so every
  accented word entered the comparison as fragments. Measured against that listing's live text
  (`GET api.app.estalara.com/api/v1/listing/details?listing-uuid=d3a81d0a…&locale=EN`, 2026-08-20):
  **16 distinct grounded words shredded into 22 fragments**; of the listing's own accented words
  Title-Cased in copy, **3 of the 11 that reach the grounding comparison were flagged**
  (`Propriété`, `Intégré`, `Aménagé`) and **5 of 5 inflections** were (`Caractères`, `Pièce`,
  `Propriétés`, `Cuisinières`, `Extérieurs`) — all 0 after the fix. In the other direction **18 of
  18 fabricated fragments** (`Caract`, `Propri`, `Rieur`, …) PASSED the scan, which the judge cannot
  mitigate because it only adjudicates values the scan rejects. This class is mechanical, not
  semantic, so it does not weaken `falsified_means` above: it is closed by tokenisation, not by a
  word list and not by a judge. Of the two residuals of the same shape this addendum filed as NOT
  closed, **one is now closed and one still stands.**

  **CLOSED 2026-08-20 [FOLLOW-1054].** The value side gated on `/^[A-Z]/`, so a fabricated name
  opening with `É`/`Á`/`Ł` was never checked at all. The candidate selector is now `/^\p{Lu}/u`,
  which is the same character model the grounding side got above, so `revalidate_on`'s
  `checkDirectiveFacts` trigger fired a second time — and as with the first, the `measure_with`
  PRODUCTION probe is still owed and is NOT claimed here. What IS measured: each word below probed
  mid-segment through `callLlmGateway` against this listing's live facts
  (`GET api.app.estalara.com/api/v1/listing/details?listing-uuid=d3a81d0a…`, re-fetched 2026-08-20),
  with the judge held at `{"grounded": false}` so the count measures the token scan alone.

  | population (mid-segment, this listing's grounding)                        | before | after       |
  | ------------------------------------------------------------------------- | ------ | ----------- |
  | fabricated accented names (`Évian`, `Ávila`, `Łódź`, `Österreich`, …)     | 0 / 6  | **6 / 6**   |
  | this listing's OWN accented-initial words (`Été`, `Éléments`, `Étage`, …) | 0 / 5  | 0 / 5       |
  | generic accented adjectives (`Élégant`, `Único`, `Świetny`, …)            | 0 / 17 | **17 / 17** |
  | the same 17 generics placed SEGMENT-INITIALLY                             | 0 / 17 | 0 / 17      |
  | French ASCII-initial generics (`Charmant`, `Spacieux`, `Potentiel`, …)    | 5 / 5  | 5 / 5       |

  The third row is the cost and it is stated rather than papered over: `FACT_CHECK_STOP_CAPS` is an
  ASCII English list, so accented generics are not exempt. It was NOT grown for them — the last row
  is why. French generics whose first letter happens to be ASCII were already flagged mid-segment at
  5/5 before this change, so exempting `Élégant` while `Charmant` stays flagged would be incoherent,
  and a per-language exemption list is what `falsified_means` above rules out by name. The two
  controls that carry this class are the segment-initial exemption (row 4) and the judge tier.

  **STILL OPEN:** `stemLoose` is English-only, so `rénover`/`rénovée` still will not collapse.

---

## MP-013 — production `/adapt` in the LLM band answers in seconds, the fact-check judge costs about a second of it, and the route's worst tail is NOT the model call

- **claim:** Three numbers, from two independent sources, about the production control plane
  (`admin.estalara.com`):
  1. **Route wall clock.** The FOLLOW-1022 canary prints
     `/api/adapt (llm_tweaked band) answered in <N>ms` on every run. Across the twelve most recent
     runs on `main` that printed a number:
     `713, 747, 2536, 2752, 2836, 2891, 2990, 3441, 4562, 31348, 32181, 32379` ms. Nine of twelve
     sit between 0.7 s and 4.6 s; **three exceeded 31 s**.
  2. **Model-call latency, from ClickHouse `llm_calls`.** `source='llm_tweaked'` (the band the
     canary probes), rolling 3 days, n=145: **p50 2016 ms, p95 3358 ms, max 8563 ms**. The judge
     tier, `source='fact_check_judge'`, has produced exactly **n=2** rows since #787 deployed: **725
     ms** and **1130 ms** (the slower one emitted the full `max_tokens: 50`, i.e. it is the
     expensive shape of this call, not a lucky one). **Reading this clause after FOLLOW-1041:** the
     bare `fact_check_judge` value is no longer written — the judge tier now writes one
     `fact_check_judge_*` value per verdict ([MP-012] `watch_status`), so the two rows above are
     historical and the tier is `source LIKE 'fact_check_judge%'` in any query run today. The
     latency numbers are unaffected; only the label split.
  3. **The tail is not the model.** In the window of the canary run that printed **32181 ms**, the
     only `llm_calls` row was **2043 ms**. So ~30 s of that response was spent somewhere in the
     route other than the Anthropic call. Cause is a **hypothesis** (serverless cold start is the
     obvious candidate, and the fast 713/747 ms observations are equally unexplained — the canary
     prints its label `llm_tweaked band` as static text and does NOT print the `source` it actually
     observed, so no attribution can be made from the log alone).

  For contrast, and to stop the wrong number being designed against: **[MP-011]'s `adapt` span of 21
  ms is the LOCAL pilot stack**, where no Anthropic call is on the path. Production adapt in the LLM
  band is three orders of magnitude slower than that figure, and `CLOAK_MAX_MS` is 1500 ms
  (`docs/runbooks/SDK_PRODUCTION_INTEGRATION.md` §9), so the host cloak expires before the adapted
  copy arrives on essentially every LLM-band call today.

- **measured_on:** 2026-08-19
- **revalidate_by:** 2026-11-19
- **revalidate_on:** any change to the judge's deadline or per-request cap; a change of model on
  either the generation or the judge call; the route gaining a wall-clock budget; or the cause of
  the ~30 s tail being established (which would falsify clause 3's framing, not its number)
- **watch_status:** watchable-but-unwatched — the gate that could exist and does not: a latency
  assertion inside the FOLLOW-1022 canary (`tests/integration/adapt-llm-source-live.smoke.test.ts`,
  workflow `adapt-llm-source-smoke.yml`), which already MEASURES clause 1 on every push, PR and
  nightly and prints it, but asserts only on the served/refused/unavailable verdict it derives from
  `source` + `fallback_reason` (`verdictFor`, narrowed 2026-08-20 by FOLLOW-1056 — it read `source`
  alone before) — so the wall clock is recorded and nothing fails on it. Clause 2 is queryable from
  ClickHouse at any time and is read by nobody. Naming this honestly matters: a `JUDGE_DEADLINE_MS`
  set too tight would show up here as a rise in fallbacks, and no gate would notice. (The canary
  cannot be given a tight ceiling today for the reason clause 3 states: three of twelve runs
  exceeded 31 s for a cause nobody has established, so any ceiling worth having would be flaky until
  that is diagnosed — **FOLLOW-1061's job, not FOLLOW-1039's** (re-homed 2026-08-21; FOLLOW-1039 is
  speculative adapt, which ROUTES AROUND a server-side stall and never diagnoses one — Rule AW).
  **The cause is now established:** see the addendum below and [MP-014]. The ceiling is still not
  set here, because the remedy belongs on the dependency and not on the probe — FOLLOW-1063.)
- **measure_with:** (1) `gh run list --workflow=adapt-llm-source-smoke.yml --branch main --limit 12`
  then, per run, `gh api repos/<owner>/<repo>/actions/jobs/<job-id>/logs | grep -a "answered in"`.
  **Two corrections to this recipe, both executed 2026-08-21 [FOLLOW-1061]:** (a) that grep
  STRUCTURALLY CANNOT SEE the worst outcome — a probe that exceeds `ADAPT_BUDGET_MS` throws before
  printing, so it prints `did not answer within 90000ms (<N>ms elapsed, TimeoutError)` instead, and
  any rate derived from `answered in` alone reports `>90 s = 0` by construction. Both of the
  estate's >90 s events are invisible to it. Grep for BOTH strings. (b) `gh run list` reports only a
  run's LATEST attempt, so a re-run erases its own failure — read
  `gh api repos/:owner/:repo/actions/runs/<id> --jq .run_attempt` and, where it is >1, the jobs of
  `.../attempts/1/jobs`. One of the two >90 s events (run `32306397526`) is on an attempt 1 that
  `gh run list` does not show; (2) against Doppler `prd`:
  `doppler run --project estalara-adaptive-listings --config prd -- bash -c 'curl -sS "$CLICKHOUSE_URL" -u "$CLICKHOUSE_USER:$CLICKHOUSE_PASSWORD" --data-binary "SELECT source, count() n, round(quantile(0.5)(latency_ms)) p50, round(quantile(0.95)(latency_ms)) p95, max(latency_ms) mx FROM llm_calls WHERE ts >= now() - INTERVAL 3 DAY GROUP BY source FORMAT TSVWithNames"'`
- **relied_on_by:** `apps/control-plane/src/lib/llm-gateway.ts` (`JUDGE_DEADLINE_MS`,
  `MAX_JUDGE_CALLS_PER_REQUEST`, the slot-schema latency note and the Sonnet prompt's slot list);
  `apps/control-plane/src/app/api/adapt/route.ts` (the recorded "no route budget yet" decision);
  FOLLOW-1039 (speculative adapt — its premise must be this number, not [MP-011]'s 21 ms);
  FOLLOW-1040
- **falsified_means:** if the judge band is materially slower than clause 2 says,
  `JUDGE_DEADLINE_MS` is cutting healthy adjudications and the visible symptom is a RISE in
  `playbook_fallback_llm_unavailable` with no change in the token scan — the remedy is to raise the
  deadline, not to remove it. If the route's own tail turns out to BE the model call after all, then
  the route does need a wall-clock budget now and the decision recorded in `adapt/route.ts` must be
  reopened.

### Addendum 2026-08-21 [FOLLOW-1061] — clause 3's cause is established, and its named candidate is falsified

Clause 3 said _"~30 s of that response was spent somewhere in the route other than the Anthropic
call. Cause is a **hypothesis** (serverless cold start is the obvious candidate)"_. Both halves are
now settled, by execution, and the entry's own `revalidate_on` asked for exactly this.

- **Cold start is falsified, from the platform's own field.** Every one of the 226 production
  `POST /api/adapt` invocations in the retained window — including the 103 551 ms one — carries
  `functionStartType: "hot"` and `functionColdStartDurationMs: -1`. Not one cold start occurs
  anywhere in the sample. See [MP-014] for the command; the field is absent from the `vercel logs`
  CLI's output and present in the API it calls, which is why nobody had looked.
- **The segment is named:** the time is spent BEFORE the model call is issued, in the route's own
  awaited dependencies. On 2026-08-20 12:45:51 UTC an invocation ran 103 551 ms and issued its
  Anthropic call 101 470 ms in; that call took 1962 ms and the response was assembled in 119 ms.
  [MP-014]
- **Clause 3's "and the fast 713/747 ms observations are equally unexplained" is resolved too**, and
  not in this entry's favour: those runs were the A/B holdout returning `source: "default"` before
  any LLM call — FOLLOW-1059 closed that hole in the probe on 2026-08-21 by sending
  `holdout_pct: 0`. They were not fast LLM-band answers; they were not LLM-band answers at all.
- **Clause 1's quoted log line has since been renamed.** The canary now prints `answered in <N>ms`
  under `(requested llm_tweaked band)` — FOLLOW-1059 changed the wording precisely because
  "llm_tweaked band" asserted an outcome the probe had not checked.

Nothing in clauses 1 and 2's NUMBERS is disturbed. What changes is the framing of clause 3: the
route's worst tail is not the model call, and it is not the platform either — it is the pre-LLM
dependency segment, which now has its own register row (`llm_calls.source = 'route_pre_llm'`) and
its own premise.

---

## MP-014 — `/api/adapt`'s worst production latency lives entirely BEFORE the model call, in a pre-LLM segment with a ~30 s plateau

- **claim:** Four measurements about production `admin.estalara.com`, all executed 2026-08-21
  against the live estate.
  1. **The 2026-08-20 12:45 event, bounded by three independent clocks.** Vercel request
     `wl9vm-1787229951380-add835c807e4` (`POST /api/adapt`, deployment
     `dpl_DDQGr7zWZNXPmekuD487Ear21AVQ`, region `cdg1`) arrived `12:45:51.380Z`; its function event
     starts `12:45:51.494Z` and records **`durationMs: 103551`**, `functionStartType: "hot"`,
     `functionColdStartDurationMs: -1`, `concurrency: 2`, `instanceId: ZGgrQrYM30IE`. ClickHouse
     `llm_calls` holds one row for that request's session (`canary-follow1022-1787229951023`) at
     `12:47:34.926` with `latency_ms = 1962`. **The Anthropic call was therefore issued 101 470 ms
     into the invocation**, and the remaining 119 ms assembled the response. The request returned
     **200** and served generated copy — to a client that had already abandoned it at 90 s.
  2. **Four candidate causes are eliminated, each by an independent observation.** _Cold start:_ the
     platform reports `hot` and `-1`. _Queueing:_ the function event begins 114 ms after the proxy
     event. _Instance health / event-loop starvation:_ three `/api/intent/config` invocations ran on
     the SAME `instanceId` DURING the stall (12:45:59.302, .605, .969) and returned 200 in 80, 60
     and 97 ms. _The model:_ 1962 ms. _The fact check:_ the `hallucinated_number` warn in that
     window belongs to request `22twx-1787230052687-…`, a different session
     (`canary-follow1022-1787230052593`), whose own pre-LLM segment was 495 ms.
  3. **The distribution is bimodal with a timeout-shaped plateau.** Over the full retained window
     (226 `POST /api/adapt` invocations, 2026-08-18T09:27Z … 2026-08-21T08:14Z): **p50 2558 ms, p90
     32 108 ms, p95 33 677 ms, p99 79 854 ms, max 103 551 ms.** 187 of 226 finish under 5 s; **26
     sit between 28.2 s and 36 s with a floor at 30 356 ms**; five more at 36–42 s; then 79 854, 101
     356 and 103 551 ms. **28 of 226 (12.4%) exceeded 31 s and 2 of 226 (0.9%) exceeded 90 s.** No
     `GET /api/adapt` invocation appears in the window at all.
  4. **All of the variance is in the pre-LLM segment.** Joining every canary session in the window
     to its `llm_calls` row: the post-LLM tail (model return → response) is **66–428 ms in every
     single case**, the model call itself is 1231–8563 ms, and the pre-LLM segment ranges from **233
     ms to 101 470 ms**. Healthy pre-LLM segments occupy a 233–1515 ms band; there is essentially
     nothing between 1.5 s and 23 s.

  **The population, stated rather than left to be assumed** (the discipline RETRO-291 imposed on
  MP-010's `115/198`): production `POST /api/adapt` traffic in this window is overwhelmingly the
  FOLLOW-1022 canary — 149 workflow runs fired in the same period — plus admin/demo sessions. This
  is a measurement of the estate's own probe traffic on the production route, not of buyer traffic.
  It is nonetheless the same code path, same region and same dependencies.

  **A fifth, smaller live fact, recorded here because shipped source needs to cite it rather than
  restate it:** ClickHouse `SHOW GRANTS` for the `ingest_worker` role (the control-plane's
  credential) returns `GRANT SELECT, INSERT, ALTER DELETE ON default.llm_calls` and no column-DDL
  privilege on any table. Adding a column to `llm_calls` or `adaptation_decisions` is therefore an
  operator action in the ClickHouse Cloud console, not something a PR can carry — which is why
  FOLLOW-1061 widened `source` (a `LowCardinality(String)`) instead, the same adjudication
  FOLLOW-1041 and FOLLOW-1056 made before it.

  **What is NOT established, and is a hypothesis with a named test.** The plateau floor (30 356 ms)
  coincides with the only 30-second bound anywhere on that path: postgres.js's default
  `connect_timeout: 30` (`node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/src/index.js`, the
  `defaults` object), never overridden in `packages/db`'s `createClient`. `createAdminClient()`
  constructs a NEW `postgres()` pool on every call — it is not memoised and the pool is never
  `end()`ed — and the adapt POST pre-LLM path calls it through three to five distinct helpers per
  request. That makes a connection-acquisition stall the leading candidate, and the doubles and
  triples (79.9 s / 101.4 s / 103.6 s) consistent with more than one such wait in one request. It is
  NOT proven: no log line, no error and no Sentry event accompanies any of these requests, which is
  itself consistent with postgres.js re-connecting and the queued query then succeeding. The
  instrumentation added by FOLLOW-1061 (`llm_calls.source = 'route_pre_llm'` plus a per-step
  breakdown above `PRE_LLM_STALL_WARN_MS`) is what will name the step on the next occurrence.

- **measured_on:** 2026-08-21
- **revalidate_by:** 2026-11-21
- **revalidate_on:** any change to `createAdminClient`'s pooling or to postgres.js's
  `connect_timeout`; any change to the awaited dependency set in the adapt POST pre-LLM path; the
  plateau floor moving off ~30 s; or the first `route_pre_llm` stall row naming a step
- **watch_status:** watchable-but-unwatched — the gap is named, and the gate that could exist is the
  FOLLOW-1022 canary job (`adapt-llm-source-smoke.yml`), whose probe already measures this wall
  clock on every push, PR and nightly and asserts nothing about it. The stall now raises a Sentry
  warning (`kind: 'pre_llm_stall'`, tagged with the slowest step) and writes a `route_pre_llm`
  register row on every treatment request, so a recurrence is both alertable and countable after the
  fact. Nothing FAILS on it: the FOLLOW-1022 canary's `ADAPT_BUDGET_MS` is deliberately left at 90 s
  (FOLLOW-1061 scope guard — a ceiling set before the remedy exists converts an undiagnosed stall
  into a flaky gate), and the route still has no wall-clock budget (FOLLOW-1040's recorded decision,
  unchanged). The early-return paths of the POST handler (401/403, `adaptive_listings_off`, consent
  skip, A/B holdout) write no segment row at all — their wall clock is only on the Vercel invocation
  record.
- **measure_with:** (1) end-to-end per-request duration, which the `vercel logs` CLI does NOT expose
  and the API it calls does — from `apps/control-plane` (the linked project):
  `TOK=$(jq -r .token ~/.local/share/com.vercel.cli/auth.json); curl -sS -H "Authorization: Bearer $TOK" "https://vercel.com/api/logs/request-logs?projectId=<projectId>&ownerId=<teamId>&page=0&startDate=<epoch_ms>&endDate=<epoch_ms>&environment=production&search=%2Fapi%2Fadapt&teamId=<teamId>"`
  then
  `jq '.rows[] | .functionEvents[] | {durationMs, functionStartType, functionColdStartDurationMs, concurrency, instanceId}'`.
  Ids are in `apps/control-plane/.vercel/project.json`. The window caps at ~50 rows per call, so
  walk it in slices; `page` is ignored. Retention observed at ~3 days on the `pro` plan (rows back
  to 2026-08-18T09:00Z were readable on 2026-08-21T08:20Z), NOT the 1 day the plan's published
  figure implies. (2) the pre-LLM segment, after this ticket deploys:
  `doppler run --project estalara-adaptive-listings --config prd -- bash -c 'curl -sS "$CLICKHOUSE_URL" -u "$CLICKHOUSE_USER:$CLICKHOUSE_PASSWORD" --data-binary "SELECT count() n, round(quantile(0.5)(latency_ms)) p50, round(quantile(0.95)(latency_ms)) p95, max(latency_ms) mx FROM llm_calls WHERE source = '"'"'route_pre_llm'"'"' AND ts >= now() - INTERVAL 3 DAY FORMAT TSVWithNames"'`.
  (3) the per-step name of a stall: Sentry, `kind:pre_llm_stall`, tag `step`.
- **relied_on_by:** `apps/control-plane/src/lib/adapt-segment-timing.ts` (both threshold constants
  and the module's whole reason for existing); `apps/control-plane/src/app/api/adapt/route.ts` (the
  pre-LLM segment block); [MP-013]'s 2026-08-21 addendum; FOLLOW-1063 (the proposed bound);
  FOLLOW-1039 (speculative adapt — its premise is this number)
- **falsified_means:** if the plateau disappears without any change to `createAdminClient` or to
  postgres.js, the 30 s coincidence was never causal and the hypothesis in clause 4 must be
  withdrawn rather than quietly kept. If a `route_pre_llm` stall row ever names a step that is NOT
  Postgres-backed (`listing_facts` is the only such step, and it is bounded at 2000 ms by
  `FETCH_TIMEOUT_MS`), the connection-acquisition story is wrong for that occurrence and the
  breakdown says so directly. If stalls appear on requests whose pre-LLM path made ZERO
  `createAdminClient()` calls, the hypothesis is dead.
