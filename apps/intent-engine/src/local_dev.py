"""
Local-only FastAPI entrypoint for chat_nlp_endpoint (FOLLOW-729).

`main.py`'s `chat_nlp_endpoint` is built with `@modal.fastapi_endpoint()`
stacked on `@app.function()` — Modal's own ASGI synthesis, not a bare
`FastAPI()` instance, so there is no object a plain `uvicorn` can serve and
the endpoint is unreachable on localhost. `modal serve` is the Modal-native
local-dev path, but it still requires Modal credentials and produces an
ephemeral tunnel URL, not `localhost:PORT`.

The underlying computation has zero Modal coupling: `nlp.extract_intent` and
`redis_writer.write_shadow_intent` are plain Python functions. This module
wraps them in a bare `FastAPI()` app exposing the SAME `POST
/chat_nlp_endpoint` route shape, so the ingest Worker's dev config
(`MODAL_CHAT_NLP_URL=http://localhost:<port>/chat_nlp_endpoint`) can reach a
real local server. See `apps/intent-engine/README.md` for the run command and
required env vars.

Run: `uvicorn local_dev:app --reload --port 8090` (from `apps/intent-engine/src`).

--- Duplication note (source of truth = main.py) ---

`_valid_bearer` and the request-body validation below are DUPLICATED from
`main.py:88-161`, not imported. A clean import of `main.py` would pull in
`modal.App(...)` / `@app.function(...)` / `@modal.fastapi_endpoint(...)`,
which (unlike the pytest `conftest.py` stub) are NOT no-ops when the real
`modal` package is installed — so `chat_nlp_endpoint` from `main.py` is not a
plain callable outside a `modal run`/`modal serve` context. Keep the two
copies in step: any change to `main.py`'s auth or `_CHAT_NLP_REQUIRED`
validation logic must be mirrored here.

--- Behavioural difference from production (intentional) ---

Production's `chat_nlp_endpoint` calls `process_chat_message.spawn(...)`
(fire-and-forget) and returns 202 immediately; the shadow Redis write happens
asynchronously in a separate Modal container. This local shim has no spawn
mechanism, so it runs `extract_intent` + `write_shadow_intent`
SYNCHRONOUSLY in-process before responding — by the time the HTTP response comes
back, the shadow key is already written. This makes local round-trip
verification deterministic (see `test_local_dev.py`).

The response contract DOES differ from production (FOLLOW-730): on a degraded
extraction this shim answers 502, where production always answers 202 because it
returns before extraction even runs. That divergence is the point — a 202 over a
dead model call is the fail-green this ticket exists to remove — but it has a
consequence worth knowing before you debug: the ingest Worker's dispatcher
(`apps/ingest/src/handlers/chat-nlp-dispatch.ts:83-92`) treats any `!res.ok` as a
DISPATCH failure and logs/reports `kind: 'dispatch_failed'`. So against this shim
a missing `ANTHROPIC_API_KEY` surfaces Worker-side as "Modal dispatch rejected:
HTTP 502", which is a transport-shaped message for a credentials-shaped problem.
Read the 502 body (`extraction_error`) rather than the Worker log line.

Explicitly OUT of scope (FOLLOW-729 AC4): no change to `main.py`'s production
Modal wiring, no Modal deploy, no batch-tier (`jobs/batch_enrich.py`) change.
This file is additive-only.
"""

from __future__ import annotations

import hmac
import os
from typing import Any

from fastapi import Body, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

from nlp import extract_intent
from redis_writer import _DEGRADED_SOURCES, write_shadow_intent

SERVICE_NAME = "estalara-intent-engine-local-dev"

app = FastAPI(title=SERVICE_NAME)

# Mirrors main.py:52 exactly — keep in step.
_CHAT_NLP_REQUIRED = frozenset({"tenant_id", "session_id", "message"})


