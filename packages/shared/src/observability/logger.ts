/**
 * Pino structured logger factory for Estalara services.
 *
 * Pre-tags every log line with `service.name` and `service.version` so logs
 * are filterable in Grafana Loki without extra configuration.
 *
 * @module @estalara/shared/observability/logger
 */

import pino from 'pino';

/** Re-export the Pino Logger type for consumers. */
export type Logger = pino.Logger;

/**
 * Creates a structured Pino logger pre-tagged with service metadata.
 *
 * @param serviceName - The service identifier, e.g. `apps/ingest`. Used as
 *   `service.name` in every log line.
 * @returns A Pino logger instance.
 *
 * @example
 * ```ts
 * import { createLogger } from '@estalara/shared/observability';
 * const logger = createLogger('apps/ingest');
 * logger.info({ tenant_id: 'abc' }, 'event received');
 * ```
 */
export function createLogger(serviceName: string): pino.Logger {
  return pino({
    base: {
      service: {
        name: serviceName,
        version: process.env.GIT_SHA ?? 'dev',
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    level: process.env.LOG_LEVEL ?? 'info',
    ...(process.env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  });
}
