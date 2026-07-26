/**
 * `POST /v1/events` handler — accepts a batch of events, validates each against
 * `EventSchema` (from `@estalara/shared`), enriches with server-side annotations, pushes to
 * Redpanda. Per ADR-0003: envelope is validated strictly, payload is per-type discriminated.
 *
 * All error responses use the canonical shape (TICKET-019):
 *   `{ error: { code, message, request_id, details? } }`
 *
 * Observability (TICKET-018):
 * - OTel span attributes set on the active span created by `@microlabs/otel-cf-workers`
 *
 * Limits (Master Design C.2 + ticket spec):
 * - Max 1MB request body
 * - Max 1000 events per batch
 *
 * @module apps/ingest/src/handlers/events
 */

import * as Sentry from '@sentry/cloudflare';
import { trace } from '@opentelemetry/api';
import { EventSchema } from '@estalara/shared';
import type { IntentSnapshotPayload } from '@estalara/shared';
import { Hono } from 'hono';

import type { Env } from '../types.js';
import { authenticateRequest } from '../auth.js';
import {
  allowedOriginsForEnv,
  isOriginAllowed,
  isUnprovisionedExternalTenant,
  resolveOriginPolicy,
} from '../origin-gate.js';
import { evaluateConsent, redactPersistedPayloadForConsent } from '../consent-gate.js';
import { pushToClickHouse } from '../clickhouse-producer.js';
import { chunkRecordsForRetryQueue } from '../events-retry-queue.js';
import { dispatchChatNlp } from './chat-nlp-dispatch.js';
import { handleIntentSnapshot } from './intent-snapshot.js';
import { logger } from '../observability/logger.js';
import { checkRateLimit } from '../rate-limiter.js';
import { pushToRedpanda } from '../redpanda-producer.js';
import { mapCountryToRegion } from '../region.js';

const MAX_BODY_BYTES = 1_000_000;
const MAX_BATCH_SIZE = 1000;

interface RejectedEvent {
  index: number;
  errors: unknown;
}

