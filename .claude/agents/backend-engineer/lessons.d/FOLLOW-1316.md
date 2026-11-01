**2026-11-01 / FOLLOW-1316 (server half)** · **Built:** `/api/adapt` restore and write behind
`BUYER_PROFILE_ENABLED`, arm per xid, a one-file Redis store with absolute expiry and tombstones,
`/api/profile/{erase,access,portability}`, optional `xid` on `/api/dsr/erase`. · **Risks weighed:**
the server cannot know a label's source, so `archetype_source` is a client assertion that fails
closed when absent; a non-atomic tombstone needs a re-check after the SET, not Lua, so the same
tests run on a fake and on real Redis; rounding a stored confidence down to the threshold would
restore as neutral, so the write gate compares the rounded value. · **Guardrail I'd add:** a shared
`verifySignedSdkRequest` helper; this is the third copy of the HMAC-and-key gate after
`quiz/completion` and `quiz/run`.
