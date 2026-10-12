#!/usr/bin/env python3
"""
FOLLOW-1297 / ADR-0023 §4 — the description-generation parity corpus, produced FROM the Python job.

Two modes:

  record  — live: run the real job functions (`_generate_with_sonnet`, then `_generate_headline`
            on FIT) against Anthropic for a fixed set of (fixture listing × archetype) pairs and
            write the RAW model outputs (text, stop_reason, usage, latency — never a request id or
            a key) to `recordings.live.v1.jsonl`. Needs ANTHROPIC_API_KEY (Doppler dev). Spend is
            printed at the end from the recorded usage and the job's own `_llm_cost_usd`.

  freeze  — offline: for every case (the live recordings + the FOLLOW-1305 hand corpus + the
            synthetic cases below), replay the raw text through `_generate_with_sonnet` /
            `_generate_headline` with the Anthropic client stubbed, capture the exact prompts the
            job sends (sha256), derive the expected verdict / reason / text / facts / headline /
            stamp by calling the job's own helpers, cross-check that derivation against what the
            job returned, and write `corpus.v1.jsonl` + `MANIFEST.json`.

The corpus is committed in PR A and NEVER regenerated (ADR-0023 §4). The generator is deleted with
`apps/llm-gateway` in PR B; after that the fixture is the only record of the Python behaviour.

Lives OUTSIDE `apps/llm-gateway/**` so running or editing it never triggers `modal-deploy.yml`.

Digest format: sha256 hex in colon-separated 8-char groups (`xxxxxxxx:xxxxxxxx:…`) and the git SHA
abbreviated to 12 chars — the repo's gitleaks `cloudflare-api-token` rule flags any 40-char run of
`[a-zA-Z0-9_-]`, which a bare 64-hex digest is. The TS parity test formats its digests the same way.

Run from the repo root:
  doppler run -p estalara-adaptive-listings -c dev --only-secrets ANTHROPIC_API_KEY -- \
      python3 scripts/parity/freeze-description-corpus.py record
  python3 scripts/parity/freeze-description-corpus.py freeze
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[2]
JOB_SRC = REPO_ROOT / "apps/llm-gateway/src"
JOB_FILE = JOB_SRC / "jobs/generate_description.py"
FIXTURE_DIR = REPO_ROOT / "apps/control-plane/src/lib/__fixtures__/description-parity"
RECORDINGS = FIXTURE_DIR / "recordings.live.v1.jsonl"
CORPUS = FIXTURE_DIR / "corpus.v1.jsonl"
MANIFEST = FIXTURE_DIR / "MANIFEST.json"

sys.path.insert(0, str(JOB_SRC))
os.environ.setdefault("ANTHROPIC_API_KEY", "offline")  # the job module reads it lazily anyway
from jobs import generate_description as gd  # noqa: E402

TENANT = "00000000-0000-4000-8000-000000001297"


def grouped(hexdigest: str) -> str:
    return ":".join(hexdigest[i : i + 8] for i in range(0, len(hexdigest), 8))


def sha(text: str) -> str:
    return grouped(hashlib.sha256(text.encode("utf-8")).hexdigest())


def cache_key(listing_id: str, archetype: str, locale: str, model: str) -> str:
    return f"desc:{TENANT}:{listing_id}:{archetype}:{locale}:{model}:r0"


def make_event(
    *,
    listing_id: str,
    archetype: str,
    original: str,
    copy_template: str,
    locale: str = "en",
    ctx: dict[str, str] | None = None,
    override_model: str | None = None,
    generation_model: str | None = None,
    listing_revision: int = 0,
) -> dict[str, Any]:
    model = gd._resolve_generation_model(override_model, generation_model)
    e: dict[str, Any] = {
        "tenant_id": TENANT,
        "listing_id": listing_id,
        "archetype": archetype,
        "locale": locale,
        "copy_template": copy_template,
        "original_description": original,
        "listing_context": dict(ctx or {}),
        "cache_key": cache_key(listing_id, archetype, locale, model),
        "listing_revision": listing_revision,
    }
    if override_model is not None:
        e["override_model"] = override_model
    if generation_model is not None:
        e["generation_model"] = generation_model
    return e


# ---------------------------------------------------------------------------------------------
# Fixture listings — copied from `DEMO_LISTING_MANIFEST` (apps/control-plane/src/lib/
# seed-listing-embeddings.ts): the 12 000-app-estalara demo listings and the FOLLOW-819 fixture.
# ---------------------------------------------------------------------------------------------

LISTINGS: list[dict[str, str]] = [
    {
        "listing_id": "listing-001",
        "title": "Marbella Villa",
        "description": "Stunning beachfront villa with private pool and panoramic sea views. 4 bedrooms, 3 bathrooms, 380 sqm of luxury living space.",
        "price": "€1,250,000",
        "location": "Marbella, Costa del Sol",
    },
    {
        "listing_id": "listing-002",
        "title": "Algarve Apartment",
        "description": "Modern 2-bedroom apartment in the heart of Albufeira. Close to beaches, restaurants and golf courses. 95 sqm.",
        "price": "€320,000",
        "location": "Albufeira, Algarve, Portugal",
    },
    {
        "listing_id": "listing-003",
        "title": "Tuscany Farmhouse",
        "description": "Rustic 5-bedroom farmhouse surrounded by vineyards and olive groves. Restored with authentic materials, 450 sqm with private garden.",
        "price": "€850,000",
        "location": "Siena, Tuscany, Italy",
    },
    {
        "listing_id": "listing-004",
        "title": "Lisbon City Centre Penthouse",
        "description": "Luxury penthouse with rooftop terrace and Tagus River views. 3 bedrooms, 2 bathrooms, 210 sqm. Doorman building.",
        "price": "€980,000",
        "location": "Chiado, Lisbon, Portugal",
    },
    {
        "listing_id": "listing-005",
        "title": "Barcelona Gothic Quarter Studio",
        "description": "Charming 1-bedroom studio in historic building. 45 sqm, fully renovated, ideal as a rental investment. 6.1% yield.",
        "price": "€245,000",
        "location": "Barri Gòtic, Barcelona, Spain",
    },
    {
        "listing_id": "listing-006",
        "title": "Ibiza Countryside Finca",
        "description": "Secluded 4-bedroom finca with infinity pool and sea glimpses. 320 sqm on 2 hectares of land. Rental licence included.",
        "price": "€2,100,000",
        "location": "San Rafael, Ibiza, Spain",
    },
    {
        "listing_id": "listing-007",
        "title": "Côte d'Azur Studio Apartment",
        "description": "Compact studio 200m from the sea. 32 sqm, south-facing balcony, underground parking. Strong rental yield in high season.",
        "price": "€195,000",
        "location": "Nice, Côte d'Azur, France",
    },
    {
        "listing_id": "listing-008",
        "title": "Costa Blanca Family Villa",
        "description": "Spacious 5-bedroom detached villa with private pool and landscaped garden. 430 sqm, quiet urbanisation, garage for 2 cars.",
        "price": "€590,000",
        "location": "Jávea, Costa Blanca, Spain",
    },
    {
        "listing_id": "listing-009",
        "title": "Dubai Marina High-Rise Apartment",
        "description": "Contemporary 2-bedroom apartment in iconic tower. 118 sqm, full marina views, gym and concierge. Freehold for international buyers.",
        "price": "€750,000",
        "location": "Dubai Marina, Dubai, UAE",
    },
    {
        "listing_id": "listing-010",
        "title": "Tenerife Oceanfront Duplex",
        "description": "Oceanfront duplex with direct beach access. 3 bedrooms, 2 bathrooms, 185 sqm. Communal pools, tennis courts and SPA.",
        "price": "€680,000",
        "location": "El Médano, Tenerife, Spain",
    },
    {
        "listing_id": "listing-011",
        "title": "Montenegro Kotor Bay Villa",
        "description": "Newly built 4-bedroom villa with pool overlooking Kotor Bay. 280 sqm, boat mooring available, high-speed internet.",
        "price": "€890,000",
        "location": "Kotor, Montenegro",
    },
    {
        "listing_id": "listing-012",
        "title": "Madeira Ocean View Cottage",
        "description": "Quaint 2-bedroom cottage with wrap-around terrace and Atlantic Ocean views. 110 sqm, tropical garden, 5 min to village.",
        "price": "€285,000",
        "location": "Ponta do Sol, Madeira, Portugal",
    },
    {
        "listing_id": "839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c",
        "title": "9 Blackberry Pl, Palm Coast, FL 32137 — 3 bed, 2 bath",
        "description": "A three-bedroom, two-bathroom single-family home on a quiet residential street. Open-plan living area, attached two-car garage, screened lanai and a mature garden. Close to schools, the intracoastal waterway and local amenities.",
        "location": "Palm Coast, FL",
    },
]
LISTING_BY_ID = {item["listing_id"]: item for item in LISTINGS}

# (listing, archetype, locale, with_context) — 33 live pairs; 12 carry a synthetic non-empty
# context derived from the fixture's own fields (production sends `{}`), incl. non-ASCII values
# (Gòtic, Côte d'Azur, Médano, Jávea) and area keys (`living_area`, `plot_size`).
LIVE_PAIRS: list[tuple[str, str, str, bool]] = [
    ("listing-001", "luxury_buyer", "en", True),
    ("listing-001", "family_buyer", "en", False),
    ("listing-001", "yield_hunter", "en", False),
    ("listing-002", "first_time_buyer", "en", True),
    ("listing-002", "vacation_rental_investor", "en", False),
    ("listing-002", "remote_worker", "en", False),
    ("listing-003", "second_home_buyer", "en", True),
    ("listing-003", "lifestyle_expat", "en", False),
    ("listing-004", "luxury_buyer", "en", True),
    ("listing-004", "golden_visa_buyer", "en", False),
    ("listing-005", "yield_hunter", "en", True),
    ("listing-005", "student_parent", "es", False),
    ("listing-005", "family_buyer", "en", False),
    ("listing-006", "vacation_rental_investor", "en", True),
    ("listing-006", "luxury_buyer", "en", False),
    ("listing-007", "yield_hunter", "en", True),
    ("listing-007", "downsizer", "en", False),
    ("listing-008", "family_buyer", "en", True),
    ("listing-008", "upsizer", "es", False),
    ("listing-009", "yield_hunter", "en", True),
    ("listing-009", "portfolio_builder", "en", False),
    ("listing-009", "family_buyer", "en", False),
    ("listing-010", "retiree_relocator", "en", True),
    ("listing-010", "second_home_buyer", "en", False),
    ("listing-011", "remote_worker", "en", True),
    ("listing-011", "diaspora_buyer", "en", False),
    ("listing-012", "downsizer", "pl", True),
    ("listing-012", "retiree_relocator", "en", False),
    ("839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c", "family_buyer", "en", True),
    ("839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c", "first_time_buyer", "en", False),
    ("839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c", "flip_investor", "en", False),
    ("839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c", "neutral", "en", False),
    ("listing-004", "commercial_investor", "en", True),
]

AREA_HINTS: dict[str, dict[str, str]] = {
    "listing-001": {"living_area": "380 sqm", "plot_size": "1,200 m²"},
    "listing-003": {"living_area": "450", "plot_size": "2 hectares"},
    "listing-005": {"living_area": "45 sqm"},
    "listing-008": {"living_area": "430 m²"},
    "listing-010": {"floor_space": "185"},
}


def synthetic_context(listing: dict[str, str]) -> dict[str, str]:
    ctx: dict[str, str] = {"title": listing["title"], "location": listing["location"]}
    if "price" in listing:
        ctx["price"] = listing["price"]
    ctx.update(AREA_HINTS.get(listing["listing_id"], {}))
    return ctx


def load_copy_templates() -> dict[str, dict[str, str]]:
    """`copy_template` per archetype from the shared playbooks (the route sends these verbatim)."""
    script = (
        "import {getAllPlaybooks} from './packages/shared/src/playbooks/index.ts';"
        "const out={};for (const [k,v] of getAllPlaybooks()) out[k]=v.copy_template;"
        "console.log(JSON.stringify(out));"
    )
    res = subprocess.run(
        [str(REPO_ROOT / "node_modules/.bin/tsx"), "-e", script],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(res.stdout.strip().splitlines()[-1])


# ---------------------------------------------------------------------------------------------
# The stubbed / recording Anthropic client
# ---------------------------------------------------------------------------------------------


class _Block:
    def __init__(self, text: str) -> None:
        self.text = text
        self.type = "text"


class _Usage:
    def __init__(self, tokens_in: int, tokens_out: int) -> None:
        self.input_tokens = tokens_in
        self.output_tokens = tokens_out


class _Response:
    def __init__(self, text: str, stop_reason: str | None, tokens_in: int = 0, tokens_out: int = 0):
        self.content = [_Block(text)] if text is not None else []
        self.stop_reason = stop_reason
        self.usage = _Usage(tokens_in, tokens_out)


class _Messages:
    def __init__(self, scripted: list[tuple[str, str | None]], calls: list[dict[str, Any]]):
        # Shared, not copied: the job builds one client per call, and the queue must advance.
        self._scripted = scripted
        self._calls = calls

    def create(self, **kwargs: Any) -> _Response:
        self._calls.append(kwargs)
        text, stop = self._scripted.pop(0)
        return _Response(text, stop)


class StubClient:
    def __init__(self, scripted: list[tuple[str, str | None]], calls: list[dict[str, Any]]):
        self.messages = _Messages(scripted, calls)


def replay(case_input: dict[str, Any], raw_description: dict[str, Any], raw_headline: str | None):
    """Run the job's two functions with the client stubbed; return (calls, sonnet_result, headline)."""
    calls: list[dict[str, Any]] = []
    scripted: list[tuple[str, str | None]] = [(raw_description["text"], raw_description["stop_reason"])]
    if raw_headline is not None:
        scripted.append((raw_headline, "end_turn"))
    model = gd._resolve_generation_model(
        case_input.get("override_model"), case_input.get("generation_model")
    )
    with patch("anthropic.Anthropic", lambda **_kw: StubClient(scripted, calls)):
        sonnet = gd._generate_with_sonnet(
            archetype=case_input["archetype"],
            copy_template=case_input.get("copy_template", ""),
            listing_context=case_input.get("listing_context", {}),
            locale=case_input.get("locale", "en"),
            original_description=case_input["original_description"],
            model=model,
            tenant_id=case_input["tenant_id"],
            listing_id=case_input["listing_id"],
        )
        headline = None
        headline_called = sonnet[2] == "FIT"
        if headline_called:
            if raw_headline is None:
                raise RuntimeError(f"FIT case without a raw_headline: {case_input['listing_id']}")
            headline = gd._generate_headline(
                archetype=case_input["archetype"],
                original_description=case_input["original_description"],
                listing_context=case_input.get("listing_context", {}),
                model=model,
                tenant_id=case_input["tenant_id"],
                listing_id=case_input["listing_id"],
            )
    return model, calls, sonnet, headline, headline_called


