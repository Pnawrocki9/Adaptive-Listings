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
