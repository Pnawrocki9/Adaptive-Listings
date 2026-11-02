**2026-11-01 / FOLLOW-1316 (server half)** · **Built:** `/api/adapt` restore and write behind
`BUYER_PROFILE_ENABLED`, arm per xid, a one-file Redis store with absolute expiry and tombstones,
`/api/profile/{erase,access,portability}`, optional `xid` on `/api/dsr/erase`. · **Risks weighed:**
the server cannot know a label's source, so `archetype_source` is a client assertion that fails
closed when absent; rounding a stored confidence down to the threshold would restore as neutral, so
the write gate compares the rounded value. · **Wrong first, caught by an independent reader:** a
tombstone re-check after the SET plus an undo DEL still left an erased profile on a lost response,
so write and delete became one atomic EVAL; and spending the OTP before fallible work strands the
subject, so verify first and spend inside the transaction. My tests had pinned the design I chose,
not the failures. · **Guardrail I'd add:** inject a lost response and a failed undo on every
multi-step erase; a shared `verifySignedSdkRequest` helper (third copy of the gate after
`quiz/completion` and `quiz/run`); and a CI job that runs the store's Lua, because the fake only
mirrors it.
