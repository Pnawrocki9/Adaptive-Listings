"""
pytest configuration for apps/llm-gateway/src.

Mocks the `modal` package so that unit tests can import Modal-decorated modules
without requiring a live Modal token or the Modal Python package to be installed.
This is the standard approach for testing Modal apps offline — the decorators
(app.function, Secret.from_name, etc.) become no-ops, and the underlying Python
functions are tested directly.
"""

from __future__ import annotations

import sys
from typing import Any
from unittest.mock import MagicMock


def _make_modal_stub() -> MagicMock:
    """
    Build a minimal modal module stub.

    Covers the subset of modal's public API used in generate_description.py:
      - modal.App (with .function() decorator, .spawn())
      - modal.Image (with .debian_slim() and .pip_install() chain)
      - modal.Secret.from_name()
      - modal.Period
      - modal.fastapi_endpoint() — passthrough decorator (ADR-0016 / FOLLOW-485)
    """
    modal_stub = MagicMock(name="modal")

    # modal.App("name") → returns an app object whose .function() is a passthrough decorator
    app_instance = MagicMock(name="modal.App()")

    def _passthrough_decorator(*args: Any, **kwargs: Any) -> Any:
        """Return a decorator that wraps the function without modification."""

        def decorator(fn: Any) -> Any:
            fn.spawn = MagicMock(return_value=None)
            fn.local = fn  # allow fn.local(*args) → fn(*args) in tests
            return fn

        return decorator

    app_instance.function = _passthrough_decorator

    # modal.App class itself returns app_instance
    modal_stub.App = MagicMock(return_value=app_instance)

    # modal.Image.debian_slim().pip_install() chain — all no-ops
    image_chain = MagicMock(name="modal.Image.debian_slim()")
    image_chain.pip_install = MagicMock(return_value=image_chain)
    modal_stub.Image.debian_slim = MagicMock(return_value=image_chain)

    # modal.Secret.from_name("name") → a sentinel
    modal_stub.Secret.from_name = MagicMock(return_value=MagicMock(name="Secret"))

    # modal.Period(seconds=30) → a sentinel
    modal_stub.Period = MagicMock(return_value=MagicMock(name="Period"))

    # modal.fastapi_endpoint(method="POST") → passthrough decorator (no-op), so the
    # decorated function under test is the plain Python async function, callable
    # directly with keyword args in tests (bypassing FastAPI's request-parsing).
    modal_stub.fastapi_endpoint = MagicMock(side_effect=lambda *a, **kw: (lambda fn: fn))

    return modal_stub


# Install the stub before any test module imports happen.
# If `modal` is genuinely installed (e.g. in a full dev environment), leave it alone.
if "modal" not in sys.modules:
    sys.modules["modal"] = _make_modal_stub()  # type: ignore[assignment]
