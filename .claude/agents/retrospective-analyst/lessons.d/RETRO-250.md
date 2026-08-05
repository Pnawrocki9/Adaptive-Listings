# 2026-08-05 · RETRO-250 — FOLLOW-827 + FOLLOW-830 (PR #680)

**A finding I almost missed, and why.** The one that mattered most was not in the diff at all. I had
read `fetch_main_run_meta`'s `gh run list … --status completed -L 1` and filed it mentally as "the
ratchet RETRO-246 already described, now printed, fine". It only became a P1 because I decided to
run the merged gate against the open PR #681 as _cascade evidence_ — and it blocked a clean PR in
front of me. Then it passed the same commit six minutes later. **The lesson is about method, not
about bash: reading a script tells you what it computes; running it against live state tells you
what it computes over.** Every retro from here that grades a gate should execute that gate against a
real, current input, not only read its diff. It cost one command.

**An axis I had to trace twice.** The doc axis. My first pass on §3/§4 recorded "docs: none touched,
and none needed — this is a behaviour change inside one script". That was wrong, and it was wrong
because I checked the _files the PR touched_ instead of the _claims the PR falsified_. Grepping the
changed mechanism ("Violations found", "FOLLOW-821") across `docs/` returned two live sentences
asserting the retired count comparison — one of them inside `CONVENTIONS_PATCH.md` Rule A, i.e. the
repo's own rule about this exact gate. **Rule S applies to a corrected CLAIM exactly as it applies
to a corrected BEHAVIOUR, and I nearly under-counted the same way the worker did**: the PR ran an
excellent sibling sweep over sibling _scripts_ and none over sibling _claims_; I ran mine over the
same axis it did. Second pass caught it. The generalisable check: after any "delete/correct this
false claim" AC, grep the claim's distinctive words repo-wide before recording the AC closed.

**A meta-pattern in how gaps recur across agents — and this one is MINE.** FOLLOW-827's AC(3) was
written by RETRO-246, which had _already characterised_ the unreadable-baseline failure mode in its
own §4a LG-1(iii) — "a false RED that will train sessions to re-run until it passes" — and then
converted that finding into an AC that asked only for the baseline to be **printed**. The worker
satisfied the AC exactly and shipped the defect. So the defect I filed as P1 today was authored, in
effect, by my own predecessor's AC scoping. **A retro that characterises a failure mode and then
writes an AC weaker than its own characterisation has done the analysis and thrown it away.** The
rule I am giving myself: when §4 says a path "fails loud but wrongly", the AC must say what the
right behaviour IS, not merely that the wrong one should be visible. Visibility is not a fix; it is
a receipt.

**One thing that worked and should be copied.** Perturbation as the default grading method for a
self-test, run in a `cp` scratch copy (Rule AM). Three reverts, three answers: F5 non-vacuous, F7
non-vacuous, and — the finding — the settle loop unpinned by anything. That third run took ninety
seconds and produced a follow-up no amount of reading would have produced with the same confidence.
"Would each fixture fail if its fix were reverted?" is now the standing question for any PR that
ships a harness, and the answer must be produced one fixture at a time, because a fixture that
co-fires with another is not evidence about itself.
