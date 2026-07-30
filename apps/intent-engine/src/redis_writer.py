"""
Redis shadow-namespace writer for chat intent (FOLLOW-087).

HARD CONSTRAINT: every write goes to the SHADOW key
`shadow:{tenant_id}:{session_id}:chat_intent` — NEVER a separate "live" intent
namespace; there is no such namespace to write to.

FOLLOW-635 (CEO ruling, option A, 2026-07-24): despite the "shadow" key name,
this data is NOT zero-UX-effect. `/api/adapt` reads this same key
unconditionally and returns it to the SDK, whose client prior loop
(`applyChatIntentPrior`) folds it into the Bayesian archetype state and
re-sends it as `archetype_hint` on the next call, driving live directives.
This module has no gate over that behaviour — the only switch is whether this
Modal app is deployed and the key gets written at all (ESC-042). §H.9 remains
enforced here: `profiling_opt_out=True` skips the write entirely (below).
"""

from __future__ import annotations

import json
import os

from upstash_redis import Redis

from schemas import ChatIntentDetectedPayload

# Provenance values whose dimensions are an all-null fallback rather than a read
# (FOLLOW-730). Mirrors ChatIntentDataSource in schemas.py — "empty_input" is not
# here: zero messages is a caller bug, not a degraded extraction.
_DEGRADED_SOURCES = frozenset({"error_fallback", "empty_model_response"})

_redis: Redis | None = None


def _get_redis() -> Redis:
    """Lazily construct the Upstash Redis client from env (module singleton)."""
    global _redis
    if _redis is None:
        _redis = Redis(
            url=os.environ["UPSTASH_REDIS_REST_URL"],
            token=os.environ["UPSTASH_REDIS_REST_TOKEN"],
        )
    return _redis


def shadow_key(tenant_id: str, session_id: str) -> str:
    """Return the shadow-namespace Redis key for a tenant/session chat intent."""
    return f"shadow:{tenant_id}:{session_id}:chat_intent"


def write_shadow_intent(
    payload: ChatIntentDetectedPayload,
    ttl_seconds: int = 86400,
    profiling_opt_out: bool = False,
) -> bool:
    """Write a chat-intent payload to the shadow namespace with a TTL.

    Key: shadow:{tenant_id}:{session_id}:chat_intent
    Value: the full ChatIntentDetectedPayload as a JSON string.
    TTL default 24h (86400s) — long enough for the batch tier to re-process and
    for analysis to read, short enough that stale shadow data self-cleans.

    §H.9 compliance: if profiling_opt_out is True the write is skipped entirely
    so no chat-intent shadow prior accumulates for opted-out sessions.

    FOLLOW-730: a DEGRADED payload (all-null dims from a failed or empty
    extraction) never overwrites an existing key. Without that guard one rate-
    limited call mid-conversation replaced a buyer's accumulated chat prior with
    nulls; `flattenIntentDimensions` then yields `{}` and `/api/adapt` stops
    returning `chat_intent_dimensions`, so the chat signal vanishes for the rest
    of the session — and on the 6h batch cron the same rotation would wipe every
    session's prior at once. A degraded payload IS still written when no key
    exists, because then it destroys nothing and is the operator's only clue.

    Returns:
        True if a value was written, False if the write was skipped (opt-out, or
        a degraded payload declining to clobber a good prior). Callers that
        report success/failure counts must not treat False as an error.
    """
    if profiling_opt_out:
        return False

    key = shadow_key(payload.tenant_id, payload.session_id)
    redis = _get_redis()

    if payload.data_source in _DEGRADED_SOURCES and redis.get(key) is not None:
        print(
            f"write_shadow_intent: keeping existing prior for {key} "
            f"(incoming payload degraded: {payload.data_source})"
        )
        return False

    redis.set(key, json.dumps(payload.model_dump()), ex=ttl_seconds)
    return True
