# RETRO-331 — 2026-09-14 — #906 (FOLLOW-1209, MASTER_DESIGN 4.13 SoT re-sync)

Written as a fragment, per Rule AG.

## A finding I almost missed, and why

**The rule I promoted this morning could not fire on the train it was written for.** I started
applying Rule AZ amendment 1 clause 5 to #906 and found the negative case ("a branch that absorbed
no sibling owes nothing") exempted every PR in the train. Then I checked the merge-bases of the
heads of the train amendment 1 was PROMOTED on (#899–#901) and found they were not absorbed either.
Six of the nine cited instances never satisfied the clause's own trigger.

When I promoted it, I counted instances against the pattern. I did not run the promoted TEXT,
verbatim, against each instance. **Before promoting a rule, run its trigger clause against every
cited instance. A rule that reports its own evidence clean is narrower than its evidence.**

## An axis/chain I had to trace twice

**The RETRO-329 amendment items #906 "missed".** On the first pass I read it as "#906 ignored the
amendment". On the second pass I checked when each existed: the amendment landed 39 seconds AFTER
#906 merged, in a sibling PR. #906 could not have seen it, and it re-derived five of the seven items
from code anyway. **Before calling something "not carried", check that it was on `main` when the
carrier merged.**

## A meta-pattern in how gaps recur across agents

**Every merge train in this estate is unabsorbed, and every control keyed on "rebase" or "update the
branch" is inert for it.** The PM merges green, non-conflicting PRs back to back, and GitHub does
not require the branch to be up to date. Any rule or checklist that says "after rebasing …" needs a
trigger that does not depend on the rebase happening.
