"""
FOLLOW-1305 (Codex WP01, FOLLOW-820 condition 1c) — unsupported claims are refused before FIT
and before EVERY cache writer, in the PRODUCTION job body.

Every test here runs `generate_description.get_raw_f()(event)` — the job function itself, not
the `_run_job` copy in test_generate_description.py (Codex review: "a copy of the job is not its
execution"). Only the external boundaries are replaced: the Anthropic client class and the
`httpx.post` transport. The two cache writers (`_write_to_redis`, `_write_to_postgres_cache`)
and the `llm_calls` logger run for real, so "nothing was written" is observed at the transport,
which is where a write would have to pass.

The negative corpus inverts the archive's reproductions
(docs/audits/revalidation-2026-10-08/probes/python_reproduce.py): the probe asserted the
defect (FIT + both writers called on an unsupported 9.9% yield); these assert the contract.
"""

from __future__ import annotations

import json
import re
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from jobs import generate_description as gd

_CH_URL = "http://clickhouse.test:8123/"
_REDIS_URL = "https://redis.test"
_PG_BASE = "https://control-plane.test"


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "local-no-network")
    monkeypatch.setenv("UPSTASH_REDIS_URL", _REDIS_URL)
    monkeypatch.setenv("UPSTASH_REDIS_TOKEN", "redis-token-fixture")
    monkeypatch.setenv("DESCRIPTION_CACHE_API_BASE_URL", _PG_BASE)
    monkeypatch.setenv("DESCRIPTION_CACHE_INTERNAL_SECRET", "pg-secret-fixture")
    monkeypatch.setenv("CLICKHOUSE_URL", _CH_URL)


class _Transport:
    """Records every httpx.post the job makes, classified by sink."""

    def __init__(self) -> None:
        self.redis: list[Any] = []
        self.pg: list[dict[str, Any]] = []
        self.llm_call_sources: list[str] = []

    def __call__(self, url: str, **kwargs: Any) -> MagicMock:
        resp = MagicMock()
        resp.status_code = 200
        resp.raise_for_status = MagicMock()
        # The spend-cap read: rolling 24h spend = 0, so the breaker stays closed.
        resp.json = MagicMock(return_value={"data": [{"total": 0}]})
        if url.startswith(_REDIS_URL):
            self.redis.append(json.loads(kwargs["json"][0][2]))
        elif url.startswith(_PG_BASE):
            self.pg.append(kwargs["json"])
        elif url.startswith(_CH_URL) and "param_p_source" in (kwargs.get("params") or {}):
            self.llm_call_sources.append(kwargs["params"]["param_p_source"])
        return resp


def _anthropic_response(text: str) -> MagicMock:
    response = MagicMock()
    response.content = [MagicMock(text=text)]
    response.usage = MagicMock(input_tokens=100, output_tokens=40)
    response.stop_reason = "end_turn"
    return response


def _fit(body: str, facts: list[str] | None = None) -> str:
    return (
        "<adaptation_verdict>FIT</adaptation_verdict>\n"
        + body
        + "\n<verified_facts_used>\n"
        + json.dumps(facts if facts is not None else ["bedrooms: 2"])
        + "\n</verified_facts_used>"
    )


_EVENT: dict[str, Any] = {
    "tenant_id": "00000000-0000-4000-8000-000000001305",
    "listing_id": "listing-1305",
    "archetype": "yield_hunter",
    "cache_key": "desc:t:listing-1305:yield_hunter:en:claude-sonnet-4-6",
    "locale": "en",
    "copy_template": "",
    "original_description": "An apartment with two bedrooms and no pool.",
    "listing_context": {"price": "400000", "location": "Lisbon"},
}


def _run(
    description_raw: str, headline_raw: str = "Apartment in Lisbon with two bedrooms"
) -> tuple[_Transport, MagicMock]:
    transport = _Transport()
    with (
        patch("anthropic.Anthropic") as provider_cls,
        patch("httpx.post", side_effect=transport),
    ):
        client = MagicMock()
        provider_cls.return_value = client
        client.messages.create.side_effect = [
            _anthropic_response(description_raw),
            _anthropic_response(headline_raw),
        ]
        gd.generate_description.get_raw_f()(dict(_EVENT))
    return transport, client


# The negative corpus. Each body is a FIT verdict whose text asserts something the listing does
# not say. `9.9%` is the Codex reproduction; the others are the F-01/F-02 classes.
_NEGATIVE_CORPUS = {
    "unsupported_yield": "A two-bedroom apartment in Lisbon offering a 9.9% yield.",
    "invented_pool": "A two-bedroom apartment in Lisbon with a private pool.",
    "invented_sea_view": "A two-bedroom apartment in Lisbon with sea views from every room.",
    "guarantee_no_work": (
        "A two-bedroom apartment in Lisbon. Nothing here needs work before it earns."
    ),
    "guarantee_income": "A two-bedroom apartment in Lisbon with guaranteed rental income.",
    "price_as_area": "A two-bedroom apartment in Lisbon with 400000 square metres of space.",
}


