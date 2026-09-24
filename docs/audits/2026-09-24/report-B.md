# Report B — `apps/control-plane` over-engineering audit (2026-09-24, HEAD `9723ec10`)

Read-only; nothing edited. Auditor: general-purpose subagent (Opus). Paths are relative to
`apps/control-plane/src` unless shown otherwise. Synthesis in `docs/AUDIT-2026-09-24.md`.

**Headline:** the code is not inflated so much as the comments are. `app/api/adapt/route.ts` has
2292 lines, of which 1057 are comments (46%). `lib/llm-gateway.ts` has 1696 lines, of which 906 are
comments (53%). Most comments are ticket history such as "FOLLOW-xxx/ESC-yyy: why".

## 1. `/api/adapt` request path (POST, `route.ts:1536-2291`)

| Stage                                                                        | Where             | Verdict                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Timer for the time before the LLM call, plus a Sentry message when it stalls | :1537, :2034-2046 | Measurement only. Can move out                                                                                                                                                                         |
| Auth: demo JWT, tenant API key, or ops key that can override `holdout_pct`   | :1546-1650        | Core needs one auth path. The demo and ops variants are demo/ops concerns                                                                                                                              |
| Demo-session revocation check against the DB                                 | :1671             | Demo only                                                                                                                                                                                              |
| Profiling opt-out gate                                                       | :1704             | Compliance. Keep                                                                                                                                                                                       |
| AL on/off per tenant                                                         | :1759             | Cheap kill-switch. Keep                                                                                                                                                                                |
| Pilot freeze guard (fire-and-forget)                                         | :1778, :155       | Ops. Defer                                                                                                                                                                                             |
| Demo archetype override                                                      | :1788-1846        | Demo only. Could live in a separate demo route                                                                                                                                                         |
| A/B holdout, including consent-skip                                          | :1847-1970        | Measurement. The learning goal needs it, but the served result does not                                                                                                                                |
| RAG retrieval, then `withListingFacts`                                       | :1973, :1993      | Core. This is the grounding input                                                                                                                                                                      |
| Thompson-bandit arm lookup (English only)                                    | :2025             | Accumulated. See the caveat below                                                                                                                                                                      |
| `runDecisionTree`                                                            | :283-560          | Core. Four branches: confidence ≤ 0.6 means no adaptation; similarity > 0.85 serves the playbook with ungrounded slots withheld (only the CTA is served); ≤ 0.6 is `llm_full`; otherwise `llm_tweaked` |
| Placeholder-token filling                                                    | :404-420          | Only for playbook copy served verbatim. Low value now: the withhold removes every token-bearing headline (the route's own comment, :463-466)                                                           |
| Reorder/affinity (needs `tenant_schema` + embeddings)                        | :2100-2153        | Nice-to-have. Its code was copied from decision-api                                                                                                                                                    |
| Chat-intent shadow read                                                      | :2176-2203        | Only echoes intent dimensions into the response and a log line. It does not drive the decision                                                                                                         |
| ClickHouse decision log via `afterResponse`                                  | :2250, :637       | Core for learning. Keep                                                                                                                                                                                |

Other findings on the route:

- **GET handler (`route.ts:1059-1466`, about 400 lines):** it duplicates the POST gates. The SDK
  only POSTs (`packages/sdk/src/core/adapt.ts:1281`), and so do the canary and the FOLLOW-819
  harness. No non-test GET caller found; a full search was not done.
- **`llm_full` and `llm_tweaked` are near-identical calls** (:484-530). Only the source label
  differs.
- **Bandit caveat:** the code agrees with RETRO-317 that the bandit is inert. Arms only vary the
  `headline`, and the high-similarity branch withholds the headline (:375-384, the FOLLOW-1163
  comment). Not verified at runtime.

## 2. `lib/llm-gateway.ts`

What it does:

- **Model routing:** similarity 0.6–0.85 goes to Haiku; otherwise the global config model;
  `forceModel` overrides (:1351-1362).
- **Daily spend cap:** $100/day, warning at $90 (:136). It runs a synchronous ClickHouse `SUM` over
  `llm_calls` on every call (:484-516) and fails open, returning 0.
- **Two prompt builders**, Haiku and Sonnet (:594, :632).
- **Parsing plus Zod validation** (:672).
- **Regex fact-check:** digits, number canonicalisation and loose stemming (:864-1119, about 250
  lines).
- **Second Claude "judge" call** for suspected hallucinated proper names, with a 2 s deadline and
  per-band call budgets of 3 (:152-321, :1120-1275).
- **Per-call cost tracking and a ClickHouse `llm_calls` log.**
- **No caching and no custom retries.**

Load-bearing: prompt, grounding rule, parse, fact-check refusal (ESC-076/§E.7.0 requires "can't
ground → don't adapt"), and cost logging.

Accumulated: judge budgets and the unjudged-flag ceiling machinery (:211-445), the source-label
taxonomy, and two prompt variants. The spend cap belongs on a cached counter or at the Anthropic
console limit, not a per-request ClickHouse query.

## 3. Live paths

- **`apps/decision-api` is dead.** Its `index.ts` serves only `POST /api/adapt`, which returns 410
  Gone, and `/api/health` (:5-11, :67-78). ADR-0004 and ADR-0006 (ACCEPTED 2026-05-25) make
  control-plane canonical. The SDK URL comes from `data-decision-url`
  (`packages/sdk/src/core/config.ts:225`) and resolves to `…/api/adapt` on the control plane
  (`adapt.ts:57`).
- **Leftovers:** 1316 lines of source and 1318 lines of tests remain, plus a staging deploy job
  (`.github/workflows/deploy-staging.yml:69`) and CI test/build filters (`ci.yml:201, :261`). Its
  `reorder.ts`, `bandit.ts` and `llm-gateway.ts` have no live caller (route.ts:856-869, removal
  tracked as FOLLOW-107).
- **Auto-onboarding:** `/api/detect` (574 lines) is used only by `dashboard/detection`.
  `/api/sdk-detect` (45 lines) is a dev fallback that serves a bundle. `/api/schema/activate` (434
  lines) is called from `components/onboarding/DetectionPreview.tsx:239`; it seeds listing
  embeddings and `tenant_schema`, which the adapt reorder (:2100-2106) and `slot_selectors` read. So
  it is load-bearing for reorder only. With one tenant, a seed script would do the same job.

## 4. Admin and dashboard pages

- **Real data:** `admin/analytics` reads ClickHouse directly; `dashboard/pilot` uses `/api/pilot/*`
  (ClickHouse `adaptation_decisions ⋈ events`); `dashboard/analytics` uses
  `/api/dashboard/analytics/{summary,lift}`; `dashboard/quiz/analytics`;
  `dashboard/analytics/labels`, the tracer pages, `tracer/weights`, `quiz`, `listings/[id]/answers`.
- **Mock fallback when ClickHouse is not configured:** most analytics routes tag
  `data_source:'mock'` (`dashboard/analytics/lift/route.ts:205-316`,
  `pilot/calibration/route.ts:46`). The pages show a badge.
- **Pure demo/mock pages:** `dashboard/demo/mockup/*` (built on `lib/mockup-listings`) and
  `dashboard/demo/override`.
- **Thin wrappers:** the 11 `admin/tenants/[id]/*` sub-pages are 54–74 lines each, just auth plus a
  component.
- **Overlap:** lift is computed twice from the same join, in `pilot/cta-lift/route.ts:121-168` and
  `dashboard/analytics/lift/route.ts:152`. There are three analytics surfaces
  (`dashboard/analytics`, `admin/analytics` + `rollup`, `dashboard/pilot`) and two tenant views
  (`admin/tenants/[id]` and `/dashboard/*`).

## 5. Compliance surface

| Area                                                | Source lines | Test lines                          |
| --------------------------------------------------- | ------------ | ----------------------------------- |
| `dsr/*`                                             | 2352         | 4572                                |
| `v1/consent`                                        | 1170         | 1779                                |
| `internal/retention`                                | 305          | 488                                 |
| `lib/clickhouse-dsr.ts` + dsr-otp/rate-limit/verify | 1054         | not counted                         |
| **Total**                                           | **~4.9k**    | **~6.8k (excluding the lib tests)** |

- **What gates localhost GO:** FOLLOW-815 (the consent bundle). It is already DONE per
  `backlog/QUEUE.md:233, :1094`.
- **What does not:** DSR and retention are not named on the path (CLAUDE.md lists 817/818/560 → 819
  → 815 → 820). They are needed before production, not before localhost GO.
- **Keep them anyway:** already built and GDPR requires them. Freeze, do not delete.

## 6. Ranked simplifications (line counts are estimates)

| #   | Action                                                                                                                      | Source / test lines                           | Risk to core        | Blocker                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | Delete `apps/decision-api` and its deploy/CI entries                                                                        | 1.3k / 1.3k                                   | none                | FOLLOW-107; `scripts/check-rule-h.sh` references the 410                                       |
| 2   | Delete the GET `/api/adapt` handler                                                                                         | ~400 plus parts of the per-ticket tests       | low                 | Confirm no external GET caller (ADR-0004 mentions GET)                                         |
| 3   | Strip ticket-history comments from `route.ts` and `llm-gateway.ts`, move rationale to ADRs                                  | ~1.5k comment lines                           | none                | Rule I / mirror-signature scripts parse comments; check `scripts/lib/extract-fn-signature.cjs` |
| 4   | Merge the 29 ticket-named adapt test files (9.3k lines) into files per stage                                                | ~−3k test                                     | none                | none                                                                                           |
| 5   | Remove bandit plumbing from the served path; keep the variant column                                                        | ~150 in route + `getBanditArms`, `ab/weights` | low (inert anyway)  | CEO ESC-077 ruling                                                                             |
| 6   | Collapse `llm_full`/`llm_tweaked` into one call; drop the Haiku/Sonnet prompt split or the judge budgets                    | ~200–300                                      | low–med (grounding) | ESC-076 behaviour must be preserved; FOLLOW-819 rerun                                          |
| 7   | Move demo override, demo-session revocation, demo auth variants and `dashboard/demo/*` to a demo-only route/flag            | ~300 in route + 750 route files               | none for prod       | Demo flows (`demo-integration.yml`)                                                            |
| 8   | Merge the lift computations (pilot/cta-lift vs dashboard/analytics/lift) and one analytics page                             | ~500–800                                      | none                | Pilot dashboard consumers                                                                      |
| 9   | Freeze auto-onboarding (detect, sdk-detect, detection UI) for the single tenant; replace activate with a seed script        | ~1.5k                                         | low                 | Private-label re-brand onboarding plans                                                        |
| 10  | Replace the per-call ClickHouse spend query with a cached or console-level cap; drop the pilot-freeze guard and stall timer | ~150                                          | low                 | none                                                                                           |

**What must stay:** one auth path; consent/opt-out gates and the AL on/off switch; listing facts
plus RAG grounding, the decision tree, and the LLM call with the fact-check refusal (ESC-076);
withholding ungrounded copy on playbook fallback; the `adaptation_decisions` and `llm_calls`
ClickHouse logs plus holdout (the learning loop); quiz config/completion; the FOLLOW-815 consent
code; DSR, needed before production.
