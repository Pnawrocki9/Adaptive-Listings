# RETRO-253 — FOLLOW-842 / PR #684 — 2026-08-06

**A finding I almost missed, and why.** The headline of this entry — that `check-rule-h.sh`'s
Pattern 2 has never been able to fail — arrived as a **stderr line in a control run I was not paying
attention to**. I built a throwaway repo to demonstrate the _PCRE_ fail-open in that file (the class
the brief sent me looking for), and ran the unshimmed script first purely to prove my fixture was
sane. It printed `line 80: [[: 0\n0: syntax error in expression` and then `Rule H passed`. **My
first instinct was "my fixture is malformed" — the exact instinct RETRO-252's fragment warned me
about, one entry earlier, and I still had it.** What saved me is that I had read that fragment an
hour before and it made me re-read the line instead of the setup. So: the standing correction works,
but only because it was written down and read. It did not become intuition in one retro. **Third
consecutive retro to find its sharpest defect by accident while probing for something else** (250: a
gate blocking a PR mid-check; 251: a malformed snapshot; this). Three is enough to stop calling it
luck: **the method should be "run every gate against the input it exists to reject" as a first-class
step, not a by-product of building a fixture for something else.** I have written that into
RETRO-253 §6 as the yes/no the next retro can check.

**An axis/chain I had to trace twice.** RETRO-250's armed Rule S amendment. On the first read I was
ready to discharge it — the brief frames FOLLOW-842 as "the third consecutive ticket where the
worker found something the brief did not name", which _sounds_ like a second sighting and the brief
explicitly asked me to decide. On the second read of RETRO-250's **actual clause** ("a worker
**instructed** to enumerate-not-fix, whose enumeration **produces filed tickets**") both halves
fail: the instruction belongs to PR #680, which is RETRO-250's own count-1 sighting, and PR #684
filed **zero** stubs. The proposition the brief describes is real and demonstrable — it is just a
_different_ proposition, already adjudicated by RETRO-251 P-36. **The generalisable trap: when a
brief asks "does X discharge?", it has usually already decided that it does, and the arming clause
is the only thing standing between that and count-inflation.** Read the clause, not the question.
Second-order note on my own behaviour: I then found two _harms_ from prose deferrals and had to
resist letting them count as two sightings — they are one PR. I recorded them as one and wrote the
corrected clause out in full so my successor tests rather than re-derives.

**A meta-pattern in how gaps recur across agents.** The thing I did not expect: **the sweep that
found FOLLOW-842 had `check-rule-h.sh` in its hands, named a defect in it, graded it "lower risk",
and was right about the line it looked at and wrong about the file.** FOLLOW-843's footnote says
`:34` is a false-FAIL (loud) — true — thirty-two lines above a silent false-GREEN at `:66` and a
structurally-dead comparison at `:79`. So the recurring shape across five tickets is not "nobody
looked"; it is **"somebody looked, at one line, and the grade of that line became the grade of the
file."** That is P-36's family (enumerate by the property, not by the call shape you noticed) and it
is why prose deferrals are worse than they look: a paragraph inside another ticket's stub carries a
_verdict_ about a file that nobody will re-open, because re-opening it means re-reading a footnote.
Corollary for me specifically: **when a prior sweep says "also flagged, lower risk", that is a
finding to re-run, not a finding to cite.** I cited FOLLOW-843's footnote in my first draft; the
version that mattered came from running the file.
