# ADR-0011 — Quiz-config transport: SDK runtime GET replaces snippet data-attributes for post-activation-mutable flags

**Status:** ACCEPTED **Date:** 2026-06-11 **Accepted:** 2026-06-11 (CTO Rafał Palak, PR #269 merged)
**Ticket:** FOLLOW-275 **Cross-references:** FOLLOW-102, FOLLOW-209, FOLLOW-274, ADR-0004, ADR-0006,
Rule L, Rule U

---

## Context

FOLLOW-274 (PR #267) added the fifth parameter `microPollsEnabled` to `buildSnippet()` and wired the
SDK consumer (`config.ts:206`, `index.ts:888,965`). However, the only non-test caller of
`buildSnippet()` is `DetectionPreview.tsx:214`, which has exactly one non-test render site:
`DetectWizard.tsx:259`. That render site passes neither `microPollsEnabled` nor `quizEnabled`.

The result is that `data-micro-polls-enabled` and `data-quiz-enabled="false"` are **never emitted in
production**. The SDK consumers exist and are correct; the production producers of the snippet
arguments are absent. This is a Rule L HALF_WIRE (install-producer-absent, not a zero-importer Rule
I failure).

The same gap leaves the FOLLOW-102 `quizEnabled` arm unwired: a tenant who disables the quiz via the
dashboard never gets `data-quiz-enabled="false"` in their snippet.

Root cause is structural, not incidental: the snippet is produced **once at onboarding**, before any
quiz_config toggle is ever set. The dashboard quiz page
(`apps/control-plane/src/app/dashboard/ quiz/page.tsx`) has no `buildSnippet` call and renders no
snippet. Threading the flags from DetectWizard → DetectionPreview → buildSnippet only solves the
onboarding-time state; it cannot solve post-activation config changes without an additional
"regenerate snippet" dashboard surface that tenants must use every time they change a setting —
which breaks the self-serve model.

Two candidate architectures:

**(a) Snippet-threading + dashboard re-emission:** Thread `microPollsEnabled` and `quizEnabled` from
the tenant's `quiz_config` through `DetectWizard → DetectionPreview → buildSnippet`. Requires
`DetectWizard` to fetch `quiz_config` at render time (before the tenant has set any quiz config).
Also requires a dashboard re-emission surface that regenerates and displays the snippet whenever
quiz settings change — otherwise post-activation config changes require tenant re-install.

**(b) SDK runtime GET:** The SDK fetches `GET /api/quiz/config` at init time to read
`{ quiz_enabled, micro_polls_enabled, language, accent_color }`. The static snippet carries only the
immutable tenant binding (API key, tenant ID, decision URL). Runtime config is fetched dynamically;
quiz config changes take effect without re-onboarding. The snippet data-attributes
`data-quiz-enabled` and `data-micro-polls-enabled` are retired.

---

## Decision

**Adopt option (b) — SDK runtime GET — as the transport for all post-activation-mutable quiz/widget
config fields.** The static snippet is restricted to immutable tenant-binding fields only.

Specifically:

1. The SDK calls `GET /api/quiz/config` at init time (after consent is resolved, before the quiz
   timer fires). The response is merged into `SdkConfig` for the session.

2. The snippet data-attributes `data-quiz-enabled` and `data-micro-polls-enabled` are **retired**:
   - `buildSnippet()` stops emitting them (the params become dead in that function).
   - `readConfig()` in `packages/sdk/src/core/config.ts` stops reading `dataset.quizEnabled` and
     `dataset.microPollsEnabled`.
   - Existing tenants with old snippets carrying these attributes are unaffected: the SDK will
     simply override the dataset values with the freshly-fetched server values.

3. The `GET /api/quiz/config` route already exists and returns the correct shape. It is extended
   with no breaking changes: the existing
   `{ language, accent_color, micro_polls_enabled, quiz_enabled, tenant_id }` response is the wire
   contract for this ADR.

4. On error or timeout the SDK falls back to the snippet-attribute values (backward-compatible) and
   then to hardcoded SDK defaults (`quiz.enabled = true`, `microPollsEnabled = false`). The quiz
   timer must NOT fire before the runtime config fetch resolves (or times out with fallback).

5. `language` and `accent_color` (also in `quiz_config`, also un-emitted by `buildSnippet` — see
   FOLLOW-273) are included in the same runtime fetch, resolving the FOLLOW-273 gap in the same
   change.

---

## Wire Contract

### `GET /api/quiz/config` — response shape (no change to route, documents existing behavior)

```
Status: 200 OK
Content-Type: application/json

{
  "language":             "en" | "pl" | "es",     // QuizLanguage
  "accent_color":         string,                  // CSS hex, e.g. "#2563EB"
  "micro_polls_enabled":  boolean,
  "quiz_enabled":         boolean,                 // tenants.quiz_enabled typed column
  "tenant_id":            string                   // UUID
}
```

Auth: JWT-verified tenant claims (Supabase Auth). Returns 401 on missing/invalid JWT.

Fallback (DB unavailable): returns defaults (`quiz_enabled: true`, `micro_polls_enabled: false`,
`language: "en"`, `accent_color: "#2563EB"`) — same as the existing fallback path.

Nullability: all fields are always present in a 200 response. No field is `null`. The SDK must NOT
treat absence of any field as an error; it should fall through to its local defaults.

### SDK behavior on error / timeout

```
Timeout budget:  1000 ms
On network error / non-2xx / timeout:
  → fall back to dataset attribute values (data-quiz-enabled, data-micro-polls-enabled if present
    on legacy snippets)
  → then fall back to SdkConfig hardcoded defaults
  → log to console.warn if config.debug === true
  → do NOT block quiz timer or micro-poll timer; proceed with fallback values
```

The fetch is fire-at-init; it MUST NOT delay DOM augmentation or archetype detection. It resolves a
promise that the quiz/micro-poll schedulers `await` before deciding whether to show.

### SDK init sequence (updated)

```
1. readConfig()          — parse snippet dataset (immutable binding only)
2. resolveConsent()      — consent banner / prior consent state
3. fetchQuizConfig()     — GET /api/quiz/config (1000 ms timeout; fallback on error)
4. mergeQuizConfig()     — overlay server values onto SdkConfig
5. scheduleQuizTrigger() — uses merged config.quiz.enabled
6. schedulesMicroPoll()  — uses merged config.microPollsEnabled
```

Steps 3–4 are new. Steps 5–6 already exist; they must be gated behind the step-3 resolution.

### Migration from existing snippet data-attributes

| Attribute                      | Old behavior                        | New behavior                        |
| ------------------------------ | ----------------------------------- | ----------------------------------- |
| `data-quiz-enabled`            | Controls quiz widget on/off         | Ignored (overridden by runtime GET) |
| `data-micro-polls-enabled`     | Controls micro-polls on/off         | Ignored (overridden by runtime GET) |
| `data-tenant-id`               | Unchanged — required                | Unchanged                           |
| `data-api-key`                 | Unchanged — required                | Unchanged                           |
| `data-decision-url`            | Unchanged — required                | Unchanged                           |
| `data-inquiry-submit-selector` | Unchanged — emitted by buildSnippet | Unchanged (detected, not mutable)   |

Tenants do NOT need to update their snippets. Old snippets with `data-quiz-enabled` or
`data-micro-polls-enabled` present will work correctly: the SDK will fetch the server value and use
it, ignoring the stale attribute.

### `buildSnippet()` changes

The `quizEnabled` and `microPollsEnabled` params are removed (or kept as dead optional params with
no emission logic) to prevent re-introducing the retired attributes. The function signature narrows:

```typescript
export function buildSnippet(
  tenantId: string,
  apiKey: string,
  inquirySubmitSelector?: string | null,
): string;
```

The `quizEnabled` and `microPollsEnabled` optional params are deleted. Any existing callers passing
them will require removal of the argument (no type error if kept as optional and then removed — the
function simply stops emitting the attributes).

---

## Consequences

### Positive

- Eliminates the entire class of "snippet attribute never emitted because buildSnippet caller
  doesn't have the value at onboarding time" (Rule L HALF_WIRE). Post-activation config changes
  propagate to the SDK on next page load without snippet reinstall.
- `GET /api/quiz/config` already exists; no new backend route required.
- The FOLLOW-273 gap (`language`, `accent_color` un-emitted) is resolved in the same change.
- Snippet stays small and stable (only immutable binding fields). The "copy this snippet" UX in
  DetectionPreview.tsx never goes stale.
- Removes a detection→snippet→attribute chain that has produced 8 consecutive retro entries on the
  `tenants.quiz_config` blob (RETRO-049 through RETRO-057).

### Negative

- Adds a network round-trip at SDK init (1000 ms budget). On pages where the host site is already
  loading many resources this may delay quiz appearance by ~50–200 ms in practice. Mitigated by: the
  quiz timer is 30 s (configurable); the micro-poll timer is 90 s; the fetch latency is negligible
  vs the trigger delay.
- The SDK now depends on `GET /api/quiz/config` being reachable from the tenant's page origin. This
  is the same CORS requirement as `POST /api/adapt` (already required). No new CORS surface.
- Tenants on a Content Security Policy that blocks `admin.estalara.com` need to add the domain to
  their `connect-src`. This is unchanged from the adapt endpoint requirement.

### Risks

- **Auth:** `GET /api/quiz/config` requires a valid Supabase JWT. The SDK runs anonymously on the
  buyer-facing listing page — it does NOT have a tenant JWT. This is the key structural gap that
  must be resolved in the implementation. Resolution: the SDK uses its `data-api-key` to
  authenticate to a NEW unauthenticated-but-API-key-gated variant of the endpoint, OR the existing
  route adds an API-key auth path alongside the JWT path, OR a separate public endpoint is
  introduced. See Implementation Notes below.
- **Reversibility:** HIGH. If the SDK runtime GET proves impractical (auth, CSP, latency), the
  snippet-threading approach (option a) can be adopted without changing the backend. The ADR is
  reversible at the cost of the DetectWizard/dashboard re-emission surface work.

### Implementation Notes — Auth Resolution (REQUIRED before implementation)

The current `GET /api/quiz/config` requires a tenant JWT (Supabase Auth). The SDK runs in an
anonymous buyer context — it has no tenant JWT. Two viable paths:

**(i) API-key auth on GET /api/quiz/config:** Add a secondary auth branch: if the `Authorization`
header carries a valid `data-api-key` (verified against `tenants.api_key` in the DB), return the
tenant's quiz config. JWT path remains for the dashboard. This is a read-only endpoint with no PII —
the risk profile is low.

**(ii) Separate public endpoint `GET /api/quiz/public-config`:** A new, API-key-authenticated,
read-only endpoint returning only the fields the SDK needs:
`{ quiz_enabled, micro_polls_enabled, language, accent_color }`. No tenant PII. No `tenant_id` in
the response. Simpler to reason about (no dual-auth path on a single route).

The implementation agent MUST choose one of (i) or (ii) and document the choice in the PR. Path (ii)
is preferred by this ADR (simpler threat model, no dual-auth complexity). If path (i) is chosen, the
auth model change requires a Rule H amendment review.

**Required auth shape for path (ii):**

```
GET /api/quiz/public-config
Authorization: Bearer <tenant-api-key>      (the data-api-key from the SDK snippet)

Response 200:
{
  "quiz_enabled":         boolean,
  "micro_polls_enabled":  boolean,
  "language":             "en" | "pl" | "es",
  "accent_color":         string
}

Response 401: { "error": "Invalid API key" }
Response 404: { "error": "Tenant not found" }

CORS: must allow origins matching * (public buyer-facing sites; no credential needed)
Cache-Control: max-age=300, stale-while-revalidate=60   (5-min TTL reduces DB load)
```

The `tenant_id` is NOT returned (not needed by SDK; reduces info leakage). The API key lookup uses a
constant-time compare against the DB value.

**Note:** path (ii) introduces a new route, which requires an ADR per Rule H (auth model change on a
new route). The implementing backend-engineer must either file a sub-ADR or justify reuse of the
existing ADR-0004/0006 auth model. This ADR explicitly delegates that sub-decision.

---

## Alternatives

### Alternative A — Snippet-threading (option a)

Thread `microPollsEnabled` and `quizEnabled` from the tenant's `quiz_config` through
`DetectWizard → DetectionPreview → buildSnippet`. Requires:

- DetectWizard to fetch `quiz_config` at detection time (before the dashboard toggle is set)
- A new "your current snippet" surface in the dashboard quiz page that re-emits the snippet whenever
  settings change

Rejected because: (1) the DetectWizard runs before quiz config is set, so the onboarding snippet
always reflects defaults; (2) the dashboard re-emission surface is an additional UI surface that
must be built and maintained; (3) config changes still require tenants to copy-paste a new snippet
unless the snippet is auto-applied via the Estalara loader mechanism; (4) this approach does not
resolve the FOLLOW-273 gap (language, accent_color) without further threading.

### Alternative C — Status quo (no fix)

Leave `data-micro-polls-enabled` and `data-quiz-enabled` never emitted in production. Rejected: the
features are silently dead at runtime, the docstrings assert them as wired, and TICKET-PILOT-001's
dashboard-quiz-disable path depends on quiz_enabled propagating.

---

## References

- FOLLOW-275 (`backlog/FOLLOW_UPS.md`) — source retro RETRO-057
- FOLLOW-102 — `tenants.quiz_enabled` typed column, `buildSnippet` quizEnabled param
- FOLLOW-274 (PR #267) — `buildSnippet` microPollsEnabled param (the change that moved the gap one
  hop up to the DetectWizard call site)
- FOLLOW-273 — language/accent_color locale-enum facet of the same blob (resolved by this ADR)
- ADR-0004 — canonical adapt endpoint (auth model reference)
- ADR-0006 — canonical adapt enforcement
- Rule L — install/snippet producer absent
- Rule U — gating state must live in typed columns; blob keys for non-gating config only
- `apps/control-plane/src/app/api/quiz/config/route.ts` — existing GET implementation
- `packages/shared/src/schemas/quiz-config.ts` — canonical QuizConfig type
- `packages/sdk/src/core/config.ts:206` — existing SDK consumer of data-micro-polls-enabled
- `apps/control-plane/src/components/onboarding/DetectWizard.tsx:259` — unwired call site
