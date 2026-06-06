# SDK Engineer — Lessons Log

## 2026-06-06 / FOLLOW-196

**What I built:** Extended `estalara:chat:message-sent` and `live.signup` CustomEvent detail
payloads in Estalara-app (ChatBot.svelte + LiveSessions.svelte) to include `user_uuid` and
`is_agent` fields sourced from `authStore`. Also fixed a critical event type mismatch in
LiveSessions.svelte: the event was dispatched as `'estalara:live:signup'` (colon-separated) but the
SDK `registerFeedbackListener` in `adapt.ts` listens for `'live.signup'` (dot-separated). This was a
silent dead wire — the feedback ping would never have fired even after FOLLOW-195 merged.

**What was uncertain:** Whether `userUuid` was already tracked in ChatBot.svelte (it was not — only
`isAgent` was). Whether FOLLOW-195 was merged to main before this work (it was not — `live.ts`
schema file is on a branch; this PR works from main which does not yet have it).

**A guardrail I'd add:** When a CustomEvent producer and an SDK listener are in different repos, add
a cross-repo integration test (or at minimum a documented contract test) that verifies the event
type string matches. The type `'estalara:live:signup'` vs `'live.signup'` mismatch could only be
caught by manually reading both sides — no CI gate catches cross-repo string mismatches. Guardrail:
every Estalara-app CustomEvent dispatch should be listed in a contract file (e.g.
`docs/event-contracts.md`) with the exact type string, and the SDK adapter should reference that
contract file in a comment.
