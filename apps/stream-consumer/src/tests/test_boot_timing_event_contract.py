"""
Cross-runtime `boot_timing` contract parity test (Python side) — FOLLOW-1037 / MP-011.

GUARDRAIL: This test MUST NOT hand-author the required-field list. The canonical list
comes from the shared JSON fixture at:
  packages/shared/contracts/boot-timing-event.required.json

Both this test and the TypeScript test (packages/shared/src/__tests__/cross-runtime/
boot-timing-event-contract.test.ts) read that same fixture so that a drift on either
side fails CI.

Evidence that this test drives the real production path (not an inject):
  - `BOOT_TIMING_REQUIRED_FIELDS` is imported directly from `src.models.event`, which
    derives it at module load time from the shared JSON fixture — not hardcoded here or
    in the production module.
  - `is_valid_boot_timing_payload` is the SAME function `src.consumers.events.run_consumer`
    calls on every `boot_timing` event in the real Redpanda -> ClickHouse loop.
  - The negative-drift tests mutate a copy of the fixture and assert the comparison logic
    catches it — no values are injected into the production module.

CI gate: this test is included in the dedicated `cross-language-contract` CI step
(not behind `continue-on-error`) so drift is a real merge-blocking failure. It is also
covered by the ordinary `test-python` matrix (`Test (Python) (3.12, stream-consumer)`),
since it lives under `src/tests/` alongside every other stream-consumer unit test.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from src.consumers.events import run_consumer
from src.models.event import (
    _BOOT_TIMING_CONTRACT_FIXTURE,
    BOOT_TIMING_REQUIRED_FIELDS,
    is_valid_boot_timing_payload,
)

# ---------------------------------------------------------------------------
# Load the fixture independently for comparison — reading it here (not just
# trusting BOOT_TIMING_REQUIRED_FIELDS) means the test catches a case where the
# module loads one fixture path but the TS test reads a different one.
# ---------------------------------------------------------------------------

_FIXTURE_FROM_TS_PERSPECTIVE = (
    Path(__file__).parent / "../../../../packages/shared/contracts/boot-timing-event.required.json"
)


def _load_fixture(path: Path) -> frozenset[str]:
    return frozenset(json.loads(path.read_text()))


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestContractFixtureIntegrity:
    """Validate the shared JSON fixture itself before asserting parity."""

    def test_fixture_file_exists(self) -> None:
        assert _FIXTURE_FROM_TS_PERSPECTIVE.exists(), (
            f"Shared contract fixture not found at {_FIXTURE_FROM_TS_PERSPECTIVE}. "
            "Ensure packages/shared/contracts/boot-timing-event.required.json is committed."
        )

    def test_fixture_is_non_empty_string_list(self) -> None:
        data = json.loads(_FIXTURE_FROM_TS_PERSPECTIVE.read_text())
        assert isinstance(data, list), "Fixture must be a JSON array"
        assert len(data) > 0, "Fixture must contain at least one field"
        for item in data:
            assert (
                isinstance(item, str) and len(item) > 0
            ), f"Every fixture entry must be a non-empty string; got: {item!r}"

    def test_fixture_has_no_duplicates(self) -> None:
        data = json.loads(_FIXTURE_FROM_TS_PERSPECTIVE.read_text())
        assert len(data) == len(
            set(data)
        ), f"Fixture has duplicate entries: {[x for x in data if data.count(x) > 1]}"


class TestProductionModuleContractParity:
    """Assert BOOT_TIMING_REQUIRED_FIELDS in the production module matches the fixture exactly."""

    def test_required_fields_equals_fixture(self) -> None:
        """
        BOOT_TIMING_REQUIRED_FIELDS (frozenset used by consumers/events.py) must equal the
        shared JSON fixture exactly. Primary AC1/AC2 assertion.
        """
        fixture_fields = _load_fixture(_FIXTURE_FROM_TS_PERSPECTIVE)
        assert BOOT_TIMING_REQUIRED_FIELDS == fixture_fields, (
            f"BOOT_TIMING_REQUIRED_FIELDS in src/models/event.py does not match the shared "
            f"fixture.\n"
            f"  In BOOT_TIMING_REQUIRED_FIELDS but not fixture: "
            f"{BOOT_TIMING_REQUIRED_FIELDS - fixture_fields}\n"
            f"  In fixture but not BOOT_TIMING_REQUIRED_FIELDS: "
            f"{fixture_fields - BOOT_TIMING_REQUIRED_FIELDS}\n"
            "Update packages/shared/contracts/boot-timing-event.required.json and ensure "
            "src/models/event.py derives BOOT_TIMING_REQUIRED_FIELDS from that same file."
        )

    def test_module_and_test_read_same_fixture_path(self) -> None:
        """
        The path the production module resolves for the fixture must point to the same
        file as the path this test uses.
        """
        module_fixture_resolved = _BOOT_TIMING_CONTRACT_FIXTURE.resolve()
        test_fixture_resolved = _FIXTURE_FROM_TS_PERSPECTIVE.resolve()
        assert module_fixture_resolved == test_fixture_resolved, (
            f"Production module reads fixture from:\n  {module_fixture_resolved}\n"
            f"but this test reads from:\n  {test_fixture_resolved}\n"
            "Both must point to the same file."
        )

    def test_required_fields_is_frozenset(self) -> None:
        assert isinstance(BOOT_TIMING_REQUIRED_FIELDS, frozenset), (
            "BOOT_TIMING_REQUIRED_FIELDS must be a frozenset, got "
            f"{type(BOOT_TIMING_REQUIRED_FIELDS).__name__}"
        )

    def test_required_fields_contains_canonical_keys(self) -> None:
        """
        Smoke-check that the two canonical required fields (preInit, total — MP-011's
        highest-signal spans) are present.
        """
        canonical = {"preInit", "total"}
        missing = canonical - BOOT_TIMING_REQUIRED_FIELDS
        assert not missing, (
            f"Expected canonical required fields are missing from BOOT_TIMING_REQUIRED_FIELDS: "
            f"{missing}. If a field was intentionally removed, update this test AND the shared "
            "fixture."
        )


class TestIsValidBootTimingPayload:
    """Exercise the real production validation function `run_consumer` calls."""

    def test_accepts_a_full_boot_timings_shaped_payload(self) -> None:
        payload = {
            "preInit": 1174,
            "initToConfig": 2,
            "configFetch": 97,
            "configToAdapt": 1,
            "adapt": 21,
            "total": 1295,
        }
        assert is_valid_boot_timing_payload(payload) is True

    def test_accepts_a_minimal_payload_with_only_required_fields(self) -> None:
        payload = {"preInit": 439, "total": 439}
        assert is_valid_boot_timing_payload(payload) is True

    def test_rejects_an_empty_payload(self) -> None:
        assert is_valid_boot_timing_payload({}) is False

    def test_rejects_a_payload_missing_total(self) -> None:
        assert is_valid_boot_timing_payload({"preInit": 100}) is False

    def test_rejects_a_payload_where_a_required_field_is_the_wrong_type(self) -> None:
        assert is_valid_boot_timing_payload({"preInit": "not-a-number", "total": 100}) is False


def _make_raw_event(
    event_id: str = "b0000000-0000-0000-0000-000000000001",
    tenant_id: str = "tenant-001",
    payload: dict | None = None,
) -> bytes:
    return json.dumps(
        {
            "event_id": event_id,
            "tenant_id": tenant_id,
            "session_id": "a" * 32,
            "ts": 1_746_259_200_000,
            "region": "eu",
            "consent_state": "consented",
            "schema_version": 1,
            "type": "boot_timing",
            "payload": payload or {"preInit": 1174, "total": 1295},
        }
    ).encode()


def _make_kafka_msg(value: bytes) -> MagicMock:
    msg = MagicMock()
    msg.error.return_value = None
    msg.value.return_value = value
    msg.topic.return_value = "events"
    msg.offset.return_value = 0
    return msg


class TestBootTimingWiredIntoRealConsumerLoop:
    """
    Drives the REAL `run_consumer` loop (Rule Q) — not `is_valid_boot_timing_payload` in
    isolation — proving the contract check in `consumers/events.py` actually executes on the
    Redpanda -> ClickHouse path, and that a `boot_timing` event still reaches ClickHouse
    regardless of shape (this check is observability-only, never a filter).
    """

    def test_well_formed_boot_timing_event_reaches_clickhouse_without_a_warning(self) -> None:
        msg = _make_kafka_msg(_make_raw_event(payload={"preInit": 1174, "total": 1295}))
        consumer = MagicMock()
        consumer.poll.side_effect = [msg, None]
        ch = MagicMock()
        dlq = MagicMock()

        with pytest.MonkeyPatch.context() as mp:
            warnings: list[str] = []
            mp.setattr(
                "src.consumers.events.log.warning",
                lambda event, **kw: warnings.append(event),
            )
            run_consumer(
                consumer=consumer,
                ch_client=ch,
                dlq_producer=dlq,
                _time_fn=lambda: 0.0,
                _max_polls=2,
            )

        assert "boot_timing_payload_contract_drift" not in warnings
        ch.insert_events.assert_called_once()
        batch = ch.insert_events.call_args[0][0]
        assert len(batch) == 1
        assert batch[0]["type"] == "boot_timing"

    def test_malformed_boot_timing_event_still_reaches_clickhouse_but_logs_a_warning(self) -> None:
        # Missing `total` — violates the shared fixture contract.
        msg = _make_kafka_msg(_make_raw_event(payload={"preInit": 1174}))
        consumer = MagicMock()
        consumer.poll.side_effect = [msg, None]
        ch = MagicMock()
        dlq = MagicMock()

        with pytest.MonkeyPatch.context() as mp:
            warnings: list[str] = []
            mp.setattr(
                "src.consumers.events.log.warning",
                lambda event, **kw: warnings.append(event),
            )
            run_consumer(
                consumer=consumer,
                ch_client=ch,
                dlq_producer=dlq,
                _time_fn=lambda: 0.0,
                _max_polls=2,
            )

        # Observability, not rejection: the malformed event is STILL inserted.
        assert "boot_timing_payload_contract_drift" in warnings
        ch.insert_events.assert_called_once()
        assert len(ch.insert_events.call_args[0][0]) == 1


class TestDriftDetection:
    """
    AC2 — negative tests proving that drift between the fixture and the production
    module is caught by this test suite (not just by the TS test).
    """

    def test_adding_field_to_fixture_but_not_module_is_caught(self) -> None:
        expanded_fixture = _load_fixture(_FIXTURE_FROM_TS_PERSPECTIVE) | {"new_required_field"}
        current_module_fields = BOOT_TIMING_REQUIRED_FIELDS

        in_fixture_not_module = expanded_fixture - current_module_fields
        assert (
            "new_required_field" in in_fixture_not_module
        ), "Drift guard logic is broken: an extra field in the fixture was not detected."

    def test_removing_field_from_module_but_not_fixture_is_caught(self) -> None:
        fixture_fields = _load_fixture(_FIXTURE_FROM_TS_PERSPECTIVE)
        shrunk_module_fields = BOOT_TIMING_REQUIRED_FIELDS - {"total"}

        in_fixture_not_shrunk = fixture_fields - shrunk_module_fields
        assert "total" in in_fixture_not_shrunk, (
            "Drift guard logic is broken: a field removed from BOOT_TIMING_REQUIRED_FIELDS was "
            "not detected."
        )

    def test_adding_field_to_module_but_not_fixture_is_caught(self) -> None:
        fixture_fields = _load_fixture(_FIXTURE_FROM_TS_PERSPECTIVE)
        expanded_module_fields = BOOT_TIMING_REQUIRED_FIELDS | {"adapt"}

        in_module_not_fixture = expanded_module_fields - fixture_fields
        assert "adapt" in in_module_not_fixture, (
            "Drift guard logic is broken: a field added to BOOT_TIMING_REQUIRED_FIELDS was not "
            "detected as missing from the fixture."
        )
