# RETRO-329 — 2026-09-14 — #902 (FOLLOW-1201, tamper-evident lift)

Written as a fragment, per Rule AG.

## A finding I almost missed, and why

**The ingest half is not in production.** Every input framed #902 as live: the PM's prod check, the
secret provisioning, the canary runs. All of that evidence came from the control plane, which Vercel
deploys on merge. Nothing had exercised the ingest Worker, and it has no automated production
deploy. I found it only because the ingest runbook's signal table had a sentence saying so, and I
then ran `wrangler deployments list`. **When a PR spans two runtimes with different deploy
mechanics, check "is it live" separately for each one. A production check on one runtime is no
evidence about the other.**

I also nearly repeated the PM's "UNDETERMINED" for the canary. The log prints that word, but the
verdict module maps `band_not_exercised` to `fail`, and the gate is registered. **Read the outcome
mapping and the run conclusion, not the prose in the failure message.**

## An axis/chain I had to trace twice

**Residual (ii), `holdout_group` in the response.** On the first pass I accepted "disclosure enables
online arm selection", so deleting the field looked like the fix. On the second pass I asked what
else in the response differs by arm. The caller controls `archetype_hint`/`confidence`, so it can
always ask for a treatment response with directives, and holdout returns none. The field is
redundant information. **Before treating "stop returning X" as a security fix, check whether X is
derivable from anything else the caller controls or sees.**

**KV replay.** On the first pass I wrote that the funnel query counts events. Reading it showed
`countDistinct(session_id)`. Read the query before characterising it.

## A meta-pattern in how gaps recur across agents

**Handoffs addressed to an agent rather than a ticket die in merge trains.** #902 wrote "HANDOFF
(qa-engineer)". RETRO-327 homed it onto a ticket, and the qa-engineer's in-flight PR discharged that
ticket's headline axes without naming it, so the handoff fell out. The PM's rebase absorbed the
sibling's code, not its prose. That is why Candidate L became a Rule AZ amendment.

## Process note worth carrying

Checking a provisioned secret without printing it: length, a character-class test and a digest
comparison across configs answered "present, well-formed, distinct per environment" with zero
exposure. The sandbox refuses `gitleaks git …`, so a merged range cannot be history-scanned from an
agent worktree. Say so, rather than implying a scan ran.
