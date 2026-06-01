# ADR-0007: Canonical `/api/adapt` Endpoint Enforcement (post-Worker-retirement)

## Status

PROPOSED — 2026-05-30 (awaiting AI Council sign-off in FIX-032)

## Context

ADR-0004 (ACCEPTED 2026-05-17) declared `apps/control-plane/src/app/api/adapt/route.ts` as the sole
canonical adapt endpoint. ADR-0006 (ACCEPTED 2026-05-25, CEO-ratified) enforced this at runtime: the
Cloudflare Worker `/api/adapt` route now hard-fails with `410 Gone` since 2026-05-25, the SDK
snippet generator was corrected to emit the canonical host, and CI Rule H gates against
re-divergence.

CHK-A (Discovery Day, 2026-05-30) completed the post-enforcement verification pass required by
ADR-0006 §Implementation Notes before the v3 plan gate. The purpose of this ADR is to:

1. Permanently document the canonical URL as settled truth for any new reader or agent.
2. Formalise the SDK loader contract: what `data-decision-url` MUST be set to and why.
3. Specify the reverse-proxy / redirect strategy for any tenant that cached the old Worker URL.
4. Formalise the CI gate that prevents the Worker URL from re-entering the loader output.
5. Provide a stable reference for Sprint 14 / v3 work that builds on this foundation.

### What CHK-A found

The audit confirmed that every snippet-emission path in the codebase is correct and consistent. Full
findings are in `backlog/sprint-14-discovery/CHK-A.md`.

- `apps/control-plane/src/app/api/sdk/route.ts` — the `/api/sdk` GET route serves the raw IIFE
  bundle file. It does NOT embed `data-decision-url`. The attribute is emitted by the snippet
  generator (`DetectionPreview.buildSnippet`) and the demo mockup layout, not by this route. No
  drift found in the route itself.

- The snippet generator (`apps/control-plane/src/components/onboarding/DetectionPreview.tsx:129`)
  emits `data-decision-url="${CONTROL_PLANE_URL}/api"`, which resolves to
  `https://admin.estalara.com/api`. The SDK appends `/adapt` at call time
  (`packages/sdk/src/core/adapt.ts:527`), yielding the canonical URL
  `https://admin.estalara.com/api/adapt`.

- The demo mockup layout (`apps/control-plane/src/app/dashboard/demo/mockup/layout.tsx:38`) emits
  the identical `data-decision-url={CONTROL_PLANE_URL + "/api"}`, confirmed by its own test file.

- `packages/sdk/src/core/config.ts:57-64` — `DEFAULT_CONFIG` does NOT include `decisionApiUrl`. When
  `data-decision-url` is absent from a script tag, `config.decisionApiUrl` is `undefined` and
  `fetchDirectives` returns `null` immediately (`adapt.ts:494`). Adaptation is silently disabled;
  there is no fallback to any other URL. This is intentional and correct per ADR-0006.

- The Worker route (`apps/decision-api/src/app/api/adapt/route.ts:43`) hard-returns `410 Gone` with
  body
  `{ error: 'deprecated', canonical: 'https://admin.estalara.com/api/adapt', since: '2026-05-25' }`.
  No archetype-selection logic remains.

- CI Rule H (`scripts/check-rule-h.sh:98-128`) actively asserts: (i) no `detectArchetype` or
  `*_DIRECTIVES` identifiers in the Worker route, and (ii) the Worker route returns 410. A separate
  adapter (`scripts/check-adapt-schema-drift.sh`) asserts schema sync between the SDK adapt-schema
  and `AdaptationDirectives`.

No drift was found. The canonical URL is unambiguously `https://admin.estalara.com/api/adapt`.

## Decision

### D1: Canonical adapt URL

The canonical adapt endpoint is and remains:

```
https://admin.estalara.com/api/adapt
```

Implemented as `apps/control-plane/src/app/api/adapt/route.ts` (Next.js 15 App Router on Vercel).
This is the only path that exercises the 18-archetype playbook + LLM + RAG + A/B holdout. No other
URL is a valid production target.

The authoritative constant is `CONTROL_PLANE_URL` in `packages/shared/src/domains.ts:41`:

