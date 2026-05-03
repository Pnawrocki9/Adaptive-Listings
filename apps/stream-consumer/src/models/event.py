"""
Pydantic event models mirroring the Zod schemas in packages/shared.

Mirrors EventEnvelopeSchema + per-type payload shapes from TICKET-011.
Kept in sync manually for MVP; TICKET-future: codegen from JSON Schema via quicktype.
"""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class EventEnvelope(BaseModel):
    """Envelope shared by all Estalara event types. Mirrors EventEnvelopeSchema."""

    event_id: UUID
    # tenant_id is overridden by the ingest Worker from auth context
    tenant_id: str
    # SHA-256 hex fingerprint; 32–64 chars
    session_id: str = Field(min_length=32, max_length=64)
    # ms since epoch (client clock, may have skew)
    ts: int = Field(gt=0)
    region: Literal["eu", "us", "uk", "uae"]
    consent_state: Literal["none", "session-only", "legitimate-interest", "consented"]
    schema_version: Literal[1]
    type: str = Field(min_length=1)
    payload: dict[str, Any]
    listing_id: str | None = None
    archetype_hint: str | None = None
    # Added by ingest Worker at publish time (ms since epoch)
    ingest_received_at: int | None = None
