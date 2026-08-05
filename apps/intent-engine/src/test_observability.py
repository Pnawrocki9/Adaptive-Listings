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


def test_buyer_text_escapes_all_sinks(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """One exception carrying buyer chat text must leak it into NONE of three
    sinks, across four call arms (FOLLOW-832 rename — the prior name said
    "both sinks", i.e. two, which undercounted even before this fix).

    Keep this name short. `gitleaks`' `cloudflare-api-token` rule matches a
    40-char run of `[A-Za-z0-9_-]` AND gates on Shannon entropy, so length
    alone is not the trigger: several 40+ char names in this very file (e.g.
    `test_scrub_leaves_non_chat_intent_events_untouched`, 50 chars) have
    always passed the scan. The first, more descriptive rename attempted
    here — 45 chars, entropy 3.69 — cleared that threshold and failed the
    secrets scan on PR #678 where the name is quoted in
    `docs/compliance/C-07-chat-retention-scope.md` and `ropa.md`. Renaming
    was chosen over a `.gitleaksignore` fingerprint so the scanner keeps
    full strength over the compliance docs.

    This is the claim `docs/compliance/ropa.md` and `docs/compliance/dpia.md`
    §2.7 make to a regulator, pinned as a test rather than as prose. The
    realistic shape: `_parse_response` raises on a malformed model reply and
    `str(exc)` embeds a fragment of that reply — which can echo what the buyer
    typed. Three sinks are reachable from that one exception, across four arms:

      1. Sentry — via `_capture_extraction_error`; neutralised by the
         `before_send` hook under test here. Exercised directly against a
         re-synthesised event dict, not through `extract_intent`: the
         registration of `_scrub_chat_intent_exception_value` as the
         `before_send` hook is asserted separately
         (`test_init_sentry_hardens_config_when_dsn_set` above), so this is a
         legitimate unit test of the scrubber's own behaviour, not a false
         control (FOLLOW-832 AC4).
      2. Redis (24 h TTL) — via the `error_fallback` payload's
         `extraction_error` field, which by contract carries only
         "<kind>: <ExceptionClassName>", never the message text. Asserted over
         the ACTUAL payload `extract_intent` RETURNS on arm 3 below (and, by
         the same reasoning, on arm 3b) — not a test-authored replica of the
         production expression. FOLLOW-832: a prior version of this test built
         that payload itself via `nlp._neutral_payload(...)`, which measured
         the test's own copy of `nlp.py:504`'s `extraction_error=` expression
         rather than that expression itself, so a regression there shipped
         green.
      3. Modal's stdout log (FOLLOW-812) — via `extract_intent`'s
         primary-failure `print(...)`, which by contract now carries only
         "kind=<kind>: <ExceptionClassName>", never the message text. Unlike
         sink 1, this sink has no scrubber and no CI-verified TTL of its own
         (see `docs/compliance/C-07-chat-retention-scope.md`), so it is the
         log line's own wording that must never carry the exception message —
         there is nothing downstream to catch a regression. Exercised through
         the REAL primary-failure branch of `extract_intent` (not
         re-synthesised, unlike sink 1's block), so a future edit to either
         the print statement or the returned payload's `extraction_error`
         field is caught here. `_capture_extraction_error` is stubbed out:
         sink 1's block already pins its behaviour directly, and this block
         isolates the print line and the returned payload under test.
      3b. The SAME stdout sink AND the same Redis-bound payload field, reached
         through the multilingual-retry arm instead (Rule S sibling of arm 3).
         The block above drives only the primary-failure path: `_call_model`
         raises on its FIRST call, so the retry arm is never entered and its
         own `print` — and its own `extraction_error=f"retry_failed: ..."`
         assignment at `nlp.py:563`, a DIFFERENT expression from `nlp.py:504`
         — were both untested. Covering both here (not just the print) closes
         the retry arm's version of the same FOLLOW-832 gap on the primary
         arm, rather than leaving half of a symmetric pair unfixed.

    Asserted over the WHOLE serialised structure (or captured stdout, for
    sinks 3/3b) rather than one field, so a change that routes the message
    into some other key/line (a breadcrumb, a new payload field, a second
    print) fails here instead of shipping silently.

    Non-vacuity was verified by perturbation, not assumed (transcript in the
    FOLLOW-832 PR body): disabling the redaction line in `observability.py`
    fails sink 1; substituting `{exc}` for `{type(exc).__name__}` in
    `nlp.py:504`'s `extraction_error=` expression fails sink 2 via arm 3's
    returned-payload assertion (the prior test-authored-replica version of
    this assertion did NOT fail on this perturbation — that was the bug);
    and reverting `nlp.py`'s primary/retry `print` statements to interpolate
    `{exc}` directly (their pre-FOLLOW-812 shape) fails sinks 3/3b.
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

    # Arm 3 (sinks 2 + 3) — the REAL primary-failure branch of extract_intent,
    # exercised once. Its RETURN VALUE is the payload that lands in Redis
    # (sink 2); its stdout print IS sink 3. Both are asserted over what the
    # function actually produced, never a test-constructed replica.
    monkeypatch.setattr(nlp, "_capture_extraction_error", MagicMock())
    monkeypatch.setattr(nlp, "_call_model", MagicMock(side_effect=exc))
    capsys.readouterr()  # drain anything buffered before this block
    primary_payload = nlp.extract_intent(
        [{"role": "user", "content": "irrelevant — the model call is mocked"}],
        model="claude-haiku-4-5-20251001",
        source="realtime",
    )
    assert BUYER_TEXT_SENTINEL not in json.dumps(primary_payload.model_dump())
    captured_stdout = capsys.readouterr().out
    assert BUYER_TEXT_SENTINEL not in captured_stdout
    # And non-vacuous in the other direction: the log line still records
    # something actionable (kind + exception class), it isn't just silenced.
    assert "kind=parse_error" in captured_stdout
    assert type(exc).__name__ in captured_stdout

    # Arm 3b (sinks 2 + 3, retry) — the SAME stdout sink AND the same
    # Redis-bound `extraction_error` field, reached through the multilingual-
    # retry branch (Rule S sibling of arm 3). The block above drives only the
    # primary-failure path: `_call_model` raises on its FIRST call, so the
    # retry arm is never entered and its own `print` — and its own
    # `extraction_error=` assignment — were untested. Here the first call
    # succeeds with a low-confidence, mixed-language read (so the §C.3 retry
    # triggers) and the SECOND call raises.
    low_conf_mixed = json.dumps(
        {
            "purchase_purpose": None,
            "urgency": None,
            "budget_band": None,
            "family_stage": None,
            "geo_priority": None,
            "feature_priority": None,
            "cross_border": None,
            "finance_complexity": None,
            "decision_role": None,
            "risk_appetite": None,
            "emotional_state": None,
            "tax_aware": None,
            "confidence": 0.1,
        }
    )
    monkeypatch.setattr(nlp, "_call_model", MagicMock(side_effect=[low_conf_mixed, exc]))
    monkeypatch.setattr(nlp, "detect_language_mix", MagicMock(return_value=True))
    capsys.readouterr()  # drain
    retry_payload = nlp.extract_intent(
        [{"role": "user", "content": "mixed language input — model calls are mocked"}],
        model="claude-haiku-4-5-20251001",
        source="realtime",
    )
    assert BUYER_TEXT_SENTINEL not in json.dumps(retry_payload.model_dump())
    retry_stdout = capsys.readouterr().out
    assert BUYER_TEXT_SENTINEL not in retry_stdout
    # Non-vacuous in both directions: the retry arm really was entered, and it
    # still logs something actionable rather than being silenced.
    assert "multilingual retry error" in retry_stdout
    assert type(exc).__name__ in retry_stdout

    # …and the guard is non-vacuous: the sentinel really is in the exception.
    assert BUYER_TEXT_SENTINEL in str(exc)
