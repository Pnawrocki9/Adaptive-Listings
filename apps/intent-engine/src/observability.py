"""
Shared hardened Sentry initialiser for the Python Modal apps (FOLLOW-738).

SHARED HARDENED INITIALISER — this file is one of a set of byte-identical
copies (Rule J). The canonical path and every mirror path are listed in
`scripts/mirror-files.json`; that manifest, not this docstring, is the
registry. It is deliberately path-neutral so it stays TRUE in every copy:
the previous wording declared each copy "CANONICAL" and listed itself among
its own mirrors, a falsehood forced by the byte-identity gate (RETRO-235 CB-5,
fixed by FOLLOW-746 AC4).

The manifest is also what the two Sentry gates read:
`scripts/check-sentry-init-singleton.sh` treats ONLY registered paths as
legitimate `sentry_sdk.init(` sites, and `scripts/check-mirror-files.sh` fails
on any unregistered file sharing this basename (FOLLOW-746 AC1/AC2) — so a
4th, unregistered copy of this module is now a hard CI failure rather than a
silent pass.

Each Modal app is deployed as an independently-built container image
(separate `modal.Image` / `pip_install` per app — see each app's `_app.py` /
`main.py`), so a genuine cross-app `packages/py-shared` import is not
available to the deployed container without extra `add_local_*` image
plumbing in all three apps. Mirroring a small, dependency-free module is the
lower-risk option and reuses the mirror-sync gate this repo already runs in
CI (`rule-j` job) rather than inventing new infra. If you edit this file,
apply the SAME edit to EVERY copy listed in the manifest, in the SAME commit —
`check-mirror-files.sh` fails CI on drift.

WHY THIS EXISTS (ESC-045 item 4 / FOLLOW-738):
Before this file, four Sentry init call sites existed across three Modal
apps, all reading the SAME bare `SENTRY_DSN` name and all mounting the SAME
`modal.Secret.from_name("estalara-secrets")`. Only one of the four
(`apps/intent-engine/src/nlp.py`, PR #642) set
`include_local_variables=False` / `send_default_pii=False` /
`default_integrations=False`. Provisioning `SENTRY_DSN` — the single
operator action ESC-045 item 4 asks for — would have silently switched on
frame-locals capture (tenant ids, listing payloads, DB rows) and the default
`LoggingIntegration` (every `logging.error` becomes a Sentry event) on the
other three sites, in the same secret, on the same day the missing-alerting
gap was closed. This module makes every init site use identical hardened
config so there is exactly one place to audit.

DECISION (AC-5): the three Python Modal apps continue to share ONE bare
`SENTRY_DSN` rather than moving to per-app names
(`SENTRY_DSN_INTENT_ENGINE`, ...). Once every init site is uniformly
hardened (this file), the specific hazard ESC-045 item 4 flagged — an
unhardened producer riding in on the same secret — no longer exists, so the
per-app split would only add Sentry-project + Doppler/Modal-secret
provisioning burden with no corresponding safety gain. Triage across the
three apps is done via the `area` / `sink` tags each call site already sets
(`chat_intent`, `onboarding`, `schema_validation`), not via separate DSNs.
`.env.example`'s Sentry comment is corrected in the same PR to stop
asserting "separate projects" for the Python tier.
"""

from __future__ import annotations

import os
from typing import Any

# Set once by init_sentry on the first successful initialisation in this
# process. Shared across every call site in the process (unlike the old
# per-module flags this replaces) — a second call site's init_sentry() call
# is then a cheap no-op, matching the original per-site "lazy, DSN-gated"
# behaviour.
_sentry_initialised = False


def _scrub_chat_intent_exception_value(
    event: dict[str, Any], hint: dict[str, Any]
) -> dict[str, Any] | None:
    """before_send hook — drop the exception `value` string on the chat-intent path.

    C-07 / ROPA boundary (FOLLOW-738 AC3, coordinated with FOLLOW-739 for the
    doc side): the chat-intent extraction path
    (`apps/intent-engine/src/nlp.py`, tagged `area=chat_intent`) can raise
    `json.JSONDecodeError`/`ValueError` whose `str(exc)` embeds a fragment of
    the model's raw JSON response — which can itself echo buyer chat text.
    That string is exactly the "message content" `docs/compliance/dpia.md`
    and `ropa.md` assert never reaches Sentry. Every OTHER tagged path
    (`onboarding`, `schema_validation`, ...) is untouched — this hook only
    acts on events tagged `area=chat_intent`.

    Tags may arrive as either a dict (`{name: value}`) or a list of
    `[name, value]` pairs depending on SDK version/serialisation stage;
    handled defensively rather than assuming one shape.
    """
    tags = event.get("tags") or {}
    if isinstance(tags, (list, tuple)):
        tags = dict(tags)
    if tags.get("area") != "chat_intent":
        return event

    exc_info = event.get("exception")
    if not exc_info:
        return event
    for value in exc_info.get("values", []) or []:
        if isinstance(value, dict) and "value" in value:
            value["value"] = "[redacted by FOLLOW-738: may echo buyer chat text — see C-07]"
    return event


