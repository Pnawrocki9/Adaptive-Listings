"""
Continuous Schema Validation Cron — TICKET-VAL-001.

Daily Modal job (02:00 UTC) that iterates all active tenants, fetches a sample
listing page for each, re-runs deterministic CSS selector validation against the
live HTML, detects drift, and writes a schema_validation_history row to Postgres.

Drift is defined as:
  - coverage_score < 0.8  (fewer than 80% of stored selectors still match), OR
  - any selector marked ``required`` in the stored schema fails to match.

On drift:
  1. Emits a ``schema_drift_detected`` event to Redpanda topic ``estalara.schema``.
  2. Captures a Sentry warning — deduplicated to once per tenant per 24h window.
  3. Writes a ``schema_validation_history`` row with ``drift_detected = True``.

On page-fetch failure:
  - Writes a ``schema_validation_history`` row with ``drift_detected = False``
    and ``error = "fetch_failed: <detail>"``.
  - Does NOT emit Sentry drift alert (network errors ≠ schema drift).
  - Continues to the next tenant.

Idempotency: two runs on the same day produce two rows — both are retained.
Sentry deduplication: the most recent ``drift_detected = True`` row is checked
before emitting; if it is within 24h the Sentry call is skipped.

References:
  - Master Design B.6 (Continuous Schema Validation & Self-Healing)
  - packages/shared/src/tenant-site-schema.ts (TenantSiteSchema shape)
  - packages/db/src/schema/tenant_site_schemas.ts (schema JSONB field mapping)
  - TICKET-VAL-001 spec
"""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import modal
import psycopg2
import psycopg2.extras
import sentry_sdk
from bs4 import BeautifulSoup
from confluent_kafka import Producer

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Modal app definition
# ---------------------------------------------------------------------------

app = modal.App("estalara-schema-validation")

# ---------------------------------------------------------------------------
# Public helpers (independently testable — no Modal context required)
# ---------------------------------------------------------------------------

DRIFT_THRESHOLD = 0.8
FETCH_TIMEOUT_SECONDS = 10
USER_AGENT = "Estalara-SchemaValidator/1.0"
SENTRY_DEDUP_WINDOW_HOURS = 24


def check_selectors(html: str, selectors: list[str]) -> dict[str, bool]:
    """Check whether each CSS selector matches at least one element in *html*.

    Uses BeautifulSoup with the ``lxml`` parser for full CSS selector support.
    Malformed selectors are caught and recorded as ``False`` instead of raising.

    Args:
        html: Raw HTML string of the fetched page.
        selectors: List of CSS selector strings to validate.

    Returns:
        Mapping of selector → True (matched) / False (no match or malformed).

    Example:
        >>> html = '<h1 class="property-title">House</h1>'
        >>> check_selectors(html, ["h1.property-title", "span.price"])
        {'h1.property-title': True, 'span.price': False}
    """
    soup = BeautifulSoup(html, "lxml")
    results: dict[str, bool] = {}
    for selector in selectors:
        try:
            matches = soup.select(selector)
            results[selector] = len(matches) > 0
        except Exception:  # noqa: BLE001
            # Malformed selector — count as failed without crashing the batch.
            results[selector] = False
    return results


