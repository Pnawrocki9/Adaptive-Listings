"""Smoke tests for stream-consumer main module."""

from src.main import SERVICE_NAME, SERVICE_VERSION, get_service_info


def test_service_info_returns_correct_name() -> None:
    info = get_service_info()
    assert info["service"] == SERVICE_NAME


def test_service_info_returns_version() -> None:
    info = get_service_info()
    assert info["version"] == SERVICE_VERSION


def test_service_info_status_is_active() -> None:
    info = get_service_info()
    assert info["status"] == "active"


def test_modal_app_is_defined() -> None:
    """The Modal App object must exist and have the right name."""
    from src.main import app

    assert app.name == "estalara-stream-consumer-events"
