/**
 * `POST /v1/events` handler — accepts a batch of events, validates each against
 * `EventSchema` (from `@estalara/shared`), enriches with server-side annotations, writes to
 * ClickHouse. Per ADR-0003: envelope is validated strictly, payload is per-type discriminated.
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
import { SIGNATURE_MAX_SKEW_MS, authenticateRequest, decideIngestScope } from '../auth.js';
import type { AuthDeps, AuthRequestInput } from '../auth.js';
import { isOriginAllowed } from '../origin-gate.js';
import { evaluateConsent } from '../consent-gate.js';
import {
  CH_DATETIME64_MAX_MS,
  CH_DATETIME64_MIN_MS,
  isClickHouseEncodableTs,
  pushToClickHouse,
} from '../clickhouse-producer.js';
import { getWaitUntil } from '../wait-until.js';
import {
  MAX_RETRY_MESSAGE_BYTES,
  RETRY_QUEUE_SEND_OPTIONS,
  buildIntentSnapshotRetryMessage,
  chunkRecordsForRetryQueue,
  singleRecordRetryBytes,
} from '../events-retry-queue.js';
import { replayIdempotentResponse } from '../middleware/idempotency.js';
import { dispatchChatNlp } from './chat-nlp-dispatch.js';
import { handleIntentSnapshot } from './intent-snapshot.js';
import { logger } from '../observability/logger.js';
import { checkRateLimit } from '../rate-limiter.js';
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

/**
 * A retry message that would exceed the queue bound was NOT sent. [FOLLOW-1310, Codex F-15]
 * Raised as its own signal: it means records that were ACKed cannot be re-driven.
 */
function reportOversizeRetry(tenantId: string, batchId: string, count: number): void {
  logger.error(
    { tenant_id: tenantId, batch_id: batchId, oversize_records: count },
    'events_retry_record_oversize',
  );
  Sentry.captureException(new Error('events_retry_record_oversize'), {
    tags: { area: 'events', sink: 'retry_queue', kind: 'oversize' },
    extra: { tenant_id: tenantId, batch_id: batchId, oversize_records: count },
  });
}

/**
 * Re-queue each `intent.snapshot` side-write that did not land, one message per sink, so the
 * retry consumer re-drives exactly the store that failed. [FOLLOW-1310, Codex F-15]
 *
 * Without a provisioned queue the failure stays what it was before — observed (by
 * `handleIntentSnapshot`'s own Sentry/log signals) but not replayed — and says so in the log.
 */
async function requeueSnapshotSinks(
  env: Env,
  snapshot: Parameters<typeof buildIntentSnapshotRetryMessage>[0],
  failedSinks: readonly ('clickhouse' | 'supabase')[],
  meta: { tenant_id: string; batch_id: string; first_failed_at: number; attempt: number },
): Promise<void> {
  if (failedSinks.length === 0) return;
  if (!env.EVENTS_RETRY_QUEUE) {
    logger.warn(
      { tenant_id: meta.tenant_id, batch_id: meta.batch_id, sinks: failedSinks },
      'events_retry_queue_not_configured',
    );
    return;
  }
  for (const sink of failedSinks) {
    const message = buildIntentSnapshotRetryMessage(snapshot, sink, {
      ...meta,
      first_failed_at: Date.now(),
    });
    if (message === null) {
      reportOversizeRetry(meta.tenant_id, meta.batch_id, 1);
      continue;
    }
    try {
      await env.EVENTS_RETRY_QUEUE.send(message, RETRY_QUEUE_SEND_OPTIONS);
    } catch (enqueueErr) {
      const msg = enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr);
      logger.error(
        { tenant_id: meta.tenant_id, batch_id: meta.batch_id, sink, error: msg },
        'events_retry_enqueue_failed',
      );
      Sentry.captureException(enqueueErr instanceof Error ? enqueueErr : new Error(msg), {
        tags: { area: 'intent-snapshot', sink, kind: 'retry_enqueue_failed' },
        extra: { tenant_id: meta.tenant_id, batch_id: meta.batch_id },
      });
    }
  }
}