def derive_outcome(raw_text: str, stop_reason: str | None, original: str, ctx: dict[str, Any]):
    """The job's decision chain, step by step, with the reason codes the job only logs."""
    if not raw_text.strip():
        return {"verdict": "FAILED", "reason": "empty"}
    verdict, neutral_reason, body = gd._parse_adaptation_verdict(raw_text)
    if verdict == "NEUTRAL":
        return {"verdict": "NEUTRAL", "neutralReason": neutral_reason}
    description, facts = gd._parse_verified_facts(body)
    contract = gd._body_violates_contract(description)
    if contract:
        return {"verdict": "FAILED", "reason": contract}
    if stop_reason == "max_tokens" or "<verified_facts_used" in description:
        return {"verdict": "FAILED", "reason": "truncated"}
    claim = gd._check_body_claims(description, original or "", ctx)
    if claim:
        return {"verdict": "REFUSED", "violation": claim}
    return {"verdict": "FIT", "description": description, "verifiedFacts": facts}


def derive_headline(raw: str, original: str, ctx: dict[str, Any]) -> tuple[str | None, str | None]:
    if not raw.strip():
        return None, "empty"
    headline = raw.strip().split("\n")[0].strip("\"'").strip()[:120]
    if not headline:
        return None, "empty"
    violation = gd._check_headline_facts(headline, original or "", ctx)
    if violation:
        return None, violation
    return headline, None


