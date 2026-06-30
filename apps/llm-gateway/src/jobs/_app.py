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
"""

from __future__ import annotations

import modal

app = modal.App("estalara-description-generator")

_image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "anthropic>=0.28",
    "httpx>=0.27",
    "confluent-kafka>=2.4",
    "sentry-sdk>=2.0",
    "structlog>=24.0",
)
