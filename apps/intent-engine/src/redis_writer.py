"""
Redis shadow-namespace writer for chat intent (FOLLOW-087).

HARD CONSTRAINT: every write goes to the SHADOW key
`shadow:{tenant_id}:{session_id}:chat_intent` — NEVER the main intent namespace.
In Sprint 13 this data has zero UX effect; it exists only for post-pilot
disagreement-rate analysis between behavioural and chat predictions. Writing to
the main namespace here would silently start adapting live pages — explicitly
out of scope.
"""

from __future__ import annotations

import json
import os

from upstash_redis import Redis

from schemas import ChatIntentDetectedPayload

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
) -> None:
    """Write a chat-intent payload to the shadow namespace with a TTL.

    Key: shadow:{tenant_id}:{session_id}:chat_intent
    Value: the full ChatIntentDetectedPayload as a JSON string.
    TTL default 24h (86400s) — long enough for the batch tier to re-process and
    for analysis to read, short enough that stale shadow data self-cleans.

    §H.9 compliance: if profiling_opt_out is True the write is skipped entirely
    so no chat-intent shadow prior accumulates for opted-out sessions.
    """
    if profiling_opt_out:
        return
    key = shadow_key(payload.tenant_id, payload.session_id)
    _get_redis().set(key, json.dumps(payload.model_dump()), ex=ttl_seconds)
