"""
Tests for the shared hardened Sentry initialiser (FOLLOW-738).

Import strategy matches test_intent_engine.py: modules in src/ are installed
as top-level modules by the editable install, so we import observability by
bare name and ensure src/ is on sys.path for direct invocation too.

This file tests the CANONICAL copy (apps/intent-engine/src/observability.py).
The two mirrors (apps/llm-gateway/src/jobs/observability.py,
apps/data-quality/src/crons/observability.py) are proven identical by the
Rule J CI gate (scripts/check-mirror-files.sh) and are exercised indirectly
by each app's own call-site tests.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

_SRC_DIR = Path(__file__).parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

import nlp  # noqa: E402  — FOLLOW-739 AC3 needs the Redis-payload sink too
import observability  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_latch() -> None:
    """Every test gets a fresh (uninitialised) module state."""
    observability._sentry_initialised = False


def test_init_sentry_is_noop_without_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    """The ONLY allowed skip condition: the named DSN env var is unset."""
    fake_sentry = MagicMock()
    monkeypatch.delenv("SOME_DSN_NAME", raising=False)
    monkeypatch.setitem(sys.modules, "sentry_sdk", fake_sentry)

    result = observability.init_sentry("SOME_DSN_NAME")

    assert result is False
    fake_sentry.init.assert_not_called()
    assert observability._sentry_initialised is False


def test_init_sentry_hardens_config_when_dsn_set(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_sentry = MagicMock()
    monkeypatch.setenv("SOME_DSN_NAME", "dsn-placeholder")
    monkeypatch.setitem(sys.modules, "sentry_sdk", fake_sentry)

    result = observability.init_sentry("SOME_DSN_NAME")

    assert result is True
    fake_sentry.init.assert_called_once()
    kwargs = fake_sentry.init.call_args.kwargs
    assert kwargs["dsn"] == "dsn-placeholder"
    assert kwargs["include_local_variables"] is False
    assert kwargs["send_default_pii"] is False
    assert kwargs["default_integrations"] is False
    assert kwargs["before_send"] is observability._scrub_chat_intent_exception_value


def test_init_sentry_never_raises_on_malformed_dsn(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """FOLLOW-744: a hand-pasted malformed DSN must degrade to "Sentry off",
    not crash the caller. sentry_sdk.init() raises BadDsn on a malformed DSN
    — this is the exact failure mode of the operator action that provisions
    SENTRY_DSN. Only 1 of the 4 real call sites has its own try/except, so
    init_sentry itself must never raise."""
    fake_sentry = MagicMock()

    class BadDsn(Exception):  # noqa: N818 — matches sentry_sdk's real exception name
        pass

    fake_sentry.init.side_effect = BadDsn("Invalid Sentry DSN: not-a-real-dsn")
    monkeypatch.setenv("SOME_DSN_NAME", "not-a-real-dsn")
    monkeypatch.setitem(sys.modules, "sentry_sdk", fake_sentry)

    result = observability.init_sentry("SOME_DSN_NAME")  # must not raise

    assert result is False
    assert observability._sentry_initialised is False
    assert "init_sentry" in capsys.readouterr().out


def test_init_sentry_is_idempotent_across_call_sites(monkeypatch: pytest.MonkeyPatch) -> None:
    """A second call site (e.g. a second capture in the same process) must not
    re-init — matching the original per-site lazy-init behaviour this module
    replaces, now shared across every call site in the process."""
    fake_sentry = MagicMock()
    monkeypatch.setenv("SOME_DSN_NAME", "dsn-placeholder")
    monkeypatch.setitem(sys.modules, "sentry_sdk", fake_sentry)

    first = observability.init_sentry("SOME_DSN_NAME")
    second = observability.init_sentry("SOME_DSN_NAME")

    assert first is True
    assert second is True
    fake_sentry.init.assert_called_once()


def test_flush_sentry_uses_bounded_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_sentry = MagicMock()
    monkeypatch.setitem(sys.modules, "sentry_sdk", fake_sentry)

    observability.flush_sentry(0.3)

    fake_sentry.flush.assert_called_once_with(timeout=0.3)


def test_flush_sentry_never_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_sentry = MagicMock()
    fake_sentry.flush.side_effect = RuntimeError("transport down")
    monkeypatch.setitem(sys.modules, "sentry_sdk", fake_sentry)

    observability.flush_sentry(0.3)  # must not raise


def test_scrub_drops_chat_intent_exception_value() -> None:
    """AC3: the chat-intent path's exception `value` string (which can echo
    buyer chat text) is dropped; other tags pass through the value fields
    untouched."""
    event = {
        "tags": {"area": "chat_intent", "kind": "extraction_error"},
        "exception": {"values": [{"type": "JSONDecodeError", "value": "raw buyer text leak"}]},
    }

    result = observability._scrub_chat_intent_exception_value(event, {})

    assert result is not None
    assert "raw buyer text leak" not in result["exception"]["values"][0]["value"]


def test_scrub_leaves_non_chat_intent_events_untouched() -> None:
    event = {
        "tags": {"area": "onboarding", "kind": "embed_failed"},
        "exception": {"values": [{"type": "ValueError", "value": "listing 123 not found"}]},
    }

    result = observability._scrub_chat_intent_exception_value(event, {})

    assert result["exception"]["values"][0]["value"] == "listing 123 not found"


def test_scrub_handles_list_shaped_tags() -> None:
    """Sentry SDK internals have represented `event["tags"]` as either a dict
    or a list of [name, value] pairs across versions/serialisation stages —
    handled defensively rather than assuming one shape."""
    event = {
        "tags": [["area", "chat_intent"]],
        "exception": {"values": [{"type": "ValueError", "value": "buyer text"}]},
    }

    result = observability._scrub_chat_intent_exception_value(event, {})

    assert "buyer text" not in result["exception"]["values"][0]["value"]


def test_scrub_handles_missing_exception_gracefully() -> None:
    """A capture_message-only event (no `exception` key) must not raise."""
    event = {"tags": {"area": "chat_intent"}}

    result = observability._scrub_chat_intent_exception_value(event, {})

    assert result == event


# ── FOLLOW-739 AC3: the end-to-end buyer-text negative ────────────────────────

BUYER_TEXT_SENTINEL = "relocating to Lisbon in March, budget is 450k, wife is pregnant"


def test_buyer_text_escapes_both_sinks(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """One exception carrying buyer chat text must leak it into NONE of three sinks.

    This is the claim `docs/compliance/ropa.md` and `docs/compliance/dpia.md`
    §2.7 make to a regulator, pinned as a test rather than as prose. The
    realistic shape: `_parse_response` raises on a malformed model reply and
    `str(exc)` embeds a fragment of that reply — which can echo what the buyer
    typed. Three independent sinks are reachable from that one exception:

      1. Sentry — via `_capture_extraction_error`; neutralised by the
         `before_send` hook under test here.
      2. Redis (24 h TTL) — via the `error_fallback` payload's
         `extraction_error` field, which by contract carries only
         "<kind>: <ExceptionClassName>", never the message text.
      3. Modal's stdout log (FOLLOW-812) — via `extract_intent`'s
         primary-failure `print(...)`, which by contract now carries only
         "kind=<kind>: <ExceptionClassName>", never the message text. Unlike
         sinks 1/2, this sink has no scrubber and no CI-verified TTL of its
         own (see `docs/compliance/C-07-chat-retention-scope.md`), so it is
         the log line's own wording that must never carry the exception
         message — there is nothing downstream to catch a regression.

    Asserted over the WHOLE serialised structure (or captured stdout, for
    sink 3) rather than one field, so a change that routes the message into
    some other key/line (a breadcrumb, a new payload field, a second print)
    fails here instead of shipping silently.

    Non-vacuity was verified by perturbation, not assumed: disabling the
    redaction line in `observability.py` fails sink 1, substituting `{exc}`
    for `{type(exc).__name__}` in the payload fails sink 2, and reverting
    `nlp.py`'s primary-failure `print` to interpolate `{exc}` directly (its
    pre-FOLLOW-812 shape) fails sink 3.
    """
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    exc = ValueError(
        f"Expecting value: line 1 column 1 (char 0) — model returned: {BUYER_TEXT_SENTINEL}"
    )

    # Sink 1 — the Sentry event, shaped as the SDK hands it to before_send.
    event = {
        "tags": {"area": "chat_intent", "kind": "extraction_error"},
        "exception": {"values": [{"type": type(exc).__name__, "value": str(exc)}]},
    }
    scrubbed = observability._scrub_chat_intent_exception_value(event, {})
    assert scrubbed is not None
    assert BUYER_TEXT_SENTINEL not in json.dumps(scrubbed)

    # Sink 2 — the payload that lands in Redis, built exactly as nlp.py's
    # primary-failure branch builds it.
    payload = nlp._neutral_payload(
        message_count=3,
        model="haiku-4.5",
        source="realtime",
        data_source="error_fallback",
        extraction_error=f"{nlp._classify_extraction_error(exc)}: {type(exc).__name__}",
    )
    assert BUYER_TEXT_SENTINEL not in json.dumps(payload.model_dump())

    # Sink 3 — Modal's stdout log, exercised through the REAL primary-failure
    # branch of extract_intent (not re-synthesised, unlike sinks 1/2 above),
    # so a future edit to the print statement itself is caught here.
    # `_capture_extraction_error` is stubbed out: sinks 1/2 already pin its
    # behaviour directly, and this block isolates the print line under test.
    monkeypatch.setattr(nlp, "_capture_extraction_error", MagicMock())
    monkeypatch.setattr(nlp, "_call_model", MagicMock(side_effect=exc))
    capsys.readouterr()  # drain anything buffered before this block
    nlp.extract_intent(
        [{"role": "user", "content": "irrelevant — the model call is mocked"}],
        model="claude-haiku-4-5-20251001",
        source="realtime",
    )
    captured_stdout = capsys.readouterr().out
    assert BUYER_TEXT_SENTINEL not in captured_stdout
    # And non-vacuous in the other direction: the log line still records
    # something actionable (kind + exception class), it isn't just silenced.
    assert "kind=parse_error" in captured_stdout
    assert type(exc).__name__ in captured_stdout

    # …and the guard is non-vacuous: the sentinel really is in the exception.
    assert BUYER_TEXT_SENTINEL in str(exc)
