"""
Tests for apps/data-quality/src/crons/schema_validation.py — TICKET-VAL-001.

All tests are synchronous and mock external dependencies (httpx, psycopg2,
confluent_kafka, sentry_sdk) so they run without real network / DB access.

Test inventory (maps to TICKET-VAL-001 AC item 9 + spec test expectations):
  1. check_selectors returns True for matching selector
  2. check_selectors returns False for non-matching selector
  3. check_selectors handles malformed selector without crashing
  4. compute_coverage: drift detected when coverage < 0.8
  5. compute_coverage: no drift when coverage >= 0.8
  6. _run_validation: page fetch failure writes error row without Sentry drift alert
  7. _run_validation: drift detected — Sentry called once + Redpanda emitted
  8. _run_validation: no drift — Sentry NOT called, Redpanda NOT emitted
  9. _run_validation: Sentry deduplication within 24h window
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock, call, patch

import pytest

from crons.schema_validation import (
    DRIFT_THRESHOLD,
    _emit_redpanda_event,
    _run_validation,
    _was_drift_alerted_recently,
    _write_history_row,
    check_selectors,
    compute_coverage,
    extract_selectors,
    validate_schemas,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_PROPERTY_TITLE_HTML = '<h1 class="property-title">House</h1><span class="price">€500k</span>'

_MINIMAL_SCHEMA: dict[str, Any] = {
    "tenant_id": "tenant-abc",
    "domain": "example.com",
    "detected_at": "2026-05-01T00:00:00Z",
    "detection_source": "data_testid",
    "detection_confidence": 0.92,
    "index_schema": {
        "url_patterns": ["/properties/"],
        "listing_card_selector": "div.listing-card",
        "reorder_capable": False,
        "card_field_mappings": {
            "headline": {
                "primary": "h2.listing-title",
                "fallbacks": [],
                "type": "text",
            },
            "price": {
                "primary": "span.listing-price",
                "fallbacks": [],
                "type": "currency",
                "currency": "EUR",
            },
        },
        "data_extractors_per_card": {},
    },
    "detail_schema": {
        "url_patterns": ["/property/"],
        "slot_selectors": {
            "headline": {
                "primary": "h1.property-title",
                "fallbacks": ["h1"],
                "type": "text",
            },
            "cta_primary": {
                "primary": "button.contact-agent",
                "fallbacks": [],
                "type": "text",
            },
        },
        "data_extractors": {
            "price": {
                "primary": "div.property-price",
                "fallbacks": [],
                "type": "currency",
                "currency": "EUR",
            }
        },
    },
    "archetype_hints": [],
}


def _make_db_row(
    *,
    tenant_id: str = "aaaaaaaa-0000-0000-0000-000000000001",
    domain: str = "example.com",
    schema_jsonb: dict[str, Any] | None = None,
    detection_confidence: float = 0.92,
) -> dict[str, Any]:
    return {
        "tenant_id": tenant_id,
        "domain": domain,
        "schema_jsonb": schema_jsonb or _MINIMAL_SCHEMA,
        "detection_confidence": detection_confidence,
    }


def _make_mock_conn(
    db_rows: list[dict[str, Any]] | None = None,
    recent_drift: bool = False,
) -> MagicMock:
    """Build a minimal psycopg2 connection mock for _run_validation tests."""
    conn = MagicMock()
    cur = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cur

    # First fetchall() call returns the list of tenant rows.
    # Second fetchone() call (for deduplication check) is configured below.
    cur.fetchall.return_value = db_rows or []
    if recent_drift:
        cur.fetchone.return_value = {"run_at": datetime.now(UTC) - timedelta(hours=12)}
    else:
        cur.fetchone.return_value = None

    return conn


# ---------------------------------------------------------------------------
# Tests for check_selectors (AC item 9, spec tests 1–3)
# ---------------------------------------------------------------------------


class TestCheckSelectors:
    def test_matching_selector_returns_true(self) -> None:
        """check_selectors returns True for a selector that matches the HTML."""
        html = "<h1 class='property-title'>House</h1>"
        result = check_selectors(html, ["h1.property-title"])
        assert result == {"h1.property-title": True}

    def test_non_matching_selector_returns_false(self) -> None:
        """check_selectors returns False for a selector that has no match."""
        html = "<h1 class='property-title'>House</h1>"
        result = check_selectors(html, ["span.price"])
        assert result == {"span.price": False}

    def test_malformed_selector_returns_false_without_crash(self) -> None:
        """Malformed selectors produce False without raising an exception."""
        html = "<div>content</div>"
        # "!invalid$$" is not a valid CSS selector — must not raise
        result = check_selectors(html, ["!invalid$$"])
        assert "!invalid$$" in result
        assert result["!invalid$$"] is False

    def test_empty_selectors_list_returns_empty_dict(self) -> None:
        """Empty selectors list produces an empty result dict."""
        result = check_selectors("<html></html>", [])
        assert result == {}

    def test_multiple_selectors_mixed(self) -> None:
        """Multiple selectors — matching and non-matching — are handled correctly."""
        html = _PROPERTY_TITLE_HTML
        result = check_selectors(html, ["h1.property-title", "span.price", "div.not-there"])
        assert result["h1.property-title"] is True
        assert result["span.price"] is True
        assert result["div.not-there"] is False


# ---------------------------------------------------------------------------
# Tests for compute_coverage (spec tests 4–5)
# ---------------------------------------------------------------------------


class TestComputeCoverage:
    def test_drift_detected_when_coverage_below_threshold(self) -> None:
        """coverage_score < 0.8 → drift_detected = True."""
        # 3 matches out of 5 = 0.6 coverage
        results = {
            "sel1": True,
            "sel2": True,
            "sel3": True,
            "sel4": False,
            "sel5": False,
        }
        coverage, drift, failed = compute_coverage(results, [])
        assert abs(coverage - 0.6) < 1e-6
        assert drift is True
        assert set(failed) == {"sel4", "sel5"}

    def test_no_drift_when_coverage_at_threshold(self) -> None:
        """coverage_score = 0.8 (exactly at threshold) → drift_detected = False."""
        # 4 matches out of 5 = 0.8
        results = {
            "sel1": True,
            "sel2": True,
            "sel3": True,
            "sel4": True,
            "sel5": False,
        }
        coverage, drift, failed = compute_coverage(results, [])
        assert abs(coverage - 0.8) < 1e-6
        assert drift is False
        assert failed == ["sel5"]

    def test_required_selector_failure_triggers_drift(self) -> None:
        """A required selector failing triggers drift even if overall coverage >= 0.8."""
        results = {"sel1": True, "sel2": True, "sel3": True, "sel4": True, "req": False}
        coverage, drift, failed = compute_coverage(results, required_selectors=["req"])
        assert coverage == 0.8
        assert drift is True  # required selector failed

    def test_empty_results_returns_perfect_coverage(self) -> None:
        """When there are no selectors, coverage defaults to 1.0 with no drift."""
        coverage, drift, failed = compute_coverage({}, [])
        assert coverage == 1.0
        assert drift is False
        assert failed == []


# ---------------------------------------------------------------------------
# Tests for _run_validation (spec tests 6–9)
# ---------------------------------------------------------------------------


GOOD_HTML = """
<html><body>
  <div class="listing-card"><h2 class="listing-title">Flat</h2></div>
  <h1 class="property-title">Nice flat</h1>
  <button class="contact-agent">Contact</button>
  <div class="property-price">€450k</div>
  <span class="listing-price">€450k</span>
