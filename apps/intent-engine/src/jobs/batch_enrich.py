"""
Batch enrichment cron (FOLLOW-087) — Sonnet 4.6 re-processing tier.

Every 6 hours, re-runs intent extraction over recent conversations using the
higher-quality Sonnet 4.6 model (vs the real-time Haiku tier) and writes the
enriched result to the SAME Redis shadow namespace. In Sprint 13 the ClickHouse
reader is a stub returning [], so this cron runs cleanly and processes 0
sessions until the real query lands.
"""

from __future__ import annotations

import modal

from main import app, image


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("estalara-secrets")],
    schedule=modal.Cron("0 */6 * * *"),  # every 6 hours
)
def batch_enrich_conversations() -> dict:
    """Re-process recent conversations with Sonnet 4.6 for higher-quality intent.

    Reads recent chat sessions from ClickHouse (stub → [] in Sprint 13), extracts
    intent with the batch model, and writes each result to the Redis shadow
    namespace.

    Returns a summary: {"processed": N, "errors": N}.
    """
    import os

    from clickhouse_reader import read_recent_chat_sessions
    from nlp import extract_intent
    from redis_writer import write_shadow_intent

    model = os.environ.get("INTENT_BATCH_MODEL", "claude-sonnet-4-6")
    sessions = read_recent_chat_sessions(hours=6)
    processed, errors = 0, 0

    for session in sessions:
        try:
            payload = extract_intent(session["messages"], model=model, source="batch")
            payload.tenant_id = session["tenant_id"]
            payload.session_id = session["session_id"]
            # §H.9: clickhouse_reader does not yet surface opt-out state, so
            # we default to False. The batch tier processes only sessions whose
            # events reached ClickHouse; opted-out sessions are suppressed
            # upstream before storage. This default is safe for the current
            # pipeline stage — revisit when clickhouse_reader returns opt_out.
            write_shadow_intent(
                payload,
                profiling_opt_out=session.get("profiling_opt_out", False),
            )
            processed += 1
        except Exception as e:  # noqa: BLE001 — a bad session must not abort the batch.
            print(f"batch_enrich error: {e}")
            errors += 1

    return {"processed": processed, "errors": errors}
