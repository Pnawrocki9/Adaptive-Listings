#!/usr/bin/env python3
"""Modal container EFFECT probe: prove a deployed Modal app reaches line 1 of its own
logic, from a process that is not the deploy job [FOLLOW-904].

WHY THIS EXISTS (RETRO-262, in one sentence)
--------------------------------------------
After FOLLOW-900 the estate had FOUR controls over the Modal apps — the secret gate, the
``modal app list`` probe, the deploy job, and ``scripts/check-modal-local-imports.py`` —
and every one of them reads the artefact's DESCRIPTION: metadata, inputs, declared state.
There is one test they all fail: **could this control pass while every container dies at
line 1?** For all four, yes; that is exactly how ``estalara-schema-validation`` shipped a
cron that wrote zero rows for its entire life behind four green badges.
``cron-heartbeat.yml`` added the missing EFFECT axis for ONE of the three deployed apps.
This script adds it for the other two.

THE EFFECT, PER APP — cheapest thing that CANNOT be produced without executing the app's
own code (FOLLOW-904 AC1)
-------------------------------------------------------------------------------------
``intent-engine`` — ``process_chat_message.remote(...)`` with a THROWAWAY tenant/session
  and ``profiling_opt_out=True``, asserting the returned payload echoes the ids we sent.
  Why this one: main.py imports NOTHING local at module level; its four declared local
  modules (``nlp``, ``redis_writer``, ``schemas``, ``observability``) are imported INSIDE
  ``process_chat_message``. So a container that starts, an endpoint that answers, and a
  green deploy all remain silent on the exact defect FOLLOW-900 was filed for. Only
  running that function's body touches those imports. The echoed ``tenant_id`` /
  ``session_id`` are set at main.py:100-101, i.e. AFTER ``from nlp import extract_intent``
  and ``from redis_writer import write_shadow_intent`` have both resolved and after the
  extraction returned — they cannot appear in the response unless the container executed
  its own logic to completion.
  NON-POLLUTING BY CONSTRUCTION: ``profiling_opt_out=True`` makes
  ``write_shadow_intent`` return before touching Redis (redis_writer.py:121-122, §H.9), so
  the probe writes NOTHING — no shadow key, no analytics, no ``adaptation_decisions``. The
  tenant id is a reserved throwaway that exists in no database. Cost: one Haiku call.

``llm-gateway`` — an unauthenticated POST to ``description_requested_endpoint``, asserting
  HTTP 401. Why this one and not a real description: ``generate_description`` spends Sonnet
  tokens and writes its result outward, which would pollute production for a monitoring
  probe. The 401 is produced by ``_valid_bearer`` (generate_description.py:2190,2247) —
  application code inside the container — and a Modal web endpoint only answers once its
  defining module has been IMPORTED TO COMPLETION. That import is this app's whole risk
  surface: ``jobs/`` must be mounted and the two contract JSONs (``jobs/_app.py:55,60``)
  must exist at import time, or the module raises FileNotFoundError and every function
  fails to load. A 5xx, a hang, or a 2xx are all alarms — the last one doubly so, because
  it would mean the internal endpoint stopped enforcing its bearer.

WHAT IS *NOT* ASSERTED
----------------------
  * llm-gateway's Anthropic path, its Redpanda emission and its result callback. The probe
    proves the module imports and the request reaches app code; it does not prove a
    description is generated. Closing that needs a synthetic description with a throwaway
    tenant and is deliberately NOT done here (LLM spend + write pollution). Live production
    description traffic is the de-facto evidence for that leg today.
  * A degraded intent extraction. If ``data_source`` comes back as anything other than
    ``model`` the probe prints a WARNING and still passes: a degraded payload still proves
    every local module imported, which is what this control is for. Making it red would
    put transient Anthropic weather on the import-axis alarm and get the alarm muted.
  * Anything about ``data-quality``: that app is a cron with no callable surface, and its
    effect axis is already covered by ``scripts/check-cron-heartbeat.sh`` (FOLLOW-893).

EXIT CODES (the exit-2 rule is load-bearing — RETRO-262: "unconfigured must never look
like healthy")
  0  the effect was observed
  1  ALARM: the effect is absent or wrong — the container did not reach its own logic
  2  unconfigured (no Modal credentials) or usage error. NEVER 0.

USAGE
  python3 scripts/check-modal-container-effect.py --app intent-engine
  python3 scripts/check-modal-container-effect.py --app llm-gateway
  python3 scripts/check-modal-container-effect.py --app all
  # negative control / manual: point the HTTP probe at an arbitrary origin
  python3 scripts/check-modal-container-effect.py --app llm-gateway --endpoint-url http://…

SECRET HYGIENE: no secret value is ever printed. The probe sends a deliberately INVALID
bearer token (the literal string below), so it never handles ``INTERNAL_API_SECRET`` at
all — same house rule as scripts/check-modal-secret-keys.py.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

INTENT_APP = "estalara-intent-engine"
INTENT_FN = "process_chat_message"
GATEWAY_APP = "estalara-description-generator"
GATEWAY_FN = "description_requested_endpoint"

# A tenant id that exists in no database, in no analytics table and in no Redis namespace.
# Suffix f904 = FOLLOW-904, so a stray row anywhere is traceable to this probe.
PROBE_TENANT_ID = "00000000-0000-4000-8000-0000f9040904"
PROBE_MESSAGE = "Looking for a quiet two-bedroom near the sea, budget around 400k."

# Deliberately invalid. The llm-gateway probe asserts a 401, so it must never carry a
# real credential — there is nothing here to leak.
INVALID_BEARER = "follow904-probe-invalid-bearer"

REQUIRED_PAYLOAD_KEYS = (
    "tenant_id",
    "session_id",
    "intent_dimensions",
    "model_used",
    "source",
    "detected_at",
    "data_source",
)


def _log(message: str) -> None:
    print(message, flush=True)


def _credentials_present() -> bool:
    """True when this process can talk to Modal at all.

    Env pair (CI) or ~/.modal.toml (developer machine). Absence is exit 2, never 0.
    """
    if os.environ.get("MODAL_TOKEN_ID") and os.environ.get("MODAL_TOKEN_SECRET"):
        return True
    return (Path.home() / ".modal.toml").is_file()


def _session_id() -> str:
    return f"follow904-probe-{int(time.time())}"


# ── intent-engine ───────────────────────────────────────────────────────────────────────


def probe_intent_engine() -> list[str]:
    """Invoke process_chat_message in the DEPLOYED container. Returns alarm strings."""
    import modal  # imported lazily so --endpoint-url probes need no modal install

    session_id = _session_id()
    _log(f"intent-engine: {INTENT_APP}::{INTENT_FN}.remote()")
    _log(f"  tenant_id (throwaway): {PROBE_TENANT_ID}")
    _log(f"  session_id           : {session_id}")
    _log("  profiling_opt_out    : True  → §H.9 short-circuit, NOTHING is written")

    try:
        fn = modal.Function.from_name(INTENT_APP, INTENT_FN)
    except Exception as exc:  # noqa: BLE001 - any lookup failure is an alarm
        return [
            f"could not resolve {INTENT_APP}::{INTENT_FN} — {type(exc).__name__}: "
            f"{str(exc)[:400]}"
        ]

    try:
        result = fn.remote(
            tenant_id=PROBE_TENANT_ID,
            session_id=session_id,
            message={"role": "user", "content": PROBE_MESSAGE},
            profiling_opt_out=True,
        )
    except Exception as exc:  # noqa: BLE001 - a dead container raises here, and that is THE case
        return [
            f"{INTENT_FN} did not complete in the deployed container — "
            f"{type(exc).__name__}: {str(exc)[:1200]}",
            "This is the FOLLOW-900 shape: a ModuleNotFoundError here means the image "
            "does not ship a local module the function body imports. Check "
            "add_local_python_source in apps/intent-engine/src/main.py and the "
            "scripts/check-modal-local-imports.py gate.",
        ]

    if not isinstance(result, dict):
        return [f"{INTENT_FN} returned {type(result).__name__}, expected a dict payload"]

    alarms: list[str] = []
    missing = [k for k in REQUIRED_PAYLOAD_KEYS if k not in result]
    if missing:
        alarms.append(f"returned payload is missing required keys: {missing}")
    if result.get("tenant_id") != PROBE_TENANT_ID:
        alarms.append(
            f"payload tenant_id is {result.get('tenant_id')!r}, expected the probe's "
            f"{PROBE_TENANT_ID!r} — main.py:100 did not run"
        )
    if result.get("session_id") != session_id:
        alarms.append(
            f"payload session_id is {result.get('session_id')!r}, expected {session_id!r} "
            "— main.py:101 did not run"
        )
    if result.get("source") != "realtime":
        alarms.append(f"payload source is {result.get('source')!r}, expected 'realtime'")
    if not isinstance(result.get("intent_dimensions"), dict):
        alarms.append("payload intent_dimensions is not an object — schemas.py did not build it")

    if not alarms:
        _log(f"  effect observed: payload echoed our ids, model_used={result.get('model_used')!r}")
        if result.get("data_source") != "model":
            _log(
                f"  ::warning::data_source={result.get('data_source')!r} (degraded "
                "extraction). The container still imported nlp/redis_writer/schemas/"
                "observability, so the import axis is proven; the extraction quality is "
                "not this control's subject."
            )
    return alarms


# ── llm-gateway ─────────────────────────────────────────────────────────────────────────


def _gateway_url() -> str:
    import modal  # lazy: only needed when no --endpoint-url was supplied

    return modal.Function.from_name(GATEWAY_APP, GATEWAY_FN).get_web_url()


def probe_llm_gateway(endpoint_url: str | None, timeout: float) -> list[str]:
    """POST an invalid bearer to the deployed endpoint and assert 401. Alarm strings out."""
    if endpoint_url is None:
        try:
            endpoint_url = _gateway_url()
        except Exception as exc:  # noqa: BLE001
            return [
                f"could not resolve the web URL of {GATEWAY_APP}::{GATEWAY_FN} — "
                f"{type(exc).__name__}: {str(exc)[:400]}"
            ]

    _log(f"llm-gateway: POST {endpoint_url} with a deliberately invalid bearer")
    request = urllib.request.Request(
        endpoint_url,
        data=json.dumps({"probe": "follow-904"}).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {INVALID_BEARER}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = response.status
    except urllib.error.HTTPError as exc:
        status = exc.code
    except Exception as exc:  # noqa: BLE001 - timeouts, DNS, refused connections
        return [
            f"the endpoint did not answer — {type(exc).__name__}: {str(exc)[:400]}. "
            "A Modal web endpoint that cannot answer is a container that cannot import "
            "its own module (jobs/ unmounted, or the contract fixtures missing at import "
            "time — jobs/_app.py:55,60)."
        ]

    _log(f"  HTTP {status}")
    if status == 401:
        _log("  effect observed: application code ran _valid_bearer and refused the token")
        return []
    if 200 <= status < 300:
        return [
            f"HTTP {status} for an INVALID bearer — the endpoint answered but did not "
            "enforce auth. That is both a broken probe and a security finding."
        ]
    return [
        f"HTTP {status}, expected 401. The container did not reach _valid_bearer; a 5xx "
        "from a Modal web endpoint is the module-import failure shape (FOLLOW-900)."
    ]


# ── main ────────────────────────────────────────────────────────────────────────────────

PROBES = ("intent-engine", "llm-gateway")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Assert a deployed Modal app reaches line 1 of its own logic."
    )
    parser.add_argument("--app", choices=(*PROBES, "all"), required=True)
    parser.add_argument(
        "--endpoint-url",
        default=None,
        help="override the llm-gateway endpoint URL (negative control / manual use)",
    )
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument(
        "--attempts",
        type=int,
        default=1,
        help=(
            "retry the whole probe this many times before alarming, 15s apart. Use >1 "
            "ONLY immediately after a deploy, where a cold image is expected; a retry on "
            "the scheduled run would turn a real outage into a slow green."
        ),
    )
    args = parser.parse_args(argv[1:])
    if args.attempts < 1:
        parser.error("--attempts must be >= 1")

    targets = list(PROBES) if args.app == "all" else [args.app]

    needs_modal = "intent-engine" in targets or (
        "llm-gateway" in targets and args.endpoint_url is None
    )
    if needs_modal and not _credentials_present():
        _log("UNCONFIGURED: no Modal credentials (MODAL_TOKEN_ID/SECRET or ~/.modal.toml).")
        _log("  Nothing was probed. This is NOT a pass.")
        return 2

    _log("=== Modal container effect probe (FOLLOW-904) ===")
    alarms: list[str] = []
    for attempt in range(1, args.attempts + 1):
        alarms = []
        if args.attempts > 1:
            _log(f"\n=== attempt {attempt}/{args.attempts} ===")
        for target in targets:
            _log(f"\n--- {target} ---")
            if target == "intent-engine":
                found = probe_intent_engine()
            else:
                found = probe_llm_gateway(args.endpoint_url, args.timeout)
            alarms.extend(f"{target}: {a}" for a in found)
        if not alarms or attempt == args.attempts:
            break
        _log(f"\n{len(alarms)} alarm(s) on attempt {attempt}; retrying in 15s.")
        time.sleep(15)

    summary_ok = not alarms
    if summary_ok:
        _log(f"\nPASS: {len(targets)} deployed Modal app(s) produced an effect only their "
             "own executing code could produce.")
    else:
        _log("\nALARM: a deployed Modal app did not reach its own logic.")
        for alarm in alarms:
            _log(f"  - {alarm}")
        _log(
            "\nA green `modal deploy` and a `deployed` status in `modal app list` are both "
            "compatible with this failure — that is why this probe exists (RETRO-262)."
        )

    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with open(step_summary, "a", encoding="utf-8") as handle:
            handle.write(
                f"### Modal container effect — {', '.join(targets)} — "
                f"{'OK' if summary_ok else 'ALARM'}\n\n"
            )
            for alarm in alarms:
                handle.write(f"- {alarm}\n")

    return 0 if summary_ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
