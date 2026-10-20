## 2026-10-20 · FOLLOW-1362 C1 — staff quiz-definition API (Faza Q package Q7)

Built: GET adds `can_write` / `lint` / `invalid_active` + `raw`; PUT validates with
`QuizDefinitionAuthoringSchema` (400 + lint-coded `issues`), optional `base_version` (409) and
`source`; new `versions` (GET), `activate` (copy-forward restore, serve-schema only) and
`deactivate` (revert to default). Every write: one tx whose FIRST statement is
`pg_advisory_xact_lock(hashtext('quiz_definitions'), hashtext(tenant_id::text))`, then the
`max(version)` / active read, the mutation and the audit row. Shared read-only helpers in
`lib/quiz-definition-admin.ts`; mutations + audit inline per route. Sentry 105 -> 107 in 68.

Risks weighed: the lock only serialises if every read of the version heads happens AFTER it in the
same tx — so the old pre-tx `max(version)` read had to move inside, and the 409 check too (a check
outside the lock is a TOCTOU). The two-key lock form keeps the keyspace separate from any future
advisory-lock user. A state-staging fake that snapshots at tx start cannot show a race; snapshot at
the first statement AFTER the lock and yield a macrotask per statement, then mutation-check by
deleting the lock call (3 tests went red). Authoring validation on PUT makes the current EN-only
editor unable to save until C2 lands the EN|PL UI — the existing route fixtures had to move to the
v2 default. Restore must never be blocked by newer authoring rules (lint returned, not enforced).

Guardrail I'd add: a route test that claims "concurrent writes get distinct versions" must state how
its fake models isolation, and the PR must show the test fails with the lock removed.
