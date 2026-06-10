"""Smoke tests for estalara-intent-engine placeholder."""

from main import SERVICE_NAME, SERVICE_VERSION, get_service_info


def test_service_info_returns_correct_name() -> None:
    """Service name is correct."""
    info = get_service_info()
    assert info["service"] == SERVICE_NAME


def test_service_info_returns_version() -> None:
    """Service version matches module constant."""
    info = get_service_info()
    assert info["version"] == SERVICE_VERSION


def test_service_info_status_is_active() -> None:
    """Status field indicates the service is now active (FOLLOW-087)."""
    info = get_service_info()
    assert info["status"] == "active"


def test_service_info_version_is_010() -> None:
    """Version bumped to 0.1.0 when the real pipeline shipped (FOLLOW-087)."""
    info = get_service_info()
    assert info["version"] == "0.1.0"
