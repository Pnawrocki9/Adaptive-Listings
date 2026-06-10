"""
Chat NLP intent extractor (FOLLOW-087).

`extract_intent` is the single computation behind BOTH tiers of the pipeline:
  - real-time (Haiku 4.5) — called by main.process_chat_message on each message
  - batch (Sonnet 4.6)   — called by jobs.batch_enrich on the full conversation

It makes ONE Anthropic call (`client.messages.create`, max_tokens=512), asks the
model to return a strict JSON object covering exactly the 12 ChatIntentDimensions
fields plus `archetype_hint` and `confidence`, then parses that JSON into the
ChatIntentDetectedPayload contract (schemas.py).

What it actually reads (per ML-engineer evidence requirement): the literal
`content` text of each message in `messages` — the model classifies the
conversation prose. It is NOT a hash over IDs; tenant_id/session_id are set by
the caller AFTER extraction and never influence the dimensions.

Multilingual fallback (§C.3): if the input mixes languages (PL/ES markers
present) and the real-time Haiku pass returns low confidence (<0.6), retry once
with Sonnet for a better cross-lingual read.

Error contract (hard guardrail): on ANY Anthropic exception or JSON parse
failure, return a NEUTRAL payload (all dims None, confidence 0.0,
archetype_hint 'neutral'). This function NEVER raises.
"""

from __future__ import annotations

import json
import os
import re
from datetime import UTC, datetime
from typing import Any

from schemas import ChatIntentDetectedPayload, ChatIntentDimensions

# A single chat message: {"role": "user"|"assistant", "content": str}. Values are
# typed as Any because callers pass plain dicts whose values are strings (and the
# extractor only ever reads `role`/`content` as text).
Message = dict[str, Any]

# ---------------------------------------------------------------------------
# Model ids (Doppler config via env; defaults match Master Design §C.3 v2.6).
# Read at call time inside extract_intent so a config change takes effect
# without re-import. The defaults here are ONLY the fallback-detection anchors;
# the actual `model` used is whatever the caller passes.
# ---------------------------------------------------------------------------
HAIKU_MODEL = os.environ.get("INTENT_REALTIME_MODEL", "claude-haiku-4-5-20251001")
SONNET_MODEL = os.environ.get("INTENT_BATCH_MODEL", "claude-sonnet-4-6")

# Map a resolved model id → the Literal['haiku-4.5','sonnet-4.6'] contract value.
# Substring match keeps this robust to dated suffixes (e.g. -20251001).
_MODEL_FAMILY_FALLBACK = "sonnet-4.6"

# The 18 archetypes from Master Design §D.6 (single source of truth for the
# prompt's allowed `archetype_hint` values). Mirrors the llm-gateway guidance
# dict keys so chat and description pipelines speak the same archetype language.
_ARCHETYPES: tuple[str, ...] = (
    "yield_hunter",
    "vacation_rental_investor",
    "flip_investor",
    "portfolio_builder",
    "golden_visa_buyer",
    "commercial_investor",
    "family_buyer",
    "first_time_buyer",
    "upsizer",
    "downsizer",
    "luxury_buyer",
    "remote_worker",
    "lifestyle_expat",
    "retiree_relocator",
    "diaspora_buyer",
    "second_home_buyer",
    "student_parent",
    "neutral",
)

# Polish diacritics + Spanish diacritics/punctuation used by detect_language_mix.
_PL_CHARS = set("ąęóśźżćńł")
_ES_CHARS = set("ñáéíóúü¿¡")

# Diacritic-free common keywords (some PL/ES text uses no special characters,
# e.g. "Szukam mieszkania w Krakowie"). Word-boundary matched, lowercased.
# Kept high-precision (real-estate / intent vocabulary) to avoid English collisions.
_PL_KEYWORDS = frozenset(
    {
        "szukam",
        "mieszkanie",
        "mieszkania",
        "dom",
        "domu",
        "kupic",
        "kupić",
        "sprzedaz",
        "wynajem",
        "nieruchomosc",
        "nieruchomość",
        "dzielnica",
        "pokoj",
        "pokój",
    }
)
_ES_KEYWORDS = frozenset(
    {
        "busco",
        "casa",
        "piso",
        "comprar",
        "vivienda",
        "alquiler",
        "barrio",
        "habitacion",
        "habitación",
        "inversion",
        "inversión",
        "playa",
        "montana",
        "montaña",
    }
)

# Confidence threshold below which a multilingual Haiku pass is retried on Sonnet.
_MULTILINGUAL_RETRY_CONFIDENCE = 0.6

# Anthropic call budget — small structured-extraction response.
_MAX_TOKENS = 512


