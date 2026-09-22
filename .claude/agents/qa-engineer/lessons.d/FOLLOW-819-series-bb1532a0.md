- **2026-09-22 / FOLLOW-819 graded series at `bb1532a0`** · Tested: the second FOLLOW-820
  condition-1 series, six graded runs on one control plane: G, G, R, G, R, G. It is not citable.
  Both reds were the same product refusal (FOLLOW-1251: the authored `feature` label "Investment
  Performance", judge-confirmed), which was 0 of 6 in the previous series and 2 of 6 here. AC(5)
  held on all six, including a proxy-503 re-send, so FOLLOW-1252's poll works. · Where a test could
  have passed over a dead wire: nowhere in this series. But a README sentence written in the
  previous series ("the settle waits are `setTimeout`s on a monotonic clock, so the grade does not
  depend on the clock") was false, and `now = Date.now` in the function refutes it in one read. Run
  6 recorded a settle shorter than its own floor, which only a clock step can produce (FOLLOW-1255).
  A watch stub whose trigger rate swings from 0 of 6 to 2 of 6 between two series also shows that
  one six-run series says little about a rare failure's rate: pool the register across series before
  calling it "not recurred". · A guardrail I'd add: every elapsed-time budget in a harness must use
  a monotonic clock, and any README claim about a harness's timing must cite the line it read. An
  impossible number in an artefact (elapsed < floor) is a finding, not noise.
