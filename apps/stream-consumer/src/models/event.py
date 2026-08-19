"""
Pydantic event models mirroring the Zod schemas in packages/shared.

Mirrors EventEnvelopeSchema + per-type payload shapes from TICKET-011.
Kept in sync manually for MVP; TICKET-future: codegen from JSON Schema via quicktype.
"""

import json
from pathlib import Path
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


# ---------------------------------------------------------------------------
# boot_timing payload contract — FOLLOW-1037 / MP-011.
#
# `payload` above is a generic `dict[str, Any]` because per-type payload validation for
# the ingest envelope lives entirely in TypeScript (EventSchema, apps/ingest). `boot_timing`
# is the one type this module checks the shape of at the stream-consumer boundary too — not
# to reject malformed events (the ClickHouse `events.payload` column stores the JSON blob
# verbatim regardless of shape, same as every other type) but to make TS/Python drift on this
# specific contract OBSERVABLE in stream-consumer's own logs, mirroring the
# `chat.message.sent` special-case branch in consumers/events.py.
#
# REQUIRED_FIELDS is derived from the SAME shared JSON fixture the TypeScript contract test
# reads (packages/shared/src/__tests__/cross-runtime/boot-timing-event-contract.test.ts) —
# not hand-authored here — so a fixture change on either side is a single source of truth.
# ---------------------------------------------------------------------------
_BOOT_TIMING_CONTRACT_FIXTURE = (
    Path(__file__).parent / "../../../../packages/shared/contracts/boot-timing-event.required.json"
)
BOOT_TIMING_REQUIRED_FIELDS: frozenset[str] = frozenset(
    json.loads(_BOOT_TIMING_CONTRACT_FIXTURE.read_text())
)


def is_valid_boot_timing_payload(payload: dict[str, Any]) -> bool:
    """True when every field in BOOT_TIMING_REQUIRED_FIELDS is present in `payload` and numeric.

    Mirrors BootTimingPayloadSchema's required-field set
    (packages/shared/src/schemas/events/boot-timing.ts). Used by consumers/events.py to log
    (never reject) a `boot_timing` payload that has drifted from the shared contract.
    """
    return all(
        isinstance(payload.get(field), (int, float)) for field in BOOT_TIMING_REQUIRED_FIELDS
    )