function errorBody(
  requestId: string,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return {
    error: {
      code,
      message,
      request_id: requestId,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

/**
 * Hono v4's generic `Context` type doesn't expose `executionCtx` in its public type surface,
 * even though Cloudflare Workers' `ExecutionContext.waitUntil()` lets a Worker keep running
 * background work after the `Response` has been sent, without delaying the client-visible ACK.
 * This narrow typed accessor is the single place that reaches for it via an unofficial cast, so
 * every fire-and-forget sink below (intent-snapshot dual-write, and — as of FOLLOW-459 — the
 * ClickHouse events insert) shares one accessor instead of duplicating the cast.
 *
 * `Context#executionCtx` is a getter that THROWS (not `undefined`) when the Worker `fetch`
 * handler wasn't given a third `ExecutionContext` argument (e.g. `app.fetch(request, env)` with
 * no `ctx` — every non-FOLLOW-459 test in this app, and any environment without a real Worker
 * runtime). The try/catch below is required, not optional.
 */
interface HonoWithExecCtx {
  executionCtx?: { waitUntil?: (p: Promise<unknown>) => void };
}

function getWaitUntil(c: unknown): ((p: Promise<unknown>) => void) | undefined {
  try {
    return (c as HonoWithExecCtx).executionCtx?.waitUntil;
  } catch {
    return undefined;
  }
}

export const events = new Hono<{ Bindings: Env }>();

events.post('/', async (c) => {
  const span = trace.getActiveSpan();
  const requestId = (c.get('requestId' as never) as string | undefined) ?? crypto.randomUUID();

  // 1. Auth — read API key + signature headers + body together (we need raw body for HMAC)
  const apiKey = c.req.header('X-Estalara-API-Key');
  const signature = c.req.header('X-Estalara-Signature');

  // 2. Body size check (early reject via Content-Length, then re-check after read)
  const contentLength = c.req.header('Content-Length');
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return c.json(
      errorBody(requestId, 'payload_too_large', 'Request body exceeds 1 MB limit', {
        limit_bytes: MAX_BODY_BYTES,
      }),
      413,
    );
  }

  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    return c.json(errorBody(requestId, 'validation_failed', 'Request body is unreadable'), 400);
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    return c.json(
      errorBody(requestId, 'payload_too_large', 'Request body exceeds 1 MB limit', {
        limit_bytes: MAX_BODY_BYTES,
      }),
      413,
    );
  }

  const auth = await authenticateRequest(apiKey, signature, rawBody, c.env.KV_API_KEYS);
  if (!auth.ok) {
    return c.json(
      errorBody(requestId, 'unauthorized', 'Authentication failed', { reason: auth.reason }),
      401,
    );
  }

  const tenantId = auth.tenant_id;
  // Make tenant_id available to any Hono middleware/handler downstream via context.
  c.set('tenantId' as never, tenantId);
  span?.setAttribute('estalara.tenant_id', tenantId);

  // 2b. Per-tenant origin gate [FOLLOW-642]. Runs BEFORE rate-limit and BEFORE any ingest side
  // effect, so a stolen api key embedded on a non-allow-listed origin ingests nothing.
  //
  // FAIL-SAFE: this operates only on `auth.allowed_origins` — data KV already returned above.
  // It performs ZERO additional I/O, so it cannot fail on a store outage and adds no new failure
  // surface to the <50ms ACK budget. If KV were unreadable, auth already returned 401 (fail
  // closed) — an explicit-allow-list tenant is never silently failed open here.
  //
  // A request with NO `Origin` header is a server-side caller (curl / HMAC-signed adapter);
  // CORS is a browser-only concern, so it bypasses the gate and stays gated by the HMAC
  // signature check in `authenticateRequest` instead. The `corsAllowOrigin` context value the
  // CORS middleware reads is set to the allow-listed origin (echo) or '' (deny → omit header).
  const requestOrigin = c.req.header('Origin');
  if (requestOrigin) {
    const policy = resolveOriginPolicy(
      auth.allowed_origins,
      allowedOriginsForEnv(c.env.ENVIRONMENT),
    );
    // 2c. Provisioning guard [FOLLOW-658]. `inherit` means "use Estalara's OWN env allow-list" —
    // correct for exactly one tenant. For anyone else it proves the KV api-key record was never
    // seeded with `allowed_origins` (no in-repo code writes `KV_API_KEYS`; it is an explicit
    // operator step, `docs/runbooks/BRAND_PROVISIONING.md` §Step 6). That state is not a benign
    // default: the brand's own domain gets a generic 403 while its api key still works from
    // `app.estalara.com` / `admin.estalara.com`. Refuse with a self-describing code + a Sentry
    // ERROR so the missed step is loud during onboarding verification instead of silent.
    // Still zero I/O — `FIRST_PARTY_TENANT_ID` is a Worker var; blank = guard disabled (see
    // `isUnprovisionedExternalTenant`), so a forgotten value cannot cost first-party traffic.
    if (isUnprovisionedExternalTenant(policy.mode, tenantId, c.env.FIRST_PARTY_TENANT_ID)) {
      c.set('corsAllowOrigin' as never, ''); // deny → CORS middleware omits the header
      span?.setAttributes({
        'estalara.tenant_id': tenantId,
        'estalara.origin_denied': true,
        'estalara.origin_policy': 'unprovisioned',
      });
      logger.error(
        { tenant_id: tenantId, origin: requestOrigin, policy_mode: policy.mode },
        'origin_policy_unconfigured',
      );
      Sentry.captureMessage('origin_policy_unconfigured', {
        level: 'error',
        tags: { area: 'events', gate: 'origin', policy_mode: 'unprovisioned' },
        extra: { tenant_id: tenantId, origin: requestOrigin },
      });
      return c.json(
        errorBody(
          requestId,
          'origin_policy_unconfigured',
          'This tenant has no provisioned allowed_origins — seed the api-key KV record ' +
            '(BRAND_PROVISIONING runbook, Step 6) before sending browser traffic',
          { origin: requestOrigin },
        ),
        403,
      );
    }
    if (!isOriginAllowed(requestOrigin, policy.allowList)) {
      c.set('corsAllowOrigin' as never, ''); // deny → CORS middleware omits the header
      span?.setAttributes({
        'estalara.tenant_id': tenantId,
        'estalara.origin_denied': true,
        'estalara.origin_policy': policy.mode,
      });
      logger.warn(
        { tenant_id: tenantId, origin: requestOrigin, policy_mode: policy.mode },
        'origin_rejected',
      );
      // Rule K.2: a policy-driven rejection must stay observable, never silently swallowed.
      Sentry.captureMessage('origin_gate_rejected', {
        level: 'warning',
        tags: { area: 'events', gate: 'origin', policy_mode: policy.mode },
        extra: { tenant_id: tenantId, origin: requestOrigin },
      });
      return c.json(
        errorBody(
          requestId,
          'forbidden_origin',
          'Request origin is not permitted for this tenant',
          {
            origin: requestOrigin,
          },
        ),
        403,
      );
    }
    // Allowed — echo the exact request origin on the response (CORS middleware applies it).
    c.set('corsAllowOrigin' as never, requestOrigin);
  }

  // 3. Parse JSON
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json(errorBody(requestId, 'validation_failed', 'Request body is not valid JSON'), 400);
  }
  if (typeof body !== 'object' || body === null || !('events' in body)) {
    return c.json(
      errorBody(requestId, 'validation_failed', "Request body must contain an 'events' array"),
      400,
    );
  }
  const eventsField = body.events;
  if (!Array.isArray(eventsField)) {
    return c.json(
      errorBody(requestId, 'validation_failed', "'events' field must be an array"),
      400,
    );
  }
  if (eventsField.length === 0) {
    return c.json(
      errorBody(requestId, 'validation_failed', "'events' array must not be empty"),
      400,
    );
  }
  if (eventsField.length > MAX_BATCH_SIZE) {
    return c.json(
      errorBody(
        requestId,
        'payload_too_large',
        `Batch exceeds ${String(MAX_BATCH_SIZE)}-event limit`,
        { limit: MAX_BATCH_SIZE },
      ),
      413,
    );
  }

  // 4. Per-tenant rate limit
  const rate = await checkRateLimit(c.env.RATE_LIMITER, tenantId, eventsField.length);
  if (!rate.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((rate.reset_at - Date.now()) / 1000));
    span?.setAttributes({
      'estalara.tenant_id': tenantId,
      'estalara.batch_size': eventsField.length,
      'estalara.rate_limited': true,
    });
    logger.warn(
      {
        tenant_id: tenantId,
        batch_size: eventsField.length,
        remaining: rate.remaining,
        reset_at: rate.reset_at,
      },
      'rate_limited',
    );
    c.header('Retry-After', String(retryAfterSeconds));
    return c.json(
      errorBody(
        requestId,
        'rate_limited',
        'Rate limit exceeded — retry after the indicated window',
        { limit: rate.limit, remaining: rate.remaining, reset_at: rate.reset_at },
      ),
      429,
    );
  }

  // 5. Validate + enrich each event
  const region = mapCountryToRegion(c.req.header('CF-IPCountry'));
  const ingestReceivedAt = Date.now();

  const validated: Record<string, unknown>[] = [];
  const rejected: RejectedEvent[] = [];

  let consentRejectedCount = 0;

  for (let i = 0; i < eventsField.length; i++) {
    const incoming: unknown = eventsField[i];
    const parsed = EventSchema.safeParse(incoming);
    if (!parsed.success) {
      rejected.push({ index: i, errors: parsed.error.flatten() });
      continue;
    }

    // FOLLOW-559 / audit A3-F-08 — server-side consent gate at the STORAGE boundary.
    // The shared `ConsentStateSchema` validates `consent_state` for shape only; nothing gates
    // on the value, so a profiling event with `consent_state: 'none'` would otherwise persist.
    // Rejection is PER-EVENT (not a whole-batch 4xx) so a batch mixing a `consent.granted`
    // audit event with a `none` profiling event still records the audit event — required by
    // AC2 / §H.9 (the ingest stream must keep flowing). Keys on `consent_state` ONLY, never on
    // opt-out state (§H.9 ruling 2026-06-23).
    const consent = evaluateConsent(parsed.data.type, parsed.data.consent_state);
    if (!consent.allowed) {
      consentRejectedCount += 1;
      rejected.push({
        index: i,
        errors: {
          code: consent.code,
          message:
            consent.code === 'consent_not_granted'
              ? 'Profiling-class event rejected: consent_state does not grant a lawful basis for persistence'
              : 'Event type is not classified by the consent gate and was rejected fail-closed',
          consent_class: consent.consent_class,
          consent_state: consent.consent_state,
          event_type: consent.event_type,
        },
      });
      // Structured Sentry counter — each rejection is a tagged, filterable/aggregatable signal
      // (Rule K.2: a policy-driven drop must stay observable, never silently swallowed).
      Sentry.captureMessage('consent_gate_rejected', {
        level: 'warning',
        tags: {
          area: 'events',
          gate: 'consent',
          code: consent.code,
          event_type: consent.event_type,
          consent_class: consent.consent_class,
          consent_state: consent.consent_state,
        },
        extra: { tenant_id: tenantId },
      });
      continue;
    }

    // FOLLOW-579 — strip §H.8(d) derived-intent fields (final_archetype / final_confidence /
    // prediction_stability_score) from a `session.quality.snapshot` payload when consent_state
    // grants no lawful basis. The event STILL ingests (operational class, unchanged); only the
    // three derived-intent keys are removed from the persisted record, so an unconsented user's
    // archetype identity cannot ride through the operational class the gate never blocks. A no-op
    // for every other event type and for consented / legitimate-interest users. Applied here,
    // before both sinks (Redpanda + the ClickHouse `events` insert).
    const persistedPayload = redactPersistedPayloadForConsent(
      parsed.data.type,
      parsed.data.consent_state,
      parsed.data.payload,
    );

    validated.push({
      ...parsed.data,
      payload: persistedPayload,
      tenant_id: tenantId,
      region,
      ingest_received_at: ingestReceivedAt,
    });
  }

  // 6. Per-type side-effect handlers (fire-and-forget via waitUntil).
  //
  // intent.snapshot — dual-write to ClickHouse intent_events + Supabase intent_sessions.
  // chat.message.sent — direct Modal HTTPS → intent-engine chat_nlp_endpoint (F-01 /
  //   ADR-0016). Bypasses Redpanda/stream-consumer which are inert on Serverless.
  // These writes are non-blocking: ingest ACK is returned to the SDK regardless of
  // whether they succeed. Failures are logged to console/Sentry.
  for (const evt of validated) {
    if (evt.type === 'intent.snapshot') {
      // LG-4 fix (FOLLOW-286): use canonical IntentSnapshotPayload imported from @estalara/shared
      // instead of an inline type redeclaration that could silently drift.
      const payload = evt.payload as IntentSnapshotPayload;
      const waitUntil = getWaitUntil(c);
      const crossSessionId =
        typeof evt.cross_session_id === 'string' ? evt.cross_session_id : undefined;
      const sessionIdStr =
        typeof evt.session_id === 'string'
          ? evt.session_id
          : typeof evt.session_id === 'number'
            ? String(evt.session_id)
            : '';
      const writePromise = handleIntentSnapshot(
        {
          session_id: sessionIdStr,
          ...(crossSessionId !== undefined ? { cross_session_id: crossSessionId } : {}),
          tenant_id: tenantId,
          ts: typeof evt.ts === 'number' ? evt.ts : Date.now(),
          payload,
        },
        c.env,
      );
      if (waitUntil) {
        // FOLLOW-449 defensive backstop: `handleIntentSnapshot`'s own Promise.allSettled
        // branches already capture every ClickHouse/Supabase write rejection to Sentry
        // (see intent-snapshot.ts). This `.catch()` only fires if `handleIntentSnapshot`
        // itself throws synchronously (a code bug, not a configured-store failure) —
        // without it, that would be an unhandled rejection inside `ctx.waitUntil` that the
        // CF Workers runtime drops silently (no Sentry event, no log). Stays fire-and-forget:
        // no `await`, so no added ACK latency.
        waitUntil(
          writePromise.catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
              JSON.stringify({
                event: 'intent_snapshot_handler_threw',
                tenant_id: tenantId,
                error: msg,
              }),
            );
            Sentry.captureException(err instanceof Error ? err : new Error(msg), {
              tags: { area: 'intent-snapshot', sink: 'handler', kind: 'unexpected_throw' },
              extra: { tenant_id: tenantId },
            });
          }),
        );
      }
      // If waitUntil is unavailable (test env), the promise is still dispatched;
      // it will resolve before the Worker exits on a hot-path because handleIntentSnapshot
      // itself awaits both writes.
    }

    if (evt.type === 'chat.message.sent') {
      const waitUntil = getWaitUntil(c);
      const sessionIdStr =
        typeof evt.session_id === 'string'
          ? evt.session_id
          : typeof evt.session_id === 'number'
            ? String(evt.session_id)
            : '';
      const chatPayload = evt.payload as {
        message?: unknown;
        profiling_opt_out?: unknown;
      };
      const messageText = typeof chatPayload.message === 'string' ? chatPayload.message : '';
      const profilingOptOut = chatPayload.profiling_opt_out === true;
      const dispatchPromise = dispatchChatNlp(
        {
          tenant_id: tenantId,
          session_id: sessionIdStr,
          message_text: messageText,
          profiling_opt_out: profilingOptOut,
        },
        c.env,
      );
      if (waitUntil) {
        waitUntil(
          dispatchPromise.catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
              JSON.stringify({
                event: 'chat_nlp_dispatch_threw',
                tenant_id: tenantId,
                error: msg,
              }),
            );
            Sentry.captureException(err instanceof Error ? err : new Error(msg), {
              tags: { area: 'chat-nlp', sink: 'handler', kind: 'unexpected_throw' },
              extra: { tenant_id: tenantId },
            });
          }),
        );
      }
    }
  }

  // 7. Push to downstream sinks (skip if everything was rejected).
  //
  // Redpanda Pandaproxy stays on the synchronous ACK path and keeps its existing
  // 503/retry contract UNCHANGED by this ticket: it's currently a no-op in production
  // (REDPANDA_REST_URL is empty — Redpanda Cloud Serverless doesn't expose Pandaproxy,
  // ESC-017) so it resolves instantly; a 5xx-exhausted-retries or bare-4xx failure
  // returns 503 so the SDK retries the whole batch (idempotency.ts caches only 2xx
  // responses, so a 503 is safely re-processed on the client's next attempt).
  //
  // ClickHouse (FOLLOW-459 / 2026-07-01 audit F-09): previously awaited alongside
  // Redpanda via `Promise.all`, so a struggling/unreachable ClickHouse endpoint blocked
  // the ACK for up to ~12s (3 attempts x 4s per-attempt timeout) + ~3.1s backoff
  // (100+500+2500ms) BEFORE the Worker could even return a 503 — violating the <50ms
  // p95 ACK budget stated at index.ts:10. The insert now runs in `ctx.waitUntil()`
  // AFTER the Response has already been sent, using the SAME 3-attempt/backoff retry
  // policy (`pushToClickHouse`, unchanged) — only its position in the request
  // lifecycle moved.
  //
  // RETRY-CONTRACT CHANGE — read before touching this block again:
  //   BEFORE: a terminal ClickHouse failure (all retries exhausted, or a 4xx) returned
  //   HTTP 503 to the SDK; the SDK retried the whole batch (Idempotency-Key not yet
  //   cached, since only 2xx responses are cached — idempotency.ts).
  //   AFTER: the SDK receives 200 as soon as Redpanda succeeds, *before* ClickHouse's
  //   outcome is known. That 200 is idempotency-cached, so a client retry with the same
  //   Idempotency-Key now replays the cached 200 instead of re-attempting the insert.
  //   A terminal ClickHouse failure is therefore no longer visible to the client and no
  //   longer retried by the SDK.
  //   PRESERVED: at-least-once delivery up to the existing in-process retry policy (3
  //   attempts / exponential backoff) — unchanged, it just runs post-ACK now. A terminal
  //   failure (after those 3 attempts, or a 4xx) is captured to Sentry (see the `.then()`
  //   handler below) so it stays observable and can be manually replayed/backfilled —
  //   Rule K.2: a configured-but-failed store must never be silently swallowed.
  //   FOLLOW-482 / ADR-0017 (2026-07-06): a terminal ClickHouse failure is no longer only
  //   Sentry-captured — the failed batch is ALSO durably re-queued to the
  //   `estalara-events-retry` Cloudflare Queue (chunked by byte size — see
  //   `events-retry-queue.ts`), consumed by the `queue()` handler in `index.ts`, which
  //   re-inserts via this SAME `pushToClickHouse` path and lands in the native
  //   `estalara-events-retry-dlq` only after exhausting Cloudflare's own per-message
  //   retry budget. This closes the "NOT preserved" gap named above: client-driven
  //   re-delivery is replaced by a Worker-side durable retry, so a ClickHouse outage
  //   longer than the ~3.1s in-process window no longer permanently drops events.
  //   Duplicate-row risk is a known, accepted consequence (no dedup key — ADR-0017 §4),
  //   not a new one introduced by this change.
  const batchId = crypto.randomUUID();
  if (validated.length > 0) {
    const redpandaPush = await pushToRedpanda(validated, c.env);

    if (!redpandaPush.ok) {
      logger.error(
        {
          tenant_id: tenantId,
          batch_size: eventsField.length,
          attempts: redpandaPush.attempts,
          upstream_status: redpandaPush.status,
        },
        'redpanda_push_failed',
      );
      return c.json(
        errorBody(requestId, 'redpanda_unavailable', 'Failed to publish events to message bus', {
          attempts: redpandaPush.attempts,
          ...(redpandaPush.status !== undefined ? { upstream_status: redpandaPush.status } : {}),
        }),
        503,
      );
    }

    // FOLLOW-459: fire ClickHouse off the ACK critical path. `pushToClickHouse` never
    // throws (it always resolves with `{ ok: false, ... }` on terminal failure — see
    // clickhouse-producer.ts), so the `.then()` below is the only place a failure
    // surfaces; `.catch()` is a defensive backstop for an unexpected bug in that handler.
    const waitUntilCh = getWaitUntil(c);
    const chPromise = pushToClickHouse(validated, c.env).then(async (clickhousePush) => {
      if (!clickhousePush.ok) {
        logger.error(
          {
            tenant_id: tenantId,
            batch_size: eventsField.length,
            attempts: clickhousePush.attempts,
            upstream_status: clickhousePush.status,
            error: clickhousePush.error,
          },
          'clickhouse_push_failed_post_ack',
        );
        // Rule K.2: a configured store that failed AFTER the ACK must stay observable,
        // not silently dropped.
        Sentry.captureException(
          new Error(`clickhouse_push_failed_post_ack: ${clickhousePush.error}`),
          {
            tags: { area: 'events', sink: 'clickhouse', kind: 'insert_failed' },
            extra: {
              tenant_id: tenantId,
              batch_size: eventsField.length,
              attempts: clickhousePush.attempts,
              upstream_status: clickhousePush.status,
            },
          },
        );

        // FOLLOW-482 / ADR-0017: durably re-queue the failed batch instead of only
        // Sentry-capturing it. `env.EVENTS_RETRY_QUEUE` is optional (same "not configured"
        // guard shape as CLICKHOUSE_URL/REDPANDA_REST_URL) — an environment that hasn't
        // provisioned the queue yet skips the enqueue with a warn log rather than throwing.
        if (c.env.EVENTS_RETRY_QUEUE) {
          const retryMessages = chunkRecordsForRetryQueue(validated, {
            tenant_id: tenantId,
            batch_id: batchId,
            first_failed_at: Date.now(),
            attempt: 0,
          });
          try {
            // Sequential, not `Promise.all` — ordering doesn't matter (the queue is
            // order-tolerant, ADR-0017), but a `.send()` failure must be attributable to its
            // own chunk rather than racing all sends and losing per-chunk error context.
            for (const retryMessage of retryMessages) {
              await c.env.EVENTS_RETRY_QUEUE.send(retryMessage);
            }
          } catch (enqueueErr) {
            const msg = enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr);
            logger.error(
              { tenant_id: tenantId, batch_id: batchId, error: msg },
              'events_retry_enqueue_failed',
            );
            // Distinct tag from `insert_failed` above: this is the retry SAFETY NET itself
            // failing (queue misconfigured/outage), not the primary insert — Rule K.2, this
            // must stay as observable as the primary failure it was meant to backstop.
            Sentry.captureException(enqueueErr instanceof Error ? enqueueErr : new Error(msg), {
              tags: { area: 'events', sink: 'clickhouse', kind: 'retry_enqueue_failed' },
              extra: { tenant_id: tenantId, batch_id: batchId },
            });
          }
        } else {
          logger.warn(
            { tenant_id: tenantId, batch_id: batchId },
            'events_retry_queue_not_configured',
          );
        }
      }
    });
    if (waitUntilCh) {
      waitUntilCh(
        chPromise.catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            JSON.stringify({
              event: 'clickhouse_push_threw_post_ack',
              tenant_id: tenantId,
              error: msg,
            }),
          );
          Sentry.captureException(err instanceof Error ? err : new Error(msg), {
            tags: { area: 'events', sink: 'clickhouse', kind: 'unexpected_throw' },
            extra: { tenant_id: tenantId },
          });
        }),
      );
    }
    // If waitUntil is unavailable (e.g. some test environments), chPromise still runs
    // as a dangling microtask — production Workers always provide executionCtx.
  }

  span?.setAttributes({
    'estalara.tenant_id': tenantId,
    'estalara.batch_size': eventsField.length,
    'estalara.region': region,
    'estalara.validation_failures': rejected.length,
    'estalara.consent_rejected': consentRejectedCount,
    'estalara.rate_limited': false,
  });

  logger.info(
    {
      tenant_id: tenantId,
      batch_id: batchId,
      batch_size: eventsField.length,
      accepted: validated.length,
      rejected: rejected.length,
      consent_rejected: consentRejectedCount,
      region,
    },
    'events_accepted',
  );

  return c.json(
    {
      accepted: validated.length,
      rejected: rejected.length,
      batch_id: batchId,
      ...(rejected.length > 0 ? { errors: rejected } : {}),
    },
    200,
  );
});
