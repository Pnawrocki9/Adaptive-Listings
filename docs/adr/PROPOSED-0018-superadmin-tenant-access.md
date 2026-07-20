# ADR-0018: Superadmin (Estalara staff) access to tenant-scoped dashboard functionality + global-vs-per-tenant settings control

## Status

PROPOSED — 2026-07-20 (CEO-directed, Piotr). Generalizes the staff-per-tenant access pattern
established by ADR-0013 (`/admin/tenants/[id]/tracer`, `verifyTracerAdminAuth`). Reverses two prior
locked decisions where the newer 2026-07-20 CEO instruction supersedes them (see §Decision 0 and the
Open questions). Relates to FOLLOW-456 (staff-only generation-model PUT), FOLLOW-267 (tracer admin
auth), FOLLOW-454/555 (SSR session auth), and the existing `staff_audit_log` table
(`packages/db/src/schema/staff_audit_log.ts`).

## Context

The CEO (superadmin) must, on `admin.estalara.com`, be able to (a) reach every function the agency
dashboard exposes, (b) change every setting an agency can, and (c) change settings both per-tenant
and globally. Today none of this is reachable, for two independent reasons:

1. **Middleware hard-blocks staff from the tenant dashboard.** `checkDashboardSession` rejects any
   session whose `app_metadata.estalara_staff === true`
   (`apps/control-plane/src/middleware.ts:226`), and the `/dashboard/*` gate depends on it
   (`middleware.ts:295-333`). A staff member is redirected to `/sign-in`.

2. **Tenant-scoped APIs resolve the tenant from the SESSION, not the URL.** Every dashboard feature
   derives `tenant_id` from the verified session claims:
   - `GET /api/dashboard/analytics/summary` — `claims.tenant_id`
     (`analytics/summary/route.ts:169-179`).
   - `GET /api/ab/weights` — `session.claims.tenant_id` (`ab/weights/route.ts:70-80`).
   - `PATCH /api/tenants/[id]/bandit/weights/[archetype]` — URL `:id` is accepted but **must equal**
     `claims.tenant_id`, else 403 (`bandit/weights/[archetype]/route.ts:59-67`).
   - `GET/PUT /api/quiz/config` — `getSessionAuthClaims` / `requireTenantSessionAccess`
     (`quiz/config/route.ts:56,65,104`).

   A staff account has `tenant_id: null` (`session-auth.ts:100-111`), so even if middleware let it
   into `/dashboard`, every one of these routes would 401 (`analytics/summary/route.ts:170`,
   `ab/weights/route.ts:71`) or, worse, silently disable RLS: `createTenantClient(undefined)` is a
   documented RLS-off pass-through (`session-auth.ts:128-133`).

3. **Production has exactly one auth user** — the CEO's `estalara:superadmin` account, `tenant_id`
   null. No agency user exists, so every tenant-scoped feature is unreachable by anyone.

There is already a working precedent for staff acting on a specific tenant: the K.3.6 Archetype
Tracer (ADR-0013). It puts the tenant in the URL (`/admin/tenants/[id]/tracer`, the page reads it
from `params`, `tracer/page.tsx:295-309`) and authenticates staff via `verifyTracerAdminAuth`
(`tracer-auth.ts:93`), which accepts `Bearer <ADMIN_API_SECRET>` (constant-time), a staff SSR
session, or a staff JWT (`tracer-auth.ts:97-154`). This ADR **generalizes that precedent** to all
tenant-scoped dashboard features rather than inventing a new access model.

Two prior locks are in tension with the new requirement:

- **Multi-tenant admin screens hidden (CEO 2026-06-15, "single-tenant v1").** Registrations, the
  Tenants list, and Demo Sessions exist but are not navigable (`admin/layout.tsx:24-26`).
- **`generation_model` is GLOBAL with no per-tenant override (CEO 2026-06-01).** Documented in the
  route header and enforced by making PUT staff-only (`generation-model/route.ts:6-7,12-17`).

## Decision

### 0. Ratify the reversals the 2026-07-20 instruction implies

