# RETRO-307 — 2026-08-24 — FOLLOW-1070 (#836)

**A finding I almost missed and why.** That the gate compares ZERO signatures. I had already proved
the extractor works on the real files and had a green CI run in hand, and I was one keystroke from
writing "Wiring Audit — clean, the fix is proven." What caught it was running the gate itself and
reading the output for ABSENCE rather than for failures: three `OK: normalized content identical`
lines and not one signature line. The habit worth keeping: after a gate fix, do not ask "does it
fail on bad input?" — ask "how many subjects did it examine?", and make the gate answer out loud. A
green check tells you nothing about the size of the population it was computed over.

**An axis/chain I had to trace twice.** The exit-code conflation. My first reproduction was
confounded: the repro manifest's canonical path was `a/route.ts`, which made the C3 latency proof go
`GONE LIVE`, so the script exited 2 and I nearly recorded "fails closed after all." Only when I
rebuilt the repro as a real git tree with the canonical at the exact path C3's proof excludes
(`apps/control-plane/src/app/api/adapt/route.ts` — i.e. `main`'s own configuration between #825 and
#839) did I get the true verdict: `✓ all mirror pairs in sync`, exit **0**, over a live divergence.
**A repro that differs from the subject on the axis under test is a hypothesis wearing a
measurement's clothes — Rule AV, and I nearly published its opposite.** Second trace: I assumed a
missing `require` would exit 2 because the extractor's header says "read or parse error → 2"; node's
own bootstrap failure exits 1, the same code the contract assigns to the benign case. **Read the
exit codes the RUNTIME can produce, not the ones the script documents.**

**A meta-pattern in how gaps recur across agents.** The worker wrote the diagnosis and shipped the
disease. Its own `lessons.md` entry in this very PR says: _"a gate that merely imports something
already on the author's PATH would ship the same hole undetected. Worth a repo-wide sweep."_ It then
fixed the dependency's PRESENCE in CI (`pnpm install`) and never asked what its own script does when
the dependency is ABSENT. This is the third time in this file's recent record that a PR names the
class it is about to instantiate (RETRO-305's §4.1 correction written in fixing-mode; RETRO-301's
false GREEN whose discriminator it had already computed). **The generalisation for the retro
process: when a PR body or lessons file names a hazard class, test THAT PR against THAT class first
— the author has just told you where they were looking, which is where they were not.** Second
meta-note: I ran the sweep the worker proposed rather than filing it as a stub, and it came back
clean (2 siblings, both fail closed). A discharged sweep is worth as much as a finding and costs
four minutes; I should default to executing a proposed sweep before filing it.
