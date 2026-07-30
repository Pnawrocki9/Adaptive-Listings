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

FOLLOW-730: that neutral payload is byte-identical to the one a genuinely
no-signal buyer produces, so every producer path stamps `data_source` on the
payload (and `extraction_error` on the failure path), and the swallowed
exception is sent to Sentry when SENTRY_DSN is set. The markers are DIAGNOSTIC
ONLY — nothing reads them to decide which archetype is applied.
"""

from __future__ import annotations

import json
import os
import re
from datetime import UTC, datetime
from typing import Any

from schemas import ChatIntentDataSource, ChatIntentDetectedPayload, ChatIntentDimensions

# Set once by _capture_extraction_error on the first captured failure (FOLLOW-730).
# Nothing else in this app initialises sentry-sdk, so initialisation is lazy and
# DSN-gated rather than at import time. The package must be listed in BOTH
# pyproject.toml and main.py's Modal image pip_install — pyproject alone leaves
# the capture dead in the deployed container.
_sentry_initialised = False

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


def _neutral_payload(
    message_count: int,
    model: str,
    source: str,
    *,
    data_source: ChatIntentDataSource,
    extraction_error: str | None = None,
) -> ChatIntentDetectedPayload:
    """Build the NEUTRAL fallback payload (all dims null, confidence 0.0).

    Returned on empty input or any error. tenant_id/session_id are placeholders;
    the caller overwrites them after extraction.

    Args:
        data_source: which producer path built this payload (FOLLOW-730). Required
            and keyword-only on purpose: every caller must state whether this
            neutral payload is a degraded fallback or a legitimate no-signal
            result, because the two are otherwise byte-identical (RETRO-233 §4a
            LG-1).
        extraction_error: "<classified kind>: <ExceptionClassName>" when
            data_source is "error_fallback"; None otherwise.
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
        data_source=data_source,
        extraction_error=extraction_error,
    )


def _classify_extraction_error(exc: Exception) -> str:
    """Classify a swallowed extraction failure into a coarse, taggable kind.

    Separates the cases an operator acts on differently (FOLLOW-730 AC2):
    a credential problem is a config fix, a quota/upstream problem is wait-or-
    escalate, an unparseable response is a prompt/model problem.

    Anthropic's own exceptions are matched BY CLASS NAME rather than by
    isinstance, deliberately: importing `anthropic` here would couple this
    classifier to the SDK being importable in every context that calls it (the
    Modal image has it, a bare unit-test environment need not), and the SDK's
    errors derive from `AnthropicError`, NOT from `ValueError` — so a
    `ValueError` check silently buckets every 401/429/5xx into "other". That
    exact hole was found in review: a set-but-blank `ANTHROPIC_API_KEY` never
    reaches the KeyError branch (`os.environ[...]` succeeds and the request
    401s), which is the single most likely credential misconfiguration.
    """
    name = type(exc).__name__
    if isinstance(exc, KeyError) and "API_KEY" in str(exc):
        return "missing_api_key"
    if name in {"AuthenticationError", "PermissionDeniedError"}:
        # 401/403 — key present but blank, revoked, rotated or wrong-account.
        return "auth_error"
    if name in {"RateLimitError", "OverloadedError"}:
        return "rate_limited"
    if name in {"APIConnectionError", "APITimeoutError", "InternalServerError"}:
        return "upstream_error"
    if isinstance(exc, ValueError):  # incl. json.JSONDecodeError
        return "parse_error"
    return "other"


