# RLS Discovery Audit — Phase 2A Foundation

**Date:** 2026-05-18 **Ticket:** TICKET-RLS-001a **Author:** backend-engineer **Status:** Discovery
only — no production code changes

---

## SECTION 1 — Table Inventory

All 15 tables found in `packages/db/src/schema/`. No tables exist outside that directory.

### 1. `tenants`

- **File:** `packages/db/src/schema/tenants.ts`
- **tenant_id column:** No — this IS the tenant root row (`id` is the tenant UUID)
- **user_id / session_id:** No
- **agency_id / organization_id:** No
- **Foreign keys:** None (root entity; `tenant_registrations` references it via `registration_id`,
  not a FK constraint)
- **Row count estimate:** One row per agency customer — low cardinality (tens to hundreds at MVP)
- **RLS note in schema:** Not mentioned
- **RLS in migration:** Not applied in migration SQL. Policy present only in `rls-policies.sql`
  (manual-apply file)

### 2. `api_keys`

- **File:** `packages/db/src/schema/api_keys.ts`
- **tenant_id column:** Yes — `UUID NOT NULL`
- **user_id / session_id:** `created_by` (FK → `users.id`, nullable)
- **agency_id / organization_id:** No
- **Foreign keys:** None declared via Drizzle `.references()` (index on `tenant_id` only)
- **Row count estimate:** 2–10 rows per tenant (public + secret key pairs, rotation history)
- **RLS note in schema:** No
- **RLS in migration:** Not in migration SQL; policy in `rls-policies.sql` only

### 3. `consent_records`

- **File:** `packages/db/src/schema/consent_records.ts`
- **tenant_id column:** Yes — `UUID NOT NULL`
- **user_id / session_id:** `session_id TEXT NOT NULL` (anonymous fingerprint hash);
  `profile_id UUID` nullable (future Profile Mode)
- **agency_id / organization_id:** No
- **Foreign keys:** None declared (no `.references()`)
- **Row count estimate:** Up to thousands per tenant per month (one per consent event per session)
- **RLS note in schema:** No
- **RLS in migration:** Not in migration SQL; policy in `rls-policies.sql` only

### 4. `demo_sessions`

- **File:** `packages/db/src/schema/demo_sessions.ts`
- **tenant_id column:** Yes — `UUID NOT NULL`
- **user_id / session_id:** `created_by UUID NOT NULL` (FK → `users.id`)
- **agency_id / organization_id:** No
- **Foreign keys:** No `.references()` declared; `created_by` conceptually references `users`
- **Row count estimate:** Low — a few active sessions per tenant at any time
- **RLS note in schema:** No
- **RLS in migration:** Not applied (migration 0001 creates the table, no ENABLE ROW LEVEL SECURITY)

### 5. `users`

- **File:** `packages/db/src/schema/users.ts`
- **tenant_id column:** Yes — `UUID` nullable (null for Estalara staff)
- **user_id / session_id:** The row itself is the user identity
- **agency_id / organization_id:** No
- **Foreign keys:** None declared via `.references()`
- **Row count estimate:** 1–20 per tenant (agency staff)
- **RLS note in schema:** No
- **RLS in migration:** Not in migration SQL; policy in `rls-policies.sql` only

### 6. `session_embeddings`

- **File:** `packages/db/src/schema/session_embeddings.ts`
- **tenant_id column:** Yes — `UUID NOT NULL`
- **user_id / session_id:** `session_id TEXT NOT NULL` (SHA-256 anonymous fingerprint)
- **agency_id / organization_id:** No
- **Foreign keys:** No `.references()` declared
- **Row count estimate:** One per anonymous visitor session — potentially millions per large tenant
  over time
- **RLS note in schema:** Comment says "Foreign key → tenants.id (RLS scope)"
- **RLS in migration:** Not applied (migration 0002 creates the table, no ENABLE ROW LEVEL SECURITY)

### 7. `archetype_embeddings`

- **File:** `packages/db/src/schema/archetype_embeddings.ts`
- **tenant_id column:** No
- **user_id / session_id:** No
- **agency_id / organization_id:** No
- **Foreign keys:** None
- **Row count estimate:** 3–10 rows (one per named archetype — investor, family, neutral, etc.)
- **RLS note in schema:** Comment says "cross-tenant, DP-protected aggregate embeddings"
- **RLS in migration:** Not applicable — no tenant_id

### 8. `ab_bandit_weights`

- **File:** `packages/db/src/schema/ab_bandit_weights.ts`
- **tenant_id column:** Yes — `UUID NOT NULL` (part of primary key)
- **user_id / session_id:** No
- **agency_id / organization_id:** No
- **Foreign keys:** `tenant_id` → `tenants.id` ON DELETE CASCADE
- **Row count estimate:** 18 rows per tenant at seeding (6 archetypes × 3 variants), grows with
  experiment variants
- **RLS note in schema:** "RLS: tenant can read/write only its own rows (see migration SQL)"
- **RLS in migration:** APPLIED in migration 0004 — `ENABLE ROW LEVEL SECURITY` + policy present

### 9. `answers`

