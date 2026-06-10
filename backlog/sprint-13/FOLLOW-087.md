# FOLLOW-087 — Chat NLP in apps/intent-engine (Haiku 4.5 real-time + Sonnet 4.6 batch)

**Agent:** ml-engineer  
**Priority:** P1  
**Estimated hours:** 12  
**Depends on:** FOLLOW-040 (DONE), FOLLOW-063 (DONE), ESC-009 (RESOLVED), ESC-010 (RESOLVED)  
**Branch:** `ml-engineer/FOLLOW-087-chat-nlp-intent-engine`  
**Model:** opus-4.8

---

## Context

`apps/intent-engine/src/main.py` is currently a 27-line placeholder. This ticket builds the full
two-tier chat NLP pipeline per Master Design §C.3:

- **Real-time tier** — Claude Haiku 4.5 (`claude-haiku-4-5-20251001`), <500ms latency budget
- **Batch tier** — Claude Sonnet 4.6 (`claude-sonnet-4-6`), 6h cron, full conversation context

Both tiers produce an identical 12-dim `ChatIntentDimensions` vector and emit a
`chat.intent.detected` event to Upstash Redis (shadow-only namespace — no UX effect in Sprint 13).

**Shadow-only constraint:** All writes go to Redis key `shadow:{tenant_id}:{session_id}:chat_intent`
— NOT the main intent key. This enables post-pilot disagreement-rate analysis between behavioral and
chat predictions without affecting any live adaptation. Do NOT write to the main intent namespace in
this ticket.

**FOLLOW-101 dependency:** This ticket stabilizes the `chat.intent.detected` schema so FOLLOW-101
(SDK bridge) can consume it. The schema defined in AC-2 is the contract.

---

## Acceptance Criteria

### AC-1: pyproject.toml dependencies

Add to `apps/intent-engine/pyproject.toml` under `[project] dependencies`:

```toml
dependencies = [
  "anthropic>=0.28",
  "modal>=0.73",
  "upstash-redis>=1.0",
  "sentry-sdk>=2.0",
  "pydantic>=2.7",
]
```

Dev extras (already present, keep): pytest, pytest-asyncio, mypy, ruff, black.

### AC-2: ChatIntentDimensions schema (Pydantic)

Create `apps/intent-engine/src/schemas.py` with the canonical Pydantic models. This file is the
contract consumed by FOLLOW-101.

```python
from __future__ import annotations
from pydantic import BaseModel
from typing import Literal, Optional

class ChatIntentDimensions(BaseModel):
    purchase_purpose: Optional[str] = None   # primary_residence|second_home|investment|vacation_rental|retirement|relocation
    urgency: Optional[str] = None            # exploratory|0-3mo|3-6mo|6-12mo|12mo+
    budget_band: Optional[str] = None        # stretch|comfortable|well_below
    family_stage: Optional[str] = None       # single|couple|young_family|established_family|empty_nester|retiree
    geo_priority: Optional[str] = None       # school_district|commute|lifestyle|beach|mountain|urban_center
    feature_priority: Optional[str] = None   # free-form tag (garden, pool, workspace, …)
    cross_border: Optional[str] = None       # domestic|eu_intra|foreign_buyer|expat_returning
    finance_complexity: Optional[str] = None # cash|standard_mortgage|foreign_mortgage|investment_vehicle|mortgage_uncertain
    decision_role: Optional[str] = None      # decider|influencer|researcher_for_others
    risk_appetite: Optional[str] = None      # conservative|balanced|aggressive
    emotional_state: Optional[str] = None    # excited|frustrated|comparison_shopping|validating_choice
    tax_aware: Optional[bool] = None

class ChatIntentDetectedPayload(BaseModel):
    tenant_id: str
    session_id: str
    intent_dimensions: ChatIntentDimensions
    archetype_hint: str                      # top archetype from the 18 in §D.6
    confidence: float                        # 0–1 combined confidence
    model_used: Literal['haiku-4.5', 'sonnet-4.6']
    source: Literal['realtime', 'batch']
    message_count: int                       # number of messages in context
    detected_at: str                         # ISO 8601
```

### AC-3: NLP extractor (shared between real-time and batch)

Create `apps/intent-engine/src/nlp.py`.

**`extract_intent(messages: list[dict], model: str, source: str) -> ChatIntentDetectedPayload`**

`messages` is a list of `{"role": "user"|"assistant", "content": str}` dicts (the conversation so
far). For real-time, pass the single new message only. For batch, pass the full conversation.

**System prompt requirements:**

