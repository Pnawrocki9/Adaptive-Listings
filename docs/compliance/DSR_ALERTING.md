# DSR Failure Alerting and Operator Procedure

**Scope:** Art. 17 GDPR erasure requests handled by `POST /api/dsr/erase`. **Last updated:**
2026-06-08 (FOLLOW-244 — updates stale `incomplete_*` value references to post-FOLLOW-238 values;
see FOLLOW-239 for original operator-dependency gap identification, FOLLOW-238 for the rename).

---

## 1. Why this document exists

`POST /api/dsr/erase` runs two DELETE passes against `conversion_labels`:

- **Pass A** — deletes rows where `lead_id = session_id` (SDK feedback-ping labels).
- **Pass B** — deletes rows where `lead_id = durable_lead_id` (CRM deep-outcome labels).

Pass B only runs when the tenant admin supplied a `lead_id` field during `POST /api/dsr/initiate`.
The `lead_id` field holds the opaque pseudonymous token the CRM webhook used when writing the
outcome rows — a different namespace from the Estalara `session_id`.

When `lead_id` is omitted at initiation time, Pass B is skipped. If the data subject has CRM-written
`conversion_labels` rows, those rows survive the erasure silently — an Art. 17 completeness gap.
FOLLOW-239 makes this gap observable and auditable rather than silent.

---

## 2. Observable signals

The route returns `crm_erasure_status` in every 200 response:

| Value                       | Meaning                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"complete"`                | Pass B ran (operator supplied `lead_id`), or no CRM-namespace rows existed for this tenant — erasure is complete.                                                                                                                                                                                             |
| `"crm_tenant_unverifiable"` | Pass B was skipped (operator did not supply `lead_id`) AND the tenant has CRM-namespace `conversion_labels` rows. CRM-namespace completeness is UNVERIFIABLE for this subject — the system cannot determine whether any of those rows belong to the erased subject. Operator must re-initiate with `lead_id`. |
| `"unverified"`              | The count query failed (DB error). The Postgres erasure (Pass A) DID run, but CRM state is unknown. Never treated as `"complete"` (Rule K.2). Check Sentry for the captured exception.                                                                                                                        |

A Sentry warning (`level: 'warning'`) is emitted for every `crm_tenant_unverifiable` outcome. A
ClickHouse audit entry is written with `action = 'crm_unverifiable'`.

> **Renamed in FOLLOW-238 (PR #237, 2026-06-08):** The wire field was previously
> `incomplete_no_durable_lead_id`; the audit action was previously
> `incomplete_erasure_crm_rows_detected`. Any rows written under the old action name predate
> FOLLOW-238 and are addressed in §5 below.

---

## 3. Operator procedure — obtaining a subject's durable token

### 3.1 What is the durable token?

The durable token is the value your CRM system sent as `lead_id` in the body of
`POST /api/crm/outcome` when recording a deep outcome for this data subject.

It is an opaque pseudonymous identifier — **not** a CRM contact ID, email address, or any PII. Your
DPA with Estalara requires you to send a non-identifying value (typically a UUID or hash you
generate tenant-side and retain the mapping of).

### 3.2 How to look up the token

1. Open your CRM system.
2. Find the record for the data subject making the erasure request.
3. Look up the `lead_id` value you sent to Estalara in the `POST /api/crm/outcome` call for that
   subject. This is the token your team generated and stored alongside the CRM contact record.
4. If your CRM stores a mapping table (contact_id → estalara_lead_id), query it now.

If you cannot locate the token, consult your onboarding documentation or contact
compliance@estalara.com. **Do not guess or fabricate a token** — an incorrect value will pass
validation but may erase the wrong subject's rows.

### 3.3 Re-running the erasure with the token

Once you have the token:

1. Initiate a fresh DSR erase request, this time including `lead_id`:

```http
POST /api/dsr/initiate
Authorization: Bearer <your-tenant-jwt>
Content-Type: application/json

