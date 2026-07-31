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

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

_SRC_DIR = Path(__file__).parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

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
