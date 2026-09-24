# Report D — remaining work and process overhead (2026-09-24, HEAD `9723ec10`)

Read-only; nothing edited. Auditor: general-purpose subagent (Opus). Synthesis in
`docs/AUDIT-2026-09-24.md`.

**Short answer:** the remaining work and the process are both oversized relative to the goal. In the
last 30 days the repo added about 38.1k lines of `.md`, 7.6k lines to the FOLLOW-819 harness
(`tests/e2e/follow-819`), 14.3k lines of tests, and only about 3.2k lines of product source
(`apps|packages/*/src`, tests excluded). All figures come from
`git log --numstat --since=2026-08-24`. The two real product defects found recently, FOLLOW-1241
(the pool leak) and FOLLOW-1242 (dropped event batches), came out of harness runs, not out of
retros.

## 1. What is still on the path to FOLLOW-820 GO

| Ticket      | What it is                                                                                         | Pri                            | Product or bookkeeping                                                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1242 (#923) | SDK re-queues failed event batches                                                                 | P1                             | Operator learns: conversions stop being lost. **Already merged** (`aba103af`)                                                                                                               |
| 1240        | Harness burns the 30 s wait and names the wrong failure cause on any fast non-adapted response     | P1 (raised from P2, RETRO-340) | Harness quality                                                                                                                                                                             |
| 1244        | Fixture server missing from `HARNESS_TREE_PATHSPEC`                                                | P1                             | Harness freshness                                                                                                                                                                           |
| 1246        | Main-checkout `@estalara/db` `dist` is stale, so #921's fix does not reach the local control plane | P1                             | Local bring-up only                                                                                                                                                                         |
| 1243        | MASTER_DESIGN §P.0 still says "No run graded at HEAD"                                              | P1                             | Docs re-sync                                                                                                                                                                                |
| **1203**    | Conversion must be a server-confirmed `inquiry.completed` / `live.signup` (CEO ruling #4)          | P1                             | **Operator learns.** Not in the banner's NEXT, not done, but FOLLOW-820 condition 1 cites it (FOLLOW_UPS.md:27305ff)                                                                        |
| 1204        | Record the purpose of the minted xid                                                               | P2                             | Compliance docs                                                                                                                                                                             |
| 1220        | `reorder_withheld` is written but never read or shown                                              | P1                             | Operator learns                                                                                                                                                                             |
| **815**     | Consent bundle                                                                                     | P0                             | **DONE since 2026-08-07** (PR #688, `f560198c`; MASTER_DESIGN §Snapshot.0 row 2). The banner (QUEUE.md:3) and CLAUDE.md still list it as next. The same drift was fixed once before in #858 |
| 820         | CEO go/no-go decision                                                                              | P1                             | —                                                                                                                                                                                           |

**FOLLOW-815 acceptance criteria:** (1) consent hash computed from the rendered consent text, with a
test that fails if they diverge; (2) a withdrawal mechanism exists and the text names it; (3) the
privacy contact comes from `brand_config` and fails loudly if missing; (4) exactly one TOS version
bump; (5) the hash bypass from FOLLOW-707 is closed; (6) production consent records are remediated;
(7) compliance docs updated in the same PR; (8) code and production remediation reported separately.
Operator residue remains in FOLLOW-706 and FOLLOW-868.

**FOLLOW-820 acceptance criteria:** GO needs four conditions, each with evidence links: (1)
FOLLOW-819 green — AC(1) `outcomes.adapted > 0` and AC(7) `ok`, with a pasted `[FRESH]` line; a
positive lift is explicitly not required; (2) FOLLOW-815 shipped; (3) chat-NLP deployed to
production: the Worker's `MODAL_CHAT_NLP_URL` set, plus proof from real traffic; (4) FOLLOW-450
feedback switched on in production, with a pasted real weight change. Also required: a dated ruling,
and the CTO's deploy date.

**Contradiction:** conditions 3 and 4 are production actions, so GO cannot be reached on localhost
alone. Separately, no localhost chat arm exists (CEO decision #6 is open). Chat refining the
archetype is part of the stated goal, but no GO condition tests it.

## 2. The FOLLOW_UPS backlog

The file has 1,056 stub headers. Only about 238 have a status anyone can read; 818 have no status
anywhere. After removing stubs that have a code commit or a closure amendment, roughly **641 look
open: P0 12, P1 137, P2 323, P3 158**. This is an estimate. The P0 list includes stale items such as
FOLLOW-008/010/014 from sprint 9, and FOLLOW-815 itself, which shows the status tracking is broken.

Sample of 15 open P2/P3 stubs:

| Category                    | Count | Stubs                                     |
| --------------------------- | ----- | ----------------------------------------- |
| Product behaviour           | 4     | 057, 064, 091, 1224                       |
| Measurement / evidence      | 1     | 1141                                      |
| Docs / source-of-truth sync | 5     | 074, 218, 649 (actually closed), 677, 947 |
| Gates / tooling             | 4     | 337, 580, 826, 863                        |
| Retro process               | 1     | 797                                       |

That is **about 27% product**. Keyword tags on all 641 headers: 136 mention a Rule, gate or CI; 64
mention MASTER_DESIGN, a § section or README; 2 mention Stripe.

## 3. Retros and rules

The last five retros (RETRO-337..341) run 506, 166, 227, 201 and 317 lines, and each files 3–9 new
FOLLOW stubs. The PR that filed RETRO-338..341 (#924) added 1,343 lines for four PRs whose non-doc
code change was about 150–600 lines. Their new stubs (1240, 1243–1248) are mostly about the harness,
docs and production measurement.

Newest 10 rules (CONVENTIONS_PATCH has 55 top-level rules plus 21 amendments, 5,557 lines):

- **Protect product or evidence quality (3):** AU (tests assert behaviour), AV (probes match their
  subject), BC (predicate scope).
- **Mixed (1):** AY (run the full build).
- **Protect the process (6):** AT (escalation premises), AW (`blocks:` field), AX (`file:line`
  anchors), AZ (doc findings), BA (pushed to origin), BB (`revalidate_on` register).

**About 65% protect the process.**

## 4. Gates

There are 36 top-level `scripts/check-*` files (about 33 distinct gates; the rest are 3 `__tests__`
scripts and `.pyc` files), 15.7k lines in total. `.github/required-checks.txt` registers 56 checks.

- **Runtime correctness (~18):** adapt schema drift, archetype seeds, bundle size, fire-and-forget
  sinks, 555 session auth, K.2 swallow; migration journal, Modal singleton / local imports / secret
  keys, served bundles, staff-write atomicity (918 lines); Sentry pair (2,981 lines), Rule J mirror
  (1,793), Rule H, Modal effect probe, consent-text headers probe, cron heartbeat.
- **Docs–code sync (~8):** compliance docs, consent contract / retention / text sync, privacy-notice
  keys, session-identifier corpus, ADR-0021 conditions, deployment surfaces.
- **The gate system itself (~7):** gate exit codes, ticket status vocabulary, measured premises,
  no-staging-plane, Redis trigger trust, the three self-tests, the three negative controls.
  `gh-pr-checks-verified.sh` alone is 2,300 lines.

**Could go before GO without losing product safety:** the self-tests and negative controls (keep
one); the ticket status vocabulary, measured premises, deployment surfaces and no-staging checks;
Rule I (permanently red); the four production "any-state" probes (production serves no SDK yet);
cron heartbeat (B.6); the six consent-sync gates, merged into one.

## 5. Designed sections that could be parked for single-tenant localhost GO

A.3 multi-region (design only); B.3 CRM/marketplace adapters (design only); B.4.4
`packages/platform-templates` (blocked, empty); B.4.5 WordPress plugin; B.4 / B.5 auto-onboarding
and schema discovery (mostly shipped: freeze, don't extend); B.6 continuous schema validation (the
cron and its production gate); L / U Stripe billing; `sdk-react` / `sdk-vue`; DSR beyond what
already shipped; W operational excellence; R patents; Snapshot.3's `decision-api` Worker route,
which degrades 15 of 18 archetypes and diverges from `/api/adapt`. Snapshot.3 also looks stale (it
says "bandit index 0" and "djb2 ranking"; not re-verified).

## 6. Simplifications, ranked (effects are estimates, not measured)

1. **Retro only when warranted:** product-code PRs over about 100 lines, or after a failure, batched
   weekly. Saves about 1–1.5k doc lines per 4 PRs, roughly a third of agent sessions. Risk: low,
   since recent defects came from runs, not retros.
2. **Stop new P2/P3 stubs before GO** and archive the ~641 open ones to a frozen file, keeping only
   the 820 path live. Risk: low.
3. **Correct the critical path in CLAUDE.md and the banner:** remove 815, add 1203 and 1220, and get
   a CEO ruling on whether conditions 3 and 4 are GO conditions or post-GO deploy steps. Risk: none.
4. **One place for status (§Snapshot.0).** The banner, the FOLLOW-820 stub and README §5 would link
   to it instead of restating it. This removes a recurring ticket class (1129, 1148, 1197, 1209,
   1243).
5. **No new CONVENTIONS_PATCH rules until GO.**
6. **Drop or merge about 15 required checks** (section 4), removing about 6–7k lines of gate code
   from maintenance. Re-enable at GO.
7. **One bring-up script** that rebuilds `dist` and starts the containers and fixture server. That
   fixes 1244 and 1246 by construction, and ends the harness-freshness tickets.
8. **Park the section 5 areas** by marking them PARKED in §Snapshot.1, so audits stop filing against
   them.
9. **Add the chat arm to FOLLOW-819** (decision #6). It is the goal's missing leg and product work.
10. **Replace most of `gh-pr-checks-verified.sh`** with native required checks, if the plan allows
    it (unverified: the repo is private and ESC-078 records a billing lock).

Files: `backlog/QUEUE.md:3`, `backlog/FOLLOW_UPS.md:27047` (815), `:27305` (820),
`docs/MASTER_DESIGN.md:570-600` (§Snapshot.0), `:696-745`, `CONVENTIONS_PATCH.md:4506-5557`,
`.github/required-checks.txt`.