{
  "session_id": "<the-data-subject-session-id>",
  "email": "<data-subject-email>",
  "dsr_type": "erase",
  "lead_id": "<durable-crm-token>"
}
```

2. The data subject will receive an OTP email. They (or you on their behalf) submit the OTP to
   `POST /api/dsr/erase`.

3. Confirm the response contains `"crm_erasure_status": "complete"`.

4. Retain the new DSR `request_id` and the timestamp for your Art. 17 compliance record.

---

## 4. Operator-dependency residual (§T.6 note — FOLLOW-239 DG-2)

As of FOLLOW-239, Estalara's DSR erasure is **operator-dependent** for CRM-integrated subjects:

- Pass B requires the operator to know and supply the opaque CRM token at DSR initiation time.
- There is no automated `session_id → durable_lead_id` resolver (path (a) of FOLLOW-239 was deferred
  as a future improvement).
- Incomplete erasures are **not silent** — they are flagged via Sentry, ClickHouse audit, and the
  `crm_erasure_status` response field.
- The CRM go-live gate (FOLLOW-187) requires this document to be in place and the alert
  infrastructure to be tested before any CRM-integrated tenant goes live.

**For each DSR from a CRM-integrated data subject, the operator MUST:**

1. Identify the durable CRM token before initiating the DSR.
2. Supply it as `lead_id` in `POST /api/dsr/initiate`.
3. Confirm `crm_erasure_status: "complete"` in the erase response.
4. If `crm_erasure_status: "crm_tenant_unverifiable"` is returned, investigate immediately and
   re-run per section 3.3 above.

---

## 5. Monitoring and alerting setup

### Sentry

Every `crm_tenant_unverifiable` outcome fires a Sentry warning (`level: 'warning'`) with:

- `tags.route = 'dsr/erase'`
- `tags.follow = 'FOLLOW-238'`
- `extra.tenant_crm_row_count` — number of CRM-namespace rows present on the tenant
- `extra.session_id` — the data subject's session fingerprint
- `extra.dsr_verification_id` — the DSR request UUID for cross-referencing
- `extra.reason = 'durable_lead_id_not_supplied'`
- `extra.operator_action` — instructions to re-initiate with `lead_id`

Create a Sentry alert for: `tags.follow = FOLLOW-238 AND level = warning`. Route to your DPO /
compliance inbox.

### ClickHouse audit

Query for unverifiable-CRM erasures (current action name, post-FOLLOW-238):

```sql
SELECT
  tenant_id,
  session_id,
  requested_at,
  completed_at
FROM dsr_audit_log
WHERE action = 'crm_unverifiable'
ORDER BY completed_at DESC
LIMIT 100;
```

> **Historical rows (pre-FOLLOW-238):** Rows written before FOLLOW-238 (PR #237, 2026-06-08) used
> the action name `incomplete_erasure_crm_rows_detected`. To include those in the above query, use:
>
> ```sql
> SELECT
>   tenant_id,
>   session_id,
>   requested_at,
>   completed_at
> FROM dsr_audit_log
> WHERE action IN ('crm_unverifiable', 'incomplete_erasure_crm_rows_detected')
> ORDER BY completed_at DESC
> LIMIT 100;
> ```
>
> The `incomplete_erasure_crm_rows_detected` action name is no longer produced by the route. Any
> rows carrying it were written under FOLLOW-239 (pre-rename, before 2026-06-08).

---

## 6. CRM go-live gate dependency

This document is a required deliverable for the **CRM go-live gate** (FOLLOW-187).

Before any CRM-integrated tenant is onboarded to production:

- [ ] This document has been reviewed by the DPO.
- [ ] The Sentry alert (section 5) is configured and tested.
- [ ] The tenant's DPA includes the CRM pseudonymisation and lead_id-mapping obligations.
- [ ] At least one test DSR has been run end-to-end confirming `crm_erasure_status: "complete"`.
- [ ] The operator procedure (section 3) has been communicated to the tenant's integration team.

See also: FOLLOW-186 (tenant onboarding pseudonymity gate), FOLLOW-187 (compliance go-live gates 8
and 9), and `docs/MASTER_DESIGN.md` §T.6 (DSR identifier-resolution model).
