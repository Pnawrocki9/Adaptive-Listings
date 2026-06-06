# CHK-A: Canonical `/api/adapt` Endpoint — Discovery Day Audit

**Date:** 2026-05-30 **Auditor:** architect **Trigger:** v3 plan Discovery Day check; ADR-0006
§Implementation Notes post-enforcement verification **Linked ADR:**
`docs/adr/0007-canonical-adapt-endpoint.md` (PROPOSED, FIX-032)

---

## (a) Verified Canonical URL

```
https://admin.estalara.com/api/adapt
```

Source of truth: `CONTROL_PLANE_URL` constant at `packages/shared/src/domains.ts:40-41`.

The Worker 410 body (`apps/decision-api/src/app/api/adapt/route.ts:43`) independently hard-codes the
same URL in `CANONICAL_ADAPT_URL = 'https://admin.estalara.com/api/adapt'`, consistent with the
`packages/shared` constant.

---

## (b) Verified Current Loader Output

### `/api/sdk` route

`apps/control-plane/src/app/api/sdk/route.ts` (lines 1-27) serves the raw IIFE bundle from
`packages/sdk/dist/estalara-sdk.iife.js`. It does NOT emit `data-decision-url`. This route is a
dev-only file server; the attribute is always in the embedding HTML, not in the bundle file.

No `data-decision-url` attribute is generated or injected by this route. It is not a snippet
generator.

### Snippet generator — onboarding wizard

`apps/control-plane/src/components/onboarding/DetectionPreview.tsx:129` (`buildSnippet()`):

```
data-decision-url="${CONTROL_PLANE_URL}/api"
```

At runtime this expands to `data-decision-url="https://admin.estalara.com/api"`.

The SDK (`packages/sdk/src/core/adapt.ts:527`) appends `/adapt` at call time:

```ts
fetch(`${config.decisionApiUrl}/adapt`, ...)
```

Final fetch target: `https://admin.estalara.com/api/adapt`. Correct.

### Demo mockup layout

`apps/control-plane/src/app/dashboard/demo/mockup/layout.tsx:38`:

```tsx
data-decision-url={`${CONTROL_PLANE_URL}/api`}
```

Same expansion. Identical final target. Correct.

### SDK integration test

`packages/sdk/src/__tests__/adapt-canonical-url.integration.test.ts:54` confirms that a script tag
built with `data-decision-url="${CONTROL_PLANE_URL}/api"` produces the canonical fetch target
`https://admin.estalara.com/api/adapt`. Test coverage for the contract exists.

### SDK config default

`packages/sdk/src/core/config.ts:57-64` — `DEFAULT_CONFIG` deliberately omits `decisionApiUrl`. When
`data-decision-url` is absent from a script tag, `config.decisionApiUrl` is `undefined`.
`fetchDirectives` (`adapt.ts:494`) returns `null` immediately. There is no fallback URL and no
silent re-routing to the Worker or any other host. Adaptation is disabled until an explicit
`data-decision-url` is provided.

---

## (c) Mismatch Found

None. No mismatch was found between the canonical URL and any active snippet-emission path.

Specifically:

- No active code path emits the deprecated Worker URL (`decision.estalara.com`) or the stale draft
  hostname (`control-plane.estalara.com`) that appeared in ADR-0006 §Decision 3 before the
  FOLLOW-105 hostname correction.
- No active code path emits a bare `https://admin.estalara.com` (without `/api`) which would resolve
  the final fetch to `https://admin.estalara.com/adapt` (404 — no route there).
- The Worker route contains no archetype-selection logic (Rule H gate 2 confirmed; the
  `check-rule-h.sh` gate covers this in CI).

One historical concern documented in the codebase but not a current mismatch: the old
`data-decision-url="/api"` (relative path) in the pre-FOLLOW-105 demo mockup. This was corrected to
the absolute URL in FOLLOW-105 substep 1b. The current code is absolute.

---

## (d) Remediation Required

### No immediate remediation needed in this monorepo.

All snippet-emission paths are correct. The Worker 410 is in place. CI Rule H is active.

### Recommended follow-on actions (non-blocking for v3 plan gate)

1. **FIX-032 — Rule H gate 3 (new CI assertion).** Add a grep check to `scripts/check-rule-h.sh`
   that fails if any `.ts`/`.tsx` file emits `data-decision-url` with a hardcoded
   `admin.estalara.com` string without importing from `@estalara/shared`. This prevents future URL
   drift if `CONTROL_PLANE_DOMAIN` is ever renamed. Effort: ~30 min. See ADR-0007 §D5 for the exact
   shell fragment.

2. **FIX-032 — Live snippet check on app.estalara.com (separate repo).** The pilot SDK is deployed
   on app.estalara.com (separate SvelteKit repo, not in this monorepo). CHK-A cannot inspect that
   repo's deployed snippet value directly. FIX-032 acceptance criteria MUST include a manual or
   automated check that the live `<script>` tag on app.estalara.com carries
   `data-decision-url="https://admin.estalara.com/api"`. If it was issued post-FOLLOW-105 (after
   2026-05-25), it is correct. If any doubt, re-issue via the dashboard.

3. **FOLLOW-107 — Worker full retirement.** The Phase 1 monitoring window (7 days from 2026-05-25)
   expires ~2026-06-01. If Worker `/api/adapt` logs show zero calls,
   `apps/decision-api/src/app/api/adapt/route.ts` and its backing lib layer can be deleted. Effort:
   ~1h. Rule H gate 2 will automatically pass for "file absent" after deletion.

4. **INTERFACES.md update.** The Decision API Contract row in `docs/INTERFACES.md` still references
   the old `apps/decision-api` location. It should be updated to reference
   `apps/control-plane/src/app/api/adapt/route.ts` and `ADR-0007`.

---

## Summary Table

| Check                                      | Result                                     | Location                                           |
| ------------------------------------------ | ------------------------------------------ | -------------------------------------------------- |
| Canonical URL                              | `https://admin.estalara.com/api/adapt`     | `packages/shared/src/domains.ts:40-41`             |
| `/api/sdk` route emits `data-decision-url` | No — serves bundle only                    | `apps/control-plane/src/app/api/sdk/route.ts:1-27` |
| Snippet generator output                   | `${CONTROL_PLANE_URL}/api` (correct)       | `DetectionPreview.tsx:129`                         |
| Demo mockup output                         | `${CONTROL_PLANE_URL}/api` (correct)       | `mockup/layout.tsx:38`                             |
| SDK config default                         | `undefined` (no fallback URL)              | `config.ts:57-64`                                  |
| Worker route status                        | 410 Gone since 2026-05-25                  | `decision-api/.../route.ts:43-109`                 |
| CI Rule H gate                             | Active (gates drift + 410)                 | `scripts/check-rule-h.sh:98-128`                   |
| Mismatch found                             | None                                       | —                                                  |
| Remediation needed (monorepo)              | None                                       | —                                                  |
| Follow-on tickets                          | FIX-032 (gate 3 + pilot check), FOLLOW-107 | See §(d)                                           |