- The 2026-06-15 "single-tenant v1" hide is **superseded**: the `/admin` navigation gains a Tenants
  hub (`/admin/tenants`, per-tenant entry at `/admin/tenants/[id]`). The CEO's 2026-07-20 ruling is
  the newer decision and this ADR ratifies un-hiding those screens.
- The 2026-06-01 `generation_model` global-only lock is **NOT reversed by this ADR by default.**
  Whether `generation_model` gains a per-tenant override is a genuine product question left to the
  CEO (see Open questions Q1). This ADR ships the mechanism that would make either answer possible
  but recommends the narrow reading (no per-tenant model override) unless the CEO says otherwise.

### 1. Tenant-context resolution: URL-scoped, not session impersonation

Staff act on a tenant via **URL-scoped routes** — `/admin/tenants/[id]/<feature>` and API calls that
carry an explicit `tenant_id` path/query parameter — exactly as the tracer does. We **reject** a
session-side "impersonation switch" that swaps the effective tenant into the staff session (see
Alternatives). Rationale: the staff identity stays truthful in every request (the session always
says "this is staff user X"), the acted-on tenant is an explicit, loggable parameter on every call,
and there is no ambient mutable "who am I acting as" state to leak across requests or tabs.

Shared UI: dashboard feature components are refactored to receive `tenantId` **as a prop**, sourced
from the `[id]` route segment, instead of reading it from the session or the `x-tenant-id` header.
Server components read `params`; client components receive the resolved id as a prop (the tracer
page already does this — `tracer/page.tsx:295-309`). The same component renders under `/dashboard/*`
(tenantId from the agency session) and under `/admin/tenants/[id]/*` (tenantId from the URL); the
component never sources the id itself.

### 2. API staff-override contract: one helper, five invariants

Add `resolveTenantAccess(req, opts)` to `apps/control-plane/src/lib/session-auth.ts`. It returns a
discriminated union so the two paths are structurally impossible to confuse:

```ts
type TenantAccess =
  | { via: 'agency'; tenantId: string; claims: TenantClaims; rawToken: string | null }
  | { via: 'staff'; tenantId: string; staff: StaffClaims; role: EstalaraRole; canWrite: boolean };

interface ResolveTenantAccessOpts {
  /** Explicit tenant from the URL/query. Required when allowStaffOverride is true. */
  tenantId?: string;
  /** Opt-in per route. When false (default) staff get NO tenant access on this route. */
  allowStaffOverride?: boolean;
  /** Minimum agency role for the agency path (unchanged existing semantics). */
  minAgencyRole?: AgencyRole;
}

async function resolveTenantAccess(
  req: NextRequest,
  opts?: ResolveTenantAccessOpts,
): Promise<TenantAccess>; // throws AccessError({status}) on any failure
```

Resolution order and **security invariants** (each maps to a real foot-gun in the current code):

1. **Agency path is unchanged and evaluated first.** If the resolved claims are agency claims,
   behave exactly as today: `tenantId` comes ONLY from `claims.tenant_id`; if the route has a URL
   `:id`, it must equal `claims.tenant_id` or 403 (preserves
   `bandit/weights/[archetype]/route.ts:59-67`). An agency session can **never** supply a foreign
   `tenant_id` — the URL/query param is ignored for agency callers and the claim wins.

2. **Staff path is entered only when `claims.estalara_staff === true` AND
   `opts.allowStaffOverride === true`.** Both conditions are required; a route that does not opt in
   gets zero staff access (fail-closed). Staff status is read from verified claims
   (`resolveSsrSession`, `session-auth.ts:101-111`) or `verifyTracerAdminAuth`, **never** from the
   request body or an unverified header (mirrors `generation-model/route.ts:27-28`).

3. **The staff `tenant_id` must be validated against the `tenants` table** before any query runs.
   Unlike the agency path (where the claim guarantees a real tenant), the staff-supplied id is
   attacker-influenced input; resolve it against `tenants` and 404 if absent. Reuse the same lookup
   the Tenants hub uses.

4. **The returned `tenantId` is sourced from disjoint places per branch** and never mixed: agency ⇒
   `claims.tenant_id`; staff ⇒ the validated `opts.tenantId`. There is no code path where a staff
   session's `null` tenant flows into a query and no path where a URL id overrides an agency claim.

