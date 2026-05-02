/**
 * Tests for the OTel spans configuration factory.
 *
 * We do not instantiate the real `@microlabs/otel-cf-workers` exporter (it
 * requires a Workers runtime with `cloudflare:workers` support). Instead we
 * verify that `otelConfig` produces the correct configuration shape for a
 * given `env`. The `instrument` export is mocked so the test can run in Node.
 *
 * AC8: span attribute tests are in `span-attributes.test.ts`.
 *
 * @module apps/ingest/src/observability/spans.test
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@microlabs/otel-cf-workers', () => ({
  instrument: vi.fn((handler: unknown) => handler),
}));

const { otelConfig } = await import('./spans.js');

interface TraceConfigExporter {
  exporter: { url: string; headers?: Record<string, string> };
  service: { name: string; version?: string };
}

function asExporterConfig(c: unknown): TraceConfigExporter {
  return c as TraceConfigExporter;
}

describe('otelConfig', () => {
  it('uses OTEL_EXPORTER_URL when provided', () => {
    const env = {
      OTEL_EXPORTER_URL: 'https://otlp.example.com/v1/traces',
      OTEL_EXPORTER_HEADERS: '',
      GIT_SHA: 'abc123',
    };
    const config = asExporterConfig(otelConfig(env, {} as never));
    expect(config.exporter.url).toBe('https://otlp.example.com/v1/traces');
  });

  it('falls back to localhost when OTEL_EXPORTER_URL is absent', () => {
    const config = asExporterConfig(otelConfig({}, {} as never));
    expect(config.exporter.url).toBe('http://localhost:4318/v1/traces');
  });

  it('parses comma-separated key=value headers', () => {
    const env = {
      OTEL_EXPORTER_HEADERS: 'Authorization=Basic dXNlcjpwYXNz,X-Scope=metrics:write',
    };
    const config = asExporterConfig(otelConfig(env, {} as never));
    expect(config.exporter.headers).toEqual({
      Authorization: 'Basic dXNlcjpwYXNz',
      'X-Scope': 'metrics:write',
    });
  });

  it('returns empty headers object when OTEL_EXPORTER_HEADERS is absent', () => {
    const config = asExporterConfig(otelConfig({}, {} as never));
    expect(config.exporter.headers).toEqual({});
  });

  it('sets service.name to estalara-ingest', () => {
    const config = asExporterConfig(otelConfig({}, {} as never));
    expect(config.service.name).toBe('estalara-ingest');
  });

  it('uses GIT_SHA as service.version', () => {
    const config = asExporterConfig(otelConfig({ GIT_SHA: 'deadbeef' }, {} as never));
    expect(config.service.version).toBe('deadbeef');
  });

  it('falls back to dev when GIT_SHA is absent', () => {
    const config = asExporterConfig(otelConfig({}, {} as never));
    expect(config.service.version).toBe('dev');
  });

  it('handles header value containing equals sign (base64)', () => {
    const env = {
      OTEL_EXPORTER_HEADERS: 'Authorization=Basic dXNlcjpwYXNz==',
    };
    const config = asExporterConfig(otelConfig(env, {} as never));
    expect(config.exporter.headers).toEqual({
      Authorization: 'Basic dXNlcjpwYXNz==',
    });
  });
});
