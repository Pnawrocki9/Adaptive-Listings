"""
Canonical Pydantic models for the chat NLP pipeline (FOLLOW-087).

This module is the SCHEMA CONTRACT consumed by FOLLOW-101 (SDK bridge in
intent.ts). The `chat.intent.detected` payload shape is stabilised here so the
SDK can deserialize it from the Redis shadow namespace and apply it as a
Bayesian prior. Do NOT change field names or types without bumping the contract
and updating FOLLOW-101.

The 12 dimensions mirror the behavioural intent ontology
(packages/intent-ontology) so that chat-derived and behaviour-derived intent
vectors are directly comparable for post-pilot disagreement-rate analysis.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

# Provenance of a ChatIntentDetectedPayload (FOLLOW-730 / Rule K.2). One value per
# code path in `nlp.extract_intent` that can produce a payload — nothing here is
# inferred or decorative:
#   "model"                — the Anthropic call returned text that parsed into this
#                            payload. All-null dimensions under this value mean a
#                            REAL model read that found no archetype-bearing signal.
#   "empty_input"          — extract_intent was called with zero messages; the model
#                            was never called.
#   "empty_model_response" — the call succeeded but returned only whitespace; no
#                            exception was raised and nothing could be parsed.
#   "error_fallback"       — the Anthropic call or the JSON parse raised and the
#                            exception was swallowed by the never-raises contract.
#                            The dimensions are the NEUTRAL fallback, not a read.
ChatIntentDataSource = Literal["model", "empty_input", "empty_model_response", "error_fallback"]


class ChatIntentDimensions(BaseModel):
    """The 12-dimension chat-intent vector (mirrors the behavioural ontology).

    Every field is Optional and defaults to None: a dimension is None when the
    conversation does not explicitly state or strongly imply it. The NLP
    extractor is instructed never to guess — None means "unknown", not "neutral".
    Inline comments document the allowed value vocabularies (enforced by the
    extraction prompt, kept as free `str` here so an unexpected model token is
    captured for analysis rather than rejected at parse time).
    """

    # primary_residence|second_home|investment|vacation_rental|retirement|relocation
    purchase_purpose: str | None = None
    # exploratory|0-3mo|3-6mo|6-12mo|12mo+
    urgency: str | None = None
    # stretch|comfortable|well_below
    budget_band: str | None = None
    # single|couple|young_family|established_family|empty_nester|retiree
    family_stage: str | None = None
    # school_district|commute|lifestyle|beach|mountain|urban_center
    geo_priority: str | None = None
    # free-form tag (garden, pool, workspace, …)
    feature_priority: str | None = None
    # domestic|eu_intra|foreign_buyer|expat_returning
    cross_border: str | None = None
    # cash|standard_mortgage|foreign_mortgage|investment_vehicle|mortgage_uncertain
    finance_complexity: str | None = None
    # decider|influencer|researcher_for_others
    decision_role: str | None = None
    # conservative|balanced|aggressive
    risk_appetite: str | None = None
    # excited|frustrated|comparison_shopping|validating_choice
    emotional_state: str | None = None
    tax_aware: bool | None = None


class ChatIntentDetectedPayload(BaseModel):
    """The `chat.intent.detected` event payload (the FOLLOW-101 contract).

    Written to the Redis shadow namespace
    `shadow:{tenant_id}:{session_id}:chat_intent` as a JSON string. No live
    adaptation reads this in Sprint 13 — it exists purely for the disagreement
    analysis between behavioural and chat predictions.
    """

    tenant_id: str
    session_id: str
    intent_dimensions: ChatIntentDimensions
    # top archetype from the 18 in Master Design §D.6
    archetype_hint: str
    # 0–1 combined confidence
    confidence: float
    model_used: Literal["haiku-4.5", "sonnet-4.6"]
    source: Literal["realtime", "batch"]
    # number of messages in context
    message_count: int
    # ISO 8601
    detected_at: str

    # ── FOLLOW-730: degraded-vs-genuine provenance (Rule K.2) ────────────────
    # Where these dimensions came from. Before this field existed, a dead /
    # rate-limited / unparseable Anthropic call was indistinguishable — on the
    # wire AND in Redis — from a buyer who genuinely said nothing
    # archetype-bearing: both produced all-null dims, confidence 0.0 and
    # archetype_hint "neutral" (RETRO-233 §4a LG-1, ESC-045).
    #
    # DIAGNOSTIC ONLY. Nothing reads this to decide which archetype is applied;
    # `flattenIntentDimensions` (control-plane) still drops nulls and the SDK
    # still skips an empty dimension map, exactly as before.
    #
    # Defaults to "model" so shadow JSON written before this field existed still
    # validates (that legacy shape is what the FOLLOW-368 Redis round-trip
    # fixture writes). Every producer path in `nlp.py` sets it explicitly.
    data_source: ChatIntentDataSource = "model"
    # Human-readable diagnosis for `data_source == "error_fallback"`, formatted
    # "<classified kind>: <ExceptionClassName>" (e.g. "missing_api_key: KeyError").
    # None on every other path. The full exception message is deliberately NOT
    # stored here — it goes to the log line and the Sentry event only, because
    # this value lands in a 24h-TTL Redis key that is served to no user surface
    # and should carry no model/prompt echo.
    extraction_error: str | None = None