5. **Staff writes MUST NOT reuse the agency RLS token path.** A staff JWT has `tenant_id: null`, so
   `createTenantClient(session.rawToken)` would call `createTenantClient(undefined)` and **silently
   disable RLS** (`session-auth.ts:128-133`). Staff-path queries therefore use an explicit
   service-role client (`createAdminClient`, as `generation-model/route.ts:90` does) with a
   **mandatory `WHERE tenant_id = <validated id>` filter applied in the query itself**. Any staff
   route that forgets the explicit filter is a cross-tenant leak; this is the single highest-risk
   surface and every ported route's test suite MUST include a "staff query is tenant-filtered" case.

### 3. Audit trail: reuse `staff_audit_log`, log every staff write

The append-only `staff_audit_log` table already exists (`packages/db/src/schema/staff_audit_log.ts`)
with exactly the needed shape: `adminUserId`, `action`, `targetTenantId`, `targetUserId`, `payload`
(jsonb), `ipAddress`, `userAgent`, `createdAt`; service-role only, no RLS, 7-year retention. It
already anticipates staff-on-tenant actions in its example action list.

- **Every staff WRITE on tenant data appends one row** (`adminUserId = staff.sub`,
  `targetTenantId = validated tenant id`, `action = '<feature>.<verb>'`,
  `payload = { changed fields, before/after where cheap }`). This is done inside
  `resolveTenantAccess`'s caller, not the helper, so the action name is explicit per route.
- **Staff reads are NOT logged by default** — logging every read is noise and cost. Exception: reads
  of PII/chat-bearing surfaces (none ported in Phase 1; revisit if chat logging lands, per the
  tracer's D-2 stub `tracer/page.tsx:281-284`). See Open questions Q4.
- **Agency self-service actions are out of scope** for `staff_audit_log` (it is staff-only by
  contract). `GET /api/audit` today is a mock stub (`audit/route.ts:42-96`, `TODO Sprint 5`); wiring
  it to read `staff_audit_log` for a tenant is a Phase-2 item, not a blocker.

### 4. Read-only staff tier

Staff roles rank `estalara:superadmin (3) > estalara:ops (2) > estalara:readonly (1)`
(`middleware.ts:119-125`). Decision:

- **`estalara:readonly` ⇒ view-only** on every ported tenant feature (GET allowed, writes 403).
- **Writes require `estalara:ops` or higher (rank ≥ 2).** `resolveTenantAccess` sets
  `canWrite = STAFF_ROLE_RANK[role] >= 2`; write routes assert `canWrite` and 403 otherwise. The
  CEO's `estalara:superadmin` account satisfies this. (Whether the highest-risk writes — bandit
  weights, any future per-tenant model override — should be `superadmin`-only rather than `ops`+ is
  Q3.)

### 5. Global vs per-tenant settings surface

- `/admin/settings` = **platform-global** settings (the Phase-0 staff GET path + page being added in
  parallel; this ADR references it, does not redesign it).
- `/admin/tenants/[id]/settings` (or per-feature pages under that prefix) = **per-tenant** settings.

Enumeration of today's settings by scope:

| Setting                                | Scope today   | Store / route                                           |
| -------------------------------------- | ------------- | ------------------------------------------------------- |
| `generation_model`                     | GLOBAL        | `app_config` key; `generation-model/route.ts` (locked)  |
| `ALLOWED_GENERATION_MODELS` allow-list | GLOBAL/static | `lib/global-config-store`                               |
| Investor Quiz config                   | per-tenant    | `quiz/config/route.ts`, `tenants/[id]/answers`          |
| Demo Mode / mockup                     | per-tenant    | `demo/*` routes                                         |
| Archetype Simulator (demo override)    | per-tenant    | `demo/override/route.ts`                                |
| Site Detection config                  | per-tenant    | `detect` / `sdk-detect`                                 |
| Analytics (summary, lift)              | per-tenant    | `dashboard/analytics/*`                                 |
| Bandit weights (view + resume PATCH)   | per-tenant    | `ab/weights`, `tenants/[id]/bandit/weights/[archetype]` |
| Pilot dashboard / calibration          | per-tenant    | `pilot/*`                                               |
| Label management (conversion labels)   | per-tenant    | `admin/labels/*`                                        |
| Intent config                          | per-tenant    | `admin/intent/config/[id]`                              |
| LIA records                            | per-tenant    | `tenants/[id]/lia`                                      |

