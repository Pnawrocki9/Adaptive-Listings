"""
Estalara adaptation-engine — Modal serverless Python service.

Full implementation in TICKET-014 (ml-engineer / data-engineer).
"""

SERVICE_NAME = "estalara-adaptation-engine"
SERVICE_VERSION = "0.0.0"


def get_service_info() -> dict[str, str]:
    """Return service metadata for health checks.

    Returns:
        dict with service name and version.

    Example:
        >>> info = get_service_info()
        >>> info["service"]
        'estalara-adaptation-engine'
    """
    return {"service": SERVICE_NAME, "version": SERVICE_VERSION, "status": "placeholder"}
