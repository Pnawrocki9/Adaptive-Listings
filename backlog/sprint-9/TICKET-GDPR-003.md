# TICKET-GDPR-003 — Cookie-less Behavioral Fingerprinting LIA Template

**Sprint:** 9 **Agent:** compliance-engineer **Priority:** P1 **Estimated hours:** 4 **Status:**
BACKLOG **Depends on:** TICKET-GDPR-001 (DPIA establishes the lawful basis narrative this LIA
formalizes) **Unblocks:** tenant onboarding wizard (Dashboard "Compliance" tab — not yet ticketed,
Sprint 10)

## Context

Master Design H.1 specifies that Estalara's EU lawful basis for behavioral fingerprinting is
Legitimate Interest (Art. 6.1.f), backed by a "documented Legitimate Interest Assessment (LIA) per
tenant." The CNIL June 2025 guidance explicitly confirmed that commercial interest can be legitimate
for AI development purposes. TICKET-GDPR-001 produces the master DPIA that references the LIA; this
ticket produces the LIA template and the Postgres table that stores executed (signed) LIAs per
tenant.

A Legitimate Interest Assessment has three mandatory components under EDPB guidelines:

1. **Purpose test** — Is the processing for a genuine, real, and present legitimate interest?
2. **Necessity test** — Is the processing necessary for that interest (no less intrusive
   alternative)?
3. **Balancing test** — Do the legitimate interests override the data subjects' interests, rights,
   and freedoms?

The template produced here guides tenant admins through all three tests at onboarding time. The
resulting record is stored in `tenant_compliance_records` and is downloadable from the tenant
dashboard "Compliance" section (Master Design J.4, item 7).

For Estalara's own processing (not per-tenant), the master LIA is documented in
`docs/compliance/ dpia.md` (TICKET-GDPR-001). This ticket covers per-tenant LIAs — each agency signs
their own assessment covering their specific use of Estalara on their site.

**References:**

- `docs/MASTER_DESIGN.md` section H.1 (lawful basis: LI per tenant with documented LIA)
- `docs/MASTER_DESIGN.md` section G.2 (Session Mode — strictly necessary exemption + LI basis)
- `docs/compliance/dpia.md` (TICKET-GDPR-001 output) — the Estalara master LIA lives there
- EDPB Guidelines 06/2014 on legitimate interests of the controller (updated post-GDPR)
- CNIL June 2025 guidance on legitimate interest for AI systems

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **`docs/compliance/lia-template.md` exists and is complete.** The template document walks a
   tenant admin through all three LIA tests with fill-in-the-blank prompts. Required sections:
   - **Header:** template version (v1.0), date, instructions noting this is a per-tenant document to
     be completed before activating Estalara on a site that serves EU/UK/UAE users.
   - **Section 1 — Purpose test:** Free text field for tenant's stated purpose ("We use Estalara to
     show relevant listings based on what buyers appear to be searching for during their visit"). A
     pre-filled example is included. Field: `[TENANT PURPOSE STATEMENT]`.
   - **Section 2 — Necessity test:** Guided questions: (a) Would this purpose be achievable without
     behavioral fingerprinting? (b) Would a less privacy-invasive alternative achieve the same
     outcome? (c) Why have less invasive alternatives been ruled out? Pre-filled with Estalara's own
     answers (referencing session-only, no-PII, HMAC-rotation). Tenant adds site-specific context.
   - **Section 3 — Balancing test:** A structured checklist covering: nature of data (behavioral
     signals — not sensitive categories), scale (limited to one site per tenant), scope (session
     only — no cross-site), opt-out mechanism (buyer can activate browser fingerprint protections,
     opt-out link in SDK widget), reasonable expectations of data subjects (buyers on a real estate
     site expect some personalization).
   - **Section 4 — Opt-out mechanism declaration:** Tenant declares the opt-out mechanism they will
     provide (Estalara Consent Helper widget, or their own CMP). Field:
     `[OPT-OUT MECHANISM DESCRIPTION]`.
   - **Section 5 — Conclusion:** Tenant sign-off block with fields for: company name, DPO or privacy
     contact name, email, date, signature (for wet-ink or DocuSign workflow).
   - **Appendix A — Pre-filled Estalara answers:** Ready-made answers for common fields, referencing
     the Master Design G.2 and G.3 techniques. Tenants copy-paste and customize.

2. **`tenant_compliance_records` Postgres table exists.** A new Drizzle table storing executed LIAs
   per tenant, with the following schema:
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
   - `record_type text NOT NULL` — `'lia'` for this ticket; extensible for future record types
   - `version text NOT NULL` — template version used (e.g., `'lia-v1.0'`)
   - `purpose_statement text NOT NULL` — Section 1 free-text answer
   - `necessity_justification text NOT NULL` — Section 2 summary
   - `balancing_conclusion text NOT NULL` — Section 3 conclusion (pass/fail with rationale)
   - `optout_mechanism text NOT NULL` — Section 4 opt-out description
   - `signed_by_name text NOT NULL` — Section 5 signatory
   - `signed_by_email text NOT NULL`
   - `signed_at timestamptz NOT NULL`
   - `metadata jsonb DEFAULT '{}'` — catch-all for jurisdiction-specific fields
   - `created_at timestamptz NOT NULL DEFAULT now()`
   - `updated_at timestamptz NOT NULL DEFAULT now()`
   - Index:
     `idx_tenant_compliance_records_tenant_type ON tenant_compliance_records(tenant_id, record_type)`
   - RLS: tenant can read only its own rows; only backend service role can insert/update.
   - Migration generated via `pnpm --filter @estalara/db drizzle-kit generate`.

