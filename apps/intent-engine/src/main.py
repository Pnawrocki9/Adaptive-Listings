"""
Estalara intent engine — Modal serverless Python service (FOLLOW-087).

Two-tier chat NLP pipeline (Master Design §C.3):
- Real-time tier (this module's process_chat_message) — Claude Haiku 4.5,
  <500ms budget, one extraction per incoming chat message.
- Batch tier (jobs/batch_enrich.py) — Claude Sonnet 4.6, 6h cron, full
  conversation re-processing for higher-quality intent.

Both tiers produce the identical 12-dim ChatIntentDetectedPayload (schemas.py)
and write to the Redis SHADOW namespace only (shadow:{tenant}:{session}:chat_intent).
No live adaptation reads this in Sprint 13 — shadow-only by design.
"""

from __future__ import annotations

import modal

SERVICE_NAME = "estalara-intent-engine"
SERVICE_VERSION = "0.1.0"

app = modal.App("estalara-intent-engine")

image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "anthropic>=0.28",
    "upstash-redis>=1.0",
    "pydantic>=2.7",
)


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
    import os

    from nlp import extract_intent
    from redis_writer import write_shadow_intent

    model = os.environ.get("INTENT_REALTIME_MODEL", "claude-haiku-4-5-20251001")
    messages = (conversation_history or []) + [message]
    payload = extract_intent(messages, model=model, source="realtime")
    payload.tenant_id = tenant_id
    payload.session_id = session_id
    write_shadow_intent(payload, profiling_opt_out=profiling_opt_out)
    return payload.model_dump()


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
