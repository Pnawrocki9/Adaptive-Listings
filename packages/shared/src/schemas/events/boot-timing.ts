/**
 * `boot_timing` — SDK boot-path latency telemetry. FOLLOW-1037 (MP-011 -> `watched`).
 *
 * §H.9 note: this is OPERATIONAL LATENCY TELEMETRY, not profiling. The payload carries only
 * millisecond spans between `performance.mark()` boot milestones (see
 * `packages/sdk/src/core/boot-timing.ts`) — never an archetype, a buyer characteristic, or any
 * signal that feeds adaptation. It answers "how long did the SDK take to boot", the same question
 * an APM agent answers for a backend service, and rides the ingest event envelope's existing
 * `consent_state` field purely because it is queued and flushed through the SAME `eventQueue` /
 * `dispatchEvents()` path as every other SDK event after the same consent gate — not because its
 * content is sensitive.
 *
 * FOLLOW-1033 made the decomposition permanent on the `estalara:adapt:settled` DOM event so a
 * measurement harness needs no debug build. FOLLOW-1037 is the first consumer of that decomposition
 * outside the browser: it lands the SAME numbers in ClickHouse (via the existing ingest pipeline)
 * so MP-011's claim can be re-measured from production sessions instead of Vite-dev milliseconds.
 *
 * At most one `boot_timing` event is queued per page load — `bootTimings()` is read exactly once,
 * at the single `mark('settled')` call site in `packages/sdk/src/index.ts`'s `init()`.
 *
 * @module @estalara/shared/schemas/events/boot-timing
 */

import { z } from 'zod';

import { EventEnvelopeBaseSchema } from '../event.js';

/**
 * `boot_timing` payload — mirrors `bootTimings()`'s return shape 1:1.
 *
 * `preInit` and `total` are the two spans this event exists to price (MP-011): `preInit` is
 * navigation -> the SDK's own first line (host hydration + loader fetch + parse — nothing in this
 * package can shrink it); `total` is navigation -> the settled decision, the number the
 * Demo-integration CI ceiling assertion watches. Both are required because `bootTimings()` only
 * ever returns a non-empty object when both are computable (it early-returns `{}` when the
 * Performance API is unavailable, and the SDK does not queue this event in that case). The
 * intermediate spans are optional: they are best-effort breakdowns of the same window and a
 * missing one (e.g. a returning session skipping the config fetch) must not invalidate the event.
 *
 * @example
 * {
 *   type: 'boot_timing',
 *   payload: { preInit: 1174, initToConfig: 2, configFetch: 97, configToAdapt: 1, adapt: 21, total: 1295 }
 * }
 */
export const BootTimingPayloadSchema = z.object({
  /** Navigation -> the SDK's first line of code (host hydration + loader fetch + parse). */
  preInit: z.number().nonnegative(),
  /** `preInit` end -> quiz-config/intent-weights fetch start, when that fetch happens at all. */
  initToConfig: z.number().nonnegative().optional(),
  /** Duration of the quiz-config + intent-weights fetch. */
  configFetch: z.number().nonnegative().optional(),
  /** Config fetch end (or `preInit` end, if no fetch) -> the `/adapt` call start. */
  configToAdapt: z.number().nonnegative().optional(),
  /** Duration of the `/adapt` decision round trip. */
  adapt: z.number().nonnegative().optional(),
  /** Navigation -> settled decision. The span the CI ceiling assertion watches. */
  total: z.number().nonnegative(),
});

export const BootTimingEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('boot_timing'),
  payload: BootTimingPayloadSchema,
});

export type BootTimingEvent = z.infer<typeof BootTimingEventSchema>;
export type BootTimingPayload = z.infer<typeof BootTimingPayloadSchema>;
