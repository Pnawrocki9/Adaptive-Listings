/**
 * @estalara/shared — Shared Zod schemas and TypeScript types used across all Estalara services.
 *
 * Event schemas (envelope + 33 event types across 10 categories) are defined in `./schemas/`
 * per ADR-0003 (`docs/adr/0003-event-schema-and-versioning.md`) and Master Design C.1.
 *
 * Use `EventSchema` (a discriminated union) at every validation boundary: SDK → ingest worker →
 * Redpanda → Modal stream consumer → ClickHouse projection.
 *
 * @module @estalara/shared
 */

export * from './schemas/index.js';
export * from './errors.js';
export * from './demo.js';

/** Current shared package version string. */
export const SHARED_VERSION = '0.0.0' as const;
