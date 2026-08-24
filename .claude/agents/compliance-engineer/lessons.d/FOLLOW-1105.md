# FOLLOW-1105 — 2026-08-24 — session-identifier measurement (ESC-070)

**A compliance document written AFTER the code it describes is not protected by being "new".** The
DPIA describing `HMAC(tenant_secret, fingerprint_entropy, day_bucket)` was committed five days after
`generateSessionId()` shipped as an unkeyed `SHA-256` over four browser attributes. Nothing drifted;
the document was wrong on the day it was written, and stayed wrong for three months while the
backlog described the shipped value correctly. **Verify against the shipped symbol at authoring
time, not only at review time.**

**Treat "X is technically impossible" as the highest-risk sentence class in the corpus.** It is the
one that _inverts_ rather than merely drifts — and it is load-bearing precisely because it is
absolute: `dpia.md:122` and `lia-template.md:113` carry the ePrivacy Art. 5(3)(b) strictly-necessary
argument and the LIA balancing test respectively. A vague sentence that goes stale costs an edit; an
absolute one that goes false costs the argument built on top of it.

**The cheapest decisive probe was `git log --all -S "<the mechanism's own term>"`.** Searching for
`day_bucket` returned docs and backlog commits only — proving in one command that the mechanism had
never existed in code, which is a categorically stronger finding than "the implementation diverges".
Reach for it before reading either artefact closely.

**Measure the fork before framing it.** The obvious fork was "fix the code" vs "fix the docs", and
both were expensive. The third path — keep the stability, delete the fingerprint — was only visible
after reading `getOrCreateSession()` and noticing it reads `sessionStorage` _first_, so the digest
runs on a cache miss and nothing downstream depends on how it is computed. **Read the caller before
costing a change to the callee.**

**Ask who actually writes the table.** Much of the early framing assumed the SDK consent banner
wrote `consent_records`. It does not — the only writer is `platform-registration/route.ts`. That
single check narrowed the affected population from anonymous browsers to registered investors, which
changes the harm, the priority and the remedy. Grep for writers before describing a blast radius.
