"""
ClickHouse reader for the batch enrichment tier (FOLLOW-087).

Sprint 13 STUB: `read_recent_chat_sessions` returns an empty list so the 6h
batch cron runs cleanly (processes 0 sessions) without a live ClickHouse
connection or a real query. The name reflects exactly what it does today — it
reads nothing — so the batch tier is honestly a no-op until the real query
lands. The real implementation (query over default.events for
event_type='chat.message.sent') is deferred to FOLLOW-101 or a dedicated ticket.
"""

from __future__ import annotations


def read_recent_chat_sessions(hours: int = 6) -> list[dict]:
    """Read recent chat sessions from ClickHouse. STUB — returns [] for Sprint 13.

    Args:
        hours: lookback window in hours (unused in the stub; documents intent).

    Returns:
        An empty list. The real query (deferred) would return dicts shaped as
        {"tenant_id": str, "session_id": str, "messages": list[dict]} so that
        batch_enrich can pass each session's messages straight into extract_intent.
    """
    # TODO FOLLOW-101: implement real ClickHouse query over default.events
    # WHERE event_type = 'chat.message.sent' AND timestamp > now() - INTERVAL hours HOUR
    return []
