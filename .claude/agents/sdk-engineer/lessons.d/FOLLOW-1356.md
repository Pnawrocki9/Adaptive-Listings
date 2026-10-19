## 2026-10-19 / FOLLOW-1356

**What I built:** The shared quiz model in `packages/shared` (traits, additive schema fields, the
walker/state machine, authoring lint, diff, Wilson interval, `DEFAULT_QUIZ_DEFINITION_V2` EN + PL)
and re-exported the moved walker helpers from `quiz-widget.ts` unchanged.

**What was uncertain:** The SDK bundle imports `@estalara/shared` as a whole, and `shared` has no
`sideEffects: false`, so every new top-level CALL (`QuizDefinitionSchema.superRefine(...)`, a helper
that builds the default tree) is retained even when unused — the first build was +5 KB gzip. Fixed
with `/* @__PURE__ */` on those calls; what remains (+471 B at the time of writing) is the real cost
of the schema fields, the serve-time `confirm` key check (~160 B) and the traits-aware replay.

**A guardrail I'd add:** After adding ANY export to `packages/shared`, run `build:check` before the
tests; a top-level call with a result nobody in the SDK reads still ships. Put authoring-only
schemas and big literals behind `/* @__PURE__ */`, and measure with a bare esbuild metafile
(`bytesInOutput` per input) to see which module grew.