def freeze_case(case: dict[str, Any]) -> dict[str, Any]:
    # Hash exactly what the corpus file will hold: a JSON round trip, so that no in-memory
    # artefact (an int that would serialise differently, a non-string) survives into the
    # expectation. Key ORDER is preserved (never `sort_keys`): the order of `listing_context` is
    # part of the rendered prompt.
    case = json.loads(json.dumps(case, ensure_ascii=False))
    inp = case["input"]
    raw_d = case["raw_description"]
    raw_h = case.get("raw_headline")
    model, calls, sonnet, headline, headline_called = replay(inp, raw_d, raw_h)

    outcome = derive_outcome(raw_d["text"], raw_d["stop_reason"], inp["original_description"], inp["listing_context"])
    # Cross-check the derivation against the job's own return value.
    desc, facts, verdict = sonnet
    if outcome["verdict"] != verdict:
        raise AssertionError(f"{case['id']}: derived {outcome['verdict']} but job returned {verdict}")
    if verdict == "FIT" and (desc, facts) != (outcome["description"], outcome["verifiedFacts"]):
        raise AssertionError(f"{case['id']}: FIT text/facts diverge from the job")

    exp_headline: str | None = None
    exp_violation: str | None = None
    if headline_called:
        exp_headline, exp_violation = derive_headline(raw_h, inp["original_description"], inp["listing_context"])
        if exp_headline != headline:
            raise AssertionError(f"{case['id']}: derived headline {exp_headline!r} but job returned {headline!r}")

    desc_call = calls[0]
    prompt_sha: dict[str, str | None] = {
        "description_system": sha(desc_call["system"]),
        "description_user": sha(desc_call["messages"][0]["content"]),
        "headline_system": None,
        "headline_user": None,
    }
    if headline_called:
        head_call = calls[1]
        prompt_sha["headline_system"] = sha(head_call["system"])
        prompt_sha["headline_user"] = sha(head_call["messages"][0]["content"])
        if head_call["max_tokens"] != gd._HEADLINE_MAX_TOKENS:
            raise AssertionError("headline max_tokens drifted")

    return {
        "id": case["id"],
        "kind": case["kind"],
        "input": inp,
        "raw_description": raw_d,
        "raw_headline": raw_h,
        "expected": {
            "model": model,
            "max_tokens": desc_call["max_tokens"],
            "prompt_sha256": prompt_sha,
            "outcome": outcome,
            "headline_called": headline_called,
            "headline": exp_headline,
            "headline_violation": exp_violation,
            "claims_validation": gd.CLAIMS_VALIDATION_VERSION if verdict == "FIT" else None,
        },
    }


