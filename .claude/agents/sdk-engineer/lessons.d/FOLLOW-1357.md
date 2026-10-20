## 2026-10-19 / FOLLOW-1357

**What I built:** Quiz widget v2 (Faza Q package Q2): the walk on the shared `nextStep`, a `multi`
trait screen (exclusive chrome "None of these"), the result screen with one correction, the EN | PL
switcher (sessionStorage), run id / timings, `POST /api/quiz/run` pings (body type Q3's
`QuizRunPingSchema`, copied verbatim after a mid-ticket reconciliation — I had first written my own
schema in parallel with Q3, which cost a rewrite; check origin for a sibling package's branch before
defining a shared contract), `onComplete(leaf, path, outcome)`, traits on the state / `/api/adapt` /
`intent.snapshot`, the additive `quiz.event` fields, the v3.0 EN-only built-in, and the one-branch
harness change for the result screen.

**What was uncertain:** The bundle. First build was +2,426 B gzip and 136 B OVER the 43,136 B
budget. The quiz card's CSS was an indented template literal with prose comments INSIDE the string —
both ship verbatim (esbuild does not minify CSS in strings). Minifying it and moving the comments
out of the string saved 380 B. The built-in tree costs ~1,050 B gzip on its own and the EN/PL/ES
chrome ~620 B (esbuild's default ASCII charset turns every Polish letter into a 6-byte `\uXXXX`
escape). Final 42,892 B (+2,046 B), 244 B headroom, so the built-in carries no `confirm`. Also:
`exactOptionalPropertyTypes` did NOT flag `{ key: maybeUndefined }` inside a conditional spread in
`intent-loop.ts`, but did flag the same thing in a test — make an optional field that callers
forward `?: T | undefined` explicitly. And `quiz_completions`' route takes a NUMBER per answer, so a
`number[]` trait step had to be filtered out of the completion ping or every v2 completion would
have 400'd.

**A guardrail I'd add:** Any `style.textContent` template literal in `packages/sdk/src/ui/` must be
minified and comment-free (a string's comments are bytes). And before changing the type of a field
that an existing ping sends, read the receiving route's Zod schema — a widened client type is a
silent 400 on a fire-and-forget path.
