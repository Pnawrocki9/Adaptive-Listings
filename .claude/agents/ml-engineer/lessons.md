# ml-engineer lessons

- **2026-06-10 / FOLLOW-101** · Built the chat.intent.detected → Bayesian prior bridge. Part A
  (control-plane): `chat-intent-cache.ts` reads Redis shadow key, flattens `intent_dimensions` to
  `Record<string,string>` (nulls/false booleans omitted), included as `chat_intent_dimensions` in
  `AdaptResponse`. Part B (SDK): `fetchDirectives` now returns `FetchDirectivesResult` envelope;
  when dims present, `applyChatIntentPrior` runs once per session (Rule R gate), result persisted to
  sessionStorage, `quiz.mismatch` dispatched on `chat_mismatch`. · **Judgment calls:** (1) The
  `FetchDirectivesResult` return type change cascaded to 6 existing test files — not just
  adapt.test.ts. Lesson: before changing a widely-used return type, grep ALL test files that call
  the function, not just the primary test file. (2) `quiz.mismatch` `behavioral_archetype` field was
  repurposed for the chat archetype — semantically correct (it's the non-quiz archetype), but the
  field name is misleading in this context. Filed no FOLLOW because it's deliberate reuse of an
  existing schema; the `confidence_gap: 0` default is an honest placeholder until real gap
  computation is wired. (3) `sessionStorage` key format: `persistIntentState` uses underscore
  separator (`estalara_intent_${id}`) not colon — always check the actual function before writing
  test assertions on storage keys. · **Guardrail I'd add:** When a TypeScript function's return type
  changes, a CI lint step could grep all test files for direct property access on the old return
  type and flag them (e.g., calls to `result?.archetype` where `result` is now a
  `FetchDirectivesResult`). Avoids silent test false-passes.

- **2026-06-10 / FOLLOW-087** · Built the two-tier chat NLP pipeline in apps/intent-engine
  (real-time Haiku 4.5 `process_chat_message` + 6h Sonnet 4.6 batch cron), shared `extract_intent`
  producing the 12-dim `ChatIntentDetectedPayload` contract (schemas.py, consumed by FOLLOW-101),
  shadow-only Redis writes, ClickHouse reader honestly stubbed to `[]`. · **Judgment calls:** (1)
  The spec mandated relative imports (`from .nlp`, `from ..main`), but this repo's Modal apps
  install `src/` as FLAT top-level modules (editable install flattens — no `src` package), and CI
  runs `python -m pytest src/`. Relative imports break there; I used absolute top-level imports
  (`from nlp import`, `from main import`) to match the actual import mode while keeping the spec's
  behavioral contract intact. (2) `detect_language_mix` — the spec's own test case "Szukam
  mieszkania w Krakowie" has NO diacritics, so a diacritic-only heuristic fails it; I added a
  high-precision PL/ES keyword set so the specced case passes without English collisions. (3) The
  ClickHouse reader is a stub — named `read_recent_chat_sessions` returning `[]` with a TODO, so the
  batch tier is honestly a no-op (per ML guardrail: don't name for a computation not done). ·
  **Guardrail I'd add:** Gitleaks `cloudflare-api-token` rule (`[a-zA-Z0-9_-]{40}`, entropy 3.0)
  false-positives on long descriptive Python test function names. The allowlist covered
  `apps/*/src/*/test_*.py` (nested) but NOT `apps/*/src/test_*.py` (top-level) — any new Modal app
  with a top-level `src/test_*.py` and verbose test names will hit this. Worth codifying: "Modal-app
  Python test modules with >40-char snake*case test names live at `src/test*\*.py`; ensure the
  gitleaks allowlist matches both nested and top-level test paths."
