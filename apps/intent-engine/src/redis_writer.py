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

# FOLLOW-730 — two different questions, two different sets. Keeping them separate
# is deliberate: conflating them is what let `empty_input` slip past the write
# guard in the first cut of this fix.
#
# 1. Which provenance values mean "these dimensions are an all-null fallback, not
#    a read"? ALL of them destroy an accumulated prior if written over it, so the
#    write guard keys on this set — including `empty_input`, whose dimensions are
#    every bit as null as the other two even though its cause (zero messages
#    reaching the extractor) is a caller bug rather than a failed model call.
_ALL_NULL_SOURCES = frozenset({"error_fallback", "empty_model_response", "empty_input"})

# 2. Which values mean "an extraction was attempted and came back unusable", i.e.
#    something an operator should be told about on the wire? `empty_input` is NOT
#    one: no extraction was attempted, and the local shim always sends exactly one
#    message so it cannot occur there. `local_dev` imports this one.
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

    FOLLOW-730 — an ALL-NULL payload must neither destroy an accumulated prior nor
    hide the fact that extraction is failing. The first cut of this guard achieved
    the first and broke the second: it simply skipped the write, so an operator who
    ran `GET` on the key mid-outage saw the older healthy payload, concluded
    extraction was fine, and went hunting an Upstash mismatch — the exact ESC-045
    misdiagnosis this ticket exists to prevent. So:

    - **No key yet** → write the all-null payload as-is, atomically (`SET … NX`).
      It destroys nothing and is the operator's only clue. NX rather than a
      GET-then-SET because production spawns one Modal container PER MESSAGE with
      no ordering guarantee: a plain read-then-write races a concurrent good write
      and can still clobber it.
    - **Key exists** → keep the prior's dimensions, archetype and confidence, and
      stamp `extraction_error` onto the stored payload so the degradation is
      visible in the very place the README and the 502 body send the operator.
      This reuses the convention already set by the multilingual retry: dimensions
      that ARE a real read keep `data_source="model"`, and `extraction_error`
      records that something later went wrong.

    The merge branch is still read-then-write and so is not atomic. That residual
    race is bounded and one-directional: the worst outcome is re-writing the prior
    good dimensions (plus a marker) over a marginally newer good payload. All-null
    dimensions can no longer reach an existing key by any interleaving, which is
    the loss that mattered.

    Returns:
        True if the key now holds this call's information (a fresh write or a
        marker merged onto the prior), False only when nothing was written at all
        — today that means §H.9 opt-out. Callers reporting success/failure counts
        must not treat False as an error.
    """
    if profiling_opt_out:
        return False

    key = shadow_key(payload.tenant_id, payload.session_id)
    redis = _get_redis()
    serialised = json.dumps(payload.model_dump())

    if payload.data_source not in _ALL_NULL_SOURCES:
        redis.set(key, serialised, ex=ttl_seconds)
        return True

    if redis.set(key, serialised, ex=ttl_seconds, nx=True):
        return True  # nothing was there; the marked payload is now the only record

    marker = payload.extraction_error or payload.data_source
    existing_raw = redis.get(key)
    if existing_raw is None:
        # The key expired between the NX attempt and this read (24h TTL, so rare).
        # Nothing to preserve — write the marked payload rather than losing the
        # signal entirely.
        redis.set(key, serialised, ex=ttl_seconds, nx=True)
        return True

    try:
        merged = json.loads(existing_raw)
        merged["extraction_error"] = marker
    except (TypeError, ValueError) as exc:  # unparseable prior — do not compound it
        print(f"write_shadow_intent: existing value at {key} is unreadable ({exc}); leaving it")
        return False

    print(
        f"write_shadow_intent: keeping prior dimensions at {key}, "
        f"stamping degradation marker ({marker})"
    )
    redis.set(key, json.dumps(merged), ex=ttl_seconds)
    return True
