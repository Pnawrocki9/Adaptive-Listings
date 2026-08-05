/**
 * Direct Modal HTTPS dispatch for chat.message.sent → intent-engine (audit F-01).
 *
 * Mirrors ADR-0016 / control-plane `publishDescriptionRequested`: Redpanda Cloud
 * Serverless has no HTTP Proxy, so stream-consumer never receives events in prod.
 * Ingest POSTs to `MODAL_CHAT_NLP_URL` (Modal `chat_nlp_endpoint`) inside
 * `ctx.waitUntil()` so ACK latency is unaffected.
 *
 * When `MODAL_CHAT_NLP_URL` is unset the dispatch is a configured no-op (same
 * shape as Redpanda / description URL guards). Failures are fail-loud to Sentry
 * (Rule K.2 fire-and-forget amendment) without blocking ingest ACK.
 *
 * §H.9: `profiling_opt_out` is forwarded so Modal skips the shadow Redis write;
 * the chat event itself still reaches ClickHouse via the normal batch path.
 *
 * FOLLOW-838 (buyer text must not reach Sentry from this file): the request
 * body built below carries the buyer's chat message, so NOTHING derived from
 * the upstream RESPONSE body may be logged or captured — see the comment on the
 * `!res.ok` arm for the mechanism and `docs/compliance/dpia.md` §2.7.2 for the
 * record. Both diagnostic sinks in this file (`console.error` and
 * `Sentry.captureException`) resolve to Sentry, so "log it, don't capture it"
 * is not a mitigation here.
 *
 * @module apps/ingest/src/handlers/chat-nlp-dispatch
 */

import * as Sentry from '@sentry/cloudflare';

/** Env bindings for the chat-NLP Modal dispatch. */
export interface ChatNlpDispatchEnv {
  /**
   * Modal `chat_nlp_endpoint` HTTPS URL.
   * Empty / unset = skip dispatch (pilot not yet wired).
   */
  MODAL_CHAT_NLP_URL?: string;
  /**
   * Shared Bearer secret — must match Modal `estalara-secrets` INTERNAL_API_SECRET
   * (same secret used by description / embed-seed endpoints).
   */
  INTERNAL_API_SECRET?: string;
}

/**
 * Classify a non-ok Modal response into a coarse, taggable kind (FOLLOW-838).
 *
 * Replaces the 500-char slice of the upstream response body that used to be
 * interpolated into the log line and the Sentry exception value. The body is
 * upstream-controlled and is derived from a request whose `message.content` is
 * the buyer's chat text; the status is not. This mapping recovers the part of
 * the body an operator actually acts on — which system is wrong and what to do
 * about it — without carrying any upstream bytes.
 *
 * Same convention as `apps/intent-engine/src/nlp.py::_classify_extraction_error`
 * (FOLLOW-812): a classified kind plus a class/status identifier, never the
 * message text.
 *
 * Deliberately NOT a PII-pattern regex (FOLLOW-811 AC(3) / FOLLOW-838 AC(2)
 * prohibition): the body is not sampled, filtered or scrubbed — it is not read.
 *
 * Module-private on purpose: its only consumer is the `!res.ok` arm below, and
 * exporting it would add a symbol with no cross-module consumer (Rule I). It is
 * exercised end-to-end through `dispatchChatNlp` in both test files.
 */
function classifyDispatchStatus(status: number): string {
  // 401/403 — the Worker's INTERNAL_API_SECRET does not match Modal's
  // `estalara-secrets` INTERNAL_API_SECRET. A config fix, not an outage.
  if (status === 401 || status === 403) return 'auth';
  // 404/405 — MODAL_CHAT_NLP_URL points at nothing (app not deployed, URL
  // truncated/re-hashed by a redeploy, wrong method).
  if (status === 404 || status === 405) return 'endpoint_not_found';
  // 400/422 — the endpoint rejected the request SHAPE. 400 is
  // `chat_nlp_endpoint`'s own validation, 422 is FastAPI/pydantic body
  // validation; either means this Worker and `apps/intent-engine/src/main.py`
  // disagree on the contract.
  if (status === 400 || status === 422) return 'contract';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_error';
  return 'other';
}

