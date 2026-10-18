- **2026-10-18 / FOLLOW-1326** · Removed demo sessions + agency mockup (R4), kept the archetype
  simulator. · Risk weighed: `lib/demo-session-revocation.ts` (called by `/api/adapt`) is the last
  reader of `demo_sessions`, so the table is NOT dead and "no code path" would have been false; kept
  the reader, marked the schema `@deprecated` (no writer), DROP owed in CTO handover §4. Hidden
  consumers of deleted code: a SDK registry test (`placeholder-token-producers`) scanned the mockup
  page, a Sentry `TOTAL_SITES` register, and two nav-count assertions (layout.test,
  admin-nav-reachability). · Guardrail: when deleting a page, grep by the page's emitted `data-*`
  attributes and by sidebar-count constants, not only by path. Rule I counts by symbol NAME, so
  deleting a same-named importer can surface a new WARN elsewhere.
