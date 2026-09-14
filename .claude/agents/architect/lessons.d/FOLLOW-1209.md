# FOLLOW-1209 — architect lesson (2026-09-14)

- **Date / ticket:** 2026-09-14 / FOLLOW-1209 (SoT re-sync after #899–#904; MASTER_DESIGN 4.13).
- **What I decided:** Condition 1's grade is `outcomes.adapted > 0`, the field the harness declares.
  #904 made it equal AC(1) `ok` by construction, so the stub's fallback ("grade is `ok`, outcomes is
  context") was written for a disagreement that no longer exists. The freshness precondition names
  the verdict line to paste, not FRESH. §E.3.4's "At HEAD" blocks moved under §Snapshot.0, and §Y.3
  now names both snapshot sections.
- **Where a spec risked describing behavior with no owner:** the ESC-079 residual and the brief both
  said "§C ingest-auth prose". §C has none. The live, false contract was §V.3.2's "HMAC over
  timestamp + body hash, implemented in TICKET-012", which was never the code. I found it only by
  grepping the contract's symbols rather than the section id I was given. Separately, FOLLOW-1201's
  AC says the rate comes from tenant configuration, and the code reads one deployment-level
  `HOLDOUT_PCT`. I recorded that as a residual, not as a ruling.
- **A guardrail I'd add:** when a ticket names a document section as the site of a stale claim, grep
  for the claim's symbols (header names, formula, error code) across the whole document before
  editing the named section. Section ids in handoffs are documents too (Rule AI amendment 4).