Only `generation_model` and the model allow-list are global. Everything a dashboard user touches is
per-tenant, so "control settings per-tenant" for staff = the URL-scoped ports below; "control
settings globally" = `/admin/settings` (Phase-0) plus, if Q1 is answered yes, a per-tenant
`generation_model` override layered on top with resolution order **tenant override > global > static
default**.

### 6. Rollout phasing (value/risk ordered)

Port read-only, low-risk features first; leave irreversible/high-blast-radius writes last.

- **Phase 1 — read-only staff visibility.** Analytics (summary + lift), Pilot dashboard, Site
  Detection view. All GET, all behind `resolveTenantAccess({ allowStaffOverride: true })` with
  `canWrite` unused. Tracer already shipped (ADR-0013) and is the template.
- **Phase 2 — per-tenant writes, medium risk.** Quiz config, Demo / Archetype Simulator, Label
  management, Intent config. Each write appends to `staff_audit_log`.
- **Phase 3 — high-risk writes, last.** Bandit weight PATCH (directly steers live adaptation) and —
  only if Q1 is answered yes — per-tenant `generation_model` override.

Phase-2 tickets for the PM to promote (listed here only; not written into `FOLLOW_UPS.md`):

- **FOLLOW-592** — `resolveTenantAccess` helper + discriminated-union types + ≥5-case test
  (agency-unchanged, staff-read, staff-write-role-gate, foreign-tenant-rejected-for-agency,
  staff-tenant-validated-against-table, staff-query-is-tenant-filtered) in `session-auth.ts`.
- **FOLLOW-593** — `/admin/tenants` hub + `/admin/tenants/[id]` landing; un-hide multi-tenant nav
  (ratifies §Decision 0).
- **FOLLOW-594** — Analytics read-only staff port (summary + lift accept staff + `tenant_id`).
- **FOLLOW-595** — Quiz config staff write port + audit-log wiring.
- **FOLLOW-596** — Demo / Archetype Simulator staff port.
- **FOLLOW-597** — Label management + Intent config staff port.
- **FOLLOW-598** — Bandit weight staff-write port (Phase 3, high risk).
- **FOLLOW-599** — Wire `GET /api/audit` (and a per-tenant admin audit view) to `staff_audit_log`,
  replacing the mock stub.
- **FOLLOW-600** — `/admin/tenants/[id]/settings` per-tenant settings surface; align with the
  Phase-0 `/admin/settings` global page.
- **FOLLOW-601** — Per-tenant `generation_model` override (BLOCKED on Q1; Phase 3).

## Consequences

**Positive**

- One access model (URL-scoped + `resolveTenantAccess`) for all staff-on-tenant actions; the tracer
  precedent generalizes instead of a second pattern being invented.
- Agency dashboard code paths are untouched; the agency session contract does not change, so no
  regression risk to existing tenant users.
- Shared components (tenantId-as-prop) mean zero page duplication between `/dashboard` and `/admin`.
- Every staff mutation is attributable and 7-year-retained via the existing `staff_audit_log`.

**Negative / risks**

- The staff write path bypasses RLS (service-role client), so correctness depends entirely on the
  explicit `WHERE tenant_id` filter (invariant 5). A forgotten filter is a cross-tenant leak — hence
  the mandatory per-route test case. This is the load-bearing risk of the whole ADR.
- Refactoring feature components to take `tenantId` as a prop touches many files; must be surgical.
- Un-hiding multi-tenant admin screens exposes registration/tenant/demo data that was previously
  navigationally dark; those pages must self-gate on the same staff auth.

**Reversibility**

