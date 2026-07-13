"""
Cross-runtime per-listing embed POST contract parity (Python side) — FOLLOW-567.

The Modal embed-seed consumer POSTs ``{ tenant_id, listing_id }`` (NO text_fields)
to ``POST /api/listings/embed``. The control-plane route self-fetches the listing
text from the Estalara backend when text_fields is absent (FOLLOW-567). The
REQUIRED keys of that per-listing POST body live in the shared fixture:

    packages/shared/contracts/listing-embed-post.required.json

so a drift on either runtime fails a test (Rule Z — this is the gap class that
produced FOLLOW-567: the event fixture covered tenant_id+listing_ids, but nothing
pinned the downstream per-listing POST body). The TS side asserts the route
ACCEPTS a ``{ tenant_id, listing_id }`` body (embed/route.test.ts FOLLOW-567
cases); this test asserts the Python side SENDS exactly those keys and never
re-introduces the ``text_fields`` key it does not have.
"""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from jobs.consume_embed_seed_requests import _embed_one_listing

_FIXTURE = (
    Path(__file__).resolve().parents[4]
    / "packages/shared/contracts/listing-embed-post.required.json"
)
REQUIRED_FIELDS = set(json.loads(_FIXTURE.read_text()))


def _capture_post_payload() -> dict:
    """Call _embed_one_listing with httpx.post patched; return the posted JSON body."""
    with patch("httpx.post") as mock_post:
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        mock_post.return_value = resp
        _embed_one_listing(
            "https://admin.estalara.test",
            "test-secret",
            "11111111-1111-1111-1111-111111111111",
            "listing-abc",
        )
        assert mock_post.call_count == 1
        return mock_post.call_args.kwargs["json"]


def test_embed_post_sends_exactly_the_contract_keys() -> None:
    payload = _capture_post_payload()
    assert set(payload.keys()) == REQUIRED_FIELDS


def test_embed_post_never_sends_text_fields() -> None:
    # FOLLOW-567 root cause: Modal never has text_fields. The route self-fetches,
    # so Python must keep omitting it — sending a partial/empty text_fields would
    # defeat the self-fetch and 400 on the non-empty refinement.
    payload = _capture_post_payload()
    assert "text_fields" not in payload


def test_contract_fixture_matches_expected() -> None:
    assert REQUIRED_FIELDS == {"tenant_id", "listing_id"}