# ---------------------------------------------------------------------------------------------
# Hand corpus — FOLLOW-1305 (`test_generate_description_follow1305.py`) + synthetic cases
# ---------------------------------------------------------------------------------------------


def fit(body: str, facts: list[Any] | str | None = None) -> str:
    facts_json = (
        facts
        if isinstance(facts, str)
        else json.dumps(facts if facts is not None else ["bedrooms: 2"])
    )
    return (
        "<adaptation_verdict>FIT</adaptation_verdict>\n"
        + body
        + "\n<verified_facts_used>\n"
        + facts_json
        + "\n</verified_facts_used>"
    )


_1305_ORIGINAL = "An apartment with two bedrooms and no pool."
_1305_CTX = {"price": "400000", "location": "Lisbon"}
_1305_TEMPLATE = "Analytical, numbers-first voice for a rental buyer."
_1305_HEADLINE = "Apartment in Lisbon with two bedrooms"

_1305_NEGATIVE = {
    "unsupported_yield": "A two-bedroom apartment in Lisbon offering a 9.9% yield.",
    "invented_pool": "A two-bedroom apartment in Lisbon with a private pool.",
    "invented_sea_view": "A two-bedroom apartment in Lisbon with sea views from every room.",
    "guarantee_no_work": "A two-bedroom apartment in Lisbon. Nothing here needs work before it earns.",
    "guarantee_income": "A two-bedroom apartment in Lisbon with guaranteed rental income.",
    "price_as_area": "A two-bedroom apartment in Lisbon with 400000 square metres of space.",
}
_1305_POSITIVE = "A two-bedroom apartment in Lisbon, a straightforward option for a rental buyer."