def _model_family(model: str) -> str:
    """Map a resolved Anthropic model id to the contract Literal value.

    Returns 'haiku-4.5' for any Haiku 4.5 id, otherwise 'sonnet-4.6'. Used to
    populate ChatIntentDetectedPayload.model_used (the FOLLOW-101 contract field).
    """
    if "haiku" in model.lower():
        return "haiku-4.5"
    return _MODEL_FAMILY_FALLBACK


def detect_language_mix(text: str) -> bool:
    """Heuristic: does `text` contain non-English (PL/ES) language markers?

    Two cheap signals (no model call), so the §C.3 multilingual retry can decide
    whether to escalate Haiku → Sonnet:
      1. Polish diacritics (ą,ę,ó,ś,ź,ż,ć,ń,ł) or Spanish diacritics / inverted
         punctuation (ñ,á,é,í,ó,ú,ü,¿,¡) — catches accented text.
      2. High-precision PL/ES real-estate keywords — catches diacritic-free
         non-English text (e.g. "Szukam mieszkania w Krakowie").
    Returns True if either signal fires.
    """
    lowered = text.lower()
    chars = set(lowered)
    if chars & _PL_CHARS or chars & _ES_CHARS:
        return True
    words = set(re.findall(r"[a-ząęóśźżćńłñáéíúü]+", lowered))
    return bool(words & _PL_KEYWORDS) or bool(words & _ES_KEYWORDS)


def _build_system_prompt() -> str:
    """Construct the JSON-extraction system prompt.

    Enumerates all 12 dimension names with their allowed vocabularies, the 18
    archetypes for `archetype_hint`, and the strict "only what is stated /
    strongly implied; unknown → null" rule.
    """
    archetypes = ", ".join(_ARCHETYPES)
    return (
        "You are a real-estate buyer-intent extraction engine. Read the chat "
        "conversation and extract the buyer's intent across exactly 12 dimensions.\n\n"
        "RULES:\n"
        "- Extract ONLY what is explicitly stated or strongly implied by the buyer.\n"
        "- If a dimension is unknown or ambiguous, set it to null. NEVER guess.\n"
        "- Respond in English regardless of the input language (PL/EN/ES are all supported).\n"
        "- Output a single JSON object and NOTHING else (no prose, no markdown fences).\n\n"
        "The JSON object MUST have exactly these keys:\n"
        "  purchase_purpose:   one of [primary_residence, second_home, investment, "
        "vacation_rental, retirement, relocation] or null\n"
        "  urgency:            one of [exploratory, 0-3mo, 3-6mo, 6-12mo, 12mo+] or null\n"
        "  budget_band:        one of [stretch, comfortable, well_below] or null\n"
        "  family_stage:       one of "
        "[single, couple, young_family, established_family, empty_nester, retiree] or null\n"
        "  geo_priority:       one of "
        "[school_district, commute, lifestyle, beach, mountain, urban_center] or null\n"
        "  feature_priority:   a free-form lowercase tag (e.g. garden, pool, workspace) or null\n"
        "  cross_border:       one of [domestic, eu_intra, foreign_buyer, "
        "expat_returning] or null\n"
        "  finance_complexity: one of [cash, standard_mortgage, foreign_mortgage, "
        "investment_vehicle, mortgage_uncertain] or null\n"
        "  decision_role:      one of [decider, influencer, researcher_for_others] or null\n"
        "  risk_appetite:      one of [conservative, balanced, aggressive] or null\n"
        "  emotional_state:    one of "
        "[excited, frustrated, comparison_shopping, validating_choice] or null\n"
        "  tax_aware:          true, false, or null\n"
        "  archetype_hint:     the single most likely buyer archetype, one of ["
        f"{archetypes}]. Use 'neutral' when no archetype clearly fits.\n"
        "  confidence:         a float 0.0-1.0 reflecting how many of the 12 dimensions "
        "you could determine with reasonable certainty.\n"
    )


def _neutral_payload(message_count: int, model: str, source: str) -> ChatIntentDetectedPayload:
    """Build the NEUTRAL fallback payload (all dims null, confidence 0.0).

    Returned on empty input or any error. tenant_id/session_id are placeholders;
    the caller overwrites them after extraction.
    """
    return ChatIntentDetectedPayload(
        tenant_id="",
        session_id="",
        intent_dimensions=ChatIntentDimensions(),
        archetype_hint="neutral",
        confidence=0.0,
        model_used=_model_family(model),
        source="batch" if source == "batch" else "realtime",
        message_count=message_count,
        detected_at=datetime.now(UTC).isoformat(),
    )


def _conversation_text(messages: list[Message]) -> str:
    """Flatten messages into a single role-tagged transcript for the model."""
    lines: list[str] = []
    for msg in messages:
        role = str(msg.get("role", "user"))
        content = str(msg.get("content", ""))
        lines.append(f"{role}: {content}")
    return "\n".join(lines)


