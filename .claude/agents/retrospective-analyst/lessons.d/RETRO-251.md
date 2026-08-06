# RETRO-251 — FOLLOW-845 / PR #682 — 2026-08-06

**A finding I almost missed, and why.** My first enumeration grep used the pathspec
`'apps/*/src/**/*.ts'`. It returned 28 sites and looked complete — and it silently excluded every
file sitting **directly** under `apps/<app>/src/`, because `**/` requires at least one intervening
directory. `clickhouse-producer.ts` — the subject of the entire ticket — was in the excluded set. I
only caught it because the count felt wrong against a file I had already read. **The enumeration
grep is itself subject to Rule AL**, and it fails in the direction that looks like a finished sweep.
Standing correction for me: when a sweep's purpose is completeness, run it with the crudest possible
scope (`git grep -n "<pattern>" <commit> -- <dir>`) first and narrow afterwards, never the reverse.

**An axis/chain I had to trace twice.** The brief told me the three coupling instances were each
found by the previous one's retro. I started writing that and then went to cite it — and
`dpia.md:430-455`, authored by the **FOLLOW-838 worker**, turned out to contain a complete Rule S
enumeration naming `clickhouse-producer.ts:178` and filing FOLLOW-845. The premise I was handed was
false for instance 3, and for instance 4 as well. **I had built half an entry on an inherited claim
before checking it.** The corrected version is a better finding than the one I was asked for — the
mechanism went retro-driven → worker-driven — but I got there by nearly shipping the brief's framing
verbatim. **A brief is a hypothesis, not evidence, and it deserves the same citation discipline I
apply to a PR body.**

**A meta-pattern in how gaps recur across agents.** The incomplete enumerations in this chain were
all done by **retros**; the complete one was done by a **worker who had it as an AC**. That is
structural, not a competence gap: a retro reads a diff, so its natural axis is the symptom that
appears in the diff (`console.error` sites); a worker reads a ticket, so its axis is whatever the AC
names. **The lesson for my own role is that listing instances is the weaker deliverable — writing
the source-axis enumeration INTO the stub is the stronger one.** I did that for FOLLOW-852 and
FOLLOW-836 in §5a and it is the thing I will carry forward: a retro that finds a class should hand
the next worker the grep, not the list.

**Second, smaller.** This is the first retro in this chain to file zero stubs, and I had to
consciously resist manufacturing one. §4a and §4b are genuinely N/A; both wiring checks are clean.
If the filing rate is to carry information, a clean merge has to be allowed to read as clean.