- **File:** `packages/db/src/schema/answers.ts`
- **tenant_id column:** Yes — `UUID NOT NULL`
- **user_id / session_id:** No
- **agency_id / organization_id:** No
- **Foreign keys:** `tenant_id` → `tenants.id` ON DELETE CASCADE
- **Row count estimate:** Variable — hundreds to thousands per tenant (agency FAQ content per
  listing)
- **RLS note in schema:** "RLS: each tenant can only read/write its own rows (tenant_isolation
  policy)"
- **RLS in migration:** APPLIED in migration 0006 — `ENABLE ROW LEVEL SECURITY` + policy present

### 10. `schema_validation_history`

- **File:** `packages/db/src/schema/schema_validation_history.ts`
- **tenant_id column:** Yes — `UUID NOT NULL`
- **user_id / session_id:** No
- **agency_id / organization_id:** No
- **Foreign keys:** `tenant_id` → `tenants.id` ON DELETE CASCADE
- **Row count estimate:** One per tenant per cron run — ~365 rows per tenant per year
- **RLS note in schema:** "RLS: tenant can SELECT their own rows; service role can INSERT"
- **RLS in migration:** APPLIED in migration 0008 — `ENABLE ROW LEVEL SECURITY` + SELECT-only policy

### 11. `tenant_compliance_records`

- **File:** `packages/db/src/schema/tenant_compliance_records.ts`
- **tenant_id column:** Yes — `UUID NOT NULL`
- **user_id / session_id:** No (signatory stored as `signed_by_name`, `signed_by_email` plain text)
- **agency_id / organization_id:** No
- **Foreign keys:** `tenant_id` → `tenants.id` ON DELETE CASCADE
- **Row count estimate:** A few rows per tenant (one LIA per compliance review cycle, never deleted)
- **RLS note in schema:** "RLS: tenant can SELECT only its own rows; only the backend service role
  can INSERT/UPDATE"
- **RLS in migration:** APPLIED in migration 0009 — `ENABLE ROW LEVEL SECURITY` + SELECT-only policy

### 12. `dsr_verifications`

- **File:** `packages/db/src/schema/dsr_verifications.ts`
- **tenant_id column:** Yes — `UUID NOT NULL`
- **user_id / session_id:** `session_id TEXT NOT NULL`
- **agency_id / organization_id:** No
- **Foreign keys:** `tenant_id` → `tenants.id` ON DELETE CASCADE
- **Row count estimate:** Low — a few records per tenant per year (DSR requests are rare)
- **RLS note in schema:** "RLS: tenant_isolation policy applied via migration SQL"
- **RLS in migration:** APPLIED in migration 0011 — `ENABLE ROW LEVEL SECURITY` + full FOR ALL
  policy

### 13. `tenant_registrations`

- **File:** `packages/db/src/schema/tenant_registrations.ts`
- **tenant_id column:** `tenant_id UUID` nullable (set after approval, not a scope column)
- **user_id / session_id:** No
- **agency_id / organization_id:** No
- **Foreign keys:** None declared
- **Row count estimate:** Low — one per prospective agency, historically retained
- **RLS note in schema:** "This table is accessed via service role only (no RLS)"
- **RLS in migration:** Not applied

### 14. `tenant_site_schemas`

- **File:** `packages/db/src/schema/tenant_site_schemas.ts`
- **tenant_id column:** Yes — `UUID NOT NULL`
- **user_id / session_id:** No
- **agency_id / organization_id:** No
- **Foreign keys:** `tenant_id` → `tenants.id` ON DELETE CASCADE
- **Row count estimate:** One per (tenant, domain) pair — typically 1–3 per tenant
- **RLS note in schema:** "RLS: tenant_isolation policy applied via migration SQL"
- **RLS in migration:** Not applied (migration 0003 creates the table but contains NO ENABLE ROW
  LEVEL SECURITY or policy)

### 15. `staff_audit_log`

- **File:** `packages/db/src/schema/staff_audit_log.ts`
- **tenant_id column:** `target_tenant_id UUID` nullable (not a scope column — audit touches any
  tenant)
- **user_id / session_id:** `admin_user_id UUID NOT NULL`
- **agency_id / organization_id:** No
- **Foreign keys:** None declared
- **Row count estimate:** Grows continuously — 7-year retention (GDPR Art. 30); could be millions
- **RLS note in schema:** "RLS is NOT enabled — accessed exclusively via service role (Estalara
  staff only)"
- **RLS in migration:** Intentionally absent

---

## SECTION 2 — Classification Per Table

