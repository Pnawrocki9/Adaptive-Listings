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

ADR-0020 (FOLLOW-736): because that prior is live-influencing AND folded only
once per session (Rule R's `chatPriorApplied` latch), an extraction carrying no
usable dimension must not overwrite it. See `has_intent_signal` and the two
branches in `write_shadow_intent`.
"""

from __future__ import annotations

import json
import os

from upstash_redis import Redis

from schemas import ChatIntentDetectedPayload, ChatIntentDimensions

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


def has_intent_signal(dims: ChatIntentDimensions) -> bool:
    """True iff at least one dimension would survive `flattenIntentDimensions`.

    ADR-0020 D2. The parameter is the DIMENSIONS object, never the payload: the
    write-admission rule is keyed on CONTENT, and taking `ChatIntentDimensions`
    makes this function structurally incapable of reading `data_source` /
    `extraction_error`. That is type-level enforcement of the DIAGNOSTIC ONLY
    contract asserted in `schemas.py`, `nlp.py` and MASTER_DESIGN §C.4 — three
    reverted rounds of PR #642 broke it by keying the decision on provenance.
    Do not "simplify" this to take the payload.

    CROSS-RUNTIME PARITY CONTRACT: this is a line-for-line mirror of
    `flattenIntentDimensions` (`apps/control-plane/src/lib/chat-intent-cache.ts`).
    A dimension is a signal exactly when the TypeScript reader would keep it:
    `None` → no, `bool` → only when True (`tax_aware=False` means "unknown"),
    `str` → only when non-empty, any other type → no (the TS flattener drops
    anything that is neither string nor boolean, so this must too). Both sides
    are pinned by `tests/fixtures/chat-intent-signal-parity.json`. If a future
    dimension is neither `str` nor `bool`, BOTH runtimes must change in the same
    PR.
    """
    for value in dims.model_dump().values():
        if value is None:
            continue
        if isinstance(value, bool):
            if value:  # tax_aware=False is "unknown", never a signal
                return True
        elif isinstance(value, str):
            if value:  # empty string is not a signal
                return True
        # no `else: return True` — the TS flattener drops other types, so we must too
    return False


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
    so no chat-intent shadow prior accumulates for opted-out sessions. This stays
    the FIRST statement — both admission branches sit downstream of it.

    WRITE ADMISSION (ADR-0020 D3): a payload carrying no usable dimension —
    whether the extraction failed or the buyer genuinely said "hi" — must never
    neutralise a prior the session already accumulated. It is written with
    `SET … NX`, which against an existing key performs NO mutation at all: not
    the value, not the TTL (D4 — a shadow write may only shorten or leave the
    residual lifetime unchanged, never extend it). On a cold key the NX write
    succeeds, so a first-message degraded record is still stored with its
    markers intact.

    INVARIANT: the only command that can remove a good record is a `SET`
    carrying non-empty dimensions. There is no read and no compare here, so
    there is no window for the concurrent per-message Modal containers to race
    — a GET-then-SET would pass unit tests with a mocked client and still lose
    records in production (PR #642 round 2).

    D5: this module performs NO read of the shadow namespace and NO
    deserialization. `json.dumps(payload.model_dump())` is the single
    serialization path into the key — the fact the C-07 / DPIA / ROPA evidence
    rests on. Pinned by `test_redis_writer_module_never_reads`.
    """
    if profiling_opt_out:
        return
    key = shadow_key(payload.tenant_id, payload.session_id)
    value = json.dumps(payload.model_dump())
    if has_intent_signal(payload.intent_dimensions):
        # New signal: overwrite unconditionally and refresh the 24h retention clock.
        _get_redis().set(key, value, ex=ttl_seconds)
    else:
        # No signal: create-only. Never clobbers, never refreshes an existing TTL.
        _get_redis().set(key, value, ex=ttl_seconds, nx=True)