3. **`GET /api/tenants/:id/lia` endpoint.** Returns the latest LIA record for a tenant. Requires
   Bearer JWT scoped to the tenant or a staff JWT. Returns `200 { lia: TenantComplianceRecord }` or
   `404 { error: "no_lia_on_file" }` if no LIA has been submitted yet.

4. **`POST /api/tenants/:id/lia` endpoint.** Creates a new LIA record for a tenant (or replaces the
   previous one — the old record is retained but a new row is inserted to preserve audit trail).
   Accepts:

   ```json
   {
     "purpose_statement": "string (required, min 50 chars)",
     "necessity_justification": "string (required, min 50 chars)",
     "balancing_conclusion": "string (required)",
     "optout_mechanism": "string (required)",
     "signed_by_name": "string (required)",
     "signed_by_email": "email (required)",
     "signed_at": "ISO 8601 timestamp (required)"
   }
   ```

   Validates all required fields with Zod. Returns `201` with the created record. Returns `422` on
   validation failure with field-level error detail. Returns `401` if JWT invalid or tenant
   mismatch.

5. **`DELETE /api/tenants/:id/lia/:record_id` endpoint.** Soft-deletes a specific LIA record (set
   `metadata.deleted = true`, not a physical delete — audit trail must be preserved). Returns
   `200 { deleted: true }`. Returns `404` if record not found. Requires staff JWT (tenant admins
   cannot self-delete their compliance records).

6. **Zod schema exported from `packages/shared`.** A new file
   `packages/shared/src/schemas/tenant-compliance.ts` exports a `LiaRecordSchema` used by both the
   API route handler and the frontend onboarding wizard.

7. **Test coverage ≥70% for new routes; ≥80% for the Zod schema in `packages/shared`.**

8. **No TypeScript `any` without inline `// eslint-disable` + reason.**

9. **`pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass locally.**

## Files to touch

| File                                                                  | Action                             |
| --------------------------------------------------------------------- | ---------------------------------- |
| `docs/compliance/lia-template.md`                                     | NEW — LIA template document v1.0   |
| `packages/db/src/schema/tenant_compliance_records.ts`                 | NEW — Drizzle table definition     |
| `packages/db/src/schema/index.ts`                                     | Export new table                   |
| `packages/db/migrations/`                                             | New Drizzle migration              |
| `packages/shared/src/schemas/tenant-compliance.ts`                    | NEW — `LiaRecordSchema` Zod schema |
| `packages/shared/src/schemas/index.ts`                                | Export new schema                  |
| `apps/control-plane/src/app/api/tenants/[id]/lia/route.ts`            | NEW — GET + POST handlers          |
| `apps/control-plane/src/app/api/tenants/[id]/lia/[recordId]/route.ts` | NEW — DELETE handler               |
| `apps/control-plane/src/lib/__tests__/lia-routes.test.ts`             | NEW — unit + integration tests     |

Read `packages/db/src/schema/tenants.ts` and `packages/db/src/schema/tenant_site_schemas.ts`
(reference for RLS policy pattern and FK pattern) before implementing. Mirror the RLS approach from
`tenant_site_schemas.ts`.

## Test expectations

### Unit tests (required)

1. **`LiaRecordSchema` validates correct payload.** Happy-path: all required fields present with
   valid types. Assert `safeParse()` returns `success: true`.

2. **`LiaRecordSchema` rejects missing required fields.** Remove `purpose_statement`. Assert
   `safeParse()` returns `success: false` with error path `['purpose_statement']`.

3. **`LiaRecordSchema` rejects short `purpose_statement`.** Submit a 10-character string. Assert
   validation fails with a min-length error.

4. **`POST /api/tenants/:id/lia` creates record.** Mock DB. Call POST with valid payload. Assert
   `201` and returned record matches submitted fields.

5. **`POST /api/tenants/:id/lia` with invalid JWT returns 401.** Call with no Authorization header.
   Assert `401`.

6. **`GET /api/tenants/:id/lia` returns 404 when no LIA exists.** Mock DB to return empty array.
   Assert `404 { error: "no_lia_on_file" }`.

7. **Tenant isolation.** Call `GET /api/tenants/:id/lia` with JWT scoped to a different tenant.
   Assert `403`.

## Branch naming

`compliance-engineer/TICKET-GDPR-003-lia-template`

## PR title format

`feat(compliance,shared,db): LIA template + tenant_compliance_records table + CRUD API [TICKET-GDPR-003]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- PM-orchestrator validates AC items 1–9 above.
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