def hand_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []

    def add(
        cid: str,
        kind: str,
        raw_text: str,
        *,
        stop: str | None = "end_turn",
        raw_headline: str | None = _1305_HEADLINE,
        original: str = _1305_ORIGINAL,
        ctx: dict[str, str] | None = None,
        archetype: str = "yield_hunter",
        locale: str = "en",
        copy_template: str = _1305_TEMPLATE,
        override_model: str | None = None,
        generation_model: str | None = None,
        listing_id: str = "listing-1305",
    ) -> None:
        cases.append(
            {
                # Dot-separated words: the repo's gitleaks heuristic flags any 40-char run of
                # `[A-Za-z0-9_-]`, which a long kebab-case id would be.
                "id": cid,
                "kind": kind,
                "input": make_event(
                    listing_id=listing_id,
                    archetype=archetype,
                    original=original,
                    copy_template=copy_template,
                    locale=locale,
                    ctx=_1305_CTX if ctx is None else ctx,
                    override_model=override_model,
                    generation_model=generation_model,
                ),
                "raw_description": {"text": raw_text, "stop_reason": stop},
                "raw_headline": raw_headline,
            }
        )

    # FOLLOW-1305 hand corpus: six negatives (REFUSED, one per class), the positive control, the
    # self-report case (facts the model claims must not reach the headline whitelist) and the
    # headline that asserts an invented amenity.
    for name, body in _1305_NEGATIVE.items():
        add(f"hand1305.{name}", "hand1305", fit(body))
    add("hand1305.positive.control", "hand1305", fit(_1305_POSITIVE))
    add("hand1305.self.report.not.whitelist", "hand1305", fit(_1305_POSITIVE, ["pool: yes", "sea view: yes"]))
    add("hand1305.headline.invented.amenity", "hand1305", fit(_1305_POSITIVE), raw_headline="Apartment in Lisbon with private pool")

    # NEUTRAL: with a reason, without, lowercase tag, reason spanning whitespace.
    add("neutral.with.reason", "synthetic", "<adaptation_verdict>NEUTRAL</adaptation_verdict>\n<neutral_reason>core_need_contradiction</neutral_reason>", raw_headline=None, archetype="family_buyer")
    add("neutral.without.reason", "synthetic", "<adaptation_verdict>NEUTRAL</adaptation_verdict>", raw_headline=None, archetype="family_buyer")
    add("neutral.lowercase.tag", "synthetic", "<adaptation_verdict> neutral </adaptation_verdict>\n<NEUTRAL_REASON>\n no_legitimate_angle \n</NEUTRAL_REASON>", raw_headline=None, archetype="family_buyer")

    # FAILED: empty, whitespace-only (Python whitespace), each contract violation, truncation.
    add("failed.empty", "synthetic", "", raw_headline=None)
    add("failed.whitespace.python.set", "synthetic", " \n\t\x1c　", raw_headline=None)
    add("failed.residual.tag.dangling.audit.open", "synthetic", "<adaptation_verdict>FIT</adaptation_verdict>\nA two-bedroom apartment in Lisbon.\n<verified_facts_used>\n[\"bedrooms: 2\"", raw_headline=None)
    add("failed.residual.tag.neutral.reason.in.body", "synthetic", fit("A two-bedroom apartment in Lisbon. <Neutral_Reason>x"), raw_headline=None)
    add("failed.formatted.bold", "synthetic", fit("A **two-bedroom** apartment in Lisbon."), raw_headline=None)
    add("failed.formatted.heading.after.python.ws", "synthetic", fit("A two-bedroom apartment in Lisbon.\n # Highlights\nQuiet street."), raw_headline=None)
    add("failed.leak.marker.my.approach", "synthetic", fit("My approach: a two-bedroom apartment in Lisbon."), raw_headline=None)
    add("failed.leak.marker.archetype", "synthetic", fit("A two-bedroom apartment in Lisbon for this archetype."), raw_headline=None)
    add("failed.truncated.stop.reason", "synthetic", fit("A two-bedroom apartment in Lisbon."), stop="max_tokens", raw_headline=None)

    # FIT with a missing verdict tag (ADR-0010 backward-safe default).
    add("fit.missing.verdict.tag", "synthetic", "A two-bedroom apartment in Lisbon, a straightforward option for a rental buyer.\n<verified_facts_used>\n[\"bedrooms: 2\"]\n</verified_facts_used>")
    # FIT with no audit block, malformed facts JSON, non-list facts, nested non-string facts.
    add("fit.no.audit.block", "synthetic", "<adaptation_verdict>FIT</adaptation_verdict>\nA two-bedroom apartment in Lisbon.")
    add("fit.facts.malformed.json", "synthetic", fit("A two-bedroom apartment in Lisbon.", "[\"bedrooms: 2\",]"))
    add("fit.facts.not.a.list", "synthetic", fit("A two-bedroom apartment in Lisbon.", "{\"bedrooms\": \"2\"}"))
    add("fit.facts.mixed.types", "synthetic", fit("A two-bedroom apartment in Lisbon.", "[\"bedrooms: 2\", 2, null]"))
    # Two audit blocks: only the first is stripped; the second survives as a residual tag.
    add("failed.two.audit.blocks", "synthetic", fit("A two-bedroom apartment in Lisbon.") + "\n<verified_facts_used>[]</verified_facts_used>", raw_headline=None)

    # Digit rule typography: grounded price with a thousands separator; a range endpoint; a
    # grounded number inside a larger one; a decimal.
    ctx_num = {"price": "97200 EUR", "yield": "6.5%", "bedrooms": "3", "size": "120-150"}
    orig_num = "A three-bedroom flat for 97200 EUR with a 6.5% yield; 120-150 sqm."
    add("fit.number.thousands.separator", "synthetic", fit("A three-bedroom flat at €97,200 with a 6.5% yield."), original=orig_num, ctx=ctx_num, raw_headline="Three-bedroom flat at €97,200")
    add("refused.number.range.endpoint", "synthetic", fit("A flat of 150 sqm."), original=orig_num, ctx=ctx_num)
    add("refused.number.inside.larger", "synthetic", fit("A flat with 5 bedrooms."), original="A flat for 425000 EUR.", ctx={})
    add("fit.number.uppercase.unit", "synthetic", fit("A flat of 120M² in total."), original="A flat of 120m² in total.", ctx={}, raw_headline="Flat of 120M²")

    # ensure_ascii hazards (ADR-0023 §4 item 1): an `é` in a context value grounds a `9`; a
    # non-ASCII proper name present only in the context is not found by the headline check.
    add("fit.ensure.ascii.e.acute.grounds.9", "synthetic", fit("A flat with 9 rooms in the quarter."), original="A flat in the quarter.", ctx={"neighbourhood": "Café Quarter"}, raw_headline="Flat in the quarter")
    add("fit.headline.non.ascii.name.only.in.context", "synthetic", fit("A flat in the old town."), original="A flat in the old town.", ctx={"district": "Évora"}, raw_headline="Évora flat in the old town")
    add("fit.headline.non.ascii.name.in.original", "synthetic", fit("A flat in Évora's old town."), original="A flat in Évora's old town.", ctx={"district": "Évora"}, raw_headline="Évora flat in the old town")
    add("fit.headline.inflection.stem", "synthetic", fit("Maximizing the rental return."), original="Maximizing the rental return is simple here.", ctx={}, raw_headline="Maximize the rental return")
    add("fit.headline.stem.is.not.prefix", "synthetic", fit("Maximizing the rental return."), original="Maximizing the rental return is simple here.", ctx={}, raw_headline="Maximus rental return")

    # Headline suppression, one per class, plus cut/strip/first-line behaviour.
    add("fit.headline.invented.number", "synthetic", fit(_1305_POSITIVE), raw_headline="Two bedrooms, 5 min from the metro")
    add("fit.headline.invented.proper.name", "synthetic", fit(_1305_POSITIVE), raw_headline="Reston Heights two-bedroom apartment")
    add("fit.headline.invented.guarantee", "synthetic", fit(_1305_POSITIVE), raw_headline="Guaranteed rental income in Lisbon")
    add("fit.headline.unit.mismatch", "synthetic", fit(_1305_POSITIVE), raw_headline="Lisbon apartment of 400000 m²")
    add("fit.headline.empty", "synthetic", fit(_1305_POSITIVE), raw_headline="  \n ")
    add("fit.headline.quotes.and.first.line", "synthetic", fit(_1305_POSITIVE), raw_headline="\"'Apartment in Lisbon with two bedrooms'\"\nSecond line is dropped")
    add("fit.headline.cut.120.code.points", "synthetic", fit(_1305_POSITIVE), raw_headline=("Apartment in Lisbon " * 6) + "with two bedrooms and a quiet street and a long tail that runs past the cut")
    add("fit.headline.stop.caps.and.punctuation", "synthetic", fit(_1305_POSITIVE), raw_headline="Stunning, Spacious Apartment: Lisbon!")
    add("fit.headline.digit.in.grounded.word.boundary", "synthetic", fit(_1305_POSITIVE), raw_headline="Lisbon apartment, price 400000")
    add("fit.headline.negated.amenity.in.listing", "synthetic", fit(_1305_POSITIVE), raw_headline="Apartment with pool in Lisbon")

    # Claim containment edge cases on the body.
    add("fit.negated.amenity.in.body", "synthetic", fit("A two-bedroom apartment in Lisbon, without a pool."))
    add("fit.area.grounded.by.area.field", "synthetic", fit("Offers 128 m² of living space."), original="A flat.", ctx={"living_area": "128"})
    add("refused.area.not.an.area.field", "synthetic", fit("Offers 128 m² of living space."), original="A flat.", ctx={"price": "128"})
    add("fit.condition.fact.grounds.no.work", "synthetic", fit("Move-in ready and fully renovated."), original="Fully renovated in 2024, move-in ready.", ctx={})
    add("refused.amenity.key.denied.by.value", "synthetic", fit("A flat with a garden."), original="A flat.", ctx={"garden": "false"})
    add("fit.amenity.key.positive.value", "synthetic", fit("A flat with a garden."), original="A flat.", ctx={"garden": "yes, 40 m²"})
    add("refused.non.ascii.body.with.invented.number", "synthetic", fit("Un piso de dos habitaciones en Lisboa con 3 baños."), original="Un piso de dos habitaciones en Lisboa.", ctx={"ciudad": "Lisboa"}, locale="es", archetype="family_buyer")
    add("fit.non.ascii.body.pl", "synthetic", fit("Mieszkanie z dwiema sypialniami w Lizbonie, bez basenu."), original="Mieszkanie z dwiema sypialniami w Lizbonie.", ctx={"miasto": "Lizbona", "cena": "400000"}, locale="pl", archetype="downsizer", raw_headline="Mieszkanie w Lizbonie z dwiema sypialniami")

    # Model resolution and prompt shape.
    add("fit.override.model.opus", "synthetic", fit(_1305_POSITIVE), override_model="claude-opus-4-8", generation_model="claude-haiku-4-5-20251001")
    add("fit.generation.model.haiku", "synthetic", fit(_1305_POSITIVE), generation_model="claude-haiku-4-5-20251001")
    add("fit.invalid.override.falls.to.default", "synthetic", fit(_1305_POSITIVE), override_model="gpt-5", generation_model="not-allowed")
    add("fit.structured.copy.template", "synthetic", fit(_1305_POSITIVE), copy_template="VOICE PATTERN:\nNumbers first.\n\nHARD RULES:\nNever promise a yield.")
    add("fit.copy.template.markers.empty.voice", "synthetic", fit(_1305_POSITIVE), copy_template="VOICE PATTERN:\n\nHARD RULES:\nNever promise a yield.")
    add("fit.copy.template.only.one.marker", "synthetic", fit(_1305_POSITIVE), copy_template="VOICE PATTERN: numbers first, no HARD RULES here")
    add("fit.empty.context.and.long.original", "synthetic", fit("A two-bedroom apartment in Lisbon."), original=("A two-bedroom apartment in Lisbon, close to the river and the metro. " * 60).strip(), ctx={})
    add("fit.mid.length.original.scales.max.tokens", "synthetic", fit("A two-bedroom apartment in Lisbon."), original=("A two-bedroom apartment in Lisbon, close to the river. " * 20).strip(), ctx={})
    add("fit.context.non.ascii.key.and.value", "synthetic", fit("A flat in the old town."), original="A flat in the old town.", ctx={"barrio_histórico": "Barri Gòtic", "superficie": "45 m²", "precio": "€245,000"}, raw_headline="Flat in the old town")
    add("fit.original.with.quotes.and.backslash", "synthetic", fit("A \"quiet\" flat on Rua da Prata."), original="A \"quiet\" flat on Rua da Prata \\ 2nd floor.", ctx={"street": "Rua da \"Prata\" \\ 2"}, raw_headline="Quiet flat on Rua da Prata")
    add("fit.astral.emoji.in.context", "synthetic", fit("A flat with a view."), original="A flat with a view.", ctx={"note": "sea 🌊 view"}, raw_headline="Flat with a view")
    return cases