export const events = new Hono<{ Bindings: Env }>();

events.post('/', async (c) => {
  const span = trace.getActiveSpan();
  const requestId = (c.get('requestId' as never) as string | undefined) ?? crypto.randomUUID();

  // 1. Auth — read API key + signature headers + body together (we need raw body for HMAC)
  const apiKey = c.req.header('X-Estalara-API-Key');
  const signature = c.req.header('X-Estalara-Signature');
  const signatureTimestamp = c.req.header('X-Estalara-Timestamp');
  const signatureNonce = c.req.header('X-Estalara-Nonce');
  const requestOrigin = c.req.header('Origin');

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

  const authInput: AuthRequestInput = {
    apiKey,
    signatureHeader: signature,
    timestampHeader: signatureTimestamp,
    nonceHeader: signatureNonce,
    body: rawBody,
  };
  const authDeps: AuthDeps = { kv: c.env.KV_API_KEYS, replayKv: c.env.KV_IDEMPOTENCY };
  const auth = await authenticateRequest(authInput, authDeps);
  if (!auth.ok) {
    return c.json(
      errorBody(requestId, 'unauthorized', 'Authentication failed', { reason: auth.reason }),
      401,
    );
  }

  const tenantId = auth.tenant_id;

  // 1b. Server-caller gate [FOLLOW-1201 / audit SEC-1]. A request with no browser `Origin` did
  // not come from the SDK; it came from a process that has the page-visible api key and nothing
  // else unless it can also produce the tenant's `hmac_secret`. Before this gate the origin
  // check below was simply skipped for such callers and `auth.signed` was read by nothing, so
  // any visitor could `curl` `cta.clicked` rows into the pilot's lift metric. Runs BEFORE
  // rate-limit and every side effect, like the origin gate; zero extra I/O.
  if (!requestOrigin && !auth.signed) {
    span?.setAttributes({ 'estalara.tenant_id': tenantId, 'estalara.auth_denied': true });
    logger.warn({ tenant_id: tenantId }, 'unsigned_server_caller');
    // Rule K.2: a policy-driven rejection stays observable — this is the forgery signal.
    Sentry.captureMessage('unsigned_server_caller_rejected', {
      level: 'warning',
      tags: { area: 'events', gate: 'signature' },
      extra: { tenant_id: tenantId },
    });
    return c.json(
      errorBody(
        requestId,
        'unauthorized',
        'Requests without a browser Origin must be signed (X-Estalara-Signature + ' +
          'X-Estalara-Timestamp + X-Estalara-Nonce, HMAC-SHA-256 over timestamp\\nnonce\\nbody; ' +
          `timestamp within ±${String(SIGNATURE_MAX_SKEW_MS / 60_000)} min)`,
        { reason: 'unsigned_server_caller' },
      ),
      401,
    );
  }
  // 1c. Scope gate [FOLLOW-1310, Codex F-31] — the contract is `decideIngestScope` in auth.ts.
  // Runs before the origin gate, rate limit and every side effect; zero extra I/O.
  const scope = decideIngestScope(auth.scopes, auth.signed);
  if (!scope.allowed) {
    span?.setAttributes({ 'estalara.tenant_id': tenantId, 'estalara.scope_denied': true });
    logger.warn({ tenant_id: tenantId, signed: auth.signed }, 'insufficient_scope');
    // Rule K.2: a policy-driven rejection stays observable.
    Sentry.captureMessage('insufficient_scope_rejected', {
      level: 'warning',
      tags: { area: 'events', gate: 'scope' },
      extra: { tenant_id: tenantId, signed: auth.signed },
    });
    return c.json(
      errorBody(requestId, 'insufficient_scope', 'API key lacks the scope to write events', {
        required: scope.required,
      }),
      403,
    );
  }
  if (scope.legacy) span?.setAttribute('estalara.legacy_scope', true);

  // Make tenant_id available to any Hono middleware/handler downstream via context.
  c.set('tenantId' as never, tenantId);
  span?.setAttribute('estalara.tenant_id', tenantId);

  // 2b. Origin gate [FOLLOW-642, FOLLOW-1333]. Runs BEFORE rate-limit and BEFORE any ingest side
  // effect, so a key embedded on a page outside the list ingests nothing. The list is one
  // constant (`origin-gate.ts` → `@estalara/shared/browser-origins`): Estalara's own hosts, plus
  // localhost outside production. Zero I/O, so it cannot fail on a store outage.
  //
  // A request with NO `Origin` header is a server-side caller; CORS is a browser-only concern, so
  // it bypasses this gate — and it has ALREADY passed the signed-request gate in 1b above.
  if (requestOrigin && !isOriginAllowed(requestOrigin, c.env.ENVIRONMENT)) {
    span?.setAttributes({ 'estalara.tenant_id': tenantId, 'estalara.origin_denied': true });
    logger.warn({ tenant_id: tenantId, origin: requestOrigin }, 'origin_rejected');
    // Rule K.2: a policy-driven rejection must stay observable, never silently swallowed.
    Sentry.captureMessage('origin_gate_rejected', {
      level: 'warning',
      tags: { area: 'events', gate: 'origin' },
      extra: { tenant_id: tenantId, origin: requestOrigin },
    });
    return c.json(
      errorBody(requestId, 'forbidden_origin', 'Request origin is not permitted', {
        origin: requestOrigin,
      }),
      403,
    );
  }

  // 2c. Idempotent replay [FOLLOW-1310, Codex F-18] — only NOW, after auth, the signed-caller
  // gate, the scope gate and the origin gate have all passed for THIS request. A replay writes
  // nothing and does not consume rate limit (unchanged from before, when it short-circuited).
  const replay = await replayIdempotentResponse(c, rawBody);
  if (replay) return replay;

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
  /** Schema-rejected events, aggregated per batch — see the Sentry signal after the loop. */
  let schemaRejectedCount = 0;
  const schemaRejectedTypes = new Set<string>();
  /** FOLLOW-1310 bounds rejections (`ts_out_of_range`, `event_too_large`), aggregated per batch. */
  const boundsRejectedCodes = new Set<string>();
  // The batch id and retry metadata exist BEFORE validation so the size gate measures the exact
  // message a retry of this batch would send (`first_failed_at` keeps its 13-digit width).
  const batchId = crypto.randomUUID();
  const retryMeta = {
    tenant_id: tenantId,
    batch_id: batchId,
    first_failed_at: Date.now(),
    attempt: 0,
  };

  for (let i = 0; i < eventsField.length; i++) {
    const incoming: unknown = eventsField[i];
    const parsed = EventSchema.safeParse(incoming);
    if (!parsed.success) {
      rejected.push({ index: i, errors: parsed.error.flatten() });
      // FOLLOW-931 — a schema rejection was the ONLY drop path here with no observability, and
      // that blindness is what let `consent.granted { language: 'es' }` be discarded unnoticed:
      // rejection is per-event, the batch still returns 200, and nothing anywhere went red. Rule
      // K.2 applies to this drop exactly as it does to the consent gate below.
      schemaRejectedCount += 1;
      const rejectedType = (incoming as { type?: unknown } | null)?.type;
      if (typeof rejectedType === 'string') schemaRejectedTypes.add(rejectedType);
      continue;
    }

    // FOLLOW-1310 (Codex F-06) — a `ts` the `DateTime64(3)` column cannot hold. The shared
    // schema only asks for a positive integer, so before this gate one such event made the
    // ClickHouse body builder throw and the whole ACKed batch was lost. Rejected alone, typed.
    if (!isClickHouseEncodableTs(parsed.data.ts)) {
      boundsRejectedCodes.add('ts_out_of_range');
      rejected.push({
        index: i,
        errors: {
          code: 'ts_out_of_range',
          message: 'Event ts (epoch ms) is outside the storable range',
          min_ts: CH_DATETIME64_MIN_MS,
          max_ts: CH_DATETIME64_MAX_MS,
        },
      });
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
      // Logger fallback — FOLLOW-944 AC(3). This was the ONLY one of the five registered
      // signals with no `logger` line, and it is the compliance-relevant one: a visitor's
      // consent decision is being discarded. With `SENTRY_DSN_INGEST` unset in production
      // [MP-005], the Sentry counter
      // below is a no-op, so without this line the drop reached NO channel at all — the
      // per-event entry in `rejected[]` goes to the CALLER, never to an operator. Emitting at
      // `warn` keeps it visible to `wrangler tail` and to any future log sink.
      logger.warn(
        {
          tenant_id: tenantId,
          code: consent.code,
          event_type: consent.event_type,
          consent_class: consent.consent_class,
          consent_state: consent.consent_state,
        },
        'consent_gate_rejected',
      );
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

    const record: Record<string, unknown> = {
      ...parsed.data,
      tenant_id: tenantId,
      region,
      ingest_received_at: ingestReceivedAt,
      // FOLLOW-1203: the caller class, set AFTER the spread so no client field can claim it. Written
      // to `events.caller_signed` when the column flag is on (`clickhouse-producer.ts`); the lift
      // readers count a conversion only when it is true (ESC-084: excluded, never rejected here).
      caller_signed: auth.signed,
    };

    // FOLLOW-1310 (Codex F-15) — an event we ACK must be replayable: its one-record retry message
    // has to fit a Cloudflare Queue message. Measured exactly on the record that would be queued.
    if (singleRecordRetryBytes(record, retryMeta) > MAX_RETRY_MESSAGE_BYTES) {
      boundsRejectedCodes.add('event_too_large');
      rejected.push({
        index: i,
        errors: {
          code: 'event_too_large',
          message: 'Event is too large to be durably retried; it was not accepted',
          limit_bytes: MAX_RETRY_MESSAGE_BYTES,
        },
      });
      continue;
    }

    validated.push(record);
  }

  // Bounds rejections (FOLLOW-1310), reported once per batch like `schema_rejected` below.
  if (boundsRejectedCodes.size > 0) {
    logger.warn(
      { tenant_id: tenantId, codes: [...boundsRejectedCodes].sort() },
      'event_bounds_rejected',
    );
    Sentry.captureMessage('event_bounds_rejected', {
      level: 'warning',
      tags: { area: 'events', gate: 'bounds' },
      extra: {
        tenant_id: tenantId,
        batch_size: eventsField.length,
        codes: [...boundsRejectedCodes].sort(),
      },
    });
  }

  // Schema rejections, reported ONCE per batch rather than once per event: a client sending a
  // malformed payload sends many, and a per-event capture would turn a client bug into a Sentry
  // flood. Tags stay low-cardinality (the event types come from a closed set); counts and the
  // distinct type list ride in `extra`.
  if (schemaRejectedCount > 0) {
    // INERT IN PRODUCTION pending `SENTRY_DSN_INGEST` — see the register in
    // `docs/runbooks/INGEST_WORKER_DEPLOY.md` and the branch note in `observability.ts`
    // (FOLLOW-937). Raising it is still correct: the drop must be observable the moment the
    // channel is armed, and a signal that has to be written later never is.
    Sentry.captureMessage('schema_rejected', {
      level: 'warning',
      tags: {
        area: 'events',
        gate: 'schema',
        // An audit event failing schema validation is a compliance signal, not a client bug:
        // the visitor's consent decision is being discarded (DPIA §13.1).
        has_consent_event: String(
          schemaRejectedTypes.has('consent.granted') || schemaRejectedTypes.has('consent.denied'),
        ),
      },
      extra: {
        tenant_id: tenantId,
        rejected_count: schemaRejectedCount,
        batch_size: eventsField.length,
        event_types: [...schemaRejectedTypes].sort(),
      },
    });
  }

  // 6. Per-type side-effect handlers (fire-and-forget via waitUntil).
  //
  // intent.snapshot — dual-write to ClickHouse intent_events + Supabase intent_sessions.
  // chat.message.sent — direct Modal HTTPS → intent-engine chat_nlp_endpoint (F-01 /
  //   ADR-0016). There is no event bus (FOLLOW-1263).
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
      const snapshotEvent = {
        session_id: sessionIdStr,
        ...(crossSessionId !== undefined ? { cross_session_id: crossSessionId } : {}),
        tenant_id: tenantId,
        ts: typeof evt.ts === 'number' ? evt.ts : Date.now(),
        payload,
      };
      // FOLLOW-1310 (Codex F-15): a sink that did not land is re-queued as its own side-write
      // message instead of being observed and lost. Still fully post-ACK.
      const writePromise = handleIntentSnapshot(snapshotEvent, c.env).then(({ failedSinks }) =>
        requeueSnapshotSinks(c.env, snapshotEvent, failedSinks, retryMeta),
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

  // 7. Push to ClickHouse (skip if everything was rejected).
  //
  // ADR-0022 / FOLLOW-988 stage C (2026-08-16): this used to await an event-bus REST-proxy
  // publish here first, gating the ACK, before firing ClickHouse post-ACK. That publish is
  // GONE — it had been a permanent no-op since ADR-0016 (its URL was empty in every
  // wrangler.toml env block; the Serverless event-bus tier never exposed a REST proxy,
  // ESC-017), so removing it does not change production behavior: the ACK now fires
  // immediately once the ClickHouse write is scheduled, exactly as fast as the no-op guard
  // already made it. The event-bus 503 path it used to return is gone with it — it was
  // already unreachable in production.
  //
  // ClickHouse (FOLLOW-459 / 2026-07-01 audit F-09): previously awaited alongside
  // the event-bus publish via `Promise.all`, so a struggling/unreachable ClickHouse endpoint blocked
  // the ACK for up to ~12s (3 attempts x 4s per-attempt timeout) + ~3.1s backoff
  // (100+500+2500ms) BEFORE the Worker could even return a 503 — violating the <50ms
  // p95 ACK budget stated at index.ts:10. The insert now runs in `ctx.waitUntil()`
  // AFTER the Response has already been sent, using the SAME 3-attempt/backoff retry
  // policy (`pushToClickHouse`, unchanged) — only its position in the request
  // lifecycle moved.
  //
  // RETRY-CONTRACT CHANGE — read before touching this block again:
  //   BEFORE (pre-FOLLOW-459): a terminal ClickHouse failure (all retries exhausted, or a
  //   4xx) returned HTTP 503 to the SDK; the SDK retried the whole batch (Idempotency-Key
  //   not yet cached, since only 2xx responses are cached — idempotency.ts).
  //   AFTER: the SDK receives 200 as soon as the ClickHouse write is scheduled, *before*
  //   its outcome is known. That 200 is idempotency-cached, so a client retry with the
  //   same Idempotency-Key now replays the cached 200 instead of re-attempting the insert.
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
  //   FOLLOW-1310: every message is held to an EXACT byte bound (`events-retry-queue.ts`), and
  //   the `intent.snapshot` side-writes above are re-queued too, one message per failed sink.
  if (validated.length > 0) {
    // FOLLOW-459: fire ClickHouse off the ACK critical path. `pushToClickHouse` never
    // throws (it always resolves with `{ ok: false, ... }` on terminal failure — see
    // clickhouse-producer.ts), so the `.then()` below is the only place a failure
    // surfaces; `.catch()` is a defensive backstop for an unexpected bug in that handler.
    const waitUntilCh = getWaitUntil(c);
    const chPromise = pushToClickHouse(validated, c.env).then(async (clickhousePush) => {
      if (clickhousePush.ok) {
        // SUCCESS is logged too, and that is not noise. Without it, "no ClickHouse line in the
        // worker log" is ambiguous between succeeded, never-settled and cancelled — three states
        // with three different fixes. The nightly E2E spent a debugging cycle unable to tell them
        // apart, which is the same ambiguity FOLLOW-982 removed from the premise register.
        // [FOLLOW-986]
        logger.info(
          {
            tenant_id: tenantId,
            batch_id: batchId,
            record_count: validated.length,
            attempts: clickhousePush.attempts,
            // What ClickHouse says it WROTE, not what we sent. A 2xx with zero written rows is
            // now a failure upstream, so seeing this number match `record_count` is the only
            // form of "the events are in ClickHouse" this log can honestly claim. [FOLLOW-986]
            written_rows: clickhousePush.writtenRows ?? null,
          },
          'clickhouse_push_ok_post_ack',
        );
      }
      if (!clickhousePush.ok) {
        // FOLLOW-845: `clickhousePush.error` no longer carries any ClickHouse response
        // BODY — it is `clickhouse_status_<http>[:ch_code_<n>:<class>]`, built from
        // response headers in `clickhouse-producer.ts`. Both diagnostics below are
        // Sentry inputs (`logger.error` emits via `console.log`, and
        // `consoleIntegration()` is a default of `@sentry/cloudflare`), and the batch
        // being inserted contains buyer chat text, so nothing derived from that body
        // may appear here. `ch_query_id` is the replacement pivot for the detail:
        // `SELECT exception FROM system.query_log WHERE query_id = '<id>'` returns
        // ClickHouse's full message, quoted input included, without exporting it.
        logger.error(
          {
            tenant_id: tenantId,
            batch_size: eventsField.length,
            attempts: clickhousePush.attempts,
            upstream_status: clickhousePush.status,
            ch_error_code: clickhousePush.chErrorCode,
            ch_query_id: clickhousePush.queryId,
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
              ch_error_code: clickhousePush.chErrorCode,
              ch_query_id: clickhousePush.queryId,
            },
          },
        );

        // FOLLOW-482 / ADR-0017: durably re-queue the failed batch instead of only
        // Sentry-capturing it. `env.EVENTS_RETRY_QUEUE` is optional (same "not configured"
        // guard shape as `CLICKHOUSE_URL`) — an environment that hasn't provisioned the
        // queue yet skips the enqueue with a warn log rather than throwing.
        if (c.env.EVENTS_RETRY_QUEUE) {
          const { messages: retryMessages, oversize } = chunkRecordsForRetryQueue(validated, {
            ...retryMeta,
            first_failed_at: Date.now(),
          });
          if (oversize.length > 0) {
            // Unreachable while the `event_too_large` gate above holds (it measures the same
            // bytes); kept loud so a drift between the two cannot lose events silently.
            reportOversizeRetry(tenantId, batchId, oversize.length);
          }
          try {
            // Sequential, not `Promise.all` — ordering doesn't matter (the queue is
            // order-tolerant, ADR-0017), but a `.send()` failure must be attributable to its
            // own chunk rather than racing all sends and losing per-chunk error context.
            for (const retryMessage of retryMessages) {
              await c.env.EVENTS_RETRY_QUEUE.send(retryMessage, RETRY_QUEUE_SEND_OPTIONS);
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
  } else {
    // Previously a comment saying "production Workers always provide executionCtx". That is an
    // assumption about the runtime stated in a place nothing reads. If it is ever false, the
    // ClickHouse write becomes a dangling microtask the runtime may cancel at response time —
    // silently, because `pushToClickHouse` logs nothing on success. Now it announces itself.
    logger.warn(
      { tenant_id: tenantId, batch_id: batchId },
      'clickhouse_post_ack_unregistered: no executionCtx.waitUntil — the write is a dangling ' +
        'microtask and may be cancelled when the response returns',
    );
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
