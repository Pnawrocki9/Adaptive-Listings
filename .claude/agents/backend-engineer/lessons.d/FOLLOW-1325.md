## 2026-10-18 · FOLLOW-1325 — remove tenant registrations (R3)

**What I built:** deleted admin/registrations, app/register, api/registrations, sidebar link and
`/register` public prefix; kept the investor-consent route and the `tenant_registrations` schema
(`@deprecated`, DROP owed to the CTO). N1 paths_present 23 -> 20; Sentry register 109 -> 108.

**Risks weighed:** deleting the schema file would make the next `drizzle-kit generate` emit a DROP
that db-migrate.yml auto-applies to prod. Rule I does not flag the db schema export, so no extra
stub was needed beyond the header reference. Nav-count assertions (layout test, N2 reachability)
hard-code the link count and must move with every sidebar removal (R4 will hit the same).

**A guardrail I'd add:** none.
