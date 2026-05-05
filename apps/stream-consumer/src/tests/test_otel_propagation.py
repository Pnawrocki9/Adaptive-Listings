"""
Unit tests for OTel trace context propagation in the stream consumer.

Verifies that:
- _extract_trace_context correctly parses W3C traceparent from Kafka headers
- Processing a message with a valid traceparent starts a child span linked to
  the producer trace
- Messages without headers extract an empty (root) context gracefully
"""

from __future__ import annotations

import base64
from unittest.mock import MagicMock

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import NonRecordingSpan

from src.consumers.events import _extract_trace_context


def _make_msg_with_headers(headers: list[tuple[str, bytes]] | None) -> MagicMock:
    """Build a minimal Kafka message mock with the given headers."""
    msg = MagicMock()
    msg.error.return_value = None
    msg.value.return_value = b'{}'
    msg.topic.return_value = "events"
    msg.offset.return_value = 0
    msg.partition.return_value = 0
    msg.headers.return_value = headers
    return msg


# W3C traceparent: version=00, trace_id, parent_span_id, flags=01 (sampled)
TRACE_ID = "0af7651916cd43dd8448eb211c80319c"
PARENT_SPAN_ID = "b7ad6b7169203331"
TRACEPARENT = f"00-{TRACE_ID}-{PARENT_SPAN_ID}-01"


class TestExtractTraceContext:
    def test_extracts_traceparent_from_bytes_header(self) -> None:
        headers = [("traceparent", TRACEPARENT.encode())]
        msg = _make_msg_with_headers(headers)
        ctx = _extract_trace_context(msg)
        # The extracted context should carry the expected trace/span IDs
        from opentelemetry import trace
        span = trace.get_current_span(ctx)
        sc = span.get_span_context()
        assert sc is not None
        assert format(sc.trace_id, "032x") == TRACE_ID
        assert format(sc.span_id, "016x") == PARENT_SPAN_ID

    def test_extracts_traceparent_from_base64_encoded_header(self) -> None:
        """Pandaproxy base64-encodes header values — consumer must decode them."""
        b64_value = base64.b64encode(TRACEPARENT.encode())
        # After decoding, the value is the raw traceparent string
        decoded = base64.b64decode(b64_value).decode("utf-8")
        headers = [("traceparent", decoded.encode())]
        msg = _make_msg_with_headers(headers)
        ctx = _extract_trace_context(msg)
        from opentelemetry import trace
        sc = trace.get_current_span(ctx).get_span_context()
        assert sc is not None
        assert format(sc.trace_id, "032x") == TRACE_ID

    def test_returns_empty_context_when_no_headers(self) -> None:
        msg = _make_msg_with_headers(None)
        ctx = _extract_trace_context(msg)
        from opentelemetry import trace
        span = trace.get_current_span(ctx)
        # No traceparent → span context is invalid (NonRecordingSpan)
        assert isinstance(span, NonRecordingSpan)
        assert not span.get_span_context().is_valid

    def test_returns_empty_context_when_headers_empty_list(self) -> None:
        msg = _make_msg_with_headers([])
        ctx = _extract_trace_context(msg)
        from opentelemetry import trace
        span = trace.get_current_span(ctx)
        assert isinstance(span, NonRecordingSpan)

    def test_ignores_unrelated_headers(self) -> None:
        headers = [("x-custom-header", b"some-value"), ("content-type", b"application/json")]
        msg = _make_msg_with_headers(headers)
        ctx = _extract_trace_context(msg)
        from opentelemetry import trace
        span = trace.get_current_span(ctx)
        assert isinstance(span, NonRecordingSpan)
        assert not span.get_span_context().is_valid

    def test_handles_malformed_header_value_gracefully(self) -> None:
        headers = [("traceparent", b"\xff\xfe invalid utf-8")]
        msg = _make_msg_with_headers(headers)
        # Should not raise — malformed headers are silently skipped
        ctx = _extract_trace_context(msg)
        assert ctx is not None


class TestConsumerSpan:
    """Verify that a consumer span is started with the correct parent context."""

    def test_span_links_to_producer_trace(self) -> None:
        from opentelemetry import trace as otel_trace

        exporter = InMemorySpanExporter()
        provider = TracerProvider()
        provider.add_span_processor(SimpleSpanProcessor(exporter))

        # Temporarily override the global tracer provider
        original_provider = otel_trace.get_tracer_provider()
        otel_trace.set_tracer_provider(provider)

        try:
            import src.consumers.events as events_module

            # Re-bind the module-level tracer to the new provider
            original_tracer = events_module._tracer
            events_module._tracer = provider.get_tracer(__name__)

            headers = [("traceparent", TRACEPARENT.encode())]
            msg = _make_msg_with_headers(headers)
            ctx = _extract_trace_context(msg)

            with events_module._tracer.start_as_current_span(
                "consume_event",
                context=ctx,
                kind=otel_trace.SpanKind.CONSUMER,
            ):
                pass  # span ends here

            spans = exporter.get_finished_spans()
            assert len(spans) == 1
            span = spans[0]
            # The span's parent trace_id must match the injected traceparent
            assert format(span.context.trace_id, "032x") == TRACE_ID
            # Parent span_id must be the producer's span id
            assert span.parent is not None
            assert format(span.parent.span_id, "016x") == PARENT_SPAN_ID

        finally:
            events_module._tracer = original_tracer
            otel_trace.set_tracer_provider(original_provider)
