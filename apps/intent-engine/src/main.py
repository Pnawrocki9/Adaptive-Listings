"""
Estalara intent engine — Modal serverless Python service (FOLLOW-087).

Two-tier chat NLP pipeline (Master Design §C.3):
- Real-time tier (this module's process_chat_message) — Claude Haiku 4.5,
  <500ms budget, one extraction per incoming chat message.
- Batch tier (jobs/batch_enrich.py) — Claude Sonnet 4.6, 6h cron, full
  conversation re-processing for higher-quality intent.

Both tiers produce the identical 12-dim ChatIntentDetectedPayload (schemas.py)
and write to the Redis SHADOW namespace (shadow:{tenant}:{session}:chat_intent).

FOLLOW-635 (CEO ruling, option A, 2026-07-24): this shadow key is NOT purely
"shadow" — `/api/adapt` (control-plane) reads it unconditionally and returns
`chat_intent_dimensions`, which the SDK client prior loop folds into the
Bayesian archetype state (`applyChatIntentPrior`) and re-sends as
`archetype_hint` on the next adapt call, driving live directives. There is no
server-side gate on this. It is live-influencing WHEN this Modal app is
deployed and reachable (tracked as ESC-042); until then the shadow key is
simply never written and the read path is a no-op.

F-01 / ADR-0016 pilot path (2026-07-21):
  Redpanda Cloud Serverless has no HTTP Proxy, so stream-consumer never receives
  chat.message.sent events in prod. The ingest Worker POSTs directly to
  chat_nlp_endpoint (authenticated Modal web endpoint below), which spawns
  process_chat_message — same pattern as llm-gateway description_requested_endpoint.
"""

from __future__ import annotations

import hmac
import os
from typing import Any

import modal
from fastapi import Body, Header, HTTPException
from fastapi.responses import JSONResponse

SERVICE_NAME = "estalara-intent-engine"
SERVICE_VERSION = "0.1.0"

app = modal.App("estalara-intent-engine")

image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "anthropic>=0.28",
    "upstash-redis>=1.0",
    "pydantic>=2.7",
    "fastapi>=0.110",
    # FOLLOW-730: nlp._capture_extraction_error imports this at runtime. Being in
    # pyproject.toml is NOT enough — the deployed container only ever has what is
    # listed here, so without this line every capture raises ModuleNotFoundError,
    # is swallowed by the helper's own guard, and the ticket's alerting is a
    # permanent prod no-op. jobs/batch_enrich.py reuses this same image object.
    "sentry-sdk>=2.0",
)

# Required JSON keys for chat_nlp_endpoint (mirrors stream-consumer _spawn_chat_nlp args).
_CHAT_NLP_REQUIRED = frozenset({"tenant_id", "session_id", "message"})


@app.function(image=image, secrets=[modal.Secret.from_name("estalara-secrets")])
def process_chat_message(
    tenant_id: str,
    session_id: str,
    message: dict,  # {"role": "user", "content": str}
    conversation_history: list[dict] | None = None,
    profiling_opt_out: bool = False,
) -> dict:
    """Real-time intent extraction from a single chat message. <500ms target.

    Args:
        tenant_id: tenant identifier (set on the payload after extraction).
        session_id: anonymous buyer session id.
        message: the new chat message {"role": ..., "content": ...}.
        conversation_history: prior messages for light context (optional).
        profiling_opt_out: §H.9 — if True the shadow prior write is skipped.

    Returns:
        The ChatIntentDetectedPayload as a dict (also written to Redis shadow
        unless profiling_opt_out is True).
    """
    from nlp import extract_intent
    from redis_writer import write_shadow_intent

    model = os.environ.get("INTENT_REALTIME_MODEL", "claude-haiku-4-5-20251001")
    messages = (conversation_history or []) + [message]
    payload = extract_intent(messages, model=model, source="realtime")
    payload.tenant_id = tenant_id
    payload.session_id = session_id
    write_shadow_intent(payload, profiling_opt_out=profiling_opt_out)
    return payload.model_dump()


def _valid_bearer(authorization: str | None) -> bool:
    """Validate ``Authorization: Bearer <INTERNAL_API_SECRET>`` (constant-time).

    Fails closed when the secret is unset/empty or the header is missing/wrong.
    Mirrors llm-gateway ``description_requested_endpoint`` auth (ADR-0016).
    """
    expected = os.environ.get("INTERNAL_API_SECRET", "")
    if not expected or not authorization:
        return False
    scheme, _, token = authorization.partition(" ")
    if scheme != "Bearer" or not token:
        return False
    return hmac.compare_digest(token, expected)


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("estalara-secrets")],
    timeout=30,
)
@modal.fastapi_endpoint(method="POST")
async def chat_nlp_endpoint(
    body: dict[str, Any] = Body(...),
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    """POST — direct-invocation replacement for Redpanda → stream-consumer spawn.

    Auth: ``Authorization: Bearer <INTERNAL_API_SECRET>``.
    Body: ``tenant_id``, ``session_id``, ``message`` ({role, content}), optional
    ``profiling_opt_out`` (bool, default false). Spawns ``process_chat_message``
    fire-and-forget and returns 202.

    Writes only to the Redis shadow key (see module docstring, FOLLOW-635): this
    endpoint itself does not touch directives, but once the write path is
    deployed the client prior loop picks up the shadow key on the next
    `/api/adapt` call and folds it into live adaptation.
    """
    if not _valid_bearer(authorization):
        raise HTTPException(status_code=401, detail="unauthorized")

    missing = _CHAT_NLP_REQUIRED - set(body.keys())
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"missing required fields: {sorted(missing)}",
        )

    message = body.get("message")
    if not isinstance(message, dict) or not str(message.get("content", "")).strip():
        raise HTTPException(
            status_code=400,
            detail="message must be an object with non-empty content",
        )

    tenant_id = str(body["tenant_id"]).strip()
    session_id = str(body["session_id"]).strip()
    if not tenant_id or not session_id:
        raise HTTPException(
            status_code=400,
            detail="tenant_id and session_id must be non-empty strings",
        )

    profiling_opt_out = bool(body.get("profiling_opt_out", False))

    process_chat_message.spawn(
        tenant_id=tenant_id,
        session_id=session_id,
        message={
            "role": str(message.get("role") or "user"),
            "content": str(message["content"]),
        },
        profiling_opt_out=profiling_opt_out,
    )
    return JSONResponse(status_code=202, content={"status": "accepted"})


def get_service_info() -> dict[str, str]:
    """Return service metadata for health checks.

    Returns:
        dict with service name and version.

    Example:
        >>> info = get_service_info()
        >>> info["service"]
        'estalara-intent-engine'
    """
    return {"service": SERVICE_NAME, "version": SERVICE_VERSION, "status": "active"}