| Table                       | Category  | Rationale                                                                                                                                                                                |
| --------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenants`                   | **CAT-A** | The root tenant identity row. Agency users must see only their own tenant config. Cross-tenant read = immediate security incident.                                                       |
| `api_keys`                  | **CAT-A** | Tenant-scoped credentials. A leaked key from another tenant enables full API access under a different agency's account.                                                                  |
| `consent_records`           | **CAT-A** | Tenant-scoped legal records of user consent. Cross-tenant read = compliance violation (GDPR Art. 5 accountability).                                                                      |
| `demo_sessions`             | **CAT-A** | Tenant-scoped operational data. Demo tokens from one tenant could be replayed to impersonate another if cross-readable.                                                                  |
| `users`                     | **CAT-A** | Agency staff accounts. Staff of tenant A must not read staff list or credentials of tenant B.                                                                                            |
| `session_embeddings`        | **CAT-D** | Anonymous behavioral data (no PII per design decision D3). Needs tenant-scoped writes, but the shared classifier in Phase 2 requires cross-tenant service_role reads for ML aggregation. |
| `archetype_embeddings`      | **CAT-B** | Global, cross-tenant reference data. All tenants share the same archetype space. No tenant isolation needed. Updated by ML job (service role).                                           |
| `ab_bandit_weights`         | **CAT-A** | Tenant-specific A/B experiment state. Leaking weights to competitor tenants exposes private experimentation data and conversion rates. RLS already applied.                              |
| `answers`                   | **CAT-A** | Proprietary agency FAQ content, per-listing. A tenant's answers are confidential business content. RLS already applied.                                                                  |
| `schema_validation_history` | **CAT-A** | Tenant-specific operational history. Exposes which selectors broke and when — competitive intelligence risk. SELECT-only RLS already applied.                                            |
| `tenant_compliance_records` | **CAT-A** | GDPR compliance documents (LIA). Cross-tenant read = serious compliance breach. SELECT-only RLS already applied.                                                                         |
| `dsr_verifications`         | **CAT-A** | OTP tokens for GDPR Data Subject Rights. A cross-tenant read could expose active DSR OTP hashes. RLS already applied.                                                                    |
| `tenant_registrations`      | **CAT-C** | Pre-approval admin workflow. Contains contact PII (name, email, phone) for agencies not yet onboarded. Service role only — no tenant can read this table.                                |
| `tenant_site_schemas`       | **CAT-A** | Tenant-specific auto-detected CSS selectors. Exposes proprietary site structure analysis. RLS declared in schema comment but NOT applied in migration.                                   |
| `staff_audit_log`           | **CAT-C** | Internal audit trail across all tenants. Intentionally admin-only, append-only. No tenant should ever read this.                                                                         |

---

## SECTION 3 — Code Access Pattern Analysis (CAT-A Tables Only)

### 3.1 `tenants`

**Read paths:**

- `POST /api/tenants` — inserts via `createAdminClient()` (service role)
- `apps/control-plane/src/app/api/config/route.ts` — stub only, does NOT yet query the table (TODO
  Sprint 5 comment present)
- Decision API adapt route receives `consent_required` from the request body (passed by the
  SDK/control plane), not from a direct DB query
- `apps/decision-api` does NOT currently query `tenants` directly

**Write paths:**

- `POST /api/tenants` — `createAdminClient()` — bypasses RLS intentionally (admin op)

**tenant_id filter in WHERE:** N/A for reads (table IS the tenant). Admin reads fetch by `slug` or
`id` — both are fine for admin-role queries.

**Pre-RLS bug risk:** `GET /api/config` is a stub using `x-tenant-id` from header — does not yet
query DB. When this is implemented (Sprint 5 TODO), it MUST use `createTenantClient()` with JWT, not
`createAdminClient()`. If implemented with admin client, an attacker could fetch any tenant's config
by forging the `x-tenant-id` header.

**RLS policy in `rls-policies.sql`:** Present — `id = (auth.jwt() ->> 'tenant_id')::uuid`. **Not
applied via any migration.** Manual-apply file only.

### 3.2 `api_keys`

**Read paths:**

- No active route handler currently queries `api_keys` (key verification happens in `packages/auth`)
- `packages/auth` presumably hashes incoming keys and looks them up by `hashed_key` (global unique
  index) — inherently tenant-isolated by hash match, but no RLS

**Write paths:**

- No active route handler was found that inserts into `api_keys` in the current codebase (key
  creation is mentioned in Sprint planning but not yet implemented)

**tenant_id filter in WHERE:** Auth lookup is by `hashed_key` unique index — inherently safe. But
without RLS a compromised service could enumerate all keys for all tenants.

**Pre-RLS bug risk:** Key enumeration queries (future admin panel: "list all keys for tenant X")
will need RLS to prevent returning keys from tenant Y.

**RLS policy in `rls-policies.sql`:** Present — `tenant_id = (auth.jwt() ->> 'tenant_id')::uuid`.
**Not applied via any migration.**

### 3.3 `consent_records`

**Read paths:**

- `apps/control-plane/src/app/api/dsr/erase/route.ts` — deletes by `session_id` using
  `createAdminClient()` (service role, within a DSR transaction)
- `apps/control-plane/src/app/api/dsr/access/route.ts` — presumably reads by `session_id` +
  `tenant_id`
- `apps/control-plane/src/app/api/dsr/portability/route.ts` — presumably reads by `session_id` +
  `tenant_id`

**Write paths:**

- Ingest Worker writes consent events (via Redpanda consumer downstream, not directly in this app)
- `dsr/erase` deletes records using `createAdminClient()` — bypass is intentional for the OTP-gated
  DSR flow

**tenant_id filter:** `dsr/erase` deletes only by `session_id` (line 171:
`eq(consentRecords.sessionId, record.sessionId)`) — **does NOT filter by tenant_id**. Since
`record.tenantId` is available at that point, this is a pre-RLS bug: if two tenants somehow share a
`session_id` (improbable but not impossible), erase would delete records from both.

**Pre-RLS bug risk:** `dsr/erase` consent_records delete does not include `tenant_id` in WHERE
clause.

**RLS policy in `rls-policies.sql`:** Present. **Not applied via any migration.**

### 3.4 `demo_sessions`

**Read paths:**

- `GET /api/demo/sessions` — uses `createAdminClient()`, filters by
  `eq(demoSessions.tenantId, tenantId)` from JWT. Application-level isolation only.
- `GET /api/demo/sessions/[id]/revoke` — presumably filters by `id` + `tenantId`

**Write paths:**

- `POST /api/demo/sessions` — uses `createAdminClient()`, inserts with `tenantId` from JWT
- The revoke route likely updates by `id` + `tenantId`

**tenant_id filter:** Present in application WHERE clauses (`eq(demoSessions.tenantId, tenantId)`).
However, uses `createAdminClient()` — no database-level enforcement.

**Pre-RLS bug risk:** Relies entirely on application-layer JWT extraction being correct. If
`requireTenantAccess()` has a bug or is bypassed, any authenticated user could read or create demo
sessions for any tenant.

**RLS policy:** Not present in `rls-policies.sql` or any migration. **No RLS policy exists for this
table anywhere in the codebase.**

### 3.5 `users`

**Read paths:**

- No active route handler was found that queries the `users` table directly
- Auth package (`packages/auth`) likely queries it for login verification — not visible in this
  audit scope

**Write paths:**

- No active route handler was found

**tenant_id filter:** Cannot assess from current codebase — auth package not audited here.

**Pre-RLS bug risk:** Unknown. The `users` table has the most sensitive data (staff contact info,
login state, sudo timestamps). Any future admin panel listing users must enforce RLS.

**RLS policy in `rls-policies.sql`:** Present — compound policy allowing `tenant_id` match OR
`estalara_staff = true`. **Not applied via any migration.**

### 3.6 `session_embeddings`

**Read paths:**

- `POST /api/dsr/initiate` — queries via `createAdminClient()`, filters by `session_id` AND
  `tenant_id` (correct)
- `POST /api/dsr/erase` — deletes via `createAdminClient()`, filters by `session_id` AND `tenant_id`
  (correct)
- `POST /api/dsr/access` — reads via `createAdminClient()`, presumably filters by `session_id` +
  `tenant_id`
- `POST /api/dsr/portability` — reads via `createAdminClient()`, presumably filters by
  `session_id` + `tenant_id`
- ML intent engine (Modal, service role) — cross-tenant read for shared classifier (Phase 2A
  requirement)

**Write paths:**

- Downstream Redpanda consumer (not in control-plane codebase) writes new session embeddings
- `dsr/erase` deletes rows for data subject erasure

**tenant_id filter:** Present in DSR routes. ML reads require service_role bypass.

**Pre-RLS bug risk:** None found in current DSR code. Future intent engine reads must use
service_role.

**RLS policy:** Not present anywhere. Classified CAT-D — policy direction in Section 5.

### 3.7 `ab_bandit_weights` (RLS already applied in migration 0004)

**Read paths:**

- `GET /api/ab/weights` — uses `createTenantClient(rawToken)` with `db.rls()` wrapper — **correctly
  propagates JWT for RLS**
- Decision API (`apps/decision-api/src/lib/ab-assignment.ts`) — reads from Redpanda/Redis, not
  direct DB query in the hot path
- `lib/bandit-seed.ts` — seeds initial rows via `createAdminClient()`

**Write paths:**

- `PATCH /api/tenants/:id/bandit/weights/:archetype` — uses `createTenantClient(rawToken)` with
  `db.rls()` wrapper — **correctly propagates JWT**
- `lib/bandit-seed.ts` — inserts via `createAdminClient()` (correct for seeding)

**tenant_id filter:** Application-level AND RLS-level. The `db.rls()` pattern is correctly used here
— this is the reference implementation for other CAT-A tables.

**Pre-RLS bug risk:** None found. This table is the most correctly implemented.

### 3.8 `answers` (RLS already applied in migration 0006)

**Read paths:**

- `GET /api/tenants/:id/answers` — uses `createAdminClient()`, filters by `tenant_id` AND
  `listing_id` in WHERE. **Does NOT use createTenantClient or db.rls() — bypasses RLS.**
- `lib/rag-retrieval.ts` — raw SQL query via `createAdminClient()`, filters by `tenant_id` in WHERE
  clause — **correct filter but bypasses RLS**

**Write paths:**

- `POST /api/tenants/:id/answers` — uses `createAdminClient()`, inserts with `tenantId` from
  JWT-verified claims
- `PUT /api/tenants/:id/answers/:answerId` — presumably updates via `createAdminClient()`
- `DELETE /api/tenants/:id/answers/:answerId` — presumably deletes via `createAdminClient()`

**tenant_id filter:** Present in application WHERE clauses. But `createAdminClient()` bypasses the
RLS policy that was applied in migration 0006 — so the RLS on `answers` is currently unused. The
database enforces RLS, but the application never reaches it because the connection uses service
role.

**Pre-RLS bug risk:** RLS is applied at DB level but bypassed by the application. The existing WHERE
filters provide application-level isolation only.

### 3.9 `schema_validation_history` (SELECT-only RLS applied in migration 0008)

**Read paths:**

- Dashboard `site-health` panel (Sprint 10, TICKET-VAL-002) — not yet implemented
- Not currently queried by any route handler in the audited codebase

**Write paths:**

- `apps/data-quality` Python cron runs as service role (bypasses RLS correctly per migration intent)

**tenant_id filter:** N/A (no current read paths).

**Pre-RLS bug risk:** None currently. When dashboard panel is implemented, must use
`createTenantClient()` + `db.rls()`.

### 3.10 `tenant_compliance_records` (SELECT-only RLS applied in migration 0009)

**Read paths:**

- `GET /api/tenants/:id/lia` — uses `createAdminClient()`, filters by `tenant_id` AND `record_type`
  — **bypasses RLS**
- `GET /api/tenants/:id/lia/:recordId` — presumably reads via `createAdminClient()`

**Write paths:**

- `POST /api/tenants/:id/lia` — uses `createAdminClient()` — bypasses RLS (correct per migration
  intent: "only backend service role can INSERT")

**tenant_id filter:** Present in application WHERE clauses. Same bypass pattern as `answers`.

**Pre-RLS bug risk:** Same as `answers` — RLS is live in DB but bypassed by application.
Application-layer auth provides the current isolation.

### 3.11 `dsr_verifications` (Full FOR ALL RLS applied in migration 0011)

**Read paths:**

- `POST /api/dsr/erase` — queries by `otp_hash` alone (no `tenant_id` filter). Uses
  `createAdminClient()` — bypasses RLS. The OTP hash provides a cryptographic guarantee here (hash
  is globally unique), but bypassing RLS means a compromised service key could enumerate all DSR
  records across all tenants.
- `POST /api/dsr/access` and `POST /api/dsr/portability` — similar patterns

**Write paths:**

- `POST /api/dsr/initiate` — inserts via `createAdminClient()`, sets `tenantId` in values

**tenant_id filter:** Missing in the erase route's lookup query (intentional — lookup by OTP hash is
the security mechanism). Not a bug per se, but worth noting that the app bypasses the RLS that was
applied.

**Pre-RLS bug risk:** Minimal for the OTP-based flow. However, `createAdminClient()` means the
service role has unlimited cross-tenant access — the RLS in migration 0011 only applies when
`authenticated` role is used, not service role.

### 3.12 `tenant_site_schemas`

**Read paths:**

- `lib/tenant-schema.ts` `lookupSchemaFromDb()` — uses `createAdminClient()`, filters by `tenantId`
  in WHERE
- Decision API `apps/decision-api/src/lib/reorder.ts` `getTenantSchema()` — reads via Redis cache →
  HTTP to SCHEMA_API_URL (not direct DB)

**Write paths:**

- `POST /api/detect` — uses `createAdminClient()`, upserts with `tenantId` in values
- `POST /api/internal/schema` — presumably upserts via `createAdminClient()`

**tenant_id filter:** Present in application WHERE clauses. `createAdminClient()` used throughout.

**Pre-RLS bug risk:** RLS declared in schema file comment but NOT applied in any migration (the
biggest gap found — see Section 5). Currently relies on application-layer WHERE filters only.

---

## SECTION 4 — Supabase Auth Context Analysis

### How tenant_id is passed in auth context

The JWT claim extraction uses two different patterns, depending on migration age:

**Pattern A — `auth.jwt()` (Supabase built-in, used in `rls-policies.sql` and migrations 0004,
0006):**

```sql
tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
```

**Pattern B — `current_setting('request.jwt.claims', true)` (Supabase v2 recommended, used in
migration 0011):**

```sql
tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid
```

These are functionally equivalent in Supabase but the patterns are inconsistent across migrations.
Migration 0011 (`dsr_verifications`) uses the `current_setting` pattern, which matches the CLAUDE.md
architectural pattern spec. Migrations 0004, 0006 use `auth.jwt()`. This inconsistency is a minor
hygiene issue.

### Existing RLS policies — actual state as of this audit

| Table                       | ENABLE ROW LEVEL SECURITY | Policy Created                                                           | Migration |
| --------------------------- | ------------------------- | ------------------------------------------------------------------------ | --------- |
| `ab_bandit_weights`         | YES                       | YES (FOR ALL)                                                            | 0004      |
| `answers`                   | YES                       | YES (FOR ALL)                                                            | 0006      |
| `schema_validation_history` | YES                       | YES (FOR SELECT only)                                                    | 0008      |
| `tenant_compliance_records` | YES                       | YES (FOR SELECT only)                                                    | 0009      |
| `dsr_verifications`         | YES                       | YES (FOR ALL)                                                            | 0011      |
| `tenants`                   | NO                        | In `rls-policies.sql` only — NOT in any migration                        | —         |
| `api_keys`                  | NO                        | In `rls-policies.sql` only — NOT in any migration                        | —         |
| `consent_records`           | NO                        | In `rls-policies.sql` only — NOT in any migration                        | —         |
| `users`                     | NO                        | In `rls-policies.sql` only — NOT in any migration                        | —         |
| `demo_sessions`             | NO                        | Nowhere                                                                  | —         |
| `session_embeddings`        | NO                        | Nowhere                                                                  | —         |
| `tenant_site_schemas`       | NO                        | Nowhere (comment says "via migration SQL" but migration 0003 has no RLS) | —         |
| `tenant_registrations`      | NO                        | Intentionally absent                                                     | —         |
| `staff_audit_log`           | NO                        | Intentionally absent                                                     | —         |
| `archetype_embeddings`      | NO                        | Not needed (CAT-B)                                                       | —         |

### `rls-policies.sql` status

The file `packages/db/src/schema/rls-policies.sql` contains 5 policies for `tenants`, `users`,
`api_keys`, and `consent_records`. This file has a comment "applied manually in Supabase Dashboard
or via migration." There is no evidence it has been applied — no migration references it, no CI step
runs it, and no Supabase migration history includes it.

**This file may be entirely unapplied against production Postgres.**

### Roles defined

Based on Supabase conventions and codebase analysis:

- `authenticated` — Supabase JWT-verified role. All tenant-facing policies use this.
- `anon` — public, unauthenticated. No policies grant anon access to any table.
- `service_role` — bypasses RLS by Supabase design. `createAdminClient()` uses `DATABASE_URL_ADMIN`
  which is presumed to be the service role connection.

The `createTenantClient()` implementation in `packages/db/src/client.ts` uses `DATABASE_URL` (not
`DATABASE_URL_ADMIN`). When `jwtToken` is provided, it sets `request.jwt` via `set_config` inside a
transaction, enabling RLS policies that read `auth.jwt()` or `current_setting('request.jwt')`.
**This mechanism is correct but requires the database connection to be under the `authenticated`
role, not `service_role`.**

The code comment in `lib/tenant.ts` says: "NOTE: jwtToken propagation ... is a follow-up concern
(TICKET-024+). For now the client uses the anon role connection with tenant_id available from the
context." This confirms that `getTenantDb()` currently does NOT pass a JWT, meaning
`createTenantClient()` called without a token is a pass-through with no RLS enforcement.

---

## SECTION 5 — Recommendations

### 1. Confirmed CAT-A count — is the Council's "5 tables" estimate accurate?

**No. The actual CAT-A count is 10 tables, not 5.**

| #   | Table                       | Currently has RLS in DB?                                   |
| --- | --------------------------- | ---------------------------------------------------------- |
| 1   | `tenants`                   | No (only in unapplied .sql file)                           |
| 2   | `api_keys`                  | No (only in unapplied .sql file)                           |
| 3   | `consent_records`           | No (only in unapplied .sql file)                           |
| 4   | `demo_sessions`             | No (no policy exists anywhere)                             |
| 5   | `users`                     | No (only in unapplied .sql file)                           |
| 6   | `ab_bandit_weights`         | **Yes — migration 0004**                                   |
| 7   | `answers`                   | **Yes — migration 0006**                                   |
| 8   | `schema_validation_history` | **Yes — migration 0008**                                   |
| 9   | `tenant_compliance_records` | **Yes — migration 0009**                                   |
| 10  | `dsr_verifications`         | **Yes — migration 0011**                                   |
| 11  | `tenant_site_schemas`       | No (comment says "via migration" but migration has no RLS) |

The Council likely estimated "5 tables" by looking at what has NOT yet been done. The actual
implementation gap is larger: 5 CAT-A tables have zero RLS applied anywhere (`tenants`, `api_keys`,
`consent_records`, `demo_sessions`, `tenant_site_schemas`), and 1 table has no policy anywhere in
the repo (`demo_sessions`).

Additionally, 5 tables have RLS applied at DB level but bypassed by the application through
`createAdminClient()` — these are technically protected at DB layer but not enforced by current app
code.

### 2. Per-table policy direction for tables without RLS (SQL pseudo-code)

**`tenants`** — tenant sees only their own row:

```sql
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenants: tenant isolation"
  ON tenants FOR ALL TO authenticated
  USING (id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid)
  WITH CHECK (id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid);