def _capture_extraction_error(
    exc: Exception | None, *, model: str, source: str, kind: str, stage: str
) -> None:
    """Send a swallowed extraction failure to Sentry, tagged for triage.

    `extract_intent` must never raise, which means its failures are invisible
    beyond a stdout line. `sentry-sdk` is listed BOTH in `pyproject.toml` (local
    + CI) and in `main.py`'s Modal image `pip_install` — the second is the one
    that matters in production, and its absence made this helper a permanent
    no-op in the deployed container until review caught it. Initialisation is
    lazy and only happens when `SENTRY_DSN` is set; with the DSN unset this is a
    deliberate no-op and the payload marker plus the log line remain the signals.

    Args:
        exc: the swallowed exception, or None for a degraded path that produced
            no exception at all (an empty model response) — that case is sent as
            a message so it is not silently unreportable.

    Never raises: a telemetry failure must not turn a degraded extraction into a
    hard error on the production spawn path.
    """
    dsn = os.environ.get("SENTRY_DSN")
    if not dsn:
        return

    global _sentry_initialised
    try:
        import sentry_sdk

        if not _sentry_initialised:
            try:
                from sentry_sdk.integrations.atexit import AtexitIntegration

                integrations = [AtexitIntegration()]
            except Exception:  # noqa: BLE001 — SDK layout changed; flush() below still covers us.
                integrations = []

            sentry_sdk.init(
                dsn=dsn,
                traces_sample_rate=0.0,
                # C-07 / ROPA BOUNDARY — DO NOT REMOVE. Sentry's default
                # include_local_variables=True serialises each frame's locals into
                # the event, and the frames on this traceback hold `messages` (the
                # buyer's raw chat text) and `raw_text` (the model response). That
                # would ship the whole transcript to a third-party US processor,
                # breaking the "no free text, no message content" assertion in
                # docs/compliance/dpia.md, ropa.md and C-07 — a strictly larger
                # disclosure than the exception-message echo those documents
                # contemplate. send_default_pii is defaulted off, pinned here so a
                # future edit has to argue with a comment before flipping it.
                include_local_variables=False,
                send_default_pii=False,
                # This process is not a Sentry-instrumented service: initialising
                # mid-request with the defaults would retroactively install
                # LoggingIntegration (every ERROR log becomes an event) and the
                # auto-enabling FastAPI/Starlette integration on an already-running
                # container, burying the extraction issues the DSN was turned on
                # for. AtexitIntegration is re-added explicitly because it is NOT
                # noise: the realtime tier runs in a fire-and-forget Modal
                # container that exits immediately after this call, and without an
                # atexit flush the daemon transport thread is killed with the
                # interpreter and the queued event never ships.
                default_integrations=False,
                integrations=integrations,
            )
            _sentry_initialised = True

        with sentry_sdk.new_scope() as scope:
            scope.set_tag("area", "chat_intent")
            scope.set_tag("kind", "extraction_error")
            scope.set_tag("error_kind", kind)
            scope.set_tag("stage", stage)
            scope.set_tag("source", source)
            scope.set_tag("model_family", _model_family(model))
            if exc is not None:
                sentry_sdk.capture_exception(exc)
            else:
                sentry_sdk.capture_message(
                    f"chat intent extraction degraded: {kind}", level="error"
                )
        # Belt to AtexitIntegration's braces: a spawned Modal container can be torn
        # down hard enough that atexit hooks do not run.
        #
        # 0.3s, not the 2s an earlier cut used, and the honest arithmetic: this is
        # NOT free. §C.3 budgets <500ms for a realtime extraction, so a 2s flush was
        # 4x the whole budget while a comment claimed it "can never dominate" it —
        # false. Worse, `jobs/batch_enrich.py` runs under Modal's 300s default with
        # no override, so a per-session flush stacks: at 2s a ~150-session outage
        # killed the entire 6h enrichment window and surfaced as a Modal timeout
        # rather than the extraction outage it was. At 0.3s the realtime cost is a
        # ~60% overshoot on an ALREADY-degraded call (the happy path never reaches
        # this line) and the batch tier can absorb ~1000 sessions.
        sentry_sdk.flush(timeout=0.3)
    except Exception as telemetry_exc:  # noqa: BLE001 — telemetry must never escalate.
        print(f"_capture_extraction_error failed: {telemetry_exc}")


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
        # A parsed response IS a model read, including when every dimension came
        # back null — that is the case FOLLOW-730 exists to keep distinguishable
        # from the error fallback.
        data_source="model",
        extraction_error=None,
    )


