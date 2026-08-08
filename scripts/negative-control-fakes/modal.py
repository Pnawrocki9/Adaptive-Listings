"""A fake ``modal`` module for the FOLLOW-904 Rule Q negative control.

This is the analogue of the throwaway Postgres ``cron-heartbeat.yml`` starts for
``check-cron-heartbeat.sh``: it replaces the BACKEND, never the script under test. The
negative control runs the real ``scripts/check-modal-container-effect.py``, unmodified,
with ``PYTHONPATH=scripts/negative-control-fakes`` so that its lazy ``import modal``
resolves here. Nothing in the probe knows this file exists — no test seam, no injection
hook, no branch that only runs under test. That is the whole point: a detector that has
only ever been exercised through a seam has not observed its own failure.

Behaviour is selected by ``FAKE_MODAL_MODE``:

  healthy          Function.remote() returns a complete payload echoing the ids it was
                   called with — the shape a live container produces.
  module_not_found remote() raises ModuleNotFoundError("No module named 'nlp'") — the
                   EXACT FOLLOW-900 failure, one app over, and the reason this probe
                   exists at all.
  app_not_found    Function.from_name() raises — the app was never deployed / was renamed.
  wrong_payload    remote() returns a payload that does NOT echo the probe's ids, i.e. a
                   container that answered without executing main.py:100-101.
  empty_payload    remote() returns {} — an answer with no effect in it.
  not_a_dict       remote() returns a string.

This file is deliberately NOT importable as a package (`scripts/negative-control-fakes`
is not on any normal path) and is only ever reachable via an explicit PYTHONPATH.
"""

from __future__ import annotations

import os

__version__ = "fake-1.4.2"

_MODE = os.environ.get("FAKE_MODAL_MODE", "healthy")

_WEB_URL = "http://127.0.0.1:8931/"


class _FakeFunction:
    def __init__(self, app_name: str, function_name: str) -> None:
        self.app_name = app_name
        self.function_name = function_name

    def remote(self, **kwargs: object) -> object:
        if _MODE == "module_not_found":
            raise ModuleNotFoundError("No module named 'nlp'")
        if _MODE == "not_a_dict":
            return "accepted"
        if _MODE == "empty_payload":
            return {}
        payload = {
            "tenant_id": kwargs.get("tenant_id"),
            "session_id": kwargs.get("session_id"),
            "intent_dimensions": {"budget_signal": "400k"},
            "archetype_hint": "coastal-quiet",
            "confidence": 0.7,
            "model_used": "haiku-4.5",
            "source": "realtime",
            "message_count": 1,
            "detected_at": "2026-08-08T00:00:00Z",
            "data_source": "model",
        }
        if _MODE == "wrong_payload":
            payload["tenant_id"] = "some-other-tenant"
            payload["session_id"] = "some-other-session"
        return payload

    def get_web_url(self) -> str:
        return os.environ.get("FAKE_MODAL_WEB_URL", _WEB_URL)


class Function:
    @staticmethod
    def from_name(app_name: str, function_name: str) -> _FakeFunction:
        if _MODE == "app_not_found":
            raise RuntimeError(f"App '{app_name}' was not found in the estalara workspace")
        return _FakeFunction(app_name, function_name)