```

**`api_keys`** — tenant sees only their own keys:

```sql
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "api_keys: tenant isolation"
  ON api_keys FOR ALL TO authenticated
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid);
```

**`consent_records`** — tenant sees only their own records:

```sql
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "consent_records: tenant isolation"
  ON consent_records FOR ALL TO authenticated
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid);
```

**`demo_sessions`** — tenant sees only their own sessions:

```sql
ALTER TABLE demo_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "demo_sessions: tenant isolation"
  ON demo_sessions FOR ALL TO authenticated
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid);
```

**`users`** — agency users see only their tenant's users; staff see all:

```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users: tenant isolation for agency"
  ON users FOR ALL TO authenticated
  USING (
    tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid
    OR (current_setting('request.jwt.claims', true)::json ->> 'estalara_staff')::boolean = true
  )
  WITH CHECK (
    tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid
    OR (current_setting('request.jwt.claims', true)::json ->> 'estalara_staff')::boolean = true
  );
```

**`tenant_site_schemas`** — tenant sees only their own schemas:

```sql
ALTER TABLE tenant_site_schemas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_site_schemas: tenant isolation"
  ON tenant_site_schemas FOR ALL TO authenticated
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid);
```

**`session_embeddings`** (CAT-D) — tenant-scoped writes, service_role for ML reads:

```sql
ALTER TABLE session_embeddings ENABLE ROW LEVEL SECURITY;
-- Tenant authenticated role: read/write own rows only
CREATE POLICY "session_embeddings: tenant isolation"
  ON session_embeddings FOR ALL TO authenticated
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid);
-- service_role bypasses RLS by Supabase default — ML aggregation reads work without a separate policy
```

### 3. Code paths needing fixes BEFORE RLS enforcement

When RLS is enabled and application code switches from `createAdminClient()` to
`createTenantClient()`, the following code paths will be affected:

**Priority 1 — Pre-RLS bugs that could cause silent breakage on RLS enablement:**

- `apps/control-plane/src/app/api/demo/sessions/route.ts` — `GET` handler uses
  `createAdminClient()`. When RLS is enabled on `demo_sessions`, switching to
  `createTenantClient()` + `db.rls()` is required. The JWT token must be forwarded from the request.
- `apps/control-plane/src/app/api/dsr/erase/route.ts` (line 171) — `consent_records` delete uses
  only `sessionId` in WHERE, missing `tenantId`. Add `eq(consentRecords.tenantId, record.tenantId)`
  to the delete condition regardless of RLS (defense in depth).
- `apps/control-plane/src/app/api/detect/route.ts` — `tenant_site_schemas` upsert uses
  `createAdminClient()`. Once `tenant_site_schemas` has RLS, if the detect endpoint is ever called
  with an `authenticated` connection, the upsert would fail unless `tenantId` is in the JWT. Current
  admin client usage is acceptable — but the TODO Sprint 8 rate-limiting guard mentioned in the code
  needs to be aware of RLS.
- `apps/control-plane/src/lib/tenant.ts` — `getTenantDb()` calls `createTenantClient()` without a
  JWT token. The comment says "jwtToken propagation is a follow-up concern (TICKET-024+)." This
  means ALL callers of `getTenantDb()` currently get RLS pass-through, not enforcement.

**Priority 2 — Consistent pattern adoption:**

- `apps/control-plane/src/app/api/tenants/[id]/answers/route.ts` — POST and GET use
  `createAdminClient()`. These routes verify JWT tenant match at application layer. After RLS is
  live, switching to `createTenantClient()` + `db.rls()` would provide belt-and-suspenders
  protection.
- `apps/control-plane/src/app/api/tenants/[id]/lia/route.ts` — Same pattern as `answers`.
- `apps/control-plane/src/lib/rag-retrieval.ts` — Uses `createAdminClient()` for RAG query, applies
  WHERE tenant_id filter. Acceptable as a service-role internal call, but should be documented as
  intentional bypass.

**Priority 3 — JWT propagation gap (TICKET-024+):**

The `withJwt()` / `db.rls()` mechanism exists and works correctly (evidenced by `ab/weights` and
`bandit/weights` routes). The problem is that `getTenantDb()` in `lib/tenant.ts` creates a client
without a JWT — meaning any Server Component that calls `getTenantDb()` bypasses RLS. This needs
TICKET-024+ resolution before RLS on CAT-A tables provides meaningful protection.

### 4. Service-role exemptions needed for ML/aggregation/admin

The following operations legitimately require service_role (bypassing RLS):

| Operation                                 | Table                                                        | Justification                                      |
| ----------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| ML intent engine cross-tenant aggregation | `session_embeddings`                                         | Shared classifier needs all-tenant view            |
| Archetype embedding updates               | `archetype_embeddings`                                       | Global table, no tenant isolation                  |
| Daily schema validation cron              | `schema_validation_history`                                  | Cron writes all tenants' validation history        |
| DSR erase (OTP-gated)                     | `dsr_verifications`, `session_embeddings`, `consent_records` | OTP is the auth mechanism, not JWT                 |
| Tenant creation                           | `tenants`, `ab_bandit_weights`                               | Admin-only bootstrapping                           |
| Bandit weight seeding                     | `ab_bandit_weights`                                          | New tenant setup, no JWT context yet               |
| LIA record creation                       | `tenant_compliance_records`                                  | Service layer enforces data quality, not tenant UI |
| Site schema upsert from auto-detect       | `tenant_site_schemas`                                        | Detect endpoint runs as backend service            |

All of these use `createAdminClient()` which reads `DATABASE_URL_ADMIN` — the Supabase service role
connection. Supabase service_role bypasses RLS by default. No explicit policies are needed for
INSERT/UPDATE for service_role callers.

### 5. Estimated implementation effort for RLS-001b

Based on this audit, RLS-001b (actual implementation) involves:

**Migrations to write: 3**

- Migration for `tenants`, `api_keys`, `consent_records`, `users` (the 4 tables with policies in
  `rls-policies.sql` that were never migrated)
- Migration for `demo_sessions` (no policy exists anywhere)
- Migration for `tenant_site_schemas` (migration 0003 is missing the RLS block)

**Code changes required:**

- Fix `consent_records` delete in `dsr/erase` (add `tenant_id` filter) — 1 line
- Fix `demo_sessions` GET route to use `createTenantClient()` + `db.rls()` — ~10 lines
- Decide whether `answers`, `lia`, `tenant-schema` admin routes should switch to
  `createTenantClient()` — requires JWT forwarding from route handlers

**JWT propagation (the hard part):** The `createTenantClient()` without JWT issue (TICKET-024+) is
the systemic blocker. Enabling RLS on `tenants`, `users`, `api_keys` without fixing JWT propagation
in `getTenantDb()` would break every Server Component that calls `getTenantDb()`. This may be the
largest effort item.

**Total estimate:** 3–5 days of focused backend work. 1 day for migrations, 1–2 days for code fixes,
1–2 days for JWT propagation resolution and testing.

### 6. Risks Piotr should know before implementation

**Risk 1 — `rls-policies.sql` may be entirely unapplied in production** If the file has never been
run against Supabase, then `tenants`, `api_keys`, `consent_records`, and `users` have NO RLS at the
database level right now. The Phase 2A trust floor requires knowing whether the production Supabase
instance has these policies. A direct check via Supabase Dashboard (Authentication > Policies) or
`SELECT * FROM pg_policies` is needed before implementation begins.

**Risk 2 — Enabling RLS on `tenants` will break `getTenantDb()` callers** `getTenantDb()` does not
pass a JWT. Any code that uses `getTenantDb()` to query `tenants` will return 0 rows once RLS is
enabled — a silent, hard-to-debug failure. This must be resolved (TICKET-024+) before enabling RLS
on `tenants`.

**Risk 3 — `ab_bandit_weights` and `answers` have RLS in DB but app bypasses it** These tables have
RLS but `answers` routes use `createAdminClient()`. If someone audits the DB and sees RLS is "on"
for `answers`, they may incorrectly assume it's enforced end-to-end. Document clearly which tables
have DB-level RLS but application-layer bypass.

**Risk 4 — `auth.jwt()` vs `current_setting` inconsistency** Migrations 0004/0006 use `auth.jwt()`
while migration 0011 uses `current_setting('request.jwt.claims', true)`. New migrations should
standardize on `current_setting` (matches CLAUDE.md spec). The old policies work in Supabase but
create maintenance confusion.

**Risk 5 — Phase 2 shared classifier and `session_embeddings`** The DECISIONS_2026-05-18 shared
classifier model requires cross-tenant reads of `session_embeddings`. Adding strict tenant RLS to
this table (even CAT-D with authenticated-only scoping) does not block service_role — but if any
future code uses `createTenantClient()` to query embeddings for ML purposes, it would silently
return only that tenant's data. Document the service_role exemption explicitly.

---

## SECTION 6 — Open Questions for Piotr (CAT-E)

No tables were classified as CAT-E (Unclear). All 15 tables could be classified with confidence.

However, 3 boundary questions require a decision before implementation:

**Question 1 — `demo_sessions` RLS scope for shared demo links** Demo sessions with
`visibility = 'shareable'` generate a public URL (`?demo=<token>`) that can be accessed by anyone
without authentication. The token itself is the auth mechanism, not a JWT. Should the RLS policy on
`demo_sessions` use FOR ALL (which would block the SDK's token-hash verification if it uses an
authenticated connection), or should verification happen exclusively via service_role? **The current
code uses `createAdminClient()` for all demo session access, which is fine — but the RLS policy
direction for the `authenticated` role needs a decision.**

**Question 2 — `tenant_site_schemas` and the detect endpoint auth model** The `POST /api/detect`
endpoint currently accepts an optional `tenant_id` with a fallback to `'anonymous'`. With RLS on
`tenant_site_schemas`, an anonymous detection would fail to upsert because `'anonymous'` is not a
valid tenant UUID and would not match any JWT claim. **Should `/api/detect` require authentication
before enabling RLS on `tenant_site_schemas`?**

**Question 3 — `tenant_compliance_records` INSERT protection** Migration 0009 intentionally makes
INSERT service_role-only (RLS SELECT policy for `authenticated`, no INSERT policy). However, the LIA
POST route at `/api/tenants/:id/lia` already performs application-layer auth check (JWT tenant
match). After RLS-001b, should the LIA route stay on `createAdminClient()` (consistent with current
intent) or switch to `createTenantClient()` + a broader RLS policy that permits authenticated
INSERT? **This is a compliance posture decision: stricter (service_role only) vs. more flexible
(tenant can self-service).**