# ---------------------------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------------------------


def record() -> None:
    import anthropic

    if os.environ.get("ANTHROPIC_API_KEY", "offline") == "offline":
        raise SystemExit("record needs ANTHROPIC_API_KEY (run under doppler)")
    templates = load_copy_templates()
    real = anthropic.Anthropic()
    out: list[dict[str, Any]] = []
    spend = 0.0

    class RecordingMessages:
        def __init__(self) -> None:
            self.last: dict[str, Any] | None = None

        def create(self, **kwargs: Any) -> Any:
            t0 = time.time()
            resp = real.messages.create(**kwargs)
            self.last = {
                "text": resp.content[0].text if resp.content else "",
                "stop_reason": resp.stop_reason,
                "tokens_in": resp.usage.input_tokens,
                "tokens_out": resp.usage.output_tokens,
                "latency_ms": int((time.time() - t0) * 1000),
                "model": kwargs["model"],
            }
            return resp

    class RecordingClient:
        messages = RecordingMessages()

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    for idx, (listing_id, archetype, locale, with_ctx) in enumerate(LIVE_PAIRS, start=1):
        listing = LISTING_BY_ID[listing_id]
        ctx = synthetic_context(listing) if with_ctx else {}
        template = templates[archetype][locale if locale in ("en", "pl", "es") else "en"]
        inp = make_event(
            listing_id=listing_id,
            archetype=archetype,
            original=listing["description"],
            copy_template=template,
            locale=locale,
            ctx=ctx,
        )
        with patch("anthropic.Anthropic", lambda **_kw: RecordingClient()):
            desc, facts, verdict = gd._generate_with_sonnet(
                archetype=archetype,
                copy_template=template,
                listing_context=ctx,
                locale=locale,
                original_description=listing["description"],
                model="claude-sonnet-4-6",
                tenant_id=TENANT,
                listing_id=listing_id,
            )
            raw_d = dict(RecordingClient.messages.last or {})
            spend += gd._llm_cost_usd(raw_d["model"], raw_d["tokens_in"], raw_d["tokens_out"])
            raw_h: dict[str, Any] | None = None
            if verdict == "FIT":
                gd._generate_headline(
                    archetype=archetype,
                    original_description=listing["description"],
                    listing_context=ctx,
                    model="claude-sonnet-4-6",
                    tenant_id=TENANT,
                    listing_id=listing_id,
                )
                raw_h = dict(RecordingClient.messages.last or {})
                spend += gd._llm_cost_usd(raw_h["model"], raw_h["tokens_in"], raw_h["tokens_out"])
        print(f"[{idx:02d}/{len(LIVE_PAIRS)}] {listing_id} {archetype} {locale} ctx={bool(ctx)} -> {verdict}", flush=True)
        out.append(
            {
                "id": f"live.{idx:03d}.{listing_id}.{archetype}.{locale}",
                "kind": "live",
                "input": inp,
                "raw_description": {"text": raw_d["text"], "stop_reason": raw_d["stop_reason"]},
                "raw_headline": raw_h["text"] if raw_h else None,
                "recorded_usage": {
                    "description": {k: raw_d[k] for k in ("tokens_in", "tokens_out", "latency_ms")},
                    "headline": {k: raw_h[k] for k in ("tokens_in", "tokens_out", "latency_ms")} if raw_h else None,
                },
                "job_verdict": verdict,
            }
        )
    with RECORDINGS.open("w", encoding="utf-8") as fh:
        for item in out:
            fh.write(json.dumps(item, ensure_ascii=False) + "\n")
    print(f"recorded {len(out)} live cases -> {RECORDINGS.relative_to(REPO_ROOT)}")
    print(f"anthropic spend (job's _llm_cost_usd, list rates): ${spend:.4f}")


