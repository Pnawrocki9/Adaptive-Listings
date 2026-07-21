"""
pytest configuration for apps/intent-engine/src.

Mocks the `modal` package so unit tests can import the Modal-decorated modules
(main.py, jobs/batch_enrich.py) without a live Modal token or the Modal package
installed. The decorators (app.function, Secret.from_name, Cron, …) become
no-ops and the underlying Python functions are tested directly — the standard
offline-Modal pattern used across this repo (see apps/llm-gateway/src/conftest.py).
"""

from __future__ import annotations

import sys
from typing import Any
from unittest.mock import MagicMock


def _make_modal_stub() -> MagicMock:
    """Build a minimal modal module stub covering the subset used here.

    Covers:
      - modal.App (with .function() passthrough decorator)
      - modal.Image.debian_slim().pip_install() chain
      - modal.Secret.from_name()
      - modal.Cron()
      - modal.fastapi_endpoint() — passthrough (F-01 / ADR-0016 chat-NLP endpoint)
    """
    modal_stub = MagicMock(name="modal")

    app_instance = MagicMock(name="modal.App()")

    def _passthrough_decorator(*args: Any, **kwargs: Any) -> Any:
        """Return a decorator that wraps the function without modification."""

        def decorator(fn: Any) -> Any:
            fn.spawn = MagicMock(return_value=None)
            fn.local = fn  # allow fn.local(*args) → fn(*args) in tests
            return fn

        return decorator

    app_instance.function = _passthrough_decorator
    modal_stub.App = MagicMock(return_value=app_instance)

    image_chain = MagicMock(name="modal.Image.debian_slim()")
    image_chain.pip_install = MagicMock(return_value=image_chain)
    modal_stub.Image.debian_slim = MagicMock(return_value=image_chain)

    modal_stub.Secret.from_name = MagicMock(return_value=MagicMock(name="Secret"))
    modal_stub.Cron = MagicMock(return_value=MagicMock(name="Cron"))
    modal_stub.Period = MagicMock(return_value=MagicMock(name="Period"))
    # Passthrough so chat_nlp_endpoint is a plain async Python function under test.
    modal_stub.fastapi_endpoint = MagicMock(side_effect=lambda *a, **kw: (lambda fn: fn))

    return modal_stub


# Install the stub before any test module imports happen. If `modal` is genuinely
# installed (full dev environment), leave it alone.
if "modal" not in sys.modules:
    sys.modules["modal"] = _make_modal_stub()  # type: ignore[assignment]
