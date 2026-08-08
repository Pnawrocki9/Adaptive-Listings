"""
Shared Modal app definition for apps/llm-gateway.

All llm-gateway consumer modules (generate_description.py,
consume_embed_seed_requests.py) import ``app`` and ``_image`` from here so that a
single ``modal.App`` object owns every @app.function registration.

This ensures ``modal deploy apps/llm-gateway/src/main.py`` registers ALL
llm-gateway functions under one canonical app — fixing BUG 2 from ESC-034 where
both consumer modules each declared ``modal.App("estalara-description-generator")``
independently, which caused deploying either file to silently wipe the other's
functions from the live app.

The app name ``estalara-description-generator`` is intentionally preserved to
avoid orphaning the running functions on the current Modal deployment (the
description pipeline is LIVE under this name).  The name is a slight misnomer for
a multi-consumer gateway, but renaming would require decommissioning the old-named
app's functions — that migration risk is not warranted for a naming cosmetic.  See
ESC-034 / FOLLOW-437.

The image contains the union of all packages required by both consumer modules:
- anthropic (generate_description only)
- httpx, confluent-kafka, sentry-sdk, structlog (both consumers)
- fastapi (ADR-0016 / FOLLOW-485 — required by @modal.fastapi_endpoint web endpoints)
"""

from __future__ import annotations

from pathlib import Path

import modal

app = modal.App("estalara-description-generator")

# ESC-036 deploy fix: generate_description.py / consume_embed_seed_requests.py read
# their cross-runtime contract fixtures (packages/shared/contracts/*.required.json)
# AT IMPORT TIME via a path relative to the module — which resolves to
# /packages/shared/contracts/... inside the Modal container. Only the `jobs` package
# is auto-mounted, so those fixtures are absent and the module import crashes with
# FileNotFoundError (every function fails to load). Bake them into the image at the
# exact path the code computes. `copy=True` puts them in an image layer so they are
# present during the import phase, not just at runtime.
_CONTRACTS = Path(__file__).parent / "../../../../packages/shared/contracts"

_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "anthropic>=0.28",
        "httpx>=0.27",
        "confluent-kafka>=2.4",
        "sentry-sdk>=2.0",
        "structlog>=24.0",
        "fastapi>=0.110",
    )
    .add_local_file(
        str((_CONTRACTS / "description-event.required.json").resolve()),
        "/packages/shared/contracts/description-event.required.json",
        copy=True,
    )
    .add_local_file(
        str((_CONTRACTS / "listing-embed-seed-event.required.json").resolve()),
        "/packages/shared/contracts/listing-embed-seed-event.required.json",
        copy=True,
    )
    # FOLLOW-900: behaviourally a no-op for THIS app — its @app.function definitions live in
    # `jobs.generate_description` / `jobs.consume_embed_seed_requests`, i.e. modules with a
    # truthy `__package__`, so modal 1.4.2's implicit entrypoint mount already takes the
    # PACKAGE branch and mounts `jobs/` via the very same
    # `_Mount._from_local_python_packages("jobs")` this line calls. It is written down
    # anyway because that branch is chosen by an invisible property of how the entrypoint
    # happens to be loaded: apps/data-quality had the FILE branch instead and its cron was
    # dead in prod for its entire life, unalerted, behind a green deploy. Declaring local
    # source explicitly is now a hard CI gate (scripts/check-modal-local-imports.py) so no
    # Modal app in this repo can silently depend on which branch it lands on.
    .add_local_python_source("jobs")
)