/** Minimal fields needed to spawn process_chat_message. */
export interface ChatNlpDispatchArgs {
  tenant_id: string;
  session_id: string;
  /** PII-scrubbed message text from ChatMessageSentPayloadSchema.message */
  message_text: string;
  /** §H.9 opt-out — when true, Modal skips the shadow Redis write. */
  profiling_opt_out?: boolean;
}

/**
 * POST to Modal chat_nlp_endpoint. Never throws; captures HTTP/network failures
 * to Sentry. Returns a Promise so callers can register it via `waitUntil`.
 *
 * @param args - Tenant/session/message fields from a validated chat.message.sent.
 * @param env - Worker env (URL + secret).
 * @param fetchImpl - Injectable fetch for tests.
 */
export function dispatchChatNlp(
  args: ChatNlpDispatchArgs,
  env: ChatNlpDispatchEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const modalUrl = env.MODAL_CHAT_NLP_URL?.trim();
  if (!modalUrl) {
    return Promise.resolve();
  }

  const messageText = args.message_text.trim();
  if (!args.tenant_id || !args.session_id || !messageText) {
    return Promise.resolve();
  }

  const secret = env.INTERNAL_API_SECRET ?? '';
  const body = {
    tenant_id: args.tenant_id,
    session_id: args.session_id,
    message: { role: 'user', content: messageText },
    profiling_opt_out: args.profiling_opt_out === true,
  };

  return fetchImpl(modalUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  })
    .then((res) => {
      if (!res.ok) {
        // FOLLOW-838: the response BODY is never read. It used to be sliced to
        // 500 chars and interpolated here, which put upstream-controlled bytes
        // into two sinks at once — `console.error` is also a Sentry input
        // (`consoleIntegration()` is a DEFAULT of `@sentry/cloudflare@10.50.0`,
        // `build/cjs/sdk.js:29`, and `observability.ts:76-81` overrides no
        // integrations), and `captureException` puts the same string in the
        // exception VALUE. The request this body answers carries the buyer's
        // chat message, and the endpoint's 422 leg demonstrably echoes the
        // parsed request body back in `detail[].input` (driven against
        // `local_dev.app`, transcript in the FOLLOW-838 PR body). Status +
        // classified kind is what an operator acts on; the body is not.
        const kind = classifyDispatchStatus(res.status);
        const msg = `[chat-nlp] Modal dispatch rejected: HTTP ${String(res.status)} (${kind})`;
        console.error(msg);
        Sentry.captureException(new Error(msg), {
          tags: { area: 'chat-nlp', sink: 'modal', kind: 'dispatch_failed', status_kind: kind },
          extra: { status: res.status, tenant_id: args.tenant_id },
        });
      }
    })
    .catch((err: unknown) => {
      // FOLLOW-838, Rule S sibling of the arm above — ASSESSED AND DELIBERATELY
      // LEFT CARRYING `err.message`, which is NOT the same call as the one made
      // there. This arm never sees an upstream response body: it fires on a
      // transport-layer rejection, where the message is generated by the Workers
      // runtime (`Network connection lost.`, `fetch failed`, an AbortError, a
      // `TypeError: Invalid URL`) and no leg of it is derived from the request
      // body. Redacting it would cost the whole diagnostic on the failure mode
      // most likely to actually fire (Modal cold-start timeouts) to buy nothing
      // established. This is a bounded acceptance, not an omission: it is
      // recorded in `docs/compliance/dpia.md` §2.7.2 and pinned executably by
      // `chat-nlp-sentry-capture-path.test.ts`, which asserts that a sentinel
      // planted in a rejection message DOES reach the wire.
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[chat-nlp] Modal dispatch failed:', msg);
      Sentry.captureException(err instanceof Error ? err : new Error(msg), {
        tags: { area: 'chat-nlp', sink: 'modal', kind: 'network' },
        extra: { tenant_id: args.tenant_id },
      });
    });
}
