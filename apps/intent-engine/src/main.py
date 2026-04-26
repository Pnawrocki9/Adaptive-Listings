"""
Estalara intent engine — Modal serverless Python service.

Full implementation in TICKET-013 (ml-engineer).

Responsibilities:
- Extract buyer intent dimensions from chat messages and behaviour events
- Map to the 12-dimension intent ontology (packages/intent-ontology)
- Return scored intent vector for archetype matching
"""

SERVICE_NAME = "estalara-intent-engine"
SERVICE_VERSION = "0.0.0"


def get_service_info() -> dict[str, str]:
    """Return service metadata for health checks.

    Returns:
        dict with service name and version.

    Example:
        >>> info = get_service_info()
        >>> info["service"]
        'estalara-intent-engine'
    """
    return {"service": SERVICE_NAME, "version": SERVICE_VERSION, "status": "placeholder"}
