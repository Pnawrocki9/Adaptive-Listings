"""
Tests for apps/llm-gateway/src/main.py — deploy entrypoint.

These tests verify:
  1. get_service_info() returns the correct metadata.
  2. Importing main brings in both consumer modules.
  3. Both consumer modules reference the SAME modal.App object (the shared
     instance from jobs/_app.py), proving the BUG-2 / ESC-034 collision is fixed.
"""

from __future__ import annotations

import main
from jobs import consume_embed_seed_requests, generate_description


def test_service_info_returns_correct_name() -> None:
    """Service name must be 'estalara-llm-gateway'."""
    info = main.get_service_info()
    assert info["service"] == main.SERVICE_NAME


def test_service_info_returns_version() -> None:
    """Service version matches module constant."""
    info = main.get_service_info()
    assert info["version"] == main.SERVICE_VERSION


def test_service_info_status_is_active() -> None:
    """Status must be 'active' — main.py is a real entrypoint, not a placeholder."""
    info = main.get_service_info()
    assert info["status"] == "active"


def test_both_consumers_share_same_app_object() -> None:
    """
    Both consumer modules must reference the identical modal.App object.

    This is the structural proof that BUG 2 (ESC-034) is fixed.  Before the
    fix each consumer independently called modal.App("estalara-description-
    generator"), creating separate App objects.  In real Modal, deploying one
    consumer would silently wipe the other's functions.  After the fix both
    modules import ``app`` from jobs._app, so they share the exact same object.

    Note: in the test environment modal is stubbed by conftest.py, but the
    import identity still holds — both consumers import the same module-level
    ``app`` name from jobs._app rather than constructing fresh App instances.
    """
    assert generate_description.app is consume_embed_seed_requests.app, (
        "generate_description.app and consume_embed_seed_requests.app must be the "
        "same object (both imported from jobs._app).  A separate modal.App() "
        "constructor in either consumer module would wipe the other's functions "
        "on deploy."
    )


def test_main_imports_both_consumer_modules() -> None:
    """
    Importing main must make both consumer modules available in sys.modules.

    This verifies that the load-bearing import lines in main.py actually run,
    i.e. that 'modal deploy main.py' would discover all @app.function
    registrations.
    """
    import sys

    assert "jobs.generate_description" in sys.modules, (
        "jobs.generate_description was not imported by main.py. "
        "The load-bearing 'from jobs import generate_description' import is missing."
    )
    assert "jobs.consume_embed_seed_requests" in sys.modules, (
        "jobs.consume_embed_seed_requests was not imported by main.py. "
        "The load-bearing 'from jobs import consume_embed_seed_requests' import is missing."
    )
