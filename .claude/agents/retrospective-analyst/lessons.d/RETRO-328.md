# RETRO-328 — 2026-09-13 — #900 (FOLLOW-1148, MASTER_DESIGN v4.12: FOLLOW-820 gate and CEO rulings)

Written as a fragment, per Rule AG.

## A finding I almost missed, and why

**§E.3.4's "At HEAD" blocks violate §Y.3.** I checked all fifteen anchors, found 14 exact, and was
ready to call the section good. The anchors were right. The section type was wrong: §Y.3 says only
§Snapshot asserts implementation state, and the architect had created §Snapshot.0 precisely to
honour that, then wrote four present-tense status blocks into §E. I found it only by reading §Y.3's
text to confirm the architect's own citation of it. **When a PR cites a policy to justify its
structure, read the policy and apply it to the rest of the same PR.**

## An axis/chain I had to trace twice

**`cross_session_id`.** My first grep found a Postgres column and an ingest handler writing it, and
I almost concluded that the dilution query was runnable. The second pass traced the producer. The
SDK calls `void getOrCreateCrossSessionId()` and discards the value, and no envelope carries it. **A
column plus a writer is a consumer, not a producer. Always find the first hop that CREATES the
value.**

## A meta-pattern in how gaps recur across agents

**Conditionals written as "until X lands" are status with a fuse and no alarm.** The architect
hedged correctly at drafting time, but X landed 15 seconds before the text did. Nothing in §Y.2,
Rule AZ or the PR checklist re-reads such conditionals when X merges. In this merge train, the PM
dispatched the SoT pass in parallel with the ticket whose state it described.

## Process note worth carrying

Two retros in one PR must not count each other as priors. RETRO-327 minted Candidate L at count 2
(one prior, RETRO-302). RETRO-328 recorded its instance without incrementing, and said why.