def extract_selectors(schema_jsonb: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Extract all CSS selector strings and required selector strings from *schema_jsonb*.

    The ``schema`` JSONB column stores a ``TenantSiteSchema`` object. The relevant
    selector fields live under ``index_schema`` and ``detail_schema``.

    Returns:
        (all_selectors, required_selectors)  — both as flat lists of CSS strings.

    The following fields are treated as required (their absence = drift regardless
    of coverage threshold):
      - ``index_schema.listing_card_selector``
      - ``detail_schema.slot_selectors.headline.primary`` (if present)
    """
    all_selectors: list[str] = []
    required_selectors: list[str] = []

    def _add_strategy(strategy: Any) -> None:
        """Pull ``primary`` + ``fallbacks`` from a SelectorStrategy dict."""
        if not isinstance(strategy, dict):
            return
        primary = strategy.get("primary")
        if isinstance(primary, str) and primary:
            all_selectors.append(primary)
        for fallback in strategy.get("fallbacks", []):
            if isinstance(fallback, str) and fallback:
                all_selectors.append(fallback)

    # index_schema selectors
    index_schema = schema_jsonb.get("index_schema", {})
    if isinstance(index_schema, dict):
        card_sel = index_schema.get("listing_card_selector")
        if isinstance(card_sel, str) and card_sel:
            all_selectors.append(card_sel)
            required_selectors.append(card_sel)

        container_sel = index_schema.get("container_selector")
        if isinstance(container_sel, str) and container_sel:
            all_selectors.append(container_sel)

        for _field, strategy in index_schema.get("card_field_mappings", {}).items():
            _add_strategy(strategy)
        for _field, strategy in index_schema.get("data_extractors_per_card", {}).items():
            _add_strategy(strategy)

    # detail_schema selectors
    detail_schema = schema_jsonb.get("detail_schema", {})
    if isinstance(detail_schema, dict):
        slot_selectors = detail_schema.get("slot_selectors", {})
        if isinstance(slot_selectors, dict):
            headline_strategy = slot_selectors.get("headline")
            if isinstance(headline_strategy, dict):
                primary = headline_strategy.get("primary")
                if isinstance(primary, str) and primary:
                    all_selectors.append(primary)
                    required_selectors.append(primary)
                for fallback in headline_strategy.get("fallbacks", []):
                    if isinstance(fallback, str) and fallback:
                        all_selectors.append(fallback)
            for slot_name, strategy in slot_selectors.items():
                if slot_name != "headline":
                    _add_strategy(strategy)

        for _field, strategy in detail_schema.get("data_extractors", {}).items():
            _add_strategy(strategy)

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_all: list[str] = []
    for sel in all_selectors:
        if sel not in seen:
            seen.add(sel)
            unique_all.append(sel)

    unique_required = list(dict.fromkeys(required_selectors))

    return unique_all, unique_required


def compute_coverage(
    selector_results: dict[str, bool],
    required_selectors: list[str],
) -> tuple[float, bool, list[str]]:
    """Compute coverage score and drift status from selector check results.

    Args:
        selector_results: Output of ``check_selectors()``.
        required_selectors: Selectors that must all match (drift if any fail).

    Returns:
        (coverage_score, drift_detected, failed_selectors)
    """
    if not selector_results:
        return 1.0, False, []

    total = len(selector_results)
    matched = sum(1 for ok in selector_results.values() if ok)
    coverage_score = matched / total

    failed = [sel for sel, ok in selector_results.items() if not ok]
    required_failures = [sel for sel in required_selectors if not selector_results.get(sel, False)]

    drift_detected = coverage_score < DRIFT_THRESHOLD or bool(required_failures)

    return coverage_score, drift_detected, failed


def _get_db_connection() -> "psycopg2.extensions.connection":
    """Return a psycopg2 connection using DATABASE_URL from environment."""
    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    return psycopg2.connect(database_url, cursor_factory=psycopg2.extras.RealDictCursor)


def _write_history_row(
    conn: "psycopg2.extensions.connection",
    *,
    tenant_id: str,
    domain: str,
    coverage_score: float,
    failed_selectors: list[str],
    total_selectors: int,
    matched_selectors: int,
    drift_detected: bool,
    error: str | None,
) -> None:
    """INSERT a schema_validation_history row inside an open connection.

    Commits the transaction; caller owns the connection lifecycle.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO schema_validation_history
                (tenant_id, domain, coverage_score, failed_selectors,
                 total_selectors, matched_selectors, drift_detected, run_at, error)
            VALUES
                (%s, %s, %s, %s, %s, %s, %s, NOW(), %s)
            """,
            (
                tenant_id,
                domain,
                coverage_score,
                failed_selectors,
                total_selectors,
                matched_selectors,
                drift_detected,
                error,
            ),
        )
    conn.commit()


def _was_drift_alerted_recently(
    conn: "psycopg2.extensions.connection",
    tenant_id: str,
) -> bool:
    """Return True if a drift alert was already written for this tenant within 24h.

    Used to deduplicate Sentry alerts — we still write the history row, but skip
    the Sentry capture if one was already emitted today.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT run_at FROM schema_validation_history
            WHERE tenant_id = %s
              AND drift_detected = TRUE
              AND run_at > NOW() - INTERVAL '24 hours'
            ORDER BY run_at DESC
            LIMIT 1
            """,
            (tenant_id,),
        )
        row = cur.fetchone()
    return row is not None


def _emit_redpanda_event(
    *,
    tenant_id: str,
    domain: str,
    coverage_score: float,
    failed_selectors: list[str],
    detection_confidence: float,
) -> None:
    """Produce a ``schema_drift_detected`` event to Redpanda topic ``estalara.schema``.

    Credentials read from env: REDPANDA_BROKERS, REDPANDA_USERNAME, REDPANDA_PASSWORD.
    On failure, logs an error but does not re-raise (non-critical path).
    """
    brokers = os.environ.get("REDPANDA_BROKERS", "")
    username = os.environ.get("REDPANDA_USERNAME", "")
    password = os.environ.get("REDPANDA_PASSWORD", "")

    if not brokers:
        logger.warning("REDPANDA_BROKERS not set — skipping Redpanda event emission")
        return

    config: dict[str, Any] = {
        "bootstrap.servers": brokers,
    }
    if username and password:
        config.update(
            {
                "security.protocol": "SASL_SSL",
                "sasl.mechanism": "SCRAM-SHA-256",
                "sasl.username": username,
                "sasl.password": password,
            }
        )

    payload = {
        "tenant_id": tenant_id,
        "domain": domain,
        "coverage_score": coverage_score,
        "failed_selectors": failed_selectors,
        "detected_at": datetime.now(UTC).isoformat(),
        "schema_version": str(detection_confidence),
    }

    try:
        producer = Producer(config)
        producer.produce(
            topic="estalara.schema",
            key=tenant_id.encode(),
            value=json.dumps(
                {"event_type": "schema_drift_detected", **payload}
            ).encode(),
        )
        producer.flush(timeout=5)
        logger.info("Emitted schema_drift_detected for tenant=%s domain=%s", tenant_id, domain)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to emit Redpanda event for tenant=%s: %s", tenant_id, exc)


# ---------------------------------------------------------------------------
# Modal cron function
# ---------------------------------------------------------------------------


@app.function(
    schedule=modal.Cron("0 2 * * *"),
    secrets=[modal.Secret.from_name("estalara-secrets")],
    timeout=600,
)
async def validate_schemas() -> None:
    """Daily schema drift detection for all active tenants.

    Scheduled at 02:00 UTC. Iterates every active tenant that has a row in
    ``tenant_site_schemas``, fetches a sample listing page, validates all
    stored CSS selectors against the live HTML, and records the result.
    """
    sentry_dsn = os.environ.get("SENTRY_DSN", "")
    if sentry_dsn:
        sentry_sdk.init(
            dsn=sentry_dsn,
            environment=os.environ.get("ENV", "production"),
        )

    conn = _get_db_connection()
    try:
        _run_validation(conn)
    finally:
        conn.close()


def _run_validation(conn: "psycopg2.extensions.connection") -> None:
    """Core validation loop — accepts an open DB connection (testable).

    Fetches active tenants + their site schemas, validates each, writes history.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                t.id            AS tenant_id,
                tss.domain      AS domain,
                tss.schema      AS schema_jsonb,
                tss.detection_confidence AS detection_confidence
            FROM tenants t
            JOIN tenant_site_schemas tss ON tss.tenant_id = t.id
            WHERE t.status = 'active'
            ORDER BY t.id, tss.domain
            """
        )
        rows = cur.fetchall()

    if not rows:
        logger.info("No active tenants with site schemas — nothing to validate")
        return

    logger.info("Starting schema validation for %d tenant-domain pairs", len(rows))

    async_client: httpx.AsyncClient | None = None

    for row in rows:
        tenant_id: str = str(row["tenant_id"])
        domain: str = row["domain"]
        schema_jsonb: dict[str, Any] = (
            row["schema_jsonb"]
            if isinstance(row["schema_jsonb"], dict)
            else json.loads(row["schema_jsonb"])
        )
        detection_confidence: float = float(row["detection_confidence"] or 0.0)

        # Determine sample URL: prefer schema.sample_listing_url, fall back to domain root.
        sample_url: str = schema_jsonb.get("sample_listing_url", "")  # type: ignore[assignment]
        if not sample_url:
            sample_url = f"https://{domain}"
            logger.warning(
                "tenant=%s domain=%s: no sample_listing_url in schema JSONB — "
                "falling back to domain root %s",
                tenant_id,
                domain,
                sample_url,
            )

        # Fetch the live page
        html: str | None = None
        fetch_error: str | None = None
        try:
            with httpx.Client(
                timeout=FETCH_TIMEOUT_SECONDS,
                headers={"User-Agent": USER_AGENT},
                follow_redirects=True,
            ) as client:
                response = client.get(sample_url)
                if response.status_code == 200:
                    html = response.text
                else:
                    fetch_error = f"fetch_failed: HTTP {response.status_code}"
        except httpx.TimeoutException:
            fetch_error = "fetch_failed: timeout"
        except httpx.RequestError as exc:
            fetch_error = f"fetch_failed: {type(exc).__name__}"

        if fetch_error is not None:
            logger.error(
                "tenant=%s domain=%s: %s — writing error row, skipping drift check",
                tenant_id,
                domain,
                fetch_error,
            )
            _write_history_row(
                conn,
                tenant_id=tenant_id,
                domain=domain,
                coverage_score=0.0,
                failed_selectors=[],
                total_selectors=0,
                matched_selectors=0,
                drift_detected=False,
                error=fetch_error,
            )
            continue

        # Extract selectors from stored schema and validate against live HTML
        all_selectors, required_selectors = extract_selectors(schema_jsonb)

        if not all_selectors:
            logger.warning(
                "tenant=%s domain=%s: no selectors found in schema — skipping",
                tenant_id,
                domain,
            )
            continue

        selector_results = check_selectors(html or "", all_selectors)
        coverage_score, drift_detected, failed_selectors = compute_coverage(
            selector_results, required_selectors
        )

        logger.info(
            "tenant=%s domain=%s: coverage=%.2f drift=%s failed=%d/%d",
            tenant_id,
            domain,
            coverage_score,
            drift_detected,
            len(failed_selectors),
            len(all_selectors),
        )

        # Sentry alert — deduplicated within 24h window
        if drift_detected:
            already_alerted = _was_drift_alerted_recently(conn, tenant_id)
            if not already_alerted:
                sentry_sdk.capture_message(
                    f"Schema drift detected: {domain}",
                    level="warning",
                    extras={
                        "tenant_id": tenant_id,
                        "domain": domain,
                        "coverage_score": coverage_score,
                        "failed_selectors": failed_selectors,
                    },
                    fingerprint=["schema-drift", tenant_id, datetime.now(UTC).strftime("%Y-%m-%d")],
                )
            else:
                logger.info(
                    "tenant=%s domain=%s: Sentry alert deduplicated (already alerted within 24h)",
                    tenant_id,
                    domain,
                )

            # Emit Redpanda event (always on drift, idempotency handled by consumers)
            _emit_redpanda_event(
                tenant_id=tenant_id,
                domain=domain,
                coverage_score=coverage_score,
                failed_selectors=failed_selectors,
                detection_confidence=detection_confidence,
            )

        # Write history row
        _write_history_row(
            conn,
            tenant_id=tenant_id,
            domain=domain,
            coverage_score=coverage_score,
            failed_selectors=failed_selectors,
            total_selectors=len(all_selectors),
            matched_selectors=len(all_selectors) - len(failed_selectors),
            drift_detected=drift_detected,
            error=None,
        )

    logger.info("Schema validation complete for %d tenant-domain pairs", len(rows))
