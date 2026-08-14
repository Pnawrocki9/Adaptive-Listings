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

FOLLOW-902 additions (the zero-coverage classification):
 10. classify_outcome: total miss → zero_coverage, partial miss → drift
 11. classify_outcome: coverage number is identical to compute_coverage (K.1 parity)
 12. _run_validation: zero coverage writes drift_detected=FALSE + a validator_error row
     naming the fetched URL, alerts on its own fingerprint, emits NO Redpanda event
 13. _run_validation: missing sample_listing_url makes NO HTTP request and writes a
     config_gap row (the domain-root fallback that caused the prod false positive)
 14. Golden regression against the measured prod condition (app.estalara.com, 0/10)
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, call, patch

import pytest

from crons import schema_validation as schema_validation_module
from crons.schema_validation import (
    DRIFT_THRESHOLD,
    ERROR_PREFIX_CONFIG_GAP,
    ERROR_PREFIX_FETCH_FAILED,
    ERROR_PREFIX_ZERO_COVERAGE,
    HEARTBEAT_JOB_NAME,
    OUTCOME_DRIFT,
    OUTCOME_OK,
    OUTCOME_ZERO_COVERAGE,
    _emit_redpanda_event,
    _run_validation,
    _was_drift_alerted_recently,
    _write_heartbeat,
    _write_history_row,
    check_selectors,
    classify_outcome,
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
    # FOLLOW-902: present here on purpose. A schema WITHOUT this field no longer gets a
    # guessed fallback URL — it is a config gap and is never fetched — so a fixture
    # missing it would silently stop exercising the fetch path at all. The
    # config-gap branch has its own fixture (_PROD_SCHEMA_NO_SAMPLE_URL) below.
    "sample_listing_url": "https://example.com/property/123",
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


# FOLLOW-902: the real prod row for tenant cbc51cfa-1056-40aa-b0a9-6e982b52b1de /
# app.estalara.com, read out of prod Postgres on 2026-08-08 and transcribed here.
# detection_confidence 1.0, detection_source "data_estalara", and — the load-bearing
# property — NO `sample_listing_url` key at all. Note every strategy has empty
# `fallbacks`: unlike _MINIMAL_SCHEMA there is no bare-tag selector like `h1` that
# would accidentally match an arbitrary page, which is exactly why the live run
# scored 0/10 rather than 1/10.
_PROD_SCHEMA_NO_SAMPLE_URL: dict[str, Any] = {
    "domain": "app.estalara.com",
    "tenant_id": "cbc51cfa-1056-40aa-b0a9-6e982b52b1de",
    "detected_at": "2026-05-29T17:46:51.646Z",
    "detection_source": "data_estalara",
    "detection_confidence": 1,
    "archetype_hints": [],
    "inquiry_submit_selector": "[data-estalara-slot='inquiry-submit']",
    "index_schema": {
        "url_patterns": ["/listings", "/listings/*", "/properties", "/properties/*"],
        "reorder_capable": True,
        "listing_count_expected": 12,
        "container_selector": "[data-estalara-slot='listing-grid']",
        "listing_card_selector": "[data-estalara-listing-id]",
        "card_field_mappings": {
            "area": {"type": "number", "unit": "sqm", "primary": "[data-estalara-slot='area']"},
            "image": {"type": "url", "primary": "[data-estalara-slot='photo']"},
            "price": {
                "type": "currency",
                "currency": "EUR",
                "primary": "[data-estalara-slot='price']",
            },
            "bedrooms": {"type": "number", "primary": "[data-estalara-slot='bedrooms']"},
            "headline": {"type": "text", "primary": "[data-estalara-slot='headline']"},
        },
        "data_extractors_per_card": {
            "price": {
                "type": "currency",
                "currency": "EUR",
                "primary": "[data-estalara-slot='price']",
            },
            "area_sqm": {"type": "number", "unit": "sqm", "primary": "[data-estalara-slot='area']"},
            "bedrooms": {"type": "number", "primary": "[data-estalara-slot='bedrooms']"},
        },
    },
    "detail_schema": {
        "h1_is_price": True,
        "url_patterns": ["/listings/*", "/properties/*"],
        "similar_listings_selector": "[data-estalara-slot='similar-listings']",
        "slot_selectors": {
            "headline": {"type": "text", "primary": "[data-estalara-slot='headline']"},
            "cta_primary": {"type": "text", "primary": "[data-estalara-slot='cta']"},
            "description": {"type": "text", "primary": "[data-estalara-slot='description']"},
        },
        "data_extractors": {
            "area": {"type": "number", "unit": "sqm", "primary": "[data-estalara-slot='area']"},
            "price": {
                "type": "currency",
                "currency": "EUR",
                "primary": "[data-estalara-slot='price']",
            },
            "bedrooms": {"type": "number", "primary": "[data-estalara-slot='bedrooms']"},
            "bathrooms": {"type": "number", "primary": "[data-estalara-slot='bathrooms']"},
        },
    },
}

# Same schema, but configured — used to exercise the fetch + zero-coverage path.
_PROD_SCHEMA_WITH_SAMPLE_URL: dict[str, Any] = {
    **_PROD_SCHEMA_NO_SAMPLE_URL,
    "sample_listing_url": "https://app.estalara.com/en/listings/abc123",
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


def _only_history_insert_args(conn: MagicMock) -> tuple[Any, ...]:
    """Return the bound params of the single schema_validation_history INSERT.

    Positional layout (mirrors ``_write_history_row``):
      0 tenant_id · 1 domain · 2 coverage_score · 3 failed_selectors
      4 total_selectors · 5 matched_selectors · 6 drift_detected · 7 error
    """
    execute_calls = conn.cursor.return_value.__enter__.return_value.execute.call_args_list
    inserts = [c for c in execute_calls if "INSERT INTO schema_validation_history" in str(c)]
    assert len(inserts) == 1, f"expected exactly one history INSERT, got {len(inserts)}"
    return inserts[0][0][1]


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
        """When drift is detected, Sentry capture_message and Redpanda emit are called.

        FOLLOW-902: this test used to feed ``<p>nothing here</p>``, which matches ZERO
        of the seven selectors — i.e. the only "drift" this suite ever exercised was
        the total-miss case that is now classified as a validator error. That is
        exactly why the prod false positive shipped green. It now uses PARTIAL_HTML,
        where 2 of 7 selectors survive: genuine differential drift.
        """
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
            # 2 of 7 selectors survive — below the 0.8 threshold AND a required
            # selector (div.listing-card) fails. Differential: real drift.
            mock_client_instance.get.return_value = MagicMock(
                status_code=200,
                text=PARTIAL_HTML,
                url="https://example.com/property/123",
            )

            _run_validation(conn)

        # Partial survival below threshold must be reported as drift
        mock_sentry.assert_called_once()
        assert "Schema drift detected" in mock_sentry.call_args[0][0]
        assert mock_sentry.call_args.kwargs["fingerprint"][0] == "schema-drift"
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
            # PARTIAL_HTML = real drift (2/7 match). FOLLOW-902: was zero-match HTML,
            # which no longer reaches the drift dedup path at all.
            mock_client_instance.get.return_value = MagicMock(
                status_code=200,
                text=PARTIAL_HTML,
                url="https://example.com/property/123",
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
# FOLLOW-902 — zero coverage is a validator error, not drift
# ---------------------------------------------------------------------------

# The document the validator ACTUALLY scored in prod on 2026-08-08: the public
# marketing page app.estalara.com/en, reached by a 302 from the domain-root fallback.
# Trimmed to its load-bearing property — a real, server-rendered page with content and
# zero listing markup. Every stored selector misses, and nothing has drifted.
MARKETING_PAGE_HTML = """
<!doctype html><html lang="en"><head><title>Estalara</title></head><body>
  <h1 class="text-2xl font-bold">Find a place to call home</h1>
  <a href="/auth">Log in</a>
</body></html>
"""


class TestZeroCoverageIsNotDrift:
    """The AC(4) judgement, pinned: a total miss must not enter the drift channel."""

    def test_classify_outcome_zero_match_is_validator_error(self) -> None:
        """No selector matched → zero_coverage, even though coverage < threshold."""
        results = {"a": False, "b": False, "c": False}
        outcome, coverage, failed = classify_outcome(results, [])
        assert outcome == OUTCOME_ZERO_COVERAGE
        assert outcome != OUTCOME_DRIFT
        assert coverage == 0.0
        assert len(failed) == 3

    def test_classify_outcome_partial_match_is_drift(self) -> None:
        """At least one survivor below threshold → drift. Drift is differential."""
        results = {"a": True, "b": False, "c": False, "d": False, "e": False}
        outcome, coverage, _ = classify_outcome(results, [])
        assert outcome == OUTCOME_DRIFT
        assert coverage < DRIFT_THRESHOLD

    def test_classify_outcome_required_failure_with_survivors_is_drift(self) -> None:
        """A required selector failing is drift only while something else matched."""
        results = {"req": False, "other": True, "third": True, "fourth": True, "fifth": True}
        outcome, _, _ = classify_outcome(results, ["req"])
        assert outcome == OUTCOME_DRIFT

    def test_classify_outcome_all_match_is_ok(self) -> None:
        outcome, coverage, failed = classify_outcome({"a": True, "b": True}, ["a"])
        assert outcome == OUTCOME_OK
        assert coverage == 1.0
        assert failed == []

    def test_classify_outcome_empty_results_is_ok(self) -> None:
        """No selectors checked is not a total miss — it is nothing to say."""
        assert classify_outcome({}, [])[0] == OUTCOME_OK

    def test_classify_outcome_agrees_with_compute_coverage_number(self) -> None:
        """Parity: the classifier must never report a different coverage number.

        Rule K.1 — one implementation of the metric, not two that can drift apart.
        """
        for results in (
            {"a": False, "b": False},
            {"a": True, "b": False, "c": False},
            {"a": True, "b": True},
            {},
        ):
            expected_coverage, _, expected_failed = compute_coverage(results, [])
            _, actual_coverage, actual_failed = classify_outcome(results, [])
            assert actual_coverage == expected_coverage
            assert actual_failed == expected_failed

    def test_zero_coverage_writes_error_row_and_no_drift(self) -> None:
        """Total miss: drift_detected FALSE, error names the fetched URL, no Redpanda."""
        tenant_id = "aaaaaaaa-0000-0000-0000-00000000090a"
        conn = _make_mock_conn(
            db_rows=[_make_db_row(tenant_id=tenant_id, schema_jsonb=_PROD_SCHEMA_WITH_SAMPLE_URL)]
        )

        with (
            patch("crons.schema_validation.httpx.Client") as mock_http_cls,
            patch("crons.schema_validation.sentry_sdk.capture_message"),
            patch("crons.schema_validation._emit_redpanda_event") as mock_redpanda,
            patch("crons.schema_validation._was_alerted_recently", return_value=False),
        ):
            mock_client_instance = MagicMock()
            mock_http_cls.return_value.__enter__.return_value = mock_client_instance
            # Requested a listing URL, got redirected to the marketing page.
            mock_client_instance.get.return_value = MagicMock(
                status_code=200,
                text=MARKETING_PAGE_HTML,
                url="https://app.estalara.com/en",
            )

            _run_validation(conn)

        # The drift channel stays silent — nothing was observed to drift.
        mock_redpanda.assert_not_called()

        insert_args = _only_history_insert_args(conn)
        assert insert_args[6] is False, "zero coverage must not set drift_detected"
        error = insert_args[7] or ""
        assert error.startswith(ERROR_PREFIX_ZERO_COVERAGE)
        # The reader must be able to see WHICH page was scored without re-running.
        assert "https://app.estalara.com/en" in error
        assert "https://app.estalara.com/en/listings/abc123" in error

    def test_zero_coverage_alerts_on_its_own_fingerprint_not_the_drift_one(self) -> None:
        """Not suppressed — routed. A distinct Sentry signal with a distinct fingerprint."""
        tenant_id = "aaaaaaaa-0000-0000-0000-00000000090b"
        conn = _make_mock_conn(
            db_rows=[_make_db_row(tenant_id=tenant_id, schema_jsonb=_PROD_SCHEMA_WITH_SAMPLE_URL)]
        )

        with (
            patch("crons.schema_validation.httpx.Client") as mock_http_cls,
            patch("crons.schema_validation.sentry_sdk.capture_message") as mock_sentry,
            patch("crons.schema_validation._emit_redpanda_event"),
            patch("crons.schema_validation._was_alerted_recently", return_value=False),
        ):
            mock_client_instance = MagicMock()
            mock_http_cls.return_value.__enter__.return_value = mock_client_instance
            mock_client_instance.get.return_value = MagicMock(
                status_code=200, text=MARKETING_PAGE_HTML, url="https://app.estalara.com/en"
            )

            _run_validation(conn)

        mock_sentry.assert_called_once()
        message = mock_sentry.call_args[0][0]
        kwargs = mock_sentry.call_args.kwargs
        assert "could not measure" in message
        assert "drift" not in message.lower(), "must not read as a drift alert"
        assert kwargs["fingerprint"][0] == "schema-validation-zero-coverage"
        assert kwargs["extras"]["outcome"] == OUTCOME_ZERO_COVERAGE
        assert kwargs["extras"]["fetched_url"] == "https://app.estalara.com/en"

    def test_zero_coverage_alert_dedups_on_its_own_error_prefix(self) -> None:
        """Dedup must key on the error prefix — these rows leave drift_detected FALSE."""
        tenant_id = "aaaaaaaa-0000-0000-0000-00000000090c"
        conn = _make_mock_conn(
            db_rows=[_make_db_row(tenant_id=tenant_id, schema_jsonb=_PROD_SCHEMA_WITH_SAMPLE_URL)]
        )

        with (
            patch("crons.schema_validation.httpx.Client") as mock_http_cls,
            patch("crons.schema_validation.sentry_sdk.capture_message") as mock_sentry,
            patch("crons.schema_validation._emit_redpanda_event"),
            patch("crons.schema_validation._was_alerted_recently", return_value=True) as mock_dedup,
        ):
            mock_client_instance = MagicMock()
            mock_http_cls.return_value.__enter__.return_value = mock_client_instance
            mock_client_instance.get.return_value = MagicMock(
                status_code=200, text=MARKETING_PAGE_HTML, url="https://app.estalara.com/en"
            )

            _run_validation(conn)

        mock_sentry.assert_not_called()
        assert mock_dedup.call_args.kwargs["error_prefix"] == ERROR_PREFIX_ZERO_COVERAGE
        # …and the row is still written, so the dedup silences the alert, not the record.
        assert _only_history_insert_args(conn)[7].startswith(ERROR_PREFIX_ZERO_COVERAGE)


class TestMissingSampleUrlIsConfigGap:
    """A tenant that cannot be validated fails loudly as config, not silently as drift."""

    def test_missing_sample_url_never_fetches_anything(self) -> None:
        """No sample_listing_url → no guessed URL, no HTTP request at all."""
        conn = _make_mock_conn(
            db_rows=[
                _make_db_row(
                    tenant_id="aaaaaaaa-0000-0000-0000-00000000090d",
                    schema_jsonb=_PROD_SCHEMA_NO_SAMPLE_URL,
                )
            ]
        )

        with (
            patch("crons.schema_validation.httpx.Client") as mock_http_cls,
            patch("crons.schema_validation.sentry_sdk.capture_message"),
            patch("crons.schema_validation._emit_redpanda_event"),
            patch("crons.schema_validation._was_alerted_recently", return_value=False),
        ):
            _run_validation(conn)

        # THE regression: the domain-root fallback that manufactured the prod 0.0.
        mock_http_cls.assert_not_called()

    def test_missing_sample_url_writes_config_gap_row_not_drift(self) -> None:
        conn = _make_mock_conn(
            db_rows=[
                _make_db_row(
                    tenant_id="aaaaaaaa-0000-0000-0000-00000000090e",
                    schema_jsonb=_PROD_SCHEMA_NO_SAMPLE_URL,
                )
            ]
        )

        with (
            patch("crons.schema_validation.httpx.Client"),
            patch("crons.schema_validation.sentry_sdk.capture_message") as mock_sentry,
            patch("crons.schema_validation._emit_redpanda_event") as mock_redpanda,
            patch("crons.schema_validation._was_alerted_recently", return_value=False),
        ):
            _run_validation(conn)

        mock_redpanda.assert_not_called()

        insert_args = _only_history_insert_args(conn)
        assert insert_args[6] is False, "a config gap is not drift"
        assert (insert_args[7] or "").startswith(ERROR_PREFIX_CONFIG_GAP)
        assert "sample_listing_url" in insert_args[7]
        # total_selectors is still recorded — the schema is fine, the config is not.
        assert insert_args[4] > 0

        mock_sentry.assert_called_once()
        kwargs = mock_sentry.call_args.kwargs
        assert kwargs["fingerprint"][0] == "schema-validation-config-gap"
        assert "drift" not in mock_sentry.call_args[0][0].lower()

    def test_config_gap_alert_dedups_on_its_own_prefix(self) -> None:
        conn = _make_mock_conn(
            db_rows=[
                _make_db_row(
                    tenant_id="aaaaaaaa-0000-0000-0000-00000000090f",
                    schema_jsonb=_PROD_SCHEMA_NO_SAMPLE_URL,
                )
            ]
        )

        with (
            patch("crons.schema_validation.httpx.Client"),
            patch("crons.schema_validation.sentry_sdk.capture_message") as mock_sentry,
            patch("crons.schema_validation._was_alerted_recently", return_value=True) as mock_dedup,
        ):
            _run_validation(conn)

        mock_sentry.assert_not_called()
        assert mock_dedup.call_args.kwargs["error_prefix"] == ERROR_PREFIX_CONFIG_GAP


class TestProdRegressionAppEstalara:
    """Golden regression on the exact prod condition recorded as [MP-006].

    Model: RETRO-014 — assert the canonical tokens are present and the stale ones
    absent, so a future refactor cannot quietly restore the false-positive shape.

    Measured facts this pins (FOLLOW-902 AC1):
      tenant cbc51cfa-1056-40aa-b0a9-6e982b52b1de / app.estalara.com
      schema has NO sample_listing_url  →  old code fetched https://app.estalara.com
      →  302 to /en (public marketing page, 0 data-estalara attributes)
      →  0/10 selectors matched  →  coverage 0.0  →  drift_detected = TRUE (false)
    """

    # The exact `failed_selectors` array of the two prod rows, in order.
    _PROD_FAILED_SELECTORS = [
        "[data-estalara-listing-id]",
        "[data-estalara-slot='listing-grid']",
        "[data-estalara-slot='area']",
        "[data-estalara-slot='photo']",
        "[data-estalara-slot='price']",
        "[data-estalara-slot='bedrooms']",
        "[data-estalara-slot='headline']",
        "[data-estalara-slot='cta']",
        "[data-estalara-slot='description']",
        "[data-estalara-slot='bathrooms']",
    ]

    def test_extract_selectors_reproduces_the_prod_selector_set(self) -> None:
        """The transcribed fixture must yield the 10 selectors prod actually stored.

        If this drifts, every other assertion in this class is measuring a schema
        that prod does not have.
        """
        all_selectors, required = extract_selectors(_PROD_SCHEMA_NO_SAMPLE_URL)
        assert all_selectors == self._PROD_FAILED_SELECTORS
        assert required == [
            "[data-estalara-listing-id]",
            "[data-estalara-slot='headline']",
        ]

    def test_marketing_page_reproduces_zero_of_ten_but_is_not_drift(self) -> None:
        """The prod numbers, reproduced from the prod page, with the new verdict."""
        results = check_selectors(MARKETING_PAGE_HTML, self._PROD_FAILED_SELECTORS)

        # The measurement is unchanged — this ticket did not move the numbers.
        assert len(results) == 10
        assert sum(results.values()) == 0

        outcome, coverage, failed = classify_outcome(
            results, ["[data-estalara-listing-id]", "[data-estalara-slot='headline']"]
        )
        assert coverage == 0.0
        assert len(failed) == 10

        # Only the classification moved.
        assert outcome == OUTCOME_ZERO_COVERAGE
        assert outcome != OUTCOME_DRIFT
        # compute_coverage still says "drift" in isolation — that is precisely why
        # callers must not read it directly.
        assert compute_coverage(results, [])[1] is True

    def test_canonical_outcome_vocabulary_is_stable(self) -> None:
        """The error prefixes are dedup keys and runbook grep targets — pin them."""
        assert OUTCOME_ZERO_COVERAGE == "zero_coverage"
        assert OUTCOME_DRIFT == "drift"
        assert OUTCOME_OK == "ok"
        assert ERROR_PREFIX_CONFIG_GAP == "config_gap:"
        assert ERROR_PREFIX_ZERO_COVERAGE == "validator_error: zero_coverage"
        assert ERROR_PREFIX_FETCH_FAILED == "fetch_failed:"

    def test_no_domain_root_fallback_survives_in_source(self) -> None:
        """The stale token: an f-string building a URL out of a bare domain.

        This is the line that produced the prod false positive. If it comes back,
        so does the artefact, and this suite would otherwise still be green.
        """
        source = Path(schema_validation_module.__file__).read_text(encoding="utf-8")
        code_lines = [
            line
            for line in source.splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        assert not [line for line in code_lines if 'f"https://{domain}"' in line], (
            "domain-root fallback restored — see FOLLOW-902"
        )


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


# ---------------------------------------------------------------------------
# FOLLOW-893: absence-of-signal heartbeat. The point of these tests is the
# NEGATIVE direction — the heartbeat must NOT be written when the run failed,
# because a heartbeat written unconditionally is a green badge over a dead job.
# ---------------------------------------------------------------------------


class TestHeartbeat:
    def test_write_heartbeat_upserts_job_name_and_pair_count(self) -> None:
        """_write_heartbeat UPSERTs one row keyed by job_name, carrying the pair count."""
        conn = MagicMock()
        cur = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur

        _write_heartbeat(conn, tenant_domain_pairs=3)

        sql, params = cur.execute.call_args[0]
        assert "INSERT INTO cron_heartbeats" in sql
        assert "ON CONFLICT (job_name) DO UPDATE" in sql
        assert params[0] == HEARTBEAT_JOB_NAME
        assert json.loads(params[1]) == {"tenant_domain_pairs": 3}
        conn.commit.assert_called_once()

    def test_write_heartbeat_never_raises(self) -> None:
        """A failing heartbeat write degrades to a log line, never a failed run.

        Losing the heartbeat is already loud: the external 26h assertion goes red.
        Escalating it here would turn a successful validation into a failed one.
        """
        conn = MagicMock()
        conn.cursor.side_effect = RuntimeError("connection went away")

        _write_heartbeat(conn, tenant_domain_pairs=1)  # must not raise

    async def test_validate_schemas_writes_heartbeat_on_success(self) -> None:
        """The success path reaches the heartbeat, carrying _run_validation's count."""
        with (
            patch("crons.schema_validation._get_db_connection") as mock_get_conn,
            patch("crons.schema_validation._run_validation", return_value=7) as mock_run,
            patch("crons.schema_validation.init_sentry"),
            patch("crons.schema_validation.flush_sentry"),
            patch("crons.schema_validation._write_heartbeat") as mock_hb,
        ):
            mock_conn = MagicMock()
            mock_get_conn.return_value = mock_conn

            await validate_schemas.local()

        mock_run.assert_called_once_with(mock_conn)
        mock_hb.assert_called_once_with(mock_conn, tenant_domain_pairs=7)

    async def test_validate_schemas_does_not_write_heartbeat_when_run_raises(self) -> None:
        """THE load-bearing test: a failed run must leave the heartbeat untouched.

        If this ever regresses, the detector goes permanently green over a job that
        fails every single night — precisely the failure FOLLOW-893 exists to make
        impossible.
        """
        with (
            patch("crons.schema_validation._get_db_connection") as mock_get_conn,
            patch(
                "crons.schema_validation._run_validation",
                side_effect=RuntimeError("validation blew up"),
            ),
            patch("crons.schema_validation.init_sentry"),
            patch("crons.schema_validation.flush_sentry"),
            patch("crons.schema_validation._write_heartbeat") as mock_hb,
        ):
            mock_conn = MagicMock()
            mock_get_conn.return_value = mock_conn

            with pytest.raises(RuntimeError, match="validation blew up"):
                await validate_schemas.local()

        mock_hb.assert_not_called()
        mock_conn.close.assert_called_once()

    def test_run_validation_returns_zero_when_nothing_to_validate(self) -> None:
        """An empty tenant set is a healthy no-op that still returns a count.

        This is why the heartbeat exists at all: this run writes ZERO
        schema_validation_history rows, so the history table cannot tell it apart
        from a run that never happened.
        """
        conn = _make_mock_conn(db_rows=[])
        assert _run_validation(conn) == 0