def _valid_bearer(authorization: str | None) -> bool:
    """Validate ``Authorization: Bearer <INTERNAL_API_SECRET>`` (constant-time).

    DUPLICATED from main.py:88-100 — see module docstring. Fails closed when
    the secret is unset/empty or the header is missing/wrong.
    """
    expected = os.environ.get("INTERNAL_API_SECRET", "")
    if not expected or not authorization:
        return False
    scheme, _, token = authorization.partition(" ")
    if scheme != "Bearer" or not token:
        return False
    return hmac.compare_digest(token, expected)


@app.get("/health")
async def health() -> dict[str, str]:
    """Trivial liveness check so a manual smoke step can confirm the server is up
    before POSTing (see apps/intent-engine/README.md)."""
    return {"service": SERVICE_NAME, "status": "active"}


@app.post("/chat_nlp_endpoint")
async def chat_nlp_endpoint(
    body: dict[str, Any] = Body(...),
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    """Local-only mirror of `main.chat_nlp_endpoint` (FOLLOW-729).

    Auth: ``Authorization: Bearer <INTERNAL_API_SECRET>``.
    Body: ``tenant_id``, ``session_id``, ``message`` ({role, content}), optional
    ``profiling_opt_out`` (bool, default false).

    Validation logic below is DUPLICATED from main.py:125-150 — see module
    docstring for why (and the requirement to keep both in step).

    Runs extraction + the shadow write synchronously (no `.spawn()` — there is
    no Modal container to spawn into locally) and returns 202, matching the
    production response shape.
    """
    if not _valid_bearer(authorization):
        raise HTTPException(status_code=401, detail="unauthorized")

    missing = _CHAT_NLP_REQUIRED - set(body.keys())
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"missing required fields: {sorted(missing)}",
        )

    message = body.get("message")
    if not isinstance(message, dict) or not str(message.get("content", "")).strip():
        raise HTTPException(
            status_code=400,
            detail="message must be an object with non-empty content",
        )

    tenant_id = str(body["tenant_id"]).strip()
    session_id = str(body["session_id"]).strip()
    if not tenant_id or not session_id:
        raise HTTPException(
            status_code=400,
            detail="tenant_id and session_id must be non-empty strings",
        )

    profiling_opt_out = bool(body.get("profiling_opt_out", False))
    message_obj = {
        "role": str(message.get("role") or "user"),
        "content": str(message["content"]),
    }

    # Same call shape as main.process_chat_message (mirrors main.py:76-84),
    # run inline rather than via Modal's .spawn().
    model = os.environ.get("INTENT_REALTIME_MODEL", "claude-haiku-4-5-20251001")
    payload = extract_intent([message_obj], model=model, source="realtime")
    payload.tenant_id = tenant_id
    payload.session_id = session_id
    shadow_key_written = write_shadow_intent(payload, profiling_opt_out=profiling_opt_out)

    # FOLLOW-730 AC4 — local-only degraded signal. `extract_intent` never raises,
    # so before this an absent ANTHROPIC_API_KEY produced a healthy-looking 202
    # plus a neutral shadow key: a green wire with zero archetype movement, which
    # is indistinguishable at a glance from a writer/reader Upstash DB mismatch
    # (RETRO-233 §4a LG-1/LG-3, ESC-045). Surfacing it here is safe ONLY because
    # this file is local-only — see the module docstring for how it looks from the
    # ingest Worker's side, which is NOT what production does.
    #
    # BOTH degraded provenance values are covered: `empty_model_response` (HTTP
    # 200 with no usable text) is just as fail-green as a raised error, and
    # covering only `error_fallback` left half the hole open.
    #
    # `shadow_key_written` is reported rather than assumed: under §H.9 opt-out no
    # key is written at all, and under the degraded-clobber guard the key holds
    # the OLDER good prior — telling an operator to `GET shadow:{t}:{s}:chat_intent`
    # when nothing was written sends them chasing a phantom Redis mismatch, which
    # is the exact misdiagnosis this ticket exists to prevent.
    if payload.data_source in _DEGRADED_SOURCES:
        return JSONResponse(
            status_code=502,
            content={
                "status": "degraded",
                "data_source": payload.data_source,
                "extraction_error": payload.extraction_error,
                "shadow_key_written": shadow_key_written,
            },
        )

    return JSONResponse(status_code=202, content={"status": "accepted"})
