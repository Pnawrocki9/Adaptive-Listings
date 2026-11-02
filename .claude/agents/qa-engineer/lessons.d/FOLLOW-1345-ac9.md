- **2026-11-02 / FOLLOW-1345 AC(9)** · **Tested:** returning buyer on the real control plane, with
  paired negative controls (no consent, withdrawal, seeded DSR, non-persistable, NC-8). **Where a
  test could have passed over a dead wire:** every negative control passes on an empty store, so
  each is graded only after a positive restore on the same xid; an init-script seed would also have
  undone the withdrawal on the next navigation, so seeds go through `storageState`. **Guardrail:**
  read the source a criterion names before grading it: the plan said `llm_tweaked` and the route's
  band makes every restore `llm_full`, which a predicate shared with AC(1) would have absorbed
  silently.
