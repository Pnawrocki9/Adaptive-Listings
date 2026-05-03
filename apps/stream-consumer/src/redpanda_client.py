"""
Redpanda / Kafka client builders.

Reads connection config from environment variables populated by the Modal
`redpanda-creds` secret (see main.py). Falls back to unauthenticated localhost
when REDPANDA_SASL_USERNAME is absent (useful for local docker-compose testing).
"""

import os

import structlog
from confluent_kafka import Consumer, KafkaError, Producer

log = structlog.get_logger(__name__)

# Retry / timeout config
_SOCKET_TIMEOUT_MS = 30_000
_SESSION_TIMEOUT_MS = 30_000
_MAX_POLL_INTERVAL_MS = 300_000


def _base_config() -> dict[str, object]:
    brokers = os.environ.get("REDPANDA_BROKERS", "localhost:9092")
    username = os.environ.get("REDPANDA_SASL_USERNAME", "")
    password = os.environ.get("REDPANDA_SASL_PASSWORD", "")
    mechanism = os.environ.get("REDPANDA_SASL_MECHANISM", "SCRAM-SHA-256")
    use_tls = os.environ.get("REDPANDA_TLS", "false").lower() == "true"

    cfg: dict[str, object] = {
        "bootstrap.servers": brokers,
        "socket.timeout.ms": _SOCKET_TIMEOUT_MS,
    }

    if username:
        protocol = "SASL_SSL" if use_tls else "SASL_PLAINTEXT"
        cfg.update(
            {
                "security.protocol": protocol,
                "sasl.mechanism": mechanism,
                "sasl.username": username,
                "sasl.password": password,
            }
        )
    else:
        cfg["security.protocol"] = "PLAINTEXT"

    log.debug("redpanda_config_built", brokers=brokers, protocol=cfg.get("security.protocol"))
    return cfg


def build_consumer(group_id: str, topics: list[str]) -> Consumer:
    """Create a configured Kafka consumer subscribed to *topics*."""
    cfg = _base_config()
    cfg.update(
        {
            "group.id": group_id,
            "auto.offset.reset": "earliest",
            "enable.auto.commit": False,
            "session.timeout.ms": _SESSION_TIMEOUT_MS,
            "max.poll.interval.ms": _MAX_POLL_INTERVAL_MS,
        }
    )
    consumer = Consumer(cfg)
    consumer.subscribe(topics)
    log.info("kafka_consumer_subscribed", topics=topics, group_id=group_id)
    return consumer


def build_producer() -> Producer:
    """Create a configured Kafka producer for DLQ writes."""
    cfg = _base_config()
    cfg["acks"] = "all"
    return Producer(cfg)


def is_fatal(err: KafkaError) -> bool:
    """Return True if the error should stop the consumer."""
    return bool(err.fatal())
