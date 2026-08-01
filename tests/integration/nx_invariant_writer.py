"""
FOLLOW-752 — real-Redis writer helper for the `SET … NX` write-admission
invariant (ADR-0020 D3/D4, implemented by FOLLOW-736).

Called as a subprocess by redis-shadow-round-trip.smoke.test.ts. Writes ONE
payload to the Upstash shadow namespace using the PRODUCTION
`write_shadow_intent` function from apps/intent-engine/src/redis_writer.py —
the exact function `redis_shadow_round_trip` already exercises for AC-RT1, now
called with a second, distinct payload shape so the create-only (`nx=True`)
branch is actually reached, not just the unconditional-overwrite branch
AC-RT1/AC-RT2 already cover.

Usage: python3 nx_invariant_writer.py <tenant_id> <session_id> <mode>
  mode == "signal" — a payload WITH at least one non-null dimension. Reaches
    the unconditional `SET` branch (overwrite + refresh TTL).
  mode == "empty"  — a payload with ALL dimensions null and
    `data_source == "model"` (ADR-0020 D2 — a NEUTRAL SUCCESS, not a degraded
    read; see AC2 of FOLLOW-752). Reaches the `SET … NX` create-only branch.

Exit codes:
  0 — write succeeded (write_shadow_intent raised nothing)
  1 — write failed, creds absent, or bad argv (stderr carries the error)

This script is intentionally minimal — it exercises the PRODUCTION
write_shadow_intent code path, not a test double. It does not know or care
whether the target key already exists: that decision belongs entirely to
`write_shadow_intent`'s NX logic, which is the thing under test.
"""

from __future__ import annotations

import os
import sys

# Allow import of intent-engine source regardless of cwd.
_REPO_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
_INTENT_SRC = os.path.join(_REPO_ROOT, "apps", "intent-engine", "src")
if _INTENT_SRC not in sys.path:
    sys.path.insert(0, _INTENT_SRC)

# Hard-fail when creds are absent — mirrors shadow_intent_writer.py: no silent skip.
for _var in ("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"):
    if not os.environ.get(_var):
        print(
            f"ERROR: {_var} is not set. "
            "The Redis NX-invariant smoke test REQUIRES both UPSTASH_REDIS_REST_URL and "
            "UPSTASH_REDIS_REST_TOKEN to be present. "
            "See docs/runbooks/upstash-redis-env-parity.md and backlog/ESCALATIONS.md ESC-028.",
            file=sys.stderr,
        )
        sys.exit(1)

from redis_writer import write_shadow_intent  # noqa: E402
from schemas import ChatIntentDetectedPayload, ChatIntentDimensions  # noqa: E402

if len(sys.argv) != 4 or sys.argv[3] not in ("signal", "empty"):
    print(
        "ERROR: usage: nx_invariant_writer.py <tenant_id> <session_id> <signal|empty>",
        file=sys.stderr,
    )
    sys.exit(1)

_, tenant_id, session_id, mode = sys.argv

if mode == "signal":
    # A genuine chat-derived read carrying real signal. Reaches the
    # unconditional-overwrite branch (`has_intent_signal` is True).
    payload = ChatIntentDetectedPayload(
        tenant_id=tenant_id,
        session_id=session_id,
        intent_dimensions=ChatIntentDimensions(
            purchase_purpose="primary_residence",
            urgency="0-3mo",
            family_stage="young_family",
        ),
        archetype_hint="family_upsizer",
        confidence=0.9,
        model_used="haiku-4.5",
        source="realtime",
        message_count=2,
        detected_at="2026-07-31T00:00:00+00:00",
        # data_source left at its "model" default — a real read.
    )
else:
    # AC2: a NEUTRAL SUCCESS — the model call succeeded and the buyer said
    # something with no extractable dimension ("thanks"). `data_source` is
    # explicitly "model", NOT a degraded value, per ADR-0020 D2: the
    # write-admission rule is keyed on CONTENT (all-null dimensions), never on
    # provenance. A degraded-only fixture here would let a provenance-keyed
    # regression (PR #642 round 1) pass this gate.
    payload = ChatIntentDetectedPayload(
        tenant_id=tenant_id,
        session_id=session_id,
        intent_dimensions=ChatIntentDimensions(),
        archetype_hint="neutral",
        confidence=0.0,
        model_used="haiku-4.5",
        source="realtime",
        message_count=1,
        detected_at="2026-07-31T00:05:00+00:00",
        data_source="model",
    )

try:
    write_shadow_intent(payload)
    print(f"OK: wrote shadow:{tenant_id}:{session_id}:chat_intent mode={mode}")
    sys.exit(0)
except Exception as exc:
    print(f"ERROR: write_shadow_intent() raised: {exc}", file=sys.stderr)
    sys.exit(1)