def _parse_response(
    raw_json: str, message_count: int, model: str, source: str
) -> ChatIntentDetectedPayload:
    """Parse the model's JSON object into a ChatIntentDetectedPayload.

    Raises on malformed JSON / structure — the public extract_intent catches and
    converts to a neutral payload (never lets an exception escape).
    """
    # Strip an accidental ```json fence if the model added one despite instructions.
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_json.strip(), flags=re.MULTILINE)
    data = json.loads(cleaned)
    if not isinstance(data, dict):
        raise ValueError("model did not return a JSON object")

    archetype_hint = data.get("archetype_hint") or "neutral"
    if archetype_hint not in _ARCHETYPES:
        archetype_hint = "neutral"

    confidence_raw = data.get("confidence", 0.0)
    try:
        confidence = max(0.0, min(1.0, float(confidence_raw)))
    except (TypeError, ValueError):
        confidence = 0.0

    dimensions = ChatIntentDimensions(
        purchase_purpose=data.get("purchase_purpose"),
        urgency=data.get("urgency"),
        budget_band=data.get("budget_band"),
        family_stage=data.get("family_stage"),
        geo_priority=data.get("geo_priority"),
        feature_priority=data.get("feature_priority"),
        cross_border=data.get("cross_border"),
        finance_complexity=data.get("finance_complexity"),
        decision_role=data.get("decision_role"),
        risk_appetite=data.get("risk_appetite"),
        emotional_state=data.get("emotional_state"),
        tax_aware=data.get("tax_aware"),
    )

    return ChatIntentDetectedPayload(
        tenant_id="",
        session_id="",
        intent_dimensions=dimensions,
        archetype_hint=archetype_hint,
        confidence=confidence,
        model_used=_model_family(model),
        source="batch" if source == "batch" else "realtime",
        message_count=message_count,
        detected_at=datetime.now(UTC).isoformat(),
    )


def _call_model(messages: list[Message], model: str) -> str:
    """Make the single Anthropic extraction call and return the raw text.

    Imported inside the function for Modal image compatibility (mirrors the
    llm-gateway pattern). Raises on API error — caught by extract_intent.
    """
    import anthropic

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    response = client.messages.create(
        model=model,
        max_tokens=_MAX_TOKENS,
        system=_build_system_prompt(),
        messages=[{"role": "user", "content": _conversation_text(messages)}],
    )
    raw_text = ""
    if response.content and hasattr(response.content[0], "text"):
        raw_text = response.content[0].text
    return raw_text


def extract_intent(messages: list[Message], model: str, source: str) -> ChatIntentDetectedPayload:
    """Extract a 12-dim chat-intent vector from a conversation.

    Args:
        messages: list of {"role": "user"|"assistant", "content": str} dicts.
            Real-time passes the single new message; batch passes the full
            conversation.
        model: Anthropic model id to extract with (e.g. HAIKU_MODEL / SONNET_MODEL).
        source: "realtime" or "batch" — recorded in the payload.

    Returns:
        A ChatIntentDetectedPayload. tenant_id/session_id are empty strings here;
        the caller sets them before writing to Redis.

    Never raises: on empty input, Anthropic error, or parse failure, returns the
    neutral payload (all dims null, confidence 0.0, archetype_hint 'neutral').
    """
    message_count = len(messages)
    if message_count == 0:
        return _neutral_payload(message_count, model, source)

    try:
        raw_text = _call_model(messages, model)
        if not raw_text.strip():
            return _neutral_payload(message_count, model, source)
        payload = _parse_response(raw_text, message_count, model, source)
    except Exception as exc:  # noqa: BLE001 — guardrail: never raise from here.
        print(f"extract_intent error model={model} source={source}: {exc}")
        return _neutral_payload(message_count, model, source)

    # §C.3 multilingual fallback: a low-confidence Haiku read on mixed-language
    # input is retried once on Sonnet (better cross-lingual extraction). Only the
    # real-time Haiku tier triggers this; the batch tier already runs Sonnet.
    if (
        _model_family(model) == "haiku-4.5"
        and payload.confidence < _MULTILINGUAL_RETRY_CONFIDENCE
        and detect_language_mix(_conversation_text(messages))
    ):
        try:
            retry_raw = _call_model(messages, SONNET_MODEL)
            if retry_raw.strip():
                return _parse_response(retry_raw, message_count, SONNET_MODEL, source)
        except Exception as exc:  # noqa: BLE001 — keep the Haiku result on retry failure.
            print(f"extract_intent multilingual retry error: {exc}")

    return payload