- High. Each ported route is additive (staff branch behind `allowStaffOverride`); reverting is
  removing the opt-in. No schema change is required (the audit table and app_config already exist).
  The generation_model lock is untouched unless Q1 explicitly reverses it.

## Alternatives considered

1. **Un-block staff from `/dashboard/*` wholesale** (delete the `estalara_staff` rejection at
   `middleware.ts:226`). Rejected: a staff session has `tenant_id: null`, so every session-tenant
   API 401s (`analytics/summary/route.ts:170`, `ab/weights/route.ts:71`) and every RLS query
   silently runs with RLS disabled (`createTenantClient(undefined)`, `session-auth.ts:128-133`).
   This yields a dashboard that is either dead (401 everywhere) or unsafe (RLS off) — a half-wire.

2. **Give the superadmin account a `tenant_id`.** Rejected: it scopes the CEO to ONE tenant
   (defeating requirement (a), "every tenant"), collapses the staff/agency distinction that
   `resolveSsrSession` branches on (`session-auth.ts:101-126`), and would let staff-global settings
   like `generation_model` be reached through the tenant-admin path the lock was written to block
   (`generation-model/route.ts:12-17`).

3. **Session-side impersonation switch** (swap the effective tenant into the staff session).
   Rejected: audit-hostile (the session claims no longer reflect who is acting), invasive (ambient
   mutable "acting-as" state leaks across requests/tabs), and a superset of risk versus the
   URL-scoped param. The existing `staff_audit_log` even models `impersonation.started/ended` as a
   distinctly sensitive action — a signal that impersonation is heavyweight, not the default.

4. **Duplicate dashboard pages under `/admin`.** Rejected: doubles maintenance, guarantees drift
   between the two copies, and violates the surgical-change norm. Shared components parametrized by
   `tenantId` achieve the same reach with one implementation.

## Open questions for CEO

1. **Does `generation_model` gain a per-tenant override?** Two readings of "per-tenant AND
   globally":
   - **Narrow (recommended):** "per-tenant" means staff control of settings that are already
     per-tenant (quiz, demo, bandit, labels, intent); "globally" means `/admin/settings`. The
     2026-06-01 global-only lock on `generation_model` STANDS. No FOLLOW-601.
   - **Broad:** `generation_model` gains a per-tenant override with resolution order **tenant
     override > global > static default**, reversing the lock. This lets one tenant run a different
     model — an explicit cost/quality divergence per tenant. Only pursue if you want that.
2. **Ratify un-hiding the multi-tenant admin nav** (Registrations, Tenants list, Demo Sessions),
   reversing the 2026-06-15 "single-tenant v1" decision? (Your 2026-07-20 instruction implies yes;
   this ADR assumes yes in §Decision 0 unless you say otherwise.)
3. **Write tier:** confirm writes require `estalara:ops`+ (rank ≥ 2) with `estalara:readonly` as
   view-only — or should the highest-risk writes (bandit weights, any per-tenant model override) be
   restricted to `estalara:superadmin` only?
4. **Audit scope:** writes are always logged. Should staff READS of tenant data also be logged (all
   reads, or only PII/chat-bearing surfaces), given the 7-year retention cost?

## References

- ADR-0013 — tracer admin SSE auth + config read contract (the pattern this generalizes).
- `apps/control-plane/src/middleware.ts:119-125,226,286-333` — staff/agency role ranks and gates.
- `apps/control-plane/src/lib/session-auth.ts:100-133,151-196` — claim reconstruction, RLS-off
  foot-gun, existing session helpers.
- `apps/control-plane/src/lib/tracer-auth.ts:93-154` — `verifyTracerAdminAuth` staff paths.
- `apps/control-plane/src/app/admin/tenants/[id]/tracer/page.tsx:295-309` — URL-scoped tenant param
  precedent.
- `apps/control-plane/src/app/api/admin/generation-model/route.ts:6-17,90` — global-only lock,
  service-role client.
- `packages/db/src/schema/staff_audit_log.ts` — append-only staff audit table (reused as-is).
- `docs/MASTER_DESIGN.md` §E.7 (single experience, no tiers), §H.8/H.9 (consent/opt-out), §V.5
  (audit retention).
