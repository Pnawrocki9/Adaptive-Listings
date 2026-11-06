# Estalara Compliance Documents

This directory contains Estalara's statutory compliance documentation. All documents are append-only
living artifacts (ADR-style): original text is not modified; changes are appended as numbered
revision sections.

## Document Index

| Document                                | File                         | Regulation                                                                        | Review Cadence                               | Status                                                        |
| --------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| Data Protection Impact Assessment       | `dpia.md`                    | GDPR Art. 35; UK GDPR; UAE PDPL Art. 9; EDPB Guidelines 2/2023                    | Annual or on material processing change      | v2.29 — 2026-11-03                                            |
| Records of Processing Activities        | `ropa.md`                    | GDPR Art. 30; UK GDPR Art. 30; UAE PDPL Art. 15; CCPA service provider disclosure | Annual or on material processing change      | v2.24 — 2026-11-03                                            |
| Legitimate Interest Assessment template | `lia-template.md`            | GDPR Art. 6(1)(f); ICO LIA guidance; CNIL June 2025 guidance                      | Per-tenant on Mode A/C activation            | v2.3 — 2026-11-03                                             |
| Privacy Notice Template (tenant-embed)  | `PRIVACY_NOTICE_TEMPLATE.md` | GDPR Art. 13/14; ePrivacy Art. 5(3); UK GDPR; CCPA § 1798.100(b)                  | On material processing change; DPO gated     | v1.18 — 2026-11-06; §3 and the conversion text DO NOT PUBLISH |
| Regulatory Watch                        | `REGULATORY_WATCH.md`        | All active regulations                                                            | Continuous — updated on guidance publication | Pending — TICKET-GDPR-001 follow-up                           |

`FOLLOW-1339-session-header-review.md` holds the review of the conversion header. ESC-091 was ruled
on 2026-11-03: conversion measurement and the holdout rest on consent only, and C-4, a logged-in
buyer's erasure, stays open. `FOLLOW-1316-design-review.md` and `FOLLOW-1316-signed-review.md` hold
the compliance gate of the returning-buyer profile: its requirements, the review of the code, and
the list of what must be true before production.

## Sub-directories

| Directory                   | Contents                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `transfers/`                | Transfer Impact Assessments (TIA) per data flow route (EU→US Anthropic, EU→US OpenAI, UK→US, UAE→US, etc.)            |
| `ai-act/`                   | AI Act risk management system, data governance, and technical documentation (defensive posture per Master Design H.2) |
| `privacy-policy-generator/` | Per-tenant privacy policy templates (referenced in tenant onboarding compliance gate)                                 |

## Review Schedule

| Document | Next Review Date | Trigger Events                                                                                                                                                                                    |
| -------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DPIA     | 2027-05-15       | New processing activity added; material change to existing processing; significant regulatory guidance change (EDPB, ICO, CNIL, UAE Data Office); supervisory authority inquiry; suspected breach |
| ROPA     | 2027-05-15       | New processing activity; new sub-processor; change in retention period; change in transfer mechanism                                                                                              |
| TIAs     | Per transfer     | New cross-border data flow; change in processor jurisdiction; adequacy decision change (Schrems-style ruling)                                                                                     |

## Jurisdiction Coverage

All documents cover four operational jurisdictions:

- **EU GDPR** (Regulation 2016/679) + ePrivacy Directive 2002/58/EC + EDPB Guidelines 2/2023
- **UK GDPR** (UK GDPR + DPA 2018) + PECR (SI 2003/2426)
- **US CCPA/CPRA** (Cal. Civ. Code § 1798.100 et seq.)
- **UAE PDPL** (Federal Decree-Law 45/2021 + Cabinet Decision 111/2023) + DIFC Data Protection Law
  No. 5 of 2020

## DPO Contact

Placeholder: dpo@estalara.io (appointment in progress)

DPO registration required with: UODO (Poland, EU lead authority), ICO (UK), UAE Data Office.

## Related Tickets

| Ticket          | Description                                             | Status                 |
| --------------- | ------------------------------------------------------- | ---------------------- |
| TICKET-GDPR-001 | This DPIA + ROPA                                        | Pending Piotr sign-off |
| TICKET-GDPR-002 | DSR endpoint implementation (deletion cascade)          | Blocked on GDPR-001    |
| TICKET-GDPR-003 | LIA template + tenant_compliance_records                | Blocked on GDPR-001    |
| TICKET-GDPR-004 | Consent state propagation (SDK → ingest → Decision API) | Blocked on GDPR-001    |
