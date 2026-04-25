"""Smoke tests for estalara-data-quality placeholder."""
from main import SERVICE_NAME, SERVICE_VERSION, get_service_info


def test_service_info_returns_correct_name() -> None:
    """Service name is correct."""
    info = get_service_info()
    assert info["service"] == SERVICE_NAME


def test_service_info_returns_version() -> None:
    """Service version matches module constant."""
    info = get_service_info()
    assert info["version"] == SERVICE_VERSION


def test_service_info_status_is_placeholder() -> None:
    """Status field indicates placeholder state."""
    info = get_service_info()
    assert info["status"] == "placeholder"
