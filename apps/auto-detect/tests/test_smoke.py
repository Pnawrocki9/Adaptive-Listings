"""Smoke tests for estalara-auto-detect placeholder."""
from src.main import PLACEHOLDER_VERSION, is_ready


def test_is_ready():
    """Verify package is importable and ready."""
    assert is_ready() is True


def test_version():
    """Verify version constant exists and is valid."""
    assert isinstance(PLACEHOLDER_VERSION, str)
    assert len(PLACEHOLDER_VERSION) > 0
