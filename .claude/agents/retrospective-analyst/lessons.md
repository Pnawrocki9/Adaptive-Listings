# Retrospective-Analyst — meta-lessons (self-improvement loop)

## 2026-06-02 · RETRO-027 (PR #172, TICKET-DESC-PIVOT-001 v1.8 — Sonnet prompt rewrite)

- **A finding I almost missed and why:** the audit-block truncation chain (LG-1). The diff _looks_
  contract-neutral — "prompt body replaced, anti-hallucination contract unchanged, max*tokens
  unchanged." The trap is that two unchanged things (max_tokens=450/600) plus one changed thing
  (length now tracks original_description) combine into a runtime regression: a long original eats
  the token budget before `<verified_facts_used>` closes, and `_parse_verified_facts` silently
  degrades to `[]` while shipping a dangling tag to the buyer. Lesson: when a PR says "X unchanged,
  Y changed," always check whether the \_interaction* of X and Y is what moved — the gap lives in
  the coupling, not in either symbol alone.
- **An axis/chain I had to trace twice:** the producer→consumer→render chain for the audit block. On
  first pass it reads "clean ✅" (parser untouched, wire intact). Only on tracing the _payload_
  under the new length policy did the truncation failure mode appear. I recorded it as a §4a logic
  gap (wire connected, payload at risk), not a §3 wiring gap — kept the wiring audit honest while
  still surfacing the P1.
- **A meta-pattern in how gaps recur across agents:** "behavioural/contract change shipped as a
  refactor, with zero new assertions because the existing suite mocks the changed surface away." The
  17-test suite mocks Sonnet output, so a full prompt rewrite is invisible to it — same shape as
  Rule H ("scaffold without a runtime-wired consumer"): an artifact ships without anything that
  verifies its new shape. Count is 1 for the prompt/output-contract variant; logged as a watch-item
  for a future Rule. If this recurs (next time an LLM prompt / external contract is rewritten with
  green CI and no shape assertion), promote it.

## 2026-06-03 · RETRO-028 (PR #182, TICKET-DESC-001 — per-listing LLM headline + ESC-018 original_description threading)

- **A finding I almost missed and why:** that ESC-018 was a **consumer-only half-wire that this PR
  closed**, not a new gap. The diff is huge and headline-centric, so the instinct is to audit the
  headline. But the load-bearing change is the schema field `original_description` becoming required
  - a producer being added — and the only reason that's safe is the Python consumer at
    `generate_description.py:1095` already required it. I had to grep the consumer's `required` set
    to confirm the wire is now connected rather than just asserting it from the PR body. The CHECK B
    classification (consumer-only = P0-class, now resolved-in-PR) only fell out after reading both
    ends.
- **An axis/chain I had to trace twice:** the anti-hallucination contract. First pass: "headline is
  grounded — the prompt says 'do not invent' and includes both sources." Second pass against the
  _description_ path revealed the asymmetry — the description has a system prompt + fact whitelist +
  parsed `<verified_facts_used>` audit block; the headline has none of that. The gap is comparative,
  not absolute: the headline isn't ungrounded, it's _less_ grounded than its sibling on the same
  surface, and it has no audit trail at all. Lesson: when two sibling LLM calls share a file, diff
  their _contracts_, not just their prompts.
- **A meta-pattern in how gaps recur across agents:** the producer↔consumer parity gap keeps
  reappearing on new axes. The `inquiry_submit_selector` chain (RETRO-017/021/022/024) was SDK/TS
  intra-runtime; ESC-018 is the same shape across the **TS→Python language boundary**, where there's
  no shared schema so each side's tests pass against its own copy. Rule J gates TS↔TS _duplicates_;
  Rule H gates same-runtime Zod-scaffold-without-consumer. Neither covers a cross-language
  non-duplicated producer/consumer pair. Count is 1 — watch-item, FOLLOW-168 is the first concrete
  verification. If a second TS↔Python (or TS↔Worker-divergent-validation) contract drift lands,
  promote a Rule requiring a shared/generated contract fixture asserted by both runtimes.
- **One thing I did right to record:** I resisted re-counting RETRO-027's "no-shape-assertion"
  candidate against this PR — #182 actually pins every new branch with 24 assertions, so it's the
  counter-example, not a recurrence. Noting positive cases keeps the promotion counter honest.
