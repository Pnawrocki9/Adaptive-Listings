/**
 * Structured logger for the Estalara ingest Cloudflare Worker.
 *
 * Re-exports a pre-configured Pino logger from `@estalara/shared/observability`
 * with `service.name` fixed to `apps/ingest`. Import from this module rather
 * than calling `createLogger` directly so every log line in the ingest app
 * carries the correct service tag.
 *
 * @module apps/ingest/src/observability/logger
 */

import { createLogger, type Logger } from '@estalara/shared/observability';

export const logger: Logger = createLogger('apps/ingest');
export type { Logger };
