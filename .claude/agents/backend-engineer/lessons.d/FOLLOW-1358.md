## 2026-10-19 · FOLLOW-1358 — `quiz_runs` recording (Faza Q package Q3)

Built H002 (handover SQL, RLS like H001), `lib/quiz-runs.ts` (one-statement forward-only state
machine: `INSERT … ON CONFLICT (id) DO UPDATE … WHERE` row tenant = excluded tenant AND row session
= excluded session AND row status non-terminal AND rank(row) < rank(excluded)),
`POST /api/quiz/run`, DSR coverage, public-config serving the v2 default with `definition_version` /
`definition_hash`. · Risks weighed: a missing handover table inside the DSR erase TRANSACTION aborts
the whole cascade in Postgres (25P02), so the quiz_runs DELETE runs in a SAVEPOINT (drizzle nested
`transaction()`) and only its 42P01 is swallowed; a client-chosen primary key must never let a
foreign session overwrite a row, hence the session fence in the conflict guard; a new top-level Zod
schema in `@estalara/shared` lands in the SDK bundle unless built behind a `/* @__PURE__ */` call.
ESLint and `tsc` resolve `@estalara/*` through `dist` — build shared/db/auth in a fresh worktree
first or typed lint reports hundreds of false errors. · Guardrail: none new — the route-driven
PGlite test against the real handover SQL (the H001 pattern) caught nothing only because it was
written first.
