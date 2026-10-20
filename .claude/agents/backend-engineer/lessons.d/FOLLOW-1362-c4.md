## 2026-10-20 · FOLLOW-1362 C4 — completions as text, analytics labels, drop-off (Faza Q package Q7)

Built: `lib/quiz-text.ts` (pure `describePath` / `archetypeLabel` / `branchLabels` /
`pendingQuestion`, and the loaders `loadActiveDefinition` / `loadDefinitionVersions`),
`readQuizRunVersionsForSessions` and `readQuizRunFunnel` in `lib/quiz-runs.ts` (42P01 ->
`available: false`), both existing GET routes extended (no new route: allowlist, Sentry register and
atomicity check untouched), viewer "Answers" column with EN + PL, analytics funnel + drop-off panel.

Risks weighed: text is resolved SERVER-side so the page never ships whole definitions; a row is
`pinned` only when a `quiz_runs` row of the session carries a version that still exists and parses,
otherwise `approximate` (active definition, or the built-in v2 default). Drop-off locates a
dismissed run on the ACTIVE definition only when it was served that version (`null === null` for the
built-in default); any other run is grouped by its step number, never guessed onto a question.
Branch labels no longer come from a hard-coded map: a legacy branch id with no match shows its raw
id. The Q1-Q3 index columns stay (legacy rows have nothing else), so existing viewer tests kept
their meaning.

Guardrail I'd add: when a route grows a read at the END of a queue-driven fake, make the fake
default to "no rows" for unprogrammed reads and assert the new read's tenant fence in the same test,
or the old `whereVals`/`limits` equality assertions silently stop meaning "every query".