def init_sentry(dsn_env_name: str) -> bool:
    """Initialise sentry-sdk once per process with the hardened, C-07-safe config.

    Lazy and DSN-gated: with the named env var unset this is a deliberate
    no-op (the ONLY allowed skip condition — "dependency not configured",
    not "dependency present but broken"). Safe to call from every capture
    site; only the first call in a process does real work.

    Args:
        dsn_env_name: the environment variable name holding the DSN (e.g.
            "SENTRY_DSN" — see the module docstring for why every current
            call site passes the same name).

    Returns:
        True if a live client is (or already was) initialised, False if the
        named DSN env var is unset.
    """
    dsn = os.environ.get(dsn_env_name)
    if not dsn:
        return False

    global _sentry_initialised
    if _sentry_initialised:
        return True

    # FOLLOW-744: everything from here down is wrapped so a malformed DSN
    # (sentry_sdk.init raises BadDsn), a missing/incompatible sentry_sdk
    # install (ImportError), or any other init-time failure degrades to
    # "Sentry off" rather than crashing the caller — the same never-raise
    # contract flush_sentry() already keeps below. Without this, the
    # operator action that turns alerting ON (provisioning SENTRY_DSN) could
    # take three production jobs down on a copy-paste typo.
    try:
        import sentry_sdk

        try:
            from sentry_sdk.integrations.atexit import AtexitIntegration

            integrations = [AtexitIntegration()]
        except Exception:  # noqa: BLE001 — SDK layout changed; flush_sentry() still covers us.
            integrations = []

        sentry_sdk.init(
            dsn=dsn,
            traces_sample_rate=0.0,
            # C-07 / ROPA BOUNDARY — DO NOT REMOVE. Sentry's default
            # include_local_variables=True serialises each frame's locals into the
            # event. On the chat-intent path those locals hold `messages` (the
            # buyer's raw chat text) and `raw_text` (the model response) — shipping
            # that to a third-party US processor would be a strictly larger
            # disclosure than the exception-message echo dpia.md/ropa.md/C-07
            # contemplate. On the other call sites the same default would ship
            # tenant ids, listing payloads and DB rows. send_default_pii is
            # defaulted off too, pinned here so a future edit has to argue with a
            # comment (and a test — see test_observability.py) before flipping it.
            include_local_variables=False,
            send_default_pii=False,
            # None of these processes is a Sentry-instrumented web service in the
            # framework-middleware sense: initialising with the defaults would
            # install LoggingIntegration (every ERROR log becomes an event) and
            # auto-enable FastAPI/Starlette integrations on an already-running
            # container, burying the actual signal each call site captures
            # deliberately. AtexitIntegration is re-added explicitly because it is
            # NOT noise: every call site here runs inside a fire-and-forget or
            # short-lived Modal container that can exit immediately after this
            # call, and without an atexit flush the daemon transport thread is
            # killed with the interpreter and the queued event never ships.
            default_integrations=False,
            integrations=integrations,
            before_send=_scrub_chat_intent_exception_value,
        )
    except Exception as exc:  # noqa: BLE001 — telemetry must never escalate.
        print(f"observability.init_sentry: Sentry init failed, continuing without it: {exc!r}")
        return False

    _sentry_initialised = True
    return True


def flush_sentry(timeout: float = 0.3) -> None:
    """Bounded flush — belt to AtexitIntegration's braces.

    A spawned/scheduled Modal container can be torn down hard enough that
    atexit hooks do not run at all, so every capture site calls this after
    its capture_exception/capture_message call(s).

    0.3s, not a larger cut some earlier code used: the realtime chat-intent
    tier budgets <500ms end-to-end (Master Design §C.3), so a long flush was
    a multiple of the WHOLE budget on an already-degraded call. Batch/cron
    call sites can absorb this cost far more easily, so the same bound is
    used everywhere for one number to reason about, not because every site
    is equally time-pressured.

    Never raises: telemetry must not turn a degraded operation into a hard
    error on a production path. Callers wrap this (and the whole capture
    sequence) in their own try/except for the same reason; this function adds
    its own guard too so it is safe to call standalone.
    """
    try:
        import sentry_sdk

        sentry_sdk.flush(timeout=timeout)
    except Exception:  # noqa: BLE001 — telemetry must never escalate.
        pass
