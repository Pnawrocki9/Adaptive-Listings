# RETRO-306 — 2026-08-24 — FOLLOW-1073 (#839)

**A finding I almost missed, and why.** The manifest deletion's effect on the gate's **consumer**. I
checked "is `reorder.ts` dead?" — the axis the brief pointed at — and nearly stopped there, because
the answer was a clean yes and every fact the PR rested on verified. The finding was one hop the
other way, in `check-mirror-files.sh`'s now-empty P2 region. **Deleting a row from a register is a
contract change on the register's _reader_, and readers are invisible in a diff that only touches
JSON.** A manifest edit looks like data; it is an interface change.

**An axis I had to trace twice.** The C3 latency claim. First read: "fine, #836 fixed that half."
Second read, against the actual manifest at HEAD: false again — because #836 merged **after** #839
and wrote its correction on top of a region #839 had already emptied. **Merge order matters to
claim-truth, not just to gate colour.** A correction written against the world as it was two commits
ago is a new false claim, and it arrives wearing the authority of a fix.

**A meta-pattern in how gaps recur across agents.** Three retros in sequence (298 → 305 → 306) and
the shape is the same: a **coverage claim written about a mechanism whose region has since
changed**. The claim is never re-measured because it reads as settled.

**A cheap probe worth reusing.** For any "X will be deleted by FOLLOW-N" justification, `ls` the
directory against FOLLOW-N's own scope list. One command caught a file FOLLOW-107 names that does
not exist **and** one it omits that does — and that is what turned "the deletion is scheduled" into
"the deletion is gated on a monitor nobody has built."
