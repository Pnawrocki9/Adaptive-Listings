"""
Estalara llm-gateway — Modal serverless Python service.

Full implementation in TICKET-013 (ml-engineer / data-engineer).
"""

SERVICE_NAME = "estalara-llm-gateway"
SERVICE_VERSION = "0.0.0"


def get_service_info() -> dict[str, str]:
    """Return service metadata for health checks.

    Returns:
        dict with service name and version.

    Example:
        >>> info = get_service_info()
        >>> info["service"]
        'estalara-llm-gateway'
    """
    return {"service": SERVICE_NAME, "version": SERVICE_VERSION, "status": "placeholder"}