@pytest.mark.parametrize("case", sorted(_NEGATIVE_CORPUS))
def test_negative_corpus_refused_before_fit_and_every_cache_writer(case: str) -> None:
    transport, client = _run(_fit(_NEGATIVE_CORPUS[case]))

    # Nothing reached either cache writer's transport.
    assert transport.redis == [], f"{case}: Redis written {transport.redis}"
    assert transport.pg == [], f"{case}: Postgres written {transport.pg}"
    # Refused before FIT: the job never went on to the headline call.
    assert client.messages.create.call_count == 1
    # Cost row kept, and the refusal recorded as such.
    assert transport.llm_call_sources == ["description", "description_claim_refused"]


@pytest.mark.parametrize("case", sorted(_NEGATIVE_CORPUS))
def test_negative_corpus_verdict_is_refused_not_fit(case: str) -> None:
    with (
        patch("anthropic.Anthropic") as provider_cls,
        patch("httpx.post", side_effect=_Transport()),
    ):
        provider_cls.return_value.messages.create.return_value = _anthropic_response(
            _fit(_NEGATIVE_CORPUS[case])
        )
        description, facts, verdict = gd._generate_with_sonnet(
            "yield_hunter",
            "",
            dict(_EVENT["listing_context"]),
            original_description=_EVENT["original_description"],
        )
    assert (description, facts, verdict) == ("", [], "REFUSED")


def test_positive_control_same_fixture_is_served_and_stamped() -> None:
    """Supported transformation only → FIT, both writers called, both stamped validated."""
    transport, client = _run(
        _fit("A two-bedroom apartment in Lisbon, a straightforward option for a rental buyer.")
    )

    assert len(transport.redis) == 1
    assert len(transport.pg) == 1
    assert transport.redis[0]["claims_validation"] == gd.CLAIMS_VALIDATION_VERSION
    assert transport.pg[0]["claims_validation"] == gd.CLAIMS_VALIDATION_VERSION
    assert transport.redis[0]["headline"] == "Apartment in Lisbon with two bedrooms"
    assert client.messages.create.call_count == 2
    assert transport.llm_call_sources == ["description", "headline"]


def test_negated_listing_fact_does_not_ground_the_amenity() -> None:
    """'no pool' in the listing is not evidence of a pool (Codex probe input)."""
    assert (
        gd._check_body_claims(
            "An apartment with a pool.", "An apartment with no pool.", {"price": "400000"}
        )
        == "unsupported_amenity"
    )
    assert (
        gd._check_body_claims("An apartment with a pool.", "An apartment with a heated pool.", {})
        is None
    )


def test_area_grounded_by_an_area_field_passes() -> None:
    assert (
        gd._check_body_claims("Offers 128 m² of living space.", "", {"living_area": "128"}) is None
    )
    assert (
        gd._check_body_claims("Offers 128 m² of living space.", "", {"price": "128"})
        == "unit_mismatch"
    )


def test_model_self_report_is_not_the_headline_whitelist() -> None:
    """`verified_facts_used` is the model's own claim, never a verified list (Codex :1936)."""
    transport, client = _run(
        _fit(
            "A two-bedroom apartment in Lisbon, a straightforward option for a rental buyer.",
            facts=["pool: yes", "sea view: yes"],
        )
    )
    headline_prompt = client.messages.create.call_args_list[1].kwargs["messages"][0]["content"]
    assert "pool: yes" not in headline_prompt
    assert "sea view" not in headline_prompt
    # The whitelist is built from the listing's own fields.
    assert "price: 400000" in headline_prompt
    assert "location: Lisbon" in headline_prompt
    assert len(transport.redis) == 1


def test_headline_asserting_an_invented_amenity_is_dropped_before_the_write() -> None:
    transport, _ = _run(
        _fit("A two-bedroom apartment in Lisbon, a straightforward option for a rental buyer."),
        headline_raw="Apartment in Lisbon with private pool",
    )
    assert len(transport.redis) == 1
    assert transport.redis[0]["headline"] is None
    assert transport.pg[0]["headline"] is None


_EXAMPLE_RE = re.compile(
    r"Verified facts available \(illustrative\): (?P<facts>.*?)\n\nGood output:\n\n"
    r"(?P<out>.*?)\n\n<verified_facts_used>",
    re.S,
)


def test_few_shot_good_outputs_assert_nothing_absent_from_their_stated_facts() -> None:
    prompt = gd._SONNET_SYSTEM_PROMPT_TEMPLATE
    examples = list(_EXAMPLE_RE.finditer(prompt))
    assert len(examples) == 3
    for m in examples:
        assert gd._check_body_claims(m.group("out"), m.group("facts"), {}) is None, m.group("out")
    # The two sentences the Codex review quoted are gone.
    assert "Nothing here needs work before it earns." not in prompt
    assert "no works and no waiting" not in prompt
