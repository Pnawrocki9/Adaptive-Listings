## 2026-10-20 / FOLLOW-1369

**What I built:** Replaced FOLLOW-1365's init-fetch-then-late-fetch pair with ONE
`fetchQuizConfig(..., 15_000)` raced against a 1 s timer; the same promise becomes `lateConfig`. +27
B gzip (43,106 -> 43,133 of 43,136; headroom 3 B).

**What was uncertain:** Bundle headroom (a `fetchedQuizConfig` temp cost 2 B over). A fast null
(non-2xx) is now final: no retry, built-in tree. Fake-timer tests need `shouldAdvanceTime` plus
`advanceTimersByTimeAsync`.

**A guardrail I'd add:** a retry/late path must reuse the in-flight request, never start a second
one.
