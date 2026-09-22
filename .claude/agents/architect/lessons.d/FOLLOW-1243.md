# FOLLOW-1243 — architect lesson (2026-09-21)

- **Date / ticket:** 2026-09-21 / FOLLOW-1243 (§P.0 condition 1 re-sync to README §5.10–§5.13;
  MASTER_DESIGN 4.14).
- **What I decided:** nothing about the gate. Condition 1 is now stated by the four graded records
  and their pasted verdict lines, with a "still missing for GO" list drawn only from the records and
  the open tickets. The three questions the records raise (how many consecutive runs; whether an
  UNMEASURED holdout-draw run counts; whether two-field fixture grounding counts) are gate
  definitions the CEO owns, so they went into §P.0 as OPEN, each traced to the retro that raised it.
  FOLLOW-1240's UNMEASURED behaviour is recorded as its specification with the harness's actual FAIL
  at `9723ec10` beside it, because the ticket is in flight and the SoT must not say "shipped" for a
  PR that does not exist.
- **Where a spec risked describing behavior with no owner:** the ticket asked for "whether a holdout
  draw is UNMEASURED or FAIL". Written as a bare statement, that sentence becomes a §P.0 rule with
  no code behind it (Rule H's exact shape). The honest form is three clauses: what the harness
  prints today (verified by grepping `differentiator-e2e.mjs` at HEAD, lines 775 / 2776 / 3131),
  what the owning ticket specifies, and the open question that neither answers. Also: the AC(3)
  bullet in §Snapshot.0 still said "no browser-driven `cosine` row has been shown", falsified by
  §5.10's `scoringPaths: ["cosine"]`; a re-sync scoped to row 1 would have left it. Grep the whole
  status block for claims the same run falsified, not only the row the ticket names.
- **A guardrail I'd add:** when a status row is re-synced from a run record, list what the record
  did NOT exercise (here: holdout draw, dropped flush) next to the green, in the SoT row itself.
  README §5.13 did this; a row that carries only the tally invites the next "6/6" misquote
  (RETRO-325's shape).
