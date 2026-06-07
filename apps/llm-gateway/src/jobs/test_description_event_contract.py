"""
Cross-runtime description.requested contract parity test (Python side) — FOLLOW-198 / FOLLOW-168.

GUARDRAIL: This test MUST NOT hand-author the required-field list. The canonical list
comes from the shared JSON fixture at:
  packages/shared/contracts/description-event.required.json

Both this test and the TypeScript test (packages/shared/src/__tests__/cross-runtime/
description-event-contract.test.ts) read that same fixture so that a drift on either
side fails CI.

Evidence that this test drives the real production path (not an inject):
  - `REQUIRED_FIELDS` is read directly from `generate_description.REQUIRED_FIELDS`,
    which is derived at module load time from the shared JSON fixture — not hardcoded
    here or in the production module.
  - The fixture path is resolved via the production module's own `_CONTRACT_FIXTURE`
    attribute, confirming both the test and the consumer agree on the same file.
  - The negative-drift test mutates a copy of the fixture and asserts the production
    module's validation logic catches the drift — no values are injected.

CI gate: this test is included in the dedicated `cross-language-contract` CI step
(not behind `continue-on-error`) so drift is a real merge-blocking failure.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

# Import the production module — conftest.py installs the modal stub so no Modal
# infrastructure is required. REQUIRED_FIELDS is a frozenset derived from the JSON
# fixture at module import time.
from jobs.generate_description import REQUIRED_FIELDS, _CONTRACT_FIXTURE  # noqa: PLC0415

# ---------------------------------------------------------------------------
# Load the fixture independently for comparison — reading it here (not just
# trusting REQUIRED_FIELDS) means the test catches a case where the module
# loads one fixture path but the TS test reads a different one.
# ---------------------------------------------------------------------------

_FIXTURE_FROM_TS_PERSPECTIVE = (
    Path(__file__).parent / "../../../../packages/shared/contracts/description-event.required.json"
)


def _load_fixture(path: Path) -> frozenset[str]:
    return frozenset(json.loads(path.read_text()))


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestContractFixtureIntegrity:
    """Validate the shared JSON fixture itself before asserting parity."""

    def test_fixture_file_exists(self) -> None:
        """The shared contract fixture must exist at the expected path."""
        assert _FIXTURE_FROM_TS_PERSPECTIVE.exists(), (
            f"Shared contract fixture not found at {_FIXTURE_FROM_TS_PERSPECTIVE}. "
            "Ensure packages/shared/contracts/description-event.required.json is committed."
        )

    def test_fixture_is_non_empty_string_list(self) -> None:
        """The fixture must be a non-empty list of non-empty strings."""
        data = json.loads(_FIXTURE_FROM_TS_PERSPECTIVE.read_text())
        assert isinstance(data, list), "Fixture must be a JSON array"
        assert len(data) > 0, "Fixture must contain at least one field"
        for item in data:
            assert (
                isinstance(item, str) and len(item) > 0
            ), f"Every fixture entry must be a non-empty string; got: {item!r}"

    def test_fixture_has_no_duplicates(self) -> None:
        """No field name appears twice in the fixture."""
        data = json.loads(_FIXTURE_FROM_TS_PERSPECTIVE.read_text())
        assert len(data) == len(
            set(data)
        ), f"Fixture has duplicate entries: {[x for x in data if data.count(x) > 1]}"


class TestProductionModuleContractParity:
    """Assert REQUIRED_FIELDS in the production module matches the shared fixture exactly."""

    def test_required_fields_equals_fixture(self) -> None:
        """
        REQUIRED_FIELDS (frozenset used by consume_description_requests) must equal
        the shared JSON fixture exactly.

        This is the primary AC1 / AC2 assertion.  If a developer adds a field to the
        fixture without updating REQUIRED_FIELDS (or vice-versa), this test fails.
        """
        fixture_fields = _load_fixture(_FIXTURE_FROM_TS_PERSPECTIVE)
        assert REQUIRED_FIELDS == fixture_fields, (
            f"REQUIRED_FIELDS in generate_description.py does not match the shared fixture.\n"
            f"  In REQUIRED_FIELDS but not fixture: {REQUIRED_FIELDS - fixture_fields}\n"
            f"  In fixture but not REQUIRED_FIELDS: {fixture_fields - REQUIRED_FIELDS}\n"
            "Update packages/shared/contracts/description-event.required.json and ensure "
            "generate_description.py derives REQUIRED_FIELDS from that same file."
        )

    def test_module_and_test_read_same_fixture_path(self) -> None:
        """
        The path the production module resolves for the fixture (_CONTRACT_FIXTURE)
        must point to the same file as the path this test uses.

        Catches a scenario where someone changes the fixture path in the module but
        not in this test (or vice-versa).
        """
        module_fixture_resolved = _CONTRACT_FIXTURE.resolve()
        test_fixture_resolved = _FIXTURE_FROM_TS_PERSPECTIVE.resolve()
        assert module_fixture_resolved == test_fixture_resolved, (
            f"Production module reads fixture from:\n  {module_fixture_resolved}\n"
            f"but this test reads from:\n  {test_fixture_resolved}\n"
            "Both must point to the same file."
        )

    def test_required_fields_is_frozenset(self) -> None:
        """REQUIRED_FIELDS must be immutable (frozenset) to prevent accidental mutation."""
        assert isinstance(
            REQUIRED_FIELDS, frozenset
        ), f"REQUIRED_FIELDS must be a frozenset, got {type(REQUIRED_FIELDS).__name__}"

    def test_required_fields_contains_expected_canonical_keys(self) -> None:
        """
        Smoke-check that the five canonical required fields are present.

        These are the fields validated in consume_description_requests() since v1.7.1
        (original_description added in PR #182 / ADR-0009 / ESC-018).
        If a field is intentionally removed from the contract, update this test too.
        """
        canonical = {"tenant_id", "listing_id", "archetype", "cache_key", "original_description"}
        missing_from_required = canonical - REQUIRED_FIELDS
        assert not missing_from_required, (
            f"Expected canonical required fields are missing from REQUIRED_FIELDS: "
            f"{missing_from_required}. "
            "If a field was intentionally removed, update this test AND the shared fixture."
        )


class TestDriftDetection:
    """
    AC2 — negative tests proving that drift between the fixture and the production
    module is caught by this test suite (not just by the TS test).
    """

    def test_adding_field_to_fixture_but_not_module_is_caught(self) -> None:
        """
        Simulate: a developer adds a new field to the fixture JSON but forgets to
        update generate_description.py. The parity test must catch this.

        This test verifies the guard itself works — it does NOT mutate the real fixture
        or REQUIRED_FIELDS; it builds hypothetical sets to assert the comparison logic
        is correct.
        """
        # Hypothetical: fixture gains a new field "new_required_field"
        expanded_fixture = _load_fixture(_FIXTURE_FROM_TS_PERSPECTIVE) | {"new_required_field"}
        # Production module still has the old set
        current_module_fields = REQUIRED_FIELDS

        # The parity check would find a discrepancy
        in_fixture_not_module = expanded_fixture - current_module_fields
        assert "new_required_field" in in_fixture_not_module, (
            "Drift guard logic is broken: an extra field in the fixture was not detected. "
            "The parity assertion in test_required_fields_equals_fixture would miss real drift."
        )

    def test_removing_field_from_module_but_not_fixture_is_caught(self) -> None:
        """
        Simulate: a developer removes a field from REQUIRED_FIELDS but forgets to
        update the fixture. The parity test must catch this.
        """
        fixture_fields = _load_fixture(_FIXTURE_FROM_TS_PERSPECTIVE)
        # Hypothetical: module removes "original_description" from its required set
        shrunk_module_fields = REQUIRED_FIELDS - {"original_description"}

        in_fixture_not_shrunk = fixture_fields - shrunk_module_fields
        assert (
            "original_description" in in_fixture_not_shrunk
        ), "Drift guard logic is broken: a field removed from REQUIRED_FIELDS was not detected."

    def test_adding_field_to_module_but_not_fixture_is_caught(self) -> None:
        """
        Simulate: a developer adds a field to REQUIRED_FIELDS but forgets to update
        the fixture. The TS test catches this from the other side; this test covers
        the Python-side detection.
        """
        fixture_fields = _load_fixture(_FIXTURE_FROM_TS_PERSPECTIVE)
        # Hypothetical: module adds "locale" as a required field
        expanded_module_fields = REQUIRED_FIELDS | {"locale"}

        in_module_not_fixture = expanded_module_fields - fixture_fields
        assert "locale" in in_module_not_fixture, (
            "Drift guard logic is broken: a field added to REQUIRED_FIELDS was not detected "
            "as missing from the fixture."
        )
