"""
FOLLOW-368 — Cross-runtime Redis round-trip smoke helper (Python side).

Called as a subprocess by redis-shadow-round-trip.smoke.test.ts. Writes a
fixed test payload to the Upstash shadow namespace using the PRODUCTION
`write_shadow_intent` function from apps/intent-engine/src/redis_writer.py.

Exit codes:
  0 — write succeeded (TTL set, key confirmed present)
  1 — write failed or creds absent (stderr carries the error)

Required env vars (same as Modal production):
  UPSTASH_REDIS_REST_URL   — Upstash REST endpoint
  UPSTASH_REDIS_REST_TOKEN — Upstash REST token

The key written is: shadow:smoke-tenant-368:smoke-session-368:chat_intent
The TTL is 86400s (24 h, the production default from write_shadow_intent).

This script is intentionally minimal — it exercises the PRODUCTION
write_shadow_intent code path, not a test double.
"""

from __future__ import annotations

import os
import sys

# Allow import of intent-engine source regardless of cwd.
_REPO_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
_INTENT_SRC = os.path.join(_REPO_ROOT, "apps", "intent-engine", "src")
if _INTENT_SRC not in sys.path:
    sys.path.insert(0, _INTENT_SRC)

# Hard-fail when creds are absent — AC-3: no silent skip from the write side.
for _var in ("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"):
    if not os.environ.get(_var):
        print(
            f"ERROR: {_var} is not set. "
            "The Redis round-trip smoke test REQUIRES both UPSTASH_REDIS_REST_URL and "
            "UPSTASH_REDIS_REST_TOKEN to be present. "
            "A missing secret means the smoke job is misconfigured. "
            "See docs/runbooks/upstash-redis-env-parity.md and backlog/ESCALATIONS.md ESC-028.",
            file=sys.stderr,
        )
        sys.exit(1)

from redis_writer import write_shadow_intent  # noqa: E402
from schemas import ChatIntentDetectedPayload, ChatIntentDimensions  # noqa: E402

# Fixed identifiers used by the TS reader side of the smoke test.
SMOKE_TENANT_ID = "smoke-tenant-368"
SMOKE_SESSION_ID = "smoke-session-368"

payload = ChatIntentDetectedPayload(
    tenant_id=SMOKE_TENANT_ID,
    session_id=SMOKE_SESSION_ID,
    intent_dimensions=ChatIntentDimensions(
        purchase_purpose="investment",
        urgency="0-3mo",
        budget_band="comfortable",
        family_stage=None,
        geo_priority=None,
        feature_priority="pool",
        cross_border=None,
        finance_complexity="cash",
        decision_role="decider",
        risk_appetite="aggressive",
        emotional_state="comparison_shopping",
        tax_aware=True,
    ),
    archetype_hint="yield_hunter",
    confidence=0.85,
    model_used="haiku-4.5",
    source="realtime",
    message_count=3,
    detected_at="2026-06-23T00:00:00+00:00",
)

try:
    write_shadow_intent(payload)
    rest_url = os.environ["UPSTASH_REDIS_REST_URL"]
    print(
        "OK: wrote shadow:smoke-tenant-368:smoke-session-368:chat_intent "
        f"with TTL=86400s via write_shadow_intent() "
        f"[UPSTASH_REDIS_REST_URL={rest_url[:30]}...]"
    )
    sys.exit(0)
except Exception as exc:
    print(f"ERROR: write_shadow_intent() raised: {exc}", file=sys.stderr)
    sys.exit(1)