def _call_model(messages: list[Message], model: str) -> str:
    """Make the single Anthropic extraction call and return the raw text.

    Imported inside the function for Modal image compatibility (mirrors the
    llm-gateway pattern). Raises on API error — caught by extract_intent.
    """
    import anthropic

    api_key = os.environ["ANTHROPIC_API_KEY"]
    if not api_key.strip():
        # A set-but-blank key is a real and common Doppler/Modal-secret
        # misconfiguration. `anthropic.Anthropic(api_key="")` constructs happily
        # and only fails later as a 401 AuthenticationError, which reads as an
        # upstream problem rather than the config problem it is — so fail here,
        # in the shape _classify_extraction_error maps to "missing_api_key".
        raise KeyError("ANTHROPIC_API_KEY (set but empty)")
    client = anthropic.Anthropic(api_key=api_key)
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
    Which of those paths produced the payload is recorded in `data_source`
    (FOLLOW-730) — the dimensions are identical either way, so that field is the
    only thing separating a degraded extraction from a genuinely neutral buyer.
    """
    message_count = len(messages)
    if message_count == 0:
        return _neutral_payload(message_count, model, source, data_source="empty_input")

    try:
        raw_text = _call_model(messages, model)
        if not raw_text.strip():
            # Degraded, but nothing raised (HTTP 200 with a tool/thinking-only
            # content block, or a max_tokens-truncated empty text). Without this
            # leg it was the one degraded path with NO log and NO capture — a
            # green wire and a still archetype, i.e. the pre-fix symptom intact.
            print(f"extract_intent empty model response model={model} source={source}")
            _capture_extraction_error(
                None,
                model=model,
                source=source,
                kind="empty_model_response",
                stage="primary",
            )
            return _neutral_payload(
                message_count, model, source, data_source="empty_model_response"
            )
        payload = _parse_response(raw_text, message_count, model, source)
    except Exception as exc:  # noqa: BLE001 — guardrail: never raise from here.
        kind = _classify_extraction_error(exc)
        print(f"extract_intent error model={model} source={source}: {exc}")
        _capture_extraction_error(exc, model=model, source=source, kind=kind, stage="primary")
        return _neutral_payload(
            message_count,
            model,
            source,
            data_source="error_fallback",
            extraction_error=f"{kind}: {type(exc).__name__}",
        )

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
            # Retry returned whitespace only (max_tokens truncation on a longer
            # mixed-language transcript, or a thinking/tool-only block). Nothing
            # raised, so without this arm the function fell straight through to
            # `return payload` with no log, no capture and no marker — the fix
            # round closed exactly this hole on the primary path and left it open
            # one branch over.
            print(f"extract_intent multilingual retry returned empty model={SONNET_MODEL}")
            _capture_extraction_error(
                None,
                model=SONNET_MODEL,
                source=source,
                kind="empty_model_response",
                stage="retry",
            )
            payload.extraction_error = "retry_failed: empty_model_response"
        except Exception as exc:  # noqa: BLE001 — keep the Haiku result on retry failure.
            retry_kind = _classify_extraction_error(exc)
            print(f"extract_intent multilingual retry error: {exc}")
            _capture_extraction_error(
                exc,
                model=SONNET_MODEL,
                source=source,
                kind=retry_kind,
                stage="retry",
            )
            # data_source stays "model": the payload below IS a real Haiku read,
            # only the Sonnet upgrade was lost, so calling it degraded would be a
            # lie in the other direction. But it does NOT stay unmarked — with
            # SENTRY_DSN unset (its actual prod state) the capture above returns
            # immediately, and a systematically broken Sonnet retry would then be
            # 100% invisible: every mixed-language buyer silently keeps the
            # low-confidence read forever. extraction_error carries that fact
            # into Redis where an operator can see it.
            payload.extraction_error = f"retry_failed: {type(exc).__name__}"

    return payload