- Instruct the model to extract only what is explicitly stated or strongly implied
- Return a JSON object with exactly the `ChatIntentDimensions` fields
- Unknown/ambiguous → set the field to `null` (do NOT guess)
- Include all 12 dimension names with their allowed values in the prompt
- Language: respond in English regardless of input language (PL/EN/ES supported)
- Add an `archetype_hint` field: the single most likely archetype from the 18 in §D.6 (yield_hunter,
  vacation_rental_investor, flip_investor, portfolio_builder, golden_visa_buyer,
  commercial_investor, family_buyer, first_time_buyer, upsizer, downsizer, luxury_buyer,
  remote_worker, lifestyle_expat, retiree_relocator, diaspora_buyer, second_home_buyer,
  student_parent, neutral)
- Add a `confidence` field: 0.0–1.0 float (how many dimensions were determinable)

**Multilingual fallback (§C.3):** If the message(s) contain a mix of languages (detect by checking
for PL/ES characters or keywords alongside English), and `model == HAIKU_MODEL`, retry once with
`SONNET_MODEL` if `confidence < 0.6`. Implement `detect_language_mix(text: str) -> bool` heuristic
(check for Polish diacritics: ą,ę,ó,ś,ź,ż,ć,ń,ł, or Spanish: ñ,á,é,í,ó,ú,ü,¿,¡).

**Anthropic client:** Use `anthropic.Anthropic()` (sync) — same pattern as `llm-gateway`. Use
`client.messages.create()` with `model=model`, `max_tokens=512`, and a structured JSON-extraction
prompt. Parse the JSON from the response text.

**Error handling:** On any Anthropic exception or JSON parse failure, return a
`ChatIntentDetectedPayload` with all `intent_dimensions` fields null, `confidence=0.0`, and
`archetype_hint='neutral'`. Do NOT raise. Log via `print()` (Sentry wiring is P3).

### AC-4: Real-time Modal function

In `apps/intent-engine/src/main.py`, implement:

```python
import modal

app = modal.App("estalara-intent-engine")

image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "anthropic>=0.28", "upstash-redis>=1.0", "pydantic>=2.7"
)

@app.function(image=image, secrets=[modal.Secret.from_name("estalara-secrets")])
def process_chat_message(
    tenant_id: str,
    session_id: str,
    message: dict,           # {"role": "user", "content": str}
    conversation_history: list[dict] | None = None,
) -> dict:
    """Real-time intent extraction from a single chat message. <500ms target."""
    import os
    from .nlp import extract_intent
    from .redis_writer import write_shadow_intent

    model = os.environ.get("INTENT_REALTIME_MODEL", "claude-haiku-4-5-20251001")
    messages = (conversation_history or []) + [message]
    payload = extract_intent(messages, model=model, source="realtime")
    payload.tenant_id = tenant_id
    payload.session_id = session_id
    write_shadow_intent(payload)
    return payload.model_dump()
```

Also keep the existing `get_service_info()` function but update `SERVICE_VERSION = "0.1.0"`.

### AC-5: Batch enrichment cron

In `apps/intent-engine/src/jobs/batch_enrich.py`:

```python
import modal
from ..main import app, image

@app.function(
    image=image,
    secrets=[modal.Secret.from_name("estalara-secrets")],
    schedule=modal.Cron("0 */6 * * *"),   # every 6 hours
)
def batch_enrich_conversations() -> dict:
    """Re-process recent conversations with Sonnet 4.6 for higher-quality intent extraction.

    Reads from ClickHouse: chat messages from the last 6h (chat.message.sent events).
    Writes enriched intent to Redis shadow namespace.
    Returns summary: {"processed": N, "errors": N}.
    """
    import os
    from ..nlp import extract_intent
    from ..redis_writer import write_shadow_intent
    from ..clickhouse_reader import read_recent_chat_sessions

    model = os.environ.get("INTENT_BATCH_MODEL", "claude-sonnet-4-6")
    sessions = read_recent_chat_sessions(hours=6)
    processed, errors = 0, 0

    for session in sessions:
        try:
            payload = extract_intent(
                session["messages"], model=model, source="batch"
            )
            payload.tenant_id = session["tenant_id"]
            payload.session_id = session["session_id"]
            write_shadow_intent(payload)
            processed += 1
        except Exception as e:
            print(f"batch_enrich error: {e}")
            errors += 1

    return {"processed": processed, "errors": errors}
```

### AC-6: Redis shadow writer

Create `apps/intent-engine/src/redis_writer.py`:

