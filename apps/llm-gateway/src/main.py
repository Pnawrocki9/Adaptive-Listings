"""
Estalara llm-gateway — Modal deploy entrypoint.

Running ``modal deploy apps/llm-gateway/src/main.py`` discovers every
@app.function registered across the llm-gateway by importing this module, which
in turn imports both consumer modules.  Modal registers functions at import time,
so every function below is registered under the single shared modal.App defined
in jobs/_app.py:

  - generate_description               (jobs/generate_description.py)
  - description_requested_endpoint     (jobs/generate_description.py) — ADR-0016 / FOLLOW-485
    direct Modal HTTPS web endpoint; the current dispatch path for description.requested.
  - consume_description_requests       (jobs/generate_description.py) — Redpanda poller,
    superseded by the endpoint above (unscheduled; retained for reference).
  - process_embed_seed_request         (jobs/consume_embed_seed_requests.py) — ADR-0016 /
    FOLLOW-485 spawn()-able job dispatched by the endpoint below.
  - listing_embed_seed_requested_endpoint (jobs/consume_embed_seed_requests.py) — ADR-0016 /
    FOLLOW-485 direct Modal HTTPS web endpoint; the current dispatch path for
    listing-embed-seed.requested.
  - consume_embed_seed_requests        (jobs/consume_embed_seed_requests.py) — Redpanda poller,
    superseded by the endpoint above (unscheduled; retained for reference).

Background: previously this file was an empty placeholder (no ``modal`` import,
no modal.App, no consumer imports), so ``modal deploy main.py`` registered zero
Modal functions (BUG 1, ESC-034).  The fix is these two import lines — they are
load-bearing: the side-effects of importing each consumer module register the
@app.function decorators against the shared app object.

IMPORTANT: do NOT remove these imports even though they appear unused.  Linters
may flag them as unused; the ``# noqa: F401`` annotations suppress that warning.
"""

# Load-bearing imports: importing the consumer modules registers their
# @app.function decorators against the shared modal.App in jobs/_app.py.
# All three Modal functions (generate_description, consume_description_requests,
# consume_embed_seed_requests) become reachable from this entrypoint.
from jobs import consume_embed_seed_requests as _consume_embed  # noqa: F401
from jobs import generate_description as _generate  # noqa: F401

# Re-export ``app`` so Modal can locate the App object when parsing this file.
from jobs._app import app  # noqa: F401

SERVICE_NAME = "estalara-llm-gateway"
SERVICE_VERSION = "0.1.0"


def get_service_info() -> dict[str, str]:
    """Return service metadata for health checks.

    Returns:
        dict with service name, version, and status.

    Example:
        >>> info = get_service_info()
        >>> info["service"]
        'estalara-llm-gateway'
    """
    return {"service": SERVICE_NAME, "version": SERVICE_VERSION, "status": "active"}