```ts
export const CONTROL_PLANE_URL = `https://${CONTROL_PLANE_DOMAIN}` as const;
// CONTROL_PLANE_DOMAIN = 'admin.estalara.com'
```

### D2: SDK embed snippet contract

Every embed snippet emitted by the system MUST include:

```html
data-decision-url="https://admin.estalara.com/api"
```

The SDK appends `/adapt` to this value at request time. The final fetch target MUST resolve to
`https://admin.estalara.com/api/adapt`.

Rules:

- The value MUST be an absolute HTTPS URL (not a relative path). A relative path resolves against
  the tenant's own origin and silently misdirects adapt requests.
- The value MUST end with `/api`, not with `/api/adapt` (the SDK appends `/adapt` itself).
- The value MUST reference `CONTROL_PLANE_URL` from `@estalara/shared`, never a hardcoded string, to
  propagate any future domain change automatically.
- The attribute MUST NOT be omitted. A missing `data-decision-url` disables adaptation entirely and
  is a silent regression (the `[BLOCKER]` finding in FOLLOW-105 substep 1a).

Snippet generator reference: `apps/control-plane/src/components/onboarding/DetectionPreview.tsx:129`
Demo mockup reference: `apps/control-plane/src/app/dashboard/demo/mockup/layout.tsx:38`

### D3: Worker route disposition

The Cloudflare Worker route at `apps/decision-api/src/app/api/adapt/route.ts` is in Phase 1
retirement (410 Gone, since 2026-05-25). Phase 2 full removal is tracked by FOLLOW-107 (Sprint 14,
P3) after a 7-day zero-traffic monitoring window. Until FOLLOW-107 ships, the 410 body includes
`canonical: 'https://admin.estalara.com/api/adapt'` so any residual caller can self-correct.

### D4: Reverse-proxy / redirect strategy for tenants with a cached old URL

If a tenant's deployed snippet still points at the deprecated Worker URL (e.g.
`https://decision.estalara.com/api/adapt` or the old `control-plane.estalara.com` hostname drafted
in ADR-0006 §Decision 3):

1. **Immediate mitigation (no code change):** The 410 body already carries the `canonical` field.
   SDK callers that inspect the 410 response can log the mismatch. Silent failure (returning `null`
   from `fetchDirectives`) is the safe default — adaptation is disabled but the tenant site does not
   break.
2. **Short-term (if traffic is observed during the Phase 1 monitoring window):** Add a Cloudflare
   Worker redirect rule at the deprecated hostname that issues a `301` to
   `https://admin.estalara.com/api/adapt`, preserving method and body where possible. This is option
   3b from ADR-0006 §Alternatives and is a last resort.
3. **Preferred:** Re-issue the tenant's embed snippet via the onboarding wizard. The canonical
   snippet is always available from the tenant dashboard. This resolves the root cause without
   adding an edge hop.

For the pilot tenant on app.estalara.com (separate SvelteKit repo, not in this monorepo): the
snippet was issued by the onboarding wizard post-FOLLOW-105 and therefore carries the correct
`data-decision-url`. No redirect is required. If the pilot site ever re-deploys from a
pre-FOLLOW-105 snapshot, the FIX-032 ticket MUST verify the embedded snippet value before go-live.

### D5: CI enforcement

Rule H (`scripts/check-rule-h.sh`, mandated by ADR-0006 §Decision 4) already gates against:

- `detectArchetype` or `*_DIRECTIVES` in the Worker route (archetype-selection re-introduction).
- Worker route missing its `410` response.
- SDK adapt-schema drift from `AdaptationDirectives` (`scripts/check-adapt-schema-drift.sh`).

This ADR adds one additional CI assertion to be implemented alongside FIX-032:

**Rule H gate 3 — loader URL constant check:** Any snippet-emitting file that contains a
`data-decision-url` literal MUST reference `CONTROL_PLANE_URL` (or `CONTROL_PLANE_DOMAIN`) from
`@estalara/shared`, not a hardcoded hostname string. The gate is a grep check:

```bash
# Fail if any .ts/.tsx contains a hardcoded admin.estalara.com in a data-decision-url context
# without importing from @estalara/shared.
if grep -rE 'data-decision-url.*admin\.estalara\.com' --include='*.ts' --include='*.tsx' \
     apps/ packages/ | grep -v 'CONTROL_PLANE_URL\|domains\.ts\|\.test\.\|\.spec\.'; then
  echo "FAIL: hardcoded admin.estalara.com in data-decision-url — use CONTROL_PLANE_URL"
  exit 1
fi
```

This prevents the canonical URL from drifting if `CONTROL_PLANE_DOMAIN` is ever updated.

## Consequences

### Positive

- v3 plan and Sprint 14 tickets can reference this ADR as the settled, audited baseline for the
  adapt endpoint — no re-investigation needed.
- The `data-decision-url` contract is now explicit and testable; any new snippet-emission point must
  satisfy D2 to pass CI.
- The reverse-proxy strategy is documented before it is needed, avoiding an incident-time decision.

### Negative

- The proposed Rule H gate 3 requires a small script addition; it does not exist yet.
- Tenants who copy-pasted snippets from the pre-FOLLOW-105 onboarding wizard (before 2026-05-25) may
  have a stale `data-decision-url` value. There is no automated detection of this outside the Phase
  1 Worker traffic logs.

### Risks

- **Pilot re-deploy from stale snapshot:** app.estalara.com (separate repo) could regress to the
  pre-FOLLOW-105 snippet if deployed from an old branch. Mitigation: FIX-032 acceptance criteria
  must include a live snippet check on app.estalara.com.
- **`CONTROL_PLANE_URL` domain change:** if `admin.estalara.com` is ever renamed, every snippet in
  the wild becomes stale. Mitigation: Rule H gate 3 ensures no hardcoded strings are in the
  emitters, so a single `domains.ts` update propagates correctly going forward. Tenants with
  existing snippets still need re-issuance.

### Reversibility

Hard to undo. The canonical URL is publicly deployed and the pilot is live on it. Any URL change
requires re-issuance of all tenant snippets and is a breaking change for any tenant that has not
re-onboarded. Classification: hard.

## Alternatives Considered

### Alt 1: No new ADR — rely solely on ADR-0004 + ADR-0006

Pros: fewer documents.

Cons: ADR-0004 and ADR-0006 document the decision process and enforcement implementation, not the
post-enforcement settled state. A reader of either ADR still has to reconstruct the current loader
contract from code. This ADR consolidates the verified, audited state for v3 planning.

Rejected.

### Alt 2: Redirect-first (option 3b) as the default strategy

Pros: any tenant with a stale snippet self-heals without re-onboarding.

Cons: adds a permanent edge hop; requires Cloudflare rule management; makes the deprecated Worker a
dependency of production traffic. ADR-0006 explicitly labels this a last resort.

Rejected as default; retained as a contingency in D4.

## References

- `docs/adr/ADR-0004-canonical-adapt-endpoint.md` — original canonical-endpoint decision
- `docs/adr/ADR-0006-canonical-adapt-enforcement.md` — runtime enforcement (Worker 410, CI gate,
  snippet fix)
- `backlog/sprint-14-discovery/CHK-A.md` — Discovery Day audit that produced the findings
  consolidated here
- `packages/shared/src/domains.ts:40-41` — `CONTROL_PLANE_DOMAIN` / `CONTROL_PLANE_URL` constants
- `apps/control-plane/src/components/onboarding/DetectionPreview.tsx:120-129` — `buildSnippet()`
  function
- `apps/control-plane/src/app/dashboard/demo/mockup/layout.tsx:38` — demo mockup snippet emission
- `packages/sdk/src/core/config.ts:57-64` — `DEFAULT_CONFIG` (no `decisionApiUrl` default)
- `packages/sdk/src/core/adapt.ts:494,527` — `fetchDirectives` null-guard and fetch call
- `apps/decision-api/src/app/api/adapt/route.ts:43-109` — Worker 410 Gone handler
- `scripts/check-rule-h.sh:98-128` — Rule H CI gate (Worker retirement check)
- `scripts/check-adapt-schema-drift.sh` / `scripts/check-adapt-schema-drift.cjs` — schema sync gate
- `docs/MASTER_DESIGN.md` §B.9 / §C.1 / §C.4 / §Snapshot.7