```python
import os, json
from upstash_redis import Redis
from .schemas import ChatIntentDetectedPayload

_redis: Redis | None = None

def _get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis(
            url=os.environ["UPSTASH_REDIS_REST_URL"],
            token=os.environ["UPSTASH_REDIS_REST_TOKEN"],
        )
    return _redis

def write_shadow_intent(payload: ChatIntentDetectedPayload, ttl_seconds: int = 86400) -> None:
    """Write intent to shadow namespace. Key: shadow:{tenant_id}:{session_id}:chat_intent"""
    key = f"shadow:{payload.tenant_id}:{payload.session_id}:chat_intent"
    _get_redis().set(key, json.dumps(payload.model_dump()), ex=ttl_seconds)
```

### AC-7: ClickHouse reader (stub for batch)

Create `apps/intent-engine/src/clickhouse_reader.py`.

For Sprint 13, implement as a **stub** that returns an empty list (full ClickHouse query in
FOLLOW-101 or a separate ticket). This is sufficient for the batch cron to run without failing:

```python
def read_recent_chat_sessions(hours: int = 6) -> list[dict]:
    """Read recent chat sessions from ClickHouse. Stub for Sprint 13 — returns []."""
    # TODO FOLLOW-101: implement real ClickHouse query over default.events
    # WHERE event_type = 'chat.message.sent' AND timestamp > now() - INTERVAL hours HOUR
    return []
```

### AC-8: Tests

Create/update `apps/intent-engine/src/test_intent_engine.py`:

1. **`test_extract_intent_investment_message`** — pass a user message like "I'm looking for a
   high-yield investment property" → assert `purchase_purpose == 'investment'` and `archetype_hint`
   in investor archetypes. Use `pytest.mark.skipif` with env var guard (skip if `ANTHROPIC_API_KEY`
   not set — same pattern as other Modal apps).

2. **`test_extract_intent_family_message`** — "We need a 4-bed near good schools for our two kids" →
   assert `family_stage` is not None, `geo_priority == 'school_district'`.

3. **`test_extract_intent_empty_messages`** — pass `[]` → returns payload with all dims null,
   confidence 0.0, archetype_hint 'neutral'. (Does NOT need API key.)

4. **`test_detect_language_mix_polish`** — "Szukam mieszkania w Krakowie" → returns True.

5. **`test_detect_language_mix_english_only`** — "Looking for a house" → returns False.

6. **`test_write_shadow_intent_key_format`** — mock Redis, call `write_shadow_intent()`, assert the
   key is `shadow:tnt_test:sess_test:chat_intent`. (Does NOT need Redis.)

7. **`test_get_service_info`** — `get_service_info()["version"] == "0.1.0"`. (Already covers the
   existing test in `test_main.py` — update or keep both.)

Test coverage target: ≥70% for `apps/intent-engine` (app target per CLAUDE.md).

### AC-9: QUEUE.md update

After opening the PR, update `backlog/QUEUE.md`:

- FOLLOW-087 status → `READY_FOR_REVIEW`, add `pr:` field
- FOLLOW-101 status → `READY` (unblocked: depends on FOLLOW-087 + FOLLOW-100, both now DONE)

---

## Files to create / modify

| File                                           | Action                                                  |
| ---------------------------------------------- | ------------------------------------------------------- |
| `apps/intent-engine/pyproject.toml`            | Add dependencies                                        |
| `apps/intent-engine/src/main.py`               | Replace placeholder with Modal app + real-time function |
| `apps/intent-engine/src/schemas.py`            | New — Pydantic models (canonical contract)              |
| `apps/intent-engine/src/nlp.py`                | New — extract_intent + detect_language_mix              |
| `apps/intent-engine/src/redis_writer.py`       | New — shadow namespace writer                           |
| `apps/intent-engine/src/clickhouse_reader.py`  | New — stub                                              |
| `apps/intent-engine/src/jobs/__init__.py`      | New (empty)                                             |
| `apps/intent-engine/src/jobs/batch_enrich.py`  | New — 6h cron                                           |
| `apps/intent-engine/src/test_intent_engine.py` | New — tests                                             |

---

## PR requirements

- Branch: `ml-engineer/FOLLOW-087-chat-nlp-intent-engine`
- Commit:
  `feat(intent): two-tier chat NLP pipeline (Haiku 4.5 realtime + Sonnet 4.6 batch) [FOLLOW-087]`
- CI real gates must be green: Typecheck, Lint, Format, Rule H, Rule J, Cross-language contract
- `pytest apps/intent-engine/` must pass (API-key-requiring tests skip without key)
- `black --check` + `ruff check` on all new Python files
- `mypy --strict` on `schemas.py` and `nlp.py` (these are the contract files)
