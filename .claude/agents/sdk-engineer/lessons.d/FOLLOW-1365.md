## 2026-10-20 / FOLLOW-1365

**What I built:** One late `fetchQuizConfig` (8 s, rehydrate=false) when the 1 s init fetch returned
null; `BootContext.lateConfig` (merged SdkConfig promise), awaited by `openQuiz()` in intent-loop,
which rebuilds the quiz config (`buildQuizConfig()`) from the merged config. +107 B gzip.

**What was uncertain:** The ticket says the quiz opens 30 s after load, but `openQuiz()` runs at
wire time, so on failure the card is now delayed up to 8 s (only on failure). Packages/shared must
be built (`pnpm --filter @estalara/shared build`) before sdk vitest/build resolves it.

**A guardrail I'd add:** none.