</body></html>
"""

PARTIAL_HTML = """
<html><body>
  <h1 class="property-title">Nice flat</h1>
</body></html>
"""


class TestRunValidation:
    """Integration-level tests for _run_validation using mocked DB + HTTP."""

    def _all_selectors_present_in_good_html(self) -> bool:
        """Verify GOOD_HTML actually passes all selectors in _MINIMAL_SCHEMA."""
        all_sel, _ = extract_selectors(_MINIMAL_SCHEMA)
        results = check_selectors(GOOD_HTML, all_sel)
        cov, drift, _ = compute_coverage(results, [])
        return not drift

    def test_fetch_failure_writes_error_row_no_sentry(self) -> None:
        """Page fetch timeout writes history row with error; Sentry NOT called."""
        import httpx

        tenant_id = "aaaaaaaa-0000-0000-0000-000000000001"
        conn = _make_mock_conn(db_rows=[_make_db_row(tenant_id=tenant_id)])

        with (
            patch("crons.schema_validation.httpx.Client") as mock_http_cls,
            patch("crons.schema_validation.sentry_sdk.capture_message") as mock_sentry,
            patch("crons.schema_validation._emit_redpanda_event") as mock_redpanda,
        ):
            # Simulate timeout on context manager
            mock_client_instance = MagicMock()
            mock_http_cls.return_value.__enter__.return_value = mock_client_instance
            mock_client_instance.get.side_effect = httpx.TimeoutException(message="timed out")

            _run_validation(conn)

        # Must NOT call Sentry with drift alert
        mock_sentry.assert_not_called()
        # Must NOT emit Redpanda event
        mock_redpanda.assert_not_called()

        # Must write a history row with error
        conn.cursor.return_value.__enter__.return_value.execute.assert_called()
        execute_calls = conn.cursor.return_value.__enter__.return_value.execute.call_args_list
        insert_calls = [
            c for c in execute_calls if "INSERT INTO schema_validation_history" in str(c)
        ]
        assert len(insert_calls) == 1

        # Verify the call args contain error string and drift_detected=False
        # execute(sql, (tenant_id, domain, coverage_score, failed_selectors,
        #               total_selectors, matched_selectors, drift_detected, error))
        # indices:          0           1         2               3
        #                   4               5            6            7
        insert_args = insert_calls[0][0][1]
        assert insert_args[6] is False  # drift_detected
        assert "fetch_failed: timeout" in (insert_args[7] or "")  # error

    def test_drift_detected_emits_sentry_and_redpanda(self) -> None:
        """When drift is detected, Sentry capture_message and Redpanda emit are called."""
        tenant_id = "aaaaaaaa-0000-0000-0000-000000000002"
        conn = _make_mock_conn(
            db_rows=[_make_db_row(tenant_id=tenant_id)],
            recent_drift=False,
        )

        with (
            patch("crons.schema_validation.httpx.Client") as mock_http_cls,
            patch("crons.schema_validation.sentry_sdk.capture_message") as mock_sentry,
            patch("crons.schema_validation._emit_redpanda_event") as mock_redpanda,
            patch(
                "crons.schema_validation._was_drift_alerted_recently",
                return_value=False,
            ),
        ):
            mock_client_instance = MagicMock()
            mock_http_cls.return_value.__enter__.return_value = mock_client_instance
            # Return page with very minimal HTML — most selectors will fail
            mock_client_instance.get.return_value = MagicMock(
                status_code=200, text="<html><body><p>nothing here</p></body></html>"
            )

            _run_validation(conn)

        # With almost no selectors matching, drift must be detected
        mock_sentry.assert_called_once()
        mock_redpanda.assert_called_once()

    def test_no_drift_does_not_emit_sentry_or_redpanda(self) -> None:
        """When all selectors match (no drift), Sentry and Redpanda are not called."""
        tenant_id = "aaaaaaaa-0000-0000-0000-000000000003"
        conn = _make_mock_conn(db_rows=[_make_db_row(tenant_id=tenant_id)])

        with (
            patch("crons.schema_validation.httpx.Client") as mock_http_cls,
            patch("crons.schema_validation.sentry_sdk.capture_message") as mock_sentry,
            patch("crons.schema_validation._emit_redpanda_event") as mock_redpanda,
        ):
            mock_client_instance = MagicMock()
            mock_http_cls.return_value.__enter__.return_value = mock_client_instance
            mock_client_instance.get.return_value = MagicMock(status_code=200, text=GOOD_HTML)

            _run_validation(conn)

        mock_sentry.assert_not_called()
        mock_redpanda.assert_not_called()

    def test_sentry_deduplication_within_24h(self) -> None:
        """If drift was already alerted within 24h, Sentry is NOT called again."""
        tenant_id = "aaaaaaaa-0000-0000-0000-000000000004"
        conn = _make_mock_conn(db_rows=[_make_db_row(tenant_id=tenant_id)])

        with (
            patch("crons.schema_validation.httpx.Client") as mock_http_cls,
            patch("crons.schema_validation.sentry_sdk.capture_message") as mock_sentry,
            patch("crons.schema_validation._emit_redpanda_event"),
            # Simulate: drift was already alerted 12h ago
            patch(
                "crons.schema_validation._was_drift_alerted_recently",
                return_value=True,
            ),
        ):
            mock_client_instance = MagicMock()
            mock_http_cls.return_value.__enter__.return_value = mock_client_instance
            mock_client_instance.get.return_value = MagicMock(
                status_code=200, text="<html><body><p>nothing</p></body></html>"
            )

            _run_validation(conn)

        # Sentry must NOT be called because deduplication window is active
        mock_sentry.assert_not_called()

    def test_skips_tenants_with_no_schema_rows(self) -> None:
        """Empty DB result (no tenants) → validation loop does nothing."""
        conn = _make_mock_conn(db_rows=[])

        with (
            patch("crons.schema_validation.httpx.Client") as mock_http_cls,
            patch("crons.schema_validation.sentry_sdk.capture_message") as mock_sentry,
        ):
            _run_validation(conn)

        mock_http_cls.assert_not_called()
        mock_sentry.assert_not_called()

    def test_http_non_200_writes_error_row(self) -> None:
        """HTTP 404 response writes a fetch_failed error row and continues."""
        tenant_id = "aaaaaaaa-0000-0000-0000-000000000005"
        conn = _make_mock_conn(db_rows=[_make_db_row(tenant_id=tenant_id)])

        with (
            patch("crons.schema_validation.httpx.Client") as mock_http_cls,
            patch("crons.schema_validation.sentry_sdk.capture_message") as mock_sentry,
        ):
            mock_client_instance = MagicMock()
            mock_http_cls.return_value.__enter__.return_value = mock_client_instance
            mock_client_instance.get.return_value = MagicMock(status_code=404)

            _run_validation(conn)

        mock_sentry.assert_not_called()

        execute_calls = conn.cursor.return_value.__enter__.return_value.execute.call_args_list
        insert_calls = [
            c for c in execute_calls if "INSERT INTO schema_validation_history" in str(c)
        ]
        assert len(insert_calls) == 1
        insert_args = insert_calls[0][0][1]
        # execute args: (tenant_id, domain, coverage_score, failed_selectors,
        #                total_selectors, matched_selectors, drift_detected, error)
        assert "fetch_failed: HTTP 404" in (insert_args[7] or "")


# ---------------------------------------------------------------------------
# Tests for extract_selectors
# ---------------------------------------------------------------------------


class TestExtractSelectors:
    def test_extracts_listing_card_as_required(self) -> None:
        """listing_card_selector is always extracted and marked as required."""
        all_sel, required_sel = extract_selectors(_MINIMAL_SCHEMA)
        assert "div.listing-card" in all_sel
        assert "div.listing-card" in required_sel

    def test_extracts_headline_as_required(self) -> None:
        """detail_schema.slot_selectors.headline.primary is required."""
        all_sel, required_sel = extract_selectors(_MINIMAL_SCHEMA)
        assert "h1.property-title" in all_sel
        assert "h1.property-title" in required_sel

    def test_extracts_fallback_selectors(self) -> None:
        """Fallback selectors from SelectorStrategy are included in all_selectors."""
        all_sel, _ = extract_selectors(_MINIMAL_SCHEMA)
        assert "h1" in all_sel  # headline fallback

    def test_deduplicates_selectors(self) -> None:
        """Duplicate selectors appear only once in the output."""
        all_sel, _ = extract_selectors(_MINIMAL_SCHEMA)
        assert len(all_sel) == len(set(all_sel)), "Duplicate selectors found"

    def test_empty_schema_returns_empty_lists(self) -> None:
        """Schema with no recognized structure returns empty lists."""
        all_sel, required_sel = extract_selectors({})
        assert all_sel == []
        assert required_sel == []


# ---------------------------------------------------------------------------
# FOLLOW-738: validate_schemas() must go through the shared hardened Sentry
# initialiser, not a bare sentry_sdk.init().
# ---------------------------------------------------------------------------


class TestValidateSchemasSentryInit:
    async def test_uses_shared_hardened_init_and_flush(self) -> None:
        with (
            patch("crons.schema_validation._get_db_connection") as mock_get_conn,
            patch("crons.schema_validation._run_validation") as mock_run,
            patch("crons.schema_validation.init_sentry") as mock_init,
            patch("crons.schema_validation.flush_sentry") as mock_flush,
        ):
            mock_conn = MagicMock()
            mock_get_conn.return_value = mock_conn

            await validate_schemas.local()

        mock_init.assert_called_once_with("SENTRY_DSN")
        mock_run.assert_called_once_with(mock_conn)
        mock_conn.close.assert_called_once()
        mock_flush.assert_called_once_with(0.3)
