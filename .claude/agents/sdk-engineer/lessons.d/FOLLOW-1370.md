## 2026-10-21 / FOLLOW-1370

**What I built:** Removed the SDK built-in EN quiz tree (`DEFAULT_QUIZ_DEFINITION`, hash
`builtin-en-v2`): no served definition → no card on that pageview. `intent.quiz(adapt)` now runs
before `await adapt.start()`, so the card waits for the served config only, not for `/api/adapt`.
-1,206 B gzip (43,133 -> 41,927).

**What was uncertain:** Whether opening the card before the first decision races the adapt loop — it
does not: `refreshDirectives` is latest-wins, so a quiz refresh supersedes the cold-start call.
Several init-path tests "proved" the card renders using public-config mocks with no
`quiz_definition` (or no decisionUrl at all) — they only passed because of the fallback.

**A guardrail I'd add:** A fallback that degrades a CEO-ruled property (language, measurement) is a
defect, not a fail-safe: prefer "show nothing" and say so in the report.