def freeze() -> None:
    if CORPUS.exists():
        raise SystemExit(f"{CORPUS.relative_to(REPO_ROOT)} exists — the corpus is never regenerated (ADR-0023 §4); write a v2 instead")
    live: list[dict[str, Any]] = []
    with RECORDINGS.open(encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                live.append(json.loads(line))
    cases = live + hand_cases()
    ids = [c["id"] for c in cases]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate case ids")
    frozen = [freeze_case(c) for c in cases]

    with CORPUS.open("w", encoding="utf-8") as fh:
        for c in frozen:
            fh.write(json.dumps(c, ensure_ascii=False) + "\n")

    counts: dict[str, int] = {}
    kinds: dict[str, int] = {}
    reasons: dict[str, int] = {}
    headline_suppressed = 0
    non_empty_ctx = 0
    for c in frozen:
        o = c["expected"]["outcome"]
        counts[o["verdict"]] = counts.get(o["verdict"], 0) + 1
        kinds[c["kind"]] = kinds.get(c["kind"], 0) + 1
        code = o.get("reason") or o.get("violation") or (o.get("neutralReason") and "with_reason") or None
        if code:
            key = f"{o['verdict']}/{code}"
            reasons[key] = reasons.get(key, 0) + 1
        if c["expected"]["headline_called"] and c["expected"]["headline"] is None:
            headline_suppressed += 1
        if c["input"]["listing_context"]:
            non_empty_ctx += 1
    git_sha = subprocess.run(
        ["git", "log", "-1", "--format=%h", "--abbrev=12", "--", str(JOB_FILE)],
        cwd=REPO_ROOT, capture_output=True, text=True, check=True,
    ).stdout.strip()
    manifest = {
        "corpus": CORPUS.name,
        "frozen_from": "apps/llm-gateway/src/jobs/generate_description.py",
        "job_git_sha_abbrev12": git_sha,
        "generate_description_py_sha256": sha(JOB_FILE.read_text(encoding="utf-8")),
        "generator": "scripts/parity/freeze-description-corpus.py",
        "generator_sha256": sha(Path(__file__).read_text(encoding="utf-8")),
        "claims_validation_version": gd.CLAIMS_VALIDATION_VERSION,
        "digest_format": "sha256 hex in colon-separated 8-char groups",
        "case_count": len(frozen),
        "per_verdict": dict(sorted(counts.items())),
        "per_reason": dict(sorted(reasons.items())),
        "per_kind": dict(sorted(kinds.items())),
        "headline_suppressed": headline_suppressed,
        "non_empty_listing_context": non_empty_ctx,
        "frozen_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "never_regenerate": True,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "record":
        record()
    elif mode == "freeze":
        freeze()
    else:
        raise SystemExit(__doc__)
