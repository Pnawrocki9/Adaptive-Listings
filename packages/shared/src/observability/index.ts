/**
 * Observability utilities for Estalara services.
 *
 * Re-exports:
 * - `createLogger` — Pino structured logger factory
 * - `createTracer` — OpenTelemetry tracer factory
 * - `EstalaraError` — typed platform error class
 *
 * @module @estalara/shared/observability
 */

export { createLogger, type Logger } from './logger.js';
export { createTracer, type Tracer } from './tracer.js';
export { EstalaraError, type EstalaraErrorArgs, type EstalaraErrorJSON } from './error.js';
