"""Pre-deploy gate: assert the Modal ``estalara-secrets`` secret carries every
env key the app about to be deployed actually reads (FOLLOW-817).

WHY THIS EXISTS
---------------
``modal deploy`` only *registers* functions — it imports the module on the
runner and uploads the resulting app graph. It cannot tell whether the attached
Modal Secret carries the keys the deployed code reads at RUNTIME. Without this
gate, a deploy job goes green while every invocation of the deployed app dies:

  - ``apps/intent-engine``  — ``redis_writer.py:40`` does
    ``os.environ["UPSTASH_REDIS_REST_URL"]`` → ``KeyError`` inside a
    ``.spawn()``-ed function, i.e. invisible to the ingest Worker, which already
    got its 202. The chat shadow key is simply never written.
  - ``apps/data-quality``   — ``crons/schema_validation.py:209-211`` raises
    ``RuntimeError("DATABASE_URL environment variable is not set")`` at 02:00 UTC
    into nobody's log.

Both are "green badge over a dead run path", which the devops guardrails forbid
outright. This gate turns them into a visible red BEFORE the deploy happens.

HARD FAIL, NOT A SKIP
---------------------
The caller runs this only after ``MODAL_TOKEN_ID`` was confirmed present, so a
failure here always means "the dependency is present but broken" — which the
repo's soft-skip contract (modal-deploy.yml header, ESC-023/ESC-036) requires to
be a hard failure. There is no second skip.

NO SECRET VALUE IS EVER READ, PRINTED, OR RETURNED. Only key names and a
present/MISSING verdict cross the boundary.

USAGE (ephemeral ``modal run`` — never ``modal deploy``)::

    modal run scripts/check-modal-secret-keys.py::check \
      --required "UPSTASH_REDIS_REST_URL,UPSTASH_REDIS_REST_TOKEN"

Exit code is non-zero when any listed key is absent or blank.
"""

from __future__ import annotations

import modal

app = modal.App("estalara-secret-key-gate")


@app.function(secrets=[modal.Secret.from_name("estalara-secrets")], timeout=120)
def check(required: str) -> None:
    """Assert every comma-separated key in *required* is present and non-blank.

    Args:
        required: Comma-separated env key names the deployed app reads.

    Raises:
        RuntimeError: if any key is absent or blank in ``estalara-secrets``.
    """
    import os

    names = [n.strip() for n in required.split(",") if n.strip()]
    if not names:
        raise RuntimeError("--required was empty; refusing to pass a gate that checks nothing.")

    missing = [n for n in names if not os.environ.get(n, "").strip()]
    for name in names:
        print(f"  {name}: {'MISSING' if name in missing else 'present'}")

    if missing:
        raise RuntimeError(
            "estalara-secrets is missing "
            + str(len(missing))
            + " key(s) the app reads at runtime: "
            + ", ".join(missing)
            + ". Deploying now would produce a running app whose every invocation "
            "fails invisibly. Add the key(s) via the Modal web console "
            "(add individually — `modal secret create --force` WIPES the secret) "
            "and re-run this workflow. See backlog/ESCALATIONS.md ESC-053 and "
            "docs/runbooks/MODAL_PROD_STANDUP.md §3."
        )

    print(f"PASS: all {len(names)} required key(s) present in estalara-secrets.")
