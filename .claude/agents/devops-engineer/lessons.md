# DevOps Engineer — Lessons

---

## 2026-06-26 / FOLLOW-406 + FOLLOW-411

**What I shipped:** Negative-control attestation proving gitleaks `cloudflare-api-token` detection
is RESTORED on `route.ts` (adapt) and `consent/platform-registration/lib.ts` after file-wide `paths`
exemptions were deleted in PRs #362/#364. Disambiguated the `regexes` entry for
`CANONICAL_CONSENT_TEXT_HASH`: CB-1 proved the inline `// gitleaks:allow` on lib.ts:46 is sufficient
(scan GREEN without the entry) → deleted the entry (cleaner). Added bidirectional maintenance
comments linking `.gitleaks.toml` and `lib.ts:45-49` so hash-rotation is unambiguous.

**Where a green badge could have hidden a broken run path:** PRs #362 and #364 deleted the file-wide
`paths` exemptions and reported green CI — but "no FP" proves the config change, not that
real-secret detection works. Without a dummy-token negative control, a future committed real CF API
token on `route.ts` would only be caught at the CI gitleaks-action step, not locally. The gap was
the absence of a proof-of-detection test, not the CI gate itself.

**A guardrail I'd add:** After any allowlist narrowing or deletion in `.gitleaks.toml`, the PR MUST
include a negative-control run log (dummy token → RED → removed) as required evidence in the PR
description, automated via a local `scripts/gitleaks-negative-control.sh <file> <rule-id>` helper so
any engineer can reproduce it without manually editing source files.

---

## 2026-06-30 / FOLLOW-436

**What I shipped:** Operator go-live runbook (`docs/runbooks/modal-embed-seed-consumer-golive.md`)
and escalation entry (ESC-034) for the FOLLOW-435 embed-seed Modal consumer. Added missing
`REDPANDA_TOPIC_LISTING_EMBEDDINGS` to `.env.example`.

**Where a green badge could have hidden a broken run path:** FOLLOW-435 merged CI-green with the
consumer code-complete, but wiring verification uncovered two structural bugs: (1) `main.py` is a
placeholder that deploys nothing when `modal deploy apps/llm-gateway/src/main.py` is run, and (2)
both `generate_description.py` and `consume_embed_seed_requests.py` independently define
`modal.App("estalara-description-generator")` — deploying either file alone REPLACES the other's
functions in the live Modal app. A passing CI badge does not verify that `modal deploy` actually
registers the new cron, only that the Python file parses and tests pass. The consumer is an orphan
from the deploy path.

**A guardrail I'd add:** For every new Modal `@app.function()` added to an existing app, CI must
include a `modal app list` or `modal deploy --dry-run` step (or equivalent Modal SDK introspection)
that proves the function name appears in the deployment manifest. Without this, "CI green" only
means the code compiles, not that `modal deploy` would register the cron.
